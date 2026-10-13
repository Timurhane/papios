import {
  closeProposal,
  createDemo,
  demoUrl,
  draftProposal,
  formatSlot,
  markProposalSent,
  meetingBrief,
  proposeMeeting,
  recordMeetingNote,
  scheduleMeeting,
  setProposalVat,
  submitProposal,
  type Repo,
  type SalesDeps,
} from '@papi/server';
import { z } from 'zod';

/**
 * Panel → Worker actions that need server-side secrets or agents (calendar, model calls, demo links).
 * The caller is the panel with the user's own Supabase session: the JWT is verified with Supabase Auth,
 * must carry aal2 (TOTP, K-17.1) and belong to a tenant member.
 */

const uuid = z.uuid();
export const panelActions = {
  'proposal.draft': z.object({
    companyId: uuid,
    packageCode: z.string().min(1),
    monthlyKurus: z.number().int().positive().optional(),
  }),
  'proposal.vat': z.object({ proposalId: uuid, mode: z.enum(['included', 'excluded']) }),
  'proposal.submit': z.object({ proposalId: uuid }),
  'proposal.sent': z.object({ proposalId: uuid }),
  'proposal.close': z.object({ proposalId: uuid, outcome: z.enum(['accepted', 'rejected']) }),
  'meeting.propose': z.object({ companyId: uuid }),
  'meeting.schedule': z.object({ meetingId: uuid, start: z.iso.datetime({ offset: true }) }),
  'meeting.note': z.object({ companyId: uuid, text: z.string().min(3).max(20_000) }),
  'meeting.brief': z.object({ companyId: uuid }),
  'demo.create': z.object({ companyId: uuid }),
} as const;
export type PanelAction = keyof typeof panelActions;

function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Returns the user id when the bearer token is a valid aal2 session of a tenant member. */
export async function authenticatePanel(
  repo: Repo,
  supabaseUrl: string,
  serviceKey: string,
  authorization: string | undefined,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<string | null> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
  if (!token) return null;
  const claims = jwtPayload(token);
  if (!claims || claims.aal !== 'aal2') return null;
  // Signature, expiry and revocation are checked by Supabase Auth itself.
  const res = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  if (!user.id || user.id !== claims.sub) return null;
  return (await repo.isMember(user.id)) ? user.id : null;
}

export async function runPanelAction(
  deps: SalesDeps & { publicApiUrl?: string },
  action: PanelAction,
  raw: unknown,
): Promise<Record<string, unknown>> {
  switch (action) {
    case 'proposal.draft': {
      const b = panelActions[action].parse(raw);
      return draftProposal(deps, b.companyId, {
        packageCode: b.packageCode,
        ...(b.monthlyKurus ? { monthlyKurus: b.monthlyKurus } : {}),
      });
    }
    case 'proposal.vat': {
      const b = panelActions[action].parse(raw);
      return { approvalId: await setProposalVat(deps, b.proposalId, b.mode) };
    }
    case 'proposal.submit': {
      const b = panelActions[action].parse(raw);
      return { approvalId: await submitProposal(deps, b.proposalId) };
    }
    case 'proposal.sent': {
      const b = panelActions[action].parse(raw);
      return { ok: await markProposalSent(deps, b.proposalId) };
    }
    case 'proposal.close': {
      const b = panelActions[action].parse(raw);
      return { ok: await closeProposal(deps, b.proposalId, b.outcome) };
    }
    case 'meeting.propose': {
      const b = panelActions[action].parse(raw);
      const r = await proposeMeeting(deps, b.companyId);
      return {
        meetingId: r.meetingId,
        slots: r.slots.map((d) => ({ start: d.toISOString(), label: formatSlot(d) })),
        calendarConnected: deps.calendar.configured,
      };
    }
    case 'meeting.schedule': {
      const b = panelActions[action].parse(raw);
      const m = await scheduleMeeting(deps, b.meetingId, new Date(b.start));
      return { meeting: m, calendarConnected: deps.calendar.configured };
    }
    case 'meeting.note': {
      const b = panelActions[action].parse(raw);
      const r = await recordMeetingNote(deps, b.companyId, b.text, 'panel');
      return { meetingId: r.meetingId, notes: r.notes, proposal: r.proposal };
    }
    case 'meeting.brief': {
      const b = panelActions[action].parse(raw);
      return { text: await meetingBrief(deps, b.companyId) };
    }
    case 'demo.create': {
      const b = panelActions[action].parse(raw);
      if (!deps.publicApiUrl)
        throw new PanelError('Demo linki için PUBLIC_API_URL ayarlanmamış', 503);
      const d = await createDemo(deps, b.companyId);
      return { url: demoUrl(deps.publicApiUrl, d.token), expiresAt: d.expiresAt, reused: d.reused };
    }
  }
}

export class PanelError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 503 = 400,
  ) {
    super(message);
  }
}

export function isPanelAction(name: string): name is PanelAction {
  return Object.prototype.hasOwnProperty.call(panelActions, name);
}
