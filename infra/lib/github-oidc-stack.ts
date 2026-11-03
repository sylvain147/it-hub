import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcStackProps extends StackProps {
  /** « organisation/dépôt » GitHub autorisé à déployer. */
  repository: string;
  branch: string;
}

/**
 * Rôle assumé par GitHub Actions (OIDC, sans clé d'accès stockée) pour déployer le hub.
 * Il ne peut qu'assumer les rôles créés par `cdk bootstrap`, et seulement depuis la branche indiquée.
 * À déployer une seule fois, à la main : `pnpm cdk deploy HubItGithubOidc`.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);
    const provider = new iam.OpenIdConnectProvider(this, 'GithubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'hub-it-github-deploy',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${props.repository}:ref:refs/heads/${props.branch}` },
      }),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );
    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn, description: 'À renseigner dans la variable GitHub AWS_DEPLOY_ROLE_ARN' });
  }
}
