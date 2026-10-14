/** A message as the wait endpoints return it: with the codes and links pulled out. */
export interface Email {
  address: string;
  folder: string;
  uid: number;
  message_id: string;
  in_reply_to?: string;
  from: string;
  from_name?: string;
  to: string[];
  subject: string;
  date: string;
  text: string;
  html?: string;
  links: string[];
  /** One-time codes found in the text. */
  codes: string[];
  /** Links that verify, confirm, reset or sign in. */
  magic_links: string[];
  /** Written by a simulated person. */
  by_persona?: boolean;
}

/** A message in a mailbox listing (text shortened) or read whole. */
export interface Message {
  uid: number;
  folder: string;
  flags: string[];
  time: string;
  size: number;
  message_id: string;
  in_reply_to?: string;
  references?: string[];
  from: string;
  from_name?: string;
  to?: string[];
  cc?: string[];
  subject: string;
  date: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content_type: string; size?: number }[];
  format: string;
}

export interface WaitForEmail {
  to: string;
  from?: string;
  subject?: string;
  contains?: string;
  folder?: string;
  /** Also match messages already there. */
  existing?: boolean;
  /** Milliseconds, or a duration like "45s". Default 30s; at most 5m. */
  timeout?: number | string;
}

export interface WaitForReply {
  /** The person's address. */
  from: string;
  /** Only a reply to this Message-ID. */
  inReplyTo?: string;
  /** Have them write their due reply now instead of on the simulated clock. Default true. */
  fast?: boolean;
  timeout?: number | string;
}

export interface SendEmail {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text?: string;
  html?: string;
  /** Thread this onto a conversation. */
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; content_type: string; /** base64 */ data: string }[];
}

export class SimmailError extends Error {
  status: number;
}

export class Simmail {
  /** Defaults: SIMMAIL_URL (such as https://c1.simmail.dev), SIMMAIL_API_KEY, SIMMAIL_UNIVERSE. */
  constructor(opts?: { baseUrl?: string; apiKey?: string; universe?: string });
  baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T>;
  me(): Promise<Record<string, unknown>>;
  waitForEmail(q: WaitForEmail): Promise<Email>;
  waitForReply(q: WaitForReply): Promise<Email>;
  extract(x: { text?: string; html?: string }): Promise<{ codes: string[]; links: string[]; magic_links: string[] }>;
  mailboxes(): Promise<unknown[]>;
  messages(address: string, opts?: { folder?: string }): Promise<Message[]>;
  message(address: string, folder: string, uid: number): Promise<Message>;
  health(messageId: string): Promise<Record<string, unknown>>;
  send(msg: SendEmail): Promise<{ message_id: string; status: string }>;
  accounts(): Promise<unknown[]>;
  createAccount(address: string, password: string): Promise<unknown>;
  personas(): Promise<unknown[]>;
  createPersona(p: Record<string, unknown>): Promise<unknown>;
  pushCase(id: string, kase: Record<string, unknown>): Promise<unknown>;
  clock(): Promise<unknown>;
  advance(duration: string): Promise<unknown>;
  freeze(): Promise<unknown>;
  speed(factor: number): Promise<unknown>;
  live(): Promise<unknown>;
}

export default Simmail;
