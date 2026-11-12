import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';

export interface HubStackProps extends StackProps {
  repoRoot: string;
  /** `bedrock` : vrais appels ; `mock` : IA simulée (aucun appel, coût nul), tant que Bedrock n'est pas activé. */
  llmProvider: 'bedrock' | 'mock';
  bedrockRegion: string;
  modelFast: string;
  modelSmart: string;
  monthlyBudgetUsd: number;
  /**
   * Expéditeur des e-mails du hub (demandes de validation de CDC), identité vérifiée dans Amazon SES ; vide : pas
   * d'envoi (le lien de validation est alors à transmettre à la main, depuis le hub).
   */
  mailFrom: string;
}

/**
 * Hobbit (hub de l'équipe IT) — architecture 100 % serverless (coût quasi nul au repos) :
 *   CloudFront ─┬─ /*      → S3 (front React)
 *               └─ /api/*  → API Gateway HTTP (JWT Cognito) → Lambda API ──(asynchrone)──→ Lambda worker → Bedrock
 *   DynamoDB (données) · S3 (versions, transcriptions, images, exports) · Cognito (MFA TOTP obligatoire)
 */
export class HubStack extends Stack {
  constructor(scope: Construct, id: string, props: HubStackProps) {
    super(scope, id, props);
    const root = props.repoRoot;

    // ---- Données ---------------------------------------------------------------
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: 'gsi1',
          partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { prefix: 'exports/', expiration: Duration.days(2) },
        { prefix: 'uploads/', expiration: Duration.days(7) },
        { noncurrentVersionExpiration: Duration.days(90) },
      ],
    });

    // ---- Authentification --------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'hub-it-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'Votre accès à Hobbit',
        emailBody:
          'Bonjour,<br><br>Un accès à Hobbit, le hub de l’équipe IT, a été créé pour vous.<br>Identifiant : {username}<br>Mot de passe temporaire : {####}<br><br>À la première connexion, vous choisirez un mot de passe puis configurerez Google Authenticator (ou une application équivalente).',
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.hours(12),
    });

    // ---- Lambdas -------------------------------------------------------------------
    const environment = {
      APP_RUNTIME: 'aws',
      AUTH_MODE: 'cognito',
      USER_POOL_ID: userPool.userPoolId,
      TABLE_NAME: table.tableName,
      BUCKET_NAME: dataBucket.bucketName,
      LLM_PROVIDER: props.llmProvider,
      BEDROCK_REGION: props.bedrockRegion,
      MODEL_FAST: props.modelFast,
      MODEL_SMART: props.modelSmart,
      MONTHLY_BUDGET_USD: String(props.monthlyBudgetUsd),
      MAIL_FROM: props.mailFrom,
      NODE_OPTIONS: '--enable-source-maps',
    };
    // pdfkit (moteur du PDF) charge ses polices standard par des imports dynamiques que l'empaqueteur ne suit pas :
    // on copie ces modules à côté du bundle et on les déclare dans un package.json local.
    const apiRequire = createRequire(join(root, 'apps/api/package.json'));
    const pdfkitJs = dirname(createRequire(apiRequire.resolve('pdfmake')).resolve('pdfkit'));
    const bundling = {
      format: OutputFormat.CJS,
      target: 'node22',
      minify: true,
      sourceMap: true,
      mainFields: ['module', 'main'],
      // Le SDK AWS est embarqué (versions maîtrisées) plutôt que pris dans le runtime Lambda.
      externalModules: [],
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        afterBundling: (_input: string, output: string) => [
          `cp -r "${join(pdfkitJs, 'standard-fonts')}" "${output}/standard-fonts"`,
          `echo '{"imports":{"#standard-fonts/*":"./standard-fonts/*.cjs"}}' > "${output}/package.json"`,
        ],
      },
    };
    const common = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: root,
      depsLockFilePath: join(root, 'pnpm-lock.yaml'),
      bundling,
      environment,
    };

    const worker = new NodejsFunction(this, 'WorkerFn', {
      ...common,
      description: 'Hobbit – tâches IA (génération, intégration, traduction)',
      entry: join(root, 'apps/api/src/worker.ts'),
      memorySize: 1024,
      // Maximum Lambda : une création de fiche de lecture peut enchaîner deux à trois appels longs.
      timeout: Duration.minutes(15),
      logGroup: new logs.LogGroup(this, 'WorkerLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    // Pas de nouvelle tentative automatique : une erreur est remontée à l'utilisateur, qui relance s'il le souhaite.
    worker.configureAsyncInvoke({ retryAttempts: 0, maxEventAge: Duration.minutes(15) });

    const api = new NodejsFunction(this, 'ApiFn', {
      ...common,
      description: 'Hobbit – API',
      entry: join(root, 'apps/api/src/lambda.ts'),
      memorySize: 1024,
      timeout: Duration.seconds(29),
      environment: { ...environment, WORKER_FUNCTION_NAME: worker.functionName },
      logGroup: new logs.LogGroup(this, 'ApiLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.DESTROY }),
    });

    for (const fn of [api, worker]) {
      table.grantReadWriteData(fn);
      dataBucket.grantReadWrite(fn);
    }
    worker.grantInvoke(api);
    // Gestion des utilisateurs depuis le hub : invitation, renvoi, désactivation, nom affiché.
    userPool.grant(
      api,
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminUserGlobalSignOut',
      'cognito-idp:AdminUpdateUserAttributes',
    );
    // Le worker pour les tâches IA asynchrones, l'API pour l'assistant Gandalf (appel synchrone).
    for (const fn of [api, worker]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: 'InvokeClaudeOnBedrock',
          actions: ['bedrock-mantle:CreateInference', 'bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
        }),
      );
    }

    // Demandes de validation de CDC : e-mails envoyés par l'API, depuis l'expéditeur vérifié dans SES.
    if (props.mailFrom) {
      api.addToRolePolicy(
        new iam.PolicyStatement({
          sid: 'SendMailWithSes',
          actions: ['ses:SendEmail'],
          resources: ['*'],
          conditions: { StringEquals: { 'ses:FromAddress': props.mailFrom } },
        }),
      );
    }

    // ---- API HTTP (authentifiée par Cognito) -----------------------------------------
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'hub-it-api',
      defaultAuthorizer: new HttpUserPoolAuthorizer('Cognito', userPool, { userPoolClients: [userPoolClient] }),
    });
    const apiIntegration = new HttpLambdaIntegration('ApiIntegration', api);
    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigw.HttpMethod.ANY],
      integration: apiIntegration,
    });
    // Seule exception à la connexion : la page du lien de validation d'un CDC, reçu par e-mail (protégée par son jeton).
    httpApi.addRoutes({
      path: '/api/public/{proxy+}',
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST],
      integration: apiIntegration,
      authorizer: new apigw.HttpNoneAuthorizer(),
    });
    const stage = httpApi.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingBurstLimit: 50, throttlingRateLimit: 20 };

    // ---- Front (S3 + CloudFront) ---------------------------------------------------------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // Application monopage : toute URL sans extension renvoie index.html.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (!r.uri.includes('.') ) { r.uri = '/index.html'; } return r; }",
      ),
    });
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Hobbit',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        responseHeadersPolicy: securityHeaders,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(`${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`, {
            readTimeout: Duration.seconds(30),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },
    });

    // Envoi direct des images et des pièces jointes depuis le navigateur (URL pré-signées).
    dataBucket.addCorsRule({
      allowedOrigins: [`https://${distribution.distributionDomainName}`],
      allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
      allowedHeaders: ['content-type'],
      maxAge: 3600,
    });

    const webDist = join(root, 'apps/web/dist');
    if (!existsSync(join(webDist, 'index.html'))) {
      throw new Error(`Front non construit : lancez « pnpm --filter @samm/web build » avant le déploiement (${webDist} introuvable).`);
    }
    const deployWeb = new s3deploy.BucketDeployment(this, 'DeployWeb', {
      destinationBucket: siteBucket,
      sources: [
        s3deploy.Source.asset(webDist),
        s3deploy.Source.jsonData('config.json', {
          authMode: 'cognito',
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
        }),
      ],
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    // ---- Annonce de la mise en production sur Teams -------------------------------------------
    // Les dernières entrées du patch note (construit avec le front) sont transmises au worker une fois le front en
    // ligne ; il publie celles qui n'ont pas encore été annoncées (`apps/api/src/notifications/release.ts`).
    // La ressource n'est rejouée que si le patch note change, donc à chaque nouvelle version.
    const release = readReleaseNotes(webDist);
    if (release.length) {
      const invoke: cr.AwsSdkCall = {
        service: 'Lambda',
        action: 'invoke',
        parameters: { FunctionName: worker.functionName, InvocationType: 'Event', Payload: JSON.stringify({ release }) },
        physicalResourceId: cr.PhysicalResourceId.of('annonce-mise-en-production'),
        outputPaths: ['StatusCode'],
      };
      const announce = new cr.AwsCustomResource(this, 'AnnounceRelease', {
        onCreate: invoke,
        onUpdate: invoke,
        policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [worker.functionArn] })]),
        installLatestAwsSdk: false,
        logGroup: new logs.LogGroup(this, 'AnnounceReleaseLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
      });
      announce.node.addDependency(deployWeb);
    }

    new CfnOutput(this, 'Url', { value: `https://${distribution.distributionDomainName}`, description: 'Adresse de Hobbit' });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'DataBucketName', { value: dataBucket.bucketName });
  }
}

/** Entrées transmises à chaque déploiement (les plus récentes) ; type `ReleaseNote` de `packages/shared/src/notifications.ts`. */
const RELEASE_NOTES_SENT = 10;

/** Patch note du front construit (`patch-notes.json`, voir `apps/web/patch-notes.ts`), réduit à ce que l'annonce Teams affiche. */
function readReleaseNotes(webDist: string) {
  const file = join(webDist, 'patch-notes.json');
  if (!existsSync(file)) return [];
  const notes = JSON.parse(readFileSync(file, 'utf8')) as { id: string; date: string; title: string; pr: number | null; changes: { title: string }[] }[];
  return notes.slice(0, RELEASE_NOTES_SENT).map((n) => ({
    id: n.id,
    date: n.date,
    title: n.title.slice(0, 300),
    pr: n.pr,
    changes: n.changes.slice(0, 10).map((c) => c.title.slice(0, 200)),
  }));
}
