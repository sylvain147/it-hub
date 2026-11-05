# Architecture

```
Navigateur ──HTTPS──> CloudFront ─┬─ /*      → S3 (front React)
                                  └─ /api/*  → API Gateway HTTP ──(jeton Cognito vérifié)──> Lambda « API »
                                                                                              │  invocation asynchrone
                                                                                              ▼
                                                                                         Lambda « worker » ──> Bedrock (Claude)
             DynamoDB (fiches, versions, questions, jobs, conso) · S3 (contenus des versions, transcriptions, images, exports)
```

- **100 % serverless** : rien ne tourne (ni ne coûte) quand personne n'utilise l'application.
- **Authentification** : Cognito, sans inscription libre, **MFA TOTP obligatoire**. L'API Gateway refuse toute requête sans jeton valide.
- **Tâches IA asynchrones** : une génération peut dépasser la limite de 30 s d'API Gateway. L'API crée un *job*, réserve le CDC (une seule tâche à la fois par CDC) et invoque le worker ; le navigateur suit l'avancement. L'édition est suspendue pendant la tâche.
- **Images** : stockées dans le bucket privé, envoyées directement par le navigateur (URL pré-signée), référencées dans les documents par `asset:<cdc>/<id>` et affichées via des URL temporaires.

## Modèle de données (DynamoDB, table unique)

| pk | sk | Contenu |
|---|---|---|
| `CDC#<id>` | `META` | Fiche : métadonnées, version courante, job actif (index `gsi1` pour la liste) |
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

## Module « Suivi TMA »

- **Lecture des fichiers dans le navigateur** (`packages/shared/src/tma/`) : export Desk (`desk.ts`, CSV avec retours à la ligne dans les champs), relevé TMA (`activity.ts`, via `readXlsx`), masquage des données personnelles (`mask.ts`). Seuls les champs utiles, masqués, partent au serveur.
- **Rapports calculés par le code** (`report.ts`), partagés entre l'API et les tests : temps par ticket / intervenant / thème, tickets créés, comparaison avec le mois précédent, récurrences par thème.
- **IA** (`apps/api/src/tma/jobs.ts`) : classement par thème (modèle rapide, lots de 40, seulement les tickets non classés ; les thèmes existants sont fournis pour rester cohérents) et synthèse mensuelle (modèle de rédaction, entrée = chiffres du mois en Markdown, quelques Ko).

| pk | sk | Contenu |
|---|---|---|
| `TMA#DESK` | `META` | Dernier import Desk, job de classement actif |
| `TMA#DESK` | `TKT#<n°>` | Ticket Desk (champs utiles, textes masqués, thème) |
| `TMA#MONTH#<AAAA-MM>` | `META` | Relevé du mois (+ index `gsi1`), synthèse IA ; lignes dans S3 (`tma/months/<mois>.json`) |

## Ajouter un module au hub

1. Créer les pages dans `apps/web/src/pages/` (ou un dossier dédié), et les routes dans `apps/web/src/main.tsx`.
2. Déclarer le module dans `apps/web/src/modules.ts` (il apparaît dans le menu et sur l'accueil).
3. Ajouter les routes d'API dans `apps/api/src/app.ts` (ou un routeur dédié monté sous `/api`) et les entités DynamoDB avec un nouveau préfixe de `pk` dans `apps/api/src/db/`.
4. Si le module utilise l'IA : passer par `callStructured` (`apps/api/src/ai/llm.ts`) pour bénéficier du suivi de consommation et du budget.
