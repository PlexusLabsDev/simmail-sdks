# @plexuslabs/simmail

The official JavaScript and TypeScript client for [simmail](https://www.simmail.dev): a simulated email
world for testing apps and email agents. Wait for the email your app sends, pull out the code or
link, get replies from simulated people, and drive the whole world: people, cases, the clock, the
World's inbound mail, faults, recipients and webhooks.

No dependencies; Node 18 or newer. Full docs: https://www.simmail.dev/docs/

```sh
npm install --save-dev @plexuslabs/simmail
```

## Setup

The client reads its settings from the environment, or takes them in `new Simmail({...})`:

| Variable | Meaning |
| --- | --- |
| `SIMMAIL_URL` | Your universe's server, such as `https://c1.simmail.dev` (shown on your account page). |
| `SIMMAIL_API_KEY` | An API key, `smk_…` (Organization → API keys). |
| `SIMMAIL_UNIVERSE` | Optional: only needed when the key can reach more than one universe. |

Your app sends through simmail's SMTP as usual (the dashboard's *Get started* shows the settings);
this client is for your tests and tools.

## Wait for an email and use its code (Playwright)

```js
import { test, expect } from "@playwright/test";
import { Simmail } from "@plexuslabs/simmail";

const mail = new Simmail();

test("new users can verify their email", async ({ page }) => {
  const email = `user-${Date.now()}@yourcompany.test`;
  await page.goto("/signup");
  await page.fill("#email", email);

  const waiting = mail.mailbox(email).waitForEmail({ subject: "verify", timeout: "20s" });
  await page.click("text=Create account");
  const msg = await waiting;

  expect(msg.codes).toHaveLength(1);
  await page.fill("#code", msg.codes[0]); // or: await page.goto(msg.magicLinks[0])
});
```

Start the wait before the click: a wait only sees mail that arrives after it starts, unless you
pass `existing: true`.

## A fresh address per test

```js
const addr = await mail.testAddress({ tag: "signup" });       // such as t-k3x9q@inbox.test
await page.fill("#email", addr.address);
await page.click("text=Create account");

const welcome = await addr.waitForEmail({ subjectRegex: /welcome/i, timeout: "20s" });
await addr.expectNoEmail({ within: "5s", subject: "verify" }); // no second email
await addr.cleanup();                                          // or mail.tag("signup").cleanup()
```

`waitForEmail` also takes several addresses or `*@domain`, `count` (wait for n emails), `since`,
`exclude`, `bodyRegex`, `header`, `hasAttachment`, `attachmentName` and `linkDomain`. When nothing
matches, the `WaitTimeoutError` lists what almost did and why (`nearMisses`).

## Objects you can act on

Answers come back as objects with the API's fields and methods for what you do next:

```js
import { Simmail, Folder } from "@plexuslabs/simmail";

const msg = await mail.mailbox("app@yourcompany.test").waitForEmail({ from: "dana@harbor.test" });
await msg.reply({ text: "Thanks, Dana. Tuesday works." });   // threaded, from the mailbox it is in
const answer = await msg.waitForReply();                     // Dana's next email in this thread
await msg.markRead();
await msg.move(Folder.Archive);
const report = await msg.health();                            // for mail your app sent: spam score, links

for await (const m of mail.mailbox("dana@harbor.test").messages({ folder: Folder.Junk })) {
  console.log(m.subject, m.isRead);
}
```

| Object | What it has |
| --- | --- |
| `Message` | `messageId`, `from`, `to`, `subject`, `text`, `html`, `codes`, `magicLinks`, `attachments`; `full()`, `reply()`, `waitForReply()`, `waitUntilQuiet()`, `health()`, `source()`, `attachment(n)`, `markRead()`, `move()` |
| `Mailbox` | `address`, counts; `waitForEmail()`, `messages()` (async iterator), `list()`, `send()`, `inject()`, `folders()`, `threads()`, `setStatus()` |
| `Persona` | the person's fields; `update()`, `pause()`, `remember()`, `memory()`, `relations()`, `jobs()`, `runDue()`, `waitFor()`, `waitForReply()`, `mailbox()` |
| `Case` | `people`, `story`; `push()`, `addPeople()`, `initiate()`, `regenerate()`, `editStory()` |
| `Job` | `kind`, `state`, `due`; `run()`, `skip()`, `bounce()`, `reschedule()` |
| `TestAddress` | a fresh address (a `Mailbox`); `waitForEmail()`, `expectNoEmail()`, `list()`, `cleanup()` |
| `Conversation` | `messages`, `latest`; `waitUntilQuiet()`, `reply()` |
| `SimEvent` | `kind`, `data`, `personaId`, `messageId`; `persona()` |
| `Account` | a login; `update()`, `test()`, `delete()` |

Every object still has the API's own field names (`msg.message_id`, `msg.magic_links`), `.raw`
for the answer as it came, and serialises to it with `JSON.stringify`.

## People, cases and the clock

```js
import { Simmail, Temperament, LinkHabit, JobKind, EventAlias } from "@plexuslabs/simmail";

const dana = await mail.personas.create({
  name: "Dana Reyes",
  addresses: ["dana@harbor.test"],
  temperament: Temperament.Skeptical,
  style: { links: LinkHabit.Wary },
});

const deal = await mail.cases.push("deal-1701", {
  title: "Sale of 1701 Clark Street",
  people: [{ ref: "seller", name: "Dana Reyes", addresses: ["dana@harbor.test"] }],
});
await deal.initiate({ persona: dana.id, to: "agent@yourcompany.test", intent: "ask about the offer" });

await mail.clock.advance("2d");                    // follow-ups and nudges that were due happen
await dana.runDue({ kind: JobKind.Reply });        // or run her pending replies now

const sent = await dana.waitFor(EventAlias.Replied, { fast: true });   // or "declined", "clicked", "bounced"
const talk = await msg.waitUntilQuiet({ quiet: "10s" });               // the whole conversation, once it settles
console.log(talk.messages.length, talk.latest.subject);
```

## Chaos, recipients, webhooks and the World

```js
import { FaultScenario, MailboxStatus, StreamKind, EventType } from "@plexuslabs/simmail";

await mail.faults.add(FaultScenario.GmailRate, { match: "@gmail.com" });  // Gmail rate-limits you
await mail.recipients.setStatus("old-client@harbor.test", MailboxStatus.Disabled);
await mail.webhooks.set([{ url: "https://hooks.yourcompany.test/simmail", events: [EventType.PersonaSent, "link.*"] }]);
await mail.world.set({
  company: { name: "Acme Realty", domain: "acme-realty.test" },
  streams: [{ name: "Website leads", kind: StreamKind.Lead, to: ["sales@acme-realty.test"], per_day: 6, enabled: true }],
});

for await (const event of mail.events({ since: 0 })) {   // the live stream
  if (event.kind === EventType.PersonaSent) break;
}
```

Each group (`mail.personas`, `mail.cases`, `mail.clock`, `mail.jobs`, `mail.world`, `mail.faults`,
`mail.recipients`, `mail.webhooks`, `mail.insights`, `mail.events`, `mail.accounts`, `mail.inspect`,
`mail.behaviour`) has the calls for that part of the API. The 0.1.0 methods (`mail.clock()`,
`mail.advance("2d")`, `mail.waitForEmail({ to })`, …) still work as before.

## Named values

Every setting with fixed choices has named constants: `Temperament`, `Knows`, `Life`, `Length`,
`Formality`, `MailClient`, `LinkHabit`, `SpamFilter`, `Access`, `Stance`, `MailboxStatus`, `BadKind`,
`FailAt`, `Stranger`, `Folder`, `AiMode`, `MissingSite`, `LocalLinks`, `Protocol`, `Role`,
`PersonaSource`, `StreamKind`, `FaultKind`, `FaultStage`, `FaultScenario`, `JobKind`, `JobState`,
`StoryBy`, `EventType`, `EventAlias`, `ErrorCode`. Each is the API's plain string
(`Temperament.Skeptical === "skeptical"`), so the string works too. They are generated from the
server's `GET /api/schema`; `EnumInfo.Temperament.skeptical.description` and
`describe("Temperament", value)` give the words the dashboard shows.

## What's covered

| Area | Calls |
| --- | --- |
| Waiting | `waitForEmail`, `expectNoEmail`, `waitForReply`, `waitForEvent`, `waitForThread`, `extract` |
| Test addresses | `testAddress`, `createAddress`, `tag`, `listMessages`, `deleteMessages` |
| Mail | `mailboxes`, `mailbox`, `folders`, `messages`, `message`, `rawMessage`, `attachment`, `updateMessage`, `threads`, `setMailboxStatus`, `send`, `inject`, `signature`, `setSignature`, `rescue`, `retry` |
| Logins | `accounts`, `createAccount`, `updateAccount`, `deleteAccount`, `testAccount` |
| People | `personas`, `persona`, `createPersona`, `updatePersona`, `deletePersona`, `personaFromMail`, `temperaments`, `memory`, `addMemory`, `clearMemory`, `addMemoryByExternal`, `relations`, `forgetRelations` |
| Cases | `cases`, `getCase`, `pushCase`, `addCasePeople`, `initiateCase`, `regenerateCase`, `editCaseStory`, `deleteCase` |
| Clock and jobs | `clock`, `advance`, `freeze`, `speed`, `live`, `jobs`, `runDue`, `runJob`, `skipJob`, `bounceJob`, `rescheduleJob` |
| Events | `events` (live stream), `log` |
| Behaviour | `ai`, `setAi`, `aiBudget`, `pace`, `setPace`, `recipients`, `setRecipients`, `links`, `setLinks`, `retention`, `setRetention`, `pruneRetention`, `junkSettings`, `setJunkSettings` |
| Chaos | `faults`, `setFaults`, `faultScenarios`, `addFaultScenario` |
| Inspection | `health`, `insights`, `insightShares`, `shareInsights`, `revokeInsightShare` |
| Webhooks and the World | `webhooks`, `setWebhooks`, `world`, `setWorld`, `sendFromStream` |
| Who and where | `me`, `universes`, `status`, `connection`, `connectionCert`, `schema` |

Anything else is one `mail.request(method, path, body, query)` call.

## Errors

A failed call throws a `SimmailError` with the HTTP `status`, the server's message, its `code` (an
`ErrorCode`) and `requestId`. The subclasses say which kind: `ValidationError` (400, with `field` and
`allowed`), `AuthError` (401), `PlanLimitError` (402), `ForbiddenError` (403), `NotFoundError` (404),
`WaitTimeoutError` (408, with `nearMisses`), `ConflictError` (409, such as a person who decided not
to reply), `UnexpectedEmailError` (409, from `expectNoEmail`, with the `email`), `IdempotencyError`
(422) and `RateLimitedError` (429, with `retryAfter`).

Every `send` and `inject` carries its own Idempotency-Key, so the client can safely try a write
again: GETs and keyed writes are retried after a network error, 502 or 503 (`retries`, default 2),
and an answer the server had already given says `replayed: true`. To follow a request in the
server's logs, use `mail.withRequestId("ci-1234")`.

```js
import { WaitTimeoutError } from "@plexuslabs/simmail";

try {
  await mail.mailbox(email).waitForEmail({ subject: "verify", timeout: "10s" });
} catch (e) {
  if (e instanceof WaitTimeoutError) console.log("nothing arrived", e.nearMisses);
  else throw e;
}
```

## License

Apache-2.0
