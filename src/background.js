import {
  addFrame,
  clearAllData,
  createSession,
  deleteFrame,
  deleteSession,
  getFrames,
  getSession,
  getSessions,
  openDb,
  updateSession
} from "./lib/db.js";
import {
  buildSessionFolderName,
  buildFrameFilename,
  buildSessionTitle,
  extractHostname
} from "./lib/naming.js";

const STORAGE_KEYS = {
  activeCapture: "scrollsnap.activeCapture",
  lastError: "scrollsnap.lastError",
  settings: "scrollsnap.settings",
  onboardingComplete: "scrollsnap.onboardingComplete",
  uiRevision: "scrollsnap.uiRevision",
  legacyMigrated: "scrollsnap.legacyMigrated"
};

const DEFAULT_SETTINGS = {
  captureIntervalRatio: 0.8,
  exportImageFormat: "png",
  maxFrames: 100,
  duplicateSkipping: true
};

const CAPTURE_MIN_INTERVAL_MS = 700;
const SCROLL_DUPLICATE_EPSILON = 40;
const DATA_URL_DUPLICATE_EPSILON = 200;

const runtimeState = {
  captureInFlight: false
};

chrome.runtime.onInstalled.addListener(async () => {
  await initializeApp();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeApp();
  const activeCapture = await getActiveCapture();
  if (activeCapture?.status === "capturing") {
    await setActiveCapture({
      ...activeCapture,
      status: "idle",
      tabId: null
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch(async (error) => {
      const friendly = normalizeError(error);
      console.error("ScrollSnap error", error);
      await setLastError(friendly);
      sendResponse({ ok: false, error: friendly });
    });

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "GET_STATE":
      return getPublicState();
    case "START_CAPTURE":
      return startCapture(message.tabId);
    case "STOP_CAPTURE":
      return stopCapture();
    case "OPEN_LIBRARY":
      return openLibraryPage(message.sessionId);
    case "GET_LIBRARY_DATA":
      return getLibraryData();
    case "GET_SESSION_DETAIL":
      return getSessionDetail(message.sessionId);
    case "RENAME_SESSION":
      return renameSession(message.sessionId, message.title);
    case "DELETE_SESSION":
      return removeSession(message.sessionId);
    case "DELETE_FRAME":
      return removeFrame(message.frameId);
    case "CLEAR_ALL_DATA":
      return clearEverything();
    case "SET_SETTINGS":
      return saveSettings(message.settings);
    case "COMPLETE_ONBOARDING":
      return completeOnboarding();
    case "CLEAR_ERROR":
      await clearLastError();
      return getPublicState();
    case "SCROLL_EVENT":
      await maybeCaptureFromScroll(message.payload, sender.tab);
      return getPublicState();
    default:
      return {};
  }
}

async function initializeApp() {
  await openDb();
  await initializeLocalState();
  await migrateLegacyStorage();
}

async function initializeLocalState() {
  const current = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const next = {};

  if (!current[STORAGE_KEYS.activeCapture]) {
    next[STORAGE_KEYS.activeCapture] = buildEmptyActiveCapture();
  }

  if (!(STORAGE_KEYS.lastError in current)) {
    next[STORAGE_KEYS.lastError] = "";
  }

  if (!current[STORAGE_KEYS.settings]) {
    next[STORAGE_KEYS.settings] = DEFAULT_SETTINGS;
  }

  if (!(STORAGE_KEYS.onboardingComplete in current)) {
    next[STORAGE_KEYS.onboardingComplete] = false;
  }

  if (!(STORAGE_KEYS.uiRevision in current)) {
    next[STORAGE_KEYS.uiRevision] = 0;
  }

  if (!(STORAGE_KEYS.legacyMigrated in current)) {
    next[STORAGE_KEYS.legacyMigrated] = false;
  }

  if (Object.keys(next).length) {
    await chrome.storage.local.set(next);
  }
}

async function migrateLegacyStorage() {
  const state = await chrome.storage.local.get([
    STORAGE_KEYS.legacyMigrated,
    "scrollsnap.session",
    "scrollsnap.frames"
  ]);

  if (state[STORAGE_KEYS.legacyMigrated]) {
    return;
  }

  const legacySession = state["scrollsnap.session"];
  const legacyFrames = state["scrollsnap.frames"] || [];

  if (legacySession?.sessionId && legacyFrames.length) {
    const sessionId = legacySession.sessionId;
    const hostname = extractHostname(legacySession.url);
    const legacyCreatedAt = legacySession.startedAt || new Date().toISOString();
    await createSession({
      id: sessionId,
      title: buildSessionTitle(legacySession.title, legacySession.url),
      sourceUrl: legacySession.url,
      pageTitle: legacySession.title,
      hostname,
      sessionFolder: buildSessionFolderName({
        title: legacySession.title,
        pageTitle: legacySession.title,
        hostname,
        sourceUrl: legacySession.url
      }, legacyCreatedAt),
      createdAt: legacyCreatedAt,
      updatedAt: legacySession.stoppedAt || legacyCreatedAt,
      frameCount: 0,
      captureSettings: DEFAULT_SETTINGS
    });

    for (const frame of legacyFrames.sort((a, b) => a.index - b.index)) {
      const timestamp = frame.timestamp || new Date().toISOString();
      await addFrame(sessionId, {
        id: frame.id || crypto.randomUUID(),
        sessionId,
        index: frame.index,
        filename: buildFrameFilename({
          title: frame.title || legacySession.title,
          url: frame.url || legacySession.url,
          index: frame.index,
          timestamp
        }),
        dataUrl: frame.dataUrl,
        timestamp,
        scrollY: frame.scrollY || 0,
        viewportHeight: frame.viewportHeight || 0,
        documentHeight: frame.documentHeight || 0,
        url: frame.url || legacySession.url,
        title: frame.title || legacySession.title,
        visualHash: ""
      });
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.legacyMigrated]: true });
}

async function getPublicState() {
  const [activeCapture, settings, lastError, onboardingComplete, sessions] = await Promise.all([
    getActiveCapture(),
    getSettings(),
    getLastError(),
    getOnboardingComplete(),
    getSessions()
  ]);

  return {
    activeCapture,
    frameCount: activeCapture?.frameCount || 0,
    settings,
    lastError,
    onboardingComplete,
    sessionCount: sessions.length
  };
}

async function getLibraryData() {
  const [sessions, activeCapture, lastError] = await Promise.all([
    getSessions(),
    getActiveCapture(),
    getLastError()
  ]);

  return {
    sessions,
    activeCapture,
    lastError
  };
}

async function getSessionDetail(sessionId) {
  const [session, frames] = await Promise.all([
    getSession(sessionId),
    getFrames(sessionId)
  ]);

  if (!session) {
    throw new Error("Session not found.");
  }

  return { session, frames };
}

async function startCapture(optionalTabId) {
  const tab = await getTargetTab(optionalTabId);
  ensureTabIsCapturable(tab);
  await clearLastError();
  await ensureContentScript(tab.id);

  const pageInfo = await requestPageInfo(tab.id);
  const settings = await getSettings();
  const createdAt = new Date().toISOString();
  const hostname = extractHostname(pageInfo.url || tab.url || "");
  const sessionFolder = buildSessionFolderName({
    title: pageInfo.title || tab.title || "",
    pageTitle: pageInfo.title || tab.title || "",
    hostname,
    sourceUrl: pageInfo.url || tab.url || ""
  }, createdAt);
  const session = await createSession({
    id: crypto.randomUUID(),
    title: buildSessionTitle(pageInfo.title || tab.title, pageInfo.url || tab.url || ""),
    sourceUrl: pageInfo.url || tab.url || "",
    pageTitle: pageInfo.title || tab.title || "",
    hostname,
    sessionFolder,
    createdAt,
    updatedAt: createdAt,
    frameCount: 0,
    captureSettings: settings
  });

  const activeCapture = {
    sessionId: session.id,
    status: "capturing",
    tabId: tab.id,
    windowId: tab.windowId,
    title: session.title,
    sourceUrl: session.sourceUrl,
    pageTitle: session.pageTitle,
    hostname: session.hostname,
    sessionFolder: session.sessionFolder,
    downloadPath: buildDownloadPath(session.sessionFolder),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    frameCount: 0,
    savedSummary: "",
    viewportHeight: pageInfo.viewportHeight || 0,
    documentHeight: pageInfo.documentHeight || 0,
    captureSettings: settings
  };

  await setActiveCapture(activeCapture);
  runtimeState.captureInFlight = false;

  await chrome.tabs.sendMessage(tab.id, { type: "BEGIN_CAPTURE_OBSERVATION" });
  await captureFrame({
    tab,
    activeCapture,
    pageInfo,
    force: true
  });

  await bumpUiRevision();
  return getPublicState();
}

async function stopCapture() {
  const activeCapture = await getActiveCapture();
  if (!activeCapture?.sessionId || !["capturing", "paused"].includes(activeCapture.status)) {
    return getPublicState();
  }

  if (activeCapture.status === "capturing" && activeCapture.tabId) {
    try {
      const pageInfo = await requestPageInfo(activeCapture.tabId);
      const tab = await chrome.tabs.get(activeCapture.tabId);
      await captureFrame({
        tab,
        activeCapture,
        pageInfo,
        force: false
      });
    } catch (error) {
      console.debug("Unable to capture final frame on stop", error);
    }
  }

  if (activeCapture.tabId) {
    try {
      await chrome.tabs.sendMessage(activeCapture.tabId, { type: "END_CAPTURE_OBSERVATION" });
    } catch (error) {
      console.debug("Unable to stop content script observation", error);
    }
  }

  const frames = await getFrames(activeCapture.sessionId);
  if (!frames.length) {
    throw new Error("No frames captured yet. Start a session and scroll to capture frames.");
  }

  const updatedAt = new Date().toISOString();
  const updatedSession = await updateSession(activeCapture.sessionId, {
    sessionFolder: activeCapture.sessionFolder,
    updatedAt
  });
  let stopMessage = `Saved ${frames.length} frame${frames.length === 1 ? "" : "s"} to Chrome Downloads/${buildDownloadPath(activeCapture.sessionFolder)}. manifest.json and report.md created.`;
  let stopError = "";

  try {
    await downloadSessionSupportFiles(updatedSession, frames);
  } catch (error) {
    stopError = error.message;
    stopMessage = `Saved ${frames.length} frame${frames.length === 1 ? "" : "s"} to Chrome Downloads/${buildDownloadPath(activeCapture.sessionFolder)}.`;
  }

  await setActiveCapture({
    ...activeCapture,
    status: "idle",
    tabId: null,
    windowId: null,
    updatedAt,
    frameCount: frames.length,
    savedSummary: stopMessage
  });

  if (stopError) {
    throw new Error(stopError);
  }

  runtimeState.captureInFlight = false;
  await bumpUiRevision();
  return getPublicState();
}

async function renameSession(sessionId, title) {
  const trimmed = String(title || "").trim();
  if (!trimmed) {
    throw new Error("Enter a session name before saving.");
  }

  const session = await updateSession(sessionId, { title: trimmed });
  const activeCapture = await getActiveCapture();
  if (activeCapture?.sessionId === sessionId) {
    await setActiveCapture({
      ...activeCapture,
      title: session.title,
      updatedAt: session.updatedAt
    });
  }

  await bumpUiRevision();
  return { session };
}

async function removeFrame(frameId) {
  const result = await deleteFrame(frameId);
  const activeCapture = await getActiveCapture();

  if (activeCapture?.sessionId === result.sessionId) {
    await setActiveCapture({
      ...activeCapture,
      frameCount: result.frameCount,
      updatedAt: new Date().toISOString()
    });
  }

  await bumpUiRevision();
  return getSessionDetail(result.sessionId);
}

async function removeSession(sessionId) {
  const activeCapture = await getActiveCapture();

  if (activeCapture?.sessionId === sessionId) {
    if (activeCapture.tabId) {
      try {
        await chrome.tabs.sendMessage(activeCapture.tabId, { type: "END_CAPTURE_OBSERVATION" });
      } catch (error) {
        console.debug("Unable to stop observation for deleted session", error);
      }
    }
    await setActiveCapture(buildEmptyActiveCapture());
  }

  await deleteSession(sessionId);
  await bumpUiRevision();
  return getLibraryData();
}

async function clearEverything() {
  const activeCapture = await getActiveCapture();

  if (activeCapture?.tabId) {
    try {
      await chrome.tabs.sendMessage(activeCapture.tabId, { type: "END_CAPTURE_OBSERVATION" });
    } catch (error) {
      console.debug("Unable to stop observation during clear", error);
    }
  }

  runtimeState.captureInFlight = false;
  await clearAllData();
  await setActiveCapture(buildEmptyActiveCapture());
  await clearLastError();
  await bumpUiRevision();
  return getPublicState();
}

async function saveSettings(partialSettings) {
  const nextSettings = {
    ...DEFAULT_SETTINGS,
    ...(await getSettings()),
    ...partialSettings
  };

  if (![0.5, 0.8, 1].includes(Number(nextSettings.captureIntervalRatio))) {
    nextSettings.captureIntervalRatio = DEFAULT_SETTINGS.captureIntervalRatio;
  }

  nextSettings.maxFrames = Math.max(1, Math.min(500, Number(nextSettings.maxFrames) || DEFAULT_SETTINGS.maxFrames));
  nextSettings.duplicateSkipping = Boolean(nextSettings.duplicateSkipping);
  nextSettings.exportImageFormat = "png";

  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: nextSettings });

  const activeCapture = await getActiveCapture();
  if (activeCapture?.sessionId && activeCapture.status === "capturing") {
    await setActiveCapture({
      ...activeCapture,
      captureSettings: nextSettings
    });
  }

  return getPublicState();
}

async function completeOnboarding() {
  await chrome.storage.local.set({ [STORAGE_KEYS.onboardingComplete]: true });
  return getPublicState();
}

async function openLibraryPage(sessionId) {
  const url = new URL(chrome.runtime.getURL("review.html"));
  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  }
  await chrome.tabs.create({ url: url.toString() });
  return {};
}

async function maybeCaptureFromScroll(payload, senderTab) {
  const activeCapture = await getActiveCapture();
  if (activeCapture?.status !== "capturing") {
    return;
  }

  if (!senderTab?.id || senderTab.id !== activeCapture.tabId) {
    return;
  }

  if (runtimeState.captureInFlight) {
    return;
  }

  const frames = await getFrames(activeCapture.sessionId);
  const lastFrame = frames.at(-1);
  const lastCapturedAt = lastFrame?.timestamp ? new Date(lastFrame.timestamp).getTime() : 0;
  if (Date.now() - lastCapturedAt < CAPTURE_MIN_INTERVAL_MS) {
    return;
  }

  const settings = activeCapture.captureSettings || DEFAULT_SETTINGS;
  const threshold = Math.max(1, Math.round((payload.viewportHeight || activeCapture.viewportHeight || 0) * settings.captureIntervalRatio));
  const lastScrollY = lastFrame?.scrollY ?? 0;

  if (lastFrame && Math.abs(payload.scrollY - lastScrollY) < threshold) {
    return;
  }

  if (frames.length >= settings.maxFrames) {
    await setLastError(`Reached the frame limit of ${settings.maxFrames}. Stop or export this session before capturing more.`);
    await stopCapture();
    return;
  }

  await captureFrame({
    tab: senderTab,
    activeCapture,
    pageInfo: payload,
    force: false
  });
}

async function captureFrame({ tab, activeCapture, pageInfo, force }) {
  runtimeState.captureInFlight = true;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const frames = await getFrames(activeCapture.sessionId);
    const lastFrame = frames.at(-1);
    const index = frames.length + 1;
    const timestamp = new Date().toISOString();
    const nextScrollY = Math.round(pageInfo.scrollY || 0);

    if (!force && shouldSkipDuplicate(activeCapture.captureSettings, lastFrame, dataUrl, nextScrollY)) {
      return;
    }

    const frame = {
      id: crypto.randomUUID(),
      sessionId: activeCapture.sessionId,
      index,
      filename: buildFrameFilename({
        title: pageInfo.title || activeCapture.pageTitle,
        url: pageInfo.url || activeCapture.sourceUrl,
        index,
        timestamp
      }),
      dataUrl,
      timestamp,
      scrollY: nextScrollY,
      viewportHeight: pageInfo.viewportHeight || activeCapture.viewportHeight || 0,
      documentHeight: pageInfo.documentHeight || activeCapture.documentHeight || 0,
      url: pageInfo.url || activeCapture.sourceUrl || "",
      title: pageInfo.title || activeCapture.pageTitle || "",
      visualHash: ""
    };

    await downloadFrameFile(activeCapture, frame);

    const updatedSession = await addFrame(activeCapture.sessionId, frame);
    await setActiveCapture({
      ...activeCapture,
      frameCount: updatedSession.frameCount,
      updatedAt: updatedSession.updatedAt,
      viewportHeight: frame.viewportHeight,
      documentHeight: frame.documentHeight,
      title: updatedSession.title,
      sourceUrl: updatedSession.sourceUrl,
      pageTitle: updatedSession.pageTitle,
      sessionFolder: updatedSession.sessionFolder || activeCapture.sessionFolder,
      downloadPath: buildDownloadPath(updatedSession.sessionFolder || activeCapture.sessionFolder),
      savedSummary: `Frames saved: ${updatedSession.frameCount}. Save location: Chrome Downloads/${buildDownloadPath(updatedSession.sessionFolder || activeCapture.sessionFolder)}`
    });
    await clearLastError();
    await bumpUiRevision();
  } catch (error) {
    if (/saving failed|multiple downloads|automatic downloads|manifest\.json or report\.md/i.test(error.message || "")) {
      await pauseCaptureForDownloadFailure(activeCapture, error.message);
      return;
    }
    throw new Error(`Capture failed. ${error.message || "Try a normal webpage and restart the session."}`);
  } finally {
    runtimeState.captureInFlight = false;
  }
}

function shouldSkipDuplicate(settings, lastFrame, dataUrl, scrollY) {
  if (!settings?.duplicateSkipping || !lastFrame) {
    return false;
  }

  const scrollDelta = Math.abs((lastFrame.scrollY || 0) - scrollY);
  const dataDelta = Math.abs((lastFrame.dataUrl?.length || 0) - dataUrl.length);
  return scrollDelta <= SCROLL_DUPLICATE_EPSILON && dataDelta <= DATA_URL_DUPLICATE_EPSILON;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING_SCROLLSNAP" });
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
  }
}

async function requestPageInfo(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_INFO" });
  if (!response) {
    throw new Error("Unable to read page scroll information.");
  }
  return response;
}

async function getTargetTab(optionalTabId) {
  if (optionalTabId) {
    return chrome.tabs.get(optionalTabId);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("No active tab found. Open a webpage and try again.");
  }

  return tab;
}

function ensureTabIsCapturable(tab) {
  const blockedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "view-source:"
  ];

  if (!tab.url || blockedPrefixes.some((prefix) => tab.url.startsWith(prefix))) {
    throw new Error("Chrome does not allow screenshots on this page. Try a normal webpage.");
  }
}

function normalizeError(error) {
  const message = error?.message || "Something went wrong.";

  if (/indexeddb/i.test(message)) {
    return "Local browser storage is unavailable. Reload the extension and try again.";
  }

  if (/No active tab/i.test(message)) {
    return "No active tab found. Open a webpage and try again.";
  }

  if (/capture/i.test(message) && /page/i.test(message)) {
    return message;
  }

  if (/multiple downloads|automatic downloads/i.test(message)) {
    return "Chrome may ask you to allow multiple downloads. Please allow it so ScrollSnap can save each frame.";
  }

  if (/saving failed|download/i.test(message)) {
    return message;
  }

  if (/Session not found/i.test(message)) {
    return "That session is no longer available. Refresh the library and try again.";
  }

  return message;
}

function buildEmptyActiveCapture() {
  return {
    sessionId: null,
    status: "idle",
    tabId: null,
    windowId: null,
    title: "",
    sourceUrl: "",
    pageTitle: "",
    hostname: "",
    sessionFolder: "",
    downloadPath: "",
    createdAt: null,
    updatedAt: null,
    frameCount: 0,
    savedSummary: "",
    viewportHeight: 0,
    documentHeight: 0,
    captureSettings: DEFAULT_SETTINGS
  };
}

async function getActiveCapture() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.activeCapture);
  return result[STORAGE_KEYS.activeCapture] || buildEmptyActiveCapture();
}

async function setActiveCapture(activeCapture) {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeCapture]: activeCapture });
}

async function getLastError() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.lastError);
  return result[STORAGE_KEYS.lastError] || "";
}

async function setLastError(message) {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastError]: message });
}

async function clearLastError() {
  await setLastError("");
}

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.settings] || {})
  };
}

async function getOnboardingComplete() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.onboardingComplete);
  return Boolean(result[STORAGE_KEYS.onboardingComplete]);
}

async function bumpUiRevision() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.uiRevision);
  const revision = Number(result[STORAGE_KEYS.uiRevision] || 0) + 1;
  await chrome.storage.local.set({ [STORAGE_KEYS.uiRevision]: revision });
}

async function downloadFrameFile(activeCapture, frame) {
  try {
    await chrome.downloads.download({
      url: frame.dataUrl,
      filename: `${buildDownloadPath(activeCapture.sessionFolder)}/${frame.filename}`,
      saveAs: false
    });
  } catch (error) {
    throw new Error(buildDownloadFailureMessage(error, "Frame captured, but saving failed. Capture has been paused."));
  }
}

async function downloadSessionSupportFiles(session, frames) {
  try {
    const manifest = buildSessionManifest(session, frames, new Date().toISOString());
    await chrome.downloads.download({
      url: toDataUrl("application/json", JSON.stringify(manifest, null, 2)),
      filename: `${buildDownloadPath(session.sessionFolder)}/manifest.json`,
      saveAs: false
    });

    const report = buildMarkdownReport(session, frames);
    await chrome.downloads.download({
      url: toDataUrl("text/markdown;charset=utf-8", report),
      filename: `${buildDownloadPath(session.sessionFolder)}/report.md`,
      saveAs: false
    });
  } catch (error) {
    throw new Error(buildDownloadFailureMessage(error, "manifest.json or report.md could not be saved to Chrome Downloads."));
  }
}

async function pauseCaptureForDownloadFailure(activeCapture, message) {
  if (activeCapture?.tabId) {
    try {
      await chrome.tabs.sendMessage(activeCapture.tabId, { type: "END_CAPTURE_OBSERVATION" });
    } catch (error) {
      console.debug("Unable to pause observation after download failure", error);
    }
  }

  await setActiveCapture({
    ...activeCapture,
    status: "paused",
    tabId: null,
    windowId: null,
    savedSummary: `Save location: Chrome Downloads/${buildDownloadPath(activeCapture.sessionFolder)}`
  });
  await setLastError(message);
  await bumpUiRevision();
}

function buildSessionManifest(session, frames, exportedAt) {
  return {
    product: "ScrollSnap",
    sessionId: session.id,
    sessionTitle: session.title,
    sourceUrl: session.sourceUrl,
    pageTitle: session.pageTitle,
    hostname: session.hostname,
    createdAt: session.createdAt,
    exportedAt,
    frameCount: frames.length,
    frames: frames.map((frame) => ({
      index: frame.index,
      filename: frame.filename,
      relativePath: frame.filename,
      timestamp: frame.timestamp,
      scrollY: frame.scrollY,
      viewportHeight: frame.viewportHeight,
      documentHeight: frame.documentHeight,
      url: frame.url,
      title: frame.title
    }))
  };
}

function buildMarkdownReport(session, frames) {
  const lines = [
    `# ${session.title}`,
    "",
    `Source: ${session.sourceUrl || "-"}`,
    `Captured: ${new Date(session.createdAt).toLocaleString()}`,
    `Frames: ${frames.length}`,
    ""
  ];

  for (const frame of frames) {
    lines.push(`## Frame ${String(frame.index).padStart(3, "0")}`);
    lines.push(`![Frame ${String(frame.index).padStart(3, "0")}](${frame.filename})`);
    lines.push(`- Timestamp: ${new Date(frame.timestamp).toLocaleString()}`);
    lines.push(`- Scroll position: ${frame.scrollY}px`);
    lines.push("");
  }

  return lines.join("\n");
}

function toDataUrl(mimeType, text) {
  return `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(text)))}`;
}

function buildDownloadFailureMessage(error, fallback) {
  const message = error?.message || error?.toString() || "";

  if (/automatic downloads|multiple downloads/i.test(message)) {
    return "Chrome may ask you to allow multiple downloads. Please allow it so ScrollSnap can save each frame.";
  }

  if (/downloads/i.test(message) && /permission/i.test(message)) {
    return "Downloads permission is unavailable. Reload the extension and try again.";
  }

  return fallback;
}

function buildDownloadPath(sessionFolder) {
  return `ScrollSnap/${sessionFolder}`;
}
