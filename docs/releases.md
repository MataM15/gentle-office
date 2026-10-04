# Release Gentle Office

Publish a tested Pi-only release from GitHub. Preparing documentation or running checks does **not** authorize publishing, pushing or creating a tag.

## Channels and version policy

| Channel | Intended use |
| --- | --- |
| Published `vX.Y.Z` tag with GitHub Release | Recommended user installation and upgrades. |
| Default branch | Development; may change between releases. |

Keep `package.json`, the dated `CHANGELOG.md` heading and the Git tag in agreement. During `0.x`, use patches for compatible fixes and minor versions for features or breaking changes. After `1.0`, breaking changes require a major version. Explain breaking changes and migration steps explicitly, including server/extension compatibility.

OpenCode support is future work, not a feature of the first Pi release. Registry distribution is also outside this release process.

## Before the first public release

- Confirm the destination repository and update every repository/support URL if it is not `MataM15/gentle-office`.
- Resolve the README's first-tagged-release checklist (tag-pinned installation, native Windows instructions and clean-checkout install/update checks), then update its early-preview notice and the security support policy when announcing a supported release.
- Confirm ownership and redistribution rights for code, artwork, likeness and third-party material. Permission to publish does not by itself imply official endorsement or replace license attribution.
- Retain the independent community-project disclaimer unless its wording is separately agreed.
- Review `LICENSE`, `SECURITY.md`, the Code of Conduct and contribution/issue templates.
- Check the README installation commands from a clean checkout and a saved Pi session.
- Check video and screenshots against the approved orchestrator portrait. Use synthetic activity, no private session logs or token-bearing URLs. Label an animation as an animation, not a live product recording.
- Confirm the intended release date. Existing historical changelog dates are not evidence of a published tag.

## Prepare a version locally

1. Work on a release branch with a clean baseline; preserve unrelated local changes.
2. Set the version in `package.json`. Move user-facing entries from `[Unreleased]` into a dated version heading in `CHANGELOG.md`; retain an empty `[Unreleased]` heading.
3. Document new requirements, migration, update and rollback restrictions. Review the release diff.
4. Run the checks from the repository root:

   ```sh
   pnpm test
   for f in src/*.mjs public/*.mjs; do node --check "$f"; done
   ```

   No dependency install is needed. The shell syntax loop is for macOS/Linux/WSL; on Windows check each file with `node --check <file>`.

5. Verify the media links and local documentation links. If checking package contents, use `pnpm pack --pack-destination /tmp` and inspect the archive without publishing it. This checks packaging, not registry installation or Pi integration.
6. Review privacy and security behavior. Do not claim tests are visual approval or an end-to-end user installation check.
7. Prepare a Conventional Commit such as `chore(release): vX.Y.Z`. Commit, push and tag only with the maintainer's authorization.

## Publish only after approval

A maintainer must authorize the target repository, exact version and commit before any remote mutation.

1. Merge the reviewed release preparation according to repository policy, with CI passing.
2. Create the annotated tag `vX.Y.Z` at that exact approved commit and push that tag.
3. The tag workflow validates the version, runs syntax checks and tests, and creates a **draft** GitHub Release. It never publishes a registry package or makes the draft public automatically.
4. Review the draft. Replace or supplement generated notes with the matching changelog section, installation/update instructions and any migration caveats. Confirm media links work at the release tag.
5. Publish the draft manually only after final approval.

If the workflow fails, inspect the actual result before retrying. Do not force-move an existing release tag. If a draft already exists, inspect it rather than blindly rerunning creation.

## After release

- Verify the public release URL, tag, version and notes agree.
- Test installation from the published tag and `/office` in a saved Pi session; record the tested OS/browser.
- Test updating from the previous supported release, `/office restart`, extension restart and rollback where applicable.
- Keep unreleased development work under `[Unreleased]`.
- For a bad release, document the issue and publish a new patch. Do not rewrite published tags.
