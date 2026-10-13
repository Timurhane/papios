/** Mail delivery and inbox access (K-10.8). The concrete implementation follows decision A-1. */
export interface OutgoingMail {
  to: string;
  fromName: string;
  subject: string;
  text: string;
  /** RFC 8058 one-click unsubscribe target. */
  unsubscribeUrl: string;
  inReplyTo?: string | null;
  threadId?: string | null;
}

export interface SentMail {
  messageId: string;
  threadId: string | null;
}

export interface InboundMail {
  providerMessageId: string;
  threadId: string | null;
  from: string;
  subject: string | null;
  body: string;
  receivedAt: string;
  headers: Record<string, string>;
}

export interface MailTransport {
  readonly configured: boolean;
  send(mail: OutgoingMail): Promise<SentMail>;
  /** New inbound messages since `cursor` (provider specific), plus the next cursor. */
  fetchNew(cursor: string | null): Promise<{ messages: InboundMail[]; cursor: string | null }>;
}

export class MailNotConfiguredError extends Error {
  override readonly name = 'MailNotConfiguredError';
  constructor() {
    super('mail transport is not configured (decision A-1 / credentials missing)');
  }
}

/** Used until the mail account is connected: nothing is sent, nothing is read. */
export class DisabledMailTransport implements MailTransport {
  readonly configured = false;
  async send(): Promise<SentMail> {
    throw new MailNotConfiguredError();
  }
  async fetchNew() {
    return { messages: [], cursor: null };
  }
}
