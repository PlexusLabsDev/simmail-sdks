// Every method against a local fake server: the request it makes (method,
// path, query, body), the objects it returns, errors and the event stream.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  Simmail, SimmailError, NotFoundError, ValidationError, PlanLimitError, WaitTimeoutError, RateLimitedError, ConflictError, ForbiddenError,
  Message, Mailbox, Persona, Case, Job, Account, Temperament, FaultScenario, MailboxStatus, JobKind, Folder,
  UnexpectedEmailError, IdempotencyError, AuthError, SimEvent, Conversation, TestAddress, TagGroup, EventAlias, EventType, ErrorCode, EnumInfo, describe,
} from "../index.js";

let server, base, flaky = 0;
const seen = [];
const last = () => seen[seen.length - 1];
const NOW = "2026-10-10T14:00:00Z";

// What the fake answers, by path; everything else gets {ok: true}.
function answer(req, u, body) {
  const p = u.pathname;
  if (p === "/api/fail") return [Number(u.searchParams.get("status")), { error: "nope", code: "some_code", request_id: "req_1", allowed: ["a"], near_misses: [{ subject: "x" }] }, { "Retry-After": "7" }];
  const rid = req.headers["x-request-id"] || "req_srv";
  if (p === "/api/fail2") return [Number(u.searchParams.get("status")), { error: "bad", code: u.searchParams.get("code"), field: "type", allowed: ["x"], message: { message_id: "<u@x>", subject: "Oops" }, messages: [{ message_id: "<t1@x>" }] }, { "X-Request-Id": rid }];
  if (p === "/api/flaky") { flaky++; return flaky < 2 ? [503, { error: "busy", code: "unavailable" }] : [200, { ok: true, tries: flaky }]; }
  if (p === "/api/wait" && u.searchParams.get("count")) return [200, { messages: [{ message_id: "<a@x>", subject: "1" }, { message_id: "<b@x>", subject: "2" }], count: 2, waited_ms: 40, matched: "to a@x" }];
  if (p === "/api/wait/none") return u.searchParams.get("subject") === "boom"
    ? [409, { error: "a matching message arrived: Oops", code: "unexpected_email", request_id: "req_n", message: { address: "t@inbox.test", folder: "INBOX", uid: 2, message_id: "<u@x>", subject: "Oops" } }]
    : [200, { none: true, waited_ms: 5000, matched: "to t@inbox.test" }];
  if (p === "/api/wait/event") return [200, { event: { id: 7, at: NOW, kind: "persona.sent", data: { persona_id: "p_1", message_id: "<r@x>", case_id: "deal-1" } }, waited_ms: 12 }];
  if (p === "/api/wait/thread") return [200, { thread: "<m4@x>", messages: [{ message_id: "<m4@x>", from: "app@co.test", to: ["dana@h.test"], subject: "Offer", address: "dana@h.test", folder: "INBOX", uid: 1 }, { message_id: "<r@x>", from: "dana@h.test", to: ["app@co.test"], subject: "Re: Offer", address: "app@co.test", folder: "INBOX", uid: 9 }], count: 2, quiet_ms: 10000, waited_ms: 11000 }];
  if (p === "/api/addresses") return [200, { address: `${(body && body.prefix) || "t"}-k3x9@${(body && body.domain) || "inbox.test"}`, tag: (body && body.tag) || "" }];
  if (p === "/api/messages" && req.method === "GET") return [200, [{ address: "t-k3x9@inbox.test", uid: 1, message_id: "<w@x>", subject: "Welcome" }]];
  if (p === "/api/messages" && req.method === "DELETE") return [200, { deleted: 3, addresses: ["t-k3x9@inbox.test"] }];
  if (p === "/api/jobs/run-due") return [200, { ran: [{ id: 1, kind: "reply", persona: "p_1", state: "done" }], count: 1, remaining: 0 }];
  if (p === "/api/send") return [200, { ok: true, message_id: "<s@x>" }, { "X-Request-Id": rid, ...(req.headers["idempotency-key"] === "seen" ? { "Idempotent-Replayed": "true" } : {}) }];
  if (p === "/api/wait") return [200, { address: u.searchParams.get("to"), folder: "INBOX", uid: 4, message_id: "<m4@x>", from: "app@co.test", to: [u.searchParams.get("to")], subject: "Verify", text: "code 123456", codes: ["123456"], magic_links: ["https://co.test/v?t=1"] }];
  if (p === "/api/wait/reply") return [200, { address: "app@co.test", folder: "INBOX", uid: 9, message_id: "<r@x>", in_reply_to: u.searchParams.get("in_reply_to"), from: u.searchParams.get("from"), to: ["app@co.test"], subject: "Re: Offer", text: "ok" }];
  if (p === "/api/mailboxes") return [200, [{ address: "app@co.test", can_login: true, total: 3 }, { address: "dana@h.test", persona_id: "p_1", persona: "Dana Reyes" }]];
  if (/\/messages$/.test(p)) return [200, [{ uid: 3, message_id: "<m3@x>", from: "dana@h.test", to: ["app@co.test"], subject: "Hello", text: "hi", flags: ["\\Seen"] }]];
  if (/\/messages\/[^/]+\/\d+$/.test(p) && req.method === "GET") return [200, { message: { uid: 3, folder: "INBOX", message_id: "<m3@x>", from: "dana@h.test", subject: "Hello", text: "hi" }, safe: { html: "<p>", remote_blocked: 0 }, case: { id: "deal-1", how: "x" } }];
  if (p.endsWith("/raw")) return [200, "From: a\r\n\r\nbody", { "Content-Type": "message/rfc822" }];
  if (/\/attachments\/\d+$/.test(p)) return [200, Buffer.from([1, 2, 3]), { "Content-Type": "application/pdf" }];
  if (p === "/api/connection/cert") return [200, "-----BEGIN CERTIFICATE-----", { "Content-Type": "application/x-pem-file" }];
  if (p === "/api/personas" && req.method === "GET") return [200, [{ id: "p_1", name: "Dana", addresses: ["dana@h.test"] }]];
  if (/^\/api\/personas(\/p_[^/]+)?$/.test(p) && req.method !== "DELETE") return [200, { id: "p_1", name: "Dana", addresses: ["dana@h.test"], ...(body || {}) }];
  if (p === "/api/personas/from-mail") return [200, { persona: { id: "p_2", name: "Sam", addresses: ["sam@co.test"] }, by: "ai", people: 4 }];
  if (p === "/api/cases" ) return [200, [{ id: "deal-1", title: "Sale", people: [{ ref: "seller" }] }]];
  if (/^\/api\/cases\/[^/]+(\/people|\/regenerate|\/story)?$/.test(p) && req.method !== "DELETE") return [200, { id: "deal-1", title: "Sale", story: "true", people: [{ ref: "seller" }] }];
  if (p === "/api/jobs") return [200, { now: NOW, jobs: [
    { id: 1, state: "pending", due: "2026-10-10T13:00:00Z", kind: "reply", persona_id: "p_1" },
    { id: 2, state: "pending", due: "2026-10-10T18:00:00Z", kind: "reply", persona_id: "p_1" },
    { id: 3, state: "pending", due: "2026-10-10T12:00:00Z", kind: "nudge", persona_id: "p_9" },
  ] }];
  if (p === "/api/accounts" && req.method === "GET") return [200, [{ address: "app@co.test", allow_smtp: true }]];
  if (p === "/api/events") return [200, ": ping\n\nid: 1\nevent: persona.sent\ndata: {\"id\":1,\"kind\":\"persona.sent\",\"data\":{}}\n\nid: 2\nevent: clock\ndata: {\"id\":2,\"kind\":\"clock\",\"data\":{}}\n\n", { "Content-Type": "text/event-stream" }];
  return [200, { ok: true }];
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      const body = raw ? JSON.parse(raw) : undefined;
      const query = {};
      for (const [k, v] of u.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
      seen.push({ method: req.method, path: u.pathname, query, headers: req.headers, body });
      const [status, out, headers = {}] = answer(req, u, body);
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(Buffer.isBuffer(out) ? out : typeof out === "string" ? out : JSON.stringify(out));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const mail = () => new Simmail({ baseUrl: base, apiKey: "smk_t" });

// [call, method, path, query, body]
const CALLS = [
  [m => m.me(), "GET", "/api/me"],
  [m => m.universes(), "GET", "/api/universes"],
  [m => m.status(), "GET", "/api/status"],
  [m => m.connection(), "GET", "/api/connection"],
  [m => m.connectionCert(), "GET", "/api/connection/cert"],
  [m => m.waitForEmail({ to: "a@co.test", from: "x", subject: "v", contains: "c", folder: Folder.Junk, existing: true, timeout: "20s", linkDomain: "co.test" }), "GET", "/api/wait",
    { to: "a@co.test", from: "x", subject: "v", contains: "c", folder: "Junk", existing: "true", timeout: "20s", link_domain: "co.test" }],
  [m => m.waitForReply({ from: "d@h.test", inReplyTo: "<m@x>", timeout: 5000 }), "GET", "/api/wait/reply", { from: "d@h.test", in_reply_to: "<m@x>", fast: "true", timeout: "5000ms" }],
  [m => m.extract({ text: "t" }), "POST", "/api/extract", {}, { text: "t" }],
  [m => m.mailboxes(), "GET", "/api/mailboxes"],
  [m => m.folders("a@co.test"), "GET", "/api/mailboxes/a%40co.test/folders"],
  [m => m.messages("a@co.test", { folder: "Sent" }), "GET", "/api/mailboxes/a%40co.test/messages", { folder: "Sent" }],
  [m => m.message("a@co.test", "INBOX", 3, { remote: true, theme: "light" }), "GET", "/api/mailboxes/a%40co.test/messages/INBOX/3", { remote: "1", theme: "light" }],
  [m => m.rawMessage("a@co.test", "INBOX", 3), "GET", "/api/mailboxes/a%40co.test/messages/INBOX/3/raw"],
  [m => m.attachment("a@co.test", "INBOX", 3, 0), "GET", "/api/mailboxes/a%40co.test/messages/INBOX/3/attachments/0"],
  [m => m.updateMessage("a@co.test", "INBOX", 3, { seen: true, moveTo: "Archive" }), "PATCH", "/api/mailboxes/a%40co.test/messages/INBOX/3", {}, { seen: true, move_to: "Archive" }],
  [m => m.threads("a@co.test"), "GET", "/api/threads", { address: "a@co.test" }],
  [m => m.setMailboxStatus("x@h.test", MailboxStatus.Full), "PUT", "/api/mailboxes/x%40h.test/status", {}, { status: "full" }],
  [m => m.send({ from: "a@co.test", to: ["d@h.test"], subject: "Hi", text: "t", inReplyTo: "<m@x>", references: ["<m@x>"] }), "POST", "/api/send", {},
    { from: "a@co.test", to: ["d@h.test"], subject: "Hi", text: "t", references: ["<m@x>"], in_reply_to: "<m@x>" }],
  [m => m.inject({ to: "d@h.test", from: "o@h.test", subject: "Old", text: "t" }), "POST", "/api/inject", {}, { to: "d@h.test", from: "o@h.test", subject: "Old", text: "t" }],
  [m => m.signature("a@co.test"), "GET", "/api/accounts/a%40co.test/signature"],
  [m => m.setSignature("a@co.test", "Sam"), "PUT", "/api/accounts/a%40co.test/signature", {}, { signature: "Sam" }],
  [m => m.rescue("<m@x>", "d@h.test"), "POST", "/api/rescue", {}, { message_id: "<m@x>", address: "d@h.test" }],
  [m => m.retry("<m@x>"), "POST", "/api/retry", {}, { message_id: "<m@x>" }],
  [m => m.accounts(), "GET", "/api/accounts"],
  [m => m.createAccount("a@co.test", "pw-long-enough", { allow_imap: false }), "POST", "/api/accounts", {}, { allow_imap: false, address: "a@co.test", password: "pw-long-enough" }],
  [m => m.updateAccount("a@co.test", { disabled: true }), "PATCH", "/api/accounts/a%40co.test", {}, { disabled: true }],
  [m => m.deleteAccount("a@co.test"), "DELETE", "/api/accounts/a%40co.test"],
  [m => m.testAccount("a@co.test", { password: "pw", proto: "smtp" }), "POST", "/api/accounts/a%40co.test/test", {}, { password: "pw", proto: "smtp" }],
  [m => m.personas(), "GET", "/api/personas"],
  [m => m.persona("p_1"), "GET", "/api/personas/p_1"],
  [m => m.createPersona({ name: "Dana", addresses: ["dana@h.test"], temperament: Temperament.Skeptical }), "POST", "/api/personas", {}, { name: "Dana", addresses: ["dana@h.test"], temperament: "skeptical" }],
  [m => m.updatePersona("p_1", { paused: true }), "PATCH", "/api/personas/p_1", {}, { paused: true }],
  [m => m.deletePersona("p_1"), "DELETE", "/api/personas/p_1"],
  [m => m.personaFromMail("sam@co.test", { paused: true }), "POST", "/api/personas/from-mail", {}, { address: "sam@co.test", paused: true }],
  [m => m.temperaments(), "GET", "/api/temperaments"],
  [m => m.memory("p_1"), "GET", "/api/personas/p_1/memory"],
  [m => m.addMemory("p_1", { text: "called", caseId: "deal-1", source: "crm" }), "POST", "/api/personas/p_1/memory", {}, { text: "called", case_id: "deal-1", source: "crm" }],
  [m => m.clearMemory("p_1", { caseId: "deal-1" }), "DELETE", "/api/personas/p_1/memory", { case_id: "deal-1" }],
  [m => m.addMemoryByExternal({ system: "crm", id: "c-1", text: "t" }), "POST", "/api/memory/by-external", {}, { system: "crm", id: "c-1", text: "t" }],
  [m => m.relations("p_1"), "GET", "/api/personas/p_1/relations"],
  [m => m.forgetRelations("p_1", { address: "a@co.test" }), "DELETE", "/api/personas/p_1/relations", { address: "a@co.test" }],
  [m => m.cases(), "GET", "/api/cases"],
  [m => m.getCase("deal-1", { redact: true }), "GET", "/api/cases/deal-1", { redact: "story" }],
  [m => m.pushCase("deal-1", { title: "Sale" }), "PUT", "/api/cases/deal-1", {}, { title: "Sale" }],
  [m => m.addCasePeople("deal-1", [{ ref: "buyer" }]), "POST", "/api/cases/deal-1/people", {}, [{ ref: "buyer" }]],
  [m => m.initiateCase("deal-1", { persona: "p_1", to: "a@co.test", intent: "ask", after: "2h" }), "POST", "/api/cases/deal-1/initiate", {}, { persona: "p_1", to: "a@co.test", intent: "ask", after: "2h" }],
  [m => m.regenerateCase("deal-1"), "POST", "/api/cases/deal-1/regenerate", {}, {}],
  [m => m.editCaseStory("deal-1", { story: "s" }), "PATCH", "/api/cases/deal-1/story", {}, { story: "s" }],
  [m => m.deleteCase("deal-1"), "DELETE", "/api/cases/deal-1"],
  [m => m.clock(), "GET", "/api/clock"],
  [m => m.advance("2d"), "POST", "/api/clock/advance", {}, { duration: "2d" }],
  [m => m.freeze(), "POST", "/api/clock/freeze", {}, {}],
  [m => m.speed(60), "POST", "/api/clock/speed", {}, { factor: 60 }],
  [m => m.live(), "POST", "/api/clock/live", {}, {}],
  [m => m.jobs({ state: "pending", limit: 5, dueBefore: "x" }), "GET", "/api/jobs", { state: "pending", limit: "5", due_before: "x" }],
  [m => m.runJob(1), "POST", "/api/jobs/1/run-now", {}, {}],
  [m => m.skipJob(1), "POST", "/api/jobs/1/skip", {}, {}],
  [m => m.bounceJob(1), "POST", "/api/jobs/1/bounce", {}, {}],
  [m => m.rescheduleJob(1, { in: "10m" }), "PATCH", "/api/jobs/1", {}, { in: "10m" }],
  [m => m.log({ since: 5, limit: 10 }), "GET", "/api/log", { since: "5", limit: "10" }],
  [m => m.ai(), "GET", "/api/ai"],
  [m => m.setAi("off"), "PUT", "/api/ai", {}, { mode: "off" }],
  [m => m.aiBudget(), "GET", "/api/ai/budget"],
  [m => m.pace(), "GET", "/api/pace"],
  [m => m.setPace({ factor: 0.1, ignoreHours: true }), "PUT", "/api/pace", {}, { factor: 0.1, ignore_hours: true }],
  [m => m.recipients(), "GET", "/api/recipients"],
  [m => m.setRecipients({ default: { create: true } }), "PUT", "/api/recipients", {}, { default: { create: true } }],
  [m => m.links(), "GET", "/api/links"],
  [m => m.setLinks({ enabled: false }), "PUT", "/api/links", {}, { enabled: false }],
  [m => m.retention(), "GET", "/api/retention"],
  [m => m.setRetention({ mailDays: 30, eventDays: 90 }), "PUT", "/api/retention", {}, { mail_days: 30, event_days: 90 }],
  [m => m.pruneRetention(), "POST", "/api/retention/prune", {}, {}],
  [m => m.junkSettings(), "GET", "/api/junk"],
  [m => m.setJunkSettings({ enabled: true }), "PUT", "/api/junk", {}, { enabled: true }],
  [m => m.faults(), "GET", "/api/faults"],
  [m => m.setFaults([]), "PUT", "/api/faults", {}, []],
  [m => m.faultScenarios(), "GET", "/api/faults/scenarios"],
  [m => m.addFaultScenario(FaultScenario.GmailRate, { match: "@gmail.com" }), "POST", "/api/faults/scenarios/gmail-rate", {}, { match: "@gmail.com" }],
  [m => m.health("<m@x>"), "GET", "/api/inspect", { message_id: "<m@x>" }],
  [m => m.insights({ days: 7 }), "GET", "/api/insights", { days: "7" }],
  [m => m.insightShares(), "GET", "/api/insights/shares"],
  [m => m.shareInsights({ title: "T", days: 30 }), "POST", "/api/insights/shares", {}, { title: "T", days: 30 }],
  [m => m.revokeInsightShare("shr_1"), "DELETE", "/api/insights/shares/shr_1"],
  [m => m.webhooks(), "GET", "/api/webhooks"],
  [m => m.setWebhooks([{ url: "https://h.test", events: ["persona.*"] }]), "PUT", "/api/webhooks", {}, [{ url: "https://h.test", events: ["persona.*"] }]],
  [m => m.world(), "GET", "/api/world"],
  [m => m.setWorld({ company: { name: "Acme", domain: "acme.test" }, streams: [] }), "PUT", "/api/world", {}, { company: { name: "Acme", domain: "acme.test" }, streams: [] }],
  [m => m.sendFromStream("s_1"), "POST", "/api/world/streams/s_1/send", {}, {}],
];

test("every call: method, path, query and body", async () => {
  const m = mail();
  for (const [call, method, path, query = {}, body] of CALLS) {
    await call(m);
    const r = last();
    const name = `${method} ${path}`;
    assert.equal(r.method, method, name);
    assert.equal(r.path, path, name);
    assert.deepEqual(r.query, query, name);
    assert.deepEqual(r.body, body, name);
    assert.equal(r.headers.authorization, "Bearer smk_t", name);
  }
});

test("resources: superset of the plain answer, with methods", async () => {
  const m = mail();
  const msg = await m.waitForEmail({ to: "a@co.test" });
  assert.ok(msg instanceof Message);
  assert.deepEqual(msg.codes, ["123456"]);
  assert.deepEqual(msg.magic_links, ["https://co.test/v?t=1"], "0.1.0 field names still work");
  assert.deepEqual(msg.magicLinks, ["https://co.test/v?t=1"]);
  assert.equal(msg.messageId, "<m4@x>");
  assert.deepEqual(JSON.parse(JSON.stringify(msg)).codes, ["123456"], "JSON is the plain answer");

  await msg.reply({ text: "thanks" });
  assert.deepEqual(last().body, { from: "a@co.test", to: ["app@co.test"], subject: "Re: Verify", text: "thanks", references: ["<m4@x>"], in_reply_to: "<m4@x>" });
  const reply = await msg.waitForReply({ timeout: "5s" });
  assert.deepEqual(last().query, { from: "a@co.test", in_reply_to: "<m4@x>", fast: "true", timeout: "5s" });
  assert.equal(reply.inReplyTo, "<m4@x>");
  await msg.markRead();
  assert.equal(last().path, "/api/mailboxes/a%40co.test/messages/INBOX/4");
  await msg.move(Folder.Archive);
  assert.deepEqual(last().body, { move_to: "Archive" });
  await msg.health();
  assert.deepEqual(last().query, { message_id: "<m4@x>" });

  const box = m.mailbox("a@co.test");
  assert.ok(box instanceof Mailbox);
  const listed = [];
  for await (const x of box.messages({ folder: "Sent" })) listed.push(x);
  assert.equal(listed.length, 1);
  assert.ok(listed[0] instanceof Message);
  assert.equal(listed[0].address, "a@co.test", "listed messages know their mailbox");
  assert.equal(listed[0].folder, "Sent");
  assert.equal(listed[0].isRead, true);
  const full = await listed[0].full();
  assert.equal(full.safe.html, "<p>");
  assert.equal(full.case.id, "deal-1");
  assert.deepEqual([...(await listed[0].attachment(0))], [1, 2, 3]);
  assert.match(await listed[0].source(), /^From: a/);
  await box.waitForEmail({ subject: "x" });
  assert.equal(last().query.to, "a@co.test");
  await box.send({ to: ["d@h.test"], subject: "Hi" }, { idempotencyKey: "k-1" });
  assert.equal(last().body.from, "a@co.test");
  assert.equal(last().headers["idempotency-key"], "k-1");

  const boxes = await m.mailboxes();
  assert.ok(boxes[1] instanceof Mailbox);
  assert.equal(boxes[1].persona, "Dana Reyes", "a field keeps its value beside the methods");
  assert.equal((await boxes[1].getPersona()).id, "p_1");

  const p = await m.personas.create({ name: "Dana", addresses: ["dana@h.test"] });
  assert.ok(p instanceof Persona);
  assert.equal(p.address, "dana@h.test");
  const p2 = await p.update({ paused: true });
  assert.ok(p2 instanceof Persona);
  await p.remember("called", { caseId: "deal-1" });
  assert.deepEqual(last().body, { text: "called", case_id: "deal-1" });
  const pjobs = await p.jobs();
  assert.deepEqual(pjobs.map(j => j.id), [1, 2]);
  assert.ok(pjobs[0] instanceof Job);
  const ran = await p.runDue({ kind: JobKind.Reply });
  assert.deepEqual(ran.ran.map(r => r.id), [1]);
  assert.deepEqual([last().method, last().path, last().body], ["POST", "/api/jobs/run-due", { kind: "reply", persona: "p_1" }]);
  await m.jobs.runDue({ kind: JobKind.Nudge, before: new Date(NOW), limit: 5 });
  assert.deepEqual(last().body, { kind: "nudge", before: "2026-10-10T14:00:00.000Z", limit: 5 });
  assert.equal((await m.personas.byAddress("DANA@h.test")).id, "p_1");
  const learned = await m.personas.fromMail("sam@co.test");
  assert.ok(learned.persona instanceof Persona);

  const c = await m.cases.push("deal-1", { title: "Sale" });
  assert.ok(c instanceof Case);
  assert.equal(c.people[0].ref, "seller");
  await c.initiate({ persona: "p_1", to: "a@co.test" });
  assert.equal(last().path, "/api/cases/deal-1/initiate");

  const job = (await m.jobs.list({ state: "pending" }))[0];
  await job.reschedule({ in: "1h" });
  assert.deepEqual(last().body, { in: "1h" });
  assert.ok((await m.accounts())[0] instanceof Account);
});

test("namespaces are callable as the 0.1.0 methods", async () => {
  const m = mail();
  await m.clock();
  assert.equal(last().path, "/api/clock");
  await m.clock.advance("3d");
  assert.deepEqual(last().body, { duration: "3d" });
  await m.faults.clear();
  assert.deepEqual(last().body, []);
  await m.faults.add(FaultScenario.Greylisting);
  assert.equal(last().path, "/api/faults/scenarios/greylisting");
  await m.recipients.setStatus("x@h.test", "blocked");
  assert.equal(last().path, "/api/mailboxes/x%40h.test/status");
  await m.webhooks.clear();
  await m.world.sendNow("s_9");
  assert.equal(last().path, "/api/world/streams/s_9/send");
  await m.behaviour.setPace({ factor: 2 });
  assert.deepEqual(last().body, { factor: 2 });
  await m.inspect.extract({ html: "<a>" });
  assert.equal(last().path, "/api/extract");
  await m.events.log({ since: 1 });
  assert.equal(last().path, "/api/log");
});

test("the event stream is an async iterator", async () => {
  const kinds = [];
  for await (const e of mail().events({ since: 3 })) kinds.push(e.kind);
  assert.deepEqual(kinds, ["persona.sent", "clock"]);
  assert.deepEqual(last().query, { since: "3" });
  assert.equal(last().headers.accept, "text/event-stream");
});

test("errors: a class per kind, carrying what the server said", async () => {
  const m = mail();
  const cases = [[400, ValidationError], [402, PlanLimitError], [403, ForbiddenError], [404, NotFoundError], [408, WaitTimeoutError], [409, ConflictError], [429, RateLimitedError], [500, SimmailError]];
  for (const [status, C] of cases) {
    await assert.rejects(m.request("GET", "/api/fail", undefined, { status }), e => {
      assert.ok(e instanceof C && e instanceof SimmailError, `${status} → ${C.name}`);
      assert.equal(e.name, C.name);
      assert.equal(e.status, status);
      assert.equal(e.message, "nope");
      assert.equal(e.code, "some_code");
      assert.equal(e.requestId, "req_1");
      assert.deepEqual(e.allowed, ["a"]);
      assert.deepEqual(e.nearMisses, [{ subject: "x" }]);
      if (C === RateLimitedError) assert.equal(e.retryAfter, 7);
      return true;
    });
  }
});

test("enums are the API's strings", () => {
  assert.equal(Temperament.Skeptical, "skeptical");
  assert.equal(FaultScenario.MicrosoftAccessDenied, "microsoft-access-denied");
  assert.equal(Folder.Inbox, "INBOX");
  assert.throws(() => { Temperament.Skeptical = "x"; }, TypeError, "frozen");
});

test("advanced waits: filters, count, none, events and threads", async () => {
  const m = mail();
  await m.waitForEmail({
    to: ["a@co.test", "*@h.test"], since: new Date(NOW), exclude: ["<1@x>", "<2@x>"], subjectRegex: /welcome|hello/i, bodyRegex: "code \\d+",
    header: { "X-Campaign": "spring" }, hasAttachment: true, attachmentName: "invoice.pdf", linkDomain: "co.test", timeout: 5000,
  });
  assert.deepEqual(last().query, {
    to: ["a@co.test", "*@h.test"], since: "2026-10-10T14:00:00.000Z", exclude: "<1@x>,<2@x>", subject_regex: "(?i)welcome|hello", body_regex: "code \\d+",
    header: "X-Campaign:spring", has_attachment: "true", attachment_name: "invoice.pdf", link_domain: "co.test", timeout: "5000ms",
  });
  const many = await m.waitForEmail({ tag: "signup", count: 2 });
  assert.equal(many.count, 2);
  assert.ok(many.messages.every(x => x instanceof Message));
  assert.equal(many.messages[1].subject, "2");

  const none = await m.expectNoEmail({ to: "t@inbox.test", within: "3s" });
  assert.equal(none.none, true);
  assert.deepEqual(last().query, { to: "t@inbox.test", for: "3s" });
  await assert.rejects(m.expectNoEmail({ to: "t@inbox.test", subject: "boom" }), e => {
    assert.ok(e instanceof UnexpectedEmailError && e instanceof ConflictError);
    assert.equal(e.code, ErrorCode.UnexpectedEmail);
    assert.ok(e.email instanceof Message);
    assert.equal(e.email.subject, "Oops");
    return true;
  });

  const ev = await m.waitForEvent({ type: [EventAlias.Replied, "link.*"], persona: "dana@h.test", fast: true, timeout: "20s" });
  assert.deepEqual(last().query, { type: "replied,link.*", persona: "dana@h.test", fast: "true", timeout: "20s" });
  assert.ok(ev instanceof SimEvent);
  assert.equal(ev.kind, EventType.PersonaSent);
  assert.equal(ev.waitedMs, 12);
  assert.equal(ev.personaId, "p_1");
  assert.equal((await ev.persona()).id, "p_1");

  const conv = await m.waitForThread({ messageId: "<m4@x>", quiet: "2s" });
  assert.deepEqual(last().query, { message_id: "<m4@x>", quiet: "2s", timeout: "60000ms" });
  assert.ok(conv instanceof Conversation);
  assert.equal(conv.root, "<m4@x>");
  assert.equal(conv.messages.length, 2);
  assert.ok(conv.latest instanceof Message);
  assert.equal(conv.latest.subject, "Re: Offer");
  await conv.waitUntilQuiet({ quiet: "1s" });
  assert.deepEqual(last().query, { thread: "<m4@x>", quiet: "1s", timeout: "60000ms" });
  await conv.reply({ text: "ok" });
  assert.deepEqual(last().body.to, ["dana@h.test"]);

  const msg = await m.waitForEmail({ to: "a@co.test" });
  await msg.waitUntilQuiet();
  assert.deepEqual(last().query, { message_id: "<m4@x>", timeout: "60000ms" });

  const p = await m.persona("p_1");
  await p.waitFor(EventAlias.Declined, { timeout: "10s" });
  assert.deepEqual(last().query, { type: "declined", persona: "p_1", timeout: "10s" });
  await m.events.waitFor({ type: "persona.*" });
  assert.equal(last().path, "/api/wait/event");
  await m.jobs({ persona: "p_1", kind: JobKind.Reply, dueBefore: "1h", limit: 10 });
  assert.deepEqual(last().query, { persona: "p_1", kind: "reply", due_before: "1h", limit: "10" });
});

test("test addresses and tags", async () => {
  const m = mail();
  const addr = await m.testAddress({ tag: "signup", prefix: "user" });
  assert.deepEqual([last().method, last().path, last().body], ["POST", "/api/addresses", { prefix: "user", tag: "signup" }]);
  assert.ok(addr instanceof TestAddress && addr instanceof Mailbox);
  assert.equal(addr.address, "user-k3x9@inbox.test");
  assert.equal(`${addr}`, "user-k3x9@inbox.test");
  await addr.waitForEmail({ subject: "Welcome" });
  assert.deepEqual(last().query, { to: "user-k3x9@inbox.test", subject: "Welcome", timeout: "30000ms" });
  await addr.expectNoEmail({ within: 2000 });
  assert.deepEqual(last().query, { to: "user-k3x9@inbox.test", for: "2000ms" });
  const gone = await addr.cleanup();
  assert.equal(gone.deleted, 3);
  assert.deepEqual([last().method, last().path, last().query], ["DELETE", "/api/messages", { to: "user-k3x9@inbox.test" }]);

  const group = m.tag("signup");
  assert.ok(group instanceof TagGroup);
  const listed = await group.messages({ limit: 5 });
  assert.deepEqual(last().query, { tag: "signup", limit: "5" });
  assert.ok(listed[0] instanceof Message);
  assert.equal(listed[0].address, "t-k3x9@inbox.test");
  await group.waitForEmail({ count: 2 });
  assert.deepEqual(last().query, { tag: "signup", count: "2", timeout: "30000ms" });
  await group.newAddress({ domain: "co.test" });
  assert.deepEqual(last().body, { domain: "co.test", tag: "signup" });
  await group.cleanup({ folder: Folder.Junk });
  assert.deepEqual(last().query, { tag: "signup", folder: "Junk" });
  await m.listMessages({ to: ["a@co.test", "*@h.test"] });
  assert.deepEqual(last().query, { to: ["a@co.test", "*@h.test"] });
  const created = await m.createAddress();
  assert.deepEqual(last().body, {});
  assert.equal(created.address, "t-k3x9@inbox.test");
});

test("idempotency keys, request ids, retries and schema", async () => {
  const m = mail();
  const a = await m.send({ from: "app@co.test", to: ["d@h.test"], subject: "Hi" });
  const k1 = last().headers["idempotency-key"];
  assert.match(k1, /^[0-9a-f-]{32,36}$/, "each send gets a key");
  assert.equal(a.replayed, undefined);
  assert.equal(a.requestId, "req_srv");
  assert.deepEqual(Object.keys(a), ["ok", "message_id"], "facts are not part of the data");
  await m.send({ from: "app@co.test", to: ["d@h.test"], subject: "Hi" });
  assert.notEqual(last().headers["idempotency-key"], k1, "a new key per call");
  const again = await m.send({ from: "app@co.test", to: ["d@h.test"] }, { idempotencyKey: "seen" });
  assert.equal(again.replayed, true);
  await m.send({ from: "app@co.test", to: ["d@h.test"] }, { idempotencyKey: false });
  assert.equal(last().headers["idempotency-key"], undefined);
  await m.inject({ to: "a@co.test", subject: "x" });
  assert.ok(last().headers["idempotency-key"]);

  const traced = m.withRequestId("trace-42");
  const b = await traced.send({ from: "app@co.test", to: ["d@h.test"] });
  assert.equal(last().headers["x-request-id"], "trace-42");
  assert.equal(b.requestId, "trace-42");
  await assert.rejects(traced.request("GET", "/api/fail2", undefined, { status: 400, code: "invalid_value" }), e => {
    assert.ok(e instanceof ValidationError);
    assert.equal(e.requestId, "trace-42", "from the header when the body has none");
    assert.equal(e.field, "type");
    assert.deepEqual(e.allowed, ["x"]);
    return true;
  });

  flaky = 0;
  const ok = await new Simmail({ baseUrl: base, retries: 1 }).request("GET", "/api/flaky");
  assert.equal(ok.tries, 2, "a GET is tried again after a 503");
  flaky = 0;
  await assert.rejects(new Simmail({ baseUrl: base, retries: 1 }).request("POST", "/api/flaky", {}), e => e.status === 503, "a write without a key is not");

  await m.schema();
  assert.equal(last().path, "/api/schema");
  await m.inspect.schema();
  assert.equal(last().path, "/api/schema");
});

test("errors map by code before status", async () => {
  const m = mail();
  const cases = [
    [400, "invalid_regex", ValidationError], [401, "unauthorized", AuthError], [402, "not_in_plan", PlanLimitError], [408, "wait_timeout", WaitTimeoutError],
    [409, "unexpected_email", UnexpectedEmailError], [422, "idempotency_mismatch", IdempotencyError], [429, "rate_limited", RateLimitedError], [500, "internal_error", SimmailError],
  ];
  for (const [status, code, C] of cases) {
    await assert.rejects(m.request("GET", "/api/fail2", undefined, { status, code }), e => {
      assert.ok(e instanceof C, `${code} → ${C.name}`);
      assert.equal(e.code, code);
      assert.equal(e.requestId, "req_srv");
      if (C === WaitTimeoutError) assert.ok(e.messages[0] instanceof Message);
      return true;
    });
  }
});

test("enums are generated from the schema, with labels", () => {
  assert.equal(JobKind.OutOfOffice, "ooo");
  assert.equal(EnumInfo.Temperament.skeptical.label, "Skeptical");
  assert.equal(describe("FaultScenario", FaultScenario.GmailRate), "Gmail: Rate-limits your IP");
  assert.equal(describe("Nope", "x"), "x");
});
