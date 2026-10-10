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

const ms = v => (typeof v === "number" ? `${v}ms` : v || undefined);

export class Simmail {
  /**
   * @param {{baseUrl?: string, apiKey?: string, universe?: string}} opts
   * Defaults: SIMMAIL_URL, SIMMAIL_API_KEY and SIMMAIL_UNIVERSE from the environment.
   */
  constructor(opts = {}) {
    const env = (typeof process !== "undefined" && process.env) || {};
    this.baseUrl = (opts.baseUrl || env.SIMMAIL_URL || "http://127.0.0.1:8025").replace(/\/+$/, "");
    this.apiKey = opts.apiKey || env.SIMMAIL_API_KEY || "";
    this.universe = opts.universe || env.SIMMAIL_UNIVERSE || "";
  }

  async request(method, path, body, query) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.universe) headers["X-Simmail-Universe"] = this.universe;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new SimmailError(res.status, (data && data.error) || res.statusText);
    return data;
  }

  /** The next email to an address (optionally from someone, with words in the subject or body). */
  waitForEmail({ to, from, subject, contains, folder, existing, timeout = 30000 }) {
    return this.request("GET", "/api/wait", undefined, { to, from, subject, contains, folder, existing, timeout: ms(timeout) });
  }

  /** The next email a persona sends, optionally in reply to a message. fast runs their due replies now. */
  waitForReply({ from, inReplyTo, fast = true, timeout = 30000 }) {
    return this.request("GET", "/api/wait/reply", undefined, { from, in_reply_to: inReplyTo, fast, timeout: ms(timeout) });
  }

  /** Codes and links from any text or HTML. */
  extract({ text, html }) { return this.request("POST", "/api/extract", { text, html }); }

  /** Send an email as an account or mailbox (as the app would). */
  send(msg) { return this.request("POST", "/api/send", msg); }

  /** The health report of a message your app sent: spam score and links. */
  health(messageId) { return this.request("GET", "/api/inspect", undefined, { message_id: messageId }); }

  personas() { return this.request("GET", "/api/personas"); }
  createPersona(p) { return this.request("POST", "/api/personas", p); }
  /** Push what your system knows about a matter; the people in it learn the story. */
  pushCase(id, kase) { return this.request("PUT", `/api/cases/${encodeURIComponent(id)}`, kase); }

  clock() { return this.request("GET", "/api/clock"); }
  advance(duration) { return this.request("POST", "/api/clock/advance", { duration }); }
  freeze() { return this.request("POST", "/api/clock/freeze", {}); }
  speed(factor) { return this.request("POST", "/api/clock/speed", { factor }); }
}

export default Simmail;
