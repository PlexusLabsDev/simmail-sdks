# Changelog

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
