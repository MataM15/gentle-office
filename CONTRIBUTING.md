# Contributing to Gentle Office

Thanks for your interest in improving Gentle Office! This is a small, zero-dependency community project, and contributions of every size are welcome.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For bugs, open an issue with the bug report template. Include your OS, Node.js version and browser.
- For new features or larger changes, open a feature request first so we can agree on the approach before you write code.
- Security problems must **not** be reported in public issues. Follow [SECURITY.md](SECURITY.md) instead.

## Development setup

You only need Node.js 22.13 or newer (see `.nvmrc`). There is nothing to install.

```sh
git clone https://github.com/MataM15/gentle-office.git
cd gentle-office
node --test 'test/*.test.mjs'
for f in src/*.mjs public/*.mjs; do node --check "$f"; done
```

Run the server against a project with `node src/server.mjs --cwd /path/to/project`, or start an empty hub with `node src/server.mjs --hub`.

## Ground rules

- **Zero dependencies.** Do not add runtime or development dependencies. Use Node.js built-ins and browser APIs.
- **Privacy first.** Nothing that reaches the browser may contain prompts, assistant replies, tool arguments, tool outputs or full paths. New snapshot fields need a test that proves they are sanitized.
- **Loopback only.** Keep the server bound to `127.0.0.1` and keep the token, `Host` checks and security headers intact.
- **Synthetic tests.** Tests must only read files from this repository and write synthetic data under `.test-output/`. Never read real session logs, browser profiles or files from your home directory.
- **English.** Code, comments, UI strings and documentation are written in English.
- **Focused changes.** Keep pull requests small and on topic. Avoid unrelated refactors and formatting churn.

## Tests

Every behavior change needs a test in `test/`, grouped by area:

| File | Covers |
| --- | --- |
| `test/status.test.mjs` | JSONL tailing and the activity state machine (`src/status.mjs`). |
| `test/server.test.mjs` | HTTP server, hub API, SSE and hot reload (`src/server.mjs`). |
| `test/scene.test.mjs` | Office geometry, walking routes and animation (`public/office_scene.mjs`). |
| `test/layout.test.mjs` | Page layout helpers (`public/layout.mjs`). |
| `test/app.test.mjs` | Browser app wiring (`public/app.mjs`). |
| `test/extension.test.mjs` | Pi extension (`extensions/pi/gentle-office.ts`). |

Shared synthetic fixtures live in `test/helpers/fixtures.mjs`.

## Commits and branches

- Branch from `main` with a short descriptive name, for example `fix/sse-reconnect` or `feat/hub-limit`.
- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `ci:`, `chore:`. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.
- Each commit should leave the test suite passing.
- Add a line to the `[Unreleased]` section of [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Pull requests

1. Make sure `node --test 'test/*.test.mjs'` and `node --check` pass locally. CI runs both.
2. Fill in the pull request template, including how you tested the change.
3. For visual changes, attach a screenshot or short recording taken from a synthetic session.

## Releases

Maintainers cut releases following [Semantic Versioning](https://semver.org/):

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new version heading with the release date.
2. Bump `version` in `package.json`.
3. Commit with `chore(release): vX.Y.Z`, tag `vX.Y.Z` and publish a GitHub release with the changelog notes.
