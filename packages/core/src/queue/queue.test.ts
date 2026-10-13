import { describe, expect, it } from 'vitest';
import { QuotaExhaustedError } from '../llm/errors.ts';
import { backoffMs, dispatch, JobRegistry, type Job, type QueueStore } from './queue.ts';

function store(jobs: Job[]) {
  const log: string[] = [];
  const s: QueueStore = {
    async claim() {
      return jobs;
    },
    async complete(id) {
      log.push(`done:${id}`);
    },
    async retry(id, runAfter, _e, countAttempt) {
      log.push(`retry:${id}:${runAfter.getTime()}:${countAttempt}`);
    },
    async dead(id) {
      log.push(`dead:${id}`);
    },
  };
  return { s, log };
}

const job = (id: string, type: string, attempts = 1): Job => ({
  id,
  tenant_id: 't',
  type,
  payload: {},
  attempts,
  max_attempts: 3,
});

describe('dispatch', () => {
  it('runs handlers and marks results', async () => {
    const reg = new JobRegistry()
      .register('ok', async () => {})
      .register('boom', async () => {
        throw new Error('x');
      });
    const { s, log } = store([
      job('1', 'ok'),
      job('2', 'boom', 1),
      job('3', 'boom', 3),
      job('4', 'unknown'),
    ]);
    const r = await dispatch({ store: s, registry: reg, worker: 'w', limit: 10, now: () => 0 });
    expect(r).toEqual({ done: 1, retried: 1, dead: 2 });
    expect(log).toEqual(['done:1', `retry:2:${backoffMs(1)}:true`, 'dead:3', 'dead:4']);
  });

  it('requeues quota-exhausted jobs without burning an attempt', async () => {
    const reg = new JobRegistry().register('llm', async () => {
      throw new QuotaExhaustedError(60);
    });
    const { s, log } = store([job('1', 'llm', 3)]);
    await dispatch({ store: s, registry: reg, worker: 'w', limit: 10, now: () => 1000 });
    expect(log).toEqual(['retry:1:61000:false']);
  });

  it('backoff grows and caps at one hour', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });

  it('rejects duplicate handlers', () => {
    expect(() =>
      new JobRegistry().register('a', async () => {}).register('a', async () => {}),
    ).toThrow();
  });
});
