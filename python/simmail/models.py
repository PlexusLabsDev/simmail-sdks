"""Resource objects: typed dataclasses with methods for what you do next.

Each keeps the answer as it came in ``.raw`` and still reads like it
(``msg["codes"]``, ``msg.get("magic_links")``, ``dict(msg)``), so code
written against plain answers keeps working. Fields with a fixed set of
values become enums when the value is known (and stay strings when not).
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, Iterator, List, Optional

from .enums import EventType, JobKind, JobState, Knows, Life, PersonaSource, StoryBy, Temperament

if TYPE_CHECKING:  # pragma: no cover
    from . import Simmail

__all__ = ["Answer", "Model", "Message", "Mailbox", "Persona", "Case", "Job", "Account", "SimEvent", "Conversation", "WaitMany",
           "TestAddress", "TagGroup"]


class Answer(dict):
    """A plain answer (a dict) that also says which request it was: ``request_id``, and ``replayed`` (True when
    a repeated Idempotency-Key found the work already done)."""

    def __init__(self, data: Any = (), request_id: Optional[str] = None, replayed: bool = False):
        super().__init__(data)
        self.request_id = request_id
        self.replayed = replayed


def _coerce(enum: Any, v: Any) -> Any:
    try:
        return enum(v) if v is not None else v
    except ValueError:
        return v  # a value this SDK does not know yet


@dataclass(eq=False)
class Model:
    raw: Dict[str, Any] = field(default_factory=dict, repr=False)
    _client: Any = field(default=None, repr=False)

    @classmethod
    def from_api(cls, client: "Simmail", data: Any, **ctx: Any):
        """Builds one from an API answer (anything that is not an object passes through)."""
        if not isinstance(data, dict):
            return data
        kw: Dict[str, Any] = {"raw": data, "_client": client}
        for f in dataclasses.fields(cls):
            if f.name in ("raw", "_client"):
                continue
            key = f.metadata.get("api", f.name)
            if key in data:
                v = data[key]
                enum = f.metadata.get("enum")
                kw[f.name] = [_coerce(enum, x) for x in v] if enum and isinstance(v, list) else _coerce(enum, v) if enum else v
            elif f.name in ctx and ctx[f.name] is not None:
                kw[f.name] = ctx[f.name]
        return cls(**kw)

    @property
    def client(self) -> "Simmail":
        return self._client

    # The plain answer, as 0.1.0 returned it.
    def __getitem__(self, key: str) -> Any:
        return self.raw[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.raw.get(key, default)

    def keys(self):
        return self.raw.keys()

    def items(self):
        return self.raw.items()

    def values(self):
        return self.raw.values()

    def __contains__(self, key: object) -> bool:
        return key in self.raw

    def __iter__(self) -> Iterator[str]:
        return iter(self.raw)

    def to_dict(self) -> Dict[str, Any]:
        """The answer as it came."""
        return dict(self.raw)


def _re(subject: str) -> str:
    return subject if subject.lower().startswith("re:") else "Re: " + subject


@dataclass(eq=False)
class Message(Model):
    """An email in a mailbox. From waits, lists and reads."""
    address: Optional[str] = None
    folder: Optional[str] = None
    uid: Optional[int] = None
    message_id: str = ""
    in_reply_to: Optional[str] = None
    references: List[str] = field(default_factory=list)
    sender: str = field(default="", metadata={"api": "from"})
    from_name: Optional[str] = None
    to: List[str] = field(default_factory=list)
    cc: List[str] = field(default_factory=list)
    subject: str = ""
    date: Optional[str] = None
    text: str = ""
    html: Optional[str] = None
    format: Optional[str] = None
    flags: List[str] = field(default_factory=list)
    time: Optional[str] = None
    size: Optional[int] = None
    attachments: List[Dict[str, Any]] = field(default_factory=list)
    headers: Dict[str, str] = field(default_factory=dict)
    links: List[str] = field(default_factory=list)
    codes: List[str] = field(default_factory=list)
    magic_links: List[str] = field(default_factory=list)
    by_persona: bool = False
    #: For wait results: how long the wait took, and what it looked for.
    waited_ms: Optional[int] = None
    matched: Optional[str] = None
    #: Set by full(): the HTML made safe to show, and the case the thread is linked to.
    safe: Optional[Dict[str, Any]] = None
    case: Optional[Dict[str, Any]] = None

    @property
    def is_read(self) -> bool:
        return "\\Seen" in self.flags

    def _where(self):
        if not self.address or not self.folder or self.uid is None:
            raise ValueError("this message does not say which mailbox, folder and uid it is in")
        return self.address, self.folder, self.uid

    def full(self, remote: bool = False, theme: Optional[str] = None) -> "Message":
        """The whole message (lists cut the text short), with .safe and .case."""
        return self.client.message(*self._where(), remote=remote, theme=theme)["message"]

    def source(self) -> str:
        """The original RFC 5322 source."""
        return self.client.raw_message(*self._where())

    def attachment(self, n: int) -> bytes:
        """Attachment number n (from 0), as bytes."""
        return self.client.attachment(*self._where(), n)

    def extract(self) -> dict:
        """Codes and links in this message, for messages that do not carry them."""
        return self.client.extract(self.text, self.html or "")

    def mark_read(self) -> Any:
        return self.client.update_message(*self._where(), seen=True)

    def mark_unread(self) -> Any:
        return self.client.update_message(*self._where(), seen=False)

    def move(self, folder: str) -> Any:
        """Moves it to another folder, as a mail client would."""
        return self.client.update_message(*self._where(), move_to=folder)

    def reply(self, text: str = "", html: str = "", *, cc: Optional[List[str]] = None, attachments: Optional[List[dict]] = None,
              sender: Optional[str] = None) -> dict:
        """Answers this message, threaded: from the mailbox it is in (or sender), to its sender."""
        refs = [*self.references, self.message_id]
        return self.client.send(sender or self.address or (self.to or [""])[0], [self.sender], _re(self.subject), text, html, cc=cc,
                                attachments=attachments, in_reply_to=self.message_id, references=[r for r in refs if r])

    def wait_for_reply(self, **opts: Any) -> "Message":
        """Waits for the reply to this message from its (first) recipient, or sender=…."""
        who = opts.pop("sender", None) or (self.to or [""])[0]
        return self.client.wait_for_reply(who, in_reply_to=self.message_id, **opts)

    def health(self) -> dict:
        """The health report of this message, when your app sent it."""
        return self.client.health(self.message_id)

    def wait_until_quiet(self, **opts: Any) -> "Conversation":
        """Its conversation, once nothing new has joined it for quiet= (default 10s)."""
        return self.client.wait_for_thread(self.message_id, **opts)


@dataclass(eq=False)
class Mailbox(Model):
    """A mailbox: your app's login or a person's address."""
    address: str = ""
    display_name: Optional[str] = None
    can_login: Optional[bool] = None
    unread: Optional[int] = None
    total: Optional[int] = None
    persona_id: Optional[str] = None
    #: The persona's name, for a person's mailbox.
    persona: Optional[str] = None

    def messages(self, folder: Optional[str] = None) -> Iterator[Message]:
        """Its messages in a folder (default INBOX), newest first."""
        yield from self.list(folder)

    def list(self, folder: Optional[str] = None) -> List[Message]:
        return self.client.messages(self.address, folder)

    def wait_for_email(self, **opts: Any) -> Message:
        """The next email to this address; the same options as Simmail.wait_for_email."""
        return self.client.wait_for_email(self.address, **opts)

    def folders(self) -> list:
        return self.client.folders(self.address)

    def threads(self) -> list:
        return self.client.threads(self.address)

    def set_status(self, status: str) -> Any:
        """Forces how this address behaves as a recipient (MailboxStatus)."""
        return self.client.set_mailbox_status(self.address, status)

    def send(self, to: List[str], subject: str, text: str = "", html: str = "", **opts: Any) -> dict:
        """Sends from this address."""
        return self.client.send(self.address, to, subject, text, html, **opts)

    def inject(self, **msg: Any) -> Any:
        """Files a message straight into this mailbox, skipping SMTP."""
        return self.client.inject(self.address, **msg)

    def signature(self) -> dict:
        return self.client.signature(self.address)

    def set_signature(self, signature: str) -> Any:
        return self.client.set_signature(self.address, signature)

    def get_persona(self) -> Optional["Persona"]:
        """The persona behind this address, if any."""
        return self.client.persona(self.persona_id) if self.persona_id else None


@dataclass(eq=False)
class Persona(Model):
    """A simulated person."""
    id: str = ""
    name: str = ""
    addresses: List[str] = field(default_factory=list)
    role: Optional[str] = None
    org: Optional[str] = None
    who: Optional[str] = None
    wants: Optional[str] = None
    character: Optional[str] = None
    knows: Optional[Knows] = field(default=None, metadata={"enum": Knows})
    temperament: Optional[Temperament] = field(default=None, metadata={"enum": Temperament})
    life: Optional[Life] = field(default=None, metadata={"enum": Life})
    case_ids: List[str] = field(default_factory=list)
    style: Dict[str, Any] = field(default_factory=dict)
    timing: Dict[str, Any] = field(default_factory=dict)
    behaviors: Dict[str, Any] = field(default_factory=dict)
    external_ids: Dict[str, str] = field(default_factory=dict)
    paused: bool = False
    provider: Optional[PersonaSource] = field(default=None, metadata={"enum": PersonaSource})
    created: Optional[str] = None

    @property
    def address(self) -> str:
        """The address they write from."""
        return self.addresses[0] if self.addresses else ""

    def refresh(self) -> "Persona":
        return self.client.persona(self.id)

    def update(self, changes: Optional[dict] = None, **more: Any) -> "Persona":
        """Changes only what you send (a nested object you send replaces that whole object)."""
        return self.client.update_persona(self.id, {**(changes or {}), **more})

    def delete(self) -> Any:
        return self.client.delete_persona(self.id)

    def pause(self) -> "Persona":
        return self.update(paused=True)

    def resume(self) -> "Persona":
        return self.update(paused=False)

    def mailbox(self) -> Mailbox:
        return self.client.mailbox(self.address)

    def wait_for_reply(self, **opts: Any) -> Message:
        """The next email this person sends (fast: write their due reply now)."""
        return self.client.wait_for_reply(self.address, **opts)

    def memory(self) -> dict:
        return self.client.memory(self.id)

    def remember(self, text: str, case_id: Optional[str] = None, source: Optional[str] = None) -> Any:
        """Tells them something."""
        return self.client.add_memory(self.id, text, case_id=case_id, source=source)

    def forget_memory(self, case_id: Optional[str] = None) -> Any:
        return self.client.clear_memory(self.id, case_id=case_id)

    def relations(self) -> dict:
        return self.client.relations(self.id)

    def forget(self, address: Optional[str] = None) -> Any:
        """Forgets one correspondent, or everyone."""
        return self.client.forget_relations(self.id, address=address)

    def jobs(self, state: Optional[str] = None, **filters: Any) -> List["Job"]:
        """Their planned work (state, kind, due_before, limit)."""
        return [j for j in self.client.jobs(state=state, persona=self.id, **filters)["jobs"] if j.persona_id in (None, self.id)]

    def run_due(self, kind: Optional[str] = None, before: Any = None, limit: Optional[int] = None) -> dict:
        """Runs their pending jobs now: {ran, count, remaining}."""
        return self.client.run_due(persona=self.id, kind=kind, before=before, limit=limit)

    def wait_for(self, type: Any, **opts: Any) -> "SimEvent":  # noqa: A002
        """Waits until they do something: an EventType or EventAlias such as "replied", "declined", "clicked" or
        "bounced" (or a list). opts: message_id, after, fast, timeout."""
        return self.client.wait_for_event(type, persona=self.id, **opts)


@dataclass(eq=False)
class Case(Model):
    """A matter your system pushed: the people in it and what is really true."""
    id: str = ""
    title: Optional[str] = None
    kind: Optional[str] = None
    facts: Dict[str, Any] = field(default_factory=dict)
    known: Dict[str, Any] = field(default_factory=dict)
    people: List[Dict[str, Any]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    directions: Optional[str] = None
    story: Optional[str] = None
    amendments: List[str] = field(default_factory=list)
    story_by: Optional[StoryBy] = field(default=None, metadata={"enum": StoryBy})
    created: Optional[str] = None
    updated: Optional[str] = None

    def refresh(self, redact: bool = False) -> "Case":
        return self.client.get_case(self.id, redact=redact)

    def push(self, update: dict) -> "Case":
        """Pushes more of what your system knows; it merges."""
        return self.client.push_case(self.id, update)

    def add_people(self, people: List[dict]) -> "Case":
        return self.client.add_case_people(self.id, people)

    def initiate(self, persona: str, to: Any, intent: Optional[str] = None, after: Optional[str] = None) -> dict:
        """Has a person start a new thread."""
        return self.client.initiate_case(self.id, persona, to, intent=intent, after=after)

    def regenerate(self) -> "Case":
        return self.client.regenerate_case(self.id)

    def edit_story(self, story: Optional[str] = None, amendments: Optional[List[str]] = None, directions: Optional[str] = None) -> "Case":
        return self.client.edit_case_story(self.id, story=story, amendments=amendments, directions=directions)

    def delete(self) -> Any:
        return self.client.delete_case(self.id)


@dataclass(eq=False)
class Job(Model):
    """Something planned for later: a reply, a follow-up, a nudge."""
    id: int = 0
    state: Optional[JobState] = field(default=None, metadata={"enum": JobState})
    due: Optional[str] = None
    ran: Optional[str] = None
    created: Optional[str] = None
    kind: Optional[JobKind] = field(default=None, metadata={"enum": JobKind})
    persona_id: Optional[str] = None
    persona: Optional[str] = None
    case_id: Optional[str] = None
    to: List[str] = field(default_factory=list)
    plan: Optional[str] = None
    note: Optional[str] = None
    inbound: Optional[Dict[str, Any]] = None

    @property
    def is_pending(self) -> bool:
        return self.state == JobState.PENDING

    def run(self) -> Any:
        return self.client.run_job(self.id)

    def skip(self) -> Any:
        return self.client.skip_job(self.id)

    def bounce(self) -> Any:
        """Turns a planned reply into a bounce, now."""
        return self.client.bounce_job(self.id)

    def reschedule(self, due: Optional[str] = None, in_: Optional[str] = None) -> Any:
        """due (a time) or in_ (such as "10m" from now)."""
        return self.client.reschedule_job(self.id, due=due, in_=in_)


@dataclass(eq=False)
class Account(Model):
    """A login your app sends and reads with."""
    address: str = ""
    display_name: Optional[str] = None
    password: Optional[str] = field(default=None, repr=False)
    username: Optional[str] = None
    allow_smtp: Optional[bool] = None
    allow_imap: Optional[bool] = None
    disabled: Optional[bool] = None
    note: Optional[str] = None
    messages: Optional[int] = None

    def update(self, **changes: Any) -> Any:
        return self.client.update_account(self.address, **changes)

    def delete(self) -> Any:
        return self.client.delete_account(self.address)

    def test(self, password: Optional[str] = None, username: Optional[str] = None, proto: Optional[str] = None) -> dict:
        return self.client.test_account(self.address, password=password, username=username, proto=proto)

    def mailbox(self) -> Mailbox:
        return self.client.mailbox(self.address)


@dataclass(eq=False)
class SimEvent(Model):
    """Something that happened in the universe."""
    id: int = 0
    at: Optional[str] = None
    kind: Optional[EventType] = field(default=None, metadata={"enum": EventType})
    data: Dict[str, Any] = field(default_factory=dict)
    #: For wait_for_event: how long it took.
    waited_ms: Optional[int] = None

    @property
    def persona_id(self) -> Optional[str]:
        return self.data.get("persona_id")

    @property
    def message_id(self) -> Optional[str]:
        return self.data.get("message_id")

    @property
    def case_id(self) -> Optional[str]:
        return self.data.get("case_id")

    def persona(self) -> Optional[Persona]:
        """The persona it is about, when it is about one."""
        return self.client.persona(self.persona_id) if self.persona_id else None


@dataclass(eq=False)
class WaitMany(Model):
    """What wait_for_email(count=n) found."""
    messages: List[Message] = field(default_factory=list)
    count: int = 0
    waited_ms: Optional[int] = None
    matched: Optional[str] = None

    @classmethod
    def from_api(cls, client: Any, data: Any, **ctx: Any):
        out = super().from_api(client, data, **ctx)
        if isinstance(out, WaitMany):
            out.messages = [Message.from_api(client, m) for m in out.messages]
        return out


@dataclass(eq=False)
class Conversation(Model):
    """A conversation: its messages, oldest first. From wait_for_thread."""
    thread: str = ""
    messages: List[Message] = field(default_factory=list)
    count: int = 0
    quiet_ms: Optional[int] = None
    waited_ms: Optional[int] = None

    @classmethod
    def from_api(cls, client: Any, data: Any, **ctx: Any):
        out = super().from_api(client, data, **ctx)
        if isinstance(out, Conversation):
            out.messages = [Message.from_api(client, m) for m in out.messages]
        return out

    @property
    def root(self) -> str:
        """The id of its first message."""
        return self.thread

    @property
    def latest(self) -> Optional[Message]:
        """Its newest message."""
        return self.messages[-1] if self.messages else None

    def wait_until_quiet(self, **opts: Any) -> "Conversation":
        """Waits again, until nothing new has joined it for quiet=."""
        return self.client.wait_for_thread(thread=self.thread, **opts)

    def reply(self, text: str = "", html: str = "", **opts: Any) -> dict:
        """Answers its newest message (Message.reply options)."""
        if not self.latest:
            raise ValueError("this conversation has no messages")
        return self.latest.reply(text, html, **opts)


@dataclass(eq=False)
class TestAddress(Mailbox):
    """A fresh address made for one test, from test_address()."""
    __test__ = False  # not a pytest test class
    tag: str = ""

    def list(self, folder: Optional[str] = None, limit: Optional[int] = None) -> List[Message]:  # noqa: A003
        return self.client.list_messages(to=self.address, folder=folder, limit=limit)

    def expect_no_email(self, **opts: Any) -> dict:
        """Passes when nothing reaches it within= (default 5s); the same filters as wait_for_email."""
        return self.client.expect_no_email(self.address, **opts)

    def cleanup(self, folder: Optional[str] = None) -> dict:
        """Deletes its mail (every folder, or one)."""
        return self.client.delete_messages(to=self.address, folder=folder)

    def __str__(self) -> str:
        return self.address


class TagGroup:
    """Every address made with one tag. From mail.tag(name)."""
    __test__ = False

    def __init__(self, client: Any, tag: str):
        self.client = client
        self.tag = tag

    def __repr__(self) -> str:
        return f"TagGroup({self.tag!r})"

    def new_address(self, domain: Optional[str] = None, prefix: Optional[str] = None) -> TestAddress:
        """Another address with this tag."""
        return self.client.test_address(domain, prefix, self.tag)

    def wait_for_email(self, **opts: Any) -> Any:
        """The next email to any of its addresses (wait_for_email options, such as count=)."""
        return self.client.wait_for_email(tag=self.tag, **opts)

    def expect_no_email(self, **opts: Any) -> dict:
        return self.client.expect_no_email(tag=self.tag, **opts)

    def messages(self, folder: Optional[str] = None, limit: Optional[int] = None) -> List[Message]:
        """Their messages, newest first."""
        return self.client.list_messages(tag=self.tag, folder=folder, limit=limit)

    def cleanup(self, folder: Optional[str] = None) -> dict:
        """Deletes their mail (every folder, or one)."""
        return self.client.delete_messages(tag=self.tag, folder=folder)
