# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Installation, update, rollback, uninstall and troubleshooting guidance for the Pi integration.
- Synthetic demo video and storyboard with the approved orchestrator portrait.
- Maintainer release checklist and tag-triggered draft GitHub Release workflow with version and changelog validation.
- Issue triage labels, contributor/maintainer PR responsibilities and a Discussions route for usage questions.

### Changed

- Package metadata now links to the proposed GitHub repository and includes documentation assets.
- Public-preview scope is explicitly Pi-only; OpenCode remains planned follow-up work, with first-tagged-release installation checks still pending.

## [0.1.0] - 2026-09-30

### Added

- Live pixel-art office that follows the newest Pi session for a project, or a specific session file.
- Hub mode that shows up to eight registered Pi sessions on one page, with hot reload that keeps registrations.
- Pi extension with the `/office` and `/office restart` commands.
- "Always on top" compact window using Document Picture-in-Picture.
- Loopback-only server with a random capability token, strict security headers and a sanitized snapshot that never exports prompts, outputs or paths.
- Offline frame renderer and headless layout capture scripts for development.

[Unreleased]: https://github.com/MataM15/gentle-office/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MataM15/gentle-office/releases/tag/v0.1.0
