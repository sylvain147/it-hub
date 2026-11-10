/**
 * Point d'entrée Lambda du worker, invoqué de façon asynchrone :
 *  - par l'API pour les tâches IA (`jobId`) ;
 *  - par le déploiement pour annoncer la mise en production sur Teams (`release`, voir `notifications/release.ts`).
 */
import type { ReleaseNote } from '@samm/shared';
import { runJob } from './jobs/runner.js';
import { notifyRelease } from './notifications/release.js';

export const handler = async (event: { jobId?: string; release?: ReleaseNote[] }) => {
  if (event.release) {
    await notifyRelease(event.release);
    return;
  }
  if (!event.jobId) throw new Error('jobId manquant');
  await runJob(event.jobId);
};
