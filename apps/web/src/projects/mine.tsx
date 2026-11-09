import { useState } from 'react';
import { isMyProject, type ProjectSummary } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { toast } from '../components/ui';

const MINE_KEY = 'hub.mes-projets';

/**
 * Filtre « Mes projets » (chef de projet ou projet suivi), partagé par toutes les pages liées aux projets :
 * le choix est retenu sur le poste et retrouvé d'une page à l'autre.
 */
export function useMyProjectsFilter(): [boolean, (v: boolean) => void] {
  const [mine, setMine] = useState(() => localStorage.getItem(MINE_KEY) === '1');
  return [
    mine,
    (v: boolean) => {
      localStorage.setItem(MINE_KEY, v ? '1' : '0');
      setMine(v);
    },
  ];
}

/** Case à cocher « Mes projets ». */
export function MyProjectsCheck({ mine, setMine }: { mine: boolean; setMine: (v: boolean) => void }) {
  return (
    <label className="check" title="Les projets dont je suis le chef de projet et ceux que je suis">
      <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mes projets
    </label>
  );
}

/** Identifiants de mes projets, parmi une liste de projets. */
export function myProjectIds(projects: Pick<ProjectSummary, 'id' | 'chefDeProjetIds' | 'followers'>[] | null | undefined, email: string): Set<string> {
  return new Set((projects ?? []).filter((p) => isMyProject(p, email)).map((p) => p.id));
}

/** Bouton « Suivre » d'un projet (ses chefs de projet le comptent déjà parmi les leurs). */
export function FollowButton({ project, onChange, small }: { project: Pick<ProjectSummary, 'id' | 'chefDeProjetIds' | 'followers'>; onChange: (followers: string[]) => void; small?: boolean }) {
  const { email } = useAuth();
  const [busy, setBusy] = useState(false);
  const following = project.followers.includes(email);
  if (project.chefDeProjetIds.includes(email) && !following) return null;
  async function toggle() {
    setBusy(true);
    try {
      const { followers } = await api.followProject(project.id, !following);
      onChange(followers);
      toast(following ? 'Vous ne suivez plus ce projet.' : 'Projet suivi : il apparaît dans « Mes projets ».');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      className={`btn${small ? ' btn-sm btn-ghost' : ''}${following ? ' btn-following' : ''}`}
      disabled={busy}
      onClick={toggle}
      title={following ? 'Ne plus suivre ce projet' : 'Suivre ce projet : il comptera parmi « Mes projets » (planning, sprints, cahiers des charges…)'}
      aria-pressed={following}
    >
      {following ? '★ Suivi' : '☆ Suivre'}
    </button>
  );
}
