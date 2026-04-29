const elements = {
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  frameCount: document.getElementById("frameCount"),
  sessionCount: document.getElementById("sessionCount"),
  currentSessionTitle: document.getElementById("currentSessionTitle"),
  saveLocation: document.getElementById("saveLocation"),
  errorMessage: document.getElementById("errorMessage"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  libraryButton: document.getElementById("libraryButton"),
  clearButton: document.getElementById("clearButton"),
  captureInterval: document.getElementById("captureInterval"),
  exportImageFormat: document.getElementById("exportImageFormat"),
  maxFrames: document.getElementById("maxFrames"),
  duplicateSkipping: document.getElementById("duplicateSkipping"),
  onboardingModal: document.getElementById("onboardingModal"),
  onboardingButton: document.getElementById("onboardingButton")
};

let applyingSettings = false;

async function init() {
  bindEvents();
  await refreshState();
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function bindEvents() {
  elements.startButton.addEventListener("click", async () => {
    await runAction(elements.startButton, async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await sendMessage({ type: "START_CAPTURE", tabId: tab?.id });
      await refreshState();
    });
  });

  elements.stopButton.addEventListener("click", async () => {
    await runAction(elements.stopButton, async () => {
      await sendMessage({ type: "STOP_CAPTURE" });
      await refreshState();
    });
  });

  elements.libraryButton.addEventListener("click", async () => {
    await sendMessage({ type: "OPEN_LIBRARY" });
  });

  elements.clearButton.addEventListener("click", async () => {
    const confirmed = window.confirm("Delete all saved ScrollSnap sessions and frames from local browser storage?");
    if (!confirmed) {
      return;
    }

    await runAction(elements.clearButton, async () => {
      await sendMessage({ type: "CLEAR_ALL_DATA" });
      await refreshState();
    });
  });

  elements.captureInterval.addEventListener("change", saveSettingsFromForm);
  elements.exportImageFormat.addEventListener("change", saveSettingsFromForm);
  elements.maxFrames.addEventListener("change", saveSettingsFromForm);
  elements.duplicateSkipping.addEventListener("change", saveSettingsFromForm);

  elements.onboardingButton.addEventListener("click", async () => {
    await sendMessage({ type: "COMPLETE_ONBOARDING" });
    elements.onboardingModal.classList.add("hidden");
  });
}

async function refreshState() {
  const response = await sendMessage({ type: "GET_STATE" });
  renderState(response);
}

function renderState({ activeCapture, frameCount, sessionCount, settings, lastError, onboardingComplete }) {
  const status = activeCapture?.status === "capturing"
    ? "Capturing"
    : activeCapture?.status === "paused"
      ? "Paused"
      : "Idle";
  elements.statusBadge.textContent = status;
  elements.statusBadge.dataset.status = status.toLowerCase();
  elements.statusText.textContent = status;
  elements.frameCount.textContent = String(frameCount || 0);
  elements.sessionCount.textContent = String(sessionCount || 0);
  elements.startButton.disabled = ["capturing", "paused"].includes(activeCapture?.status);
  elements.stopButton.disabled = !["capturing", "paused"].includes(activeCapture?.status);

  const sessionLabel = activeCapture?.sessionId
    ? `${activeCapture.status === "capturing" ? "Current" : "Last"} session: ${activeCapture.title || "Untitled session"}`
    : "";
  elements.currentSessionTitle.textContent = sessionLabel;
  elements.currentSessionTitle.classList.toggle("hidden", !sessionLabel);

  const saveLocationText = activeCapture?.status === "idle" && activeCapture?.savedSummary
    ? activeCapture.savedSummary
    : activeCapture?.sessionFolder
      ? `Save location: Chrome Downloads/${activeCapture.downloadPath || `ScrollSnap/${activeCapture.sessionFolder}`}`
      : "";
  elements.saveLocation.textContent = saveLocationText;
  elements.saveLocation.classList.toggle("hidden", !saveLocationText);

  applyingSettings = true;
  elements.captureInterval.value = String(settings.captureIntervalRatio || 0.8);
  elements.exportImageFormat.value = settings.exportImageFormat || "png";
  elements.maxFrames.value = String(settings.maxFrames || 100);
  elements.duplicateSkipping.checked = Boolean(settings.duplicateSkipping);
  applyingSettings = false;

  if (lastError) {
    elements.errorMessage.textContent = lastError;
    elements.errorMessage.classList.remove("hidden");
  } else {
    elements.errorMessage.textContent = "";
    elements.errorMessage.classList.add("hidden");
  }

  elements.onboardingModal.classList.toggle("hidden", Boolean(onboardingComplete));
}

async function saveSettingsFromForm() {
  if (applyingSettings) {
    return;
  }

  try {
    await sendMessage({
      type: "SET_SETTINGS",
      settings: {
        captureIntervalRatio: Number(elements.captureInterval.value),
        exportImageFormat: elements.exportImageFormat.value,
        maxFrames: Number(elements.maxFrames.value),
        duplicateSkipping: elements.duplicateSkipping.checked
      }
    });
    elements.errorMessage.textContent = "";
    elements.errorMessage.classList.add("hidden");
  } catch (error) {
    elements.errorMessage.textContent = error.message || "Unable to save settings.";
    elements.errorMessage.classList.remove("hidden");
  }
}

function onStorageChanged(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (
    changes["scrollsnap.activeCapture"] ||
    changes["scrollsnap.lastError"] ||
    changes["scrollsnap.settings"] ||
    changes["scrollsnap.onboardingComplete"] ||
    changes["scrollsnap.uiRevision"]
  ) {
    refreshState().catch((error) => {
      console.error("Unable to refresh popup state", error);
    });
  }
}

async function runAction(button, action) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Working...";

  try {
    await action();
    elements.errorMessage.textContent = "";
    elements.errorMessage.classList.add("hidden");
  } catch (error) {
    elements.errorMessage.textContent = error.message || "Something went wrong.";
    elements.errorMessage.classList.remove("hidden");
  } finally {
    button.textContent = originalText;
    await refreshState().catch(() => {});
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
  renderState({
    activeCapture: { status: "idle" },
    frameCount: 0,
    sessionCount: 0,
    settings: {
      captureIntervalRatio: 0.8,
      exportImageFormat: "png",
      maxFrames: 100,
      duplicateSkipping: true
    },
    onboardingComplete: true,
    lastError: error.message || "Unable to load popup."
  });
});
