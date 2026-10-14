# simmail (Python)

The official Python client for [simmail](https://www.simmail.dev): a simulated email world for
testing apps and email agents. Wait for the email your app sends, pull out the code or link, get
replies from simulated people, and drive the whole world: people, cases, the clock, the World's
inbound mail, faults, recipients and webhooks.

Standard library only; Python 3.9 or newer. Full docs: https://www.simmail.dev/docs/

```sh
pip install simmail
```

## Setup

The client reads its settings from the environment, or takes them in `Simmail(...)`:

| Variable | Meaning |
| --- | --- |
| `SIMMAIL_URL` | Your universe's server, such as `https://c1.simmail.dev` (shown on your account page). |
| `SIMMAIL_API_KEY` | An API key, `smk_…` (Organization → API keys). |
| `SIMMAIL_UNIVERSE` | Optional: only needed when the key can reach more than one universe. |

Your app sends through simmail's SMTP as usual (the dashboard's *Get started* shows the settings);
this client is for your tests and tools.

## Wait for an email and use its link (pytest)

```python
import time
from simmail import Simmail

mail = Simmail()

def test_password_reset(client):
    email = f"user-{int(time.time())}@yourcompany.test"
    client.post("/signup", data={"email": email, "password": "pw-123456789"})
    client.post("/forgot-password", data={"email": email})

    msg = mail.mailbox(email).wait_for_email(subject="reset", existing=True, timeout=20)
    assert msg.magic_links, msg.text
```

A wait only sees mail that arrives after it starts, unless you pass `existing=True`. Timeouts are
seconds, or a duration such as `"45s"` (at most five minutes).

## A fresh address per test

```python
import re

addr = mail.test_address(tag="signup")                 # such as t-k3x9q@inbox.test
client.post("/signup", data={"email": addr.address, "password": "pw-123456789"})

welcome = addr.wait_for_email(subject_regex=re.compile("welcome", re.I), timeout=20)
addr.expect_no_email(within=5, subject="verify")       # no second email
addr.cleanup()                                         # or mail.tag("signup").cleanup()
```

`wait_for_email` also takes several addresses or `*@domain`, `count` (wait for n emails), `since`,
`exclude`, `body_regex`, `header`, `has_attachment`, `attachment_name` and `link_domain`. When nothing
matches, the `WaitTimeoutError` lists what almost did and why (`near_misses`).

## Objects you can act on

Answers come back as dataclasses with typed fields and methods for what you do next:

```python
from simmail import Simmail, Folder

msg = mail.mailbox("app@yourcompany.test").wait_for_email(sender="dana@harbor.test")
msg.reply("Thanks, Dana. Tuesday works.")      # threaded, from the mailbox it is in
answer = msg.wait_for_reply()                  # Dana's next email in this thread
msg.mark_read()
msg.move(Folder.ARCHIVE)
report = msg.health()                          # for mail your app sent: spam score, links

for m in mail.mailbox("dana@harbor.test").messages(folder=Folder.JUNK):
    print(m.subject, m.is_read)
```

| Object | What it has |
| --- | --- |
| `Message` | `message_id`, `sender`, `to`, `subject`, `text`, `html`, `codes`, `magic_links`, `attachments`; `full()`, `reply()`, `wait_for_reply()`, `wait_until_quiet()`, `health()`, `source()`, `attachment(n)`, `mark_read()`, `move()` |
| `Mailbox` | `address`, counts; `wait_for_email()`, `messages()` (a generator), `list()`, `send()`, `inject()`, `folders()`, `threads()`, `set_status()` |
| `Persona` | the person's fields (`temperament` is a `Temperament`); `update()`, `pause()`, `remember()`, `memory()`, `relations()`, `jobs()`, `run_due()`, `wait_for()`, `wait_for_reply()`, `mailbox()` |
| `Case` | `people`, `story`; `push()`, `add_people()`, `initiate()`, `regenerate()`, `edit_story()` |
| `Job` | `kind`, `state`, `due`; `run()`, `skip()`, `bounce()`, `reschedule()` |
| `TestAddress` | a fresh address (a `Mailbox`); `wait_for_email()`, `expect_no_email()`, `list()`, `cleanup()` |
| `Conversation` | `messages`, `latest`; `wait_until_quiet()`, `reply()` |
| `SimEvent` | `kind` (an `EventType`), `data`, `persona_id`, `message_id`; `persona()` |
| `Account` | a login; `update()`, `test()`, `delete()` |

The API's `from` is `sender` (a keyword in Python). Every object still reads like the plain answer
(`msg["codes"]`, `msg.get("from")`, `dict(msg)`), and `.raw` / `.to_dict()` give it as it came.

## People, cases and the clock

```python
from simmail import Temperament, LinkHabit, JobKind, EventAlias

dana = mail.personas.create({
    "name": "Dana Reyes",
    "addresses": ["dana@harbor.test"],
    "temperament": Temperament.SKEPTICAL,
    "style": {"links": LinkHabit.WARY},
})

deal = mail.cases.push("deal-1701", {
    "title": "Sale of 1701 Clark Street",
    "people": [{"ref": "seller", "name": "Dana Reyes", "addresses": ["dana@harbor.test"]}],
})
deal.initiate(dana.id, "agent@yourcompany.test", intent="ask about the offer")

mail.clock.advance("2d")              # follow-ups and nudges that were due happen
dana.run_due(kind=JobKind.REPLY)      # or run her pending replies now

event = dana.wait_for(EventAlias.REPLIED, fast=True)   # or "declined", "clicked", "bounced"
talk = msg.wait_until_quiet(quiet=10)                  # the whole conversation, once it settles
print(len(talk.messages), talk.latest.subject)
```

## Chaos, recipients, webhooks and the World

```python
from simmail import FaultScenario, MailboxStatus, StreamKind, EventType

mail.faults.add(FaultScenario.GMAIL_RATE, match="@gmail.com")   # Gmail rate-limits you
mail.recipients.set_status("old-client@harbor.test", MailboxStatus.DISABLED)
mail.webhooks.set([{"url": "https://hooks.yourcompany.test/simmail", "events": [EventType.PERSONA_SENT, "link.*"]}])
mail.world.set({
    "company": {"name": "Acme Realty", "domain": "acme-realty.test"},
    "streams": [{"name": "Website leads", "kind": StreamKind.LEAD, "to": ["sales@acme-realty.test"], "per_day": 6, "enabled": True}],
})

for event in mail.events(since=0):       # the live stream
    if event.kind == EventType.PERSONA_SENT:
        break
```

Each group (`mail.personas`, `mail.cases`, `mail.clock`, `mail.jobs`, `mail.world`, `mail.faults`,
`mail.recipients`, `mail.webhooks`, `mail.insights`, `mail.events`, `mail.accounts`, `mail.inspect`,
`mail.behaviour`) has the calls for that part of the API. The 0.1.0 methods (`mail.clock()`,
`mail.advance("2d")`, `mail.wait_for_email(to)`, …) still work as before.

## Named values

Every setting with fixed choices is an enum: `Temperament`, `Knows`, `Life`, `Length`, `Formality`,
`MailClient`, `LinkHabit`, `SpamFilter`, `Access`, `Stance`, `MailboxStatus`, `BadKind`, `FailAt`,
`Stranger`, `Folder`, `AiMode`, `MissingSite`, `LocalLinks`, `Protocol`, `Role`, `PersonaSource`,
`StreamKind`, `FaultKind`, `FaultStage`, `FaultScenario`, `JobKind`, `JobState`, `StoryBy`,
`EventType`, `EventAlias`, `ErrorCode`. They are `str` enums equal to the API's strings
(`Temperament.SKEPTICAL == "skeptical"`), so the string works too. They are generated from the
server's `GET /api/schema`; each member has the words the dashboard shows
(`Temperament.SKEPTICAL.label`, `.description`), and `describe("Temperament", value)` labels a plain
string.

## What's covered

| Area | Calls |
| --- | --- |
| Waiting | `wait_for_email`, `expect_no_email`, `wait_for_reply`, `wait_for_event`, `wait_for_thread`, `extract` |
| Test addresses | `test_address`, `create_address`, `tag`, `list_messages`, `delete_messages` |
| Mail | `mailboxes`, `mailbox`, `folders`, `messages`, `message`, `raw_message`, `attachment`, `update_message`, `threads`, `set_mailbox_status`, `send`, `inject`, `signature`, `set_signature`, `rescue`, `retry` |
| Logins | `accounts`, `create_account`, `update_account`, `delete_account`, `test_account` |
| People | `personas`, `persona`, `create_persona`, `update_persona`, `delete_persona`, `persona_from_mail`, `temperaments`, `memory`, `add_memory`, `clear_memory`, `add_memory_by_external`, `relations`, `forget_relations` |
| Cases | `cases`, `get_case`, `push_case`, `add_case_people`, `initiate_case`, `regenerate_case`, `edit_case_story`, `delete_case` |
| Clock and jobs | `clock`, `advance`, `freeze`, `speed`, `live`, `jobs`, `run_due`, `run_job`, `skip_job`, `bounce_job`, `reschedule_job` |
| Events | `events` (live stream), `log` |
| Behaviour | `ai`, `set_ai`, `ai_budget`, `pace`, `set_pace`, `recipients`, `set_recipients`, `links`, `set_links`, `retention`, `set_retention`, `prune_retention`, `junk_settings`, `set_junk_settings` |
| Chaos | `faults`, `set_faults`, `fault_scenarios`, `add_fault_scenario` |
| Inspection | `health`, `insights`, `insight_shares`, `share_insights`, `revoke_insight_share` |
| Webhooks and the World | `webhooks`, `set_webhooks`, `world`, `set_world`, `send_from_stream` |
| Who and where | `me`, `universes`, `status`, `connection`, `connection_cert`, `schema` |

Anything else is one `mail.request(method, path, body, query)` call.

## Errors

A failed call raises a `SimmailError` with the HTTP `status`, the server's message, its `code` (an
`ErrorCode`) and `request_id`. The subclasses say which kind: `ValidationError` (400, with `field` and
`allowed`), `AuthError` (401), `PlanLimitError` (402), `ForbiddenError` (403), `NotFoundError` (404),
`WaitTimeoutError` (408, with `near_misses`), `ConflictError` (409, such as a person who decided not
to reply), `UnexpectedEmailError` (409, from `expect_no_email`, with the `email`), `IdempotencyError`
(422) and `RateLimitedError` (429, with `retry_after`).

Every `send` and `inject` carries its own Idempotency-Key, so the client can safely try a write
again: GETs and keyed writes are retried after a network error, 502 or 503 (`retries`, default 2),
and an answer the server had already given has `.replayed == True`. To follow a request in the
server's logs, use `mail.with_request_id("ci-1234")`.

```python
from simmail import WaitTimeoutError

try:
    mail.mailbox(email).wait_for_email(subject="verify", timeout=10)
except WaitTimeoutError as e:
    print("nothing arrived", e.near_misses)
```

## License

Apache-2.0
