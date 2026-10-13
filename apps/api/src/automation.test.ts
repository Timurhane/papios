import { DisabledCalendar } from '@papi/server';
import { describe, expect, it } from 'vitest';
import { handleUpdate } from './bot.ts';
import { runCron } from './cron.ts';
import type { AppDeps } from './deps.ts';
import { notify } from './notify.ts';
import { runPanelAction } from './panel-api.ts';
import { callbackUpdate, OWNER, setup, textUpdate } from './test/fakes.ts';

function appDeps(ctx: ReturnType<typeof setup>): AppDeps {
  return {
    ...ctx.deps,
    automation: {
      repo: ctx.repo,
      llm: ctx.llm,
      notify: async (kind, text) => {
        await notify({ repo: ctx.repo, tg: ctx.tg, ownerChatId: OWNER }, kind, text);
      },
    },
  };
}

describe('Phase 6 acceptance', () => {
  it('/uyuyorum starts the night shift, the cron searches for leads, /uyandim summarises it', async () => {
    const ctx = setup();
    await handleUpdate(textUpdate(OWNER, '/uyuyorum'), ctx.deps);
    expect(ctx.tg.texts()[0]).toContain('gece vardiyası başladı');

    // 01:30 Istanbul: quiet, minute % 30 === 0 → one OSM search (area × sector) is queued for Actions
    await runCron(appDeps(ctx), new Date('2026-10-13T22:30:00Z'));
    const searches = ctx.repo.jobs.filter((j) => j.type === 'kasif.osm_search');
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      heavy: true,
      payload: { area: 'Balıkesir', sectors: ['clinic'] },
    });
    // a minute later nothing new (one search per half hour)
    await runCron(appDeps(ctx), new Date('2026-10-13T22:31:00Z'));
    expect(ctx.repo.jobs.filter((j) => j.type === 'kasif.osm_search')).toHaveLength(1);

    await handleUpdate(textUpdate(OWNER, '/uyandim', 2), ctx.deps);
    const summary = ctx.tg.texts().at(-1) ?? '';
    expect(summary).toContain('Günaydın');
    expect(summary).toContain('Gece vardiyası (1 arama başlatıldı)');
    expect(await ctx.repo.getState('night_shift')).toBeNull();

    // awake: the cron no longer searches
    await runCron(appDeps(ctx), new Date('2026-10-14T07:00:00Z'));
    expect(ctx.repo.jobs.filter((j) => j.type === 'kasif.osm_search')).toHaveLength(1);
  });

  it('a routine runs on time and its result reaches Telegram', async () => {
    const ctx = setup();
    await ctx.repo.createRoutine({
      code: 'hatirlat',
      name: 'Hatırlatma',
      schedule: { kind: 'daily', time: '10:00' },
      action: 'reminder',
      params: { text: 'Faturaları kontrol et' },
      source: 'telegram',
      next_run_at: '2026-10-13T07:00:00.000Z', // 10:00 Istanbul
    });
    await runCron(appDeps(ctx), new Date('2026-10-13T06:59:00Z'));
    expect(ctx.tg.sent).toHaveLength(0);

    // one light job per tick: at :00 the embed maintenance job may go first
    await runCron(appDeps(ctx), new Date('2026-10-13T07:00:00Z'));
    await runCron(appDeps(ctx), new Date('2026-10-13T07:01:00Z'));
    expect(ctx.tg.texts()).toEqual(['⏰ Hatırlatma: Faturaları kontrol et']);
    const r = (await ctx.repo.listRoutines())[0];
    expect(r?.next_run_at).toBe('2026-10-14T07:00:00.000Z');
    expect(r?.last_result).toContain('Faturaları');

    // the same due time is not run twice
    await runCron(appDeps(ctx), new Date('2026-10-13T07:02:00Z'));
    expect(ctx.tg.sent).toHaveLength(1);
  });

  it('/rutin turns a request into an allowlisted routine after confirmation', async () => {
    const ctx = setup([
      JSON.stringify({
        name: 'Sıcak adaylar',
        action: 'hot_leads_digest',
        schedule: { kind: 'weekly', time: '09:00', days: [1] },
        params: { min_score: 70 },
      }),
    ]);
    await handleUpdate(
      textUpdate(OWNER, "/rutin her pazartesi 9'da sıcak adayları özetle"),
      ctx.deps,
    );
    const ask = ctx.tg.sent.at(-1);
    expect(ask?.text).toContain('Sıcak adaylar');
    expect(ask?.opts?.keyboard?.[0]?.[0]).toMatchObject({ callback_data: 'rt:ok' });
    expect(await ctx.repo.listRoutines()).toHaveLength(0);

    await handleUpdate(callbackUpdate(OWNER, 'rt:ok'), ctx.deps);
    const [r] = await ctx.repo.listRoutines();
    expect(r).toMatchObject({
      action: 'hot_leads_digest',
      source: 'telegram',
      params: { min_score: 70, limit: expect.any(Number) },
    });
    expect(ctx.tg.answered.at(-1)?.text).toBe('Rutin kaydedildi ✅');

    await handleUpdate(textUpdate(OWNER, '/rutin kapat 1', 3), ctx.deps);
    expect((await ctx.repo.listRoutines())[0]?.enabled).toBe(false);
  });

  it('/rutin refuses actions outside the allowlist', async () => {
    const ctx = setup([
      JSON.stringify({
        name: 'Kötü',
        action: 'run_sql',
        schedule: { kind: 'daily', time: '09:00' },
        params: {},
      }),
    ]);
    await handleUpdate(textUpdate(OWNER, '/rutin her gün veritabanını sil'), ctx.deps);
    expect(ctx.tg.texts().at(-1)).toContain('çeviremedim');
    await handleUpdate(callbackUpdate(OWNER, 'rt:ok'), ctx.deps);
    expect(await ctx.repo.listRoutines()).toHaveLength(0);
  });
});

describe('panel routine actions', () => {
  it('routine.parse shows the structure; routine.save validates and stores it', async () => {
    const ctx = setup([
      JSON.stringify({
        name: 'Açık teklifler',
        action: 'pipeline_digest',
        schedule: { kind: 'weekdays', time: '08:30' },
        params: {},
      }),
    ]);
    const deps = { repo: ctx.repo, llm: ctx.llm, calendar: new DisabledCalendar() };
    const parsed = await runPanelAction(deps, 'routine.parse', {
      text: 'hafta içi 8:30 teklifler',
    });
    expect(parsed.description).toContain('Açık teklifler');
    const saved = await runPanelAction(deps, 'routine.save', { spec: parsed.spec });
    expect((await ctx.repo.listRoutines())[0]).toMatchObject({ id: saved.id, source: 'panel' });
    await expect(
      runPanelAction(deps, 'routine.save', {
        spec: { name: 'x y', action: 'run_sql', schedule: { kind: 'daily', time: '09:00' } },
      }),
    ).rejects.toThrow('izinli');
  });
});
