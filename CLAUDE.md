# CLAUDE.md

Hub interne de l'équipe IT (4 utilisateurs, chargés de projet, non développeurs). Modules : projets (suivi complet d'un projet ; les cahiers des charges — CDC — se rédigent depuis un projet) et lecteur de fichiers (fichiers à plat / CSV décrits par des « fiches de lecture » créées par l'IA). Toute l'interface, les messages d'erreur et les commentaires sont **en français**.

Voir `README.md` (fonctionnalités), `docs/ARCHITECTURE.md` (conception) et `docs/DEPLOIEMENT.md` (AWS).

## Commandes

```bash
pnpm install
pnpm dev             # API :3001 (DynamoDB émulé en mémoire, IA simulée) + front :5173
pnpm test            # vitest (shared + parcours complet de l'API contre dynalite)
pnpm typecheck
pnpm synth           # synthèse CDK (empaquette aussi les Lambdas) — nécessite apps/web/dist
pnpm export:exemple /tmp   # Word + PDF d'exemple pour contrôler la mise en page
```

## Organisation

- `packages/shared` : types et schémas zod du domaine (`cdc.ts`, `project.ts` pour les projets et leurs éléments rattachés + `computeStats`), corps des requêtes (`api.ts`), conversion Markdown ⇄ JSON TipTap (`markdown.ts`), et pour le lecteur de fichiers `files/` (fiche `spec.ts`, moteur `parse.ts`, extrait anonymisé `excerpt.ts`, lecture/écriture Excel `xlsx.ts`). Importé en TypeScript source par l'API et le front.
- `apps/api` : Hono. `app.ts` (routes), `db/repo.ts` (tout l'accès DynamoDB/S3), `ai/` (prompts, schémas de sortie, pipeline, fournisseurs Bedrock et simulé), `jobs/runner.ts` (tâches IA asynchrones), `export/` (Word via `docx`, PDF via `pdfmake`). Points d'entrée : `lambda.ts`, `worker.ts`, `local.ts`.
- `apps/api/src/filetypes/` : module lecteur de fichiers (routes, stockage, pipeline IA, jobs).
- `apps/api/src/projects/` : module projets (routes génériques par type d'élément, stockage `PROJ#…`, IA : analyse de réunion, rapport d'avancement, contexte projet pour la génération de CDC).
- `apps/web` : React + Vite + TipTap. `projects/` contient la liste et la page projet (un fichier par onglet, contexte partagé dans `common.tsx`), `cdc/CdcEditorPage.tsx` l'éditeur de CDC, `files/` le lecteur de fichiers ; `modules.ts` liste les modules du hub.
- `infra` : CDK. `lib/hub-stack.ts` (tout le hub), `lib/github-oidc-stack.ts` (rôle de déploiement GitHub).

## Règles à respecter

- **Coûts IA** : tout appel passe par `callStructured` (suivi + budget). Jamais d'appel IA automatique : uniquement sur action explicite. Envoyer au modèle le strict nécessaire (sections utiles, Markdown plutôt que JSON) ; modèle rapide (`fast`) pour le volumineux et le mécanique, `smart` pour la rédaction. Garder les prompts système sans données variables (cache de prompt).
- Bedrock est appelé via `AnthropicBedrockMantle` (`@anthropic-ai/bedrock-sdk`) avec sorties structurées (`messages.parse` + `zodOutputFormat`). Pas de `tool_choice` forcé, pas de `budget_tokens`, pas de prefill (refusés par les modèles actuels) : régler `output_config.effort`.
- Le document : `contexte` unique et en premier, `annexes` unique et en dernier (`normalizeSections`, `cdcDocumentSchema`). L'IA ne peut ni supprimer une section ni toucher une section qu'on ne lui a pas montrée (`applyUpdate`).
- Versions immuables ; tout enregistrement passe par `repo.saveVersion` avec `baseSeq` (verrouillage optimiste). Pas d'enregistrement pendant un job actif.
- Lecteur de fichiers : les fichiers des utilisateurs sont lus **dans le navigateur** et ne doivent jamais être envoyés au serveur. Seul l'extrait (anonymisé par défaut, `anonymizeLine`) et la documentation partent à l'IA. L'IA produit une fiche déclarative (`fileSpecSchema`), jamais du code ; ses sorties passent par `sanitizeSpec`/`applyPatch`. Les jobs IA ciblent un élément via `targetId` (CDC ou type de fichier).
- Projets : un CDC est rattaché par `projectId` (fiche CDC, hors document versionné) et se crée via `POST /api/projects/:id/cdcs`. Les propositions de l'assistant (tâches, jalons, risques d'un compte rendu) ne sont jamais ajoutées sans validation explicite. Les champs texte des projets sont en Markdown (`MarkdownField` / `MarkdownView` côté front).
- Images : uniquement PNG/JPEG (formats communs Word + PDF), référencées `asset:<cdcId>/<assetId>`.
- Les tests de l'API (`apps/api/test/cdc.test.ts`, `filetypes.test.ts`, `projects.test.ts`) et du moteur de lecture (`packages/shared/test/files.test.ts`, fichier de démonstration `fixtures/demo.ww`) couvrent les parcours complets : les compléter à chaque évolution.

## Pièges connus

- Lambdas empaquetées en **CommonJS** : pdfkit (sous pdfmake) charge ses polices via des imports `#standard-fonts/*` dynamiques ; `hub-stack.ts` copie ces modules à côté du bundle (`commandHooks.afterBundling`). Ne pas passer en ESM sans revoir ce point (pdfkit utilise aussi `__filename`).
- En local, dynalite tourne en mémoire : les données disparaissent au redémarrage de l'API (les fichiers restent dans `apps/api/.data`).
- Mesurer les performances du moteur de lecture sur un bundle (esbuild/Vite), pas via `tsx` : `tsx` est 4 à 5 fois plus lent.
- `RichEditor` : n'émettre `onChange` que si `transaction.docChanged` (sinon `setEditable` marque le document comme modifié).
- Le front charge `/config.json` (généré au déploiement) ; en local, son absence active le mode `dev` (pas de Cognito, en-tête `x-dev-user`).
