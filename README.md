# Gentle Office

A live pixel-art office for your Pi coding-agent sessions: watch the orchestrator and its subagents walk, read, type and deliver results in real time.

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>

> **Community project.** Gentle Office is an independent, community-made tool. It is **not** an official Gentleman Programming product and is not affiliated with or endorsed by Gentleman Programming.

> Screenshots will live in [`docs/assets/`](docs/assets/). None are published yet.

## Features

- **Live office scene.** The main Pi agent sits at the orchestrator desk; subagents map to Scout, Writer and Verifier desks.
- **Honest activity.** Tool calls become gestures (reading, searching, running commands, editing, reviewing, memory trips). Results are shown only when the session log proves them; anything else stays "Unconfirmed".
- **Hub mode.** One page shows up to eight Pi sessions side by side.
- **Pi extension.** `/office` registers the current session with the hub and opens a window.
- **Always on top.** A compact Document Picture-in-Picture window keeps the office visible.
- **Private by design.** Loopback only, random capability token, and a sanitized snapshot that never includes prompts, outputs or file paths.
- **Zero dependencies.** Plain Node.js 22 and a browser. Nothing to install.

## Requirements

- Node.js 22 or newer (tests need 22.13+).
- A Chromium-based browser (Chrome or Edge 116+) for the "Always on top" window. Other browsers show the office without it.
- The Pi coding agent (`@earendil-works/pi-coding-agent`), with sessions saved under `~/.pi/agent/sessions/`.

## Quick start

```sh
git clone https://github.com/MataM15/gentle-office.git ~/gentle-office
cd ~/gentle-office
node src/server.mjs --cwd /path/to/your/project
```

The server prints one URL such as `http://127.0.0.1:43127/?token=…`. Open it in your browser. Stop the server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

Options:

| Flag | Meaning |
| --- | --- |
| `--cwd <dir>` | Project whose newest Pi session is followed (default: current directory). |
| `--session <file.jsonl>` | Follow exactly this session file. |
| `--port <n>` | Listen on a fixed port (default: random). |
| `--hub` | Start an empty multi-session hub (see below). |
| `--exit-when-empty` | Hub only: exit ten seconds after the last registered session leaves. |

Without `--session`, the server picks the most recently modified `.jsonl` file in `~/.pi/agent/sessions/<encoded cwd>/` and polls it every 400 ms. The encoded directory for `/home/user/projects` is `--home-user-projects--`.

## Hub mode

```sh
node src/server.mjs --hub --port 8787 --exit-when-empty
```

The hub starts empty and waits for sessions to register (the Pi extension does this for you). It writes its URL to `~/.local/state/gentle-office/hub.json` (directory `0700`, file `0600`) so other sessions can find it, and removes that file when it exits.

Local API (every request needs the `?token=…` from the URL and a loopback `Host` header):

- `POST /sessions` with `{"file", "cwd", "owner"}`: absolute path to an existing `.jsonl` inside `~/.pi/agent/sessions`, the project directory, and the owner PID. Returns `{"id"}`. Registering the same file again keeps its ID.
- `DELETE /sessions/<id>`: `204` when removed, `404` when unknown.
- `GET /events`: Server-Sent Events with `{"offices": [...]}` snapshots.
- `GET /control/status` and `POST /control/restart`: version check and hot reload that keeps every registration.

Sessions whose owner process has exited are dropped automatically.

## Pi extension

The extension adds the `/office` command to Pi.

1. Clone this repository to `~/gentle-office`, or anywhere else and set `GENTLE_OFFICE_DIR` to that path in the environment Pi runs in.
2. Link or copy the extension into Pi's global extensions directory:

   ```sh
   mkdir -p ~/.pi/agent/extensions
   ln -s ~/gentle-office/extensions/pi/gentle-office.ts ~/.pi/agent/extensions/gentle-office.ts
   ```

3. Restart Pi and run `/office` in any saved session.

| Command | What it does |
| --- | --- |
| `/office` | Starts the hub if needed, registers this session and opens a window. Running it again opens another window. |
| `/office restart` | Hot-reloads the hub after you update the checkout, without stopping Pi or dropping sessions. |

On WSL the extension opens a Microsoft Edge app window. On macOS it uses `open`, and on Linux `xdg-open`.

## How it works

```text
~/.pi/agent/sessions/*.jsonl ──tail──▶ src/status.mjs ──snapshot──▶ src/server.mjs ──SSE──▶ public/ (canvas scene)
                                                                        ▲
                                    extensions/pi/gentle-office.ts ─────┘  (registers sessions in hub mode)
```

- `src/status.mjs` tails the JSONL log incrementally. It handles partial lines, appends, truncation and file replacement, and turns messages into a small state machine.
- `src/server.mjs` serves the page, assets and an SSE stream on `127.0.0.1`.
- `public/office_scene.mjs` draws the office on a 640×432 canvas and plans every walk. `public/app.mjs` connects the stream to one scene per session.

Agents whose name contains `explor` or `scout` become Scout, names containing `verify` become Verifier, and everything else becomes Writer.

## Privacy & security model

- **Loopback only.** The server binds to `127.0.0.1` and rejects any `Host` header other than `127.0.0.1:<port>` or `localhost:<port>`.
- **Capability token.** A random 192-bit token is required on every request, including assets and SSE. Treat the URL like a password.
- **Hardened responses.** `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a strict Content Security Policy.
- **Bounded input.** Registrations are capped at 4 KiB and eight sessions. Session paths are resolved with `realpath` and must stay inside the sessions directory.

What the browser receives:

- The project directory's base name (never the full path).
- Activity labels and tool kinds from a closed list, counters, timestamps and roles.
- A short summary of each delegated task: the first sentence, cut to 60 characters, with paths reduced to base names and common secret patterns masked. This is best-effort, not a guarantee of anonymization.

What is never exported: prompts, assistant replies, tool arguments or outputs, session file paths, owner PIDs, original tool-call IDs and arbitrary agent names.

The page's only remote request is the "Built with Gentle-AI" badge image from `raw.githubusercontent.com`, sent without a referrer.

See [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

## Limitations

- Detection is retrospective. Pi writes complete messages to the JSONL log, so there is no token streaming. A process that dies without logging a result may leave a task looking active.
- Background subagents with unrecognized result formats stay "Unconfirmed" and are never shown as successful.
- Rewrites of old history with an identical size are not detected. Only the last bytes read are checked.
- "Always on top" needs Document Picture-in-Picture. Without it the button is disabled.
- Hub mode shows at most eight sessions.
- Day-to-day use has mainly been on WSL with Microsoft Edge. macOS and native Linux window opening are untested.

## Development

No install step: clone and run.

```sh
node --test 'test/*.test.mjs'                 # full test suite (node:test)
for f in src/*.mjs public/*.mjs; do node --check "$f"; done
node scripts/render-frames.mjs                # offline PNG frames -> .test-output/movement-frames/
CHROMIUM_PATH=/path/to/chrome node scripts/capture-layout.mjs   # headless screenshots -> .test-output/layout-browser/
```

Tests and scripts only write synthetic data under `.test-output/` (ignored by Git). They never read your real sessions or browser profile.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commits and the release process.

## Versioning

Gentle Office follows [Semantic Versioning](https://semver.org/). Changes are recorded in [CHANGELOG.md](CHANGELOG.md) using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and commits use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## License

[MIT](LICENSE) © 2026 MataM15

## Español

Gentle Office es una oficina en pixel art que muestra en vivo tus sesiones del agente de programación Pi: el orquestador y sus subagentes caminan, leen, escriben y entregan resultados mientras trabajan. Requiere Node.js 22 y no tiene dependencias. Clona el repositorio en `~/gentle-office` (o define `GENTLE_OFFICE_DIR`) y ejecuta `node src/server.mjs --cwd /ruta/al/proyecto`. Para usarlo desde Pi, enlaza `extensions/pi/gentle-office.ts` en `~/.pi/agent/extensions/` y usa `/office`. El servidor solo escucha en `127.0.0.1`, exige un token aleatorio y nunca exporta prompts, respuestas ni rutas. Es un proyecto comunitario, no oficial ni afiliado a Gentleman Programming. La documentación completa está en inglés.
