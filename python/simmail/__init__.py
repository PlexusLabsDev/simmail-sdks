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
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _duration(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return f"{v}s"  # seconds, the Python way
    return str(v)


class Simmail:
    """Defaults come from SIMMAIL_URL, SIMMAIL_API_KEY and SIMMAIL_UNIVERSE."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None, universe: str | None = None):
        self.base_url = (base_url or os.environ.get("SIMMAIL_URL") or "http://127.0.0.1:8025").rstrip("/")
        self.api_key = api_key or os.environ.get("SIMMAIL_API_KEY", "")
        self.universe = universe or os.environ.get("SIMMAIL_UNIVERSE", "")

    def request(self, method: str, path: str, body: Any = None, query: dict | None = None, timeout: float = 330) -> Any:
        q = {k: ("true" if v is True else "false" if v is False else v) for k, v in (query or {}).items() if v not in (None, "")}
        url = self.base_url + path + ("?" + urllib.parse.urlencode(q) if q else "")
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
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

    def wait_for_email(self, to: str, *, sender: str | None = None, subject: str | None = None, contains: str | None = None,
                       folder: str | None = None, existing: bool = False, timeout: float | str = 30) -> dict:
        """The next email to an address (optionally from someone, with words in the subject or body)."""
        return self.request("GET", "/api/wait", query={"to": to, "from": sender, "subject": subject, "contains": contains,
                                                       "folder": folder, "existing": existing or None, "timeout": _duration(timeout)})

    def wait_for_reply(self, sender: str, *, in_reply_to: str | None = None, fast: bool = True, timeout: float | str = 30) -> dict:
        """The next email a persona sends, optionally in reply to a message. fast runs their due replies now."""
        return self.request("GET", "/api/wait/reply", query={"from": sender, "in_reply_to": in_reply_to, "fast": fast,
                                                             "timeout": _duration(timeout)})

    def extract(self, text: str = "", html: str = "") -> dict:
        return self.request("POST", "/api/extract", {"text": text, "html": html})

    def send(self, sender: str, to: list[str], subject: str, text: str = "", html: str = "", cc: list[str] | None = None) -> dict:
        return self.request("POST", "/api/send", {"from": sender, "to": to, "cc": cc or [], "subject": subject, "text": text, "html": html})

    def health(self, message_id: str) -> dict:
        return self.request("GET", "/api/inspect", query={"message_id": message_id})

    def personas(self) -> list:
        return self.request("GET", "/api/personas")

    def create_persona(self, persona: dict) -> dict:
        return self.request("POST", "/api/personas", persona)

    def push_case(self, case_id: str, case: dict) -> dict:
        return self.request("PUT", "/api/cases/" + urllib.parse.quote(case_id, safe=""), case)

    def advance(self, duration: str) -> dict:
        return self.request("POST", "/api/clock/advance", {"duration": duration})

    def freeze(self) -> dict:
        return self.request("POST", "/api/clock/freeze", {})
