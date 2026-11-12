import { LANGUAGE_LABELS, TRANSLATION_LANGUAGES, type JobInfo, type TranslationLanguage } from '@samm/shared';
import { api, download } from '../api';
import { useLoad } from '../hooks';
import { Spinner, formatDateTime, toast } from '../components/ui';
import { withAiRecap } from '../assistant/AiRecap';

interface Props {
  cdcId: string;
  currentLabel: string;
  refreshKey: number;
  aiDisabledReason: string | null;
  onJob: (j: JobInfo) => void;
}

export function TranslationsPanel({ cdcId, currentLabel, refreshKey, aiDisabledReason, onJob }: Props) {
  const { data, loading } = useLoad(() => api.listTranslations(cdcId), [cdcId, refreshKey]);

  async function translate(lang: TranslationLanguage) {
    try {
      const started = await withAiRecap(() => api.translate(cdcId, lang));
      // Annulé au récapitulatif : rien n'est lancé, la saisie est gardée.
      if (!started) return;
      onJob(started);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function exportTr(lang: TranslationLanguage, format: 'docx' | 'pdf') {
    try {
      const res = await api.exportCdc(cdcId, { format, lang });
      download(res.url, res.fileName);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="panel-body">
      <p className="muted small">
        La traduction porte sur la version enregistrée. Elle est mise en cache paragraphe par paragraphe : une mise à jour ne retraduit que ce qui a
        changé.
      </p>
      {loading && !data ? (
        <Spinner />
      ) : (
        TRANSLATION_LANGUAGES.map((lang) => {
          const tr = data?.find((t) => t.lang === lang);
          return (
            <div key={lang} className="card-flat translation">
              <div className="translation-head">
                <strong>{LANGUAGE_LABELS[lang]}</strong>
                {tr ? (
                  tr.outdated ? (
                    <span className="badge status-en_revue">Obsolète (v{tr.versionLabel})</span>
                  ) : (
                    <span className="badge status-valide">À jour (v{tr.versionLabel})</span>
                  )
                ) : (
                  <span className="muted small">Pas encore traduit</span>
                )}
              </div>
              {tr && <div className="muted small">Traduit le {formatDateTime(tr.createdAt)}</div>}
              <div className="row-actions">
                {(!tr || tr.outdated) && (
                  <button className="btn btn-sm btn-ai" disabled={!!aiDisabledReason} title={aiDisabledReason ?? ''} onClick={() => translate(lang)}>
                    ✨ {tr ? `Mettre à jour (v${currentLabel})` : 'Traduire'}
                  </button>
                )}
                {tr && (
                  <>
                    <button className="btn btn-sm" onClick={() => exportTr(lang, 'docx')}>Word</button>
                    <button className="btn btn-sm" onClick={() => exportTr(lang, 'pdf')}>PDF</button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
