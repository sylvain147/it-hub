import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobInfo } from '@samm/shared';
import { api } from './api';

/** Chargement asynchrone simple avec rechargement. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  /** Recharge ; renvoie les nouvelles données (null en cas d'erreur). */
  const reload = useCallback(async (): Promise<T | null> => {
    setLoading(true);
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, setData, error, loading, reload };
}

/** Suit une tâche IA jusqu'à sa fin. */
export function useJobPolling(jobId: string | null, onDone: (job: JobInfo) => void) {
  const [job, setJob] = useState<JobInfo | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await api.getJob(jobId);
        if (!alive) return;
        setJob(j);
        if (j.status === 'termine' || j.status === 'erreur') {
          onDoneRef.current(j);
          return;
        }
      } catch {
        /* réseau : on réessaie */
      }
      timer = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);
  return job;
}
