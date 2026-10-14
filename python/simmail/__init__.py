"""simmail client: wait for the email your app sends, pull out codes and
links, and get replies from simulated people. Standard library only."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

__all__ = ["Simmail", "SimmailError"]
__version__ = "0.1.0"


class SimmailError(Exception):
    """A failed call: the HTTP status and the server's message."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _duration(v: Any) -> Optional[str]:
    """A wait's timeout: seconds as a number, or a duration such as "45s"."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return f"{v}s"
    return str(v)


def _seg(v: Any) -> str:
    return urllib.parse.quote(str(v), safe="")


class Simmail:
    """A simmail universe's API.

    Defaults come from SIMMAIL_URL (the server, such as https://c1.simmail.dev;
    a trailing /api is fine too), SIMMAIL_API_KEY and SIMMAIL_UNIVERSE.
    """

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None, universe: Optional[str] = None):
        url = (base_url or os.environ.get("SIMMAIL_URL") or "http://127.0.0.1:8025").rstrip("/")
        self.base_url = url[: -len("/api")] if url.endswith("/api") else url
        self.api_key = api_key or os.environ.get("SIMMAIL_API_KEY", "")
        self.universe = universe or os.environ.get("SIMMAIL_UNIVERSE", "")

    def request(self, method: str, path: str, body: Any = None, query: Optional[dict] = None, timeout: float = 330) -> Any:
        q = {k: ("true" if v is True else "false" if v is False else v) for k, v in (query or {}).items() if v not in (None, "")}
        url = self.base_url + path + ("?" + urllib.parse.urlencode(q) if q else "")
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json"})
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        if self.universe:
            req.add_header("X-Simmail-Universe", self.universe)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                msg = json.loads(raw).get("error", e.reason)
            except Exception:
                msg = e.reason
            raise SimmailError(e.code, str(msg)) from None
        return json.loads(raw) if raw else None

    def me(self) -> dict:
        """Who the key is and which universe it belongs to."""
        return self.request("GET", "/api/me")

    # ---- waiting for mail ----

    def wait_for_email(self, to: str, *, sender: Optional[str] = None, subject: Optional[str] = None, contains: Optional[str] = None,
                       folder: Optional[str] = None, existing: bool = False, timeout: "float | str" = 30) -> dict:
        """The next email to an address (optionally from someone, with words in the subject or body)."""
        return self.request("GET", "/api/wait", query={"to": to, "from": sender, "subject": subject, "contains": contains,
                                                       "folder": folder, "existing": existing or None, "timeout": _duration(timeout)})

    def wait_for_reply(self, sender: str, *, in_reply_to: Optional[str] = None, fast: bool = True, timeout: "float | str" = 30) -> dict:
        """The next email a person sends, optionally in reply to a message. fast has them write it now."""
        return self.request("GET", "/api/wait/reply", query={"from": sender, "in_reply_to": in_reply_to, "fast": fast,
                                                             "timeout": _duration(timeout)})

    def extract(self, text: str = "", html: str = "") -> dict:
        """Codes and links from any text or HTML."""
        return self.request("POST", "/api/extract", {"text": text, "html": html})

    # ---- mailboxes and messages ----

    def mailboxes(self) -> list:
        """Every mailbox in the universe: your app's logins and the people's addresses."""
        return self.request("GET", "/api/mailboxes")

    def messages(self, address: str, folder: Optional[str] = None) -> list:
        """A mailbox's messages, newest first (text shortened; message() has all of it)."""
        return self.request("GET", f"/api/mailboxes/{_seg(address)}/messages", query={"folder": folder})

    def message(self, address: str, folder: str, uid: int) -> dict:
        """One whole message."""
        return self.request("GET", f"/api/mailboxes/{_seg(address)}/messages/{_seg(folder)}/{_seg(uid)}")

    def health(self, message_id: str) -> dict:
        """The health report of a message your app sent: spam score, links, compatibility."""
        return self.request("GET", "/api/inspect", query={"message_id": message_id})

    def send(self, sender: str, to: "list[str]", subject: str, text: str = "", html: str = "", cc: "Optional[list[str]]" = None,
             in_reply_to: Optional[str] = None, attachments: "Optional[list[dict]]" = None) -> dict:
        """Send an email as an account or mailbox (as the app would). Attachments: {filename, content_type, data (base64)}."""
        body: dict = {"from": sender, "to": to, "subject": subject, "text": text, "html": html}
        if cc:
            body["cc"] = cc
        if in_reply_to:
            body["in_reply_to"] = in_reply_to
        if attachments:
            body["attachments"] = attachments
        return self.request("POST", "/api/send", body)

    # ---- your app's mail logins ----

    def accounts(self) -> list:
        return self.request("GET", "/api/accounts")

    def create_account(self, address: str, password: str) -> dict:
        """A login your app sends and reads with over SMTP and IMAP."""
        return self.request("POST", "/api/accounts", {"address": address, "password": password})

    # ---- people and stories ----

    def personas(self) -> list:
        return self.request("GET", "/api/personas")

    def create_persona(self, persona: dict) -> dict:
        return self.request("POST", "/api/personas", persona)

    def push_case(self, case_id: str, case: dict) -> dict:
        """Push what your system knows about a matter; the people in it learn the story."""
        return self.request("PUT", "/api/cases/" + _seg(case_id), case)

    # ---- the simulated clock ----

    def clock(self) -> dict:
        return self.request("GET", "/api/clock")

    def advance(self, duration: str) -> dict:
        """Move time on, such as "2d"; what was due happens."""
        return self.request("POST", "/api/clock/advance", {"duration": duration})

    def freeze(self) -> dict:
        return self.request("POST", "/api/clock/freeze", {})

    def speed(self, factor: float) -> dict:
        return self.request("POST", "/api/clock/speed", {"factor": factor})

    def live(self) -> dict:
        """Back to real time."""
        return self.request("POST", "/api/clock/live", {})
