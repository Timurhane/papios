import { QuotaExhaustedError } from '../llm/errors.ts';

export interface Job {
  id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface QueueStore {
  claim(worker: string, heavy: boolean, limit: number): Promise<Job[]>;
  complete(id: string): Promise<void>;
  /** Back to queued at runAfter. `countAttempt=false` undoes the claim's attempt increment. */
  retry(id: string, runAfter: Date, error: string, countAttempt: boolean): Promise<void>;
  dead(id: string, error: string): Promise<void>;
}

export type JobHandler = (job: Job) => Promise<void>;

export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(type: string, handler: JobHandler): this {
    if (this.handlers.has(type)) throw new Error(`duplicate job handler: ${type}`);
    this.handlers.set(type, handler);
    return this;
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}

/** Exponential backoff: 1, 2, 4 ... minutes, capped at one hour. */
export function backoffMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

export interface DispatchResult {
  done: number;
  retried: number;
  dead: number;
}

export async function dispatch(opts: {
  store: QueueStore;
  registry: JobRegistry;
  worker: string;
  heavy?: boolean;
  limit: number;
  now?: () => number;
  onDead?: (job: Job, error: string) => Promise<void>;
}): Promise<DispatchResult> {
  const now = opts.now ?? Date.now;
  const result: DispatchResult = { done: 0, retried: 0, dead: 0 };
  const jobs = await opts.store.claim(opts.worker, opts.heavy ?? false, opts.limit);

  for (const job of jobs) {
    const handler = opts.registry.get(job.type);
    if (!handler) {
      await opts.store.dead(job.id, `no handler for job type ${job.type}`);
      result.dead++;
      await opts.onDead?.(job, `no handler for job type ${job.type}`);
      continue;
    }
    try {
      await handler(job);
      await opts.store.complete(job.id);
      result.done++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 1000) : String(err);
      if (err instanceof QuotaExhaustedError) {
        // Out of quota is not the job's fault: wait and retry without burning an attempt.
        await opts.store.retry(
          job.id,
          new Date(now() + err.retryAfterSeconds * 1000),
          message,
          false,
        );
        result.retried++;
      } else if (job.attempts >= job.max_attempts) {
        await opts.store.dead(job.id, message);
        result.dead++;
        await opts.onDead?.(job, message);
      } else {
        await opts.store.retry(job.id, new Date(now() + backoffMs(job.attempts)), message, true);
        result.retried++;
      }
    }
  }
  return result;
}
