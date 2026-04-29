const DB_NAME = "scrollsnap-db";
const DB_VERSION = 1;
const SESSIONS_STORE = "sessions";
const FRAMES_STORE = "frames";

let dbPromise = null;

// ScrollSnap stores sessions and screenshots in IndexedDB, which is local browser storage.
export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error("IndexedDB is unavailable in this browser context."));
      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const sessionStore = db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
          sessionStore.createIndex("updatedAt", "updatedAt", { unique: false });
          sessionStore.createIndex("createdAt", "createdAt", { unique: false });
        }

        if (!db.objectStoreNames.contains(FRAMES_STORE)) {
          const frameStore = db.createObjectStore(FRAMES_STORE, { keyPath: "id" });
          frameStore.createIndex("sessionId", "sessionId", { unique: false });
          frameStore.createIndex("sessionId_index", ["sessionId", "index"], { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  return dbPromise;
}

export async function createSession(metadata) {
  const db = await openDb();
  const record = {
    id: metadata.id,
    title: metadata.title,
    sourceUrl: metadata.sourceUrl || "",
    pageTitle: metadata.pageTitle || "",
    hostname: metadata.hostname || "",
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt || metadata.createdAt,
    frameCount: metadata.frameCount || 0,
    firstFrameId: metadata.firstFrameId || null,
    previewDataUrl: metadata.previewDataUrl || "",
    captureSettings: metadata.captureSettings || {}
  };

  await executeWrite(db, [SESSIONS_STORE], (tx) => {
    tx.objectStore(SESSIONS_STORE).add(record);
  });

  return record;
}

export async function updateSession(sessionId, updates) {
  const db = await openDb();
  return executeReadWrite(db, [SESSIONS_STORE], async (tx) => {
    const store = tx.objectStore(SESSIONS_STORE);
    const session = await requestToPromise(store.get(sessionId));

    if (!session) {
      throw new Error("Session not found.");
    }

    const next = {
      ...session,
      ...updates,
      updatedAt: updates.updatedAt || new Date().toISOString()
    };

    store.put(next);
    return next;
  });
}

export async function getSessions() {
  const db = await openDb();
  const sessions = await executeReadonly(db, [SESSIONS_STORE], async (tx) => {
    return requestToPromise(tx.objectStore(SESSIONS_STORE).getAll());
  });

  return sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getSession(sessionId) {
  const db = await openDb();
  return executeReadonly(db, [SESSIONS_STORE], async (tx) => {
    return requestToPromise(tx.objectStore(SESSIONS_STORE).get(sessionId));
  });
}

export async function addFrame(sessionId, frame) {
  const db = await openDb();
  return executeReadWrite(db, [SESSIONS_STORE, FRAMES_STORE], async (tx) => {
    const sessionsStore = tx.objectStore(SESSIONS_STORE);
    const framesStore = tx.objectStore(FRAMES_STORE);
    const session = await requestToPromise(sessionsStore.get(sessionId));

    if (!session) {
      throw new Error("Session not found for frame storage.");
    }

    framesStore.add(frame);

    const nextSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      frameCount: (session.frameCount || 0) + 1,
      firstFrameId: session.firstFrameId || frame.id,
      previewDataUrl: session.previewDataUrl || frame.dataUrl
    };

    sessionsStore.put(nextSession);
    return nextSession;
  });
}

export async function getFrames(sessionId) {
  const db = await openDb();
  const frames = await executeReadonly(db, [FRAMES_STORE], async (tx) => {
    return requestToPromise(tx.objectStore(FRAMES_STORE).index("sessionId").getAll(sessionId));
  });

  return frames.sort((a, b) => a.index - b.index);
}

export async function deleteFrame(frameId) {
  const db = await openDb();
  return executeReadWrite(db, [SESSIONS_STORE, FRAMES_STORE], async (tx) => {
    const sessionsStore = tx.objectStore(SESSIONS_STORE);
    const framesStore = tx.objectStore(FRAMES_STORE);
    const frame = await requestToPromise(framesStore.get(frameId));

    if (!frame) {
      throw new Error("Frame not found.");
    }

    framesStore.delete(frameId);

    const remainingFrames = (await requestToPromise(framesStore.index("sessionId").getAll(frame.sessionId)))
      .filter((item) => item.id !== frameId)
      .sort((a, b) => a.index - b.index)
      .map((item, index) => ({ ...item, index: index + 1 }));

    for (const item of remainingFrames) {
      framesStore.put(item);
    }

    const session = await requestToPromise(sessionsStore.get(frame.sessionId));
    if (session) {
      sessionsStore.put({
        ...session,
        updatedAt: new Date().toISOString(),
        frameCount: remainingFrames.length,
        firstFrameId: remainingFrames[0]?.id || null,
        previewDataUrl: remainingFrames[0]?.dataUrl || ""
      });
    }

    return {
      sessionId: frame.sessionId,
      frameCount: remainingFrames.length
    };
  });
}

export async function deleteSession(sessionId) {
  const db = await openDb();
  return executeWrite(db, [SESSIONS_STORE, FRAMES_STORE], async (tx) => {
    const framesStore = tx.objectStore(FRAMES_STORE);
    const frames = await requestToPromise(framesStore.index("sessionId").getAll(sessionId));

    for (const frame of frames) {
      framesStore.delete(frame.id);
    }

    tx.objectStore(SESSIONS_STORE).delete(sessionId);
  });
}

export async function clearAllData() {
  const db = await openDb();
  return executeWrite(db, [SESSIONS_STORE, FRAMES_STORE], (tx) => {
    tx.objectStore(SESSIONS_STORE).clear();
    tx.objectStore(FRAMES_STORE).clear();
  });
}

async function executeReadonly(db, stores, callback) {
  const tx = db.transaction(stores, "readonly");
  const result = await callback(tx);
  await transactionDone(tx);
  return result;
}

async function executeWrite(db, stores, callback) {
  const tx = db.transaction(stores, "readwrite");
  await callback(tx);
  await transactionDone(tx);
}

async function executeReadWrite(db, stores, callback) {
  const tx = db.transaction(stores, "readwrite");
  const result = await callback(tx);
  await transactionDone(tx);
  return result;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction was aborted."));
  });
}
