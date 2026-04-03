import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FB      = "https://studybuddytcet-default-rtdb.firebaseio.com";
const PDF_TTL = 60 * 60 * 24 * 10;
const PDF_CHUNK_BASE64_SIZE = 500 * 1024;
const PDF_CHUNK_BYTE_SIZE = (PDF_CHUNK_BASE64_SIZE / 4) * 3;

function normalizeSem(raw) {
  if (!raw) return "";
  const s = raw.toString().trim();
  if (/^Sem:\d+$/.test(s)) return s;
  const n = s.replace(/[^0-9]/g, "");
  return n ? `Sem:${n}` : s;
}

async function getOrFetchMeta(basePath, metaKey) {
  try {
    const cached = await redis.get(metaKey);
    if (cached !== null && cached !== undefined) {
      console.log(`[pdf] ✅ META from REDIS — key: ${metaKey}`);
      return { data: cached, source: "redis" };
    }
  } catch (e) {
    console.warn("[pdf] Redis read meta error:", e.message);
  }

  console.log(`[pdf] 🔴 META from FIREBASE — key: ${metaKey}`);
  const res = await fetch(`${FB}/${basePath}/pdfMeta.json`);
  if (!res.ok) throw new Error(`Firebase meta ${res.status}`);
  const data = await res.json();
  if (!data) return { data: null, source: "firebase" };

  try {
    await redis.set(metaKey, data, { ex: PDF_TTL });
    console.log(`[pdf] Redis SET meta: ${metaKey}`);
  } catch (e) {
    console.warn("[pdf] Redis set meta failed:", e.message);
  }

  return { data, source: "firebase" };
}

function decodeBase64Chunk(chunk) {
  if (!chunk) return new Uint8Array(0);
  const bin = atob(chunk);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getOrFetchChunk(basePath, baseChunksKey, index) {
  const chunkKey = `${baseChunksKey}:${index}`;
  try {
    const cached = await redis.get(chunkKey);
    if (cached !== null && cached !== undefined) {
      console.log(`[pdf] ✅ Redis HIT chunk ${index}: ${chunkKey}`);
      return { data: cached, source: "redis" };
    }
  } catch (e) {
    console.warn(`[pdf] Redis read chunk ${index} error:`, e.message);
  }

  try {
    const res = await fetch(`${FB}/${basePath}/pdfChunks/chunk_${index}.json`);
    if (!res.ok) throw new Error(`Firebase chunk ${res.status}`);
    const data = await res.json();
    if (!data) return { data: null, source: "firebase" };
    try {
      await redis.set(chunkKey, data, { ex: PDF_TTL });
      console.log(`[pdf] Redis SET chunk ${index}: ${chunkKey}`);
    } catch (e) {
      console.warn(`[pdf] Redis set chunk ${index} failed:`, e.message);
    }
    console.log(`[pdf] 🔴 Fetched chunk ${index} from FIREBASE`);
    return { data, source: "firebase" };
  } catch (e) {
    console.warn(`[pdf] Firebase chunk ${index} error:`, e.message);
    return { data: null, source: "firebase" };
  }
}

async function getOrFetchChunks(basePath, baseChunksKey, metaKey) {
  // ── Step 1: Get meta ──
  const { data: meta } = await getOrFetchMeta(basePath, metaKey);
  if (!meta) return { data: null };

  const { totalChunks } = meta;
  if (!totalChunks) throw new Error("totalChunks missing in meta");

  // ── Step 2: Check for OLD bloated key and migrate ──
  const oldKey = baseChunksKey.replace("sb:pdf:chunk:", "sb:pdf:chunks:");
  try {
    const oldCached = await redis.get(oldKey);
    if (oldCached !== null && oldCached !== undefined) {
      console.log(`[pdf] Redis HIT (old key): ${oldKey} — migrating to per-chunk keys`);
      const chunks = Array.isArray(oldCached) ? oldCached : [];
      await Promise.all(
        chunks.map(async (chunk, i) => {
          const chunkKey = `${baseChunksKey}:${i}`;
          try {
            await redis.set(chunkKey, chunk, { ex: PDF_TTL });
          } catch (e) {
            console.warn(`[pdf] Migration set chunk ${i} failed:`, e.message);
          }
        })
      );
      redis.del(oldKey).catch(() => {});
      console.log(`[pdf] ✅ Migrated ${chunks.length} chunks from old key, served from REDIS`);
      return { data: chunks, source: "redis" };
    }
  } catch (e) {
    console.warn("[pdf] Old key check failed:", e.message);
  }

  // ── Step 3: Try per-chunk Redis keys, collect misses ──
  const chunkResults = await Promise.all(
    Array.from({ length: totalChunks }, async (_, i) => {
      const chunkKey = `${baseChunksKey}:${i}`;
      try {
        const cached = await redis.get(chunkKey);
        if (cached !== null && cached !== undefined) {
          console.log(`[pdf] ✅ Redis HIT chunk ${i}: ${chunkKey}`);
          return { index: i, data: cached, fromRedis: true };
        }
      } catch (e) {
        console.warn(`[pdf] Redis read chunk ${i} error:`, e.message);
      }
      console.log(`[pdf] ❌ Redis MISS chunk ${i}: ${chunkKey}`);
      return { index: i, data: null, fromRedis: false };
    })
  );

  // ── Step 4: Only fetch MISSING chunks from Firebase ──
  const missingIndices = chunkResults
    .filter(r => !r.fromRedis)
    .map(r => r.index);

  if (missingIndices.length === 0) {
    console.log(`[pdf] ✅ ALL ${totalChunks}/${totalChunks} chunks served from REDIS`);
    return { data: chunkResults.map(r => r.data), source: "redis" };
  }

  const redisHits = totalChunks - missingIndices.length;

  if (missingIndices.length === totalChunks) {
    console.log(`[pdf] 🔴 ALL ${totalChunks}/${totalChunks} chunks served from FIREBASE (cold cache)`);
  } else {
    console.log(`[pdf] 🔀 MIXED — ${redisHits}/${totalChunks} from REDIS, ${missingIndices.length}/${totalChunks} from FIREBASE (missing indices: [${missingIndices.join(", ")}])`);
  }

  const fetchedChunks = await Promise.all(
    missingIndices.map(async (i) => {
      const res = await fetch(`${FB}/${basePath}/pdfChunks/chunk_${i}.json`);
      const data = await res.json();
      console.log(`[pdf] 🔴 Fetched chunk ${i} from FIREBASE`);
      return { index: i, data };
    })
  );

  // ── Step 5: Cache newly fetched chunks in Redis ──
  await Promise.all(
    fetchedChunks.map(async ({ index: i, data: chunk }) => {
      if (!chunk) return;
      const chunkKey = `${baseChunksKey}:${i}`;
      try {
        await redis.set(chunkKey, chunk, { ex: PDF_TTL });
        console.log(`[pdf] Redis SET chunk ${i}: ${chunkKey}`);
      } catch (e) {
        console.warn(`[pdf] Redis set chunk ${i} failed:`, e.message);
      }
    })
  );

  // ── Step 6: Merge Redis + Firebase results in order ──
  const fetchedMap = new Map(fetchedChunks.map(({ index, data }) => [index, data]));
  const allChunks = chunkResults
    .map(r => r.fromRedis ? r.data : fetchedMap.get(r.index))
    .filter(Boolean);

  const source = missingIndices.length === totalChunks ? "firebase" : "mixed";
  console.log(`[pdf] 📦 Final response — source: ${source.toUpperCase()}, total chunks returned: ${allChunks.length}/${totalChunks}`);
  return { data: allChunks, source };
}

async function getPdfRange(basePath, baseChunksKey, metaKey, start, end) {
  const { data: meta } = await getOrFetchMeta(basePath, metaKey);
  if (!meta) return { data: null, totalBytes: 0, source: "firebase" };

  const totalBytes = Number(meta.fileSize) || (Number(meta.totalChunks) || 0) * PDF_CHUNK_BYTE_SIZE;
  if (!totalBytes) throw new Error("fileSize missing in meta");

  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.min(totalBytes - 1, Number.isFinite(Number(end)) ? Number(end) : safeStart + PDF_CHUNK_BYTE_SIZE - 1);
  if (safeStart > safeEnd || safeStart >= totalBytes) {
    return { data: new Uint8Array(0), totalBytes, source: "redis" };
  }

  const startChunk = Math.floor(safeStart / PDF_CHUNK_BYTE_SIZE);
  const endChunk = Math.floor(safeEnd / PDF_CHUNK_BYTE_SIZE);
  const parts = [];
  let source = "redis";

  for (let i = startChunk; i <= endChunk; i++) {
    const { data: chunk, source: chunkSource } = await getOrFetchChunk(basePath, baseChunksKey, i);
    if (!chunk) throw new Error(`Missing chunk ${i}`);
    if (chunkSource !== "redis") source = source === "redis" ? chunkSource : "mixed";
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
  return { data: slice, totalBytes, source };
}

async function getPdfFullFile(basePath, baseChunksKey, metaKey) {
  const { data: meta } = await getOrFetchMeta(basePath, metaKey);
  if (!meta) return { data: null, totalBytes: 0, source: "firebase" };

  const { data: chunks, source } = await getOrFetchChunks(basePath, baseChunksKey, metaKey);
  if (!chunks?.length) return { data: null, totalBytes: 0, source };

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
  };
}

async function buildPdfFileResponse(basePath, baseChunksKey, metaKey, request) {
  const rangeHeader = request.headers.get("range") || request.headers.get("Range");
  if (!rangeHeader) {
    const { data, totalBytes, source } = await getPdfFullFile(basePath, baseChunksKey, metaKey);
    if (!data) return Response.json({ error: "PDF data not found" }, { status: 404 });

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(data.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-PDF-Source": source,
        "X-PDF-Total-Bytes": String(totalBytes),
      },
    });
  }

  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/i);
  if (!match) return Response.json({ error: "Invalid range" }, { status: 416 });

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;

  const { data, totalBytes, source } = await getPdfRange(basePath, baseChunksKey, metaKey, start, end);
  if (!data) return Response.json({ error: "PDF data not found" }, { status: 404 });

  const actualEnd = start + data.length - 1;
  return new Response(data, {
    status: 206,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(data.length),
      "Content-Range": `bytes ${start}-${actualEnd}/${totalBytes}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-PDF-Source": source,
    },
  });
}

async function primePdfCache(branch, sem, subject, module) {
  const metaKey = `sb:pdf:meta:${branch}:${sem}:${subject}:${module}`;
  const baseChunksKey = `sb:pdf:chunk:${branch}:${sem}:${subject}:${module}`;
  const basePath = `notes/${encodeURIComponent(branch)}/${encodeURIComponent(sem)}/subjects/${encodeURIComponent(subject)}/modules/${encodeURIComponent(module)}`;

  const { data: chunks, source } = await getOrFetchChunks(basePath, baseChunksKey, metaKey);
  return { data: chunks, source };
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

  const metaKey       = `sb:pdf:meta:${branch}:${sem}:${subject}:${module}`;
  const baseChunksKey = `sb:pdf:chunk:${branch}:${sem}:${subject}:${module}`;
  const basePath      = `notes/${encodeURIComponent(branch)}/${encodeURIComponent(sem)}/subjects/${encodeURIComponent(subject)}/modules/${encodeURIComponent(module)}`;

  try {
    if (type === "meta") {
      const { data, source } = await getOrFetchMeta(basePath, metaKey);
      return Response.json({ data, source });
    } else if (type === "file") {
      return await buildPdfFileResponse(basePath, baseChunksKey, metaKey, request);
    } else {
      const { data, source } = await getOrFetchChunks(basePath, baseChunksKey, metaKey);
      if (!data) return Response.json({ data: null });
      return Response.json({ data, source });
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

    const { data, source } = await primePdfCache(branch, sem, subject, module);
    return Response.json({ data: !!data, source });
  } catch (err) {
    console.error("[pdf] ❌ Prime route error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}