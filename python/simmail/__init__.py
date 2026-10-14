"""simmail client: wait for the email your app sends, pull out codes and
links, get replies from simulated people, and drive the whole universe:
mailboxes, people, cases, the clock, the World, faults, webhooks and more.
Standard library only.

Answers come back as typed objects (``Message``, ``Mailbox``, ``Persona``,
``Case``, ``Job``, ``Account``, ``Event``) that still read like the plain
answer (``msg["codes"]``). Objects you send, such as a persona, a case, the
World or fault rules, use the API's own field names, as the docs show them.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from typing import Any, Callable, Dict, Iterator, List, Optional, Union

from .enums import *  # noqa: F401,F403
from .enums import __all__ as _enum_names
from .errors import (AuthError, ConflictError, ForbiddenError, IdempotencyError, NotFoundError, PlanLimitError, RateLimitedError,
                     SimmailError, UnexpectedEmailError, ValidationError, WaitTimeoutError, error_for)
from .models import Account, Answer, Case, Conversation, Event, Job, Mailbox, Message, Model, Persona, TagGroup, TestAddress, WaitMany

__all__ = ["Simmail", "SimmailError", "ValidationError", "AuthError", "PlanLimitError", "ForbiddenError", "NotFoundError",
           "WaitTimeoutError", "ConflictError", "UnexpectedEmailError", "IdempotencyError", "RateLimitedError", "error_for",
           "Model", "Answer", "Message", "Mailbox", "Persona", "Case", "Job", "Account", "Event", "Conversation", "TestAddress",
           "TagGroup", "WaitMany", *_enum_names]
__version__ = "0.1.0"


def _duration(v: Any) -> Optional[str]:
    """A wait's timeout: seconds as a number, or a duration such as "45s"."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return f"{v}s"
    return str(v)


def _seg(v: Any) -> str:
    return urllib.parse.quote(str(v), safe="")


def _clean(d: dict) -> dict:
    """Drops None fields, so the server keeps what was not sent."""
    return {k: v for k, v in d.items() if v is not None}


def _query(q: Optional[dict]) -> str:
    pairs = []
    for k, v in (q or {}).items():
        if v is None or v == "":
            continue
        for x in v if isinstance(v, (list, tuple)) else [v]:
            pairs.append((k, "true" if x is True else "false" if x is False else str(x)))
    return urllib.parse.urlencode(pairs)


def _time(v: Any) -> Any:
    """A datetime as RFC 3339; anything else as it is."""
    if isinstance(v, datetime):
        return v.isoformat().replace("+00:00", "Z") if v.tzinfo else v.isoformat() + "Z"
    if isinstance(v, date):
        return v.isoformat()
    return v


def _rx(v: Any) -> Any:
    """A compiled pattern as the server's (RE2) syntax: its pattern, with (?i) for re.I."""
    if isinstance(v, re.Pattern):
        return ("(?i)" if v.flags & re.IGNORECASE else "") + v.pattern
    return v


def _csv(v: Any) -> Any:
    return ",".join(str(x) for x in v) if isinstance(v, (list, tuple)) else v


def _mail_filters(to: Any = None, tag: Optional[str] = None, sender: Optional[str] = None, subject: Optional[str] = None,
                  contains: Optional[str] = None, folder: Optional[str] = None, existing: Optional[bool] = None,
                  count: Optional[int] = None, since: Any = None, exclude: Any = None, subject_regex: Any = None,
                  body_regex: Any = None, header: Any = None, has_attachment: Optional[bool] = None,
                  attachment_name: Optional[str] = None, link_domain: Optional[str] = None, **more: Any) -> dict:
    """The filters every mail wait and GET /api/messages understand."""
    if isinstance(header, dict):
        header = [f"{k}:{v}" for k, v in header.items()]
    return {"to": to, "tag": tag, "from": sender, "subject": subject, "contains": contains, "folder": folder,
            "existing": existing or None, "count": count, "since": _time(since), "exclude": _csv(exclude),
            "subject_regex": _rx(subject_regex), "body_regex": _rx(body_regex), "header": header,
            "has_attachment": has_attachment, "attachment_name": attachment_name, "link_domain": link_domain, **more}


def _idem(key: Union[str, bool, None]) -> Optional[Dict[str, str]]:
    """The Idempotency-Key header: a new key unless one is given (False sends none)."""
    if key is False:
        return None
    return {"Idempotency-Key": key if isinstance(key, str) and key else uuid.uuid4().hex}


class _Namespace:
    """A group of calls that is also callable as the 0.1.0 method of the same name."""

    def __init__(self, call: Callable[..., Any], doc: str = "", **methods: Callable[..., Any]):
        self._call = call
        self.__doc__ = doc
        for name, fn in methods.items():
            setattr(self, name, fn)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self._call(*args, **kwargs)


class _Group:
    """A group of calls."""

    def __init__(self, doc: str = "", **methods: Callable[..., Any]):
        self.__doc__ = doc
        for name, fn in methods.items():
            setattr(self, name, fn)


class Simmail:
    """A simmail universe's API.

    Defaults come from SIMMAIL_URL (the server, such as https://c1.simmail.dev;
    a trailing /api is fine too), SIMMAIL_API_KEY and SIMMAIL_UNIVERSE.
    """

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None, universe: Optional[str] = None, *,
                 headers: Optional[Dict[str, str]] = None, retries: int = 2):
        """headers are sent with every request. retries is how often a GET, or a POST with an Idempotency-Key,
        is tried again after a network error, 502 or 503."""
        url = (base_url or os.environ.get("SIMMAIL_URL") or "http://127.0.0.1:8025").rstrip("/")
        self.base_url = url[: -len("/api")] if url.endswith("/api") else url
        self.api_key = api_key or os.environ.get("SIMMAIL_API_KEY", "")
        self.universe = universe or os.environ.get("SIMMAIL_UNIVERSE", "")
        self.headers: Dict[str, str] = dict(headers or {})
        self.retries = retries
        self._namespaces()

    def with_request_id(self, request_id: str) -> "Simmail":
        """A client like this one that sends X-Request-Id with every request (the server's logs and errors carry it)."""
        return Simmail(self.base_url, self.api_key, self.universe, headers={**self.headers, "X-Request-Id": request_id},
                       retries=self.retries)

    # Groups of calls by what they are about. Each group is also callable as
    # the 0.1.0 method of the same name: mail.clock() and mail.clock.advance("2d").
    def _namespaces(self) -> None:
        C = Simmail
        b = lambda name: getattr(C, name).__get__(self)  # noqa: E731 - the class's own method, bound
        self.mailboxes = _Namespace(b("mailboxes"), "Mailboxes.", list=b("mailboxes"), get=self.mailbox)
        self.personas = _Namespace(b("personas"), "Simulated people.", list=b("personas"), get=b("persona"), create=b("create_persona"),
                                   update=b("update_persona"), delete=b("delete_persona"), from_mail=b("persona_from_mail"),
                                   temperaments=b("temperaments"), by_address=self._persona_by_address)
        self.cases = _Namespace(b("cases"), "Cases.", list=b("cases"), get=b("get_case"), push=b("push_case"), delete=b("delete_case"))
        self.clock = _Namespace(b("clock"), "The simulated clock.", get=b("clock"), advance=b("advance"), freeze=b("freeze"),
                                speed=b("speed"), live=b("live"))
        self.jobs = _Namespace(b("jobs"), "Planned work.", list=lambda **kw: b("jobs")(**kw)["jobs"], run=b("run_job"),
                               skip=b("skip_job"), bounce=b("bounce_job"), reschedule=b("reschedule_job"), run_due=b("run_due"))
        self.world = _Namespace(b("world"), "The World.", get=b("world"), set=b("set_world"), send_now=b("send_from_stream"))
        self.faults = _Namespace(b("faults"), "Chaos and faults.", list=b("faults"), set=b("set_faults"),
                                 clear=lambda: b("set_faults")([]), scenarios=b("fault_scenarios"), add=b("add_fault_scenario"))
        self.recipients = _Namespace(b("recipients"), "Recipient rules.", get=b("recipients"), set=b("set_recipients"),
                                     set_status=b("set_mailbox_status"))
        self.webhooks = _Namespace(b("webhooks"), "Webhooks.", list=b("webhooks"), set=b("set_webhooks"), clear=lambda: b("set_webhooks")([]))
        self.insights = _Namespace(b("insights"), "Insights.", get=b("insights"), shares=b("insight_shares"), share=b("share_insights"),
                                   revoke=b("revoke_insight_share"))
        self.events = _Namespace(b("events"), "Events.", stream=b("events"), log=b("log"), wait_for=b("wait_for_event"))
        self.accounts = _Namespace(b("accounts"), "Your app's mail logins.", list=b("accounts"), create=b("create_account"),
                                   update=b("update_account"), delete=b("delete_account"), test=b("test_account"))
        self.inspect = _Group("Inspection.", health=b("health"), extract=b("extract"), schema=b("schema"))
        self.behaviour = _Group("How the universe behaves.", ai=b("ai"), set_ai=b("set_ai"), ai_budget=b("ai_budget"), pace=b("pace"),
                                set_pace=b("set_pace"), links=b("links"), set_links=b("set_links"), retention=b("retention"),
                                set_retention=b("set_retention"), prune=b("prune_retention"), junk=b("junk_settings"),
                                set_junk=b("set_junk_settings"))

    # ---- requests ----

    def _open(self, method: str, path: str, body: Any = None, query: Optional[dict] = None, accept: str = "application/json",
              headers: Optional[Dict[str, str]] = None, timeout: Optional[float] = 330):
        q = _query(query)
        url = self.base_url + path + ("?" + q if q else "")
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers={"Accept": accept, **self.headers, **(headers or {})})
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        if self.universe:
            req.add_header("X-Simmail-Universe", self.universe)
        # Tried again after a network error, 502 or 503 when that is safe: a GET, or a write with an Idempotency-Key.
        safe = method == "GET" or bool(headers and headers.get("Idempotency-Key"))
        n = 0
        while True:
            try:
                return urllib.request.urlopen(req, timeout=timeout)
            except urllib.error.HTTPError as e:
                if safe and n < self.retries and e.code in (502, 503):
                    e.close()
                else:
                    raise self._error(e) from None
            except urllib.error.URLError:
                if not safe or n >= self.retries:
                    raise
            time.sleep(0.25 * 2 ** n)
            n += 1

    def _error(self, e: urllib.error.HTTPError) -> SimmailError:
        raw = e.read()
        try:
            parsed: Any = json.loads(raw)
        except Exception:
            parsed = raw.decode(errors="replace") if raw else None
        msg = parsed.get("error", e.reason) if isinstance(parsed, dict) else e.reason
        try:
            retry = float(e.headers.get("Retry-After") or 0) or None
        except ValueError:
            retry = None
        err = error_for(e.code, str(msg), parsed, retry, e.headers.get("X-Request-Id"))
        if isinstance(parsed, dict):
            if isinstance(err, UnexpectedEmailError) and isinstance(parsed.get("message"), dict):
                err.email = Message.from_api(self, parsed["message"])
            if isinstance(err, WaitTimeoutError) and isinstance(parsed.get("messages"), list):
                err.messages = [Message.from_api(self, m) for m in parsed["messages"]]
        return err

    def request(self, method: str, path: str, body: Any = None, query: Optional[dict] = None, timeout: float = 330,
                headers: Optional[Dict[str, str]] = None) -> Any:
        """Any API call: the method, the path (such as "/api/clock"), a JSON body and query parameters
        (a list value repeats the parameter). headers adds request headers, such as an Idempotency-Key.
        An object answer is an Answer: a dict that also has .request_id and .replayed."""
        with self._open(method, path, body, query, headers=headers, timeout=timeout) as r:
            raw = r.read()
            rid, replayed = r.headers.get("X-Request-Id"), r.headers.get("Idempotent-Replayed") == "true"
        if not raw:
            return None
        try:
            out = json.loads(raw)
        except ValueError:
            return raw.decode(errors="replace")
        return Answer(out, request_id=rid, replayed=replayed) if isinstance(out, dict) else out

    def request_raw(self, method: str, path: str, query: Optional[dict] = None) -> bytes:
        """Like request, for answers that are not JSON: the bytes as they came."""
        with self._open(method, path, query=query, accept="*/*") as r:
            return r.read()

    def schema(self) -> dict:
        """Every setting's allowed values, defaults and limits: {version, areas}. The SDK's enums are made from it."""
        return self.request("GET", "/api/schema")

    # ---- who and where (https://www.simmail.dev/docs/api/accounts/#who-am-i) ----

    def me(self) -> dict:
        """Who the key is and which universe it belongs to."""
        return self.request("GET", "/api/me")

    def universes(self) -> list:
        """The universes you can open, with your role in each."""
        return self.request("GET", "/api/universes")

    def status(self) -> dict:
        """Counts of mailboxes, messages, personas, cases and pending jobs, the clock and the writer."""
        return self.request("GET", "/api/status")

    def connection(self) -> dict:
        """The server's SMTP/IMAP services, ports, security and certificate."""
        return self.request("GET", "/api/connection")

    def connection_cert(self) -> str:
        """The server's TLS certificate, as PEM text."""
        return self.request_raw("GET", "/api/connection/cert").decode()

    # ---- waiting for mail (https://www.simmail.dev/docs/testing/wait-api/) ----

    def wait_for_email(self, to: Any = None, *, sender: Optional[str] = None, subject: Optional[str] = None,
                       contains: Optional[str] = None, folder: Optional[str] = None, existing: bool = False,
                       timeout: "float | str" = 30, **filters: Any) -> Any:
        """The next email that matches.

        to is an address, ``*@domain`` or a list of them (or pass tag=, from test_address). sender, subject
        and contains narrow it, and so do subject_regex / body_regex (a str or compiled re), header ({Name:
        value} or ["Name:value"]), has_attachment, attachment_name and link_domain. since (a datetime, RFC
        3339 or a message id) and exclude (message ids) say which mail counts; existing=True also takes mail
        that came before the wait. Answers the Message (with waited_ms and matched), or with count=n a
        WaitMany once n have come. On timeout it raises WaitTimeoutError with near_misses. Other keyword
        arguments go to GET /api/wait as they are.
        """
        q = _mail_filters(to, sender=sender, subject=subject, contains=contains, folder=folder, existing=existing, **filters)
        r = self.request("GET", "/api/wait", query={**q, "timeout": _duration(timeout)})
        if isinstance(r, list):
            return [Message.from_api(self, m) for m in r]
        if isinstance(r, dict) and isinstance(r.get("messages"), list):
            return WaitMany.from_api(self, r)
        return Message.from_api(self, r)

    def expect_no_email(self, to: Any = None, *, within: "float | str" = 5, sender: Optional[str] = None,
                        subject: Optional[str] = None, contains: Optional[str] = None, **filters: Any) -> dict:
        """Passes when no matching email arrives within the time (seconds or a duration, default 5s), with
        wait_for_email's filters. Answers {none: True, waited_ms, matched}; raises UnexpectedEmailError (with
        .email) when one comes."""
        q = _mail_filters(to, sender=sender, subject=subject, contains=contains, **filters)
        return self.request("GET", "/api/wait/none", query={**q, "for": _duration(within)})

    def wait_for_reply(self, sender: str, *, in_reply_to: Optional[str] = None, fast: bool = True, timeout: "float | str" = 30,
                       **more: Any) -> Message:
        """The next email a person sends, optionally in reply to a message. fast has them write it now."""
        return Message.from_api(self, self.request("GET", "/api/wait/reply", query={"from": sender, "in_reply_to": in_reply_to,
                                                                                     "fast": fast, "timeout": _duration(timeout), **more}))

    def wait_for_event(self, type: Any, *, persona: Optional[str] = None, message_id: Optional[str] = None,  # noqa: A002
                       after: Optional[int] = None, fast: Optional[bool] = None, timeout: "float | str" = 30) -> Event:
        """The next event of a type: an EventType or EventAlias such as "replied" (or a list, or a prefix such as
        "persona.*"), optionally for one persona (id or address) or message, after an event id. fast has the
        persona act on what is due now. Answers the Event, with waited_ms."""
        r = self.request("GET", "/api/wait/event", query={"type": _csv(type), "persona": persona, "message_id": message_id,
                                                          "after": after, "fast": fast, "timeout": _duration(timeout)})
        ev = Event.from_api(self, r["event"])
        ev.waited_ms = r.get("waited_ms")
        return ev

    def wait_for_thread(self, message_id: Optional[str] = None, *, thread: Optional[str] = None, quiet: "float | str | None" = None,
                        fast: Optional[bool] = None, timeout: "float | str" = 60) -> Conversation:
        """A conversation once nothing new has joined it for quiet (default 10s): by message_id (any message in
        it) or thread (its first message's id). fast has the people in it act now."""
        r = self.request("GET", "/api/wait/thread", query={"message_id": message_id, "thread": thread, "quiet": _duration(quiet),
                                                           "fast": fast, "timeout": _duration(timeout)})
        return Conversation.from_api(self, r)

    def extract(self, text: str = "", html: str = "") -> dict:
        """Codes and links from any text or HTML."""
        return self.request("POST", "/api/extract", {"text": text, "html": html})

    # ---- mailboxes and messages (https://www.simmail.dev/docs/api/mail/) ----

    def mailboxes(self) -> List[Mailbox]:
        """Every mailbox in the universe: your app's logins and the people's addresses."""
        r = self.request("GET", "/api/mailboxes")
        return [Mailbox.from_api(self, m) for m in r] if isinstance(r, list) else r

    def mailbox(self, address: str) -> Mailbox:
        """One mailbox, to read and wait on (no request is made)."""
        return Mailbox(address=address, raw={"address": address}, _client=self)

    def folders(self, address: str) -> list:
        """A mailbox's folders, with counts."""
        return self.request("GET", f"/api/mailboxes/{_seg(address)}/folders")

    def messages(self, address: str, folder: Optional[str] = None) -> List[Message]:
        """A mailbox's messages, newest first (text shortened; message() has all of it)."""
        r = self.request("GET", f"/api/mailboxes/{_seg(address)}/messages", query={"folder": folder})
        return [Message.from_api(self, m, address=address, folder=str(folder or "INBOX")) for m in r] if isinstance(r, list) else r

    def message(self, address: str, folder: str, uid: int, remote: bool = False, theme: Optional[str] = None) -> dict:
        """One whole message: {message, safe, case}. message is a Message with .safe and .case set."""
        r = self.request("GET", f"/api/mailboxes/{_seg(address)}/messages/{_seg(folder)}/{_seg(uid)}",
                         query={"remote": 1 if remote else None, "theme": theme})
        if isinstance(r, dict) and isinstance(r.get("message"), dict):
            m = Message.from_api(self, r["message"], address=address, folder=str(folder))
            m.safe, m.case = r.get("safe"), r.get("case")
            r = {**r, "message": m}
        return r

    def raw_message(self, address: str, folder: str, uid: int) -> str:
        """The original message, as RFC 5322 text."""
        return self.request_raw("GET", f"/api/mailboxes/{_seg(address)}/messages/{_seg(folder)}/{_seg(uid)}/raw").decode(errors="replace")

    def attachment(self, address: str, folder: str, uid: int, n: int) -> bytes:
        """Attachment number n (from 0) of a message, as bytes."""
        return self.request_raw("GET", f"/api/mailboxes/{_seg(address)}/messages/{_seg(folder)}/{_seg(uid)}/attachments/{_seg(n)}")

    def update_message(self, address: str, folder: str, uid: int, *, seen: Optional[bool] = None, move_to: Optional[str] = None) -> Any:
        """What a mail client does: mark read or unread, move to a folder."""
        return self.request("PATCH", f"/api/mailboxes/{_seg(address)}/messages/{_seg(folder)}/{_seg(uid)}",
                            _clean({"seen": seen, "move_to": move_to}))

    def threads(self, address: str) -> list:
        """A mailbox's conversations, most recent first."""
        return self.request("GET", "/api/threads", query={"address": address})

    def set_mailbox_status(self, address: str, status: str) -> Any:
        """Forces how an address behaves as a recipient (MailboxStatus)."""
        return self.request("PUT", f"/api/mailboxes/{_seg(address)}/status", {"status": status})

    # ---- test addresses (https://www.simmail.dev/docs/testing/wait-api/) ----

    def create_address(self, domain: Optional[str] = None, prefix: Optional[str] = None, tag: Optional[str] = None) -> dict:
        """A fresh address for one test: {address, tag}. domain defaults to inbox.test."""
        return self.request("POST", "/api/addresses", _clean({"domain": domain, "prefix": prefix, "tag": tag}))

    def test_address(self, domain: Optional[str] = None, prefix: Optional[str] = None, tag: Optional[str] = None) -> TestAddress:
        """A fresh address for one test, as a TestAddress: wait_for_email(), expect_no_email(), list(), cleanup()."""
        return TestAddress.from_api(self, self.create_address(domain, prefix, tag))

    def tag(self, tag: str) -> TagGroup:
        """Every address made with a tag, together (no request is made)."""
        return TagGroup(self, tag)

    def list_messages(self, *, tag: Optional[str] = None, to: Any = None, folder: Optional[str] = None,
                      limit: Optional[int] = None) -> List[Message]:
        """Messages across addresses (to: an address, *@domain or a list) or a tag's addresses, newest first."""
        r = self.request("GET", "/api/messages", query={"tag": tag, "to": to, "folder": folder, "limit": limit})
        return [Message.from_api(self, m, folder=str(folder or "INBOX")) for m in r] if isinstance(r, list) else r

    def delete_messages(self, *, tag: Optional[str] = None, to: Any = None, folder: Optional[str] = None) -> dict:
        """Deletes the mail of those addresses (every folder, or one): {deleted, addresses}."""
        return self.request("DELETE", "/api/messages", query={"tag": tag, "to": to, "folder": folder})

    # ---- sending (https://www.simmail.dev/docs/api/mail/#sending) ----

    def send(self, sender: str, to: "list[str]", subject: str, text: str = "", html: str = "", cc: "Optional[list[str]]" = None,
             in_reply_to: Optional[str] = None, attachments: "Optional[list[dict]]" = None, *, references: "Optional[list[str]]" = None,
             forward: Optional[dict] = None, idempotency_key: Union[str, bool, None] = None) -> dict:
        """Send an email as an account or mailbox (as the app would). Attachments: {filename, content_type, data (base64)}.

        Each call gets its own Idempotency-Key, so a retried call never sends twice; pass idempotency_key to
        choose it (False sends none). The answer has .replayed (True when the server had already done it) and
        .request_id."""
        body: dict = {"from": sender, "to": to, "subject": subject, "text": text, "html": html}
        if cc:
            body["cc"] = cc
        if in_reply_to:
            body["in_reply_to"] = in_reply_to
        if attachments:
            body["attachments"] = attachments
        if references:
            body["references"] = references
        if forward:
            body["forward"] = forward
        return self.request("POST", "/api/send", body, headers=_idem(idempotency_key))

    def inject(self, to: str, *, folder: Optional[str] = None, sender: Optional[str] = None, subject: Optional[str] = None,
               text: Optional[str] = None, raw: Optional[str] = None, idempotency_key: Union[str, bool, None] = None) -> Any:
        """Files a message straight into a mailbox, skipping SMTP; nobody is told. Send raw, or sender, subject and text.
        Idempotent like send."""
        return self.request("POST", "/api/inject", _clean({"to": to, "folder": folder, "from": sender, "subject": subject,
                                                           "text": text, "raw": raw}),
                            headers=_idem(idempotency_key))

    def signature(self, address: str) -> dict:
        """The signature people see for an address."""
        return self.request("GET", f"/api/accounts/{_seg(address)}/signature")

    def set_signature(self, address: str, signature: str) -> Any:
        """Sets an address's signature. Admin role."""
        return self.request("PUT", f"/api/accounts/{_seg(address)}/signature", {"signature": signature})

    def rescue(self, message_id: str, address: str) -> Any:
        """Moves a message a person got out of their Junk folder, as if they rescued it."""
        return self.request("POST", "/api/rescue", {"message_id": message_id, "address": address})

    def retry(self, message_id: str, address: Optional[str] = None) -> Any:
        """Has people react to a message again (one person with address)."""
        return self.request("POST", "/api/retry", _clean({"message_id": message_id, "address": address}))

    # ---- your app's mail logins (https://www.simmail.dev/docs/api/accounts/) ----

    def accounts(self) -> List[Account]:
        """Every login, with its settings (and passwords)."""
        r = self.request("GET", "/api/accounts")
        return [Account.from_api(self, a) for a in r] if isinstance(r, list) else r

    def create_account(self, address: str, password: str, **extra: Any) -> dict:
        """A login your app sends and reads with over SMTP and IMAP. extra: display_name, username, allow_smtp,
        allow_imap, note. Admin role."""
        return self.request("POST", "/api/accounts", {**extra, "address": address, "password": password})

    def update_account(self, address: str, **changes: Any) -> Any:
        """Changes a login; fields left out keep their values. Admin role."""
        return self.request("PATCH", f"/api/accounts/{_seg(address)}", changes)

    def delete_account(self, address: str) -> Any:
        """Turns a login off for good; the mailbox and its mail stay. Admin role."""
        return self.request("DELETE", f"/api/accounts/{_seg(address)}")

    def test_account(self, address: str, password: Optional[str] = None, username: Optional[str] = None,
                     proto: Optional[str] = None) -> dict:
        """Checks a password the way SMTP and IMAP do. proto: "smtp" or "imap" for only one."""
        return self.request("POST", f"/api/accounts/{_seg(address)}/test", _clean({"password": password, "username": username, "proto": proto}))

    # ---- people (https://www.simmail.dev/docs/api/personas/) ----

    def personas(self) -> List[Persona]:
        """Every persona, sorted by name."""
        r = self.request("GET", "/api/personas")
        return [Persona.from_api(self, p) for p in r] if isinstance(r, list) else r

    def persona(self, persona_id: str) -> Persona:
        """One persona."""
        return Persona.from_api(self, self.request("GET", "/api/personas/" + _seg(persona_id)))

    def create_persona(self, persona: dict) -> Persona:
        """Creates a persona (and its mailbox)."""
        return Persona.from_api(self, self.request("POST", "/api/personas", persona))

    def update_persona(self, persona_id: str, changes: dict) -> Persona:
        """Changes only the fields you send (a nested object you send replaces that whole object)."""
        return Persona.from_api(self, self.request("PATCH", "/api/personas/" + _seg(persona_id), changes))

    def delete_persona(self, persona_id: str) -> Any:
        """Deletes a persona with its memory, relations and pending jobs; the mailbox stays."""
        return self.request("DELETE", "/api/personas/" + _seg(persona_id))

    def persona_from_mail(self, address: str, paused: Optional[bool] = None) -> dict:
        """Learns a persona from an address's mail in this universe: {persona, by, people}."""
        r = self.request("POST", "/api/personas/from-mail", _clean({"address": address, "paused": paused}))
        if isinstance(r, dict) and isinstance(r.get("persona"), dict):
            r = {**r, "persona": Persona.from_api(self, r["persona"])}
        return r

    def temperaments(self) -> list:
        """The temperaments people can have, with their odds and reply habits."""
        return self.request("GET", "/api/temperaments")

    def memory(self, persona_id: str) -> dict:
        """A persona's memory, by case id ("" is everything outside a case)."""
        return self.request("GET", f"/api/personas/{_seg(persona_id)}/memory")

    def add_memory(self, persona_id: str, text: str, case_id: Optional[str] = None, source: Optional[str] = None) -> Any:
        """Adds a note to a persona's memory."""
        return self.request("POST", f"/api/personas/{_seg(persona_id)}/memory", _clean({"text": text, "case_id": case_id, "source": source}))

    def clear_memory(self, persona_id: str, case_id: Optional[str] = None) -> Any:
        """Clears a persona's memory, or only one case's."""
        return self.request("DELETE", f"/api/personas/{_seg(persona_id)}/memory", query={"case_id": case_id})

    def add_memory_by_external(self, system: str, external_id: str, text: str, case_id: Optional[str] = None,
                               source: Optional[str] = None) -> Any:
        """Adds a note to the persona with your id for them, such as system "crm", id "c-1042"."""
        return self.request("POST", "/api/memory/by-external", _clean({"system": system, "id": external_id, "text": text,
                                                                       "case_id": case_id, "source": source}))

    def relations(self, persona_id: str) -> dict:
        """What a persona holds about each correspondent: {relations, stances}."""
        return self.request("GET", f"/api/personas/{_seg(persona_id)}/relations")

    def forget_relations(self, persona_id: str, address: Optional[str] = None) -> Any:
        """Has a persona forget one correspondent, or everyone."""
        return self.request("DELETE", f"/api/personas/{_seg(persona_id)}/relations", query={"address": address})

    def _persona_by_address(self, address: str) -> Optional[Persona]:
        a = address.lower()
        return next((p for p in self.personas() if any(x.lower() == a for x in p.addresses)), None)

    # ---- cases (https://www.simmail.dev/docs/api/cases/) ----

    def cases(self) -> List[Case]:
        """Every case, most recently updated first (stories cut short)."""
        r = self.request("GET", "/api/cases")
        return [Case.from_api(self, c) for c in r] if isinstance(r, list) else r

    def get_case(self, case_id: str, redact: bool = False) -> Case:
        """One case with its full story; redact leaves the story out."""
        return Case.from_api(self, self.request("GET", "/api/cases/" + _seg(case_id), query={"redact": "story" if redact else None}))

    def push_case(self, case_id: str, case: dict) -> Case:
        """Push what your system knows about a matter; the people in it learn the story."""
        return Case.from_api(self, self.request("PUT", "/api/cases/" + _seg(case_id), case))

    def add_case_people(self, case_id: str, people: List[dict]) -> Case:
        """Adds or updates people on a case."""
        return Case.from_api(self, self.request("POST", f"/api/cases/{_seg(case_id)}/people", people))

    def initiate_case(self, case_id: str, persona: str, to: Any, intent: Optional[str] = None, after: Optional[str] = None) -> dict:
        """Has a person (id or address) start a new thread; after such as "2h"."""
        return self.request("POST", f"/api/cases/{_seg(case_id)}/initiate", _clean({"persona": persona, "to": to, "intent": intent, "after": after}))

    def regenerate_case(self, case_id: str) -> Case:
        """Writes the story and cast details again."""
        return Case.from_api(self, self.request("POST", f"/api/cases/{_seg(case_id)}/regenerate", {}))

    def edit_case_story(self, case_id: str, story: Optional[str] = None, amendments: Optional[List[str]] = None,
                        directions: Optional[str] = None) -> Case:
        """Rewrites the answer key by hand."""
        return Case.from_api(self, self.request("PATCH", f"/api/cases/{_seg(case_id)}/story",
                                                _clean({"story": story, "amendments": amendments, "directions": directions})))

    def delete_case(self, case_id: str) -> Any:
        """Deletes a case, its people's memory of it and their pending work on it."""
        return self.request("DELETE", "/api/cases/" + _seg(case_id))

    # ---- the simulated clock and jobs (https://www.simmail.dev/docs/api/clock/) ----

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

    def jobs(self, state: Optional[str] = None, limit: Optional[int] = None, *, persona: Optional[str] = None,
             kind: Optional[str] = None, due_before: Any = None, **more: Any) -> dict:
        """Planned work: {now, jobs} with Job objects. state (JobState), persona (id or address), kind (JobKind),
        due_before (a datetime, RFC 3339 or a duration such as "1h" from the simulated now) and limit narrow it."""
        r = self.request("GET", "/api/jobs", query={"state": state, "limit": limit, "persona": persona, "kind": kind,
                                                    "due_before": _time(due_before), **more})
        if isinstance(r, dict) and isinstance(r.get("jobs"), list):
            r = Answer({**r, "jobs": [Job.from_api(self, j) for j in r["jobs"]]}, request_id=getattr(r, "request_id", None))
        return r

    def run_due(self, persona: Optional[str] = None, kind: Optional[str] = None, before: Any = None,
                limit: Optional[int] = None) -> dict:
        """Runs the matching pending jobs now, in due order (before: only those due by then):
        {ran: [{id, kind, persona, state, note}], count, remaining}."""
        return self.request("POST", "/api/jobs/run-due", _clean({"persona": persona, "kind": kind, "before": _time(before),
                                                                 "limit": limit}))

    def run_job(self, job_id: int) -> Any:
        """Runs a pending job now."""
        return self.request("POST", f"/api/jobs/{_seg(job_id)}/run-now", {})

    def skip_job(self, job_id: int) -> Any:
        return self.request("POST", f"/api/jobs/{_seg(job_id)}/skip", {})

    def bounce_job(self, job_id: int) -> Any:
        """Turns a planned reply into a bounce and runs it now."""
        return self.request("POST", f"/api/jobs/{_seg(job_id)}/bounce", {})

    def reschedule_job(self, job_id: int, due: Optional[str] = None, in_: Optional[str] = None) -> Any:
        """due (a time) or in_ (such as "10m" from now)."""
        return self.request("PATCH", f"/api/jobs/{_seg(job_id)}", _clean({"due": due, "in": in_}))

    # ---- events (https://www.simmail.dev/docs/api/events/) ----

    def log(self, since: Optional[int] = None, limit: Optional[int] = None) -> List[Event]:
        """Events after a point, oldest first. Page with the last id as the next since."""
        r = self.request("GET", "/api/log", query={"since": since, "limit": limit})
        return [Event.from_api(self, e) for e in r] if isinstance(r, list) else r

    def events(self, since: Optional[int] = None, timeout: Optional[float] = None) -> Iterator[Event]:
        """The live event stream, as a generator of events. since replays up to 500 earlier events first.
        timeout (seconds) ends it when nothing arrives for that long; break out of the loop to stop."""
        with self._open("GET", "/api/events", query={"since": since}, accept="text/event-stream", timeout=timeout) as r:
            data: List[str] = []
            for raw in r:
                line = raw.decode(errors="replace").rstrip("\r\n")
                if line.startswith("data:"):
                    data.append(line[5:].lstrip())
                elif line == "" and data:
                    yield Event.from_api(self, json.loads("\n".join(data)))
                    data = []

    # ---- how the universe behaves (https://www.simmail.dev/docs/api/behaviour/) ----

    def ai(self) -> dict:
        """Whether people write with AI: {mode}."""
        return self.request("GET", "/api/ai")

    def set_ai(self, mode: str) -> dict:
        """AI writing "on" or "off" (AiMode). Member role."""
        return self.request("PUT", "/api/ai", {"mode": mode})

    def ai_budget(self) -> dict:
        """The server's daily AI budget, when it has one."""
        return self.request("GET", "/api/ai/budget")

    def pace(self) -> dict:
        """How fast people reply."""
        return self.request("GET", "/api/pace")

    def set_pace(self, factor: Optional[float] = None, ignore_hours: Optional[bool] = None) -> Any:
        """factor scales reply delays (0.1 is ten times faster); ignore_hours lets people reply at any hour."""
        return self.request("PUT", "/api/pace", _clean({"factor": factor, "ignore_hours": ignore_hours}))

    def recipients(self) -> dict:
        """Recipient rules: which addresses exist, which are bad, who is behind never-seen ones."""
        return self.request("GET", "/api/recipients")

    def set_recipients(self, rules: dict) -> dict:
        """Replaces the recipient rules. Admin role."""
        return self.request("PUT", "/api/recipients", rules)

    def links(self) -> dict:
        """The rules for people opening links: {policy, habits, default_user_agent}."""
        return self.request("GET", "/api/links")

    def set_links(self, policy: dict) -> Any:
        """Replaces the link policy (send every field). Admin role."""
        return self.request("PUT", "/api/links", policy)

    def retention(self) -> dict:
        """How long mail and events are kept, in simulated days."""
        return self.request("GET", "/api/retention")

    def set_retention(self, mail_days: Optional[int] = None, event_days: Optional[int] = None) -> Any:
        """0 keeps forever. Admin role."""
        return self.request("PUT", "/api/retention", _clean({"mail_days": mail_days, "event_days": event_days}))

    def prune_retention(self) -> dict:
        """Applies retention now."""
        return self.request("POST", "/api/retention/prune", {})

    def junk_settings(self) -> dict:
        """Spam & Junk settings: {settings, defaults}."""
        return self.request("GET", "/api/junk")

    def set_junk_settings(self, settings: dict) -> dict:
        """Replaces the Spam & Junk settings. Admin role."""
        return self.request("PUT", "/api/junk", settings)

    # ---- chaos and faults (https://www.simmail.dev/docs/api/faults/) ----

    def faults(self) -> list:
        """The universe's fault rules, in order."""
        return self.request("GET", "/api/faults")

    def set_faults(self, rules: List[dict]) -> list:
        """Replaces all fault rules ([] clears them). Admin role."""
        return self.request("PUT", "/api/faults", rules)

    def fault_scenarios(self) -> list:
        """The scenario library: ready-made rules from real providers."""
        return self.request("GET", "/api/faults/scenarios")

    def add_fault_scenario(self, scenario: str, match: Optional[str] = None, window: Optional[dict] = None) -> list:
        """Adds a scenario (FaultScenario) as an enabled rule. Admin role."""
        return self.request("POST", "/api/faults/scenarios/" + _seg(scenario), _clean({"match": match, "window": window}))

    # ---- inspection and insights (https://www.simmail.dev/docs/api/inspect/) ----

    def health(self, message_id: str) -> dict:
        """The health report of a message your app sent: spam score, links, compatibility."""
        return self.request("GET", "/api/inspect", query={"message_id": message_id})

    def insights(self, days: Optional[int] = None) -> dict:
        """The insights report for the last days of simulated time (1 to 366, default 30)."""
        return self.request("GET", "/api/insights", query={"days": days})

    def insight_shares(self) -> list:
        """The universe's shared reports."""
        return self.request("GET", "/api/insights/shares")

    def share_insights(self, title: Optional[str] = None, days: Optional[int] = None) -> dict:
        """Shares a report publicly: {token, path}."""
        return self.request("POST", "/api/insights/shares", _clean({"title": title, "days": days}))

    def revoke_insight_share(self, token: str) -> Any:
        """Revokes a shared report."""
        return self.request("DELETE", "/api/insights/shares/" + _seg(token))

    # ---- webhooks (https://www.simmail.dev/docs/api/webhooks/) ----

    def webhooks(self) -> list:
        """The webhooks (secrets shown as ••••)."""
        return self.request("GET", "/api/webhooks")

    def set_webhooks(self, hooks: List[dict]) -> list:
        """Replaces all webhooks ([] removes them). Send "••••" to keep a secret. Admin role."""
        return self.request("PUT", "/api/webhooks", hooks)

    # ---- the World (https://www.simmail.dev/docs/api/world/) ----

    def world(self) -> dict:
        """The company and its inbound streams: {world, kinds}."""
        return self.request("GET", "/api/world")

    def set_world(self, world: dict) -> dict:
        """Replaces the company and all streams: {company, streams}. Admin role."""
        return self.request("PUT", "/api/world", world)

    def send_from_stream(self, stream_id: str) -> dict:
        """Sends one email from a stream now."""
        return self.request("POST", f"/api/world/streams/{_seg(stream_id)}/send", {})
