import { dispatch } from '@papi/core';
import type { AppDeps } from './deps.ts';
import { buildRegistry, scheduledJobs } from './jobs/handlers.ts';
import { notify } from './notify.ts';

/** Light jobs per tick: each may use several subrequests (Workers free: 50 per invocation). */
const JOBS_PER_TICK = 3;

export async function runCron(deps: AppDeps, now: Date): Promise<void> {
  const jobDeps = { repo: deps.repo, llm: deps.llm, tg: deps.tg, ownerChatId: deps.ownerId };
  for (const job of scheduledJobs(now))
    await deps.repo.enqueue(job.type, job.payload, { unique: true });
  await dispatch({
    store: deps.repo.queueStore,
    registry: buildRegistry(jobDeps),
    worker: 'worker-cron',
    limit: JOBS_PER_TICK,
    onDead: async (job, error) => {
      await deps.repo.recordError(
        'queue',
        'error',
        `job ${job.type} failed permanently: ${error}`,
        { job_id: job.id },
      );
      await notify(jobDeps, 'system_error', `⚠️ Bir iş kalıcı olarak başarısız oldu: ${job.type}`);
    },
  });
}
