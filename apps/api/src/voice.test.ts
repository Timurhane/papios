import { describe, expect, it } from 'vitest';
import { setup } from './test/fakes.ts';
import { endVoice, runVoiceTool, startVoice, type VoiceDeps } from './voice.ts';

const NOW = new Date('2026-10-13T07:00:00Z');

function voice(status = 200) {
  const ctx = setup();
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ name: 'auth_tokens/tok123' }), { status });
  }) as unknown as typeof fetch;
  const deps: VoiceDeps = {
    repo: ctx.repo,
    llm: ctx.llm,
    geminiApiKey: 'key-from-secret',
    fetchImpl,
    now: () => NOW,
  };
  return { ...ctx, deps, calls };
}

describe('live voice (K-15.7)', () => {
  it('mints a single-use token with model, instructions and tools locked; the key stays server-side', async () => {
    const { deps, calls } = voice();
    const r = await startVoice(deps);
    expect(r).toMatchObject({ ok: true, token: 'auth_tokens/tok123', seconds: 600 });
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1alpha/auth_tokens');
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'key-from-secret',
    );
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      uses: number;
      bidiGenerateContentSetup: { tools: { functionDeclarations: { name: string }[] }[] };
      fieldMask: string;
    };
    expect(body.uses).toBe(1);
    expect(body.fieldMask).toContain('tools');
    expect(body.fieldMask).toContain('systemInstruction');
    expect(body.bidiGenerateContentSetup.tools[0]?.functionDeclarations.map((f) => f.name)).toEqual(
      [
        'search_knowledge',
        'search_notes',
        'find_company',
        'today_summary',
        'quota_status',
        'save_note',
        'set_quiet_mode',
      ],
    );
  });

  it('enforces the daily minutes and refunds unused time', async () => {
    const { deps, repo } = voice();
    const a = await startVoice(deps);
    const b = await startVoice(deps);
    expect(a.ok && b.ok).toBe(true);
    expect(await startVoice(deps)).toEqual({ ok: false, reason: 'limit', remainingSeconds: 0 });
    const end = await endVoice(deps, 600, 120, 'Timurhan: bugün kimi arayayım?');
    expect(end.remainingSeconds).toBe(480);
    expect(repo.conversation.at(-1)?.content).toContain('Sesli konuşma özeti');
  });

  it('runs tools read-only; won clients and personal data stay masked', async () => {
    const { deps, repo } = voice();
    const id = await repo.createCompany({
      name: 'Müşteri Klinik',
      name_norm: 'musteri klinik',
      source: 'manual',
    });
    await repo.updateCompany(id, { stage: 'won', score: 90, city: 'Balıkesir' });
    expect(await runVoiceTool(deps, 'find_company', { name: 'Müşteri' })).toEqual({
      results: [{ name: 'Müşteri Klinik', stage: 'müşteri' }],
    });
    repo.noteVectors.push({
      id: 'n1',
      body: 'Ayşe Hanım 0532 111 22 33 aradı, ayse@ornek.com',
      created_at: NOW.toISOString(),
      score: 0.9,
    });
    const notes = (await runVoiceTool(deps, 'search_notes', { query: 'kim aradı' })) as {
      results: string[];
    };
    expect(notes.results[0]).not.toContain('0532');
    expect(notes.results[0]).not.toContain('ayse@ornek.com');
    await runVoiceTool(deps, 'save_note', { text: 'Örnek kliniğe teklif gönder #taslak' });
    expect(repo.approvals).toHaveLength(0);
  });

  it('reports a missing key instead of minting', async () => {
    const { deps } = voice();
    expect(await startVoice({ ...deps, geminiApiKey: null })).toMatchObject({
      ok: false,
      reason: 'not_configured',
    });
  });
});
