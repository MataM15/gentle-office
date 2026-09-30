# Security Policy

## Supported versions

Gentle Office is pre-1.0. Only the latest released version receives security fixes.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1 | No |

## Reporting a vulnerability

Please **do not** open a public issue, discussion or pull request for security problems.

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Include:

- The affected version or commit.
- Steps to reproduce, ideally with synthetic session data.
- The impact you observed or expect.

This is a volunteer project, so response times are best-effort. We aim to acknowledge reports within 7 days, agree on a fix and disclosure timeline with you, and credit you in the advisory unless you prefer otherwise.

## Threat model

Gentle Office reads local Pi session logs, which can contain prompts, source code, command output and secrets. Its main job is to show activity **without** leaking that content.

### Assets

- The contents of `~/.pi/agent/sessions/*.jsonl` (prompts, replies, tool arguments and outputs).
- Local file paths and project names.
- The capability token in the office URL.

### Trust boundaries and mitigations

| Threat | Mitigation |
| --- | --- |
| Another machine on the network connects to the server. | The server binds to `127.0.0.1` only. |
| A malicious web page in your browser calls the local server (CSRF, cross-origin reads). | Every request, including assets and SSE, needs a random 192-bit token that the page cannot guess. |
| DNS rebinding makes a remote site look same-origin. | Requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` are rejected. |
| Session content leaks into the browser. | The snapshot is built from a closed list of activity labels and counters. Prompts, replies, tool arguments, outputs, full paths, PIDs, tool-call IDs and arbitrary agent names are never exported. |
| Task summaries leak secrets or paths. | Summaries are cut to one short sentence, paths are reduced to base names and common secret patterns are masked. This is best-effort. |
| A hub registration points at an arbitrary file. | Registered paths are resolved with `realpath` and must be existing `.jsonl` files inside the Pi sessions directory. Bodies are capped at 4 KiB and the hub holds at most eight sessions. |
| Injected scripts or framing in the page. | Strict Content Security Policy, `frame-ancestors 'none'`, `nosniff`, `no-referrer` and `no-store` headers. |
| Other local users read the hub URL. | The hub state file is written with directory mode `0700` and file mode `0600`. |

### Out of scope

- Attackers who already run code as your user. They can read the session logs directly.
- Browser extensions with access to all pages, which can read the token from the URL.
- Sharing the office URL or screenshots that show it. Treat the URL like a password.
- The "Built with Gentle-AI" badge, which the page loads from `raw.githubusercontent.com` without a referrer.
