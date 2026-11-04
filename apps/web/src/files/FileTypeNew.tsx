import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { buildExcerpt, MAX_DOCUMENTS_CHARS } from '@samm/shared';
import { api } from '../api';
import { ErrorBox, Spinner, toast } from '../components/ui';
import { decodeGuess, documentToText, formatSize, readLocalFile, session, type LocalFile } from './local';

export function FileTypeNew() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [sample, setSample] = useState<LocalFile | null>(() => session.samples.get('nouveau') ?? null);
  const [docs, setDocs] = useState<{ name: string; text: string }[]>([]);
  const [anonymize, setAnonymize] = useState(true);
  const [keepPrefix, setKeepPrefix] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showExcerpt, setShowExcerpt] = useState(false);

  useEffect(() => {
    if (sample && !name) setName(sample.name.replace(/[_-]?\d{6,}.*$/, '').replace(/\.[^.]+$/, ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample]);

  const decoded = useMemo(() => (sample ? decodeGuess(sample) : null), [sample]);
  const firstLine = decoded?.text.split(/\r?\n/, 1)[0] ?? '';
  const looksCsv = /[;,\t|]/.test(firstLine) && /[A-Za-z]/.test(firstLine);
  const excerpt = useMemo(
    () => (decoded ? buildExcerpt(decoded.text, { anonymize, keepPrefix, keepFirstLine: looksCsv }) : null),
    // Recalculé seulement si les options changent (l'anonymisation est aléatoire).
    [decoded, anonymize, keepPrefix, looksCsv],
  );
  const docsChars = docs.reduce((n, d) => n + d.text.length, 0);

  async function addDocs(files: FileList | null) {
    for (const f of [...(files ?? [])]) {
      try {
        const d = await documentToText(f);
        setDocs((xs) => [...xs, d]);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
  }

  async function submit() {
    if (!excerpt) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createFileType({ name: name.trim(), description, notes, sampleFileName: sample?.name ?? '', excerpt: excerpt.text, anonymized: anonymize, documents: docs });
      // L'exemple complet reste dans le navigateur pour tester la fiche dès qu'elle est prête.
      if (sample) session.samples.set(res.id, sample);
      session.samples.delete('nouveau');
      navigate(`/fichiers/types/${res.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1>Nouveau type de fichier</h1>
      <p className="muted">
        Donnez un fichier exemple et tout ce que vous savez sur le format. L’assistant prépare une <strong>fiche de lecture</strong> que vous pourrez tester
        et corriger ; ensuite, tous les fichiers de ce type sont décortiqués instantanément, sans IA.
      </p>
      <ErrorBox error={error} />
      <div className="card form-grid">
        <label className="field span-2">
          <span>Nom du type *</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Factures à plat Weiden" />
        </label>
        <label className="field span-2">
          <span>Description</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ex. Fichier quotidien déposé sur le FTP Weiden" />
        </label>

        <div className="field span-2">
          <span>Fichier exemple *</span>
          <input
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setSample(await readLocalFile(f));
            }}
          />
          {sample && decoded && (
            <span className="muted small">
              {sample.name} — {formatSize(sample.size)}, {excerpt?.totalLines.toLocaleString('fr-FR')} lignes, encodage détecté : {decoded.encoding}
            </span>
          )}
        </div>

        <div className="field span-2">
          <span>Documentation et code source (facultatif)</span>
          <input type="file" multiple accept=".xlsx,.csv,.txt,.sql,.pls,.pkb,.pks,.prc,.java,.js,.ts,.py,.cbl,.md,.json,.xml" onChange={(e) => void addDocs(e.target.files)} />
          <span className="muted small">Spécification Excel (.xlsx), code qui génère le fichier (PL/SQL, Java…), notes. Convertis en texte sur votre poste.</span>
          {docs.map((d, i) => (
            <div key={i} className="doc-chip">
              📎 {d.name} <span className="muted small">({d.text.length.toLocaleString('fr-FR')} caractères)</span>
              <button className="btn-icon" onClick={() => setDocs(docs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {docsChars > MAX_DOCUMENTS_CHARS && <div className="alert alert-error">Documentation trop volumineuse ({docsChars.toLocaleString('fr-FR')} caractères, maximum {MAX_DOCUMENTS_CHARS.toLocaleString('fr-FR')}).</div>}
        </div>

        <label className="field span-2">
          <span>Explications (en vrac)</span>
          <textarea
            className="input"
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ex. Les 2 premiers caractères donnent le type de ligne. 12 = en-tête de facture, 21 = ligne d’article. Les montants sont en centimes. Le fichier finit par une ligne 99 avec le nombre de factures."
          />
        </label>

        {excerpt && (
          <div className="field span-2 excerpt-box">
            <span>Ce qui est envoyé à l’assistant</span>
            <label className="check">
              <input type="checkbox" checked={anonymize} onChange={(e) => setAnonymize(e.target.checked)} /> Anonymiser l’extrait (recommandé : lettres et chiffres remplacés au hasard,
              longueurs, dates et codes courts conservés)
            </label>
            {anonymize && (
              <label className="check">
                Caractères conservés en début de ligne (zone du code d’enregistrement) :
                <input className="input input-xs" type="number" min={0} max={40} value={keepPrefix} onChange={(e) => setKeepPrefix(Number(e.target.value) || 0)} />
              </label>
            )}
            <span className="muted small">
              {excerpt.lines.length} lignes sur {excerpt.totalLines.toLocaleString('fr-FR')} (début du fichier, quelques lignes de chaque forme, fin du fichier). Le reste du fichier ne
              quitte pas votre poste.{' '}
              <button className="btn-link small" onClick={() => setShowExcerpt(!showExcerpt)}>{showExcerpt ? 'Masquer' : 'Voir l’extrait'}</button>
            </span>
            {showExcerpt && <pre className="notes raw">{excerpt.text}</pre>}
          </div>
        )}
      </div>
      <p className="muted small">
        Coût indicatif : quelques centimes, une seule fois par type de fichier (la documentation est lue par le modèle économique, la vérification par le modèle de rédaction).
      </p>
      <div className="actions">
        <button className="btn" onClick={() => navigate('/fichiers')}>Annuler</button>
        <button className="btn btn-primary" disabled={busy || !name.trim() || !excerpt?.text || docsChars > MAX_DOCUMENTS_CHARS} onClick={submit}>
          {busy ? <Spinner small /> : '✨'} Créer la fiche de lecture
        </button>
      </div>
    </div>
  );
}
