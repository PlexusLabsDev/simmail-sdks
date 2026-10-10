# simmail (Python)

Wait for the email your app sends, pull out the code or link, and get replies from
simulated people. Standard library only; Python 3.9+.

```python
from simmail import Simmail

mail = Simmail()   # SIMMAIL_URL, SIMMAIL_API_KEY (Organization → API keys)

msg = mail.wait_for_email("new-user@example.test", subject="verify", timeout=20)
code = msg["codes"][0]           # or msg["magic_links"][0]

sent = mail.send("sales@acme.test", ["dana@harbor.test"], "Offer", text="Would you take 165k?")
reply = mail.wait_for_reply("dana@harbor.test", in_reply_to=sent["message_id"])
print(reply["text"])
```
