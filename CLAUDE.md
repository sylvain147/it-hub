# CLAUDE.md

Hub interne de l'équipe IT (4 utilisateurs, chargés de projet, non développeurs). Modules : to-do (tâches à cocher, rattachées ou non à un projet, séparées des tickets), notes (bloc-notes personnel), planning (frise des jalons de tous les projets), projets (suivi complet d'un projet, dont ses tickets ; les cahiers des charges — CDC — se rédigent depuis un projet), sprints (planification des tickets, tableau du sprint en cours, documents de sprint), lecteur de fichiers (fichiers à plat / CSV décrits par des « fiches de lecture » créées par l'IA) et suivi TMA (tickets Desk + relevé mensuel du prestataire). Toute l'interface, les messages d'erreur et les commentaires sont **en français**.

Voir `README.md` (fonctionnalités), `docs/ARCHITECTURE.md` (conception) et `docs/DEPLOIEMENT.md` (AWS).

## Commandes

```bash
pnpm install
pnpm dev             # API :3001 (DynamoDB émulé, enregistré dans apps/api/.data ; IA simulée) + front :5173
pnpm test            # vitest (shared + parcours complet de l'API contre dynalite)
pnpm typecheck
pnpm synth           # synthèse CDK (empaquette aussi les Lambdas) — nécessite apps/web/dist
pnpm export:exemple /tmp   # Word + PDF d'exemple pour contrôler la mise en page
```

## Organisation

- `packages/shared` : types et schémas zod du domaine (`cdc.ts`, `project.ts` pour les projets et leurs éléments rattachés + `computeStats`), corps des requêtes (`api.ts`), conversion Markdown ⇄ JSON TipTap (`markdown.ts`), et pour le lecteur de fichiers `files/` (fiche `spec.ts`, moteur `parse.ts`, extrait anonymisé `excerpt.ts`, lecture/écriture Excel `xlsx.ts`). Importé en TypeScript source par l'API et le front.
- `apps/api` : Hono. `app.ts` (routes), `db/repo.ts` (tout l'accès DynamoDB/S3), `ai/` (prompts, schémas de sortie, pipeline, fournisseurs Bedrock et simulé), `jobs/runner.ts` (tâches IA asynchrones), `export/` (Word via `docx`, PDF via `pdfmake`). Points d'entrée : `lambda.ts`, `worker.ts`, `local.ts`.
- `apps/api/src/filetypes/` : module lecteur de fichiers (routes, stockage, pipeline IA, jobs).
- `packages/shared/src/tma/` et `apps/api/src/tma/` : module suivi TMA (lecture et masquage des exports, calcul des rapports ; stockage, classement par thème et synthèse IA). Front : `apps/web/src/tma/`.
- `apps/api/src/projects/` : module projets (routes génériques par type d'élément, stockage `PROJ#…` — les tickets sont les éléments `tasks` —, IA : analyse de réunion, rapport d'avancement, contexte projet pour la génération de CDC).
- `packages/shared/src/sprints/` et `apps/api/src/sprints/` : module sprints (sprints `SPRINT`, démarrage, clôture ; revue `report.ts` et préparation `preparation.ts` d'un sprint, documents IA). Front : `apps/web/src/sprints/` (page `/sprints` : tableau, planification, backlog ; page d'un sprint ; composants de ticket `tickets.tsx`).
- `packages/shared/src/users.ts`, `apps/api/src/users/` et `apps/web/src/users/` : utilisateurs, rôles et droits, to-do (page « To-do » `/todo`, onglet « To-do et notes » d'un projet `projects/TodoTab.tsx`). Composants de la to-do (liste à cocher, fiche, choix du projet) : `apps/web/src/tasks/tasks.tsx`.
- `packages/shared/src/notes.ts`, `apps/api/src/notes/routes.ts` et `apps/web/src/notes/` : notes en vrac personnelles (page `/notes`). Frise globale des jalons : `GET /api/projects/jalons`, `apps/web/src/projects/GlobalPlanningPage.tsx` (page `/planning`). Connexion : `apps/web/src/auth.tsx` + `auth/LoginPage.tsx`.
- `packages/shared/src/feedback.ts`, `apps/api/src/feedback/` et `apps/web/src/feedback/` : retours sur l'application (bouton « Faire un retour » du menu, page « Retours » réservée au droit `manageFeedback`).
- `packages/shared/src/bouton.ts`, `apps/api/src/bouton/routes.ts` et `apps/web/src/bouton/BoutonRouge.tsx` : petit jeu caché du bouton rouge « NE PAS CLIQUER » (apparition au hasard, compteur de clics par utilisateur ; `?bouton-rouge` le force).
- `apps/web` : React + Vite + TipTap. `projects/` contient la liste et la page projet (un fichier par onglet, contexte partagé dans `common.tsx`), `cdc/CdcEditorPage.tsx` l'éditeur de CDC, `files/` le lecteur de fichiers ; `modules.ts` liste les modules du hub.
- `infra` : CDK. `lib/hub-stack.ts` (tout le hub), `lib/github-oidc-stack.ts` (rôle de déploiement GitHub).

## Règles à respecter

- **Coûts IA** : tout appel passe par `callStructured` (suivi + budget). Jamais d'appel IA automatique : uniquement sur action explicite. Envoyer au modèle le strict nécessaire (sections utiles, Markdown plutôt que JSON) ; modèle rapide (`fast`) pour le volumineux et le mécanique, `smart` pour la rédaction. Garder les prompts système sans données variables (cache de prompt).
- Bedrock est appelé via `AnthropicBedrockMantle` (`@anthropic-ai/bedrock-sdk`) avec sorties structurées (`messages.parse` + `zodOutputFormat`). Pas de `tool_choice` forcé, pas de `budget_tokens`, pas de prefill (refusés par les modèles actuels) : régler `output_config.effort`.
- Le document : `contexte` unique et en premier, `annexes` unique et en dernier (`normalizeSections`, `cdcDocumentSchema`). L'IA ne peut ni supprimer une section ni toucher une section qu'on ne lui a pas montrée (`applyUpdate`).
- Versions immuables ; tout enregistrement passe par `repo.saveVersion` avec `baseSeq` (verrouillage optimiste). Pas d'enregistrement pendant un job actif.
- Lecteur de fichiers : les fichiers des utilisateurs sont lus **dans le navigateur** et ne doivent jamais être envoyés au serveur. Seul l'extrait (anonymisé par défaut, `anonymizeLine`) et la documentation partent à l'IA. L'IA produit une fiche déclarative (`fileSpecSchema`), jamais du code ; ses sorties passent par `sanitizeSpec`/`applyPatch`. Les jobs IA ciblent un élément via `targetId` (CDC ou type de fichier).
- Projets : un CDC est rattaché par `projectId` (fiche CDC, hors document versionné) et se crée via `POST /api/projects/:id/cdcs`. Les propositions de l'assistant (tickets, jalons, risques d'un compte rendu) ne sont jamais ajoutées sans validation explicite. Les champs texte des projets sont en Markdown (`MarkdownField` / `MarkdownView` côté front).
- Paramétrage (`settings.ts`, `apps/api/src/settings/`, `apps/web/src/settings/`) : afficher les statuts via `useSettings()` / `StatusOptions` (front) ou `getLists()` (API), jamais via les constantes `*_STATUS_LABELS`. Les codes de statut ne changent pas. Une prestation doit référencer un prestataire du paramétrage (`resolveProjectRefs`) ; toute nouvelle copie d'une donnée du référentiel doit être tenue à jour par `syncItems`.
- Suivi TMA : exports Desk et relevés lus **dans le navigateur** ; seuls les champs utiles partent au serveur, textes passés par `maskPersonalData`. Les chiffres sont calculés par le code (`report.ts`) ; l'IA ne reçoit que des agrégats pour la synthèse, et chaque ticket n'est classé qu'une fois. Ne jamais committer de vrais exports (données personnelles) : fixtures fictives dans `packages/shared/test/fixtures/tma.ts`.
- To-do : une tâche se coche (`done`), pas de statut, de priorité ni de sprint ; son ordre (glisser-déposer) est le rang `position`, modifié seulement par `PUT /api/todos/ordre` ; elle se rattache ou non à un projet (`projectId`) et **ne crée jamais de ticket** : to-do et tickets sont deux choses séparées. La to-do d'un projet est partagée par l'équipe. Les tickets, eux, ont un statut : lire leurs anciens enregistrements (tâches à cocher) via `normalizeTaskRecord`.
- Notes : personnelles (partition `NOTE#<e-mail>` du titulaire) ; seuls les administrateurs (droit `manageAllNotes`) lisent celles des autres et leur en ajoutent (`?user=`, `ownerId`, `?owner=`). Une note s'archive (`archived`) au lieu d'être supprimée. Supprimer un projet détache ses tâches de to-do et ses notes.
- Jalons : ponctuels (`date`) ou sur une période (`startDate` → `date`) ; retard et glissement se mesurent sur `date`. Utilisateurs : poste, backup (autre utilisateur actif), périmètres (`PERIMETERS`).
- Sprints : un ticket appartient à un projet (élément `tasks`) ou est hors projet (`NO_PROJECT_ID`, sans fiche : pas d'activité ni d'indicateurs) ; changer son projet passe par `projectId` dans le `PATCH` (`moveTicket`, numéro et historique conservés) ; il se rattache au ticket Desk du prestataire par `deskId` (comparer avec `deskKey`), a un numéro (`T-12`), une priorité (`PRIORITIES`, tri `byTicketPriority`), un statut (`TICKET_STATUSES`) et un sprint (`sprintId`, null = backlog). Le serveur tient l'historique (`statusChanges`, `sprintChanges`) dont dépend la revue de sprint : ne changer le statut ou le sprint d'un ticket que par `pr.createItem` / `pr.updateItem`. Un seul sprint en cours ; on ne planifie que dans un sprint en cours ou à venir (`assertPlannable`). Chiffres calculés par `buildSprintReport` / `buildSprintPreparation` ; l'IA ne reçoit que `sprintReportToMarkdown` / `sprintPreparationToMarkdown` (pas les descriptions).
- Utilisateurs : tester un droit (`can`, `requirePermission`, `me.permissions` côté front), jamais un rôle. Les tickets portent `assigneeId` (utilisateur) et le nom recopié `assignee` : passer par `resolveTaskAssignee` pour toute création ou modification. Garder au moins un administrateur actif.
- Images : uniquement PNG/JPEG (formats communs Word + PDF), référencées `asset:<cdcId>/<assetId>`.
- Les tests de l'API (`apps/api/test/cdc.test.ts`, `filetypes.test.ts`, `projects.test.ts`, `settings.test.ts`, `tma.test.ts`, `sprints.test.ts`, `users.test.ts`, `notes.test.ts`, `feedback.test.ts`, `bouton.test.ts`) et du moteur de lecture (`packages/shared/test/files.test.ts`, `tma.test.ts`, `sprints.test.ts`, fichier de démonstration `fixtures/demo.ww`) couvrent les parcours complets : les compléter à chaque évolution.

## Pièges connus

- Lambdas empaquetées en **CommonJS** : pdfkit (sous pdfmake) charge ses polices via des imports `#standard-fonts/*` dynamiques ; `hub-stack.ts` copie ces modules à côté du bundle (`commandHooks.afterBundling`). Ne pas passer en ESM sans revoir ce point (pdfkit utilise aussi `__filename`).
- En local, dynalite enregistre la base sur disque (`apps/api/.data/dynamodb`, avec les fichiers dans `apps/api/.data`) ; `LOCAL_DB=memoire` pour une base vide à chaque démarrage. Un seul processus API à la fois (verrou LevelDB). Les tests utilisent toujours une base en mémoire.
- Mesurer les performances du moteur de lecture sur un bundle (esbuild/Vite), pas via `tsx` : `tsx` est 4 à 5 fois plus lent.
- `RichEditor` : n'émettre `onChange` que si `transaction.docChanged` (sinon `setEditable` marque le document comme modifié).
- Responsive : sous 900 px le menu devient un tiroir (`Layout.tsx`), sous 640 px les tableaux `.table-wrap` passent en cartes (libellés posés automatiquement par `useResponsiveTables` ; ajouter `table-scroll` pour garder un tableau défilant) et les modales s'ouvrent en bas d'écran.
- Le front charge `/config.json` (généré au déploiement) ; en local, son absence active le mode `dev` (pas de Cognito : page de connexion sans mot de passe, en-tête `x-dev-user`). Les tests de l'API créent l'annuaire à la volée : le premier utilisateur d'un fichier de test est administrateur.
