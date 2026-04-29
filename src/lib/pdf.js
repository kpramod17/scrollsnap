import { dataUrlToUint8Array, dataUrlToJpegDataUrl } from "./data.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;

export async function buildSessionPdf(session, frames) {
  const objects = [];
  const pageIds = [];
  const fontObjectId = 3;
  let objectId = 4;

  objects[1] = textObject("<< /Type /Catalog /Pages 2 0 R >>");

  for (const frame of frames) {
    const prepared = await preparePdfImage(frame.dataUrl);
    const imageObjectId = objectId;
    const contentObjectId = objectId + 1;
    const pageObjectId = objectId + 2;
    objectId += 3;

    const content = buildPageContent(session, frame, prepared);
    objects[imageObjectId] = binaryStreamObject(
      `<< /Type /XObject /Subtype /Image /Width ${prepared.width} /Height ${prepared.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${prepared.bytes.length} >>`,
      prepared.bytes
    );
    objects[contentObjectId] = textStreamObject(content);
    objects[pageObjectId] = textObject(
      [
        "<< /Type /Page",
        "/Parent 2 0 R",
        `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
        `/Resources << /Font << /F1 ${fontObjectId} 0 R >> /XObject << /Im1 ${imageObjectId} 0 R >> >>`,
        `/Contents ${contentObjectId} 0 R`,
        ">>"
      ].join(" ")
    );

    pageIds.push(pageObjectId);
  }

  objects[2] = textObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  objects[3] = textObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  return buildPdfDocument(objects);
}

async function preparePdfImage(dataUrl) {
  const jpegDataUrl = await dataUrlToJpegDataUrl(dataUrl, 0.9);
  const image = await loadImageElement(jpegDataUrl);
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    bytes: dataUrlToUint8Array(jpegDataUrl)
  };
}

function buildPageContent(session, frame, prepared) {
  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const usableHeight = PAGE_HEIGHT - 210;
  const scale = Math.min(usableWidth / prepared.width, usableHeight / prepared.height);
  const imageWidth = prepared.width * scale;
  const imageHeight = prepared.height * scale;
  const imageX = (PAGE_WIDTH - imageWidth) / 2;
  const imageY = 110;

  return [
    "BT",
    "/F1 18 Tf",
    `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - 44} Tm`,
    `(${escapePdfText(session.title || "ScrollSnap Session")}) Tj`,
    "ET",
    "BT",
    "/F1 10 Tf",
    `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - 62} Tm`,
    `(${escapePdfText(session.sourceUrl || "")}) Tj`,
    "ET",
    "q",
    `${imageWidth.toFixed(2)} 0 0 ${imageHeight.toFixed(2)} ${imageX.toFixed(2)} ${imageY.toFixed(2)} cm`,
    "/Im1 Do",
    "Q",
    "BT",
    "/F1 11 Tf",
    `1 0 0 1 ${MARGIN} 72 Tm`,
    `(${escapePdfText(`Frame ${String(frame.index).padStart(3, "0")} • ${frame.filename}`)}) Tj`,
    "ET",
    "BT",
    "/F1 10 Tf",
    `1 0 0 1 ${MARGIN} 54 Tm`,
    `(${escapePdfText(`Captured ${new Date(frame.timestamp).toLocaleString()} • Scroll ${frame.scrollY}px`)}) Tj`,
    "ET"
  ].join("\n");
}

function buildPdfDocument(objects) {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")];
  const offsets = [0];
  let size = chunks[0].length;

  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) {
      continue;
    }

    offsets[id] = size;
    const objectChunk = objects[id](id, encoder);
    chunks.push(objectChunk);
    size += objectChunk.length;
  }

  const xrefOffset = size;
  const xrefLines = [`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n"];
  for (let id = 1; id < objects.length; id += 1) {
    xrefLines.push(`${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`);
  }

  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(encoder.encode(xrefLines.join("")));
  chunks.push(encoder.encode(trailer));

  return concatChunks(chunks);
}

function textObject(body) {
  return (id, encoder) => encoder.encode(`${id} 0 obj\n${body}\nendobj\n`);
}

function textStreamObject(content) {
  return (id, encoder) => {
    const bytes = encoder.encode(content);
    return concatChunks([
      encoder.encode(`${id} 0 obj\n<< /Length ${bytes.length} >>\nstream\n`),
      bytes,
      encoder.encode("\nendstream\nendobj\n")
    ]);
  };
}

function binaryStreamObject(dictionary, bytes) {
  return (id, encoder) => concatChunks([
    encoder.encode(`${id} 0 obj\n${dictionary}\nstream\n`),
    bytes,
    encoder.encode("\nendstream\nendobj\n")
  ]);
}

function concatChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function escapePdfText(text) {
  return String(text || "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to prepare image for PDF export."));
    image.src = dataUrl;
  });
}
