const elements = {
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  frameCount: document.getElementById("frameCount"),
  errorMessage: document.getElementById("errorMessage"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  reviewButton: document.getElementById("reviewButton"),
  clearButton: document.getElementById("clearButton")
};

async function init() {
  bindEvents();
  await refreshState();
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function bindEvents() {
  elements.startButton.addEventListener("click", async () => {
    await withButtonState(elements.startButton, async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await sendMessage({ type: "START_CAPTURE", tabId: tab?.id });
      await refreshState();
    });
  });

  elements.stopButton.addEventListener("click", async () => {
    await withButtonState(elements.stopButton, async () => {
      await sendMessage({ type: "STOP_CAPTURE" });
      await refreshState();
    });
  });

  elements.reviewButton.addEventListener("click", async () => {
    await sendMessage({ type: "OPEN_REVIEW" });
  });

  elements.clearButton.addEventListener("click", async () => {
    await withButtonState(elements.clearButton, async () => {
      await sendMessage({ type: "CLEAR_SESSION" });
      await refreshState();
    });
  });
}

async function refreshState() {
  const response = await sendMessage({ type: "GET_STATE" });
  renderState(response.session, response.frameCount, response.lastError);
}

function renderState(session, frameCount, lastError) {
  const status = session?.status === "capturing" ? "Capturing" : "Idle";
  elements.statusBadge.textContent = status;
  elements.statusBadge.dataset.status = status.toLowerCase();
  elements.statusText.textContent = status;
  elements.frameCount.textContent = String(frameCount || 0);
  elements.startButton.disabled = session?.status === "capturing";
  elements.stopButton.disabled = session?.status !== "capturing";
  elements.reviewButton.disabled = !frameCount;
  elements.clearButton.disabled = !frameCount && session?.status !== "capturing";

  if (lastError) {
    elements.errorMessage.textContent = lastError;
    elements.errorMessage.classList.remove("hidden");
  } else {
    elements.errorMessage.textContent = "";
    elements.errorMessage.classList.add("hidden");
  }
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
    refreshState().catch((error) => {
      console.error("Unable to refresh popup state", error);
    });
  }
}

async function withButtonState(button, task) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Working...";

  try {
    await task();
  } finally {
    button.textContent = originalText;
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
  renderState({ status: "idle" }, 0, error.message || "Unable to load popup.");
});
