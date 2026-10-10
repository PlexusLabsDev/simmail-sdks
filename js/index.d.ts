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

export interface WaitForEmail {
  to: string;
  from?: string;
  subject?: string;
  contains?: string;
  folder?: string;
  /** Also match messages already there. */
  existing?: boolean;
  /** Milliseconds, or a duration like "45s". Default 30s. */
  timeout?: number | string;
}

export interface WaitForReply {
  /** The persona's address. */
  from: string;
  /** Only a reply to this Message-ID. */
  inReplyTo?: string;
  /** Run their due reply now instead of on the simulated clock. Default true. */
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
}

export class SimmailError extends Error {
  status: number;
}

export class Simmail {
  constructor(opts?: { baseUrl?: string; apiKey?: string; universe?: string });
  request<T = unknown>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T>;
  waitForEmail(q: WaitForEmail): Promise<Email>;
  waitForReply(q: WaitForReply): Promise<Email>;
  extract(x: { text?: string; html?: string }): Promise<{ codes: string[]; links: string[]; magic_links: string[] }>;
  send(msg: SendEmail): Promise<{ message_id: string; status: string }>;
  health(messageId: string): Promise<unknown>;
  personas(): Promise<unknown[]>;
  createPersona(p: Record<string, unknown>): Promise<unknown>;
  pushCase(id: string, kase: Record<string, unknown>): Promise<unknown>;
  clock(): Promise<unknown>;
  advance(duration: string): Promise<unknown>;
  freeze(): Promise<unknown>;
  speed(factor: number): Promise<unknown>;
}

export default Simmail;
