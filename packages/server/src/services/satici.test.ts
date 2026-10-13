import {
  defaultSettings,
  LLMService,
  type LLMProvider,
  type ProviderGenerateInput,
} from '@papi/core';
import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../repo/memory.ts';
import type { CalendarEvent, CalendarProvider } from './calendar.ts';
import {
  closeProposal,
  draftReply,
  markProposalSent,
  onProposalDecided,
  proposeMeeting,
  reconcileProposalDecisions,
  recordMeetingNote,
  scheduleMeeting,
  setProposalVat,
  type SalesDeps,
} from './satici.ts';

// Tue 13 Oct 2026 10:00 Istanbul
const NOW = new Date('2026-10-13T07:00:00Z');

class FakeCalendar implements CalendarProvider {
  configured = true;
  events: CalendarEvent[] = [];
  busyRanges = [{ start: new Date('2026-10-14T07:00:00Z'), end: new Date('2026-10-14T08:00:00Z') }];
  async busy() {
    return this.busyRanges;
  }
  async createEvent(e: CalendarEvent) {
    this.events.push(e);
    return `evt-${this.events.length}`;
  }
}

function setup() {
  const repo = new MemoryRepo();
  repo.now = () => NOW;
  const calls: ProviderGenerateInput[] = [];
  const gemini: LLMProvider = {
    id: 'gemini',
    async generate(input) {
      calls.push(input);
      const sys = input.system ?? '';
      const text = sys.includes('yapılandırılmış bir görüşme notuna')
        ? {
            summary: 'Instagram mesajlarına geç dönüyorlar; haftada 40 talep kaçıyor.',
            needs: ['Gece gelen mesajlara anında cevap', 'Randevu hatırlatma'],
            budget_signal: 'Aylık 25 bin civarı düşünülüyor',
            objections: ['Kurulum süresi'],
            next_step: 'Teklif gönderilecek',
            suggested_package: 'sistem',
          }
        : sys.includes('teklif metni')
          ? {
              intro: 'Gece gelen mesajlar sabaha kalmasın diye Sistem paketini öneriyoruz.',
              scope: ['Instagram ve WhatsApp mesajlarına anında cevap', 'Randevu hatırlatmaları'],
            }
          : { body: 'Fiyat aylık 25.500 TL. Kısa bir görüşme yapalım mı? {saatler} Hangisi uyar?' };
      return { text: JSON.stringify(text), usage: { tokensIn: 1, tokensOut: 1 } };
    },
  };
  const settings = structuredClone(defaultSettings.llm);
  settings.quotas.gemini = { ...settings.quotas.gemini!, rpm: 1000, rpd: 1000 };
  const llm = new LLMService({ providers: { gemini }, settings, store: repo.llmStore });
  const calendar = new FakeCalendar();
  const deps: SalesDeps = { repo, llm, calendar, now: () => NOW };
  return { repo, calls, calendar, deps };
}

async function company(repo: MemoryRepo) {
  const id = await repo.createCompany({
    name: 'Örnek Diş Kliniği',
    name_norm: 'ornek dis klinigi',
    source: 'telegram',
    emails: ['info@ornekdis.com'],
    sector: 'Klinik / sağlık',
  });
  await repo.addContact(id, { full_name: 'Uzm. Dr. Ayşe Yılmaz', source: 'website' });
  return id;
}

const sent = (calls: ProviderGenerateInput[]) =>
  calls.map((c) => c.messages.map((m) => m.content).join('\n')).join('\n');

describe('Phase 4 acceptance: meeting note → proposal draft', () => {
  it('redacts the note, structures it and drafts a proposal that waits for the VAT answer', async () => {
    const { repo, calls, deps } = setup();
    const id = await company(repo);
    const r = await recordMeetingNote(
      deps,
      id,
      'Ayşe Hanım ile görüştük, telefonu 0532 111 22 33. Instagram mesajlarına geç dönüyorlar. Ayşe Yılmaz bütçe olarak 25 bin dedi.',
      'telegram_voice',
    );
    // K-4.9: nothing personal reached the model
    expect(sent(calls)).not.toMatch(/Ayşe|Yılmaz|0532/);
    expect(r.redactions).toBeGreaterThanOrEqual(3);
    expect(repo.meetings[0]).toMatchObject({ status: 'done', source: 'telegram_voice' });
    expect(repo.meetings[0]?.notes_raw).toContain('Ayşe'); // the raw note stays in our own DB only
    expect(r.proposal).toMatchObject({
      number: 'AJNA-2026-0001',
      needsVat: true,
      approvalId: null,
    });

    const p = repo.proposals[0]!;
    expect(p).toMatchObject({ status: 'draft', package_code: 'sistem', vat_mode: null });
    expect(p.founder_discount).toEqual({ setupPct: 40, monthlyPct: 20, monthlyMonths: 3 });
    expect((await repo.getCompany(id))?.stage).toBe('proposal');

    const approvalId = await setProposalVat(deps, p.id, 'excluded');
    expect(approvalId).toBeTruthy();
    const a = repo.approvals.find((x) => x.id === approvalId)!;
    expect(a.kind).toBe('proposal');
    expect(String(a.payload.text)).toContain('Kurulumsuz: aylık ₺25.500');
    expect(String(a.payload.text)).toContain('+ KDV');
    expect(repo.proposals[0]?.status).toBe('awaiting_approval');
  });

  it('approved → sent starts Teklif Takibi; accepted uses a founder slot and wins the company', async () => {
    const { repo, deps } = setup();
    const id = await company(repo);
    const r = await recordMeetingNote(
      deps,
      id,
      'Instagram mesajları geç cevaplanıyor.',
      'telegram_text',
    );
    const approvalId = (await setProposalVat(deps, r.proposal!.id, 'included'))!;
    const a = repo.approvals.find((x) => x.id === approvalId)!;
    a.status = 'approved';
    await onProposalDecided(deps, approvalId, 'approved');
    expect(repo.proposals[0]?.status).toBe('approved');

    expect(await markProposalSent(deps, r.proposal!.id)).toBe(true);
    expect(
      repo.enrollments.some((e) => e.playbook_id === 'pb-teklif-takibi' && e.status === 'active'),
    ).toBe(true);
    expect((await repo.getCompany(id))?.assigned_playbook).toBe('teklif_takibi');

    expect(await closeProposal(deps, r.proposal!.id, 'accepted')).toBe(true);
    expect(repo.founderSlots.used).toBe(1);
    const c = await repo.getCompany(id);
    expect(c?.stage).toBe('won');
    expect(c?.next_step_kind).toBe('waiting'); // K-2.6: never without a next step
    expect(repo.enrollments.every((e) => e.status !== 'active')).toBe(true);
  });

  it('a panel decision on a proposal approval is applied by the Worker', async () => {
    const { repo, deps } = setup();
    const id = await company(repo);
    const r = await recordMeetingNote(deps, id, 'Randevu sistemi istiyorlar.', 'panel');
    const approvalId = (await setProposalVat(deps, r.proposal!.id, 'excluded'))!;
    expect(await reconcileProposalDecisions(deps)).toBe(0);
    repo.approvals.find((x) => x.id === approvalId)!.status = 'rejected';
    expect(await reconcileProposalDecisions(deps)).toBe(1);
    expect(repo.proposals[0]?.status).toBe('cancelled');
  });
});

describe('meetings', () => {
  it('proposes free slots around calendar busy times and schedules into the calendar', async () => {
    const { repo, deps, calendar } = setup();
    const id = await company(repo);
    const { meetingId, slots } = await proposeMeeting(deps, id);
    expect(slots).toHaveLength(3);
    // Wed 14 Oct 10:00–11:00 TR is busy
    for (const s of slots)
      expect(
        s.getTime() >= calendar.busyRanges[0]!.end.getTime() ||
          s.getTime() + 1_800_000 <= calendar.busyRanges[0]!.start.getTime(),
      ).toBe(true);
    const m = await scheduleMeeting(deps, meetingId, slots[0]!);
    expect(m.status).toBe('scheduled');
    expect(calendar.events[0]?.summary).toBe('AJNA görüşme: Örnek Diş Kliniği');
    expect((await repo.getCompany(id))?.stage).toBe('meeting');
  });
});

describe('reply drafts', () => {
  it('redacts the incoming reply, inserts meeting times and queues an email for approval', async () => {
    const { repo, calls, deps } = setup();
    const id = await company(repo);
    const inboxId = (await repo.addInboxMessage({
      companyId: id,
      touchId: null,
      channel: 'email',
      providerMessageId: 'm1',
      threadId: 'thr-1',
      from: 'ayse@ornekdis.com',
      subject: 'Mobil siteniz hakkında',
      body: 'Merhaba, fiyat nedir? Beni 0532 111 22 33 numarasından arayabilirsiniz.\n\nSaygılarımla,\nUzm. Dr. Ayşe Yılmaz',
      receivedAt: NOW.toISOString(),
      classification: 'question',
    }))!;
    const approvalId = await draftReply(deps, inboxId);
    expect(sent(calls)).not.toMatch(/Ayşe|Yılmaz|0532|ornekdis/);
    const a = repo.approvals.find((x) => x.id === approvalId)!;
    expect(a.kind).toBe('reply');
    const touch = repo.touches.find((t) => t.approval_id === approvalId)!;
    expect(touch).toMatchObject({
      status: 'awaiting_approval',
      channel: 'email',
      recipient: 'ayse@ornekdis.com',
      subject: 'Re: Mobil siteniz hakkında',
      thread_id: 'thr-1',
    });
    expect(touch.body).toMatch(/^Merhaba Uzm\. Dr\. Ayşe Yılmaz,/); // greeting by code, not the model
    expect(touch.body).not.toContain('{saatler}');
    expect(touch.body).toMatch(/• .*(Çarşamba|Perşembe|Cuma)/);
    expect(repo.meetings[0]?.status).toBe('proposed');
  });
});

describe('proposalText', () => {
  it('shows a custom project breakdown', async () => {
    const { proposalText } = await import('./satici.ts');
    const text = proposalText(
      {
        id: 'p',
        company_id: 'c',
        meeting_id: null,
        number: 'AJNA-2026-0009',
        status: 'draft',
        package_code: 'ozel',
        monthly_kurus: null,
        quote: {
          kind: 'project',
          parts: [{ title: 'ERP entegrasyonu', days: 6 }],
          project: {
            projectKurus: 7_200_000,
            maintenanceMinKurus: 576_000,
            maintenanceMaxKurus: 720_000,
          },
        },
        founder_discount: null,
        vat_mode: 'included',
        valid_until: '2026-10-27',
        intro: 'Giriş',
        scope: ['Madde'],
        approval_id: null,
        pdf_path: null,
        sent_at: null,
      },
      null,
      'Örnek',
    );
    expect(text).toContain('ERP entegrasyonu: 6 gün');
    expect(text).toContain('Proje bedeli: ₺72.000 — KDV dahil');
  });
});
