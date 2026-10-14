# Changelog

## 0.1.1 (2026-10-14)

Covers the whole customer API, and adds an object layer on top of the plain calls.

- **Every endpoint**: mailboxes and folders, reading, raw messages and attachments, marking and moving,
  threads, injecting, signatures, rescue and retry; logins; people (memory, relations, learning from
  mail, temperaments); cases (people, initiate, regenerate, the story); jobs; the event log and the
  live event stream (`events()`, a generator); AI, pace, recipients, links, retention and Spam &
  Junk settings; faults and scenarios; inspection and insights; webhooks; the World; `universes`,
  `status` and connection details.
- **Objects**: `Message`, `Mailbox`, `Persona`, `Case`, `Job` and `Account`, with the API's fields,
  typed fields (dataclasses) and methods (`msg.reply()`, `msg.wait_for_reply()`,
  `mailbox.wait_for_email()`, `persona.run_due()`, `deal.initiate()`, …). Waits and lists return them. They are supersets of the
  0.1.0 answers, and still read like dictionaries (`msg["codes"]`), so 0.1.0 code keeps working.
- **Groups**: `mail.personas`, `mail.cases`, `mail.clock`, `mail.jobs`, `mail.world`, `mail.faults`,
  `mail.recipients`, `mail.webhooks`, `mail.insights`, `mail.events`, `mail.accounts`, `mail.inspect`,
  `mail.behaviour`. Each is also callable as the 0.1.0 method of the same name.
- **Test addresses**: `mail.test_address(tag=…)` makes a fresh address (a `TestAddress` with
  `wait_for_email()`, `expect_no_email()`, `list()` and `cleanup()`); `mail.tag(name)` works on every
  address with a tag; `list_messages` and `delete_messages` across addresses.
- **Waits**: `wait_for_email` takes several addresses or `*@domain`, `tag`, `count` (waits for n, as a
  `WaitMany`), `since`, `exclude`, `subject_regex`/`body_regex` (a compiled `re` works), `header`,
  `has_attachment`, `attachment_name` and `link_domain`; a timeout says what almost matched
  (`near_misses`). `expect_no_email` passes when nothing comes. `wait_for_event`
  (`persona.wait_for("replied")`) waits for something a person does; `wait_for_thread`
  (`msg.wait_until_quiet()`) for a conversation to go quiet, as a `Conversation`.
- **Jobs**: filters (`persona`, `kind`, `due_before`, `limit`) and `run_due` (`mail.jobs.run_due()`,
  `persona.run_due()`), on the server.
- **Named values** for every setting with fixed choices (`Temperament`, `FaultScenario`,
  `MailboxStatus`, `EventType`, `EventAlias`, `ErrorCode`, …), `str` enums equal to the API's strings,
  generated from `GET /api/schema` (`sdk/tools/gen_enums.py`); each member has `label`,
  `description` and `feature`, and `describe()` labels a plain value. `mail.schema()` returns the
  schema itself.
- **Errors by kind**, chosen by the server's error code: `ValidationError`, `AuthError`,
  `PlanLimitError`, `ForbiddenError`, `NotFoundError`, `WaitTimeoutError`, `ConflictError`,
  `UnexpectedEmailError`, `IdempotencyError`, `RateLimitedError`, all `SimmailError`, which carries
  `code`, `request_id`, `field`, `allowed` and `near_misses`.
- **Safe retries**: every `send` and `inject` has its own Idempotency-Key (yours with
  `idempotency_key`, none with `False`), and answers say `.replayed`. GETs and keyed writes are tried
  again after a network error, 502 or 503 (`retries`, default 2). `mail.with_request_id(id)` sends
  your own request id; answers (`Answer`, a dict) and errors carry `request_id`.

## 0.1.0

First release.

- `wait_for_email`, `wait_for_reply`: wait for the next email to an address, or a person's reply; codes and magic links already pulled out.
- `extract`: codes and links from any text or HTML.
- `mailboxes`, `messages`, `message`: what is in the universe's mailboxes.
- `send` (with `in_reply_to`), `health` (the inspection report).
- `accounts`, `create_account`: your app's SMTP/IMAP logins.
- `personas`, `create_persona`, `push_case`.
- `clock`, `advance`, `freeze`, `speed`, `live`.
- Settings from `SIMMAIL_URL`, `SIMMAIL_API_KEY`, `SIMMAIL_UNIVERSE`; errors as `SimmailError` with the HTTP status.
