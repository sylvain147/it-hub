/** Point d'entrée Lambda des tâches IA (invoquée de façon asynchrone par l'API). */
import { runJob } from './jobs/runner.js';

export const handler = async (event: { jobId?: string }) => {
  if (!event.jobId) throw new Error('jobId manquant');
  await runJob(event.jobId);
};
