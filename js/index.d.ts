// Types for @plexuslabs/simmail. Objects use the API's own field names
// (snake_case); resource classes add camelCase getters and methods.

// ---------------------------------------------------------------- enums

import type { Temperament, Knows, Life, Length, Formality, MailClient, LinkHabit, SpamFilter, Access, Stance, BadKind, FailAt, Stranger, MailboxStatus, FaultKind, FaultStage, FaultScenario, MissingSite, LocalLinks, StreamKind, AiMode, EventType, JobKind, JobState, Folder, Protocol, Role, PersonaSource, StoryBy, EventAlias, ErrorCode } from "./enums.js";
export * from "./enums.js";

// ---------------------------------------------------------------- errors

/** A failed call. Catch it for every failure; the subclasses say which kind. */
export declare class SimmailError extends Error {
  constructor(status: number, message: string, body?: unknown, requestId?: string);
  /** The HTTP status. */
  status: number;
  /** The machine-readable error code (ErrorCode), when the server sends one. */
  code?: ErrorCode | (string & {});
  /** The request's id (X-Request-Id), to quote to support. */
  requestId?: string;
  /** The field that was wrong, when the server says. */
  field?: string;
  /** The values that would have been accepted, when the server says. */
  allowed?: unknown[];
  /** For a wait that timed out: what almost matched, and why each did not. */
  nearMisses?: NearMiss[];
  /** For a wait: what it looked for, in words. */
  matched?: string;
  waitedMs?: number;
  /** The whole answer. */
  body?: unknown;
}
export interface NearMiss { message_id: string; address: string; from: string; subject: string; received: string; failed: string[] }
/** 400: the request was not valid (bad_request, invalid_value, invalid_regex). */
export declare class ValidationError extends SimmailError {}
/** 401: no key, or a key that does not work. */
export declare class AuthError extends SimmailError {}
/** 402: your plan does not include this, or its limit is reached. */
export declare class PlanLimitError extends SimmailError {}
/** 403: your role or key may not do this. */
export declare class ForbiddenError extends SimmailError {}
/** 404: there is no such thing. */
export declare class NotFoundError extends SimmailError {}
/** 408: a wait ended with nothing matching. */
export declare class WaitTimeoutError extends SimmailError {
  /** For a thread wait: the messages it had. */
  messages?: Message[];
}
/** 409: a conflict, such as a person who decided not to reply. */
export declare class ConflictError extends SimmailError {}
/** 409: expectNoEmail saw an email. */
export declare class UnexpectedEmailError extends ConflictError {
  /** The email that came. */
  email?: Message;
}
/** 422: an Idempotency-Key was used before for a different request. */
export declare class IdempotencyError extends SimmailError {}
/** 429: too many requests. */
export declare class RateLimitedError extends SimmailError {
  /** Seconds to wait, when the server says. */
  retryAfter?: number;
}
/** The error for a failed answer: by its code, else by its status. */
export declare function errorFor(status: number, message: string, body?: unknown, opts?: { retryAfter?: number; requestId?: string }): SimmailError;

// ---------------------------------------------------------------- data

export interface Attachment { filename: string; content_type: string; size?: number; content_id?: string; inline?: boolean }
/** An attachment to send: data is base64. */
export interface AttachmentInput { filename: string; content_type: string; data: string }

export interface MessageData {
  /** The mailbox it is in (wait results; set for listed messages too). */
  address?: string;
  folder?: string;
  uid?: number;
  flags?: string[];
  time?: string;
  size?: number;
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
  /** text, html or both: what the sender's client produced. */
  format?: "text" | "html" | "both";
  attachments?: Attachment[];
  headers?: Record<string, string>;
  /** Wait results: every link, the one-time codes and the sign-in style links. */
  links?: string[];
  codes?: string[];
  magic_links?: string[];
  by_persona?: boolean;
}
/** @deprecated The 0.1.0 name of a wait result; it is a Message now. */
export type Email = Message;

export interface MailboxData { address: string; display_name?: string; can_login?: boolean; unread?: number; total?: number; persona_id?: string; persona?: string }
export interface FolderInfo { name: string; special_use?: string; total: number; unread: number }
export interface Thread { root: string; subject: string; last: string; messages: MessageData[] }

export interface SendInput {
  from: string;
  to: string[];
  cc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
  inReplyTo?: string;
  in_reply_to?: string;
  references?: string[];
  forward?: { address: string; folder: string; uid: number };
}
export interface SendResult extends AnswerFacts { status: string; message_id: string }
export interface InjectInput { to: string; folder?: Folder; from?: string; subject?: string; text?: string; raw?: string }
export interface WriteOptions {
  /** The Idempotency-Key header. Default: a new key for each call; false sends none. */
  idempotencyKey?: string | false;
}
/** Facts about an answer, beside its data (not enumerable, not in JSON). */
export interface AnswerFacts {
  /** The request's id (X-Request-Id). */
  readonly requestId?: string;
  /** True when the server had already done this (a repeated Idempotency-Key). */
  readonly replayed?: boolean;
}

export interface AccountData { address: string; display_name?: string; password?: string; username?: string; allow_smtp?: boolean; allow_imap?: boolean; disabled?: boolean; note?: string; messages?: number }
export interface AccountInput { display_name?: string; username?: string; allow_smtp?: boolean; allow_imap?: boolean; note?: string; disabled?: boolean; password?: string; clear_password?: boolean }
export interface LoginTest { smtp?: { ok: boolean; address: string }; imap?: { ok: boolean; address: string } }

export interface PersonaInput {
  name?: string;
  addresses?: string[];
  role?: string;
  org?: string;
  who?: string;
  wants?: string;
  character?: string;
  knows?: Knows;
  temperament?: Temperament;
  case_ids?: string[];
  style?: { length?: Length; formality?: Formality; typos?: number; signature?: string; client?: MailClient; links?: LinkHabit; filter?: SpamFilter; access?: Access };
  timing?: {
    reply_rate?: number;
    delay?: { median?: string; spread?: number };
    hours?: { tz?: string; days?: string; from?: string; to?: string };
    ooo?: { from: string; to: string; message?: string }[];
  };
  behaviors?: { double_reply?: number; bounce?: number; cc_someone?: number; forward_to?: string; keep_promises?: number };
  external_ids?: Record<string, string>;
  paused?: boolean;
}
export interface PersonaData extends PersonaInput { id: string; name: string; addresses: string[]; provider?: PersonaSource; created?: string }
export interface TemperamentInfo { name: Temperament; weight: number; reply_rate: number; median_delay: string; text: string }

export interface CasePerson { ref?: string; name?: string; role?: string; org?: string; addresses?: string[]; notes?: string[]; persona_id?: string; external_ids?: Record<string, string>; who?: string; wants?: string; knows?: Knows; temperament?: Temperament; character?: string }
export interface CaseInput { title?: string; kind?: string; facts?: Record<string, unknown>; known?: Record<string, unknown>; people?: CasePerson[]; notes?: string[]; directions?: string }
export interface CaseData extends CaseInput { id: string; story?: string; amendments?: string[]; story_by?: StoryBy; story_written_by?: StoryBy; created?: string; updated?: string }

export interface ClockState { now: string; speed: number; frozen: boolean; real: boolean }
export interface AdvanceResult { clock: ClockState; jobs_run: number }
export interface JobData { id: number; state: JobState; due: string; ran?: string; created?: string; kind: JobKind; persona_id?: string; persona?: string; case_id?: string; to?: string[]; plan?: string; note?: string; inbound?: { subject: string; from: string; text: string } }
export interface JobList { now: string; jobs: Job[] }

export interface SimEventData { id: number; at: string; kind: EventType; data: Record<string, unknown> }
export interface RunDueResult { ran: { id: number; kind: JobKind; persona?: string; state: JobState | "error"; note?: string }[]; count: number; remaining: number }
export interface TestAddressData { address: string; tag: string }
export interface WaitMany { messages: Message[]; count: number; waited_ms: number; matched: string }
export interface NoEmail { none: true; waited_ms: number; matched: string }
export interface ThreadData { thread: string; count: number; quiet_ms: number; waited_ms: number }

export interface FaultRule {
  name?: string;
  kind?: FaultKind;
  stage: FaultStage;
  match?: string;
  rate?: number;
  code?: number;
  enhanced?: string;
  message?: string;
  delay_ms?: number;
  retry_after?: number;
  per_minute?: number;
  window?: { days: string; from: string; to: string; tz?: string };
  enabled?: boolean;
  scenario?: FaultScenario;
}
export interface FaultScenarioInfo { id: FaultScenario; provider: string; name: string; description: string; rule: FaultRule }

export interface RecipientRule { create?: boolean; bad_rate?: number; bad_kinds?: BadKind[]; fail_at?: FailAt; stranger?: Stranger; silent?: boolean }
export interface RecipientRules { default?: RecipientRule; domains?: Record<string, RecipientRule>; status?: Record<string, MailboxStatus>; seed?: string }

export interface LinkPolicy { enabled: boolean; allow_private: boolean; allow?: string[]; deny?: string[]; max_links: number; unsubscribe: boolean; user_agent?: string; sender_check: number; missing_site: MissingSite; local_links: LocalLinks }
export interface JunkSettings { enabled: boolean; strict: number; normal: number; lenient: number; strict_domains: string[]; ignore: string[]; count_network: boolean }

export interface Webhook { name?: string; url: string; events: EventType[]; secret?: string }

export interface Stream { id?: string; name: string; kind: StreamKind; to: string[]; per_day: number; business_hours?: boolean; brief?: string; new_people?: number; enabled?: boolean; sent?: number; next?: string }
export interface World { company: { name: string; domain: string; tz?: string; mailboxes?: unknown[] }; streams: Stream[] }

export interface HealthReport { message_id: string; subject?: string; from?: string; at?: string; spam?: Record<string, unknown>; links?: unknown[]; links_done?: boolean; broken?: number; local?: number; dangerous?: number; unsubscribe?: boolean; compat?: unknown; access?: unknown; locked?: boolean }
export interface Extracted { codes: string[]; links: string[]; magic_links: string[] }

/** The filters of every mail wait. */
export interface MailFilters {
  /** An address, *@domain, or a list of them (or use tag). */
  to?: string | string[];
  /** The addresses made with this tag (testAddress). */
  tag?: string;
  from?: string;
  subject?: string;
  contains?: string;
  subjectRegex?: RegExp | string;
  bodyRegex?: RegExp | string;
  /** {Name: value} or ["Name:value"]. */
  header?: Record<string, string> | string[];
  hasAttachment?: boolean;
  attachmentName?: string;
  linkDomain?: string;
  folder?: Folder;
  /** Only mail after this: a Date, RFC 3339 or a message id. */
  since?: Date | string;
  /** Message ids to skip. */
  exclude?: string | string[];
  /** Also mail that came before the wait. */
  existing?: boolean;
  /** Newer filters are passed to the server as they are (camelCase becomes snake_case). */
  [more: string]: unknown;
}
export interface WaitOptions extends MailFilters {
  /** Wait for this many (1 to 100); the answer is then {messages, count, …}. */
  count?: number;
  /** Milliseconds, or a duration such as "45s" (at most 5 minutes). */
  timeout?: number | string;
}
export interface NoEmailOptions extends MailFilters {
  /** How long nothing may arrive: milliseconds or a duration. Default "5s". */
  within?: number | string;
}
export interface EventWaitOptions {
  /** An EventType, EventAlias or prefix such as "persona.*", or a list. */
  type: EventType | EventAlias | (EventType | EventAlias)[];
  /** A persona id or address. */
  persona?: string;
  messageId?: string;
  /** An event id: only events after it. */
  after?: number;
  /** Has the persona act now on what is due. */
  fast?: boolean;
  timeout?: number | string;
}
export interface ThreadWaitOptions {
  messageId?: string;
  thread?: string;
  /** How long nothing new may join it. Default "10s". */
  quiet?: number | string;
  fast?: boolean;
  /** Default 60s. */
  timeout?: number | string;
}
export interface JobFilters {
  state?: JobState;
  /** A persona id or address. */
  persona?: string;
  kind?: JobKind;
  /** A Date, RFC 3339 or a duration from the simulated now, such as "1h". */
  dueBefore?: Date | string;
  limit?: number;
  [more: string]: unknown;
}
export interface RunDueOptions { persona?: string; kind?: JobKind; before?: Date | string; limit?: number }
export interface ReplyWaitOptions {
  from: string;
  inReplyTo?: string;
  fast?: boolean;
  timeout?: number | string;
  [more: string]: unknown;
}

// ---------------------------------------------------------------- resources

/** Every resource keeps the API's fields, plus .raw (the answer as it came). */
export declare class Resource {
  readonly raw: Record<string, unknown>;
  readonly client: Simmail;
  toJSON(): Record<string, unknown>;
}

export declare class Message extends Resource {}
export interface Message extends MessageData {
  readonly messageId: string;
  readonly inReplyTo?: string;
  readonly fromName?: string;
  readonly codes: string[];
  readonly magicLinks: string[];
  readonly byPersona: boolean;
  readonly isRead: boolean;
  /** Set by full() and message(). */
  readonly safe?: { html: string; remote_blocked: number };
  /** For a persona's mailbox: the case the thread is linked to. */
  readonly case?: { id: string; how: string };
  full(opts?: { remote?: boolean; theme?: "light" }): Promise<Message>;
  source(): Promise<string>;
  attachment(n: number): Promise<Uint8Array>;
  extract(): Promise<Extracted>;
  markRead(): Promise<unknown>;
  markUnread(): Promise<unknown>;
  move(folder: Folder): Promise<unknown>;
  reply(opts?: { from?: string; text?: string; html?: string; cc?: string[]; attachments?: AttachmentInput[] }): Promise<SendResult>;
  waitForReply(opts?: Partial<ReplyWaitOptions>): Promise<Message>;
  health(): Promise<HealthReport>;
  /** For wait results: how long the wait took, and what it looked for. */
  readonly waitedMs?: number;
  readonly matched?: string;
  /** Its conversation, once nothing new has joined it for opts.quiet. */
  waitUntilQuiet(opts?: Omit<ThreadWaitOptions, "messageId" | "thread">): Promise<Conversation>;
}

export declare class Mailbox extends Resource {}
export interface Mailbox extends MailboxData {
  readonly personaId?: string;
  readonly displayName?: string;
  readonly canLogin?: boolean;
  messages(opts?: { folder?: Folder }): AsyncGenerator<Message>;
  list(opts?: { folder?: Folder }): Promise<Message[]>;
  waitForEmail(opts: Omit<WaitOptions, "to"> & { count: number }): Promise<WaitMany>;
  waitForEmail(opts?: Omit<WaitOptions, "to">): Promise<Message>;
  folders(): Promise<FolderInfo[]>;
  threads(): Promise<Thread[]>;
  setStatus(status: MailboxStatus): Promise<unknown>;
  send(msg: Omit<SendInput, "from">, opts?: WriteOptions): Promise<SendResult>;
  inject(msg: Omit<InjectInput, "to">, opts?: WriteOptions): Promise<unknown>;
  signature(): Promise<{ signature: string }>;
  setSignature(signature: string): Promise<unknown>;
  getPersona(): Promise<Persona | null>;
}

export declare class Persona extends Resource {}
export interface Persona extends PersonaData {
  readonly address: string;
  readonly caseIds: string[];
  readonly externalIds: Record<string, string>;
  refresh(): Promise<Persona>;
  update(changes: PersonaInput): Promise<Persona>;
  delete(): Promise<unknown>;
  pause(): Promise<Persona>;
  resume(): Promise<Persona>;
  mailbox(): Mailbox;
  waitForReply(opts?: Partial<ReplyWaitOptions>): Promise<Message>;
  memory(): Promise<Record<string, string[]>>;
  remember(text: string, opts?: { caseId?: string; source?: string }): Promise<unknown>;
  forgetMemory(opts?: { caseId?: string }): Promise<unknown>;
  relations(): Promise<{ relations: unknown[]; stances: unknown[] }>;
  forget(address?: string): Promise<unknown>;
  jobs(opts?: Omit<JobFilters, "persona">): Promise<Job[]>;
  runDue(opts?: Omit<RunDueOptions, "persona">): Promise<RunDueResult>;
  /** Waits until they do something ("replied", "declined", "clicked", an EventType…). */
  waitFor(type: EventWaitOptions["type"], opts?: Omit<EventWaitOptions, "type" | "persona">): Promise<SimEvent>;
}

export declare class Case extends Resource {}
export interface Case extends CaseData {
  readonly people: CasePerson[];
  readonly storyBy?: StoryBy;
  refresh(opts?: { redact?: boolean }): Promise<Case>;
  push(update: CaseInput): Promise<Case>;
  addPeople(people: CasePerson[]): Promise<Case>;
  initiate(opts: { persona: string; to: string | string[]; intent?: string; after?: string }): Promise<{ job_id: number }>;
  regenerate(): Promise<Case>;
  editStory(edit: { story?: string; amendments?: string[]; directions?: string }): Promise<Case>;
  delete(): Promise<unknown>;
}

export declare class Job extends Resource {}
export interface Job extends JobData {
  readonly personaId?: string;
  readonly caseId?: string;
  readonly isPending: boolean;
  run(): Promise<unknown>;
  skip(): Promise<unknown>;
  bounce(): Promise<unknown>;
  reschedule(when: { due?: string; in?: string }): Promise<unknown>;
}

export declare class Account extends Resource {}
export interface Account extends AccountData {
  readonly displayName?: string;
  readonly allowSmtp?: boolean;
  readonly allowImap?: boolean;
  update(changes: AccountInput): Promise<unknown>;
  delete(): Promise<unknown>;
  test(opts?: { password?: string; username?: string; proto?: Protocol }): Promise<LoginTest>;
  mailbox(): Mailbox;
}

/** Something that happened. kind is an EventType. */
export declare class SimEvent extends Resource {}
export interface SimEvent extends SimEventData {
  readonly personaId?: string;
  readonly messageId?: string;
  readonly caseId?: string;
  /** For waitForEvent: how long it took. */
  readonly waitedMs?: number;
  persona(): Promise<Persona | null>;
}

/** A conversation, its messages oldest first. */
export declare class Conversation extends Resource {}
export interface Conversation extends ThreadData {
  messages: Message[];
  readonly root: string;
  readonly latest: Message;
  readonly quietMs: number;
  readonly waitedMs: number;
  waitUntilQuiet(opts?: Omit<ThreadWaitOptions, "messageId" | "thread">): Promise<Conversation>;
  reply(opts?: { from?: string; text?: string; html?: string; cc?: string[]; attachments?: AttachmentInput[] }): Promise<SendResult>;
}

/** A fresh address for one test. */
export declare class TestAddress extends Mailbox {}
export interface TestAddress extends TestAddressData {
  expectNoEmail(opts?: Omit<NoEmailOptions, "to" | "tag">): Promise<NoEmail>;
  cleanup(opts?: { folder?: Folder }): Promise<{ deleted: number; addresses: string[] }>;
}

/** Every address made with one tag. */
export declare class TagGroup {
  readonly client: Simmail;
  readonly tag: string;
  newAddress(opts?: { domain?: string; prefix?: string }): Promise<TestAddress>;
  waitForEmail(opts: Omit<WaitOptions, "tag"> & { count: number }): Promise<WaitMany>;
  waitForEmail(opts?: Omit<WaitOptions, "tag">): Promise<Message>;
  expectNoEmail(opts?: Omit<NoEmailOptions, "tag">): Promise<NoEmail>;
  messages(opts?: { folder?: Folder; limit?: number }): Promise<Message[]>;
  cleanup(opts?: { folder?: Folder }): Promise<{ deleted: number; addresses: string[] }>;
}

// ---------------------------------------------------------------- namespaces

export interface MailboxesApi { (): Promise<Mailbox[]>; list(): Promise<Mailbox[]>; get(address: string): Mailbox }
export interface PersonasApi {
  (): Promise<Persona[]>;
  list(): Promise<Persona[]>;
  get(id: string): Promise<Persona>;
  create(p: PersonaInput): Promise<Persona>;
  update(id: string, changes: PersonaInput): Promise<Persona>;
  delete(id: string): Promise<unknown>;
  fromMail(address: string, opts?: { paused?: boolean }): Promise<{ persona: Persona; by: string; people: number }>;
  temperaments(): Promise<TemperamentInfo[]>;
  byAddress(address: string): Promise<Persona | null>;
}
export interface CasesApi { (): Promise<Case[]>; list(): Promise<Case[]>; get(id: string, opts?: { redact?: boolean }): Promise<Case>; push(id: string, data: CaseInput): Promise<Case>; delete(id: string): Promise<unknown> }
export interface ClockApi { (): Promise<ClockState>; get(): Promise<ClockState>; advance(duration: string): Promise<AdvanceResult>; freeze(): Promise<ClockState>; speed(factor: number): Promise<ClockState>; live(): Promise<ClockState> }
export interface JobsApi {
  (opts?: JobFilters): Promise<JobList>;
  list(opts?: JobFilters): Promise<Job[]>;
  run(id: number): Promise<unknown>;
  skip(id: number): Promise<unknown>;
  bounce(id: number): Promise<unknown>;
  reschedule(id: number, when: { due?: string; in?: string }): Promise<unknown>;
  /** Runs the matching pending jobs now, in due order. */
  runDue(opts?: RunDueOptions): Promise<RunDueResult>;
}
export interface WorldApi { (): Promise<{ world: World; kinds: StreamKind[] }>; get(): Promise<{ world: World; kinds: StreamKind[] }>; set(world: World): Promise<{ world: World }>; sendNow(streamId: string): Promise<{ status: string; note: string }> }
export interface FaultsApi { (): Promise<FaultRule[]>; list(): Promise<FaultRule[]>; set(rules: FaultRule[]): Promise<FaultRule[]>; clear(): Promise<FaultRule[]>; scenarios(): Promise<FaultScenarioInfo[]>; add(scenario: FaultScenario, opts?: { match?: string; window?: FaultRule["window"] }): Promise<FaultRule[]> }
export interface RecipientsApi { (): Promise<RecipientRules>; get(): Promise<RecipientRules>; set(rules: RecipientRules): Promise<RecipientRules>; setStatus(address: string, status: MailboxStatus): Promise<unknown> }
export interface WebhooksApi { (): Promise<Webhook[]>; list(): Promise<Webhook[]>; set(hooks: Webhook[]): Promise<Webhook[]>; clear(): Promise<Webhook[]> }
export interface InsightsApi { (opts?: { days?: number }): Promise<Record<string, unknown>>; get(opts?: { days?: number }): Promise<Record<string, unknown>>; shares(): Promise<{ token: string; title: string; days: number; created: string }[]>; share(opts: { title?: string; days?: number }): Promise<{ token: string; path: string }>; revoke(token: string): Promise<unknown> }
export interface EventsApi { (opts?: { since?: number; signal?: AbortSignal }): AsyncGenerator<SimEvent>; stream(opts?: { since?: number; signal?: AbortSignal }): AsyncGenerator<SimEvent>; log(opts?: { since?: number; limit?: number }): Promise<SimEvent[]>; waitFor(opts: EventWaitOptions): Promise<SimEvent> }
export interface AccountsApi { (): Promise<Account[]>; list(): Promise<Account[]>; create(address: string, password: string, extra?: AccountInput): Promise<unknown>; update(address: string, changes: AccountInput): Promise<unknown>; delete(address: string): Promise<unknown>; test(address: string, opts?: { password?: string; username?: string; proto?: Protocol }): Promise<LoginTest> }
export interface InspectApi { health(messageId: string): Promise<HealthReport>; extract(input: { text?: string; html?: string }): Promise<Extracted>; schema(): Promise<Schema> }
export interface SchemaOption { value: string; label?: string; description?: string; feature?: string }
export interface SchemaField { type: string; description?: string; values?: SchemaOption[]; default?: unknown; min?: number; max?: number; feature?: string; unset?: string }
export interface Schema { version: number; areas: Record<string, { endpoints?: string[]; description?: string; feature?: string; fields: Record<string, SchemaField> }> }
export interface BehaviourApi {
  ai(): Promise<{ mode: AiMode }>; setAi(mode: AiMode): Promise<{ mode: AiMode }>; aiBudget(): Promise<Record<string, unknown>>;
  pace(): Promise<{ factor: number; ignore_hours: boolean }>; setPace(opts: { factor?: number; ignoreHours?: boolean }): Promise<unknown>;
  links(): Promise<{ policy: LinkPolicy; habits: unknown[]; default_user_agent: string }>; setLinks(policy: LinkPolicy): Promise<unknown>;
  retention(): Promise<{ mail_days: number; event_days: number }>; setRetention(opts: { mailDays?: number; eventDays?: number }): Promise<unknown>; prune(): Promise<{ messages: number; events: number; jobs: number }>;
  junk(): Promise<{ settings: JunkSettings; defaults: JunkSettings }>; setJunk(settings: JunkSettings): Promise<JunkSettings>;
}

// ---------------------------------------------------------------- client

export interface SimmailOptions {
  /** The server, such as https://c1.simmail.dev. Default: SIMMAIL_URL. */
  baseUrl?: string;
  /** An API key, smk_…. Default: SIMMAIL_API_KEY. */
  apiKey?: string;
  /** A universe id; only needed when the key can reach more than one. Default: SIMMAIL_UNIVERSE. */
  universe?: string;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
  /** How often a GET, or a write with an Idempotency-Key, is tried again after a network error, 502 or 503. Default 2. */
  retries?: number;
}

export declare class Simmail {
  constructor(opts?: SimmailOptions);
  baseUrl: string;
  apiKey: string;
  universe: string;
  headers: Record<string, string>;
  retries: number;
  /** A client like this one that sends X-Request-Id: id with every request. */
  withRequestId(id: string): Simmail;
  /** Every setting's allowed values, defaults and limits. */
  schema(): Promise<Schema>;

  // namespaces (each also callable as the 0.1.0 method of the same name)
  mailboxes: MailboxesApi;
  personas: PersonasApi;
  cases: CasesApi;
  clock: ClockApi;
  jobs: JobsApi;
  world: WorldApi;
  faults: FaultsApi;
  recipients: RecipientsApi;
  webhooks: WebhooksApi;
  insights: InsightsApi;
  events: EventsApi;
  accounts: AccountsApi;
  inspect: InspectApi;
  behaviour: BehaviourApi;

  /** Any API call. */
  request<T = any>(method: string, path: string, body?: unknown, query?: Record<string, unknown>, opts?: { headers?: Record<string, string> }): Promise<T>;
  /** Any call whose answer is not JSON. */
  requestRaw(method: string, path: string, query?: Record<string, unknown>, opts?: { asBytes?: false }): Promise<string>;
  requestRaw(method: string, path: string, query: Record<string, unknown> | undefined, opts: { asBytes: true }): Promise<Uint8Array>;

  me(): Promise<Record<string, unknown>>;
  universes(): Promise<{ id: string; name: string; org: string; created: string; role: Role }[]>;
  status(): Promise<Record<string, unknown>>;
  connection(): Promise<Record<string, unknown>>;
  connectionCert(): Promise<string>;

  mailbox(address: string): Mailbox;
  waitForEmail(opts: WaitOptions & { count: number }): Promise<WaitMany>;
  waitForEmail(opts: WaitOptions): Promise<Message>;
  /** Passes when no matching email arrives within opts.within; throws UnexpectedEmailError when one does. */
  expectNoEmail(opts: NoEmailOptions): Promise<NoEmail>;
  waitForReply(opts: ReplyWaitOptions): Promise<Message>;
  waitForEvent(opts: EventWaitOptions): Promise<SimEvent>;
  waitForThread(opts: ThreadWaitOptions): Promise<Conversation>;

  createAddress(opts?: { domain?: string; prefix?: string; tag?: string }): Promise<TestAddressData>;
  testAddress(opts?: { domain?: string; prefix?: string; tag?: string }): Promise<TestAddress>;
  tag(tag: string): TagGroup;
  listMessages(opts: { tag?: string; to?: string | string[]; folder?: Folder; limit?: number }): Promise<Message[]>;
  deleteMessages(opts: { tag?: string; to?: string | string[]; folder?: Folder }): Promise<{ deleted: number; addresses: string[] }>;
  extract(input: { text?: string; html?: string }): Promise<Extracted>;
  folders(address: string): Promise<FolderInfo[]>;
  messages(address: string, opts?: { folder?: Folder }): Promise<Message[]>;
  message(address: string, folder: Folder, uid: number, opts?: { remote?: boolean; theme?: "light" }): Promise<{ message: Message; safe?: { html: string; remote_blocked: number }; case?: { id: string; how: string } }>;
  rawMessage(address: string, folder: Folder, uid: number): Promise<string>;
  attachment(address: string, folder: Folder, uid: number, n: number): Promise<Uint8Array>;
  updateMessage(address: string, folder: Folder, uid: number, change: { seen?: boolean; moveTo?: Folder }): Promise<unknown>;
  threads(address: string): Promise<Thread[]>;
  setMailboxStatus(address: string, status: MailboxStatus): Promise<unknown>;
  send(msg: SendInput, opts?: WriteOptions): Promise<SendResult>;
  inject(msg: InjectInput, opts?: WriteOptions): Promise<AnswerFacts & Record<string, unknown>>;
  signature(address: string): Promise<{ signature: string }>;
  setSignature(address: string, signature: string): Promise<unknown>;
  rescue(messageId: string, address: string): Promise<unknown>;
  retry(messageId: string, address?: string): Promise<{ results: unknown }>;
  health(messageId: string): Promise<HealthReport>;

  createAccount(address: string, password: string, extra?: AccountInput): Promise<unknown>;
  updateAccount(address: string, changes: AccountInput): Promise<unknown>;
  deleteAccount(address: string): Promise<unknown>;
  testAccount(address: string, opts?: { password?: string; username?: string; proto?: Protocol }): Promise<LoginTest>;

  persona(id: string): Promise<Persona>;
  createPersona(p: PersonaInput): Promise<Persona>;
  updatePersona(id: string, changes: PersonaInput): Promise<Persona>;
  deletePersona(id: string): Promise<unknown>;
  personaFromMail(address: string, opts?: { paused?: boolean }): Promise<{ persona: Persona; by: string; people: number }>;
  temperaments(): Promise<TemperamentInfo[]>;
  memory(id: string): Promise<Record<string, string[]>>;
  addMemory(id: string, note: { text: string; caseId?: string; source?: string }): Promise<unknown>;
  clearMemory(id: string, opts?: { caseId?: string }): Promise<unknown>;
  addMemoryByExternal(note: { system: string; id: string; text: string; caseId?: string; source?: string }): Promise<unknown>;
  relations(id: string): Promise<{ relations: unknown[]; stances: unknown[] }>;
  forgetRelations(id: string, opts?: { address?: string }): Promise<unknown>;

  getCase(id: string, opts?: { redact?: boolean }): Promise<Case>;
  pushCase(id: string, data: CaseInput): Promise<Case>;
  addCasePeople(id: string, people: CasePerson[]): Promise<Case>;
  initiateCase(id: string, opts: { persona: string; to: string | string[]; intent?: string; after?: string }): Promise<{ job_id: number }>;
  regenerateCase(id: string): Promise<Case>;
  editCaseStory(id: string, edit: { story?: string; amendments?: string[]; directions?: string }): Promise<Case>;
  deleteCase(id: string): Promise<unknown>;

  advance(duration: string): Promise<AdvanceResult>;
  freeze(): Promise<ClockState>;
  speed(factor: number): Promise<ClockState>;
  live(): Promise<ClockState>;
  runJob(id: number): Promise<unknown>;
  skipJob(id: number): Promise<unknown>;
  bounceJob(id: number): Promise<unknown>;
  rescheduleJob(id: number, when: { due?: string; in?: string }): Promise<unknown>;
  log(opts?: { since?: number; limit?: number }): Promise<SimEvent[]>;
  /** Runs the matching pending jobs now, in due order. */
  runDue(opts?: RunDueOptions): Promise<RunDueResult>;

  ai(): Promise<{ mode: AiMode }>;
  setAi(mode: AiMode): Promise<{ mode: AiMode }>;
  aiBudget(): Promise<Record<string, unknown>>;
  pace(): Promise<{ factor: number; ignore_hours: boolean }>;
  setPace(opts: { factor?: number; ignoreHours?: boolean }): Promise<unknown>;
  setRecipients(rules: RecipientRules): Promise<RecipientRules>;
  links(): Promise<{ policy: LinkPolicy; habits: unknown[]; default_user_agent: string }>;
  setLinks(policy: LinkPolicy): Promise<unknown>;
  retention(): Promise<{ mail_days: number; event_days: number }>;
  setRetention(opts: { mailDays?: number; eventDays?: number }): Promise<unknown>;
  pruneRetention(): Promise<{ messages: number; events: number; jobs: number }>;
  junkSettings(): Promise<{ settings: JunkSettings; defaults: JunkSettings }>;
  setJunkSettings(settings: JunkSettings): Promise<JunkSettings>;
  setFaults(rules: FaultRule[]): Promise<FaultRule[]>;
  faultScenarios(): Promise<FaultScenarioInfo[]>;
  addFaultScenario(id: FaultScenario, opts?: { match?: string; window?: FaultRule["window"] }): Promise<FaultRule[]>;
  insightShares(): Promise<{ token: string; title: string; days: number; created: string }[]>;
  shareInsights(opts: { title?: string; days?: number }): Promise<{ token: string; path: string }>;
  revokeInsightShare(token: string): Promise<unknown>;
  setWebhooks(hooks: Webhook[]): Promise<Webhook[]>;
  setWorld(world: World): Promise<{ world: World }>;
  sendFromStream(id: string): Promise<{ status: string; note: string }>;
}

export default Simmail;
