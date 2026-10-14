# simmail SDKs

Official clients for [simmail](https://www.simmail.dev), the simulated email world for
testing apps and email agents.

| Package | Install | Source |
| --- | --- | --- |
| JavaScript / TypeScript: `@plexuslabs/simmail` | `npm install --save-dev @plexuslabs/simmail` | [js/](js/) |
| Python: `simmail` | `pip install simmail` | [python/](python/) |

Both are thin, dependency-free wrappers over the [HTTP API](https://www.simmail.dev/docs/api/overview/):
wait for the email your app sends, pull out codes and magic links, read mailboxes, send,
wait for replies from simulated people, and move the simulated clock.

Releasing: see [RELEASING.md](RELEASING.md).

Apache-2.0
