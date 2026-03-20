# Personalization Artifacts

## Goal Navigator Candidate Bundle

- File: `goal_navigator_candidate_bundle.v1.json`
- Purpose: prebuilt catalog candidate bundle for Goal Navigator so runtime can score prepared products without rebuilding the overlay bundle on every request.
- Runtime loader: `backend/src/personalization/goalNavigatorBundleArtifact.ts`
- Build command: `npm run personalization:build-goal-bundle`
- Scheduled refresh: `.github/workflows/goal-navigator-bundle-nightly.yml`

The nightly workflow rebuilds the bundle, uploads the generated JSON as a GitHub Actions artifact, and commits the refreshed file back to the default branch only when the bundle content changes.
