# ScrollSnap

ScrollSnap is a Manifest V3 Chrome extension that turns a scroll session into a clean local set of screenshot frames. It captures the visible tab as you scroll, saves frames automatically into Chrome Downloads, keeps session metadata locally in IndexedDB, and lets you export Markdown, ZIP, or PDF without using any backend service.

## What ScrollSnap Does

- Starts a manual capture session for the active tab
- Captures the first visible frame immediately
- Captures additional frames as you scroll by a configurable viewport interval
- Saves captured PNGs automatically to Chrome Downloads
- Saves session metadata locally in IndexedDB
- Organizes captures in a session library
- Lets you review, rename, delete, and export sessions

## Key Features In v0.2

- Local session library with preview thumbnails
- Automatic PNG saving to `Chrome Downloads/ScrollSnap/{sessionFolder}`
- IndexedDB storage for session metadata and review data
- Smart frame filenames like `linkedinjo_001_20260428-164233.png`
- Markdown export as the primary export option
- ZIP export with `manifest.json`
- Simple PDF export with one screenshot per page
- First-run onboarding and privacy messaging
- Local-only settings for capture interval, duplicate skipping, and max frame count

## Project Structure

```text
src/
  background.js
  contentScript.js
  manifest.json
  popup.html
  popup.js
  review.html
  review.js
  styles.css
  icons/
    icon.svg
    icon16.png
    icon32.png
    icon48.png
    icon128.png
  lib/
    data.js
    db.js
    naming.js
    pdf.js
    zip.js
```

## Install Locally

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select the `src/` folder from this project

## How To Use

1. Open a normal webpage or browser-rendered document
2. Click the ScrollSnap extension icon
3. Click `Start Capture`
4. Scroll naturally
5. Click `Stop Capture`
6. Watch frames save into `Chrome Downloads/ScrollSnap/{sessionFolder}`
7. Click `Open Session Library`
8. Open the saved session or export Markdown, ZIP, or PDF

Default save location:

- `Chrome Downloads/ScrollSnap/{sessionFolder}`
- To save to Desktop instead, change `Chrome Settings → Downloads → Location → Desktop`

## Where Files Are Saved

- Captured PNGs save automatically to `Chrome Downloads/ScrollSnap/{sessionFolder}`
- `manifest.json` and `report.md` save into the same session folder when capture stops
- The session folder uses smart naming
- Files are stored flat inside the session folder with no `images/` subfolder

## Export Formats

### Markdown

Downloads a ZIP package with:

- `{sessionFolder}/report.md`
- `{sessionFolder}/{filename}.png`

The report includes session metadata plus a section for each captured frame.

### ZIP

Downloads a ZIP package with:

- `{sessionFolder}/{filename}.png`
- `{sessionFolder}/manifest.json`
- `{sessionFolder}/report.md`

The manifest includes session metadata and per-frame metadata.

### PDF

Downloads a simple PDF with:

- One screenshot per page
- Session title and source URL at the top
- Frame number and timestamp below each screenshot

## Privacy

ScrollSnap does not use a backend, analytics, tracking, or cloud sync. Captured screenshots save directly into Chrome Downloads and are never uploaded anywhere.

Additional privacy notes:

- Screenshots are only captured after the user starts a session
- The extension only captures the active tab during an active session
- Sessions can be deleted anytime from the library
- Deleting a session from ScrollSnap does not delete downloaded files
- Nothing is uploaded or shared automatically

## Permissions

ScrollSnap uses the minimum permissions needed for the current feature set:

- `activeTab`
  Required so the extension can capture the page the user explicitly invoked it on.
- `tabs`
  Used to read active tab metadata and window context.
- `storage`
  Used for small local settings and lightweight extension state.
- `downloads`
  Used to save captured PNGs, `manifest.json`, `report.md`, and Markdown/ZIP/PDF exports locally.
- `scripting`
  Used to inject the content script into the active tab after user action.

Notes:

- ScrollSnap does not request host permissions like `<all_urls>` in v0.2.
- Sessions and lightweight review metadata are stored in IndexedDB, which is local browser storage.
- A plain-English permission explanation is available in [docs/permissions.md](docs/permissions.md).

## Settings

The popup includes local-only settings for:

- Capture interval: `50%`, `80%`, or `100%` viewport
- Export image format: `PNG`
- Max frames per session: default `100`
- Duplicate skipping: on/off

## Known Limitations

- Captures only the visible browser tab viewport
- Does not capture native Mac apps
- Some Chrome internal pages cannot be captured
- Chrome may ask to allow multiple downloads
- Chrome Downloads location controls where files are saved
- Deleting a session from the ScrollSnap library does not delete downloaded files
- Sticky headers may appear repeatedly
- Very long captures may use browser storage
- Dynamic content may change during capture

## Error Handling

The extension includes simple user-facing errors for:

- Restricted pages Chrome will not capture
- Missing active tab
- IndexedDB or storage failures
- No frames available to export
- Export failures on large sessions

## Publishing Checklist

- Load the unpacked extension from `src/`
- Confirm onboarding appears on first open
- Start capture on a normal webpage
- Verify the first frame captures immediately
- Scroll enough to capture multiple frames
- Stop capture and confirm the session appears in the library
- Rename a session
- Delete a frame from a session detail page
- Start capture and confirm the first frame downloads immediately as a PNG
- Scroll and confirm additional PNGs download into `Chrome Downloads/ScrollSnap/{sessionFolder}`
- Stop capture and confirm `manifest.json` and `report.md` download into the same session folder
- Export Markdown and confirm the ZIP contains a flat session folder with `report.md` plus PNGs
- Export ZIP and confirm the ZIP contains a flat session folder with `manifest.json`, `report.md`, and PNGs
- Export PDF and confirm one screenshot per page
- Confirm `icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png` load in Chrome

## Chrome Web Store Packaging

There is no separate build step for ScrollSnap right now. Package the extension manually from the `src/` directory.

Manual packaging steps:

1. Verify the extension works by loading `src/` unpacked in Chrome.
2. Create a clean staging folder that contains only the contents of `src/`.
3. Zip the contents of that staging folder so `manifest.json` is at the root of the ZIP.
4. Do not include `.git`, local testing screenshots, secrets, or other development-only files.

Supporting publication documents:

- [PRIVACY.md](PRIVACY.md)
- [STORE_LISTING.md](STORE_LISTING.md)
- [docs/permissions.md](docs/permissions.md)
- [docs/store-assets-checklist.md](docs/store-assets-checklist.md)
- [docs/publishing-checklist.md](docs/publishing-checklist.md)

## Development Notes

- Capture flow is coordinated by the Manifest V3 service worker
- Scroll observation is handled by the content script
- Sessions are tracked locally in IndexedDB while full-size PNGs are saved immediately through Chrome Downloads
- Export packaging is handled locally in the extension pages
