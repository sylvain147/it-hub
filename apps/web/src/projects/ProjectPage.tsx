import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { JOB_TYPE_LABELS, type JobInfo, type ProjectDetail } from '@samm/shared';
import { api } from '../api';
import { useJobPolling } from '../hooks';
import { ErrorBox, Spinner, formatDateTime, shortUser, toast } from '../components/ui';
import { HealthBadge, PriorityTag, ProjectProvider, ProjectStatusBadge } from './common';
import { OverviewTab } from './OverviewTab';
import { TicketsTab } from './TicketsTab';
import { PlanningTab } from './PlanningTab';
import { PrestationsTab } from './PrestationsTab';
import { ContactsTab } from './ContactsTab';
import { DocumentsTab } from './DocumentsTab';
import { JournalTab } from './JournalTab';
import { RisksTab } from './RisksTab';
import { CdcTab } from './CdcTab';

const TABS = [
  { id: 'apercu', label: 'Aperçu' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'planning', label: 'Planning' },
  { id: 'prestations', label: 'Prestations' },
  { id: 'cdc', label: 'Cahiers des charges' },
  { id: 'intervenants', label: 'Intervenants' },
  { id: 'documents', label: 'Documents' },
  { id: 'journal', label: 'Journal' },
  { id: 'risques', label: 'Risques' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ProjectPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Ancienne adresse de l'onglet des tickets : « taches ».
  const asked = params.get('onglet') === 'taches' ? 'tickets' : params.get('onglet');
  const tab = (TABS.some((t) => t.id === asked) ? asked : 'apercu') as TabId;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const p = await api.getProject(id);
      setProject(p);
      setJobId((cur) => cur ?? p.activeJobId);
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Sur mobile, la barre d'onglets défile : on garde l'onglet actif visible.
  useEffect(() => {
    document.querySelector('.tabs-scroll .tab.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [tab, project === null]);

  const job = useJobPolling(jobId, async (j) => {
    setJobId(null);
    if (j.status === 'termine') toast(`${JOB_TYPE_LABELS[j.type]} : ${j.step.charAt(0).toLowerCase()}${j.step.slice(1)}.`);
    else toast(`${JOB_TYPE_LABELS[j.type]} : ${j.error}`, 'error');
    await reload();
  });

  const goTab = useCallback(
    (t: string) => {
      setParams(t === 'apercu' ? {} : { onglet: t }, { replace: true });
      window.scrollTo({ top: 0 });
    },
    [setParams],
  );

  if (loadError) {
    return (
      <div className="page">
        <ErrorBox error={loadError} />
        <Link to="/projets">← Retour aux projets</Link>
      </div>
    );
  }
  if (!project) return <div className="page"><Spinner /></div>;

  const s = project.stats;
  const counts: Partial<Record<TabId, { n: number; warn?: boolean }>> = {
    tickets: { n: s.openTasks, warn: s.overdueTasks > 0 },
    planning: { n: project.items.jalons.length, warn: s.lateJalons > 0 },
    prestations: { n: project.items.prestations.length },
    intervenants: { n: s.contacts },
    documents: { n: s.files + s.links },
    journal: { n: s.notes, warn: project.items.notes.some((n) => n.suggestions && hasPending(n.suggestions)) },
    risques: { n: s.openRisks, warn: s.maxRiskScore >= 6 },
    cdc: { n: project.cdcs.length },
  };

  const onJob = (j: JobInfo) => {
    setJobId(j.id);
    toast(`${JOB_TYPE_LABELS[j.type]} lancée…`, 'info');
  };

  return (
    <ProjectProvider value={{ project, setProject, reload, jobBusy: !!jobId, onJob, goTab }}>
      <div className="page page-wide project-page">
        <Link to="/projets" className="muted small">← Projets</Link>
        <div className="project-head">
          <div>
            <h1>
              {project.name} {project.code && <span className="muted project-code">{project.code}</span>}
            </h1>
            <div className="project-badges">
              <ProjectStatusBadge status={project.status} />
              <HealthBadge health={project.health} />
              <PriorityTag priority={project.priority} hideNormal />
              {project.tags.map((t) => <span key={t} className="badge tag">{t}</span>)}
              <span className="muted small">Modifié le {formatDateTime(project.updatedAt)} par {shortUser(project.updatedBy)}</span>
            </div>
          </div>
          <div className="row-actions">
            <button className="btn" onClick={() => navigate(`/projets/${project.id}?onglet=journal&analyser=1`)} disabled={!!jobId}>📝 Analyser une réunion</button>
            <button className="btn btn-primary" onClick={() => goTab('cdc')}>📄 Cahier des charges</button>
          </div>
        </div>

        {job && jobId && (
          <div className="job-banner job-banner-inline">
            <Spinner small /> <strong>{JOB_TYPE_LABELS[job.type]}</strong> — {job.step}
            <span className="muted small"> · vous pouvez continuer à travailler sur le projet</span>
          </div>
        )}

        <div className="tabs tabs-page tabs-scroll">
          {TABS.map((t) => {
            const c = counts[t.id];
            return (
              <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => goTab(t.id)}>
                {t.label} {c && c.n > 0 && <span className={c.warn ? 'pill pill-warn' : 'pill pill-muted'}>{c.n}</span>}
              </button>
            );
          })}
        </div>
        <div className="tab-content">
          {tab === 'apercu' && <OverviewTab />}
          {tab === 'tickets' && <TicketsTab />}
          {tab === 'planning' && <PlanningTab />}
          {tab === 'prestations' && <PrestationsTab />}
          {tab === 'intervenants' && <ContactsTab />}
          {tab === 'documents' && <DocumentsTab />}
          {tab === 'journal' && <JournalTab />}
          {tab === 'risques' && <RisksTab />}
          {tab === 'cdc' && <CdcTab />}
        </div>
      </div>
    </ProjectProvider>
  );
}

export function hasPending(s: NonNullable<ProjectDetail['items']['notes'][number]['suggestions']>) {
  return [...s.tasks, ...s.jalons, ...s.risks].some((x) => x.state === 'proposee');
}
