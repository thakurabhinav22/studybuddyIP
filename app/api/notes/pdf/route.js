import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FB      = "https://studybuddytcet-default-rtdb.firebaseio.com";
const PDF_TTL = 60 * 60 * 24 * 10; // 10 days in seconds

function normalizeSem(raw) {
  if (!raw) return "";
  const s = raw.toString().trim();
  if (/^Sem:\d+$/.test(s)) return s;
  const n = s.replace(/[^0-9]/g, "");
  return n ? `Sem:${n}` : s;
}

async function setWithTTL(key, value, ttlSeconds) {
  return redis.set(key, value, { ex: ttlSeconds });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const branch  = searchParams.get("branch");
  const sem     = normalizeSem(searchParams.get("sem"));
  const subject = searchParams.get("subject");
  const module  = searchParams.get("module");
  const type    = searchParams.get("type") || "meta"; // "meta" | "chunks"

  if (!branch || !sem || !subject || !module) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const baseCacheKey = `sb:pdf:${branch}:${sem}:${subject}:${module}`;
  const legacyTypeKey = `sb:pdf:${type}:${branch}:${sem}:${subject}:${module}`;

  // ── 1. Redis hit ──
  try {
    const cachedBase = await redis.get(baseCacheKey);
    const cachedLegacy = cachedBase || await redis.get(legacyTypeKey);

    if (cachedLegacy) {
      if (type === "meta" && cachedLegacy.meta) {
        return Response.json({ data: cachedLegacy.meta, source: "redis" });
      }
      if (type === "chunks" && cachedLegacy.chunks) {
        return Response.json({ data: cachedLegacy.chunks, source: "redis" });
      }
    }
  } catch (e) {
    console.warn("[pdf] Redis get failed:", e.message);
  }

  // ── 2. Firebase REST fallback ──
  const basePath = `notes/${encodeURIComponent(branch)}/${encodeURIComponent(sem)}/subjects/${encodeURIComponent(subject)}/modules/${encodeURIComponent(module)}`;

  try {
    if (type === "meta") {
      const res  = await fetch(`${FB}/${basePath}/pdfMeta.json`);
      if (!res.ok) return Response.json({ error: `Firebase HTTP ${res.status}` }, { status: 502 });

      const data = await res.json();
      if (!data) return Response.json({ data: null });

      try {
        const existing = (await redis.get(baseCacheKey)) || {};
        const payload = { ...existing, meta: data };
        await setWithTTL(baseCacheKey, payload, PDF_TTL);
        await setWithTTL(legacyTypeKey, data, PDF_TTL);
      } catch {}
      return Response.json({ data, source: "firebase" });

    } else if (type === "chunks") {
      // First get meta to know totalChunks
      const metaRes = await fetch(`${FB}/${basePath}/pdfMeta.json`);
      if (!metaRes.ok) return Response.json({ error: `Firebase HTTP ${metaRes.status}` }, { status: 502 });

      const meta = await metaRes.json();
      if (!meta) return Response.json({ data: null });

      const { totalChunks } = meta;

      // Fetch all chunks in parallel
      const chunkPromises = Array.from({ length: totalChunks }, (_, i) =>
        fetch(`${FB}/${basePath}/pdfChunks/chunk_${i}.json`).then(r => r.json())
      );
      const chunks = await Promise.all(chunkPromises);
      const validChunks = chunks.filter(Boolean);

      try {
        const existing = (await redis.get(baseCacheKey)) || {};
        const payload = { ...existing, meta, chunks: validChunks };
        await setWithTTL(baseCacheKey, payload, PDF_TTL);
        await setWithTTL(legacyTypeKey, validChunks, PDF_TTL);
      } catch {}
      return Response.json({ data: validChunks, source: "firebase" });

    } else {
      return Response.json({ error: "Invalid type param" }, { status: 400 });
    }

  } catch (err) {
    console.error("[pdf] route error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}