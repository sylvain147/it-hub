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

## Ajouter un module au hub

1. Créer les pages dans `apps/web/src/pages/` (ou un dossier dédié), et les routes dans `apps/web/src/main.tsx`.
2. Déclarer le module dans `apps/web/src/modules.ts` (il apparaît dans le menu et sur l'accueil).
3. Ajouter les routes d'API dans `apps/api/src/app.ts` (ou un routeur dédié monté sous `/api`) et les entités DynamoDB avec un nouveau préfixe de `pk` dans `apps/api/src/db/`.
4. Si le module utilise l'IA : passer par `callStructured` (`apps/api/src/ai/llm.ts`) pour bénéficier du suivi de consommation et du budget.
