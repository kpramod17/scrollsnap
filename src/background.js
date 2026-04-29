import { buildZip } from "./lib/zip.js";

const STORAGE_KEYS = {
  session: "scrollsnap.session",
  frames: "scrollsnap.frames",
  lastError: "scrollsnap.lastError"
};

// ScrollSnap keeps session data and screenshots in local extension storage only.

const CAPTURE_THRESHOLD_RATIO = 0.8;
const CAPTURE_MIN_INTERVAL_MS = 700;
const SCROLL_DUPLICATE_EPSILON = 40;
const DATA_URL_DUPLICATE_EPSILON = 200;

const runtimeState = {
  activeSessionId: null,
  captureInFlight: false
};

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeStorage();
  const session = await getSession();
  if (session?.status === "capturing") {
    await setSession({ ...session, status: "idle" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch(async (error) => {
      console.error("ScrollSnap error", error);
      await setLastError(error.message || "Unknown error");
      sendResponse({ ok: false, error: error.message || "Unknown error" });
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
    case "CLEAR_SESSION":
      return clearSession();
    case "OPEN_REVIEW":
      return openReviewPage();
    case "GET_REVIEW_DATA":
      return getReviewData();
    case "DELETE_FRAME":
      return deleteFrame(message.frameId);
    case "EXPORT_ZIP":
      return exportZip();
    case "SCROLL_EVENT":
      await maybeCaptureFromScroll(message.payload, sender.tab);
      return getPublicState();
    default:
      return {};
  }
}

async function initializeStorage() {
  const current = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const next = {};

  if (!current[STORAGE_KEYS.session]) {
    next[STORAGE_KEYS.session] = {
      sessionId: null,
      status: "idle",
      startedAt: null,
      stoppedAt: null,
      tabId: null,
      url: "",
      title: "",
      viewportHeight: 0,
      documentHeight: 0,
      frameCount: 0
    };
  }

  if (!current[STORAGE_KEYS.frames]) {
    next[STORAGE_KEYS.frames] = [];
  }

  if (!(STORAGE_KEYS.lastError in current)) {
    next[STORAGE_KEYS.lastError] = "";
  }

  if (Object.keys(next).length) {
    await chrome.storage.local.set(next);
  }
}

async function getPublicState() {
  const [session, frames, lastError] = await Promise.all([
    getSession(),
    getFrames(),
    getLastError()
  ]);

  return {
    session,
    frameCount: frames.length,
    lastError
  };
}

async function getReviewData() {
  const [session, frames, lastError] = await Promise.all([
    getSession(),
    getFrames(),
    getLastError()
  ]);

  return { session, frames, lastError };
}

async function startCapture(optionalTabId) {
  const tab = await getTargetTab(optionalTabId);
  ensureTabIsCapturable(tab);

  await clearLastError();
  await ensureContentScript(tab.id);

  const pageInfo = await requestPageInfo(tab.id);
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const session = {
    sessionId,
    status: "capturing",
    startedAt,
    stoppedAt: null,
    tabId: tab.id,
    url: pageInfo.url || tab.url || "",
    title: pageInfo.title || tab.title || "",
    viewportHeight: pageInfo.viewportHeight || 0,
    documentHeight: pageInfo.documentHeight || 0,
    frameCount: 0
  };

  runtimeState.activeSessionId = sessionId;
  runtimeState.captureInFlight = false;

  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: session,
    [STORAGE_KEYS.frames]: []
  });

  await chrome.tabs.sendMessage(tab.id, { type: "BEGIN_CAPTURE_OBSERVATION" });
  await captureFrame({
    tab,
    session,
    pageInfo,
    force: true
  });

  return getPublicState();
}

async function stopCapture() {
  const session = await getSession();
  if (session?.status !== "capturing" || !session.tabId) {
    return getPublicState();
  }

  try {
    const pageInfo = await requestPageInfo(session.tabId);
    const tab = await chrome.tabs.get(session.tabId);
    await captureFrame({
      tab,
      session,
      pageInfo,
      force: false
    });
  } catch (error) {
    console.debug("Unable to capture final frame on stop", error);
  }

  try {
    await chrome.tabs.sendMessage(session.tabId, { type: "END_CAPTURE_OBSERVATION" });
  } catch (error) {
    console.debug("Unable to stop content script observation", error);
  }

  runtimeState.activeSessionId = null;
  runtimeState.captureInFlight = false;

  await setSession({
    ...session,
    status: "idle",
    stoppedAt: new Date().toISOString()
  });

  return getPublicState();
}

async function clearSession() {
  const session = await getSession();

  if (session?.tabId) {
    try {
      await chrome.tabs.sendMessage(session.tabId, { type: "END_CAPTURE_OBSERVATION" });
    } catch (error) {
      console.debug("Unable to clear content script observation", error);
    }
  }

  runtimeState.activeSessionId = null;
  runtimeState.captureInFlight = false;

  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: {
      sessionId: null,
      status: "idle",
      startedAt: null,
      stoppedAt: null,
      tabId: null,
      url: "",
      title: "",
      viewportHeight: 0,
      documentHeight: 0,
      frameCount: 0
    },
    [STORAGE_KEYS.frames]: [],
    [STORAGE_KEYS.lastError]: ""
  });

  return getPublicState();
}

async function openReviewPage() {
  const url = chrome.runtime.getURL("review.html");
  await chrome.tabs.create({ url });
  return {};
}

async function deleteFrame(frameId) {
  const frames = await getFrames();
  const nextFrames = frames
    .filter((frame) => frame.id !== frameId)
    .map((frame, index) => ({
      ...frame,
      index: index + 1
    }));

  await setFrames(nextFrames);
  return getReviewData();
}

async function exportZip() {
  const session = await getSession();
  const frames = await getFrames();

  if (!frames.length) {
    throw new Error("No frames available to export.");
  }

  const exportedAt = new Date().toISOString();
  const manifest = {
    product: "ScrollSnap",
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    exportedAt,
    sourceUrl: session.url,
    pageTitle: session.title,
    frameCount: frames.length,
    frames: frames.map((frame) => ({
      file: formatFrameFileName(frame.index),
      index: frame.index,
      timestamp: frame.timestamp,
      scrollY: frame.scrollY,
      viewportHeight: frame.viewportHeight,
      documentHeight: frame.documentHeight,
      url: frame.url,
      title: frame.title
    }))
  };

  const files = frames.map((frame) => ({
    name: formatFrameFileName(frame.index),
    data: dataUrlToUint8Array(frame.dataUrl)
  }));

  files.push({
    name: "manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  });

  const zipBytes = buildZip(files);
  const zipDataUrl = uint8ArrayToDataUrl(zipBytes, "application/zip");
  const filename = buildExportName(exportedAt);

  await chrome.downloads.download({
    url: zipDataUrl,
    filename,
    saveAs: true
  });

  return { filename };
}

async function maybeCaptureFromScroll(payload, senderTab) {
  const session = await getSession();

  if (session?.status !== "capturing") {
    return;
  }

  if (!senderTab?.id || senderTab.id !== session.tabId) {
    return;
  }

  if (runtimeState.captureInFlight) {
    return;
  }

  const frames = await getFrames();
  const lastFrame = frames.at(-1);
  const now = Date.now();
  const lastCapturedAt = lastFrame?.timestamp ? new Date(lastFrame.timestamp).getTime() : 0;

  if (now - lastCapturedAt < CAPTURE_MIN_INTERVAL_MS) {
    return;
  }

  const threshold = Math.max(1, Math.round((payload.viewportHeight || session.viewportHeight || 0) * CAPTURE_THRESHOLD_RATIO));
  const lastScrollY = lastFrame?.scrollY ?? 0;

  if (lastFrame && Math.abs(payload.scrollY - lastScrollY) < threshold) {
    return;
  }

  const tab = senderTab;
  await captureFrame({
    tab,
    session,
    pageInfo: payload,
    force: false
  });
}

async function captureFrame({ tab, session, pageInfo, force }) {
  runtimeState.captureInFlight = true;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const frames = await getFrames();
    const lastFrame = frames.at(-1);
    const nextScrollY = Math.round(pageInfo.scrollY || 0);

    if (!force && isDuplicateFrame(lastFrame, dataUrl, nextScrollY)) {
      return;
    }

    const frame = {
      id: crypto.randomUUID(),
      index: frames.length + 1,
      dataUrl,
      timestamp: new Date().toISOString(),
      scrollY: nextScrollY,
      viewportHeight: pageInfo.viewportHeight || session.viewportHeight || 0,
      documentHeight: pageInfo.documentHeight || session.documentHeight || 0,
      url: pageInfo.url || session.url || "",
      title: pageInfo.title || session.title || ""
    };

    const nextFrames = [...frames, frame];

    await chrome.storage.local.set({
      [STORAGE_KEYS.frames]: nextFrames,
      [STORAGE_KEYS.session]: {
        ...session,
        url: frame.url,
        title: frame.title,
        viewportHeight: frame.viewportHeight,
        documentHeight: frame.documentHeight,
        frameCount: nextFrames.length
      },
      [STORAGE_KEYS.lastError]: ""
    });
  } catch (error) {
    throw new Error(`Capture failed: ${error.message || "Unable to capture visible tab."}`);
  } finally {
    runtimeState.captureInFlight = false;
  }
}

function isDuplicateFrame(lastFrame, dataUrl, scrollY) {
  if (!lastFrame) {
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
    const tab = await chrome.tabs.get(optionalTabId);
    return tab;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("No active tab found.");
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
    throw new Error("This page cannot be captured. Open a normal webpage and try again.");
  }
}

function formatFrameFileName(index) {
  return `frame_${String(index).padStart(3, "0")}.png`;
}

function buildExportName(isoString) {
  const date = new Date(isoString);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ];
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ];

  return `scrollsnap_capture_${parts.join("-")}_${time.join("-")}.zip`;
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function uint8ArrayToDataUrl(bytes, mimeType) {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function getSession() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.session);
  return result[STORAGE_KEYS.session];
}

async function setSession(session) {
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
}

async function getFrames() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.frames);
  return result[STORAGE_KEYS.frames] || [];
}

async function setFrames(frames) {
  const session = await getSession();
  await chrome.storage.local.set({
    [STORAGE_KEYS.frames]: frames,
    [STORAGE_KEYS.session]: {
      ...session,
      frameCount: frames.length
    }
  });
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
