You are building an MVP Chrome extension called ScrollSnap.

Goal:
Build a Chrome extension that captures ordered screenshot frames while the user scrolls through a webpage. The user should be able to start a capture session, manually scroll through the page, stop the session, review captured frames, and export them as a ZIP containing PNG screenshots plus a metadata JSON file.

Important technical context:
- Use Chrome Extension Manifest V3.
- Use chrome.tabs.captureVisibleTab for screenshots.
- Use activeTab permission so capture works after the user invokes the extension.
- Use a content script to listen to scroll events and report scroll position.
- Use a service worker/background script for screenshot capture and extension-level state.
- Use chrome.storage.local or IndexedDB for temporary frame storage.
- Use chrome.downloads.download for exporting the ZIP.
- Do not build a Mac app yet.
- Do not use a backend server. Everything should run locally in the extension.

Product name:
ScrollSnap

Core user flow:
1. User opens a webpage.
2. User clicks the ScrollSnap extension icon.
3. Popup opens.
4. User clicks “Start Capture.”
5. User scrolls manually through the page.
6. Extension captures a visible-tab screenshot whenever the user scrolls roughly one viewport height from the last captured frame.
7. Extension skips obviously duplicate frames.
8. User clicks “Stop Capture.”
9. User opens a review page showing captured frame thumbnails.
10. User exports a ZIP with:
   - frame_001.png
   - frame_002.png
   - frame_003.png
   - manifest.json

MVP requirements:

1. Extension structure
Create a working Manifest V3 Chrome extension with:
- manifest.json
- service worker/background script
- content script
- popup page
- review page
- shared utilities if needed

Suggested structure:
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
    zip.min.js or equivalent local JSZip dependency
    imageUtils.js

You can choose a cleaner structure if appropriate, but keep it simple and easy to run locally.

2. Popup UI
The popup should show:
- Product name: ScrollSnap
- Current capture status: Idle / Capturing
- Frames captured count
- Start Capture button
- Stop Capture button
- Open Review button
- Clear Session button

Behaviour:
- Start Capture begins a session for the active tab.
- Stop Capture stops the session.
- Open Review opens the extension review page.
- Clear Session deletes all stored frames and metadata.

3. Capture behaviour
When capture starts:
- Store session metadata:
  - sessionId
  - startedAt
  - tabId
  - url
  - title
  - viewportHeight
  - documentHeight if available
- Capture the first visible frame immediately.
- Listen for scroll events from the content script.
- Capture another frame when the user has scrolled at least 0.8x viewport height since the last captured scroll position.
- Save each frame with:
  - id
  - index
  - dataUrl
  - timestamp
  - scrollY
  - viewportHeight
  - documentHeight
  - url
  - title

Important:
- Debounce scroll handling so it does not capture too frequently.
- Add a minimum interval of about 700ms between captures.
- If captureVisibleTab fails, show a clear error in the popup.

4. Duplicate skipping
Implement basic duplicate detection.

Simple acceptable approach:
- Before saving a frame, compare the new screenshot dataUrl length and scroll position against the last saved frame.
- Skip if:
  - scrollY is the same or nearly the same, and
  - dataUrl length difference is very small.

Better approach if easy:
- Downscale screenshots to a small canvas and calculate a rough visual hash.
- Skip frame if hash is too similar to previous frame.

Keep this simple. Do not overbuild.

5. Review page
The review page should:
- Show session metadata at the top:
  - URL
  - title
  - startedAt
  - number of frames
- Show captured frames in order as a grid/list.
- Each frame card should show:
  - thumbnail image
  - frame number
  - timestamp
  - scroll position
  - delete button
- Allow deleting individual frames.
- Include buttons:
  - Export ZIP
  - Clear Session
  - Back / close

6. Export ZIP
When user clicks Export ZIP:
- Convert dataUrls to PNG files.
- Name files:
  - frame_001.png
  - frame_002.png
  - etc.
- Include manifest.json with:
  - product: "ScrollSnap"
  - sessionId
  - startedAt
  - exportedAt
  - sourceUrl
  - pageTitle
  - frameCount
  - frames array with:
    - file
    - index
    - timestamp
    - scrollY
    - viewportHeight
    - documentHeight
    - url
    - title

Download filename:
scrollsnap_capture_YYYY-MM-DD_HH-mm-ss.zip

Use JSZip or a simple local ZIP library. Do not fetch dependencies from a CDN at runtime. If using JSZip, include it locally or explain exactly how to install/build it.

7. Permissions
Use the minimum required permissions.

Likely permissions:
- activeTab
- tabs
- storage
- downloads
- scripting

Host permissions:
- Keep as narrow as possible.
- For local development, use <all_urls> only if needed, but explain why.

Chrome docs note that the Tabs API can take screenshots and interact with tabs, and captureVisibleTab requires appropriate permission such as activeTab. Use Manifest V3 patterns. References: Chrome Tabs API and MDN captureVisibleTab docs. 

8. Privacy and safety
The extension should:
- Store data locally only.
- Not send screenshots anywhere.
- Not use external analytics.
- Not request unnecessary permissions.
- Clearly state in comments that screenshots stay local.

9. Styling
Keep the UI clean and functional:
- Simple card-based layout
- Good spacing
- Clear buttons
- No complex design system
- Works in popup dimensions
- Review page should be readable on desktop

10. Developer experience
Add a README.md with:
- What the extension does
- How to load it in Chrome:
  1. Open chrome://extensions
  2. Enable Developer Mode
  3. Click Load unpacked
  4. Select the extension folder
- How to use the extension
- Known limitations
- Future improvements

11. Known limitations to document
Include these in README:
- Captures only the visible tab viewport, not native Mac apps.
- Some Chrome internal pages cannot be captured.
- Pages with sticky headers may appear in multiple frames.
- Very long sessions may use significant browser storage.
- Video, animations, and lazy-loaded content may produce inconsistent frames.
- The user must invoke the extension for activeTab capture permission.

12. Acceptance criteria
The implementation is complete when:
- I can load the extension unpacked in Chrome.
- I can click Start Capture on a normal webpage.
- The first screenshot is captured immediately.
- As I scroll, new screenshots are captured every roughly one viewport.
- The popup shows the frame count.
- I can stop capture.
- I can open a review page and see thumbnails in order.
- I can delete individual frames.
- I can export a ZIP.
- The ZIP contains numbered PNG files and a manifest.json.
- No backend or cloud service is used.

13. Implementation preference
Build the simplest working version first. Avoid unnecessary frameworks unless they materially help. Plain JavaScript, HTML, and CSS are preferred for the MVP.

After creating the files, explain:
- What you built
- How to run it
- Any tradeoffs you made
- What I should test first