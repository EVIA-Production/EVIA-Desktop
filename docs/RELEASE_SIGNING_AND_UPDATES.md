# Desktop Signing + Auto-Update Setup

This desktop app publishes signed artifacts and update metadata to a release-only GitHub repo.

## Release trigger

- Push a tag like `v1.0.5`
- Workflow: `.github/workflows/release-desktop.yml`

## Required GitHub Actions secrets

- `RELEASE_REPO_GH_TOKEN` (token with release write access to release-only repo)
- `RELEASE_REPO_OWNER`
- `RELEASE_REPO_NAME`

### macOS signing/notarization

- `MAC_CODESIGN_IDENTITY`
- `MAC_CSC_LINK` (base64 or file URL to `.p12`)
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_ID_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

### Windows signing

- `WIN_CSC_LINK` (base64 or file URL to `.pfx`)
- `WIN_CSC_KEY_PASSWORD`

## Config files involved

- `electron-builder.yml` (publish + signing + notarization hooks)
- `scripts/afterPack.js` (binary signing helper)
- `scripts/notarize.js` (Apple notarization)
- `src/main/main.ts` (`electron-updater` check/download/install flow)

## Local test notes

- Unsigned local builds still run; CI/release should include cert secrets.
- Auto-update checks are disabled in development mode and enabled in production builds.