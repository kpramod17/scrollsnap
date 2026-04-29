# ScrollSnap Permissions

ScrollSnap keeps permissions narrow and only requests access needed for the current screenshot capture workflow.

## Requested Permissions

### `activeTab`

Lets ScrollSnap capture the active tab only after the user clicks `Start Capture` or otherwise invokes the extension on that tab.

### `tabs`

Lets ScrollSnap read the current tab title and URL so it can create smart session names, frame filenames, and session metadata.

### `downloads`

Lets ScrollSnap save captured PNG frames, `manifest.json`, and `report.md` directly into Chrome Downloads.

### `storage`

Lets ScrollSnap store lightweight session metadata, local settings, and onboarding state inside the browser.

### `scripting`

Lets ScrollSnap inject a scroll listener into the active page during capture so it knows when to save the next frame.

## What ScrollSnap Does Not Request

ScrollSnap does not request permissions for:

- cloud sync
- analytics
- advertising
- tracking
- unrelated browsing access

ScrollSnap does not request broad host permissions such as `<all_urls>` for the current product.
