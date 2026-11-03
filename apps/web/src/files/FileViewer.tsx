import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorBox, Spinner } from '../components/ui';
import { session } from './local';
import { AnomaliesView, RawView, StructuredView, Summary, TablesView, exportToExcel, useParsed } from './ParsedView';

type Tab = 'structure' | 'tables' | 'anomalies' | 'raw';

export function FileViewer() {
  const reading = session.reading;
  const { data: type, error } = useLoad(() => (reading ? api.getFileType(reading.typeId) : Promise.resolve(null)), [reading?.typeId]);
  const parsed = useParsed(type?.spec ?? null, reading?.file ?? null);
  const [tab, setTab] = useState<Tab>('structure');

  // Le fichier n'est gardé qu'en mémoire : après un rechargement de page, il faut le redéposer.
  if (!reading) return <Navigate to="/fichiers" replace />;

  const r = parsed?.result;
  const anomalies = r ? r.unknown.length + r.fieldErrorCount + r.checks.filter((c) => !c.ok).length : 0;
  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <Link to="/fichiers" className="muted small">← Lecteur de fichiers</Link>
          <h1>{reading.file.name}</h1>
          {type && (
            <div className="muted small">
              Lu comme <Link to={`/fichiers/types/${type.id}`}>{type.name}</Link> (fiche v{type.currentVersion?.label})
            </div>
          )}
        </div>
        {r && (
          <button className="btn" onClick={() => exportToExcel(r, reading.file.name)}>
            Exporter en Excel
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {!parsed || !r ? (
        <Spinner />
      ) : (
        <>
          <section className="card">
            <Summary parsed={parsed} fileName={reading.file.name} />
          </section>
          <div className="tabs tabs-page">
            <button className={tab === 'structure' ? 'tab active' : 'tab'} onClick={() => setTab('structure')}>Vue structurée</button>
            <button className={tab === 'tables' ? 'tab active' : 'tab'} onClick={() => setTab('tables')}>Tableaux</button>
            <button className={tab === 'anomalies' ? 'tab active' : 'tab'} onClick={() => setTab('anomalies')}>
              Anomalies {anomalies > 0 && <span className="pill pill-warn">{anomalies.toLocaleString('fr-FR')}</span>}
            </button>
            <button className={tab === 'raw' ? 'tab active' : 'tab'} onClick={() => setTab('raw')}>Contenu brut</button>
          </div>
          <section className="card card-tabbed">
            {tab === 'structure' && <StructuredView result={r} />}
            {tab === 'tables' && <TablesView result={r} />}
            {tab === 'anomalies' && <AnomaliesView result={r} />}
            {tab === 'raw' && <RawView result={r} />}
          </section>
          {anomalies > 0 && type && (
            <p className="muted small">
              Des lignes ne sont pas comprises ? Ouvrez la <Link to={`/fichiers/types/${type.id}`}>fiche de lecture</Link> et demandez un ajustement à l’assistant avec ce fichier.
            </p>
          )}
        </>
      )}
    </div>
  );
}
