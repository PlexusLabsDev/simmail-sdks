// Unit tests against a local fake server: no network, no simmail needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Simmail, SimmailError } from "../index.js";

let server, base;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      seen.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body: body ? JSON.parse(body) : undefined });
      res.setHeader("Content-Type", "application/json");
      if (u.pathname === "/api/inspect") { res.statusCode = 404; return res.end(JSON.stringify({ error: "no inspection for that message" })); }
      if (u.pathname === "/api/wait") return res.end(JSON.stringify({ to: [u.searchParams.get("to")], codes: ["123456"], magic_links: [] }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const last = () => seen[seen.length - 1];

test("auth, universe and the wait's query", async () => {
  const mail = new Simmail({ baseUrl: base + "/api/", apiKey: "smk_test", universe: "u_1" });
  assert.equal(mail.baseUrl, base, "a trailing /api is accepted");
  const msg = await mail.waitForEmail({ to: "a@b.test", subject: "verify", timeout: 20000 });
  assert.deepEqual(msg.codes, ["123456"]);
  const r = last();
  assert.equal(r.path, "/api/wait");
  assert.deepEqual(r.query, { to: "a@b.test", subject: "verify", timeout: "20000ms" });
  assert.equal(r.headers.authorization, "Bearer smk_test");
  assert.equal(r.headers["x-simmail-universe"], "u_1");
  assert.equal(r.headers["content-type"], undefined, "no body, no content type");
});

test("reply wait, send threading, durations", async () => {
  const mail = new Simmail({ baseUrl: base, apiKey: "k" });
  await mail.waitForReply({ from: "dana@harbor.test", inReplyTo: "<m1@x>", timeout: "45s" });
  assert.deepEqual(last().query, { from: "dana@harbor.test", in_reply_to: "<m1@x>", fast: "true", timeout: "45s" });
  await mail.send({ from: "a@app.test", to: ["dana@harbor.test"], subject: "Re: Offer", text: "ok", inReplyTo: "<m1@x>" });
  assert.equal(last().path, "/api/send");
  assert.deepEqual(last().body, { from: "a@app.test", to: ["dana@harbor.test"], subject: "Re: Offer", text: "ok", in_reply_to: "<m1@x>" });
  assert.equal(last().headers["content-type"], "application/json");
});

test("mailboxes, messages and the clock", async () => {
  const mail = new Simmail({ baseUrl: base, apiKey: "k" });
  await mail.messages("app@acme.test", { folder: "Sent" });
  assert.equal(last().path, "/api/mailboxes/app%40acme.test/messages");
  assert.deepEqual(last().query, { folder: "Sent" });
  await mail.message("app@acme.test", "INBOX", 7);
  assert.equal(last().path, "/api/mailboxes/app%40acme.test/messages/INBOX/7");
  await mail.advance("2d");
  assert.deepEqual([last().method, last().path, last().body], ["POST", "/api/clock/advance", { duration: "2d" }]);
  await mail.pushCase("deal 1", { title: "x" });
  assert.deepEqual([last().method, last().path], ["PUT", "/api/cases/deal%201"]);
});

test("errors carry the status and the server's message", async () => {
  const mail = new Simmail({ baseUrl: base, apiKey: "k" });
  await assert.rejects(mail.health("<nope@x>"), err => err instanceof SimmailError && err.status === 404 && /no inspection/.test(err.message));
});

test("an integration check, only with SIMMAIL_API_URL and SIMMAIL_API_KEY", { skip: !(process.env.SIMMAIL_API_URL && process.env.SIMMAIL_API_KEY) }, async () => {
  const mail = new Simmail({ baseUrl: process.env.SIMMAIL_API_URL, apiKey: process.env.SIMMAIL_API_KEY });
  const me = await mail.me();
  assert.ok(me);
});
