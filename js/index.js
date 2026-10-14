// simmail client: wait for the email your app sends, pull out codes and
// links, get replies from simulated people, and drive the whole universe:
// mailboxes, people, cases, the clock, the World, faults, webhooks and
// more. No dependencies; Node 18+ (uses fetch).
//
// Objects such as a persona, a case, the World or fault rules use the API's
// own field names (snake_case), as the docs show them. Option arguments of
// the methods are camelCase.

import { Message, Mailbox, Persona, Case, Job, Account, SimEvent, Conversation, TestAddress, TagGroup } from "./models.js";

export * from "./enums.js";
export { Resource, Message, Mailbox, Persona, Case, Job, Account, SimEvent, Conversation, TestAddress, TagGroup } from "./models.js";

/**
 * A failed call. status is the HTTP status and message the server's words;
 * code (an ErrorCode), requestId, field, allowed and nearMisses are set when
 * the server sends them, and body is the whole answer. The subclasses below
 * say what kind of failure it is; catch SimmailError for all of them.
 */
export class SimmailError extends Error {
  get name() { return "SimmailError"; }
  constructor(status, message, body, requestId) {
    super(message);
    this.status = status;
    this.body = body;
    const b = body && typeof body === "object" ? body : {};
    this.code = b.code;
    this.requestId = b.request_id || requestId;
    this.field = b.field;
    this.allowed = b.allowed;
    this.nearMisses = b.near_misses;
    this.matched = b.matched;
    this.waitedMs = b.waited_ms;
  }
}
/** 400: the request was not valid (invalid_value, invalid_regex, bad_request); field and allowed say what and what is accepted. */
export class ValidationError extends SimmailError {}
/** 401: no key, or a key that does not work. */
export class AuthError extends SimmailError {}
/** 402: your plan does not include this, or its limit is reached. */
export class PlanLimitError extends SimmailError {}
/** 403: your role or key may not do this. */
export class ForbiddenError extends SimmailError {}
/** 404: there is no such thing. */
export class NotFoundError extends SimmailError {}
/** 408: a wait ended with nothing matching; nearMisses lists what almost matched, messages what a thread had. */
export class WaitTimeoutError extends SimmailError {}
/** 409: a conflict, such as a person who decided not to reply (fast waits). */
export class ConflictError extends SimmailError {}
/** 409: expectNoEmail saw an email; email is that message. */
export class UnexpectedEmailError extends ConflictError {}
/** 422: an Idempotency-Key was used before for a different request. */
export class IdempotencyError extends SimmailError {}
/** 429: too many requests; retryAfter is in seconds, when the server says. */
export class RateLimitedError extends SimmailError {
  constructor(status, message, body, requestId, retryAfter) { super(status, message, body, requestId); this.retryAfter = retryAfter; }
}
const BY_CODE = {
  bad_request: ValidationError, invalid_value: ValidationError, invalid_regex: ValidationError, unauthorized: AuthError,
  not_in_plan: PlanLimitError, forbidden: ForbiddenError, not_found: NotFoundError, timeout: WaitTimeoutError, wait_timeout: WaitTimeoutError,
  conflict: ConflictError, unexpected_email: UnexpectedEmailError, idempotency_mismatch: IdempotencyError, rate_limited: RateLimitedError,
};
const BY_STATUS = { 400: ValidationError, 401: AuthError, 402: PlanLimitError, 403: ForbiddenError, 404: NotFoundError, 408: WaitTimeoutError, 409: ConflictError, 429: RateLimitedError };
for (const C of [ValidationError, AuthError, PlanLimitError, ForbiddenError, NotFoundError, WaitTimeoutError, ConflictError, UnexpectedEmailError, IdempotencyError, RateLimitedError]) {
  Object.defineProperty(C.prototype, "name", { value: C.name });
}

/** The error for a failed answer: by its code, else by its status. */
export function errorFor(status, message, body, { retryAfter, requestId } = {}) {
  const code = body && typeof body === "object" ? body.code : undefined;
  const C = BY_CODE[code] || BY_STATUS[status] || SimmailError;
  return C === RateLimitedError ? new C(status, message, body, requestId, retryAfter) : new C(status, message, body, requestId);
}

// A wait's timeout: milliseconds as a number, or a duration such as "45s".
const ms = v => (typeof v === "number" ? `${v}ms` : v || undefined);
const seg = s => encodeURIComponent(String(s));
const msgPath = (address, folder, uid) => `/api/mailboxes/${seg(address)}/messages/${seg(folder)}/${seg(uid)}`;
// Drops undefined fields, so the server keeps what was not sent.
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
// camelCase option names to the API's snake_case query and body names.
const snake = k => k.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
const snakeKeys = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v]));
// A list answer as resource objects (anything else passes through).
const each = (r, f) => (Array.isArray(r) ? r.map(f) : r);

// Ids for Idempotency-Key and the like.
const newId = () => globalThis.crypto?.randomUUID?.() || Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const sleepMs = n => new Promise(r => setTimeout(r, n));
// Facts about an answer, on the result without being part of its data.
const meta = (o, facts) => {
  if (o && typeof o === "object") for (const [k, v] of Object.entries(facts)) if (v !== undefined) Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true });
  return o;
};
// A Date as RFC 3339; anything else as it is.
const when = v => (v instanceof Date ? v.toISOString() : v);
// A RegExp as the server's (RE2) syntax: its source, with (?i) for the i flag.
const rx = v => (v instanceof RegExp ? (v.flags.includes("i") ? "(?i)" : "") + v.source : v);
const list = v => (Array.isArray(v) ? v.join(",") : v);
// header filters: ["Name:value"] or {Name: "value"}.
const headerList = h => (h && !Array.isArray(h) && typeof h === "object" ? Object.entries(h).map(([k, v]) => `${k}:${v}`) : h);

// The filters every mail wait and GET /api/messages understand.
function mailFilters({ to, tag, from, subject, contains, folder, existing, count, since, exclude, subjectRegex, bodyRegex, header, hasAttachment, attachmentName, linkDomain, ...more }) {
  return {
    to, tag, from, subject, contains, folder, existing, count, since: when(since), exclude: list(exclude),
    subject_regex: rx(subjectRegex), body_regex: rx(bodyRegex), header: headerList(header),
    has_attachment: hasAttachment, attachment_name: attachmentName, link_domain: linkDomain, ...snakeKeys(more),
  };
}

export class Simmail {
  /**
   * @param {{baseUrl?: string, apiKey?: string, universe?: string, headers?: Record<string,string>, retries?: number}} opts
   * Defaults: SIMMAIL_URL, SIMMAIL_API_KEY and SIMMAIL_UNIVERSE from the environment.
   * baseUrl is the server's address, such as https://c1.simmail.dev (a trailing /api is fine too).
   * headers are sent with every request. retries (default 2) is how often a GET, or a POST with an
   * Idempotency-Key, is tried again after a network error, 502 or 503.
   */
  constructor(opts = {}) {
    const env = (typeof process !== "undefined" && process.env) || {};
    this.baseUrl = (opts.baseUrl || env.SIMMAIL_URL || "http://127.0.0.1:8025").replace(/\/+$/, "").replace(/\/api$/, "");
    this.apiKey = opts.apiKey || env.SIMMAIL_API_KEY || "";
    this.universe = opts.universe || env.SIMMAIL_UNIVERSE || "";
    this.headers = { ...(opts.headers || {}) };
    this.retries = opts.retries ?? 2;
    this.#namespaces();
  }

  /** A client like this one that sends X-Request-Id: id with every request (the server's logs and errors carry it). */
  withRequestId(id) {
    return new Simmail({ baseUrl: this.baseUrl, apiKey: this.apiKey, universe: this.universe, retries: this.retries, headers: { ...this.headers, "X-Request-Id": id } });
  }

  // Groups of calls by what they are about. Each group is also callable as
  // the 0.1.0 method of the same name, so mail.clock() and
  // mail.clock.advance("2d") both work.
  #namespaces() {
    const P = Simmail.prototype, call = name => (...a) => P[name].apply(this, a);
    const ns = (fn, methods) => Object.assign(fn, methods);
    this.mailboxes = ns(call("mailboxes"), { list: call("mailboxes"), get: address => this.mailbox(address) });
    this.personas = ns(call("personas"), {
      list: call("personas"), get: call("persona"), create: call("createPersona"), update: call("updatePersona"), delete: call("deletePersona"),
      fromMail: call("personaFromMail"), temperaments: call("temperaments"),
      /** The persona who plays an address, or null. */
      byAddress: async address => (await P.personas.call(this)).find(p => (p.addresses || []).some(a => a.toLowerCase() === String(address).toLowerCase())) || null,
    });
    this.cases = ns(call("cases"), { list: call("cases"), get: call("getCase"), push: call("pushCase"), delete: call("deleteCase") });
    this.clock = ns(call("clock"), { get: call("clock"), advance: call("advance"), freeze: call("freeze"), speed: call("speed"), live: call("live") });
    this.jobs = ns(call("jobs"), {
      list: async opts => (await P.jobs.call(this, opts)).jobs, run: call("runJob"), skip: call("skipJob"), bounce: call("bounceJob"), reschedule: call("rescheduleJob"),
      runDue: call("runDue"),
    });
    this.world = ns(call("world"), { get: call("world"), set: call("setWorld"), sendNow: call("sendFromStream") });
    this.faults = ns(call("faults"), { list: call("faults"), set: call("setFaults"), clear: () => P.setFaults.call(this, []), scenarios: call("faultScenarios"), add: call("addFaultScenario") });
    this.recipients = ns(call("recipients"), { get: call("recipients"), set: call("setRecipients"), setStatus: call("setMailboxStatus") });
    this.webhooks = ns(call("webhooks"), { list: call("webhooks"), set: call("setWebhooks"), clear: () => P.setWebhooks.call(this, []) });
    this.insights = ns(call("insights"), { get: call("insights"), shares: call("insightShares"), share: call("shareInsights"), revoke: call("revokeInsightShare") });
    this.events = ns(call("events"), { stream: call("events"), log: call("log"), waitFor: call("waitForEvent") });
    this.accounts = ns(call("accounts"), { list: call("accounts"), create: call("createAccount"), update: call("updateAccount"), delete: call("deleteAccount"), test: call("testAccount") });
    this.inspect = { health: call("health"), extract: call("extract"), schema: call("schema") };
    this.behaviour = {
      ai: call("ai"), setAi: call("setAi"), aiBudget: call("aiBudget"), pace: call("pace"), setPace: call("setPace"),
      links: call("links"), setLinks: call("setLinks"), retention: call("retention"), setRetention: call("setRetention"), prune: call("pruneRetention"),
      junk: call("junkSettings"), setJunk: call("setJunkSettings"),
    };
  }

  #url(path, query) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, String(x));
      else url.searchParams.set(k, String(v));
    }
    return url;
  }

  #headers(accept, body, extra) {
    const headers = { Accept: accept, ...this.headers, ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.universe) headers["X-Simmail-Universe"] = this.universe;
    return headers;
  }

  // fetch, tried again after a network error, 502 or 503 when it is safe:
  // a GET, or a write with an Idempotency-Key.
  async #fetch(method, url, init) {
    const safe = method === "GET" || !!(init.headers && init.headers["Idempotency-Key"]);
    for (let n = 0; ; n++) {
      try {
        const res = await fetch(url, { method, ...init });
        if (!safe || n >= this.retries || (res.status !== 502 && res.status !== 503)) return res;
      } catch (e) {
        if (!safe || n >= this.retries || init.signal?.aborted) throw e;
      }
      await sleepMs(250 * 2 ** n);
    }
  }

  async #fail(res) {
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const ra = Number(res.headers.get("retry-after"));
    const err = errorFor(res.status, (data && data.error) || res.statusText, data, {
      retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined, requestId: res.headers.get("x-request-id") || undefined,
    });
    if (err instanceof UnexpectedEmailError && data && data.message) err.email = new Message(this, data.message);
    if (err instanceof WaitTimeoutError && data && Array.isArray(data.messages)) err.messages = data.messages.map(m => new Message(this, m));
    throw err;
  }

  /**
   * Any API call: the method, the path (such as "/api/clock"), a JSON body and
   * query parameters (an array value repeats the parameter). headers adds
   * request headers, such as an Idempotency-Key. An object answer carries
   * requestId (and replayed, for a repeated Idempotency-Key) without them
   * being part of its data.
   */
  async request(method, path, body, query, { headers } = {}) {
    const res = await this.#fetch(method, this.#url(path, query), { headers: this.#headers("application/json", body, headers), body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) await this.#fail(res);
    const text = await res.text();
    let out;
    try { out = text ? JSON.parse(text) : null; } catch { return text; }
    return meta(out, { requestId: res.headers.get("x-request-id") || undefined, replayed: res.headers.get("idempotent-replayed") === "true" || undefined });
  }

  /** Like request, for answers that are not JSON: as text, or as bytes with asBytes. */
  async requestRaw(method, path, query, { asBytes = false } = {}) {
    const res = await this.#fetch(method, this.#url(path, query), { headers: this.#headers("*/*") });
    if (!res.ok) await this.#fail(res);
    return asBytes ? new Uint8Array(await res.arrayBuffer()) : res.text();
  }

  /** Every setting's allowed values, defaults and limits: {version, areas}. The SDK's enums are made from it. */
  schema() { return this.request("GET", "/api/schema"); }

  // ---- who and where (https://www.simmail.dev/docs/api/accounts/#who-am-i) ----

  /** Who the key is and which universe it belongs to. */
  me() { return this.request("GET", "/api/me"); }
  /** The universes you can open, with your role in each. */
  universes() { return this.request("GET", "/api/universes"); }
  /** Counts of mailboxes, messages, personas, cases and pending jobs, the clock and the writer. */
  status() { return this.request("GET", "/api/status"); }
  /** The server's SMTP/IMAP services, ports, security and certificate. */
  connection() { return this.request("GET", "/api/connection"); }
  /** The server's TLS certificate, as PEM text. */
  connectionCert() { return this.requestRaw("GET", "/api/connection/cert"); }

  // ---- waiting for mail (https://www.simmail.dev/docs/testing/wait-api/) ----

  /**
   * The next email that matches. to is an address, *@domain or a list of them
   * (or use tag, from testAddress); from, subject and contains narrow it, and
   * so do subjectRegex/bodyRegex (RegExp or string), header ({Name: value} or
   * ["Name:value"]), hasAttachment, attachmentName and linkDomain. since (a
   * Date, RFC 3339 or a message id) and exclude (message ids) say which mail
   * counts; existing: true also takes mail that came before the wait.
   * Answers the Message (with waitedMs and matched), or with count n: {messages,
   * count, waited_ms, matched} once n have come. On timeout it throws
   * WaitTimeoutError with nearMisses. Unknown options pass through as snake_case.
   */
  async waitForEmail({ timeout = 30000, ...filters } = {}) {
    const r = await this.request("GET", "/api/wait", undefined, { ...mailFilters(filters), timeout: ms(timeout) });
    if (Array.isArray(r)) return r.map(m => new Message(this, m));
    if (r && Array.isArray(r.messages)) return meta({ ...r, messages: r.messages.map(m => new Message(this, m)) }, { requestId: r.requestId });
    return r && typeof r === "object" ? new Message(this, r) : r;
  }

  /**
   * Passes when no matching email arrives for a while: within (default "5s";
   * a number is milliseconds), with waitForEmail's filters. Answers {none:
   * true, waited_ms, matched}; throws UnexpectedEmailError (with .email) when one comes.
   */
  expectNoEmail({ within, for: forDur, ...filters } = {}) {
    return this.request("GET", "/api/wait/none", undefined, { ...mailFilters(filters), for: ms(within ?? forDur) });
  }

  /** The next email a person sends, optionally in reply to a message. fast has them write it now. Other options pass through. */
  async waitForReply({ from, inReplyTo, fast = true, timeout = 30000, ...more }) {
    return new Message(this, await this.request("GET", "/api/wait/reply", undefined, { from, in_reply_to: inReplyTo, fast, timeout: ms(timeout), ...snakeKeys(more) }));
  }

  /**
   * The next event of a type (EventType or EventAlias such as "replied"; a
   * list, or a prefix such as "persona.*"), optionally for one persona (id or
   * address) or message, after an event id. fast has the persona act on what
   * is due now. Answers the SimEvent (with waitedMs).
   */
  async waitForEvent({ type, persona, messageId, after, fast, timeout = 30000 } = {}) {
    const r = await this.request("GET", "/api/wait/event", undefined, { type: list(type), persona, message_id: messageId, after, fast, timeout: ms(timeout) });
    return meta(new SimEvent(this, r.event), { waitedMs: r.waited_ms, requestId: r.requestId });
  }

  /**
   * A conversation once nothing new has joined it for quiet (default "10s"):
   * by messageId (any message in it) or thread (its first message's id). fast
   * has the people in it act now. Answers a Conversation.
   */
  async waitForThread({ messageId, thread, quiet, fast, timeout = 60000 } = {}) {
    const r = await this.request("GET", "/api/wait/thread", undefined, { message_id: messageId, thread, quiet: ms(quiet), fast, timeout: ms(timeout) });
    return new Conversation(this, r);
  }

  /** Codes and links from any text or HTML. */
  extract({ text, html }) { return this.request("POST", "/api/extract", { text, html }); }

  // ---- mailboxes and messages (https://www.simmail.dev/docs/api/mail/) ----

  /** Every mailbox in the universe: your app's logins and the people's addresses. */
  async mailboxes() { return each(await this.request("GET", "/api/mailboxes"), m => new Mailbox(this, m)); }

  /** One mailbox, to read and wait on (no request is made). */
  mailbox(address) { return new Mailbox(this, { address }); }

  /** A mailbox's folders, with counts. */
  folders(address) { return this.request("GET", `/api/mailboxes/${seg(address)}/folders`); }

  /** A mailbox's messages, newest first (text shortened; message() has all of it). */
  async messages(address, { folder } = {}) {
    const r = await this.request("GET", `/api/mailboxes/${seg(address)}/messages`, undefined, { folder });
    return each(r, m => new Message(this, m, { address, folder: folder || "INBOX" }));
  }

  /** One whole message: {message, safe, case}. remote allows remote images in safe; theme "light" skips dark-mode adapting. */
  async message(address, folder, uid, { remote, theme } = {}) {
    const r = await this.request("GET", msgPath(address, folder, uid), undefined, { remote: remote ? 1 : undefined, theme });
    if (r && r.message) {
      r.message = new Message(this, r.message, { address, folder });
      Object.defineProperty(r.message, "safe", { value: r.safe, enumerable: false });
      Object.defineProperty(r.message, "case", { value: r.case, enumerable: false });
    }
    return r;
  }

  /** The original message, as RFC 5322 text. */
  rawMessage(address, folder, uid) { return this.requestRaw("GET", `${msgPath(address, folder, uid)}/raw`); }

  /** Attachment number n (from 0) of a message, as bytes. */
  attachment(address, folder, uid, n) {
    return this.requestRaw("GET", `${msgPath(address, folder, uid)}/attachments/${seg(n)}`, undefined, { asBytes: true });
  }

  /** What a mail client does: mark read or unread, move to a folder. */
  updateMessage(address, folder, uid, { seen, moveTo } = {}) {
    return this.request("PATCH", msgPath(address, folder, uid), clean({ seen, move_to: moveTo }));
  }

  /** A mailbox's conversations, most recent first. */
  threads(address) { return this.request("GET", "/api/threads", undefined, { address }); }

  /** Forces how an address behaves as a recipient: ok, unknown, domain, full, disabled or blocked. */
  setMailboxStatus(address, status) { return this.request("PUT", `/api/mailboxes/${seg(address)}/status`, { status }); }

  // ---- test addresses (https://www.simmail.dev/docs/testing/wait-api/) ----

  /** A fresh address for one test: {address, tag}. domain defaults to inbox.test. */
  createAddress({ domain, prefix, tag } = {}) { return this.request("POST", "/api/addresses", clean({ domain, prefix, tag })); }

  /** A fresh address for one test, as a TestAddress: waitForEmail(), expectNoEmail(), messages(), cleanup(). */
  async testAddress({ domain, prefix, tag } = {}) { return new TestAddress(this, await this.createAddress({ domain, prefix, tag })); }

  /** Every address made with a tag, together: waitForEmail(), expectNoEmail(), messages(), cleanup(). No request is made. */
  tag(tag) { return new TagGroup(this, tag); }

  /** Messages across addresses (to: an address, *@domain or a list) or a tag's addresses, newest first. */
  async listMessages({ tag, to, folder, limit } = {}) {
    return each(await this.request("GET", "/api/messages", undefined, { tag, to, folder, limit }), m => new Message(this, m, { folder: folder || "INBOX" }));
  }

  /** Deletes the mail of those addresses (every folder, or one): {deleted, addresses}. */
  deleteMessages({ tag, to, folder } = {}) { return this.request("DELETE", "/api/messages", undefined, { tag, to, folder }); }

  // ---- sending (https://www.simmail.dev/docs/api/mail/#sending) ----

  /**
   * Send an email as an account or mailbox (as the app would): from, to, cc,
   * subject, text, html, attachments, inReplyTo, references, forward.
   * Each call gets its own Idempotency-Key, so a retried call never sends
   * twice; pass idempotencyKey to choose it (false sends none). The answer
   * carries replayed (true when the server had already done it) and requestId.
   */
  send(msg, { idempotencyKey } = {}) {
    const { inReplyTo, ...rest } = msg;
    return this.request("POST", "/api/send", inReplyTo ? { ...rest, in_reply_to: inReplyTo } : rest, undefined, idem(idempotencyKey));
  }

  /** Files a message straight into a mailbox, skipping SMTP; nobody is told. {to, folder, from, subject, text} or {to, folder, raw}. Idempotent like send. */
  inject(msg, { idempotencyKey } = {}) { return this.request("POST", "/api/inject", msg, undefined, idem(idempotencyKey)); }

  /** The signature people see for an address. */
  signature(address) { return this.request("GET", `/api/accounts/${seg(address)}/signature`); }
  /** Sets an address's signature. Admin role. */
  setSignature(address, signature) { return this.request("PUT", `/api/accounts/${seg(address)}/signature`, { signature }); }

  /** Moves a message a person got out of their Junk folder, as if they rescued it. */
  rescue(messageId, address) { return this.request("POST", "/api/rescue", { message_id: messageId, address }); }
  /** Has people react to a message again (one person with address). */
  retry(messageId, address) { return this.request("POST", "/api/retry", clean({ message_id: messageId, address })); }

  // ---- your app's mail logins (https://www.simmail.dev/docs/api/accounts/) ----

  /** Every login, with its settings (and passwords). */
  async accounts() { return each(await this.request("GET", "/api/accounts"), a => new Account(this, a)); }
  /** A login your app sends and reads with over SMTP and IMAP. extra: display_name, username, allow_smtp, allow_imap, note. Admin role. */
  createAccount(address, password, extra = {}) { return this.request("POST", "/api/accounts", { ...extra, address, password }); }
  /** Changes a login; fields left out keep their values. Admin role. */
  updateAccount(address, changes) { return this.request("PATCH", `/api/accounts/${seg(address)}`, changes); }
  /** Turns a login off for good; the mailbox and its mail stay. Admin role. */
  deleteAccount(address) { return this.request("DELETE", `/api/accounts/${seg(address)}`); }
  /** Checks a password the way SMTP and IMAP do. proto: "smtp" or "imap" for only one. */
  testAccount(address, { password, username, proto } = {}) {
    return this.request("POST", `/api/accounts/${seg(address)}/test`, clean({ password, username, proto }));
  }

  // ---- people (https://www.simmail.dev/docs/api/personas/) ----

  /** Every persona, sorted by name. */
  async personas() { return each(await this.request("GET", "/api/personas"), p => new Persona(this, p)); }
  /** One persona. */
  async persona(id) { return new Persona(this, await this.request("GET", `/api/personas/${seg(id)}`)); }
  /** Creates a persona (and its mailbox). */
  async createPersona(p) { return new Persona(this, await this.request("POST", "/api/personas", p)); }
  /** Changes only the fields you send (a nested object you send replaces that whole object). */
  async updatePersona(id, changes) { return new Persona(this, await this.request("PATCH", `/api/personas/${seg(id)}`, changes)); }
  /** Deletes a persona with its memory, relations and pending jobs; the mailbox stays. */
  deletePersona(id) { return this.request("DELETE", `/api/personas/${seg(id)}`); }
  /** Learns a persona from an address's mail in this universe. */
  async personaFromMail(address, { paused } = {}) {
    const r = await this.request("POST", "/api/personas/from-mail", clean({ address, paused }));
    if (r && r.persona) r.persona = new Persona(this, r.persona);
    return r;
  }
  /** The temperaments people can have, with their odds and reply habits. */
  temperaments() { return this.request("GET", "/api/temperaments"); }

  /** A persona's memory, by case id ("" is everything outside a case). */
  memory(id) { return this.request("GET", `/api/personas/${seg(id)}/memory`); }
  /** Adds a note to a persona's memory. */
  addMemory(id, { text, caseId, source }) { return this.request("POST", `/api/personas/${seg(id)}/memory`, clean({ text, case_id: caseId, source })); }
  /** Clears a persona's memory, or only one case's. */
  clearMemory(id, { caseId } = {}) { return this.request("DELETE", `/api/personas/${seg(id)}/memory`, undefined, { case_id: caseId }); }
  /** Adds a note to the persona with your id for them, such as {system: "crm", id: "c-1042"}. */
  addMemoryByExternal({ system, id, text, caseId, source }) {
    return this.request("POST", "/api/memory/by-external", clean({ system, id, text, case_id: caseId, source }));
  }
  /** What a persona holds about each correspondent: {relations, stances}. */
  relations(id) { return this.request("GET", `/api/personas/${seg(id)}/relations`); }
  /** Has a persona forget one correspondent, or everyone. */
  forgetRelations(id, { address } = {}) { return this.request("DELETE", `/api/personas/${seg(id)}/relations`, undefined, { address }); }

  // ---- cases (https://www.simmail.dev/docs/api/cases/) ----

  /** Every case, most recently updated first (stories cut short). */
  async cases() { return each(await this.request("GET", "/api/cases"), c => new Case(this, c)); }
  /** One case with its full story; redact: true leaves the story out. */
  async getCase(id, { redact } = {}) { return new Case(this, await this.request("GET", `/api/cases/${seg(id)}`, undefined, { redact: redact ? "story" : undefined })); }
  /** Push what your system knows about a matter; the people in it learn the story. */
  async pushCase(id, kase) { return new Case(this, await this.request("PUT", `/api/cases/${seg(id)}`, kase)); }
  /** Adds or updates people on a case. */
  async addCasePeople(id, people) { return new Case(this, await this.request("POST", `/api/cases/${seg(id)}/people`, people)); }
  /** Has a person start a new thread: persona (id or address), to, intent, after (such as "2h"). */
  initiateCase(id, { persona, to, intent, after }) {
    return this.request("POST", `/api/cases/${seg(id)}/initiate`, clean({ persona, to, intent, after }));
  }
  /** Writes the story and cast details again. */
  async regenerateCase(id) { return new Case(this, await this.request("POST", `/api/cases/${seg(id)}/regenerate`, {})); }
  /** Rewrites the answer key by hand: story, amendments, directions. */
  async editCaseStory(id, { story, amendments, directions } = {}) {
    return new Case(this, await this.request("PATCH", `/api/cases/${seg(id)}/story`, clean({ story, amendments, directions })));
  }
  /** Deletes a case, its people's memory of it and their pending work on it. */
  deleteCase(id) { return this.request("DELETE", `/api/cases/${seg(id)}`); }

  // ---- the simulated clock and jobs (https://www.simmail.dev/docs/api/clock/) ----

  clock() { return this.request("GET", "/api/clock"); }
  /** Move time on, such as "2d"; what was due happens. */
  advance(duration) { return this.request("POST", "/api/clock/advance", { duration }); }
  freeze() { return this.request("POST", "/api/clock/freeze", {}); }
  speed(factor) { return this.request("POST", "/api/clock/speed", { factor }); }
  /** Back to real time. */
  live() { return this.request("POST", "/api/clock/live", {}); }

  /**
   * Planned work: replies, follow-ups, nudges. state (JobState), persona (id or
   * address), kind (JobKind), dueBefore (a Date, RFC 3339 or a duration such
   * as "1h" from the simulated now) and limit narrow it. Other filters pass through.
   */
  async jobs({ state, persona, kind, dueBefore, limit, ...more } = {}) {
    const r = await this.request("GET", "/api/jobs", undefined, { state, persona, kind, due_before: when(dueBefore), limit, ...snakeKeys(more) });
    if (r && Array.isArray(r.jobs)) r.jobs = r.jobs.map(j => new Job(this, j));
    return r;
  }
  /**
   * Runs the matching pending jobs now, in due order (persona, kind, before:
   * only those due by then, limit): {ran: [{id, kind, persona, state, note}], count, remaining}.
   */
  runDue({ persona, kind, before, limit } = {}) {
    return this.request("POST", "/api/jobs/run-due", clean({ persona, kind, before: when(before), limit }));
  }
  /** Runs a pending job now. */
  runJob(id) { return this.request("POST", `/api/jobs/${seg(id)}/run-now`, {}); }
  /** Skips a pending job. */
  skipJob(id) { return this.request("POST", `/api/jobs/${seg(id)}/skip`, {}); }
  /** Turns a planned reply into a bounce and runs it now. */
  bounceJob(id) { return this.request("POST", `/api/jobs/${seg(id)}/bounce`, {}); }
  /** Reschedules a pending job: due (a time) or in (such as "10m" from now). */
  rescheduleJob(id, { due, in: after } = {}) { return this.request("PATCH", `/api/jobs/${seg(id)}`, clean({ due, in: after })); }

  // ---- events (https://www.simmail.dev/docs/api/events/) ----

  /** Events after a point, oldest first. Page with the last id as the next since. */
  async log({ since, limit } = {}) { return each(await this.request("GET", "/api/log", undefined, { since, limit }), e => new SimEvent(this, e)); }

  /**
   * The live event stream, as an async iterator of events ({id, at, kind, data}).
   * since replays up to 500 earlier events first. Stop with signal (an AbortSignal) or break.
   */
  async *events({ since, signal } = {}) {
    const res = await fetch(this.#url("/api/events", { since }), { headers: this.#headers("text/event-stream"), signal });
    if (!res.ok) await this.#fail(res);
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
          if (data) yield new SimEvent(this, JSON.parse(data));
        }
      }
    } finally {
      res.body.cancel?.().catch?.(() => {});
    }
  }

  // ---- how the universe behaves (https://www.simmail.dev/docs/api/behaviour/) ----

  /** Whether people write with AI: {mode: "on" | "off"}. */
  ai() { return this.request("GET", "/api/ai"); }
  /** AI writing "on" or "off". Member role. */
  setAi(mode) { return this.request("PUT", "/api/ai", { mode }); }
  /** The server's daily AI budget, when it has one. */
  aiBudget() { return this.request("GET", "/api/ai/budget"); }
  /** How fast people reply. */
  pace() { return this.request("GET", "/api/pace"); }
  /** factor scales reply delays (0.1 is ten times faster); ignoreHours lets people reply at any hour. */
  setPace({ factor, ignoreHours } = {}) { return this.request("PUT", "/api/pace", clean({ factor, ignore_hours: ignoreHours })); }
  /** Recipient rules: which addresses exist, which are bad, who is behind never-seen ones. */
  recipients() { return this.request("GET", "/api/recipients"); }
  /** Replaces the recipient rules. Admin role. */
  setRecipients(rules) { return this.request("PUT", "/api/recipients", rules); }
  /** The rules for people opening links: {policy, habits, default_user_agent}. */
  links() { return this.request("GET", "/api/links"); }
  /** Replaces the link policy (send every field). Admin role. */
  setLinks(policy) { return this.request("PUT", "/api/links", policy); }
  /** How long mail and events are kept, in simulated days. */
  retention() { return this.request("GET", "/api/retention"); }
  /** mailDays and eventDays; 0 keeps forever. Admin role. */
  setRetention({ mailDays, eventDays } = {}) { return this.request("PUT", "/api/retention", clean({ mail_days: mailDays, event_days: eventDays })); }
  /** Applies retention now. */
  pruneRetention() { return this.request("POST", "/api/retention/prune", {}); }
  /** Spam & Junk settings: {settings, defaults}. */
  junkSettings() { return this.request("GET", "/api/junk"); }
  /** Replaces the Spam & Junk settings. Admin role. */
  setJunkSettings(settings) { return this.request("PUT", "/api/junk", settings); }

  // ---- chaos and faults (https://www.simmail.dev/docs/api/faults/) ----

  /** The universe's fault rules, in order. */
  faults() { return this.request("GET", "/api/faults"); }
  /** Replaces all fault rules ([] clears them). Admin role. */
  setFaults(rules) { return this.request("PUT", "/api/faults", rules); }
  /** The scenario library: ready-made rules from real providers. */
  faultScenarios() { return this.request("GET", "/api/faults/scenarios"); }
  /** Adds a scenario as an enabled rule; match and window are optional. Admin role. */
  addFaultScenario(id, { match, window } = {}) { return this.request("POST", `/api/faults/scenarios/${seg(id)}`, clean({ match, window })); }

  // ---- inspection and insights (https://www.simmail.dev/docs/api/inspect/) ----

  /** The health report of a message your app sent: spam score, links, compatibility. */
  health(messageId) { return this.request("GET", "/api/inspect", undefined, { message_id: messageId }); }
  /** The insights report for the last days of simulated time (1 to 366, default 30). */
  insights({ days } = {}) { return this.request("GET", "/api/insights", undefined, { days }); }
  /** The universe's shared reports. */
  insightShares() { return this.request("GET", "/api/insights/shares"); }
  /** Shares a report publicly: {token, path}. */
  shareInsights({ title, days } = {}) { return this.request("POST", "/api/insights/shares", clean({ title, days })); }
  /** Revokes a shared report. */
  revokeInsightShare(token) { return this.request("DELETE", `/api/insights/shares/${seg(token)}`); }

  // ---- webhooks (https://www.simmail.dev/docs/api/webhooks/) ----

  /** The webhooks (secrets shown as ••••). */
  webhooks() { return this.request("GET", "/api/webhooks"); }
  /** Replaces all webhooks ([] removes them). Send "••••" to keep a secret. Admin role. */
  setWebhooks(hooks) { return this.request("PUT", "/api/webhooks", hooks); }

  // ---- the World (https://www.simmail.dev/docs/api/world/) ----

  /** The company and its inbound streams: {world, kinds}. */
  world() { return this.request("GET", "/api/world"); }
  /** Replaces the company and all streams: {company, streams}. Admin role. */
  setWorld(world) { return this.request("PUT", "/api/world", world); }
  /** Sends one email from a stream now. */
  sendFromStream(id) { return this.request("POST", `/api/world/streams/${seg(id)}/send`, {}); }
}

function idem(key) { return key === false ? undefined : { headers: { "Idempotency-Key": key || newId() } }; }

export default Simmail;
