import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FB      = "https://studybuddytcet-default-rtdb.firebaseio.com";
const PDF_TTL = 60 * 60 * 24 * 10; // 10 days
const PDF_CHUNK_BASE64_SIZE = 500 * 1024;
const PDF_CHUNK_BYTE_SIZE = (PDF_CHUNK_BASE64_SIZE / 4) * 3;

function normalizeSem(raw) {
  if (!raw) return "";
  const s = raw.toString().trim();
  if (/^Sem:\d+$/.test(s)) return s;
  const n = s.replace(/[^0-9]/g, "");
  return n ? `Sem:${n}` : s;
}

function decodeBase64Chunk(chunk) {
  if (!chunk) return new Uint8Array(0);
  const bin = atob(chunk);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Single-call Document loader:
 * 1. Checks Redis for `docKey` in a single command.
 * 2. On miss, fetches the module from Firebase in 1 single HTTP call.
 * 3. Assembles chunks and caches the entire `{ meta, chunks }` in Redis in 1 single command.
 */
async function getOrFetchDoc(basePath, docKey, metaKey) {
  // ── Step 1: 1 Single Redis call for the entire document ──
  try {
    const cachedDoc = await redis.get(docKey);
    if (cachedDoc && typeof cachedDoc === "object" && cachedDoc.meta) {
      const chunks = Array.isArray(cachedDoc.chunks) ? cachedDoc.chunks : [];
      console.log(`[pdf] ✅ ⚡ 1-CALL REDIS HIT — docKey: ${docKey} (chunks: ${chunks.length})`);
      return { meta: cachedDoc.meta, chunks, source: "redis" };
    }
  } catch (e) {
    console.warn(`[pdf] Redis read doc error (${docKey}):`, e.message);
  }

  // Fallback check for separate metaKey if previously set
  let fallbackMeta = null;
  try {
    fallbackMeta = await redis.get(metaKey);
  } catch {}

  // ── Step 2: 1 Single Firebase RTDB call for the entire module ──
  console.log(`[pdf] 🔴 REDIS MISS — Fetching module from Firebase in 1 call: ${basePath}`);
  const res = await fetch(`${FB}/${basePath}.json`);
  if (!res.ok) throw new Error(`Firebase module error ${res.status}`);
  const moduleData = await res.json();
  if (!moduleData) return { meta: null, chunks: [], source: "firebase" };

  const meta = moduleData.pdfMeta || fallbackMeta || null;
  const rawChunks = moduleData.pdfChunks || {};

  const totalChunks = meta?.totalChunks || Object.keys(rawChunks).length;
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkVal = rawChunks[`chunk_${i}`] || rawChunks[i] || "";
    if (chunkVal) chunks.push(chunkVal);
  }

  // ── Step 3: Cache doc and meta in Redis in 1 call (with pipeline) ──
  if (meta && chunks.length > 0) {
    try {
      const p = redis.pipeline();
      const docPayload = JSON.stringify({ meta, chunks });
      p.set(docKey, docPayload, { ex: PDF_TTL });
      p.set(metaKey, JSON.stringify(meta), { ex: PDF_TTL });
      await p.exec();
      console.log(`[pdf] ✅ Redis CACHED doc in 1 pipeline call (${chunks.length} chunks)`);
    } catch (e) {
      console.warn(`[pdf] Redis set doc failed:`, e.message);
    }
  }

  return { meta, chunks, source: "firebase" };
}

/**
 * Loads metadata:
 * Checks Redis metaKey first. If not found, uses getOrFetchDoc which loads and caches everything.
 */
async function getOrFetchMeta(basePath, docKey, metaKey) {
  try {
    const cachedMeta = await redis.get(metaKey);
    if (cachedMeta && typeof cachedMeta === "object") {
      console.log(`[pdf] ✅ META from REDIS (1 call) — key: ${metaKey}`);
      return { data: cachedMeta, source: "redis" };
    }
  } catch (e) {
    console.warn("[pdf] Redis read meta error:", e.message);
  }

  // If meta wasn't cached separately, getOrFetchDoc will fetch and cache both doc & meta in 1 pass
  const { meta, source } = await getOrFetchDoc(basePath, docKey, metaKey);
  return { data: meta, source };
}

async function getPdfRange(basePath, docKey, metaKey, start, end) {
  const { meta, chunks, source } = await getOrFetchDoc(basePath, docKey, metaKey);
  if (!meta || !chunks.length) return { data: null, totalBytes: 0, source };

  const totalBytes = Number(meta.fileSize) || chunks.length * PDF_CHUNK_BYTE_SIZE;
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.min(totalBytes - 1, Number.isFinite(Number(end)) ? Number(end) : safeStart + PDF_CHUNK_BYTE_SIZE - 1);
  if (safeStart > safeEnd || safeStart >= totalBytes) {
    return { data: new Uint8Array(0), totalBytes, source };
  }

  const startChunk = Math.floor(safeStart / PDF_CHUNK_BYTE_SIZE);
  const endChunk = Math.min(chunks.length - 1, Math.floor(safeEnd / PDF_CHUNK_BYTE_SIZE));
  const parts = [];

  for (let i = startChunk; i <= endChunk; i++) {
    const chunk = chunks[i];
    if (!chunk) throw new Error(`Missing chunk ${i}`);
    parts.push(decodeBase64Chunk(chunk));
  }

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  const relativeStart = safeStart - (startChunk * PDF_CHUNK_BYTE_SIZE);
  const slice = merged.slice(relativeStart, relativeStart + (safeEnd - safeStart + 1));
  return { data: slice, totalBytes, source, contentType: meta.contentType || "application/pdf" };
}

async function getPdfFullFile(basePath, docKey, metaKey) {
  const { meta, chunks, source } = await getOrFetchDoc(basePath, docKey, metaKey);
  if (!meta || !chunks.length) return { data: null, totalBytes: 0, source };

  const parts = chunks.map(decodeBase64Chunk);
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  return {
    data: merged,
    totalBytes: Number(meta.fileSize) || merged.length,
    source,
    contentType: meta.contentType || "application/pdf",
  };
}

async function buildPdfFileResponse(basePath, docKey, metaKey, request) {
  const rangeHeader = request.headers.get("range") || request.headers.get("Range");
  if (!rangeHeader) {
    const { data, totalBytes, source, contentType } = await getPdfFullFile(basePath, docKey, metaKey);
    if (!data) return Response.json({ error: "PDF data not found" }, { status: 404 });

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(data.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-PDF-Source": source,
        "X-PDF-Total-Bytes": String(totalBytes),
      },
    });
  }

  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/i);
  if (!match) return Response.json({ error: "Invalid range" }, { status: 416 });

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;

  const { data, totalBytes, source, contentType } = await getPdfRange(basePath, docKey, metaKey, start, end);
  if (!data) return Response.json({ error: "PDF data not found" }, { status: 404 });

  const actualEnd = start + data.length - 1;
  return new Response(data, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Content-Range": `bytes ${start}-${actualEnd}/${totalBytes}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-PDF-Source": source,
    },
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const branch  = searchParams.get("branch");
  const sem     = normalizeSem(searchParams.get("sem"));
  const subject = searchParams.get("subject");
  const module  = searchParams.get("module");
  const type    = searchParams.get("type") || "meta";

  if (!branch || !sem || !subject || !module) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }
  if (type !== "meta" && type !== "chunks" && type !== "file") {
    return Response.json({ error: "Invalid type" }, { status: 400 });
  }

  const metaKey = `sb:pdf:meta:${branch}:${sem}:${subject}:${module}`;
  const docKey  = `sb:pdf:doc:${branch}:${sem}:${subject}:${module}`;
  const basePath = `notes/${encodeURIComponent(branch)}/${encodeURIComponent(sem)}/subjects/${encodeURIComponent(subject)}/modules/${encodeURIComponent(module)}`;

  try {
    if (type === "meta") {
      const { data, source } = await getOrFetchMeta(basePath, docKey, metaKey);
      return Response.json({ data, source });
    } else if (type === "file") {
      return await buildPdfFileResponse(basePath, docKey, metaKey, request);
    } else {
      // type === "chunks"
      const { chunks, source } = await getOrFetchDoc(basePath, docKey, metaKey);
      if (!chunks || chunks.length === 0) return Response.json({ data: null, source });
      return Response.json({ data: chunks, source });
    }
  } catch (err) {
    console.error("[pdf] ❌ Route error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const branch = body?.branch;
    const sem = normalizeSem(body?.sem);
    const subject = body?.subject;
    const module = body?.module;

    if (!branch || !sem || !subject || !module) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const metaKey = `sb:pdf:meta:${branch}:${sem}:${subject}:${module}`;
    const docKey  = `sb:pdf:doc:${branch}:${sem}:${subject}:${module}`;
    const basePath = `notes/${encodeURIComponent(branch)}/${encodeURIComponent(sem)}/subjects/${encodeURIComponent(subject)}/modules/${encodeURIComponent(module)}`;

    const { meta, chunks, source } = await getOrFetchDoc(basePath, docKey, metaKey);
    return Response.json({ data: !!(meta && chunks.length), source });
  } catch (err) {
    console.error("[pdf] ❌ Prime route error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
