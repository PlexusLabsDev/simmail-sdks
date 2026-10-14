# simmail SDKs

Official clients for [simmail](https://www.simmail.dev), the simulated email world for
testing apps and email agents.

| Package | Install | Source |
| --- | --- | --- |
| JavaScript / TypeScript: `@plexuslabs/simmail` | `npm install --save-dev @plexuslabs/simmail` | [js/](js/) |
| Python: `simmail` | `pip install simmail` | [python/](python/) |

Both are dependency-free clients for the whole [HTTP API](https://www.simmail.dev/docs/api/overview/):
fresh test addresses, waits for the email your app sends (or for none), codes and magic links,
mailboxes, sending, replies and actions of simulated people, cases, the clock and jobs, the
World, faults, recipients, webhooks and inspection. Answers are objects with methods
(`msg.reply()`, `persona.waitFor("replied")`), and every setting with fixed choices has named
values.

## Named values

The enums of both SDKs are generated from the server's `GET /api/schema`, saved in
[schema.json](schema.json). After the API adds or changes a choice:

```sh
python3 tools/gen_enums.py --url https://c1.simmail.dev --save   # with SIMMAIL_API_KEY set
# or, from the saved schema.json:
python3 tools/gen_enums.py
```

It writes `js/enums.js`, `js/enums.d.ts` and `python/simmail/enums.py`; commit them with
`schema.json`. Enums the schema does not describe (folders, roles, error codes, event aliases) are
listed in the script.

Releasing: see [RELEASING.md](RELEASING.md).

Apache-2.0
