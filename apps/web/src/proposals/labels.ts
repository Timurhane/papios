import type { ProposalStatus } from '@/data/types';

export const PROPOSAL_STATUS: Record<ProposalStatus, string> = {
  draft: 'Taslak',
  awaiting_approval: 'Onay bekliyor',
  approved: 'Onaylandı',
  sent: 'Gönderildi',
  accepted: 'Kabul edildi',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
  cancelled: 'İptal',
};

export const STATUS_TONE: Record<ProposalStatus, string> = {
  draft: 'bg-surface-2 text-muted',
  awaiting_approval: 'bg-amber-500/15 text-amber-500',
  approved: 'bg-blue/15 text-blue',
  sent: 'bg-violet/20 text-violet',
  accepted: 'bg-emerald-500/15 text-emerald-500',
  rejected: 'bg-danger/15 text-danger',
  expired: 'bg-surface-2 text-muted',
  cancelled: 'bg-surface-2 text-muted',
};
