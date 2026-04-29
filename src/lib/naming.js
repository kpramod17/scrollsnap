export function buildSessionTitle(pageTitle, sourceUrl) {
  const base = pageTitle?.trim() || extractHostname(sourceUrl) || "ScrollSnap session";
  return base.length > 72 ? `${base.slice(0, 69)}...` : base;
}

export function buildFrameFilename({ title, url, index, timestamp, extension = "png" }) {
  const slug = buildSlug(title || extractHostname(url) || "scrollsnap", 10);
  const frameNumber = String(index).padStart(3, "0");
  const stamp = formatLocalTimestamp(timestamp);
  return `${slug}_${frameNumber}_${stamp}.${extension}`;
}

export function buildSessionSlug(session) {
  return buildSlug(
    session?.title || session?.pageTitle || session?.hostname || session?.sourceUrl || "scrollsnap",
    10
  );
}

export function buildExportFilename(session, timestamp, suffix = "") {
  const slug = buildSessionSlug(session);
  const stamp = formatLocalTimestamp(timestamp);
  const middle = suffix ? `_${suffix}` : "";
  return `scrollsnap_${slug}_${stamp}${middle}`;
}

export function buildSessionFolderName(session, timestamp) {
  return buildExportFilename(session, timestamp);
}

export function buildSlug(input, maxLength = 10) {
  const normalized = String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, maxLength);

  return normalized || "scrollsnap";
}

export function extractHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

export function formatLocalTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("") + "-" + [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join("");
}

export function formatDisplayDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}
