import { Redis } from "@upstash/redis";
import { ref, get } from "firebase/database";
import { db } from "@/firebase";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const PDF_TTL = 60 * 60 * 6; // 6 hours

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

  // ── L1: Redis hit ──
  const cached = await redis.get(cacheKey);
  if (cached) {
    return Response.json({ data: cached, source: "redis" });
  }

  // ── L2: Firebase fallback ──
  const basePath = `notes/${branch}/${sem}/subjects/${subject}/modules/${module}`;

  try {
    if (type === "meta") {
      const snap = await get(ref(db, `${basePath}/pdfMeta`));
      if (!snap.exists()) return Response.json({ data: null });
      const data = snap.val();
      await redis.setex(cacheKey, PDF_TTL, data);
      return Response.json({ data, source: "firebase" });

    } else if (type === "chunks") {
      const metaSnap = await get(ref(db, `${basePath}/pdfMeta`));
      if (!metaSnap.exists()) return Response.json({ data: null });
      const { totalChunks } = metaSnap.val();

      const chunks = [];
      for (let i = 0; i < totalChunks; i++) {
        const s = await get(ref(db, `${basePath}/pdfChunks/chunk_${i}`));
        if (s.exists()) chunks.push(s.val());
      }

      await redis.setex(cacheKey, PDF_TTL, chunks);
      return Response.json({ data: chunks, source: "firebase" });
    }
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}