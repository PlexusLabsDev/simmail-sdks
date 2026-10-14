// simmail client: wait for the email your app sends, pull out codes and
// links, and get replies from simulated people. No dependencies; Node 18+
// (uses fetch).

export class SimmailError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SimmailError";
    this.status = status;
  }
}

// A wait's timeout: milliseconds as a number, or a duration such as "45s".
const ms = v => (typeof v === "number" ? `${v}ms` : v || undefined);
const seg = s => encodeURIComponent(String(s));

export class Simmail {
  /**
   * @param {{baseUrl?: string, apiKey?: string, universe?: string}} opts
   * Defaults: SIMMAIL_URL, SIMMAIL_API_KEY and SIMMAIL_UNIVERSE from the environment.
   * baseUrl is the server's address, such as https://c1.simmail.dev (a trailing /api is fine too).
   */
  constructor(opts = {}) {
    const env = (typeof process !== "undefined" && process.env) || {};
    this.baseUrl = (opts.baseUrl || env.SIMMAIL_URL || "http://127.0.0.1:8025").replace(/\/+$/, "").replace(/\/api$/, "");
    this.apiKey = opts.apiKey || env.SIMMAIL_API_KEY || "";
    this.universe = opts.universe || env.SIMMAIL_UNIVERSE || "";
  }

  async request(method, path, body, query) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.universe) headers["X-Simmail-Universe"] = this.universe;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new SimmailError(res.status, (data && data.error) || res.statusText);
    return data;
  }

  /** Who the key is and which universe it belongs to. */
  me() { return this.request("GET", "/api/me"); }

  // ---- waiting for mail ----

  /** The next email to an address (optionally from someone, with words in the subject or body). */
  waitForEmail({ to, from, subject, contains, folder, existing, timeout = 30000 }) {
    return this.request("GET", "/api/wait", undefined, { to, from, subject, contains, folder, existing, timeout: ms(timeout) });
  }

  /** The next email a person sends, optionally in reply to a message. fast has them write it now. */
  waitForReply({ from, inReplyTo, fast = true, timeout = 30000 }) {
    return this.request("GET", "/api/wait/reply", undefined, { from, in_reply_to: inReplyTo, fast, timeout: ms(timeout) });
  }

  /** Codes and links from any text or HTML. */
  extract({ text, html }) { return this.request("POST", "/api/extract", { text, html }); }

  // ---- mailboxes and messages ----

  /** Every mailbox in the universe: your app's logins and the people's addresses. */
  mailboxes() { return this.request("GET", "/api/mailboxes"); }

  /** A mailbox's messages, newest first (text shortened; message() has all of it). */
  messages(address, { folder } = {}) {
    return this.request("GET", `/api/mailboxes/${seg(address)}/messages`, undefined, { folder });
  }

  /** One whole message. */
  message(address, folder, uid) {
    return this.request("GET", `/api/mailboxes/${seg(address)}/messages/${seg(folder)}/${seg(uid)}`);
  }

  /** The health report of a message your app sent: spam score, links, compatibility. */
  health(messageId) { return this.request("GET", "/api/inspect", undefined, { message_id: messageId }); }

  /** Send an email as an account or mailbox (as the app would). */
  send(msg) {
    const { inReplyTo, ...rest } = msg;
    return this.request("POST", "/api/send", inReplyTo ? { ...rest, in_reply_to: inReplyTo } : rest);
  }

  // ---- your app's mail logins ----

  accounts() { return this.request("GET", "/api/accounts"); }
  /** A login your app sends and reads with over SMTP and IMAP. */
  createAccount(address, password) { return this.request("POST", "/api/accounts", { address, password }); }

  // ---- people and stories ----

  personas() { return this.request("GET", "/api/personas"); }
  createPersona(p) { return this.request("POST", "/api/personas", p); }
  /** Push what your system knows about a matter; the people in it learn the story. */
  pushCase(id, kase) { return this.request("PUT", `/api/cases/${seg(id)}`, kase); }

  // ---- the simulated clock ----

  clock() { return this.request("GET", "/api/clock"); }
  /** Move time on, such as "2d"; what was due happens. */
  advance(duration) { return this.request("POST", "/api/clock/advance", { duration }); }
  freeze() { return this.request("POST", "/api/clock/freeze", {}); }
  speed(factor) { return this.request("POST", "/api/clock/speed", { factor }); }
  /** Back to real time. */
  live() { return this.request("POST", "/api/clock/live", {}); }
}

export default Simmail;
