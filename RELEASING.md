# Releasing

These files live in the simmail engine repo under `sdk/` and are published from a public
GitHub repo, **PlexusLabsDev/simmail-sdks**, whose root is this directory (the workflows in
`.github/workflows` assume that layout: `js/` and `python/` at the top).

Copy or update it from the engine repo with:

```sh
git subtree split --prefix=sdk -b sdk-export          # in the engine repo
git push git@github.com:PlexusLabsDev/simmail-sdks.git sdk-export:main
```

## One-time setup

**GitHub** (PlexusLabsDev/simmail-sdks → Settings → Environments): create two environments,
`npm` and `pypi`. Optionally require a reviewer on them, so a tag alone cannot publish.

**PyPI** (no token needed): pypi.org → your account → Publishing → *Add a new pending
publisher*: PyPI project name `simmail`, owner `PlexusLabsDev`, repository `simmail-sdks`,
workflow `release-python.yml`, environment `pypi`. The first tagged release creates the project.

**npm**: create the organization `plexuslabs` on npmjs.com (Add organization, free for
public packages). npm's trusted publishing is set per package, so the package must exist first:

1. Publish 0.1.0 once by hand from `js/`: `npm login`, then `npm publish --access public`.
2. npmjs.com → `@plexuslabs/simmail` → Settings → Trusted publishing → GitHub Actions:
   organization `PlexusLabsDev` (the GitHub one), repository `simmail-sdks`, workflow `release-js.yml`,
   environment `npm`.
3. Then, under Publishing access, choose *Require two-factor authentication and disallow
   tokens*, so only the workflow can publish.

## Each release

1. Bump the version (`js/package.json` or `python/pyproject.toml` and
   `python/simmail/__init__.py`) and add a CHANGELOG entry.
2. Tag and push: `git tag js-v0.1.1 && git push --tags` (or `py-v0.1.1`). The tag must match
   the version; the workflow checks.
