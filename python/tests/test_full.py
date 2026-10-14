"""Every method against a local fake server: the request it makes (method,
path, query, body), the objects it returns, errors and the event stream."""

import json
import re
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from simmail import (Account, Case, ConflictError, Event, FaultScenario, Folder, ForbiddenError, Job, JobKind, JobState, Mailbox,
                     MailboxStatus, Message, NotFoundError, Persona, PlanLimitError, RateLimitedError, Simmail, SimmailError,
                     Temperament, ValidationError, WaitTimeoutError, AuthError, Conversation, EventAlias, EventType, ErrorCode,
                     IdempotencyError, TagGroup, TestAddress, UnexpectedEmailError, WaitMany, describe)
from datetime import datetime, timezone

SEEN = []
FLAKY = [0]
NOW = "2026-10-10T14:00:00Z"


def answer(method, path, q, body):
    if path == "/api/fail":
        return int(q["status"]), {"error": "nope", "code": "some_code", "request_id": "req_1", "allowed": ["a"],
                                  "near_misses": [{"subject": "x"}]}, {"Retry-After": "7"}
    rid = HDRS[-1].get("x-request-id") or "req_srv"
    if path == "/api/fail2":
        return int(q["status"]), {"error": "bad", "code": q.get("code"), "field": "type", "allowed": ["x"],
                                  "message": {"message_id": "<u@x>", "subject": "Oops"}, "messages": [{"message_id": "<t1@x>"}]}, {"X-Request-Id": rid}
    if path == "/api/flaky":
        FLAKY[0] += 1
        return (503, {"error": "busy", "code": "unavailable"}, {}) if FLAKY[0] < 2 else (200, {"ok": True, "tries": FLAKY[0]}, {})
    if path == "/api/wait" and q.get("count"):
        return 200, {"messages": [{"message_id": "<a@x>", "subject": "1"}, {"message_id": "<b@x>", "subject": "2"}], "count": 2,
                     "waited_ms": 40, "matched": "to a@x"}, {}
    if path == "/api/wait/none":
        if q.get("subject") == "boom":
            return 409, {"error": "a matching message arrived: Oops", "code": "unexpected_email", "request_id": "req_n",
                         "message": {"address": "t@inbox.test", "folder": "INBOX", "uid": 2, "message_id": "<u@x>", "subject": "Oops"}}, {}
        return 200, {"none": True, "waited_ms": 5000, "matched": "to t@inbox.test"}, {}
    if path == "/api/wait/event":
        return 200, {"event": {"id": 7, "at": NOW, "kind": "persona.sent", "data": {"persona_id": "p_1", "message_id": "<r@x>"}},
                     "waited_ms": 12}, {}
    if path == "/api/wait/thread":
        return 200, {"thread": "<m4@x>", "count": 2, "quiet_ms": 10000, "waited_ms": 11000, "messages": [
            {"message_id": "<m4@x>", "from": "app@co.test", "to": ["dana@h.test"], "subject": "Offer", "address": "dana@h.test", "folder": "INBOX", "uid": 1},
            {"message_id": "<r@x>", "from": "dana@h.test", "to": ["app@co.test"], "subject": "Re: Offer", "address": "app@co.test", "folder": "INBOX", "uid": 9}]}, {}
    if path == "/api/addresses":
        b = body or {}
        return 200, {"address": f"{b.get('prefix', 't')}-k3x9@{b.get('domain', 'inbox.test')}", "tag": b.get("tag", "")}, {}
    if path == "/api/messages":
        if method == "GET":
            return 200, [{"address": "t-k3x9@inbox.test", "uid": 1, "message_id": "<w@x>", "subject": "Welcome"}], {}
        return 200, {"deleted": 3, "addresses": ["t-k3x9@inbox.test"]}, {}
    if path == "/api/jobs/run-due":
        return 200, {"ran": [{"id": 1, "kind": "reply", "persona": "p_1", "state": "done"}], "count": 1, "remaining": 0}, {}
    if path == "/api/send":
        extra = {"Idempotent-Replayed": "true"} if HDRS[-1].get("idempotency-key") == "seen" else {}
        return 200, {"ok": True, "message_id": "<s@x>"}, {"X-Request-Id": rid, **extra}
    if path == "/api/wait":
        return 200, {"address": q.get("to"), "folder": "INBOX", "uid": 4, "message_id": "<m4@x>", "from": "app@co.test", "to": [q.get("to")],
                     "subject": "Verify", "text": "code 123456", "codes": ["123456"], "magic_links": ["https://co.test/v?t=1"]}, {}
    if path == "/api/wait/reply":
        return 200, {"address": "app@co.test", "folder": "INBOX", "uid": 9, "message_id": "<r@x>", "in_reply_to": q.get("in_reply_to"),
                     "from": q.get("from"), "to": ["app@co.test"], "subject": "Re: Offer", "text": "ok"}, {}
    if path == "/api/mailboxes":
        return 200, [{"address": "app@co.test", "can_login": True, "total": 3}, {"address": "dana@h.test", "persona_id": "p_1", "persona": "Dana Reyes"}], {}
    if path.endswith("/messages"):
        return 200, [{"uid": 3, "message_id": "<m3@x>", "from": "dana@h.test", "to": ["app@co.test"], "subject": "Hello", "text": "hi",
                      "flags": ["\\Seen"]}], {}
    if re.search(r"/messages/[^/]+/\d+$", path) and method == "GET":
        return 200, {"message": {"uid": 3, "folder": "INBOX", "message_id": "<m3@x>", "from": "dana@h.test", "subject": "Hello", "text": "hi"},
                     "safe": {"html": "<p>", "remote_blocked": 0}, "case": {"id": "deal-1", "how": "x"}}, {}
    if path.endswith("/raw"):
        return 200, b"From: a\r\n\r\nbody", {"Content-Type": "message/rfc822"}
    if re.search(r"/attachments/\d+$", path):
        return 200, bytes([1, 2, 3]), {"Content-Type": "application/pdf"}
    if path == "/api/connection/cert":
        return 200, b"-----BEGIN CERTIFICATE-----", {"Content-Type": "application/x-pem-file"}
    if path == "/api/personas" and method == "GET":
        return 200, [{"id": "p_1", "name": "Dana", "addresses": ["dana@h.test"], "temperament": "skeptical"}], {}
    if re.fullmatch(r"/api/personas(/p_[^/]+)?", path) and method != "DELETE":
        return 200, {"id": "p_1", "name": "Dana", "addresses": ["dana@h.test"], **(body or {})}, {}
    if path == "/api/personas/from-mail":
        return 200, {"persona": {"id": "p_2", "name": "Sam", "addresses": ["sam@co.test"]}, "by": "ai", "people": 4}, {}
    if path == "/api/cases":
        return 200, [{"id": "deal-1", "title": "Sale", "people": [{"ref": "seller"}]}], {}
    if re.fullmatch(r"/api/cases/[^/]+(/people|/regenerate|/story)?", path) and method != "DELETE":
        return 200, {"id": "deal-1", "title": "Sale", "story": "true", "story_by": "ai", "people": [{"ref": "seller"}]}, {}
    if path == "/api/jobs":
        return 200, {"now": NOW, "jobs": [
            {"id": 1, "state": "pending", "due": "2026-10-10T13:00:00Z", "kind": "reply", "persona_id": "p_1"},
            {"id": 2, "state": "pending", "due": "2026-10-10T18:00:00Z", "kind": "reply", "persona_id": "p_1"},
            {"id": 3, "state": "pending", "due": "2026-10-10T12:00:00Z", "kind": "nudge", "persona_id": "p_9"}]}, {}
    if path == "/api/accounts" and method == "GET":
        return 200, [{"address": "app@co.test", "allow_smtp": True}], {}
    if path == "/api/log":
        return 200, [{"id": 5, "at": NOW, "kind": "persona.sent", "data": {}}], {}
    if path == "/api/events":
        return 200, (b": ping\n\nid: 1\nevent: persona.sent\ndata: {\"id\":1,\"kind\":\"persona.sent\",\"data\":{}}\n\n"
                     b"id: 2\nevent: clock\ndata: {\"id\":2,\"kind\":\"clock\",\"data\":{}}\n\n"), {"Content-Type": "text/event-stream"}
    return 200, {"ok": True}, {}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _handle(self):
        u = urlsplit(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        q = {k: (v if len(v) > 1 else v[0]) for k, v in parse_qs(u.query).items()}
        SEEN.append({"method": self.command, "path": u.path, "query": q, "headers": dict(self.headers), "body": body})
        HDRS.append({k.lower(): v for k, v in self.headers.items()})
        code, out, headers = answer(self.command, u.path, q, body)
        raw = out if isinstance(out, bytes) else json.dumps(out).encode()
        self.send_response(code)
        self.send_header("Content-Type", headers.pop("Content-Type", "application/json"))
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle


HDRS = []


def last():
    return SEEN[-1]


def hdr(name):
    """A header of the last request, by any case."""
    return HDRS[-1].get(name.lower())


# (call, method, path, query, body)
CALLS = [
    (lambda m: m.me(), "GET", "/api/me", {}, None),
    (lambda m: m.universes(), "GET", "/api/universes", {}, None),
    (lambda m: m.status(), "GET", "/api/status", {}, None),
    (lambda m: m.connection(), "GET", "/api/connection", {}, None),
    (lambda m: m.connection_cert(), "GET", "/api/connection/cert", {}, None),
    (lambda m: m.wait_for_email("a@co.test", sender="x", subject="v", contains="c", folder=Folder.JUNK, existing=True, timeout="20s",
                                link_domain="co.test"), "GET", "/api/wait",
     {"to": "a@co.test", "from": "x", "subject": "v", "contains": "c", "folder": "Junk", "existing": "true", "timeout": "20s",
      "link_domain": "co.test"}, None),
    (lambda m: m.wait_for_reply("d@h.test", in_reply_to="<m@x>", timeout=5), "GET", "/api/wait/reply",
     {"from": "d@h.test", "in_reply_to": "<m@x>", "fast": "true", "timeout": "5s"}, None),
    (lambda m: m.extract("t"), "POST", "/api/extract", {}, {"text": "t", "html": ""}),
    (lambda m: m.mailboxes(), "GET", "/api/mailboxes", {}, None),
    (lambda m: m.folders("a@co.test"), "GET", "/api/mailboxes/a%40co.test/folders", {}, None),
    (lambda m: m.messages("a@co.test", "Sent"), "GET", "/api/mailboxes/a%40co.test/messages", {"folder": "Sent"}, None),
    (lambda m: m.message("a@co.test", "INBOX", 3, remote=True, theme="light"), "GET", "/api/mailboxes/a%40co.test/messages/INBOX/3",
     {"remote": "1", "theme": "light"}, None),
    (lambda m: m.raw_message("a@co.test", "INBOX", 3), "GET", "/api/mailboxes/a%40co.test/messages/INBOX/3/raw", {}, None),
    (lambda m: m.attachment("a@co.test", "INBOX", 3, 0), "GET", "/api/mailboxes/a%40co.test/messages/INBOX/3/attachments/0", {}, None),
    (lambda m: m.update_message("a@co.test", "INBOX", 3, seen=True, move_to="Archive"), "PATCH", "/api/mailboxes/a%40co.test/messages/INBOX/3",
     {}, {"seen": True, "move_to": "Archive"}),
    (lambda m: m.threads("a@co.test"), "GET", "/api/threads", {"address": "a@co.test"}, None),
    (lambda m: m.set_mailbox_status("x@h.test", MailboxStatus.FULL), "PUT", "/api/mailboxes/x%40h.test/status", {}, {"status": "full"}),
    (lambda m: m.send("a@co.test", ["d@h.test"], "Hi", "t", in_reply_to="<m@x>", references=["<m@x>"]), "POST", "/api/send", {},
     {"from": "a@co.test", "to": ["d@h.test"], "subject": "Hi", "text": "t", "html": "", "in_reply_to": "<m@x>", "references": ["<m@x>"]}),
    (lambda m: m.inject("d@h.test", sender="o@h.test", subject="Old", text="t"), "POST", "/api/inject", {},
     {"to": "d@h.test", "from": "o@h.test", "subject": "Old", "text": "t"}),
    (lambda m: m.signature("a@co.test"), "GET", "/api/accounts/a%40co.test/signature", {}, None),
    (lambda m: m.set_signature("a@co.test", "Sam"), "PUT", "/api/accounts/a%40co.test/signature", {}, {"signature": "Sam"}),
    (lambda m: m.rescue("<m@x>", "d@h.test"), "POST", "/api/rescue", {}, {"message_id": "<m@x>", "address": "d@h.test"}),
    (lambda m: m.retry("<m@x>"), "POST", "/api/retry", {}, {"message_id": "<m@x>"}),
    (lambda m: m.accounts(), "GET", "/api/accounts", {}, None),
    (lambda m: m.create_account("a@co.test", "pw-long-enough", allow_imap=False), "POST", "/api/accounts", {},
     {"allow_imap": False, "address": "a@co.test", "password": "pw-long-enough"}),
    (lambda m: m.update_account("a@co.test", disabled=True), "PATCH", "/api/accounts/a%40co.test", {}, {"disabled": True}),
    (lambda m: m.delete_account("a@co.test"), "DELETE", "/api/accounts/a%40co.test", {}, None),
    (lambda m: m.test_account("a@co.test", password="pw", proto="smtp"), "POST", "/api/accounts/a%40co.test/test", {},
     {"password": "pw", "proto": "smtp"}),
    (lambda m: m.personas(), "GET", "/api/personas", {}, None),
    (lambda m: m.persona("p_1"), "GET", "/api/personas/p_1", {}, None),
    (lambda m: m.create_persona({"name": "Dana", "addresses": ["dana@h.test"], "temperament": Temperament.SKEPTICAL}), "POST", "/api/personas", {},
     {"name": "Dana", "addresses": ["dana@h.test"], "temperament": "skeptical"}),
    (lambda m: m.update_persona("p_1", {"paused": True}), "PATCH", "/api/personas/p_1", {}, {"paused": True}),
    (lambda m: m.delete_persona("p_1"), "DELETE", "/api/personas/p_1", {}, None),
    (lambda m: m.persona_from_mail("sam@co.test", paused=True), "POST", "/api/personas/from-mail", {}, {"address": "sam@co.test", "paused": True}),
    (lambda m: m.temperaments(), "GET", "/api/temperaments", {}, None),
    (lambda m: m.memory("p_1"), "GET", "/api/personas/p_1/memory", {}, None),
    (lambda m: m.add_memory("p_1", "called", case_id="deal-1", source="crm"), "POST", "/api/personas/p_1/memory", {},
     {"text": "called", "case_id": "deal-1", "source": "crm"}),
    (lambda m: m.clear_memory("p_1", case_id="deal-1"), "DELETE", "/api/personas/p_1/memory", {"case_id": "deal-1"}, None),
    (lambda m: m.add_memory_by_external("crm", "c-1", "t"), "POST", "/api/memory/by-external", {}, {"system": "crm", "id": "c-1", "text": "t"}),
    (lambda m: m.relations("p_1"), "GET", "/api/personas/p_1/relations", {}, None),
    (lambda m: m.forget_relations("p_1", address="a@co.test"), "DELETE", "/api/personas/p_1/relations", {"address": "a@co.test"}, None),
    (lambda m: m.cases(), "GET", "/api/cases", {}, None),
    (lambda m: m.get_case("deal-1", redact=True), "GET", "/api/cases/deal-1", {"redact": "story"}, None),
    (lambda m: m.push_case("deal-1", {"title": "Sale"}), "PUT", "/api/cases/deal-1", {}, {"title": "Sale"}),
    (lambda m: m.add_case_people("deal-1", [{"ref": "buyer"}]), "POST", "/api/cases/deal-1/people", {}, [{"ref": "buyer"}]),
    (lambda m: m.initiate_case("deal-1", "p_1", "a@co.test", intent="ask", after="2h"), "POST", "/api/cases/deal-1/initiate", {},
     {"persona": "p_1", "to": "a@co.test", "intent": "ask", "after": "2h"}),
    (lambda m: m.regenerate_case("deal-1"), "POST", "/api/cases/deal-1/regenerate", {}, {}),
    (lambda m: m.edit_case_story("deal-1", story="s"), "PATCH", "/api/cases/deal-1/story", {}, {"story": "s"}),
    (lambda m: m.delete_case("deal-1"), "DELETE", "/api/cases/deal-1", {}, None),
    (lambda m: m.clock(), "GET", "/api/clock", {}, None),
    (lambda m: m.advance("2d"), "POST", "/api/clock/advance", {}, {"duration": "2d"}),
    (lambda m: m.freeze(), "POST", "/api/clock/freeze", {}, {}),
    (lambda m: m.speed(60), "POST", "/api/clock/speed", {}, {"factor": 60}),
    (lambda m: m.live(), "POST", "/api/clock/live", {}, {}),
    (lambda m: m.jobs(state="pending", limit=5, due_before="x"), "GET", "/api/jobs", {"state": "pending", "limit": "5", "due_before": "x"}, None),
    (lambda m: m.run_job(1), "POST", "/api/jobs/1/run-now", {}, {}),
    (lambda m: m.skip_job(1), "POST", "/api/jobs/1/skip", {}, {}),
    (lambda m: m.bounce_job(1), "POST", "/api/jobs/1/bounce", {}, {}),
    (lambda m: m.reschedule_job(1, in_="10m"), "PATCH", "/api/jobs/1", {}, {"in": "10m"}),
    (lambda m: m.log(since=5, limit=10), "GET", "/api/log", {"since": "5", "limit": "10"}, None),
    (lambda m: m.ai(), "GET", "/api/ai", {}, None),
    (lambda m: m.set_ai("off"), "PUT", "/api/ai", {}, {"mode": "off"}),
    (lambda m: m.ai_budget(), "GET", "/api/ai/budget", {}, None),
    (lambda m: m.pace(), "GET", "/api/pace", {}, None),
    (lambda m: m.set_pace(0.1, ignore_hours=True), "PUT", "/api/pace", {}, {"factor": 0.1, "ignore_hours": True}),
    (lambda m: m.recipients(), "GET", "/api/recipients", {}, None),
    (lambda m: m.set_recipients({"default": {"create": True}}), "PUT", "/api/recipients", {}, {"default": {"create": True}}),
    (lambda m: m.links(), "GET", "/api/links", {}, None),
    (lambda m: m.set_links({"enabled": False}), "PUT", "/api/links", {}, {"enabled": False}),
    (lambda m: m.retention(), "GET", "/api/retention", {}, None),
    (lambda m: m.set_retention(30, 90), "PUT", "/api/retention", {}, {"mail_days": 30, "event_days": 90}),
    (lambda m: m.prune_retention(), "POST", "/api/retention/prune", {}, {}),
    (lambda m: m.junk_settings(), "GET", "/api/junk", {}, None),
    (lambda m: m.set_junk_settings({"enabled": True}), "PUT", "/api/junk", {}, {"enabled": True}),
    (lambda m: m.faults(), "GET", "/api/faults", {}, None),
    (lambda m: m.set_faults([]), "PUT", "/api/faults", {}, []),
    (lambda m: m.fault_scenarios(), "GET", "/api/faults/scenarios", {}, None),
    (lambda m: m.add_fault_scenario(FaultScenario.GMAIL_RATE, match="@gmail.com"), "POST", "/api/faults/scenarios/gmail-rate", {},
     {"match": "@gmail.com"}),
    (lambda m: m.health("<m@x>"), "GET", "/api/inspect", {"message_id": "<m@x>"}, None),
    (lambda m: m.insights(7), "GET", "/api/insights", {"days": "7"}, None),
    (lambda m: m.insight_shares(), "GET", "/api/insights/shares", {}, None),
    (lambda m: m.share_insights("T", 30), "POST", "/api/insights/shares", {}, {"title": "T", "days": 30}),
    (lambda m: m.revoke_insight_share("shr_1"), "DELETE", "/api/insights/shares/shr_1", {}, None),
    (lambda m: m.webhooks(), "GET", "/api/webhooks", {}, None),
    (lambda m: m.set_webhooks([{"url": "https://h.test", "events": ["persona.*"]}]), "PUT", "/api/webhooks", {},
     [{"url": "https://h.test", "events": ["persona.*"]}]),
    (lambda m: m.world(), "GET", "/api/world", {}, None),
    (lambda m: m.set_world({"company": {"name": "Acme"}, "streams": []}), "PUT", "/api/world", {}, {"company": {"name": "Acme"}, "streams": []}),
    (lambda m: m.send_from_stream("s_1"), "POST", "/api/world/streams/s_1/send", {}, {}),
]


class _Server(unittest.TestCase):
    """A fake server for the tests."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def mail(self):
        return Simmail(self.base, "smk_t")


class FullTest(_Server):
    def test_every_call(self):
        m = self.mail()
        for call, method, path, query, body in CALLS:
            with self.subTest(f"{method} {path}"):
                call(m)
                r = last()
                self.assertEqual((r["method"], r["path"]), (method, path))
                self.assertEqual(r["query"], query)
                self.assertEqual(r["body"], body)
                self.assertEqual(r["headers"]["Authorization"], "Bearer smk_t")

    def test_resources(self):
        m = self.mail()
        msg = m.wait_for_email("a@co.test")
        self.assertIsInstance(msg, Message)
        self.assertEqual(msg.codes, ["123456"])
        self.assertEqual(msg["magic_links"], ["https://co.test/v?t=1"], "0.1.0 dictionary access still works")
        self.assertEqual(msg.get("from"), "app@co.test")
        self.assertEqual(msg.sender, "app@co.test")
        self.assertEqual(dict(msg)["codes"], ["123456"])

        msg.reply("thanks")
        self.assertEqual(last()["body"], {"from": "a@co.test", "to": ["app@co.test"], "subject": "Re: Verify", "text": "thanks", "html": "",
                                          "in_reply_to": "<m4@x>", "references": ["<m4@x>"]})
        reply = msg.wait_for_reply(timeout="5s")
        self.assertEqual(last()["query"], {"from": "a@co.test", "in_reply_to": "<m4@x>", "fast": "true", "timeout": "5s"})
        self.assertEqual(reply.in_reply_to, "<m4@x>")
        msg.mark_read()
        self.assertEqual(last()["path"], "/api/mailboxes/a%40co.test/messages/INBOX/4")
        msg.move(Folder.ARCHIVE)
        self.assertEqual(last()["body"], {"move_to": "Archive"})

        box = m.mailbox("a@co.test")
        listed = list(box.messages(folder="Sent"))
        self.assertIsInstance(listed[0], Message)
        self.assertEqual((listed[0].address, listed[0].folder, listed[0].is_read), ("a@co.test", "Sent", True))
        full = listed[0].full()
        self.assertEqual(full.safe["html"], "<p>")
        self.assertEqual(full.case["id"], "deal-1")
        self.assertEqual(listed[0].attachment(0), bytes([1, 2, 3]))
        self.assertTrue(listed[0].source().startswith("From: a"))
        box.wait_for_email(subject="x")
        self.assertEqual(last()["query"]["to"], "a@co.test")
        box.send(["d@h.test"], "Hi", idempotency_key="k-1")
        self.assertEqual(last()["body"]["from"], "a@co.test")
        self.assertEqual(last()["headers"]["Idempotency-Key"], "k-1")

        boxes = m.mailboxes()
        self.assertIsInstance(boxes[1], Mailbox)
        self.assertEqual(boxes[1].persona, "Dana Reyes")
        self.assertEqual(boxes[1].get_persona().id, "p_1")

        people = m.personas()
        self.assertIs(people[0].temperament, Temperament.SKEPTICAL, "known values become enums")
        p = m.personas.create({"name": "Dana", "addresses": ["dana@h.test"]})
        self.assertIsInstance(p, Persona)
        self.assertEqual(p.address, "dana@h.test")
        self.assertIsInstance(p.update(paused=True), Persona)
        self.assertEqual(last()["body"], {"paused": True})
        p.remember("called", case_id="deal-1")
        self.assertEqual(last()["body"], {"text": "called", "case_id": "deal-1"})
        self.assertEqual([j.id for j in p.jobs()], [1, 2])
        self.assertEqual([r["id"] for r in p.run_due(kind=JobKind.REPLY)["ran"]], [1])
        self.assertEqual((last()["method"], last()["path"], last()["body"]), ("POST", "/api/jobs/run-due", {"persona": "p_1", "kind": "reply"}))
        m.jobs.run_due(kind=JobKind.NUDGE, before=datetime(2026, 10, 10, 14, tzinfo=timezone.utc), limit=5)
        self.assertEqual(last()["body"], {"kind": "nudge", "before": "2026-10-10T14:00:00Z", "limit": 5})
        self.assertEqual(m.personas.by_address("DANA@h.test").id, "p_1")
        self.assertIsInstance(m.personas.from_mail("sam@co.test")["persona"], Persona)

        c = m.cases.push("deal-1", {"title": "Sale"})
        self.assertIsInstance(c, Case)
        self.assertEqual(c.people[0]["ref"], "seller")
        c.initiate("p_1", "a@co.test")
        self.assertEqual(last()["path"], "/api/cases/deal-1/initiate")

        job = m.jobs.list(state="pending")[0]
        self.assertIsInstance(job, Job)
        self.assertIs(job.state, JobState.PENDING)
        job.reschedule(in_="1h")
        self.assertEqual(last()["body"], {"in": "1h"})
        self.assertIsInstance(m.accounts()[0], Account)
        self.assertIsInstance(m.log()[0], Event)

    def test_namespaces_are_callable(self):
        m = self.mail()
        m.clock()
        self.assertEqual(last()["path"], "/api/clock")
        m.clock.advance("3d")
        self.assertEqual(last()["body"], {"duration": "3d"})
        m.faults.clear()
        self.assertEqual(last()["body"], [])
        m.faults.add(FaultScenario.GREYLISTING)
        self.assertEqual(last()["path"], "/api/faults/scenarios/greylisting")
        m.recipients.set_status("x@h.test", MailboxStatus.BLOCKED)
        self.assertEqual(last()["path"], "/api/mailboxes/x%40h.test/status")
        m.world.send_now("s_9")
        self.assertEqual(last()["path"], "/api/world/streams/s_9/send")
        m.behaviour.set_pace(factor=2)
        self.assertEqual(last()["body"], {"factor": 2})
        m.inspect.extract(html="<a>")
        self.assertEqual(last()["path"], "/api/extract")

    def test_event_stream(self):
        kinds = [e.kind for e in self.mail().events(since=3)]
        self.assertEqual(kinds, ["persona.sent", "clock"])
        self.assertEqual(last()["query"], {"since": "3"})
        self.assertEqual(last()["headers"]["Accept"], "text/event-stream")

    def test_errors(self):
        m = self.mail()
        for status, cls in [(400, ValidationError), (402, PlanLimitError), (403, ForbiddenError), (404, NotFoundError), (408, WaitTimeoutError),
                            (409, ConflictError), (429, RateLimitedError), (500, SimmailError)]:
            with self.subTest(status):
                with self.assertRaises(cls) as ctx:
                    m.request("GET", "/api/fail", query={"status": status})
                e = ctx.exception
                self.assertIsInstance(e, SimmailError)
                self.assertEqual((e.status, str(e), e.code, e.request_id), (status, "nope", "some_code", "req_1"))
                self.assertEqual((e.allowed, e.near_misses), (["a"], [{"subject": "x"}]))
                if cls is RateLimitedError:
                    self.assertEqual(e.retry_after, 7)

    def test_enums_are_the_api_strings(self):
        self.assertEqual(Temperament.SKEPTICAL, "skeptical")
        self.assertEqual(f"{FaultScenario.MICROSOFT_ACCESS_DENIED}", "microsoft-access-denied")
        self.assertEqual(json.dumps(Folder.INBOX), '"INBOX"')


class NewApiTest(_Server):
    """Advanced waits, test addresses, idempotency, request ids, retries, error codes and generated enums."""

    def test_advanced_waits(self):
        m = self.mail()
        m.wait_for_email(["a@co.test", "*@h.test"], since=datetime(2026, 10, 10, 14, tzinfo=timezone.utc), exclude=["<1@x>", "<2@x>"],
                         subject_regex=re.compile("welcome|hello", re.I), body_regex=r"code \d+", header={"X-Campaign": "spring"},
                         has_attachment=True, attachment_name="invoice.pdf", link_domain="co.test", timeout=5)
        self.assertEqual(last()["query"], {
            "to": ["a@co.test", "*@h.test"], "since": "2026-10-10T14:00:00Z", "exclude": "<1@x>,<2@x>", "subject_regex": "(?i)welcome|hello",
            "body_regex": r"code \d+", "header": "X-Campaign:spring", "has_attachment": "true", "attachment_name": "invoice.pdf",
            "link_domain": "co.test", "timeout": "5s"})
        many = m.wait_for_email(tag="signup", count=2)
        self.assertIsInstance(many, WaitMany)
        self.assertEqual(many.count, 2)
        self.assertIsInstance(many.messages[1], Message)
        self.assertEqual(many.messages[1].subject, "2")

        self.assertTrue(m.expect_no_email("t@inbox.test", within="3s")["none"])
        self.assertEqual(last()["query"], {"to": "t@inbox.test", "for": "3s"})
        with self.assertRaises(UnexpectedEmailError) as ctx:
            m.expect_no_email("t@inbox.test", subject="boom")
        self.assertIsInstance(ctx.exception, ConflictError)
        self.assertEqual(ctx.exception.code, ErrorCode.UNEXPECTED_EMAIL)
        self.assertIsInstance(ctx.exception.email, Message)
        self.assertEqual(ctx.exception.email.subject, "Oops")

        ev = m.wait_for_event([EventAlias.REPLIED, "link.*"], persona="dana@h.test", fast=True, timeout="20s")
        self.assertEqual(last()["query"], {"type": "replied,link.*", "persona": "dana@h.test", "fast": "true", "timeout": "20s"})
        self.assertIs(ev.kind, EventType.PERSONA_SENT)
        self.assertEqual((ev.waited_ms, ev.persona_id, ev.message_id), (12, "p_1", "<r@x>"))
        self.assertEqual(ev.persona().id, "p_1")

        conv = m.wait_for_thread("<m4@x>", quiet="2s")
        self.assertEqual(last()["query"], {"message_id": "<m4@x>", "quiet": "2s", "timeout": "60s"})
        self.assertIsInstance(conv, Conversation)
        self.assertEqual((conv.root, conv.count, len(conv.messages)), ("<m4@x>", 2, 2))
        self.assertEqual(conv.latest.subject, "Re: Offer")
        conv.wait_until_quiet(quiet=1)
        self.assertEqual(last()["query"], {"thread": "<m4@x>", "quiet": "1s", "timeout": "60s"})
        conv.reply("ok")
        self.assertEqual(last()["body"]["to"], ["dana@h.test"])
        m.wait_for_email("a@co.test").wait_until_quiet()
        self.assertEqual(last()["query"], {"message_id": "<m4@x>", "timeout": "60s"})

        p = m.persona("p_1")
        p.wait_for(EventAlias.DECLINED, timeout="10s")
        self.assertEqual(last()["query"], {"type": "declined", "persona": "p_1", "timeout": "10s"})
        m.events.wait_for("persona.*")
        self.assertEqual(last()["path"], "/api/wait/event")
        m.jobs(persona="p_1", kind=JobKind.REPLY, due_before="1h", limit=10)
        self.assertEqual(last()["query"], {"persona": "p_1", "kind": "reply", "due_before": "1h", "limit": "10"})

    def test_test_addresses_and_tags(self):
        m = self.mail()
        addr = m.test_address(prefix="user", tag="signup")
        self.assertEqual((last()["method"], last()["path"], last()["body"]), ("POST", "/api/addresses", {"prefix": "user", "tag": "signup"}))
        self.assertIsInstance(addr, TestAddress)
        self.assertIsInstance(addr, Mailbox)
        self.assertEqual((addr.address, addr.tag, str(addr)), ("user-k3x9@inbox.test", "signup", "user-k3x9@inbox.test"))
        addr.wait_for_email(subject="Welcome")
        self.assertEqual(last()["query"], {"to": "user-k3x9@inbox.test", "subject": "Welcome", "timeout": "30s"})
        addr.expect_no_email(within=2)
        self.assertEqual(last()["query"], {"to": "user-k3x9@inbox.test", "for": "2s"})
        self.assertEqual(addr.cleanup()["deleted"], 3)
        self.assertEqual((last()["method"], last()["path"], last()["query"]), ("DELETE", "/api/messages", {"to": "user-k3x9@inbox.test"}))
        self.assertIsInstance(addr.list()[0], Message)
        self.assertEqual(last()["query"], {"to": "user-k3x9@inbox.test"})

        group = m.tag("signup")
        self.assertIsInstance(group, TagGroup)
        listed = group.messages(limit=5)
        self.assertEqual(last()["query"], {"tag": "signup", "limit": "5"})
        self.assertEqual(listed[0].address, "t-k3x9@inbox.test")
        group.wait_for_email(count=2)
        self.assertEqual(last()["query"], {"tag": "signup", "count": "2", "timeout": "30s"})
        group.new_address(domain="co.test")
        self.assertEqual(last()["body"], {"domain": "co.test", "tag": "signup"})
        group.cleanup(folder=Folder.JUNK)
        self.assertEqual(last()["query"], {"tag": "signup", "folder": "Junk"})
        m.list_messages(to=["a@co.test", "*@h.test"])
        self.assertEqual(last()["query"], {"to": ["a@co.test", "*@h.test"]})
        self.assertEqual(m.create_address()["address"], "t-k3x9@inbox.test")
        self.assertEqual(last()["body"], {})

    def test_idempotency_request_ids_retries_schema(self):
        m = self.mail()
        a = m.send("app@co.test", ["d@h.test"], "Hi")
        k1 = hdr("Idempotency-Key")
        self.assertRegex(k1, r"^[0-9a-f]{32}$")
        self.assertEqual(a, {"ok": True, "message_id": "<s@x>"}, "still the plain answer")
        self.assertEqual((a.request_id, a.replayed), ("req_srv", False))
        m.send("app@co.test", ["d@h.test"], "Hi")
        self.assertNotEqual(hdr("Idempotency-Key"), k1)
        self.assertTrue(m.send("app@co.test", ["d@h.test"], "Hi", idempotency_key="seen").replayed)
        m.send("app@co.test", ["d@h.test"], "Hi", idempotency_key=False)
        self.assertIsNone(hdr("Idempotency-Key"))
        m.inject("a@co.test", subject="x")
        self.assertTrue(hdr("Idempotency-Key"))

        traced = m.with_request_id("trace-42")
        self.assertEqual(traced.send("app@co.test", ["d@h.test"], "Hi").request_id, "trace-42")
        self.assertEqual(hdr("X-Request-Id"), "trace-42")
        with self.assertRaises(ValidationError) as ctx:
            traced.request("GET", "/api/fail2", query={"status": 400, "code": "invalid_value"})
        self.assertEqual((ctx.exception.request_id, ctx.exception.field, ctx.exception.allowed), ("trace-42", "type", ["x"]))

        FLAKY[0] = 0
        self.assertEqual(Simmail(self.base, retries=1).request("GET", "/api/flaky")["tries"], 2, "a GET is tried again after a 503")
        FLAKY[0] = 0
        with self.assertRaises(SimmailError) as ctx:
            Simmail(self.base, retries=1).request("POST", "/api/flaky", {})
        self.assertEqual(ctx.exception.status, 503, "a write without a key is not")

        m.schema()
        self.assertEqual(last()["path"], "/api/schema")
        m.inspect.schema()
        self.assertEqual(last()["path"], "/api/schema")

    def test_errors_by_code(self):
        m = self.mail()
        for status, code, cls in [(400, "invalid_regex", ValidationError), (401, "unauthorized", AuthError), (402, "not_in_plan", PlanLimitError),
                                  (408, "wait_timeout", WaitTimeoutError), (409, "unexpected_email", UnexpectedEmailError),
                                  (422, "idempotency_mismatch", IdempotencyError), (429, "rate_limited", RateLimitedError),
                                  (500, "internal_error", SimmailError)]:
            with self.subTest(code):
                with self.assertRaises(cls) as ctx:
                    m.request("GET", "/api/fail2", query={"status": status, "code": code})
                self.assertEqual((ctx.exception.code, ctx.exception.request_id), (code, "req_srv"))
                if cls is WaitTimeoutError:
                    self.assertIsInstance(ctx.exception.messages[0], Message)

    def test_generated_enums(self):
        self.assertEqual(JobKind.OUT_OF_OFFICE, "ooo")
        self.assertEqual(Temperament.SKEPTICAL.label, "Skeptical")
        self.assertTrue(Temperament.SKEPTICAL.description)
        self.assertEqual(describe("FaultScenario", FaultScenario.GMAIL_RATE), "Gmail: Rate-limits your IP")
        self.assertEqual(describe("Nope", "x"), "x")


if __name__ == "__main__":
    unittest.main()
