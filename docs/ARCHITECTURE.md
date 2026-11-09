# Architecture

```
Navigateur ──HTTPS──> CloudFront ─┬─ /*      → S3 (front React)
                                  └─ /api/*  → API Gateway HTTP ──(jeton Cognito vérifié)──> Lambda « API »
                                                                                              │  invocation asynchrone
                                                                                              ▼
                                                                                         Lambda « worker » ──> Bedrock (Claude)
             DynamoDB (projets, fiches, versions, questions, jobs, conso) · S3 (contenus des versions, transcriptions, images, pièces jointes, exports)
```

- **100 % serverless** : rien ne tourne (ni ne coûte) quand personne n'utilise l'application.
- **Authentification** : Cognito, sans inscription libre, **MFA TOTP obligatoire**. L'API Gateway refuse toute requête sans jeton valide.
- **Tâches IA asynchrones** : une génération peut dépasser la limite de 30 s d'API Gateway. L'API crée un *job*, réserve le CDC (une seule tâche à la fois par CDC) et invoque le worker ; le navigateur suit l'avancement. L'édition est suspendue pendant la tâche.
- **Images** : stockées dans le bucket privé, envoyées directement par le navigateur (URL pré-signée), référencées dans les documents par `asset:<cdc>/<id>` et affichées via des URL temporaires.

## Modèle de données (DynamoDB, table unique)

| pk | sk | Contenu |
|---|---|---|
| `CDC#<id>` | `META` | Fiche : métadonnées, projet de rattachement, version courante, job actif (index `gsi1` pour la liste) |
| `CDC#<id>` | `VER#<seq>` | Version : numéro (0.3, 1.0…), origine (manuel / IA / restauration), auteur, commentaire ; contenu JSON dans S3 |
| `CDC#<id>` | `Q#<id>` | Question de l'assistant : priorité, section, statut (ouverte / répondue / intégrée / ignorée), réponse |
| `CDC#<id>` | `SRC#<id>` | Transcription : notes extraites ; texte brut dans S3 |
| `CDC#<id>` | `TR#<lang>` | Traduction (version source) ; contenu dans S3 |
| `JOB#<id>` | `JOB` | Tâche IA (expire après 30 jours) |
| `TRC#<hash>` | `TRC` | Cache de traduction par paragraphe |
| `USAGE#<mois>` | `TOTAL`, `OP#…`, `MODEL#…`, `USER#…`, `CALL#…` | Consommation IA |

**Versions** : chaque enregistrement est une nouvelle version immuable. Verrouillage optimiste : on enregistre « par-dessus » une version précise ; si quelqu'un a enregistré entre-temps, l'API renvoie un conflit au lieu d'écraser son travail.

## Document

Un CDC = des métadonnées + une liste de sections. Chaque section a un type : `contexte` (une seule, toujours en premier), `standard` (libres) ou `annexes` (une au plus, en dernier). Le contenu des sections est au format de l'éditeur (ProseMirror/TipTap JSON).

L'IA ne manipule jamais ce JSON : elle lit et écrit du **Markdown** (3 à 5 fois moins de tokens), converti dans les deux sens par `packages/shared/src/markdown.ts`.

## Pipeline IA (`apps/api/src/ai/`)

| Étape | Modèle | Entrée | Sortie (structurée, validée par schéma) |
|---|---|---|---|
| Tri d'une transcription | Haiku, effort faible | transcription brute | notes Markdown par rubrique, métadonnées détectées |
| Rédaction initiale | Sonnet, effort moyen | notes + métadonnées connues | métadonnées, sections, questions |
| Mise à jour (nouvelle réunion, réponses, retravail) | Sonnet, effort moyen | plan du document + **uniquement les sections utiles** + nouvelles infos | **uniquement les sections modifiées**, questions nouvelles / résolues |
| Traduction | Haiku, effort faible | paragraphes absents du cache | paragraphes traduits |

Garde-fous : le modèle ne peut modifier que les sections qui lui ont été montrées, ne peut pas en supprimer, et une image présente avant une mise à jour ne peut pas disparaître.

En local et dans les tests, un fournisseur **simulé** remplace Bedrock (`LLM_PROVIDER=mock`).

## Module « Lecteur de fichiers »

- **Fiche de lecture** (`packages/shared/src/files/spec.ts`) : description déclarative d'un format (positions fixes ou délimité, types de ligne reconnus par des règles « zone = valeur », champs typés, rattachement parent/enfant, contrôles). L'IA ne produit jamais de code exécutable.
- **Moteur de lecture** (`packages/shared/src/files/parse.ts`) : exécuté **dans le navigateur** pour les fichiers des utilisateurs (rien n'est envoyé au serveur) et côté serveur pour produire un **diagnostic** de la fiche sur l'extrait (lignes non reconnues, valeurs illisibles, premier enregistrement de chaque type décodé champ par champ). Ce diagnostic guide l'IA dans ses corrections.
- **Création d'un type** (`apps/api/src/filetypes/pipeline.ts`) :
  1. s'il y a de la documentation (spec Excel convertie en texte dans le navigateur, code source) : le modèle rapide en tire une fiche complète ;
  2. le modèle de rédaction confronte la fiche à l'extrait et renvoie un **correctif** (seuls les types de ligne à corriger) ;
  3. une passe d'auto-correction au plus si des anomalies subsistent.
- **Ajustements** : consigne en français + lignes en anomalie du fichier de test (anonymisées) → correctif → nouvelle version. La documentation (≤ 80 000 caractères) est envoyée comme bloc système mis en cache.

| pk | sk | Contenu |
|---|---|---|
| `FTYPE#<id>` | `META` | Type de fichier : nom, version courante, remarques de l'IA (index `gsi1`) |
| `FTYPE#<id>` | `VER#<seq>` | Version de la fiche ; contenu JSON dans S3 |
| (S3) `ftypes/<id>/context.json` | | Extrait (anonymisé), documentation en texte |

## Paramétrage

- **Modèle** (`packages/shared/src/settings.ts`) : les statuts gardent leur code (qui porte le comportement) ; le paramétrage ne change que libellé, ordre et visibilité (`normalizeListSettings` complète et assainit, les statuts verrouillés restent visibles). Le front lit les libellés via `useSettings()` (`apps/web/src/settings/context.tsx`), l'API via `getLists()` (cache de 10 s) pour l'historique et les données envoyées à l'IA.
- **Prestataires** : une prestation porte `prestataireId` et une copie du nom ; un intervenant lié porte `directoryContactId` et une copie des coordonnées. `resolveProjectRefs` (`apps/api/src/settings/routes.ts`) impose le référentiel et recopie les valeurs à chaque enregistrement ; renommage, modification d'un contact et fusion se répercutent dans tous les projets (`syncItems`). Les copies gardent les calculs, l'IA et les exports inchangés.

| pk | sk | Contenu |
|---|---|---|
| `REF#LISTS` | `LISTS` | Libellés, ordre et visibilité des statuts ; libellés de jalons et rôles proposés |
| `REF#PRESTA` | `P#<id>` | Prestataire et son carnet de contacts |

## Module « Suivi TMA »

- **Lecture des fichiers dans le navigateur** (`packages/shared/src/tma/`) : export Desk (`desk.ts`, CSV avec retours à la ligne dans les champs), relevé TMA (`activity.ts`, via `readXlsx`), masquage des données personnelles (`mask.ts`). Seuls les champs utiles, masqués, partent au serveur.
- **Rapports calculés par le code** (`report.ts`), partagés entre l'API et les tests : temps par ticket / intervenant / thème, tickets créés, comparaison avec le mois précédent, récurrences par thème.
- **IA** (`apps/api/src/tma/jobs.ts`) : classement par thème (modèle rapide, lots de 40, seulement les tickets non classés ; les thèmes existants sont fournis pour rester cohérents) et synthèse mensuelle (modèle de rédaction, entrée = chiffres du mois en Markdown, quelques Ko).

| pk | sk | Contenu |
|---|---|---|
| `TMA#DESK` | `META` | Dernier import Desk, job de classement actif |
| `TMA#DESK` | `TKT#<n°>` | Ticket Desk (champs utiles, textes masqués, thème) |
| `TMA#MONTH#<AAAA-MM>` | `META` | Relevé du mois (+ index `gsi1`), synthèse IA ; lignes dans S3 (`tma/months/<mois>.json`) |

## Module « Projets »

- **Modèle** (`packages/shared/src/project.ts`) : la fiche (`projectFieldsSchema`) et huit types d'éléments rattachés (`PROJECT_ITEM_SCHEMAS` : tickets, jalons, prestations, intervenants, liens, documents, notes du journal, risques), chacun avec son schéma zod. Les indicateurs (`computeStats` : tickets ouverts / en retard, prochain jalon, budget prévu / engagé, risques…) sont recalculés côté serveur après chaque modification et stockés sur la fiche pour la liste.
- **API** (`apps/api/src/projects/`) : routes génériques `POST/PATCH/DELETE /api/projects/:id/items/:kind[/:itemId]` (PATCH partiel, revalidé entièrement), fiche avec verrouillage optimiste (`rev`), pièces jointes par URL pré-signée (création → envoi direct depuis le navigateur → confirmation), vues transverses `/api/tasks/open` et `/api/activity`. Chaque modification alimente l'historique.
- **Cahiers des charges** : un CDC porte un `projectId` (attribut de la fiche, hors document versionné). `POST /api/projects/:id/cdcs` crée le CDC pré-rempli (projet, prestataire et charge de la prestation, jalons non atteints, phase déduite du statut) et, si demandé, lance la génération avec un **contexte projet** en Markdown compact (`projectContextMarkdown`), éventuellement complété d'une transcription triée par le modèle rapide.
- **IA** (`projects/ai.ts`, `projects/jobs.ts`) : jobs `project_digest` (modèle rapide : compte rendu + propositions de tickets, jalons et risques stockées sur la note, validées une à une par l'utilisateur) et `project_report` (modèle de rédaction, effort faible : rapport à partir des seules données du projet, 30 derniers jours). Le job réserve le projet (une tâche IA à la fois) mais n'empêche pas l'édition : il ne fait qu'ajouter une note.

| pk | sk | Contenu |
|---|---|---|
| `PROJ#<id>` | `META` | Fiche + indicateurs + révision (index `gsi1` « PROJ » pour la liste) |
| `PROJ#<id>` | `TASK#<id>` | Ticket : numéro, statut, sprint (`sprintId`, null = backlog), historique des statuts et des sprints, description en Markdown (index `gsi1` « TICKET » : tous les tickets, pour les sprints). Ticket hors projet : `PROJ#hors-projet` (`NO_PROJECT_ID`, sans fiche `META`) |
| `COUNTER` | `TICKET`, `SPRINT` | Derniers numéros attribués (compteurs atomiques `nextCounter`) |
| `PROJ#<id>` | `JALON#`, `PRESTA#`, `CONTACT#`, `LINK#`, `FILE#`, `NOTE#`, `RISK#` | Éléments rattachés |
| `PROJ#<id>` | `ACT#<date>#<aléa>` | Historique (index `gsi1` « ACT » : activité récente ; expire après 1 an) |
| (S3) `projects/<id>/files/<fileId>` | | Pièce jointe |
| (S3) `projects/<id>/notes/<noteId>.txt` | | Transcription d'origine d'un compte rendu analysé |

## Sprints

- **Tickets** : éléments `tasks` des projets (`taskInputSchema`), modifiés par les routes génériques des projets (`PATCH /api/projects/:id/items/tasks/:itemId`). Le serveur attribue le numéro (`nextCounter('TICKET')`, clé « T-12 »), calcule `done` (statut `termine`) et ajoute à chaque changement une entrée à `statusChanges` / `sprintChanges` (200 au plus). Un ticket ne se planifie que dans un sprint en cours ou à venir (`assertPlannable`). Les tâches à cocher d'avant les sprints (`done`, index « TASK_OPEN ») sont lues par `normalizeTaskRecord`, puis numérotées et indexées « TICKET » à leur première lecture (`listTickets`, `getProjectDetail`). **Hors projet** : un ticket peut être rangé sous `NO_PROJECT_ID` (« hors-projet ») : pas de fiche, d'historique d'activité ni d'indicateurs (`ownerProject`), et aucun autre élément n'y est admis. `PATCH …/items/tasks/:itemId` avec `projectId` déplace le ticket (`moveTicket` : même identifiant, numéro et historique), après validation du reste de la modification. **Ticket Desk** : `deskId` (chiffres, comparés par `deskKey`) rattache un ticket au ticket Desk du prestataire ; `GET /api/tma/desk/tickets/:id` renvoie la fiche Desk importée, le temps passé d'après les relevés (total et par mois) et les tickets du hub qui le citent (`DeskTicketInfo`) ; le relevé d'un mois porte `hubTickets` (tickets du hub par ticket Desk cité).
- **Statuts** : codes fixes (`TICKET_STATUSES` : `a_faire`, `en_cours`, `attente`, `recette`, `termine`) ; libellés, ordre et visibilité dans le paramétrage (liste `ticket`). Les colonnes du tableau suivent cet ordre.
- **Sprints** (`apps/api/src/sprints/`) : numérotés (`nextCounter('SPRINT')`), états `future` → `active` → `closed`. Un seul sprint en cours (`POST /:id/start`). La clôture (`POST /:id/close`, `moveTo` : sprint à venir ou null pour le backlog) enregistre `completedAt` **avant** de déplacer les tickets non terminés : les chiffres du sprint clos s'arrêtent à la clôture. Seul un sprint à venir se supprime (ses tickets reviennent au backlog).
- **Fonds des cartes** (`sprints/cards.ts`) : règles `cardRules` du paramétrage des listes (`cardRuleSchema`, 20 au plus), évaluées dans le navigateur par `cardColor` (première règle complète qui correspond). Couleurs fixes (`CARD_COLORS`), classes `card-bg-*`.
- **Calculs** (`packages/shared/src/sprints/`) : `buildSprintReport` rejoue l'historique de chaque ticket pour connaître, à tout instant, son sprint et son statut (jours à l'heure de Paris) : périmètre au lancement, ajouts, retraits, reports, clôtures jour par jour, temps par statut, points d'attention. `buildSprintPreparation` calcule la préparation d'un sprint à venir ou en cours (tickets prévus, charge, rythme des 3 derniers sprints clos, reports probables, backlog par échéance, points à clarifier). Les libellés des statuts viennent du paramétrage.
- **IA** (`sprints/jobs.ts`) : jobs `sprint_review` (entrée `sprintReportToMarkdown`) et `sprint_preparation` (entrée `sprintPreparationToMarkdown`), modèle de rédaction, quelques Ko ; ni description ni détail des tickets. Export Word par `renderMarkdownDocx`. Pour les tests, `GET /api/sprints/:id/documents/:kind/prompt` renvoie la requête exacte qui serait envoyée à Bedrock (`captureBedrockRequest` : même SDK et mêmes paramètres que l'appel réel — `sprintDocCall` —, requête interceptée avant l'envoi, sans coût), à rejouer sur une IA locale.

| pk | sk | Contenu |
|---|---|---|
| `SPRINT` | `S#<n° sur 6 chiffres>` | Sprint (nom, objectif, dates, état, lancement, clôture), documents (`compteRendu`, `preparation`), job actif |

## Utilisateurs, rôles et to-do

- **Identité** : l'adresse e-mail (identifiant Cognito ; en local, en-tête `x-dev-user`). À chaque requête, `authMiddleware` lit l'utilisateur du hub (`users/access.ts`, annuaire en cache 10 s) : le premier utilisateur devient administrateur, une personne authentifiée inconnue est ajoutée comme chargé de projet, un utilisateur désactivé est refusé (403).
- **Droits** (`packages/shared/src/users.ts`) : le code teste un droit (`can(role, 'seeAllTodos')`, `requirePermission`), jamais un rôle. `manageUsers` et `manageAllNotes` (administrateur), `seeAllTodos` et `assignOthers` (administrateur, responsable d'équipe). Fiche utilisateur : poste (`jobTitle`), backup (`backupId`, un autre utilisateur actif, `assertBackup`), périmètres (`PERIMETERS`).
- **Comptes de connexion** (`users/identity.ts`) : création (invitation), renvoi, désactivation (+ fermeture des sessions), nom — via l'API d'administration Cognito ; sans effet en local.
- **Connexion** (`apps/web/src/auth/LoginPage.tsx`) : écran propre au hub sur l'API `aws-amplify/auth` (`signIn` / `confirmSignIn`) : mot de passe temporaire, configuration TOTP (QR code généré dans le navigateur), code TOTP, mot de passe oublié.
- **Responsable des tickets** : `assigneeId` (e-mail) + `assignee` (nom recopié de l'annuaire, comme les prestataires) ; `resolveTaskAssignee` rattache un texte à un utilisateur s'il le désigne, sinon le garde comme personne extérieure ; sans responsable, le ticket revient à son auteur. Création et renommage d'un utilisateur : `syncItems`.
- **To-do** : tâches à cocher (`done`), une partition `TODO`, rattachées ou non à un projet (`projectId`), **indépendantes des tickets** (ni statut ni sprint). `GET /api/todos?user=` renvoie la to-do d'une personne (ou `all`) selon les droits ; `GET /api/todos?projet=` la to-do d'un projet, visible et modifiable par toute l'équipe comme le projet. Les tâches d'avant la simplification (`status: 'fait'`) sont converties à la lecture ; l'ancien lien vers un ticket (`ticketId`) est ignoré. L'ordre choisi par glisser-déposer est le rang `position` (`PUT /api/todos/ordre` avec les `ids` dans l'ordre, tri `byPosition` côté front ; une tâche jamais déplacée n'en a pas et passe après, par échéance). À la suppression d'un projet, ses tâches et notes restent, détachées.
- **Notes** (`packages/shared/src/notes.ts`, `apps/api/src/notes/routes.ts`) : bloc-notes personnel, une partition par titulaire (`NOTE#<e-mail>`) ; `/api/notes` lit et modifie les notes de l'utilisateur connecté (`?projet=` : celles d'un projet). Avec `manageAllNotes`, `?user=<e-mail>|all` en lecture, `ownerId` à la création et `?owner=` en modification/suppression visent un autre titulaire (`createdBy` garde l'auteur). Une note archivée (`archived`) reste renvoyée ; le front la range dans l'onglet « Archivées » (`/notes?vue=archives`). Distinctes des notes du journal d'un projet (`PROJ#<id>` / `NOTE#<id>`, partagées).
- **Frise globale** : `GET /api/projects/jalons` renvoie chaque projet (nom, code, statut, météo, dates) avec ses jalons (ponctuels, ou sur une période `startDate` → `date`, contrôlée par `derived`) et sa to-do datée (`PlanningProject`) ; la to-do hors projet vient de `GET /api/todos` ; page `/planning` (`projects/GlobalPlanningPage.tsx`, vues 1 semaine à 12 mois et « Tout » : `windowOf`, graduations `ticksOf`). Les points mènent à `/projets/<id>?onglet=planning&jalon=<id>`, `?onglet=todo&tache=<id>` ou `/todo?tache=<id>`, qui mettent l'élément en évidence.

| pk | sk | Contenu |
|---|---|---|
| `USER` | `U#<e-mail>` | Utilisateur : nom, rôle, actif, invitation, dernière activité |
| `TODO` | `T#<id>` | Tâche de la to-do (responsable `assigneeId`, auteur `createdBy`, projet `projectId`, rang `position`) |
| `NOTE#<e-mail>` | `N#<id>` | Note personnelle (titre, texte Markdown, projet `projectId`, épinglée, archivée) |

## Ajouter un module au hub

1. Créer les pages dans `apps/web/src/pages/` (ou un dossier dédié), et les routes dans `apps/web/src/main.tsx`.
2. Déclarer le module dans `apps/web/src/modules.ts` (il apparaît dans le menu et sur l'accueil).
3. Ajouter les routes d'API dans `apps/api/src/app.ts` (ou un routeur dédié monté sous `/api`) et les entités DynamoDB avec un nouveau préfixe de `pk` dans `apps/api/src/db/`.
4. Si le module utilise l'IA : passer par `callStructured` (`apps/api/src/ai/llm.ts`) pour bénéficier du suivi de consommation et du budget.

## Retours sur l'application

`packages/shared/src/feedback.ts`, `apps/api/src/feedback/routes.ts` (`/api/feedback`), front `apps/web/src/feedback/`. Tout utilisateur envoie un retour (type, message, page, navigateur) ; lecture, traitement et suppression demandent le droit `manageFeedback`.

| pk | sk | Contenu |
|---|---|---|
| `FEEDBACK` | `F#<date ISO>#<id>` | Retour (type, message, page, auteur, statut, note de traitement) |

## Bouton rouge « NE PAS CLIQUER »

Petit jeu caché : `packages/shared/src/bouton.ts` (rareté `BOUTON_ROUGE_CHANCE`, pause `BOUTON_ROUGE_PAUSE_MIN`), `apps/api/src/bouton/routes.ts` (`GET /api/bouton-rouge` : mon compteur et le classement ; `POST /api/bouton-rouge/clic` : incrément atomique), front `apps/web/src/bouton/BoutonRouge.tsx` (monté dans `Layout`, tirage au sort à chaque changement de page, dernière apparition dans `localStorage` ; `?bouton-rouge` force l'apparition). La scène de déception est en CSS et le son en Web Audio : rien à télécharger.

| pk | sk | Contenu |
|---|---|---|
| `BOUTON` | `C#<e-mail>` | Nombre de clics (`count`), dernier clic |
