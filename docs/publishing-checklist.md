# ScrollSnap Publishing Checklist

## Pre-submit Checks

- Load the unpacked extension locally.
- Test capture on a normal webpage.
- Confirm first frame downloads immediately.
- Confirm scrolling downloads additional frames.
- Confirm files go to `Chrome Downloads/ScrollSnap/{sessionFolder}`.
- Confirm no `images` subfolder is created.
- Confirm `manifest.json` downloads on stop.
- Confirm `report.md` downloads on stop.
- Confirm the popup shows the save path.
- Confirm the session library works.
- Confirm delete from library does not delete downloaded files.
- Confirm restricted Chrome pages fail gracefully.
- Confirm no console errors in the normal flow.
- Confirm no remote network calls.
- Confirm permissions are minimal.
- Confirm `README.md`, `PRIVACY.md`, `STORE_LISTING.md`, and `docs/permissions.md` are updated.

## Package Checks

- `manifest.json` is at the root of the ZIP.
- Do not include `.git`.
- Do not include `node_modules` unless build output requires it.
- Do not include local screenshots from testing.
- Do not include secrets.
- Do not include unnecessary development files.
