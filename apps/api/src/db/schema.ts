/**
 * Modèle « single table » DynamoDB.
 *
 *  pk                  sk                       entité
 *  CDC#<id>            META                     fiche du CDC (+ GSI1 pour la liste)
 *  CDC#<id>            VER#<seq 10 chiffres>    version (contenu dans le bucket)
 *  CDC#<id>            Q#<id>                   question de l'assistant
 *  CDC#<id>            SRC#<id>                 transcription (texte brut dans le bucket)
 *  CDC#<id>            TR#<lang>                traduction (contenu dans le bucket)
 *  JOB#<id>            JOB                      tâche IA asynchrone (TTL)
 *  TRC#<hash>          TRC                      cache de traduction par bloc (TTL)
 *  USAGE#<AAAA-MM>     TOTAL | OP#… | MODEL#… | USER#…   compteurs mensuels
 *  USAGE#<AAAA-MM>     CALL#<id>                détail d'un appel IA
 */
export const keys = {
  cdc: (id: string) => ({ pk: `CDC#${id}`, sk: 'META' }),
  version: (id: string, seq: number) => ({ pk: `CDC#${id}`, sk: `VER#${String(seq).padStart(10, '0')}` }),
  question: (id: string, qid: string) => ({ pk: `CDC#${id}`, sk: `Q#${qid}` }),
  source: (id: string, sid: string) => ({ pk: `CDC#${id}`, sk: `SRC#${sid}` }),
  translation: (id: string, lang: string) => ({ pk: `CDC#${id}`, sk: `TR#${lang}` }),
  job: (id: string) => ({ pk: `JOB#${id}`, sk: 'JOB' }),
  translationCache: (hash: string) => ({ pk: `TRC#${hash}`, sk: 'TRC' }),
  usage: (month: string, sk: string) => ({ pk: `USAGE#${month}`, sk }),
};

export const GSI1 = 'gsi1';
export const CDC_LIST_PK = 'CDC';

export const blobKeys = {
  version: (id: string, seq: number, rand: string) => `cdc/${id}/versions/${String(seq).padStart(10, '0')}-${rand}.json`,
  source: (id: string, sid: string) => `cdc/${id}/sources/${sid}.txt`,
  translation: (id: string, lang: string, seq: number) => `cdc/${id}/translations/${lang}-${seq}.json`,
  asset: (id: string, assetId: string) => `cdc/${id}/assets/${assetId}`,
  export: (id: string, name: string) => `exports/${id}/${name}`,
};

/** TTL DynamoDB (secondes epoch). */
export function ttlInDays(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 86400;
}
