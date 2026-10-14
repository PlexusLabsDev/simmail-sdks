# Changelog

## 0.1.1 (2026-10-14)

Covers the whole customer API, and adds an object layer on top of the plain calls.

- **Every endpoint**: mailboxes and folders, reading, raw messages and attachments, marking and moving,
  threads, injecting, signatures, rescue and retry; logins; people (memory, relations, learning from
  mail, temperaments); cases (people, initiate, regenerate, the story); jobs; the event log and the
  live event stream (`events()`, an async iterator); AI, pace, recipients, links, retention and Spam &
  Junk settings; faults and scenarios; inspection and insights; webhooks; the World; `universes`,
  `status` and connection details.
- **Objects**: `Message`, `Mailbox`, `Persona`, `Case`, `Job` and `Account`, with the API's fields,
  camelCase getters and methods (`msg.reply()`, `msg.waitForReply()`, `mailbox.waitForEmail()`,
  `persona.runDue()`, `deal.initiate()`, …). Waits and lists return them. They are supersets of the
  0.1.0 answers, so code reading `msg.magic_links` keeps working.
- **Groups**: `mail.personas`, `mail.cases`, `mail.clock`, `mail.jobs`, `mail.world`, `mail.faults`,
  `mail.recipients`, `mail.webhooks`, `mail.insights`, `mail.events`, `mail.accounts`, `mail.inspect`,
  `mail.behaviour`. Each is also callable as the 0.1.0 method of the same name.
- **Test addresses**: `mail.testAddress({ tag })` makes a fresh address (a `TestAddress` with
  `waitForEmail()`, `expectNoEmail()`, `list()` and `cleanup()`); `mail.tag(name)` works on every
  address with a tag; `listMessages` and `deleteMessages` across addresses.
- **Waits**: `waitForEmail` takes several addresses or `*@domain`, `tag`, `count` (waits for n),
  `since`, `exclude`, `subjectRegex`/`bodyRegex` (a RegExp works), `header`, `hasAttachment`,
  `attachmentName` and `linkDomain`; a timeout says what almost matched (`nearMisses`).
  `expectNoEmail` passes when nothing comes. `waitForEvent` (`persona.waitFor("replied")`) waits for
  something a person does; `waitForThread` (`msg.waitUntilQuiet()`) for a conversation to go quiet,
  as a `Conversation`.
- **Jobs**: filters (`persona`, `kind`, `dueBefore`, `limit`) and `runDue` (`mail.jobs.runDue()`,
  `persona.runDue()`), on the server.
- **Named values** for every setting with fixed choices (`Temperament`, `FaultScenario`,
  `MailboxStatus`, `EventType`, `EventAlias`, `ErrorCode`, …), each the API's plain string, generated
  from `GET /api/schema` (`sdk/tools/gen_enums.py`); `EnumInfo` and `describe()` give each value's
  label and description. `mail.schema()` returns the schema itself.
- **Errors by kind**, chosen by the server's error code: `ValidationError`, `AuthError`,
  `PlanLimitError`, `ForbiddenError`, `NotFoundError`, `WaitTimeoutError`, `ConflictError`,
  `UnexpectedEmailError`, `IdempotencyError`, `RateLimitedError`, all `SimmailError`, which carries
  `code`, `requestId`, `field`, `allowed` and `nearMisses`.
- **Safe retries**: every `send` and `inject` has its own Idempotency-Key (yours with
  `idempotencyKey`, none with `false`), and answers say `replayed`. GETs and keyed writes are tried
  again after a network error, 502 or 503 (`retries`, default 2). `mail.withRequestId(id)` sends your
  own request id; answers and errors carry `requestId`.

## 0.1.0

First release.

- `waitForEmail`, `waitForReply`: wait for the next email to an address, or a person's reply; codes and magic links already pulled out.
- `extract`: codes and links from any text or HTML.
- `mailboxes`, `messages`, `message`: what is in the universe's mailboxes.
- `send` (with `inReplyTo`), `health` (the inspection report).
- `accounts`, `createAccount`: your app's SMTP/IMAP logins.
- `personas`, `createPersona`, `pushCase`.
- `clock`, `advance`, `freeze`, `speed`, `live`.
- Settings from `SIMMAIL_URL`, `SIMMAIL_API_KEY`, `SIMMAIL_UNIVERSE`; errors as `SimmailError` with the HTTP status.
