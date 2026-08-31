# Fork Governance

## Canonical Product Line

- Canonical repository: `https://github.com/franksong2702/codex-mobile-web-public`
- Canonical branch: `main`
- Optional upstream reference: `https://github.com/pentiumxp/codex-mobile-web-public`

The canonical `main` branch follows this product's requirements and release
decisions. It is not required to merge upstream `main`, and no automation may
merge, reset, rebase, push, or publish upstream changes on its behalf.

## Local Remote Contract

Maintainer checkouts should use:

```text
origin   -> franksong2702/codex-mobile-web-public
upstream -> pentiumxp/codex-mobile-web-public
main     -> origin/main
```

`CODEX_MOBILE_UPDATE_REMOTE` defaults to `origin`, and
`CODEX_MOBILE_UPDATE_BRANCH` defaults to `main`. A production checkout must
read back those values and its Git remote before self-update is enabled.

## Upstream Intake

Upstream is reference-only. A change may enter the canonical branch only after
all of the following are true:

1. The change solves a current product, compatibility, or security need.
2. The exact upstream commits and local adaptation are reviewed.
3. Generated frontend artifacts are rebuilt locally instead of accepted
   blindly from an upstream diff.
4. Focused tests and the repository verification gates pass.
5. Deployment and public push remain separately authorized.

Prefer a reviewed cherry-pick or a locally adapted commit over a broad periodic
merge. Record the imported commit ids and any deliberate behavior differences
in the change description.

## Release And Automation

- Runtime PR and release checks default to
  `franksong2702/codex-mobile-web-public`.
- CI on the canonical `main` branch is the release source check.
- Public pushes, deployments, restarts, and PR closure require explicit owner
  authorization and their existing validation gates.
- The legacy private/public PR absorption workflow is optional. Its private
  repository must be configured explicitly before use and does not change the
  canonical product line.

## Public Repository Boundary

The repository is public. Do not commit access keys, tokens, private prompts,
session content, device credentials, household addresses, runtime databases,
audio, uploads, logs, or machine-specific secret paths. Device-specific BOX
and M13 configuration belongs in its private runtime or owning gateway project;
Codex Mobile contains only generic, authenticated integration contracts.

The project remains MIT licensed. Preserve the root `LICENSE` and bundled
third-party license notices when copying or distributing the software.

## Verification

Before treating a checkout as canonical, verify:

```bash
git remote -v
git branch -vv
git status --short
npm test
npm run check
npm run check:macos
npm run check:frontend-manifest
git diff --check
```

Do not switch a live checkout to a stale fork branch. First publish and verify
the intended canonical commit, then change remote tracking and runtime update
configuration as a separate, reversible operation.
