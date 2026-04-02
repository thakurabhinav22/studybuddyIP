import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FB      = "https://studybuddytcet-default-rtdb.firebaseio.com";
const PDF_TTL = 60 * 60 * 24 * 10; // 10 days in seconds

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const branch  = searchParams.get("branch");
  const sem     = searchParams.get("sem");
  const subject = searchParams.get("subject");
  const module  = searchParams.get("module");
  const type    = searchParams.get("type") || "meta"; // "meta" | "chunks"

  if (!branch || !sem || !subject || !module) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const cacheKey = `sb:pdf:${type}:${branch}:${sem}:${subject}:${module}`;

  // ── 1. Redis hit ──
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return Response.json({ data: cached, source: "redis" });
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

      try { await redis.setex(cacheKey, PDF_TTL, data); } catch {}
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

      try { await redis.setex(cacheKey, PDF_TTL, validChunks); } catch {}
      return Response.json({ data: validChunks, source: "firebase" });

    } else {
      return Response.json({ error: "Invalid type param" }, { status: 400 });
    }

  } catch (err) {
    console.error("[pdf] route error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}