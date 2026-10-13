import { dispatch } from '@papi/core';
import type { AppDeps } from './deps.ts';
import { buildRegistry, scheduledJobs } from './jobs/handlers.ts';
import { notify } from './notify.ts';
import { runOutreachStep } from './outreach.ts';

/** Light jobs per tick: each may use several subrequests (Workers free: 50 per invocation). */
const JOBS_PER_TICK = 1;
/** Minimum gap between starts of the heavy-jobs workflow (Actions minutes budget, K-3.17). */
const HEAVY_DISPATCH_GAP_MS = 10 * 60_000;

export async function runCron(deps: AppDeps, now: Date): Promise<void> {
  const jobDeps = {
    repo: deps.repo,
    llm: deps.llm,
    tg: deps.tg,
    ownerChatId: deps.ownerId,
    instagram: deps.instagram ?? null,
    pageSpeedKey: deps.pageSpeedKey,
    panelUrl: deps.panelUrl,
  };
  for (const job of scheduledJobs(now))
    await deps.repo.enqueue(job.type, job.payload, { unique: true });
  const r = await dispatch({
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
  // Outreach runs only when no job used this invocation's budget (Workers: 50 subrequests).
  if (r.done + r.retried + r.dead === 0 && deps.outreach) {
    try {
      await runOutreachStep(
        { repo: deps.repo, tg: deps.tg, ownerChatId: deps.ownerId, outreach: deps.outreach },
        now,
      );
    } catch (err) {
      await deps.repo.recordError(
        'outreach',
        'error',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  await kickHeavyWorker(deps, now);
}

/** Starts the Actions worker when heavy jobs wait, at most once per HEAVY_DISPATCH_GAP_MS. */
export async function kickHeavyWorker(deps: AppDeps, now: Date): Promise<boolean> {
  if (!deps.dispatchHeavy) return false;
  if ((await deps.repo.countQueuedJobs(true)) === 0) return false;
  const last = await deps.repo.getState<{ at: string }>('heavy_dispatch');
  if (last && now.getTime() - Date.parse(last.at) < HEAVY_DISPATCH_GAP_MS) return false;
  await deps.repo.setState('heavy_dispatch', { at: now.toISOString() });
  try {
    await deps.dispatchHeavy();
    return true;
  } catch (err) {
    await deps.repo.recordError(
      'actions',
      'warning',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}
