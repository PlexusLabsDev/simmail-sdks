# Changelog

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
