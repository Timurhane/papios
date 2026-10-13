import { addDays } from './schedule.ts';

export type Channel =
  'email' | 'whatsapp' | 'instagram_dm' | 'linkedin' | 'x' | 'phone_call' | 'visit' | 'demo';

export interface PlaybookStep {
  position: number;
  day_offset: number;
  anchor: 'start' | 'contract_end';
  repeat_every_days: number | null;
  channel: Channel;
  angle: string;
  conditions: {
    requires?: string[];
    only_if?: string;
    requires_founder_slots_true_state?: boolean;
  };
  requires_approval: boolean;
  approval_exempt_kind: string | null;
}

export interface Reachability {
  email: string | null;
  phone: string | null;
  instagram: string | null;
  linkedin: string | null;
}

export interface StepContext {
  reach: Reachability;
  /** Facts that `only_if` conditions refer to, e.g. satisfaction_positive. */
  facts: Record<string, boolean>;
  /** K-7.5 / K-11.5: founder discount slots really available. */
  founderSlotsAvailable: boolean;
  contractEnd: string | null;
}

export type StepPlan =
  | { kind: 'due'; step: PlaybookStep; dueDate: string; recipient: string | null }
  | { kind: 'skip'; step: PlaybookStep; reason: string }
  | { kind: 'done' };

const CHANNEL_NEEDS: Partial<Record<Channel, keyof Reachability>> = {
  email: 'email',
  whatsapp: 'phone',
  phone_call: 'phone',
  instagram_dm: 'instagram',
  linkedin: 'linkedin',
};

/** Where a message on this channel goes (null for visit/demo/x where there is no single address). */
export function recipientFor(channel: Channel, reach: Reachability): string | null {
  const need = CHANNEL_NEEDS[channel];
  return need ? reach[need] : null;
}

/**
 * K-11.1 playbook engine: the next step of an enrollment, its due date and whether it must be skipped
 * (e.g. "no phone number → skip the WhatsApp step").
 */
export function planStep(
  steps: PlaybookStep[],
  nextPosition: number,
  startDate: string,
  ctx: StepContext,
): StepPlan {
  const step = [...steps]
    .sort((a, b) => a.position - b.position)
    .find((s) => s.position >= nextPosition);
  if (!step) return { kind: 'done' };

  const required = new Set([
    ...(step.conditions.requires ?? []),
    ...(CHANNEL_NEEDS[step.channel] ? [CHANNEL_NEEDS[step.channel] as string] : []),
  ]);
  for (const r of required) {
    if (!ctx.reach[r as keyof Reachability])
      return { kind: 'skip', step, reason: `${labelFor(r)} yok` };
  }
  if (step.conditions.only_if && !ctx.facts[step.conditions.only_if]) {
    return { kind: 'skip', step, reason: `koşul sağlanmadı: ${step.conditions.only_if}` };
  }
  if (step.conditions.requires_founder_slots_true_state && !ctx.founderSlotsAvailable) {
    return {
      kind: 'skip',
      step,
      reason: 'kurucu indirimi kontenjanı kalmadı (yalnızca gerçek durum kullanılır)',
    };
  }

  let dueDate: string;
  if (step.anchor === 'contract_end') {
    if (!ctx.contractEnd) return { kind: 'skip', step, reason: 'sözleşme bitiş tarihi yok' };
    dueDate = addDays(ctx.contractEnd, step.day_offset);
  } else {
    dueDate = addDays(startDate, Math.max(0, step.day_offset - (step.day_offset > 0 ? 1 : 0)));
  }
  return { kind: 'due', step, dueDate, recipient: recipientFor(step.channel, ctx.reach) };
}

function labelFor(r: string): string {
  return (
    (
      {
        email: 'E-posta',
        phone: 'Telefon',
        instagram: 'Instagram hesabı',
        linkedin: 'LinkedIn profili',
      } as Record<string, string>
    )[r] ?? r
  );
}

/** One-click channels (K-10.2–K-10.5): Timurhan presses send himself. */
export const ONE_CLICK_CHANNELS: ReadonlySet<Channel> = new Set([
  'whatsapp',
  'instagram_dm',
  'linkedin',
  'x',
]);
/** Tasks for Timurhan, not messages Papi sends (V-18). */
export const TASK_CHANNELS: ReadonlySet<Channel> = new Set(['phone_call', 'visit']);
