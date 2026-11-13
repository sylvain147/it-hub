# Hobbit

Hobbit est l’application interne de l’équipe IT (chargés de projet en lien avec les prestataires). Le hub est **modulaire** : chaque fonctionnalité est un module accessible depuis le menu.

## Modules

Le menu latéral regroupe les modules en trois sections repliables : **Projets** (projets, planning, sprints), **Au quotidien** (to-do, notes — où l'on transcrit aussi une réunion —, idées d'amélioration) et **Outils** (composée par chacun sur sa fiche : lecteur de fichiers, suivi TMA, liens personnels). L'assistant, **Gandalf**, n'est pas dans le menu : c'est la bulle en bas à droite de chaque page. L’administration (utilisateurs, paramétrage, retours, consommation IA), **Ma fiche** (mes informations — nom, poste, backup, périmètres, que je modifie moi-même —, mon thème et mes outils), le **thème de couleur** (dont **Mordor** et **Nazgûl**, noir absolu avec fumées et flammes des ténèbres, qui réservent quelques surprises), « Faire un retour » et la déconnexion sont dans le menu de l’utilisateur, en bas.

### ✅ To-do

- **Ma liste de choses à faire** : des tâches simples (intitulé, détails, échéance) que l'on **coche** quand c'est fait, avec les retards en évidence. Une nouvelle tâche est **pour aujourd'hui par défaut** (échéance modifiable ou à vider dans sa fiche). On ajoute une tâche en une ligne et on la **range par glisser-déposer** (poignée ⠿, ou flèches du clavier) ; les tâches jamais déplacées suivent, par échéance.
- **Sous-tâches** : une tâche se découpe en étapes (bouton ＋ sur la ligne, ou dans sa fiche où on les renomme et les range), cochées une à une sous la tâche ; l'avancement (« ☑ 2/5 ») s'affiche sur la ligne.
- La to-do est **séparée des tickets** : une tâche n'a ni statut ni sprint, et ne se planifie pas. Le travail à planifier se crée en ticket (module Sprints).
- Une tâche se **rattache à un projet** ou reste personnelle. Si le projet n'existe pas encore, « + Nouveau projet » dans la fiche de la tâche le crée et y rattache la tâche, sans quitter la saisie. Les tâches d'un projet forment la **to-do du projet** (onglet « To-do et notes »), visible et cochable par toute l'équipe.
- **Selon le rôle**, on consulte la to-do d'une autre personne ou de **toute l'équipe**, et on peut confier une tâche à quelqu'un.
- **Pastille dans le menu** : à côté de « To-do », le nombre de mes tâches **du jour ou en retard**.
- **Cette semaine** (onglet de la page To-do) : une carte par jour, du lundi au vendredi (le week-end s'il y a des tâches), avec ses tâches à cocher et un ajout rapide pour ce jour ; ◀ ▶ pour les semaines suivantes ou précédentes, et une carte « En retard » sur la semaine en cours.
- L'accueil reprend « Ma to-do » et, à côté, « Mes tickets ouverts » (et « Toute l'équipe » pour les rôles qui le permettent).

### 📝 Notes

- **Un bloc-notes personnel**, en vrac : titre facultatif, texte mis en forme, rattaché ou non à un projet. Saisie rapide en une zone de texte (Ctrl + Entrée).
- Les notes sont **personnelles** : seul leur titulaire les voit, avec les **administrateurs**, qui consultent celles d'une personne ou de toute l'équipe et peuvent **ajouter une note à quelqu'un** (« ajoutée par … »). Pour partager un compte rendu ou une décision, on passe par le journal du projet.
- **Épingler** une note la garde en tête ; **archiver** la range à part (onglet « Archivées », d'où on la ressort) sans la supprimer ; recherche plein texte et filtre par projet. Les notes d'un projet se retrouvent aussi dans son onglet « To-do et notes ».
- **🎙️ Transcrire une réunion** (bouton de la page Notes) : voir plus bas.
- **Actions avec Gandalf** (son portrait sur chaque note) : Gandalf reçoit la note et propose les tickets, tâches et jalons à créer.
- **Taille des post-it** : la poignée en bas à droite d'une note l'agrandit (jusqu'à trois colonnes de large, hauteur libre) pour la lire sans l'ouvrir ; double-clic : la note entière, ou de nouveau la taille normale (flèches du clavier sur la poignée). La taille est retenue pour chaque note.

### ✨ L'IA propose, vous validez

Quand l'IA doit créer ou modifier quelque chose, elle commence par dire ce qu'elle va faire, puis attend votre accord, élément par élément :
- **Compte rendu de réunion** (journal du projet, transcription) : « Après analyse, je vais créer les tickets « … » et « … », passer T-12 en recette, décaler l'échéance de T-8 au 20 novembre et ajouter le risque « … ». » Chaque proposition se coche : nouveaux tickets, **mises à jour de tickets existants** (statut, échéance, priorité, avec l'avant → après et la raison), jalons, risques.
- **Gandalf** : « Après analyse, je vais… », puis une carte par proposition (créer un ticket, une tâche, un jalon, **mettre à jour un ticket** : « Passe T-12 en recette »).
- **Suivi TMA** : le classement des tickets Desk par thème devient une proposition (« Après analyse de 37 tickets, je propose de les ranger en 6 thèmes : … »), regroupée par thème, que l'on applique en tout ou en partie, ou que l'on ignore.

### 🧙 Gandalf, l'assistant

- **Un chat avec l'IA sur tout le hub**, ouvert par la **bulle de Gandalf en bas à droite** de chaque page (la conversation continue d'une page à l'autre ; Échap ou × la referme) : « que dois-je faire en priorité ? », « quelles échéances dans les 15 jours ? », « où en est la migration ERP ? ». Questions d'exemple au départ, relances proposées après chaque réponse ; les projets cités sont des liens.
- Il s'appuie sur les **données du hub, rassemblées par l'application** : projets et leurs indicateurs, jalons en retard et à venir, sprint en cours, mes tickets et les tickets en retard, ma to-do (avec ses sous-tâches) et celle des projets, mes notes. Un projet cité par son nom ou son code (dans la question ou les échanges précédents) est envoyé en détail. Jamais les notes ni la to-do personnelle des autres.
- **Lui demander de créer quelque chose** : « Crée-moi un ticket de dev sur La Poste Essentiel », « Ajoute à ma to-do de relancer le prestataire vendredi », « Mets un jalon de mise en production le 15 janvier sur l'ERP ». Il reconnaît le projet, le **type de ticket** (« pour le développement » → « [DEV] - Nom du projet »), la priorité (« urgent », « important »), le responsable et la date, et propose l'élément à créer.
- **Coller un long texte** (compte rendu, transcription de réunion, e-mail, notes en vrac) : Gandalf le résume et **propose les actions à créer**, une carte par proposition — « Dois-je créer un ticket dans le projet ERP ? », « Dois-je ajouter une tâche à votre to-do ? », « Dois-je ajouter un jalon ? ». On retouche l'intitulé, le projet, le responsable ou la date, puis **Créer** ou **Ignorer** : rien n'est créé sans ce clic. Depuis une note, une entrée du journal d'un projet ou une transcription de réunion, « Actions avec Gandalf » lui confie le texte.
- **Images et pièces jointes** : coller une capture d'écran (Ctrl+V), glisser un fichier sur le chat ou le joindre (📎) : images, PDF, Word, Excel ou texte (5 au plus, 3 Mo au total). Les images sont réduites dans le navigateur ; Word, Excel et texte y sont lus et ajoutés à la question. Les pièces jointes ne partent qu'avec la question où elles sont jointes.
- **Il ne modifie rien de lui-même**. La conversation reste dans l'onglet du navigateur (rien n'est enregistré) ; chaque question est un appel au modèle rapide, compté dans la consommation IA.

### 🗓️ Planning

- **Frise des projets en cours** : une ligne par projet (sa durée, du début à la fin visée, en fond), ses jalons en **étiquettes lisibles** (à venir, ⚠ en retard, ✓ atteints ; un jalon sur une période couvre ses dates), rangées sur plusieurs lignes quand elles se chevauchent, et la date du jour.
- Quatre vues : **semaine** (jour par jour, week-end grisé), **mois, trimestre** (par défaut) et **année**, avec ◀ ▶ pour passer à la période précédente ou suivante ; une seule case, « Mes projets ».
- **Un clic sur un jalon l'ouvre** dans l'onglet « Planning » de son projet, mis en évidence.
- En dessous, **les échéances de la période** avec leur projet et leur état (et leur décalage). Les jalons se saisissent dans l'onglet « Planning » de chaque projet.

### 💡 Idées d'amélioration

- **Les idées de l'équipe en cartes** (ERP par défaut, ou tout autre domaine) : intitulé, début de la description, **priorité** (basse → critique, modifiable sur la carte), statut, domaine, projet concerné, auteur. Un gros bouton **👍 soutenir** (un par personne) à gauche de chaque carte.
- **Onglets par statut** avec leur nombre (à traiter, nouvelle, retenue, en cours, réalisée, écartée, toutes), **domaines en pastilles**, recherche, tri (priorité, les plus soutenues, les plus récentes) et « les miennes et celles que je soutiens ».
- Une idée nouvelle se **retient** ou s'**écarte** d'un clic ; une idée close se rouvre. Saisie rapide en une ligne en haut de la page.
- **→ Ticket** : une idée devient, sur clic, un ticket au backlog (du projet choisi ou hors projet), avec sa priorité ; l'idée passe « en cours » et garde le lien vers le ticket.

### 🎙️ Transcrire une réunion (page Notes)

- Depuis la page **Notes** (« 🎙️ Transcrire une réunion ») : un clic au début de la réunion (Teams, Zoom… dans une autre fenêtre) : **ce qui est dit s'écrit au fil de l'eau**, horodaté à la minute. Le **son n'est pas enregistré** : seul le texte est gardé (brouillon sur le poste). Reconnaissance vocale du navigateur (Chrome, Edge) ; pour capter les autres participants, écouter la réunion sur les haut-parleurs.
- Ouverte depuis le journal d'un projet, elle **présélectionne ce projet**, sauf si une transcription est déjà commencée.
- La transcription **continue d'une page à l'autre** du hub (pastille « Transcription en cours ») ; le texte se corrige pendant l'écoute.
- À la fin : **garder comme note**, **compte rendu par l'IA** dans le journal du projet (avec tickets, jalons et risques à valider, comme « Analyser une réunion »), ou **actions avec Gandalf**.

### 💍 L'Anneau unique

Petit jeu caché de **l'Anneau unique** : de temps en temps (une chance sur 40 à chaque changement de page, au plus une fois par demi-heure), un anneau d'or apparaît quelques secondes. Le premier qui clique dessus le prend ; s'il réapparaît chez quelqu'un d'autre, celui-ci peut le lui prendre d'un clic. Le porteur de l'Anneau a un **rond doré autour de ses initiales** (menu, tableau du sprint, journal d'activité), visible de toute l'équipe. Ajouter `?anneau` à l'adresse le fait apparaître à coup sûr.

### 📁 Projets

Un projet regroupe tout ce que le chargé de projet suit ; le cahier des charges n'est plus qu'une de ses fonctionnalités.

- **Fiche projet** : nom, code, statut (idée, cadrage → planifié → en cours → recette → production → terminé, en pause, abandonné), **bloqué** (avec la raison), **domaines** (choix multiple parmi ceux du paramétrage : IT, Logistique, Marketing, Finance, Juridique, Relation client, Web au départ ; la liste des projets se filtre par domaine), priorité, **météo** (au vert / vigilance / en difficulté, avec commentaire), **chefs de projet (un ou plusieurs utilisateurs du hub, ex. un pour l’ERP et un pour le Web, choisis dans une liste déroulante filtrable)**, demandeur, dates, budget prévu, étiquettes, et en texte riche la **description**, suivie de **sections libres** ajoutées à la demande (titre + texte, ex. objectifs, hors périmètre).
- **Frise d'avancement** (page du projet et accueil) : une flèche par étape, cadrage → planifié → en cours → recette → en production → terminé, chacune de la couleur de son statut ; les étapes passées et l'étape en cours sont colorées. Sur la page du projet, **un clic sur une étape y passe le projet**.
- **Météo** en point de couleur à côté du nom du projet : vert (au vert), orange (vigilance), rouge (en difficulté). Un projet **bloqué** (« ⛔ Signaler un blocage ») garde son étape, en rouge, avec la raison du blocage.
- **Suivre un projet** (☆ Suivre, sur la page du projet ou dans la liste) : il compte alors parmi **« Mes projets »**, avec ceux dont je suis l’un des chefs de projet. La case « Mes projets » filtre la liste des projets (et ses compteurs : projets actifs, en difficulté, en vigilance, bloqués, tickets en retard, comme le choix d'un domaine), le planning et les sprints (tableau, planification, backlog) ; le choix est retenu d'une page à l'autre.
- **Vue d'ensemble** : indicateurs (tickets, prochain jalon, budget engagé, risques), **points d'attention** calculés (tickets et jalons en retard, risques critiques, propositions de l'assistant à valider), échéances des 15 prochains jours, équipe, historique.
- **Tickets** : le travail du projet, numéroté (« T-12 ») : intitulé, description (avec des **captures d’écran collées** directement), statut, sprint (ou backlog), échéance, responsable. Ajout rapide au backlog, filtre « seulement les miens ». **Type** facultatif d'un ticket (Cadrage, Dev, Recette, Correctif, MEP… au paramétrage), en étiquette devant son titre. **⚡ Process complet** : crée d'un coup les tickets Cadrage, Dev, Recette, Correctif et MEP du projet (précision facultative), avec un responsable, une priorité et un sprint communs ; le premier est « À faire », les suivants « En attente ». **Quand on termine un ticket du process, le hub propose l'étape suivante** : « Passer en Planifié ? » (ou directement « En cours ») à la fin du cadrage, et le ticket Dev passe « À faire » ; de même pour la recette, le correctif, la MEP (« En production »). Le **responsable est un utilisateur du hub** (par défaut, celui qui crée le ticket) ; une personne extérieure (prestataire, métier) peut être saisie en texte.
- **To-do et notes** : la to-do du projet (partagée) et mes notes sur le projet (personnelles).
- **Planning** : jalons sur une frise, ponctuels ou sur une **période** (date de début et date de fin), avec la **date initiale** conservée pour mesurer le glissement. Le module Planning les rassemble pour tous les projets.
- **Prestations** : devis et commandes des prestataires (statut, charge, montant, références de devis et de bon de commande, livraison, CDC lié) ; budget prévu / engagé / restant.
- **Intervenants** : par organisation, avec rôle, e-mail, téléphone ; « écrire à tous ».
- **Documents et liens** : pièces jointes (devis, PV de recette… 50 Mo max., stockage privé) et liens (outils de tickets externes, SharePoint, Git, environnements…).
- **Journal** : comptes rendus, décisions, informations, points d'attention, rapports ; notes épinglables ; « Actions avec Gandalf » sur chaque entrée.
- **Risques** : probabilité × impact, parade, responsable, matrice.
- **Assistant** (toujours sur clic) :
  - **Analyser une réunion** : on colle une transcription ou des notes en vrac ; le modèle économique rédige le compte rendu dans le journal et **propose des tickets, jalons et risques**, que l'on coche avant de les ajouter (rien n'est ajouté sans validation) ;
  - **Rapport d'avancement** : rédigé à partir des seules données du projet, avec une météo proposée.
- **Cahiers des charges** : rédigés depuis le projet (fiche, prestation choisie, planning, risques, notes du journal sélectionnées et, si besoin, une transcription). Le CDC est pré-rempli (projet, prestataire, estimation, échéances, phase) et lié à la prestation. **Sans IA (« Créer à partir du projet »), toutes les sections de la fiche projet sont reprises** : la description devient le Contexte, chaque section du projet une section du CDC, à modifier ensuite librement.
- **Fiche et cahiers des charges** : après une modification de la description ou des sections du projet, le hub propose de **reporter ces passages dans ses CDC** (au choix, avec confirmation ; une nouvelle version par CDC). Une **date de fin visée** crée (et déplace) le jalon « Fin du projet » du planning.
- **Accueil** : ma to-do, mes tickets ouverts, échéances des 30 prochains jours tous projets confondus (lien vers la frise), projets actifs avec leur frise d'avancement (bloqués d'abord, puis météo), activité récente.

### 🧭 Tickets et sprints

Le suivi des tickets par sprints, directement dans le hub (pas d'outil à côté). Entrée « Tickets » du menu : onglet **Sprints** (tableau, planification, backlog, sprints clos) et onglet **Tous les tickets** (tous les tickets, terminés compris, avec une **recherche** par numéro, intitulé, projet, responsable ou ticket Desk, et un filtre par statut).

- **Tickets** : rattachés à un projet ou **hors projet** (« Aucun projet » dans la fiche du ticket). **Un type facultatif à la création** (Cadrage, Dev, Recette, MEP, Correctif, paramétrables dans Paramétrage → listes) propose le titre « [DEV] - Nom du projet », que l'on complète ; dans l'onglet « Tickets » d'un projet, un bouton par type (ou « Sans type ») ouvre la fiche pré-remplie ; un second clic sur le type choisi le retire. Changer le projet d'un ticket le déplace, ou le sort de tout projet, en gardant son numéro et son historique.
- **Notes de suivi** : en bas de la fiche d'un ticket, un fil de notes datées (avancement, échanges avec le prestataire, points de vigilance), en Markdown, visible de toute l'équipe. Ajouter une note ne modifie pas le ticket ; chacun modifie ou supprime les siennes. Le nombre de notes (💬) s'affiche sur les listes.
- **Priorité** des tickets (basse, normale, haute, critique) : affichée sur les listes et les cartes (sauf « normale ») ; le backlog, les sprints et les colonnes du tableau sont triés par priorité.
- **Temps estimé et temps passé** (en heures, au quart d'heure ; virgule acceptée) : deux champs indépendants de la fiche du ticket, affichés sur les listes et les cartes du tableau (⏳ estimé · ⏱ passé). Ils serviront aux statistiques.
- **N° ticket Desk** : un ticket du hub se rattache au ticket Desk du prestataire. La fiche affiche alors ce que le suivi TMA en sait (sujet, statut, catégorie, thème, **temps passé par le prestataire** d'après les relevés, mois par mois) et les autres tickets du hub qui le citent ; le badge « Desk #… » apparaît sur les listes et le tableau. Dans le relevé TMA du mois, chaque ticket Desk mène au ticket du hub rattaché. **Le temps du prestataire s'ajoute au temps passé du ticket** : à chaque import (ou suppression) d'un relevé, et dès qu'on renseigne le n° Desk, le temps passé = temps saisi à la main + temps des relevés pour ce ticket Desk (« dont X h du prestataire » sous le champ). Plusieurs tickets du hub citant le même ticket Desk reçoivent chacun ce temps.

- **Statuts** : À faire, En cours, En attente, En recette, Terminé. Ce sont les colonnes du tableau ; leurs libellés, leur ordre et leur visibilité se règlent dans **Paramétrage → Statuts**.
- **Sprints** : nom (« Sprint 4 » par défaut), dates (deux semaines à la suite du précédent par défaut), objectif. Un seul sprint est **en cours** à la fois ; les autres sont à venir ou clos.
- **Planification** : chaque sprint à venir liste ses tickets, et le **backlog** regroupe les tickets ouverts hors sprint de tous les projets ; un menu sur chaque ticket le planifie dans un sprint ou le remet au backlog. **Démarrer** lance le prochain sprint. Filtrer le backlog sur un projet propose de **planifier tout le projet** (ses tickets au backlog) dans un sprint en un clic ; même chose depuis l'onglet « Tickets » du projet.
- **Tableau du sprint en cours** : une colonne par statut, on **glisse** les tickets d'une colonne à l'autre (sur mobile : menu de statut sur la carte) ; filtres par projet et « seulement les miens ».
- **Fonds conditionnels des cartes** (Paramétrage → Tableau des sprints) : des règles colorent le fond des cartes — échéance dépassée, échéance dans les N jours, même statut depuis plus de N jours, projet, responsable, personne extérieure, sans ticket Desk. La première règle qui correspond l'emporte ; une légende les rappelle au-dessus du tableau.
- **Clôturer** le sprint : les tickets non terminés partent dans le sprint suivant (ou au backlog) ; les chiffres du sprint clos sont figés.
- **Sprint passé** : un sprint créé avec une date de fin déjà passée est enregistré directement comme clos, rangé à sa date parmi les sprints clos. Un sprint à venir dont la fin est dépassée ne se démarre ni ne se prépare : on le **classe comme sprint passé**. Sa revue reprend les tickets qu'il contenait quand il a été classé, avec leur statut de ce moment-là (comme présents dès le lancement).
- **Revue d'un sprint** (en cours ou clos), calculée à partir de l'historique des statuts et des sprints de chaque ticket :
  - chiffres clés : tickets actifs, terminés (avec et sans la recette), ajouts en cours de sprint, échéances dépassées ;
  - graphiques : avancement, charge par personne, périmètre et clôtures jour par jour, temps passé par statut ;
  - tableau des tickets avec leur projet, leur ticket Desk et leur **mouvement** (au lancement, reporté du sprint précédent, ajouté, créé, retiré → sprint suivant ou backlog) ;
  - **points d'attention**.
- **Préparation d'un sprint** (à venir ou en cours) : tickets prévus comparés au **rythme** des derniers sprints (tickets terminés par sprint), charge par personne, tickets sans responsable, **reports probables** du sprint en cours, **backlog** (échéances les plus proches), points à clarifier.
- **Documents rédigés par l'assistant** sur clic, à partir des seuls chiffres : **compte rendu** (message clé, faits marquants, risques, pistes) ou **préparation** (objectif proposé, périmètre et capacité, arbitrages, points à clarifier, ordre du jour de la planification). Modifiables, **téléchargeables en Word**, et ajoutés au **journal d'un projet** en un clic. Les descriptions des tickets ne sont pas envoyées au modèle.

### 📄 Cahiers des charges (dans un projet)

- **Génération** à partir du projet et/ou d'une transcription brute : l'assistant fait le tri et rédige le CDC selon le modèle de l'équipe (Contexte obligatoire → sections adaptées au sujet → Annexes).
- **Champs** : titre et statut (obligatoires), phase du projet, prestataire, projet, estimation en jours/homme, échéances (plusieurs jalons datés). Échéances et estimation deviennent obligatoires pour passer en « Validé » ou « Envoyé ».
- **Questions de l'assistant** : liste priorisée (bloquante / importante / optionnelle) des points à préciser. On répond dans l'interface, puis on intègre les réponses : seules les sections concernées sont réécrites.
- **Validation par d'autres personnes** (onglet « Validations ») : du hub ou non (adresse e-mail saisie). Chacune reçoit un e-mail avec un lien personnel ; elle saisit son adresse, lit le CDC sans pouvoir le modifier et répond « validé » ou « non validé », avec un commentaire. Les réponses arrivent dans l'onglet et le journal du projet ; une non-validation n'est pas bloquante.
- **Nouvelles réunions** : une transcription supplémentaire est intégrée au CDC existant, et met à jour les questions.
- **Retravail ciblé** d'une section (« plus concis », consigne libre…).
- **Édition type Word** : sous-sections numérotées automatiquement (3.1, 3.2…), listes, tableaux, images collées directement.
- **Versionning** : chaque enregistrement crée une version (0.1, 0.2… puis 1.0 à la validation). On peut comparer deux versions, restaurer une version et exporter n'importe laquelle.
- **Exports Word et PDF** fidèles au modèle (bandeau Version / Échéance cible / Statut / Estimation).
- **Traduction** anglais / allemand, avec cache paragraphe par paragraphe.
- Les CDC se retrouvent dans l'onglet « Cahiers des charges » de leur projet ; un CDC créé avant le module Projets s'y **rattache** (« Rattacher un cahier des charges existant »).

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
- **Temps par prestataire** : chaque intervenant du relevé est rapproché du contact du même nom dans le carnet des prestataires (Paramétrage ; casse, accents et ordre prénom / nom indifférents) : son temps s'ajoute au contact et au prestataire (total et mois par mois, page Paramétrage). Un intervenant absent des carnets est signalé avant et après l'import (et, pour un export Desk, les personnes assignées inconnues) ; depuis le rapport du mois, un clic l'ajoute au carnet d'un prestataire.
- **Rapport du mois** : temps par intervenant, par ticket, par catégorie Desk et par thème, tickets créés (catégorie, cause, priorité, thème), activités hors ticket, comparaison avec le mois précédent, export Excel.
- **Thèmes et récurrences** : l'assistant attribue un thème à chaque ticket (« Chèques – erreur de montant / impayé »…) pour repérer les problèmes qui reviennent, mois par mois, avec le temps TMA associé.
- **Synthèse du mois** rédigée par l'assistant à partir des seuls chiffres calculés.
- **Confidentialité** : les fichiers sont lus dans le navigateur ; seules les colonnes utiles sont envoyées, après **masquage des données personnelles** (e-mails, téléphones, numéros de client / commande / chèque, noms après une civilité, noms des demandeurs, signatures). Un nom cité sans civilité au milieu d'une phrase peut subsister.
- **Coût** : classement des tickets par le modèle rapide, une seule fois par ticket (moins d'un euro pour un an de tickets) ; quelques centimes par synthèse. Les rapports eux-mêmes n'utilisent pas l'IA.

### 👥 Utilisateurs et connexion

- **Connexion** : page du hub en français (e-mail + mot de passe, puis code de l'application d'authentification ; première connexion avec choix du mot de passe et activation de la double authentification ; mot de passe oublié).
- **Utilisateurs** (administrateurs) : ajout (invitation par e-mail avec mot de passe temporaire), nom, **poste**, **backup** (un autre utilisateur), **périmètre** (ERP, Logistique, Sécurité, Réseau, Web ; plusieurs possibles), rôle, désactivation, renvoi de l'invitation. Le hub garde toujours au moins un administrateur actif.
- **Rôles** :

| Rôle | Droits |
|---|---|
| Administrateur | Gère les utilisateurs et leurs rôles ; voit et attribue les to-do et les notes de toute l'équipe ; lit et traite les retours ; connecte le hub à Teams |
| Responsable d'équipe | Voit les to-do de toute l'équipe et peut y ajouter des tâches pour chacun |
| Chargé de projet | Voit sa propre to-do et y ajoute ses tâches |

  Les projets, les tickets et les sprints, le lecteur de fichiers, le suivi TMA et le paramétrage restent ouverts à tous.
- À la création d'un utilisateur, les tickets qui le désignaient déjà en texte (nom ou adresse) lui sont rattachés ; un changement de nom se répercute dans les tickets.
- En local, pas de mot de passe : on se connecte avec une adresse e-mail (le premier compte devient administrateur).

### ⚙️ Paramétrage

Référentiels communs, modifiables par tous les utilisateurs :

- **Prestataires** : fiche (nom, activité, site, notes) et **carnet de contacts**. Une prestation se rattache obligatoirement à un prestataire de la liste (bouton « + » pour en créer un sans quitter le formulaire) ; l'en-tête des cahiers des charges le propose aussi. Un renommage se répercute dans tous les projets. Les doublons se **fusionnent** ; un prestataire utilisé s'**archive** (il n'est plus proposé, l'historique est conservé). Les noms saisis avant le paramétrage se reprennent d'un clic.
- **Intervenants liés au carnet** : dans un projet, un intervenant peut être choisi dans le carnet d'un prestataire ; nom, e-mail, téléphone et organisation restent alors à jour avec le carnet (le rôle et les notes restent propres au projet).
- **Statuts** (projets, prestations, risques, cahiers des charges) : libellé, ordre et visibilité. Le fonctionnement ne change pas (projet clos, montant engagé, risque clos…) ; les statuts qui le portent ne peuvent pas être masqués.
- **Libellés de jalons et rôles des intervenants** proposés à la saisie (texte libre toujours possible).
- **Teams** (administrateurs) : le hub publie des notifications dans un canal Teams de l'équipe. Dans Teams, menu ⋯ du canal → Workflows → « Publier dans un canal lorsqu'une demande de webhook est reçue », puis coller l'adresse obtenue : un message d'essai est envoyé aussitôt. Chaque notification s'active à part (sprint démarré, sprint clôturé, nouvelle idée, **mise en production** : à chaque déploiement, les nouveautés du patch note depuis la version précédente). L'adresse n'est plus affichée une fois enregistrée ; un envoi en échec ne bloque jamais l'action et s'affiche dans l'onglet.

### 📊 Consommation IA

Coût estimé du mois par opération, modèle et utilisateur, avec un **plafond mensuel** au-delà duquel les fonctions IA sont suspendues (l'édition manuelle reste possible).

### 📰 Patch note

- Dans le menu de l'utilisateur : les mises à jour du hub, de la plus récente à la plus ancienne (titre, date, détail des modifications). Une pastille signale une mise à jour pas encore vue.
- **Automatique** : chaque mise à jour du code (pull request fusionnée sur `main`) ajoute une entrée au prochain déploiement, tirée de l'historique git (titre de la pull request et messages de ses commits).

### 💬 Retours sur l'application

- **« Faire un retour »** dans le menu de l'utilisateur (son nom, en bas du menu latéral), sur toutes les pages : bug, idée ou remarque, avec la page en cours et l'auteur joints automatiquement.
- **Thème de couleur** dans le menu de l'utilisateur : chacun choisit un thème prédéfini (La Comté, vert, par défaut ; Bleu marine, Forêt, Bière ambrée, Framboise, Prune, Ardoise), appliqué tout de suite et retenu sur sa fiche (il le suit sur tous ses postes).
- Page **Retours** (menu de l'utilisateur, administrateurs) : retours à traiter / traités, note de suivi, réouverture, suppression.

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
