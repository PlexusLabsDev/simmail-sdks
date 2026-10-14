# @plexuslabs/simmail

The official JavaScript client for [simmail](https://www.simmail.dev): a simulated email
world for testing apps and email agents. Wait for the email your app sends, pull out the
code or link, and get replies from simulated people, in a few lines of test code.

No dependencies; Node 18 or newer (it uses `fetch`). Full docs: https://www.simmail.dev/docs/

```sh
npm install --save-dev @plexuslabs/simmail
```

## Setup

The client reads its settings from the environment (or pass them to `new Simmail({...})`):

| Variable | Meaning |
| --- | --- |
| `SIMMAIL_URL` | Your universe's server, such as `https://c1.simmail.dev` (shown on your account page). |
| `SIMMAIL_API_KEY` | An API key, `smk_…` (Organization → API keys). |
| `SIMMAIL_UNIVERSE` | Optional: only needed when the key could reach more than one universe. |

Your app sends through simmail's SMTP as usual (the dashboard's *Get started* shows the
settings); this client is for your tests.

## Wait for an email and use its code (Playwright)

```js
import { test, expect } from "@playwright/test";
import { Simmail } from "@plexuslabs/simmail";

const mail = new Simmail();

test("new users can verify their email", async ({ page }) => {
  const email = `user-${Date.now()}@yourcompany.test`;
  await page.goto("/signup");
  await page.fill("#email", email);

  const waiting = mail.waitForEmail({ to: email, subject: "verify", timeout: "20s" });
  await page.click("text=Create account");
  const msg = await waiting;

  expect(msg.codes).toHaveLength(1);
  await page.fill("#code", msg.codes[0]); // or: await page.goto(msg.magic_links[0])
});
```

Start the wait before the click: a wait only sees mail that arrives after it starts, unless
you pass `existing: true`.

## Read what is there

```js
const inbox = await mail.messages("user@yourcompany.test");          // newest first
const latest = await mail.message("user@yourcompany.test", "INBOX", inbox[0].uid);
const report = await mail.health(latest.message_id);                  // spam score, links, compatibility
```

## A conversation with a simulated person

```js
const sent = await mail.send({
  from: "sales@yourcompany.test",
  to: ["dana@harbor.test"],
  subject: "Offer",
  text: "Would you take 165k?",
});
const reply = await mail.waitForReply({ from: "dana@harbor.test", inReplyTo: sent.message_id });
console.log(reply.text);

await mail.advance("2d"); // move the simulated clock: follow-ups and nudges that were due happen
```

## Errors

A failed call throws `SimmailError` with the HTTP `status` and the server's message.

## License

Apache-2.0
