# Contributing to Gentle Office

Thanks for your interest in improving Gentle Office! This is a small, zero-dependency community project, and contributions of every size are welcome.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For bugs, open an issue with the bug report template. Include your OS, Node.js version and browser.
- For new features or larger changes, open a feature request first so we can agree on the approach before you write code.
- For usage questions and early ideas, use [Discussions](https://github.com/MataM15/gentle-office/discussions).
- Security problems must **not** be reported in public issues. Follow [SECURITY.md](SECURITY.md) instead.
- Small documentation fixes can be submitted directly as a PR; an issue is not mandatory for every typo.

## Issue triage and labels

You do not need to choose labels or assign a maintainer. The bug and feature forms request `bug` and `enhancement` automatically; the maintainer confirms the classification and applies other labels during triage.

| Label | Meaning |
| --- | --- |
| `bug` | Reported incorrect behavior; the label alone does not mean it is reproduced. |
| `enhancement` | Proposed feature or improvement; not an implementation commitment. |
| `documentation` | Documentation changes or missing instructions. |
| `help wanted` | A scoped contribution is welcome. |
| `good first issue` | A maintainer-scoped task suitable for a first contribution. |

Search existing issues before opening one. Include reproduction details for bugs and the problem you want to solve for features. The maintainer may ask for more information, link duplicates, or close out-of-scope proposals with an explanation. Labels indicate category or suitability, not priority or a release promise.

This is a volunteer-maintained project: triage and PR reviews are best-effort, with no guaranteed response time. Do not share real session transcripts, secrets or token-bearing office URLs.

## Development setup

You only need Node.js 22.13 or newer (see `.nvmrc`). There is nothing to install.

```sh
git clone https://github.com/MataM15/gentle-office.git
cd gentle-office
node --test 'test/*.test.mjs'
for f in src/*.mjs public/*.mjs; do node --check "$f"; done
```

The shell syntax-check loop above is for macOS/Linux/WSL. On native Windows, run `node --check <file>` for each `.mjs` file in `src/` and `public/`.

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
4. Link the related issue when one exists and explain the intended outcome. For larger features, agree on scope in an issue first. Open a draft PR when the work is not ready for review.

The maintainer reviews scope, correctness, privacy and tests before approving and merging. CI must pass; green CI alone is not approval. Contributors do not need to label or assign their PRs. Respond to review feedback in the same PR and keep unrelated work separate. Published tags are never rewritten.

## Releases

Follow the [maintainer release checklist](docs/releases.md) for versioning, release checks, draft GitHub Releases and explicit publication approval.

Keep `package.json`, `CHANGELOG.md` and the `vX.Y.Z` tag aligned. During `0.x`, patches contain compatible fixes; minor versions may introduce breaking changes and must document migration steps. Never rewrite a published tag.

The first release supports Pi only. OpenCode and registry distribution are follow-up work, not currently supported installation paths.
