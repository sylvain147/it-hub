# Hub IT

Application interne de l'équipe IT (chargés de projet en lien avec les prestataires). Le hub est **modulaire** : chaque fonctionnalité est un module accessible depuis le menu.

## Modules

### ✅ Tâches

- **Une liste de choses à faire** : les tâches des projets dont je suis responsable et mes **tâches personnelles** (hors projet), triées par échéance, avec les retards en évidence. On **coche** quand c'est fait (et on décoche si besoin), on déplie les **détails** (texte mis en forme), on ajoute une tâche en une ligne.
- Une tâche se **rattache à un projet** ou reste personnelle ; changer le projet dans la fiche de la tâche la déplace.
- **Selon le rôle**, on consulte les tâches d'une autre personne ou de **toute l'équipe**, et on peut confier une tâche personnelle à quelqu'un (« confiée par … »).
- L'accueil reprend « Mes tâches » (et « Toute l'équipe » pour les rôles qui le permettent).

### 📁 Projets

Un projet regroupe tout ce que le chargé de projet suit ; le cahier des charges n'est plus qu'une de ses fonctionnalités.

- **Fiche projet** : nom, code, statut (idée → cadrage → en cours → recette → production → terminé, en pause, abandonné), priorité, **météo** (au vert / vigilance / en difficulté, avec commentaire), chef de projet, demandeur, dates, budget prévu, étiquettes, et en texte riche la **description**, les **objectifs** et le **hors périmètre**.
- **Vue d'ensemble** : indicateurs (tâches, prochain jalon, budget engagé, risques), **points d'attention** calculés (tâches et jalons en retard, risques critiques, propositions de l'assistant à valider), échéances des 15 prochains jours, équipe, historique.
- **Tâches** : liste à cocher (intitulé, détails, échéance, responsable), ajout rapide, filtre « seulement les miennes ». Le **responsable est un utilisateur du hub** (par défaut, celui qui crée la tâche) ; une personne extérieure (prestataire, métier) peut être saisie en texte. Les **tickets Jira reliés** au projet s'affichent en dessous, en lecture seule.
- **Planning** : jalons sur une frise, avec la **date initiale** conservée pour mesurer le glissement.
- **Prestations** : devis et commandes des prestataires (statut, charge, montant, références de devis et de bon de commande, livraison, CDC lié) ; budget prévu / engagé / restant.
- **Intervenants** : par organisation, avec rôle, e-mail, téléphone ; « écrire à tous ».
- **Documents et liens** : pièces jointes (devis, PV de recette… 50 Mo max., stockage privé) et liens (Jira, SharePoint, Git, environnements…).
- **Journal** : comptes rendus, décisions, informations, points d'attention, rapports ; notes épinglables.
- **Risques** : probabilité × impact, parade, responsable, matrice.
- **Assistant** (toujours sur clic) :
  - **Analyser une réunion** : on colle une transcription ou des notes en vrac ; le modèle économique rédige le compte rendu dans le journal et **propose des tâches, jalons et risques**, que l'on coche avant de les ajouter (rien n'est ajouté sans validation) ;
  - **Rapport d'avancement** : rédigé à partir des seules données du projet, avec une météo proposée.
- **Cahiers des charges** : rédigés depuis le projet (fiche, prestation choisie, planning, risques, notes du journal sélectionnées et, si besoin, une transcription). Le CDC est pré-rempli (projet, prestataire, estimation, échéances, phase) et lié à la prestation.
- **Accueil** : mes tâches, échéances des 30 prochains jours tous projets confondus, projets à surveiller, activité récente.

### 🧭 Jira

Pour retrouver ses tickets et ses sprints **Jira Cloud** dans le hub, et préparer ou restituer un sprint.

- **Connexion** (Paramétrage → Jira) : site, e-mail d'un compte (de service, idéalement) et jeton d'API. La connexion est testée avant l'enregistrement ; les champs « story points » et « Réf Ticket Desk » sont détectés automatiquement (choix manuel possible). Le jeton reste sur le serveur.
- **Tableaux suivis** puis **Importer depuis Jira** : les sprints (en cours, à venir et les 6 derniers clos) avec l'historique de leurs tickets, et le backlog ouvert, sont importés. Les tickets sont en **lecture seule** (ils se modifient dans Jira) ; un nouvel import les remet à jour.
- **Tickets** : filtres « mes tickets » (rapprochement par e-mail ou nom de la personne assignée), sprint, backlog, projet, recherche ; chaque ticket se **relie à un projet du hub** : **automatiquement** quand le **code du projet est la clé de son épopée** Jira (« TC-300 » : l'épopée, ses tickets et leurs sous-tâches), ou à la main, un par un ou par sélection. Un choix manuel (y compris « détaché ») l'emporte sur l'épopée et survit aux imports ; « Automatique (épopée) » revient au rattachement par l'épopée. Les tickets reliés apparaissent dans l'onglet Tâches du projet.
- **Revue d'un sprint** (en cours ou clos), calculée à partir de l'historique Jira de chaque ticket :
  - chiffres clés : tickets actifs, clôturés (avec et sans la recette), story points livrés, ajouts en cours de sprint, échéances dépassées ;
  - graphiques : avancement, charge par personne, story points, périmètre et clôtures jour par jour, temps passé par statut ;
  - tableau des tickets avec leur **mouvement** (au lancement, reporté du sprint précédent, ajouté, créé, retiré → sprint suivant ou backlog) et le **ticket Desk** lié (sujet repris du suivi TMA) ;
  - **points d'attention** et **qualité des données Jira**.
- **Préparation d'un sprint** (à venir ou en cours) : tickets prévus, story points comparés à la **vélocité** des derniers sprints, charge par personne, tickets sans estimation ou sans responsable, **reports probables** du sprint en cours, **backlog prioritaire**, points à clarifier.
- **Documents rédigés par l'assistant** sur clic, à partir des seuls chiffres : **compte rendu** (message clé, faits marquants, risques, pistes) ou **préparation** (objectif proposé, périmètre et capacité, arbitrages, points à clarifier, ordre du jour de la planification). Modifiables, **téléchargeables en Word**, et ajoutés au **journal d'un projet** en un clic.
- **Lecture seule** : le hub ne modifie jamais Jira et ne lit ni descriptions ni commentaires. En local, le site `demo` donne un projet Jira fictif pour essayer sans compte.

### 📄 Cahiers des charges (dans un projet)

- **Génération** à partir du projet et/ou d'une transcription brute : l'assistant fait le tri et rédige le CDC selon le modèle de l'équipe (Contexte obligatoire → sections adaptées au sujet → Annexes).
- **Champs** : titre et statut (obligatoires), phase du projet, prestataire, projet, estimation en jours/homme, échéances (plusieurs jalons datés). Échéances et estimation deviennent obligatoires pour passer en « Validé » ou « Envoyé ».
- **Questions de l'assistant** : liste priorisée (bloquante / importante / optionnelle) des points à préciser. On répond dans l'interface, puis on intègre les réponses : seules les sections concernées sont réécrites.
- **Nouvelles réunions** : une transcription supplémentaire est intégrée au CDC existant, et met à jour les questions.
- **Retravail ciblé** d'une section (« plus concis », consigne libre…).
- **Édition type Word** : sous-sections numérotées automatiquement (3.1, 3.2…), listes, tableaux, images collées directement.
- **Versionning** : chaque enregistrement crée une version (0.1, 0.2… puis 1.0 à la validation). On peut comparer deux versions, restaurer une version et exporter n'importe laquelle.
- **Exports Word et PDF** fidèles au modèle (bandeau Version / Échéance cible / Statut / Estimation).
- **Traduction** anglais / allemand, avec cache paragraphe par paragraphe.
- La liste de tous les CDC reste accessible (bouton « Tous les cahiers des charges ») ; un CDC créé avant le module Projets peut être **rattaché** à un projet.

### 🗂️ Lecteur de fichiers

Pour décortiquer les fichiers à plat, CSV et exports qui circulent sur les FTP.

- **Un type de fichier = une fiche de lecture**, créée par l'assistant à partir d'un **fichier exemple**, et si disponibles de la **spécification** (Excel), du **code qui génère le fichier** (PL/SQL…) et d'explications en vrac.
- La fiche décrit le format sans code : positions fixes ou CSV, types de ligne (en-tête, facture, ligne d'article, totaux…) et rattachements, champs (dates, montants avec décimales implicites, codes avec libellés), **contrôles** (nombre de lignes ou totaux annoncés en fin de fichier).
- On la **teste** sur un vrai fichier, on la corrige à la main ou en demandant un **ajustement** à l'assistant ; chaque modification crée une version.
- Ensuite, on dépose n'importe quel fichier : le type est **reconnu automatiquement** et le fichier est affiché clairement (synthèse, vue structurée par facture, tableaux filtrables, anomalies, contenu brut coloré) et **exportable en Excel**.
- **Confidentialité** : les fichiers sont lus **dans le navigateur**, jamais envoyés ni conservés. Seul un extrait de l'exemple part à l'IA lors de la création d'un type, **anonymisé par défaut** (lettres et chiffres remplacés au hasard ; longueurs, dates et codes courts conservés) et visible avant l'envoi.
- **Coût** : quelques centimes une seule fois par type de fichier ; la lecture des fichiers n'utilise jamais l'IA.

### ⏱️ Suivi TMA

Pour piloter le contrat de TMA du prestataire à partir de ses deux fichiers.

- **Export des tickets Desk** (CSV, idéalement 90 jours pour démarrer) : les tickets sont ajoutés ou mis à jour à chaque import.
- **Relevé mensuel du temps passé** (Excel : date, nombre de jours, nom, prénom, commentaire) : le temps de chaque ligne est réparti entre les tickets cités dans le commentaire (« Desk #11373, #11375 », « Desk365#8720 (45 min) »…), selon les durées écrites ou à parts égales ; le reste est classé en pilotage / réunions ou autres activités. Une journée = 8 h.
- **Rapport du mois** : temps par intervenant, par ticket, par catégorie Desk et par thème, tickets créés (catégorie, cause, priorité, thème), activités hors ticket, comparaison avec le mois précédent, export Excel.
- **Thèmes et récurrences** : l'assistant attribue un thème à chaque ticket (« Chèques – erreur de montant / impayé »…) pour repérer les problèmes qui reviennent, mois par mois, avec le temps TMA associé.
- **Synthèse du mois** rédigée par l'assistant à partir des seuls chiffres calculés.
- **Confidentialité** : les fichiers sont lus dans le navigateur ; seules les colonnes utiles sont envoyées, après **masquage des données personnelles** (e-mails, téléphones, numéros de client / commande / chèque, noms après une civilité, noms des demandeurs, signatures). Un nom cité sans civilité au milieu d'une phrase peut subsister.
- **Coût** : classement des tickets par le modèle rapide, une seule fois par ticket (moins d'un euro pour un an de tickets) ; quelques centimes par synthèse. Les rapports eux-mêmes n'utilisent pas l'IA.

### 👥 Utilisateurs et connexion

- **Connexion** : page du hub en français (e-mail + mot de passe, puis code de l'application d'authentification ; première connexion avec choix du mot de passe et activation de la double authentification ; mot de passe oublié).
- **Utilisateurs** (administrateurs) : ajout (invitation par e-mail avec mot de passe temporaire), nom, rôle, désactivation, renvoi de l'invitation. Le hub garde toujours au moins un administrateur actif.
- **Rôles** :

| Rôle | Droits |
|---|---|
| Administrateur | Gère les utilisateurs et leurs rôles ; voit et attribue les tâches de toute l'équipe |
| Responsable d'équipe | Voit les tâches de toute l'équipe et peut en attribuer à chacun |
| Chargé de projet | Voit ses propres tâches et en crée pour lui-même |

  Les projets, le lecteur de fichiers, le suivi TMA et le paramétrage restent ouverts à tous.
- À la création d'un utilisateur, les tâches de projet qui le désignaient déjà en texte (nom ou adresse) lui sont rattachées ; un changement de nom se répercute dans les tâches.
- En local, pas de mot de passe : on se connecte avec une adresse e-mail (le premier compte devient administrateur).

### ⚙️ Paramétrage

Référentiels communs, modifiables par tous les utilisateurs :

- **Prestataires** : fiche (nom, activité, site, notes) et **carnet de contacts**. Une prestation se rattache obligatoirement à un prestataire de la liste (bouton « + » pour en créer un sans quitter le formulaire) ; l'en-tête des cahiers des charges le propose aussi. Un renommage se répercute dans tous les projets. Les doublons se **fusionnent** ; un prestataire utilisé s'**archive** (il n'est plus proposé, l'historique est conservé). Les noms saisis avant le paramétrage se reprennent d'un clic.
- **Intervenants liés au carnet** : dans un projet, un intervenant peut être choisi dans le carnet d'un prestataire ; nom, e-mail, téléphone et organisation restent alors à jour avec le carnet (le rôle et les notes restent propres au projet).
- **Statuts** (projets, prestations, risques, cahiers des charges) : libellé, ordre et visibilité. Le fonctionnement ne change pas (projet clos, montant engagé, risque clos…) ; les statuts qui le portent ne peuvent pas être masqués.
- **Libellés de jalons et rôles des intervenants** proposés à la saisie (texte libre toujours possible).

### 📊 Consommation IA

Coût estimé du mois par opération, modèle et utilisateur, avec un **plafond mensuel** au-delà duquel les fonctions IA sont suspendues (l'édition manuelle reste possible).

## Maîtrise des coûts IA (Bedrock)

| Levier | Effet |
|---|---|
| Deux modèles : **Claude Haiku 5.5** (tri, traductions) et **Claude Sonnet 5.5** (rédaction) | Le gros volume (la transcription brute) passe par le modèle ~20× moins cher |
| La transcription n'est lue **qu'une fois** ; on conserve les notes structurées | La rédaction travaille sur un texte 5 à 10× plus court |
| Mises à jour **ciblées** (seules les sections utiles sont envoyées, seules les sections modifiées reviennent) | Pas de régénération complète du document |
| Traductions **en cache par paragraphe** | Une mise à jour ne retraduit que ce qui a changé |
| Instructions système stables + **cache de prompt** | Les appels successifs relisent les instructions à ~10 % du prix |
| Aucun appel IA automatique | L'IA ne tourne que sur clic ; l'édition manuelle est gratuite |
| Suivi par appel + budget mensuel | Pas de mauvaise surprise |

Ordre de grandeur (tarifs publics Anthropic, à confirmer sur la facture Bedrock) : **~0,10 $ pour générer un CDC** à partir d'une réunion d'une heure, quelques centimes pour une intégration de réponses, une traduction, l'analyse d'une réunion (modèle économique) ou un rapport d'avancement (seules les données du projet sont envoyées, pas de document brut).

## Démarrage en local

Prérequis : Node 22+, pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev          # API sur :3001 (IA simulée, aucune donnée envoyée), front sur http://localhost:5173
```

En local, la base DynamoDB est émulée et **enregistrée sur disque** dans `apps/api/.data/dynamodb` (avec les fichiers, dans `apps/api/.data`) : les données sont conservées d'un démarrage à l'autre. Supprimer `apps/api/.data` repart de zéro ; `LOCAL_DB=memoire pnpm dev` utilise une base vide à chaque démarrage. L'IA est **simulée** (réponses factices, coût nul). Pour tester avec le vrai Bedrock : `LLM_PROVIDER=bedrock pnpm --filter @samm/api dev` avec des identifiants AWS valides.

```bash
pnpm test         # tests (conversion Markdown, parcours complet de l'API, exports)
pnpm typecheck
pnpm export:exemple /tmp   # génère un CDC exemple en Word et PDF pour vérifier la mise en page
```

## Déploiement

Voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md). L'architecture est décrite dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Structure

```
apps/api        API (Hono sur Lambda), pipeline IA, exports Word/PDF, tests
apps/web        Front React (Vite, TipTap, Amplify Auth)
packages/shared Modèle de données, schémas de validation, conversion Markdown ⇄ éditeur
infra           Infrastructure AWS (CDK TypeScript)
```
