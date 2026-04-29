import { buildZip } from "./lib/zip.js";

const elements = {
  reviewError: document.getElementById("reviewError"),
  metaUrl: document.getElementById("metaUrl"),
  metaTitle: document.getElementById("metaTitle"),
  metaStartedAt: document.getElementById("metaStartedAt"),
  metaFrameCount: document.getElementById("metaFrameCount"),
  framesGrid: document.getElementById("framesGrid"),
  emptyState: document.getElementById("emptyState"),
  exportButton: document.getElementById("exportButton"),
  clearButton: document.getElementById("clearButton"),
  closeButton: document.getElementById("closeButton")
};

async function init() {
  bindEvents();
  await refresh();
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function bindEvents() {
  elements.exportButton.addEventListener("click", async () => {
    await runAction(elements.exportButton, async () => {
      const response = await sendMessage({ type: "GET_REVIEW_DATA" });
      await exportZipFromReview(response.session, response.frames);
      await refresh();
    });
  });

  elements.clearButton.addEventListener("click", async () => {
    await runAction(elements.clearButton, async () => {
      await sendMessage({ type: "CLEAR_SESSION" });
      await refresh();
    });
  });

  elements.closeButton.addEventListener("click", () => {
    closeReviewTab().catch((error) => {
      console.error("Unable to close review tab", error);
      window.close();
    });
  });
}

async function refresh() {
  const response = await sendMessage({ type: "GET_REVIEW_DATA" });
  render(response.session, response.frames, response.lastError);
}

function render(session, frames, lastError) {
  elements.metaUrl.textContent = session?.url || "-";
  elements.metaUrl.title = session?.url || "";
  elements.metaTitle.textContent = session?.title || "-";
  elements.metaTitle.title = session?.title || "";
  elements.metaStartedAt.textContent = formatDate(session?.startedAt);
  elements.metaFrameCount.textContent = String(frames?.length || 0);

  if (lastError) {
    elements.reviewError.textContent = lastError;
    elements.reviewError.classList.remove("hidden");
  } else {
    elements.reviewError.textContent = "";
    elements.reviewError.classList.add("hidden");
  }

  elements.framesGrid.innerHTML = "";
  const hasFrames = Boolean(frames?.length);
  elements.emptyState.classList.toggle("hidden", hasFrames);
  elements.exportButton.disabled = !hasFrames;
  elements.clearButton.disabled = !hasFrames && session?.status !== "capturing";

  if (!hasFrames) {
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const frame of frames) {
    fragment.appendChild(buildFrameCard(frame));
  }

  elements.framesGrid.appendChild(fragment);
}

function buildFrameCard(frame) {
  const article = document.createElement("article");
  article.className = "frame-card";

  const image = document.createElement("img");
  image.className = "frame-image";
  image.src = frame.dataUrl;
  image.alt = `Frame ${frame.index}`;

  const body = document.createElement("div");
  body.className = "frame-body";

  const heading = document.createElement("div");
  heading.className = "frame-heading";
  heading.innerHTML = `<strong>Frame ${String(frame.index).padStart(3, "0")}</strong>`;

  const details = document.createElement("div");
  details.className = "frame-details";
  details.innerHTML = [
    `<span>${formatDate(frame.timestamp)}</span>`,
    `<span>Scroll Y: ${frame.scrollY}px</span>`,
    `<span>Viewport: ${frame.viewportHeight}px</span>`
  ].join("");

  const deleteButton = document.createElement("button");
  deleteButton.className = "button button-danger";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", async () => {
    await runAction(deleteButton, async () => {
      await sendMessage({ type: "DELETE_FRAME", frameId: frame.id });
      await refresh();
    });
  });

  body.append(heading, details, deleteButton);
  article.append(image, body);

  return article;
}

function onStorageChanged(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (
    changes["scrollsnap.session"] ||
    changes["scrollsnap.frames"] ||
    changes["scrollsnap.lastError"]
  ) {
    refresh().catch((error) => {
      console.error("Unable to refresh review page", error);
    });
  }
}

async function runAction(button, action) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Working...";

  try {
    await action();
  } finally {
    button.textContent = label;
  }
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error || "Unknown extension error");
  }

  return response;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

async function exportZipFromReview(session, frames) {
  if (!frames?.length) {
    throw new Error("No frames available to export.");
  }

  const exportedAt = new Date().toISOString();
  const manifest = {
    product: "ScrollSnap",
    sessionId: session?.sessionId || null,
    startedAt: session?.startedAt || null,
    exportedAt,
    sourceUrl: session?.url || "",
    pageTitle: session?.title || "",
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
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const blobUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: blobUrl,
      filename: buildExportName(exportedAt),
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
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

async function closeReviewTab() {
  const currentTab = await chrome.tabs.getCurrent();
  if (currentTab?.id) {
    await chrome.tabs.remove(currentTab.id);
    return;
  }

  window.close();
}

init().catch((error) => {
  render({}, [], error.message || "Unable to load review page.");
});
