"""Unit tests against a local fake server: no network, no simmail needed."""

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from simmail import Simmail, SimmailError

SEEN = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _handle(self):
        u = urlsplit(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        SEEN.append({"method": self.command, "path": u.path, "query": {k: v[0] for k, v in parse_qs(u.query).items()},
                     "headers": dict(self.headers), "body": body})
        if u.path == "/api/inspect":
            out, code = {"error": "no inspection for that message"}, 404
        elif u.path == "/api/wait":
            out, code = {"codes": ["123456"], "magic_links": []}, 200
        else:
            out, code = {"ok": True}, 200
        raw = json.dumps(out).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = do_PUT = _handle


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def last(self):
        return SEEN[-1]

    def test_auth_universe_and_wait_query(self):
        mail = Simmail(self.base + "/api/", api_key="smk_test", universe="u_1")
        self.assertEqual(mail.base_url, self.base)  # a trailing /api is accepted
        msg = mail.wait_for_email("a@b.test", subject="verify", timeout=20)
        self.assertEqual(msg["codes"], ["123456"])
        r = self.last()
        self.assertEqual(r["path"], "/api/wait")
        self.assertEqual(r["query"], {"to": "a@b.test", "subject": "verify", "timeout": "20s"})
        self.assertEqual(r["headers"]["Authorization"], "Bearer smk_test")
        self.assertEqual(r["headers"]["X-Simmail-Universe"], "u_1")
        self.assertNotIn("Content-Type", r["headers"])

    def test_reply_send_threading(self):
        mail = Simmail(self.base, api_key="k")
        mail.wait_for_reply("dana@harbor.test", in_reply_to="<m1@x>", timeout="45s")
        self.assertEqual(self.last()["query"], {"from": "dana@harbor.test", "in_reply_to": "<m1@x>", "fast": "true", "timeout": "45s"})
        mail.send("a@app.test", ["dana@harbor.test"], "Re: Offer", text="ok", in_reply_to="<m1@x>")
        self.assertEqual(self.last()["body"], {"from": "a@app.test", "to": ["dana@harbor.test"], "subject": "Re: Offer",
                                               "text": "ok", "html": "", "in_reply_to": "<m1@x>"})

    def test_mailboxes_messages_clock(self):
        mail = Simmail(self.base, api_key="k")
        mail.messages("app@acme.test", folder="Sent")
        self.assertEqual((self.last()["path"], self.last()["query"]), ("/api/mailboxes/app%40acme.test/messages", {"folder": "Sent"}))
        mail.message("app@acme.test", "INBOX", 7)
        self.assertEqual(self.last()["path"], "/api/mailboxes/app%40acme.test/messages/INBOX/7")
        mail.advance("2d")
        self.assertEqual((self.last()["method"], self.last()["path"], self.last()["body"]), ("POST", "/api/clock/advance", {"duration": "2d"}))
        mail.push_case("deal 1", {"title": "x"})
        self.assertEqual((self.last()["method"], self.last()["path"]), ("PUT", "/api/cases/deal%201"))

    def test_errors(self):
        mail = Simmail(self.base, api_key="k")
        with self.assertRaises(SimmailError) as cm:
            mail.health("<nope@x>")
        self.assertEqual(cm.exception.status, 404)
        self.assertIn("no inspection", str(cm.exception))

    @unittest.skipUnless(os.environ.get("SIMMAIL_API_URL") and os.environ.get("SIMMAIL_API_KEY"), "integration: set SIMMAIL_API_URL and SIMMAIL_API_KEY")
    def test_integration_me(self):
        self.assertTrue(Simmail(os.environ["SIMMAIL_API_URL"], api_key=os.environ["SIMMAIL_API_KEY"]).me())


if __name__ == "__main__":
    unittest.main()
