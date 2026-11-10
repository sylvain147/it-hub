# Déploiement sur AWS

Tout est décrit en code (AWS CDK, dossier `infra/`). Une stack principale, `HubIt`, et une stack optionnelle, `HubItGithubOidc`, pour le déploiement automatique depuis GitHub.

## 1. Prérequis

- Un compte AWS et l'AWS CLI configurée (`aws sts get-caller-identity` doit répondre).
- Node 22+ et pnpm (`corepack enable`).
- **Accès aux modèles Claude sur Bedrock** (inutile tant que `llmProvider` vaut `mock`) : console AWS → Amazon Bedrock → *Model access* → activer **Claude Haiku 5.5** et **Claude Sonnet 5.5** dans la région utilisée.

## 2. Paramètres

Dans `infra/cdk.json` (section `context`) :

| Clé | Défaut | Rôle |
|---|---|---|
| `region` | `eu-west-3` (Paris) | Région de l'application |
| `llmProvider` | `mock` | `mock` : IA simulée (aucun appel Bedrock, coût nul, textes marqués « simulation ») ; `bedrock` : vrais appels. Passer à `bedrock` puis redéployer une fois l'accès aux modèles activé |
| `bedrockRegion` | `eu-west-3` | Région d'appel de Bedrock |
| `modelFast` / `modelSmart` | `anthropic.claude-haiku-5-5` / `anthropic.claude-sonnet-5-5` | Modèles utilisés |
| `monthlyBudgetUsd` | `30` | Plafond mensuel des fonctions IA (en $) |

> ⚠️ **Confidentialité, à vérifier avant la mise en production.** Bedrock propose un routage *global* (requêtes traitées dans n'importe quelle région, sans surcoût) et un routage *régional / UE* (données traitées en Europe, environ +10 %). Vérifiez dans la console Bedrock quel routage s'applique à `bedrockRegion` pour vos modèles et choisissez une configuration qui garde les données dans l'UE si votre politique interne l'exige. Les tarifs Bedrock peuvent aussi différer des tarifs publics utilisés par le tableau de consommation : ajustez au besoin la variable `PRICING_JSON` des Lambdas.

## 3. Premier déploiement (depuis un poste)

```bash
pnpm install
pnpm build                                          # le front doit être construit avant toute commande CDK (même le bootstrap)
pnpm --filter @samm/infra exec cdk bootstrap        # une seule fois par compte/région
pnpm run deploy                                     # construit le front puis déploie la stack HubIt
```

En fin de déploiement, la sortie `HubIt.Url` donne l'adresse de l'application (`https://xxxx.cloudfront.net`).

## 4. Créer les comptes utilisateurs

Il n'y a pas d'inscription libre. Les comptes se gèrent **depuis le hub** (menu **Utilisateurs**, réservé aux administrateurs) : ajouter un utilisateur crée son compte de connexion et lui envoie l'invitation ; on y change aussi son rôle, on le désactive (sa connexion est bloquée et ses sessions fermées) et on renvoie l'invitation.

**Premier administrateur** : seul le tout premier compte doit être créé à la main. La première personne qui se connecte au hub en devient administrateur.

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <HubIt.UserPoolId> \
  --username prenom.nom@entreprise.fr \
  --user-attributes Name=email,Value=prenom.nom@entreprise.fr Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

L'utilisateur reçoit un mot de passe temporaire par e-mail. À la première connexion il choisit son mot de passe, puis **scanne le QR code avec Google Authenticator** (ou toute application TOTP). Le code à 6 chiffres est ensuite demandé à chaque connexion. « Mot de passe oublié ? » envoie un code par e-mail.

Un compte créé directement dans Cognito (hors du hub) est ajouté à l'annuaire comme **chargé de projet** à sa première connexion.
Réinitialiser le MFA d'un utilisateur qui a perdu son téléphone : supprimer son compte dans Cognito (`aws cognito-idp admin-delete-user …`) puis le recréer avec la même adresse ; sa fiche, son rôle et ses tâches dans le hub sont conservés.

> Les e-mails d'invitation partent de l'expéditeur Cognito par défaut (limité à 50 e-mails/jour, largement suffisant pour 4 personnes).

## 5. Déploiement automatique depuis GitHub (recommandé)

Une fois en place, chaque push sur `main` est testé puis déployé, sans clé AWS stockée dans GitHub (OIDC).

1. Déployer le rôle de déploiement (une fois) :
   ```bash
   pnpm --filter @samm/infra exec cdk deploy HubItGithubOidc
   ```
   Le rôle ne peut être assumé que depuis la branche `main` du dépôt `sylvain147/it-hub` (modifiable dans `cdk.json`).
2. Dans GitHub → *Settings* → *Environments*, créer l'environnement `production` (on peut y exiger une validation manuelle).
3. Dans *Settings* → *Secrets and variables* → *Actions* → *Variables*, créer :
   - `AWS_DEPLOY_ROLE_ARN` = sortie `HubItGithubOidc.DeployRoleArn`
   - `AWS_REGION` = `eu-west-3`

Le **patch note** est construit au build du front à partir de l'historique git : le workflow doit cloner tout l'historique (`actions/checkout` avec `fetch-depth: 0`), sinon il ne montre que la dernière mise à jour.

Le workflow `CI` vérifie chaque pull request (types, tests, build, synthèse CDK) ; le workflow `Déploiement` reste inactif tant que `AWS_DEPLOY_ROLE_ARN` n'est pas renseigné.

## 6. Exploitation

- **Journaux** : CloudWatch Logs, groupes `HubIt-ApiLogs…` et `HubIt-WorkerLogs…` (conservés 3 mois).
- **Sauvegardes** : la table DynamoDB a la restauration à un instant donné (35 jours) ; le bucket de données est versionné (anciennes versions conservées 90 jours). Table et bucket sont conservés même si la stack est supprimée.
- **Coût de l'infrastructure hors IA** : quelques euros par mois pour 4 utilisateurs (tout est facturé à l'usage : Lambda, DynamoDB à la demande, S3, CloudFront).
- **Nom de domaine** : non configuré pour l'instant (adresse CloudFront). Pour un domaine du type `hub.entreprise.fr`, il faudra un certificat ACM en `us-east-1` et un alias sur la distribution CloudFront, puis ajouter le domaine à la règle CORS du bucket de données.
