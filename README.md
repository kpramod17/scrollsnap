# ScrollSnap

ScrollSnap is a Manifest V3 Chrome extension MVP that captures ordered viewport screenshots while you manually scroll through a webpage. Everything runs locally inside the extension. Screenshots are stored only in browser extension storage until you clear or export the session.

## What It Does

- Starts a capture session for the active tab
- Captures the first screenshot immediately
- Watches scroll position and captures a new frame roughly every viewport
- Skips obvious near-duplicate frames
- Lets you review captured frames in order
- Exports a ZIP with numbered PNGs and a `manifest.json`

## Project Structure

```text
src/
  manifest.json
  background.js
  contentScript.js
  popup.html
  popup.js
  review.html
  review.js
  styles.css
  lib/
    zip.js
```

## Load In Chrome

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click Load unpacked
4. Select this project’s `src/` folder

## How To Use

1. Open a normal webpage
2. Click the ScrollSnap extension icon
3. Click `Start Capture`
4. Scroll manually through the page
5. Click `Stop Capture`
6. Click `Open Review`
7. Delete any unwanted frames if needed
8. Click `Export ZIP`

## What To Test First

1. Start capture on a standard public webpage
2. Confirm the first screenshot appears immediately
3. Scroll about one viewport at a time and watch the popup frame count increase
4. Stop capture and open the review page
5. Delete one frame and confirm the list reindexes correctly
6. Export the ZIP and confirm it contains `frame_001.png`, `frame_002.png`, and `manifest.json`

## Permissions Notes

- `activeTab`: required so capture works after the user invokes the extension
- `tabs`: used to query the active tab and read tab metadata
- `storage`: used for local-only temporary session storage
- `downloads`: used to save the exported ZIP locally
- `scripting`: used to inject the content script into the active tab when capture begins
- `host_permissions: ["<all_urls>"]`: used so the content script can run on normal webpages during development and review. This keeps the MVP simple across arbitrary sites.

## Privacy

- Screenshots stay local in the extension
- No backend server is used
- No analytics are used
- No data is transmitted anywhere

## Known Limitations

- Captures only the visible tab viewport, not native Mac apps
- Some Chrome internal pages cannot be captured
- Pages with sticky headers may appear in multiple frames
- Very long sessions may use significant browser storage
- Video, animations, and lazy-loaded content may produce inconsistent frames
- The user must invoke the extension for `activeTab` capture permission

## Tradeoffs In This MVP

- Duplicate detection is intentionally simple and based on scroll proximity plus screenshot size similarity
- Session data is stored in `chrome.storage.local` for simplicity instead of IndexedDB
- ZIP export uses a small in-repo ZIP writer with no external dependency

## Future Improvements

- Stronger visual duplicate detection
- Adjustable capture sensitivity
- Bulk delete and frame reordering
- Better memory handling with IndexedDB and blob storage
- Full-page stitching or composite output modes
