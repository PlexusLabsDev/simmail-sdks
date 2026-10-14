# simmail (Python)

The official Python client for [simmail](https://www.simmail.dev): a simulated email world
for testing apps and email agents. Wait for the email your app sends, pull out the code or
link, and get replies from simulated people, in a few lines of test code.

Standard library only; Python 3.9 or newer. Full docs: https://www.simmail.dev/docs/

```sh
pip install simmail
```

## Setup

The client reads its settings from the environment (or pass them to `Simmail(...)`):

| Variable | Meaning |
| --- | --- |
| `SIMMAIL_URL` | Your universe's server, such as `https://c1.simmail.dev` (shown on your account page). |
| `SIMMAIL_API_KEY` | An API key, `smk_…` (Organization → API keys). |
| `SIMMAIL_UNIVERSE` | Optional: only needed when the key could reach more than one universe. |

Your app sends through simmail's SMTP as usual (the dashboard's *Get started* shows the
settings); this client is for your tests. Results are plain dictionaries with the API's
field names.

## Wait for an email and use its link (pytest)

```python
import time
from simmail import Simmail

mail = Simmail()

def test_password_reset(client):
    email = f"user-{int(time.time())}@yourcompany.test"
    client.post("/signup", data={"email": email, "password": "pw-123456789"})
    client.post("/forgot-password", data={"email": email})

    msg = mail.wait_for_email(email, subject="reset", existing=True, timeout=20)
    assert msg["magic_links"], msg["text"]
```

A wait only sees mail that arrives after it starts, unless you pass `existing=True`.
Timeouts are seconds, or a duration such as `"45s"` (at most five minutes).

## Read what is there

```python
inbox = mail.messages("user@yourcompany.test")          # newest first
latest = mail.message("user@yourcompany.test", "INBOX", inbox[0]["uid"])
report = mail.health(latest["message_id"])              # spam score, links, compatibility
```

## A conversation with a simulated person

```python
sent = mail.send("sales@yourcompany.test", ["dana@harbor.test"], "Offer", text="Would you take 165k?")
reply = mail.wait_for_reply("dana@harbor.test", in_reply_to=sent["message_id"])
print(reply["text"])

mail.advance("2d")  # move the simulated clock: follow-ups and nudges that were due happen
```

## Errors

A failed call raises `SimmailError` with the HTTP `status` and the server's message.

## License

Apache-2.0
