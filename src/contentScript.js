let isObserving = false;
let debounceTimer = null;
let pollTimer = null;
let lastSentScrollY = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case "PING_SCROLLSNAP":
      sendResponse({ ok: true });
      break;
    case "GET_PAGE_INFO":
      sendResponse(getPageInfo());
      break;
    case "BEGIN_CAPTURE_OBSERVATION":
      beginObservation();
      sendResponse({ ok: true });
      break;
    case "END_CAPTURE_OBSERVATION":
      endObservation();
      sendResponse({ ok: true });
      break;
    default:
      break;
  }

  return true;
});

function beginObservation() {
  if (isObserving) {
    return;
  }

  isObserving = true;
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  lastSentScrollY = getScrollY();
  pollTimer = window.setInterval(() => {
    if (!isObserving) {
      return;
    }

    queueScrollReport();
  }, 400);
}

function endObservation() {
  isObserving = false;
  window.removeEventListener("scroll", onScroll);
  document.removeEventListener("scroll", onScroll, { capture: true });

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  lastSentScrollY = null;
}

function onScroll() {
  if (!isObserving) {
    return;
  }

  queueScrollReport();
}

function queueScrollReport() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    const pageInfo = getPageInfo();

    if (pageInfo.scrollY === lastSentScrollY) {
      return;
    }

    lastSentScrollY = pageInfo.scrollY;
    chrome.runtime.sendMessage({
      type: "SCROLL_EVENT",
      payload: pageInfo
    });
  }, 150);
}

function getPageInfo() {
  const documentElement = document.documentElement;
  const body = document.body;
  const documentHeight = Math.max(
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    documentElement?.clientHeight || 0,
    documentElement?.scrollHeight || 0,
    documentElement?.offsetHeight || 0
  );

  return {
    scrollY: getScrollY(),
    viewportHeight: window.innerHeight,
    documentHeight,
    url: window.location.href,
    title: document.title
  };
}

function getScrollY() {
  const scrollingElement = document.scrollingElement || document.documentElement || document.body;

  return Math.round(
    Math.max(
      window.scrollY || 0,
      scrollingElement?.scrollTop || 0,
      document.documentElement?.scrollTop || 0,
      document.body?.scrollTop || 0
    )
  );
}
