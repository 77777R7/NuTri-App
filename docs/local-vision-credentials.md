# Local Vision Credentials

This guide is for local OCR development with Google Vision.

## Rules (Do Not Skip)

- Never commit `.env` files.
- Never commit service account JSON files.
- Do not keep service account JSON in iCloud/Dropbox/Drive synced folders.
- Use CI secrets for cloud environments; do not rely on local file paths in CI.

## Recommended Local Setup

1. Store the service account JSON in a local non-synced path, for example:
   - macOS: `~/secrets/nutri-app/gcp-vision-sa.json`
2. In `backend/.env` set one of:
   - `GOOGLE_APPLICATION_CREDENTIALS=/Users/<you>/secrets/nutri-app/gcp-vision-sa.json`
   - or `GOOGLE_VISION_SA_JSON=<json-content>`
3. Restart backend:

```bash
npm --prefix backend run dev
```

## Verify

Run OCR regression API replay against local backend:

```bash
node scripts/maintainer/ocr-regression-runner.mjs --mode e2e --api-base http://127.0.0.1:3001
```

## CI Notes

- CI should inject credentials via repository/environment secrets.
- If secret material is detected in tracked files, CI must fail.
