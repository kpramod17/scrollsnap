import { buildSessionPdf } from "./lib/pdf.js";
import { buildExportFilename, buildSessionFolderName, formatDisplayDate } from "./lib/naming.js";
import { buildZip } from "./lib/zip.js";

const elements = {
  reviewError: document.getElementById("reviewError"),
  libraryView: document.getElementById("libraryView"),
  detailView: document.getElementById("detailView"),
  librarySummary: document.getElementById("librarySummary"),
  libraryEmptyState: document.getElementById("libraryEmptyState"),
  sessionGrid: document.getElementById("sessionGrid"),
  clearAllButton: document.getElementById("clearAllButton"),
  detailTitle: document.getElementById("detailTitle"),
  detailSubtitle: document.getElementById("detailSubtitle"),
  metaSessionTitle: document.getElementById("metaSessionTitle"),
  metaUrl: document.getElementById("metaUrl"),
  metaPageTitle: document.getElementById("metaPageTitle"),
  metaCreatedAt: document.getElementById("metaCreatedAt"),
  metaFrameCount: document.getElementById("metaFrameCount"),
  metaSaveLocation: document.getElementById("metaSaveLocation"),
  framesEmptyState: document.getElementById("framesEmptyState"),
  framesGrid: document.getElementById("framesGrid"),
  backButton: document.getElementById("backButton"),
  exportMarkdownButton: document.getElementById("exportMarkdownButton"),
  exportZipButton: document.getElementById("exportZipButton"),
  exportPdfButton: document.getElementById("exportPdfButton")
};

let selectedSessionId = new URL(window.location.href).searchParams.get("sessionId");
let currentDetail = null;

async function init() {
  bindEvents();
  await refreshLibrary();
  if (selectedSessionId) {
    await openSession(selectedSessionId);
  }
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function bindEvents() {
  elements.clearAllButton.addEventListener("click", async () => {
    const confirmed = window.confirm("Delete every saved ScrollSnap session from local browser storage?");
    if (!confirmed) {
      return;
    }

    await runAction(elements.clearAllButton, async () => {
      await sendMessage({ type: "CLEAR_ALL_DATA" });
      selectedSessionId = null;
      currentDetail = null;
      renderDetail(null);
      await refreshLibrary();
    });
  });

  elements.backButton.addEventListener("click", () => {
    selectedSessionId = null;
    currentDetail = null;
    renderDetail(null);
    updateUrl();
  });

  elements.exportMarkdownButton.addEventListener("click", async () => {
    await runAction(elements.exportMarkdownButton, async () => {
      await exportMarkdown(currentDetail.session, currentDetail.frames);
    });
  });

  elements.exportZipButton.addEventListener("click", async () => {
    await runAction(elements.exportZipButton, async () => {
      await exportZip(currentDetail.session, currentDetail.frames);
    });
  });

  elements.exportPdfButton.addEventListener("click", async () => {
    await runAction(elements.exportPdfButton, async () => {
      await exportPdf(currentDetail.session, currentDetail.frames);
    });
  });
}

async function refreshLibrary() {
  const response = await sendMessage({ type: "GET_LIBRARY_DATA" });
  renderLibrary(response.sessions || [], response.lastError);
}

function renderLibrary(sessions, lastError) {
  elements.librarySummary.textContent = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;
  elements.sessionGrid.innerHTML = "";
  elements.libraryEmptyState.classList.toggle("hidden", Boolean(sessions.length));
  setError(lastError || "");

  const fragment = document.createDocumentFragment();
  for (const session of sessions) {
    fragment.appendChild(buildSessionCard(session));
  }
  elements.sessionGrid.appendChild(fragment);
}

function buildSessionCard(session) {
  const card = document.createElement("article");
  card.className = "session-card";

  const preview = document.createElement("div");
  preview.className = "session-preview";
  if (session.previewDataUrl) {
    const image = document.createElement("img");
    image.className = "session-preview-image";
    image.src = session.previewDataUrl;
    image.alt = session.title;
    preview.appendChild(image);
  } else {
    preview.textContent = "No preview";
  }

  const body = document.createElement("div");
  body.className = "session-body";

  const title = document.createElement("h3");
  title.textContent = session.title || "Untitled session";

  const meta = document.createElement("div");
  meta.className = "session-meta";
  meta.innerHTML = [
    `<span>${session.hostname || "-"}</span>`,
    `<span>${formatDisplayDate(session.createdAt)}</span>`,
    `<span>${session.frameCount} ${session.frameCount === 1 ? "frame" : "frames"}</span>`
  ].join("");

  const source = document.createElement("p");
  source.className = "section-note";
  source.textContent = `Save location: Chrome Downloads/${session.sessionFolder || buildSessionFolderName(session, session.createdAt)}`;

  const actions = document.createElement("div");
  actions.className = "session-actions";

  const openButton = button("Open", async () => openSession(session.id), "button button-primary");
  const exportButton = button("Export", async () => {
    const detail = await fetchDetail(session.id);
    await exportMarkdown(detail.session, detail.frames);
  });
  const renameButton = button("Rename", async () => {
    const nextTitle = window.prompt("Rename session", session.title || "");
    if (!nextTitle) {
      return;
    }
    await sendMessage({ type: "RENAME_SESSION", sessionId: session.id, title: nextTitle });
    await refreshLibrary();
    if (selectedSessionId === session.id) {
      await openSession(session.id);
    }
  });
  const deleteButton = button("Delete", async () => {
    const confirmed = window.confirm(`Delete "${session.title || "this session"}" from local browser storage?`);
    if (!confirmed) {
      return;
    }
    await sendMessage({ type: "DELETE_SESSION", sessionId: session.id });
    if (selectedSessionId === session.id) {
      selectedSessionId = null;
      currentDetail = null;
      renderDetail(null);
      updateUrl();
    }
    await refreshLibrary();
  }, "button button-danger");

  actions.append(openButton, exportButton, renameButton, deleteButton);
  body.append(title, meta, source, actions);
  card.append(preview, body);

  return card;
}

async function openSession(sessionId) {
  const detail = await fetchDetail(sessionId);
  selectedSessionId = sessionId;
  currentDetail = detail;
  renderDetail(detail);
  updateUrl();
}

async function fetchDetail(sessionId) {
  return sendMessage({ type: "GET_SESSION_DETAIL", sessionId });
}

function renderDetail(detail) {
  const hasDetail = Boolean(detail?.session);
  elements.detailView.classList.toggle("hidden", !hasDetail);

  if (!hasDetail) {
    return;
  }

  const { session, frames } = detail;
  elements.detailTitle.textContent = session.title || "Untitled session";
  elements.detailSubtitle.textContent = `${session.hostname || "-"} • ${frames.length} ${frames.length === 1 ? "frame" : "frames"}`;
  elements.metaSessionTitle.textContent = session.title || "-";
  elements.metaUrl.textContent = session.sourceUrl || "-";
  elements.metaUrl.title = session.sourceUrl || "";
  elements.metaPageTitle.textContent = session.pageTitle || "-";
  elements.metaCreatedAt.textContent = formatDisplayDate(session.createdAt);
  elements.metaFrameCount.textContent = String(frames.length);
  elements.metaSaveLocation.textContent = `Chrome Downloads/${session.sessionFolder || buildSessionFolderName(session, session.createdAt)}`;
  elements.framesGrid.innerHTML = "";
  elements.framesEmptyState.classList.toggle("hidden", Boolean(frames.length));
  elements.exportMarkdownButton.disabled = !frames.length;
  elements.exportZipButton.disabled = !frames.length;
  elements.exportPdfButton.disabled = !frames.length;

  const fragment = document.createDocumentFragment();
  for (const frame of frames) {
    fragment.appendChild(buildFrameCard(session, frame));
  }
  elements.framesGrid.appendChild(fragment);
}

function buildFrameCard(session, frame) {
  const article = document.createElement("article");
  article.className = "frame-card";

  const image = document.createElement("img");
  image.className = "frame-image";
  image.src = frame.dataUrl;
  image.alt = frame.filename;

  const body = document.createElement("div");
  body.className = "frame-body";

  const title = document.createElement("div");
  title.className = "frame-heading";
  title.innerHTML = `<strong>Frame ${String(frame.index).padStart(3, "0")}</strong>`;

  const details = document.createElement("div");
  details.className = "frame-details";
  details.innerHTML = [
    `<span>${formatDisplayDate(frame.timestamp)}</span>`,
    `<span>Scroll Y: ${frame.scrollY}px</span>`,
    `<span>${frame.filename}</span>`
  ].join("");

  const deleteButton = button("Delete", async () => {
    await sendMessage({ type: "DELETE_FRAME", frameId: frame.id });
    await openSession(session.id);
    await refreshLibrary();
  }, "button button-danger");

  body.append(title, details, deleteButton);
  article.append(image, body);
  return article;
}

async function exportMarkdown(session, frames) {
  if (!frames?.length) {
    throw new Error("No frames captured yet. Start a session and scroll to capture frames.");
  }

  const exportedAt = new Date().toISOString();
  const markdown = buildMarkdownReport(session, frames);
  const sessionFolder = session.sessionFolder || buildSessionFolderName(session, session.createdAt);
  const files = [
    {
      name: `${sessionFolder}/report.md`,
      data: new TextEncoder().encode(markdown)
    },
    ...frames.map((frame) => ({
      name: `${sessionFolder}/${frame.filename}`,
      data: dataUrlToBytes(frame.dataUrl)
    }))
  ];

  await downloadZip(
    files,
    `${buildExportFilename(session, exportedAt, "markdown")}.zip`
  );
}

async function exportZip(session, frames) {
  if (!frames?.length) {
    throw new Error("No frames captured yet. Start a session and scroll to capture frames.");
  }

  const exportedAt = new Date().toISOString();
  const sessionFolder = session.sessionFolder || buildSessionFolderName(session, session.createdAt);
  const manifest = {
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

  const files = [
    {
      name: `${sessionFolder}/manifest.json`,
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    },
    {
      name: `${sessionFolder}/report.md`,
      data: new TextEncoder().encode(buildMarkdownReport(session, frames))
    },
    ...frames.map((frame) => ({
      name: `${sessionFolder}/${frame.filename}`,
      data: dataUrlToBytes(frame.dataUrl)
    }))
  ];

  await downloadZip(files, `${buildExportFilename(session, exportedAt)}.zip`);
}

async function exportPdf(session, frames) {
  if (!frames?.length) {
    throw new Error("No frames captured yet. Start a session and scroll to capture frames.");
  }

  const pdfBytes = await buildSessionPdf(session, frames);
  const filename = `${buildExportFilename(session, new Date().toISOString())}.pdf`;
  await downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }), filename);
}

function buildMarkdownReport(session, frames) {
  const lines = [
    `# ${session.title}`,
    "",
    `Source: ${session.sourceUrl || "-"}`,
    `Captured: ${formatDisplayDate(session.createdAt)}`,
    `Frames: ${frames.length}`,
    ""
  ];

  for (const frame of frames) {
    lines.push(`## Frame ${String(frame.index).padStart(3, "0")}`);
    lines.push(`![Frame ${String(frame.index).padStart(3, "0")}](${frame.filename})`);
    lines.push(`- Timestamp: ${formatDisplayDate(frame.timestamp)}`);
    lines.push(`- Scroll position: ${frame.scrollY}px`);
    lines.push("");
  }

  return lines.join("\n");
}

async function downloadZip(files, filename) {
  try {
    const zipBytes = buildZip(files);
    await downloadBlob(new Blob([zipBytes], { type: "application/zip" }), filename);
  } catch (_error) {
    throw new Error("Export failed. Try deleting unused sessions or exporting fewer frames.");
  }
}

async function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function button(label, handler, className = "button") {
  const element = document.createElement("button");
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", async () => {
    await runAction(element, handler);
  });
  return element;
}

function setError(message) {
  if (message) {
    elements.reviewError.textContent = message;
    elements.reviewError.classList.remove("hidden");
  } else {
    elements.reviewError.textContent = "";
    elements.reviewError.classList.add("hidden");
  }
}

function updateUrl() {
  const url = new URL(window.location.href);
  if (selectedSessionId) {
    url.searchParams.set("sessionId", selectedSessionId);
  } else {
    url.searchParams.delete("sessionId");
  }
  window.history.replaceState({}, "", url);
}

function onStorageChanged(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (
    changes["scrollsnap.uiRevision"] ||
    changes["scrollsnap.lastError"] ||
    changes["scrollsnap.activeCapture"]
  ) {
    refreshLibrary().catch((error) => setError(error.message || "Unable to refresh session library."));
    if (selectedSessionId) {
      openSession(selectedSessionId).catch((error) => {
        selectedSessionId = null;
        currentDetail = null;
        renderDetail(null);
        setError(error.message || "Unable to refresh session detail.");
      });
    }
  }
}

async function runAction(button, action) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Working...";

  try {
    await action();
    setError("");
  } catch (error) {
    setError(error.message || "Something went wrong.");
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown extension error");
  }
  return response;
}

init().catch((error) => {
  setError(error.message || "Unable to load session library.");
});
