import type { BusyRange } from '@papi/core';

export interface CalendarEvent {
  start: Date;
  end: Date;
  summary: string;
  description: string;
}

/** Timurhan's own calendar (K-13.10). No attendees are invited: creating an event sends nothing out. */
export interface CalendarProvider {
  readonly configured: boolean;
  busy(from: Date, to: Date): Promise<BusyRange[]>;
  createEvent(e: CalendarEvent): Promise<string>;
}

export class DisabledCalendar implements CalendarProvider {
  readonly configured = false;
  async busy() {
    return [];
  }
  async createEvent(): Promise<string> {
    throw new Error('Google Takvim bağlı değil');
  }
}

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId?: string;
}

/** Google Calendar API v3 with an OAuth refresh token (stored as a Worker secret). */
export class GoogleCalendar implements CalendarProvider {
  readonly configured = true;
  private accessToken: { value: string; until: number } | null = null;

  constructor(
    private readonly cfg: GoogleCalendarConfig,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private get calendarId() {
    return encodeURIComponent(this.cfg.calendarId ?? 'primary');
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.until > Date.now() + 30_000)
      return this.accessToken.value;
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: this.cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`google token: ${res.status}`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('google token: no access_token');
    this.accessToken = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  async busy(from: Date, to: Date): Promise<BusyRange[]> {
    const res = await this.fetchImpl('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: this.cfg.calendarId ?? 'primary' }],
      }),
    });
    if (!res.ok) throw new Error(`google freeBusy: ${res.status}`);
    const j = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };
    return Object.values(j.calendars ?? {}).flatMap((c) =>
      (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
    );
  }

  async createEvent(e: CalendarEvent): Promise<string> {
    const res = await this.fetchImpl(
      `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.token()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          summary: e.summary,
          description: e.description,
          start: { dateTime: e.start.toISOString() },
          end: { dateTime: e.end.toISOString() },
        }),
      },
    );
    if (!res.ok) throw new Error(`google event: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }
}
