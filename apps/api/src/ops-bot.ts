import { formatTl, splitMessage } from '@papi/core';
import {
  addNote,
  recordPayment,
  setupFormUrl,
  type OpsDeps,
  type Repo,
  type TelegramApi,
} from '@papi/server';

export interface OpsBotDeps {
  repo: Repo;
  tg: TelegramApi;
  ops?: OpsDeps;
  panelUrl?: string;
  publicApiUrl?: string;
}

export const OPS_HELP = `/not {metin} – not al (#etiket); boş yazarsan son notlar
/tahsilat {firma} – firmanın en eski açık ödemesini ödendi işaretle
/proje {firma} – proje durumu, kurulum formu ve kontrol listesi`;

async function findCompany(deps: OpsBotDeps, chatId: number, query: string, usage: string) {
  if (!query.trim()) {
    await deps.tg.sendMessage(chatId, `Kullanım: ${usage}`);
    return null;
  }
  const hits = await deps.repo.searchCompanies(query.trim(), 5);
  const exact = hits.find(
    (h) => h.name.toLocaleLowerCase('tr') === query.trim().toLocaleLowerCase('tr'),
  );
  if (exact) return exact;
  if (hits.length === 1) return hits[0] ?? null;
  await deps.tg.sendMessage(
    chatId,
    hits.length
      ? `Birden fazla firma buldum, tam adını yaz:\n${hits.map((h) => `• ${h.name}`).join('\n')}`
      : `"${query}" bulunamadı.`,
  );
  return null;
}

export async function handleOpsCommand(
  command: 'not' | 'tahsilat' | 'proje',
  args: string,
  chatId: number,
  deps: OpsBotDeps,
): Promise<void> {
  switch (command) {
    case 'not': {
      if (!args.trim()) {
        const notes = await deps.repo.recentNotes(5);
        await deps.tg.sendMessage(
          chatId,
          notes.length
            ? notes.map((n) => `• ${n.body.slice(0, 200)}`).join('\n\n')
            : 'Henüz not yok. /not {metin} ile ekle.',
        );
        return;
      }
      const r = await addNote(deps, args, 'telegram_text');
      await deps.tg.sendMessage(
        chatId,
        `🗒️ Not kaydedildi${r.tags.length ? ` (#${r.tags.join(' #')})` : ''}.`,
      );
      return;
    }
    case 'tahsilat': {
      if (!deps.ops) return void (await deps.tg.sendMessage(chatId, 'Finans modülü hazır değil.'));
      const c = await findCompany(deps, chatId, args, '/tahsilat {firma}');
      if (!c) return;
      const r = await recordPayment(deps.ops, c.id);
      await deps.tg.sendMessage(
        chatId,
        r
          ? `💰 ${c.name}: ${formatTl(r.amount)} (vade ${r.due_on}) ödendi olarak işaretlendi.`
          : `${c.name} için açık ödeme yok.`,
      );
      return;
    }
    case 'proje': {
      const c = await findCompany(deps, chatId, args, '/proje {firma}');
      if (!c) return;
      const project = (await deps.repo.activeProjects(200)).find((p) => p.company_id === c.id);
      if (!project)
        return void (await deps.tg.sendMessage(chatId, `${c.name} için açık proje yok.`));
      const [tasks, form, open] = await Promise.all([
        deps.repo.projectTasks(project.id),
        deps.repo.setupFormByProject(project.id),
        deps.repo.duePayments(200),
      ]);
      const done = tasks.filter((t) => t.done).length;
      const due = open.filter((p) => p.company_id === c.id);
      const formLine = !form
        ? 'Kurulum formu: yok'
        : form.status === 'sent'
          ? `Kurulum formu: bekleniyor${deps.publicApiUrl ? ` — ${setupFormUrl(deps.publicApiUrl, form.token)}` : ''}`
          : 'Kurulum formu: dolduruldu ✅';
      const lines = [
        `📁 ${project.name}`,
        `Durum: ${project.status === 'setup' ? 'kurulumda' : project.status === 'active' ? 'aktif' : project.status}`,
        formLine,
        `Kontrol listesi: ${done}/${tasks.length}`,
        project.contract_end ? `Sözleşme sonu: ${project.contract_end}` : null,
        due.length
          ? `Açık ödeme: ${due.map((p) => `${formatTl(p.amount_kurus)} (${p.due_on})`).join(', ')}`
          : 'Açık ödeme yok',
        deps.panelUrl ? `${deps.panelUrl.replace(/\/$/, '')}/projeler/${project.id}` : null,
      ].filter(Boolean);
      for (const part of splitMessage(lines.join('\n'))) await deps.tg.sendMessage(chatId, part);
      return;
    }
  }
}
