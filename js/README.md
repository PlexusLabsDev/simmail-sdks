# @plexuslabs/simmail

Wait for the email your app sends, pull out the code or link, and get replies from
simulated people — in a few lines of test code. No dependencies; Node 18+.

```sh
npm install @plexuslabs/simmail
export SIMMAIL_URL=https://app.simmail.dev SIMMAIL_API_KEY=smk_…   # Organization → API keys
```

## Sign-up flow (Playwright)

```js
import { test, expect } from "@playwright/test";
import { Simmail } from "@plexuslabs/simmail";

const mail = new Simmail();

test("new users can verify their email", async ({ page }) => {
  const email = `user-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill("#email", email);
  await page.click("text=Create account");

  const msg = await mail.waitForEmail({ to: email, subject: "verify", timeout: 20000 });
  expect(msg.codes).toHaveLength(1);
  await page.fill("#code", msg.codes[0]);          // or: await page.goto(msg.magic_links[0])
});
```

## A conversation

```js
const sent = await mail.send({ from: "sales@acme.test", to: ["dana@harbor.test"], subject: "Offer", text: "Would you take 165k?" });
const reply = await mail.waitForReply({ from: "dana@harbor.test", inReplyTo: sent.message_id }); // fast-forwards her delay
console.log(reply.text);
```

Your app normally sends through simmail's SMTP; `waitForEmail` then catches what it sent,
and `waitForReply` what the person wrote back.
