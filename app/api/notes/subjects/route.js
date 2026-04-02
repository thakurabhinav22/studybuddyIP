import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Firebase project REST base — no SDK, just fetch
const FB = "https://studybuddytcet-default-rtdb.firebaseio.com";

const SUBJECTS_TTL = 60 * 60 * 24 * 10; // 10 days in seconds

function sanitizeModule(moduleValue, moduleKey) {
  if (moduleValue === true) {
    return { Title: moduleKey };
  }
  if (typeof moduleValue !== "object" || moduleValue === null) {
    return {};
  }

  const cleaned = {};
  Object.entries(moduleValue).forEach(([k, v]) => {
    if (k === "pdfChunks" || k === "pdfMeta") return;
    cleaned[k] = v;
  });
  return cleaned;
}

function normalizeSubjects(raw) {
  const normalized = {};

  if (!raw || typeof raw !== "object") return normalized;

  Object.entries(raw).forEach(([code, val]) => {
    if (val === true) {
      normalized[code] = { Subject: code, Totalmodules: 0, modules: {} };
      return;
    }

    if (typeof val !== "object" || val === null) return;

    const subject = { ...val };
    delete subject.pdfChunks;
    delete subject.pdfMeta;

    const modulesRaw = val.modules && typeof val.modules === "object" ? val.modules : {};
    const modules = {};

    Object.entries(modulesRaw).forEach(([moduleKey, moduleVal]) => {
      modules[moduleKey] = sanitizeModule(moduleVal, moduleKey);
    });

    subject.Subject = typeof subject.Subject === "string" && subject.Subject.trim() ? subject.Subject : code;
    subject.modules = modules;
    subject.Totalmodules = typeof subject.Totalmodules === "number"
      ? subject.Totalmodules
      : Object.keys(modules).length;

    normalized[code] = subject;
  });

  return normalized;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const branch = searchParams.get("branch");
  const sem    = searchParams.get("sem");

  if (!branch || !sem) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const cacheKey = `sb:subjects:${branch}:${sem}`;

  // ── 1. Redis hit → return immediately ──
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return Response.json({ data: cached, source: "redis" });
    }
  } catch (e) {
    console.warn("[subjects] Redis get failed:", e.message);
  }

  // ── 2. Redis miss → Firebase REST API ──
  try {
    const fbUrl  = `${FB}/notes/${encodeURIComponent(branch)}/${encodeURIComponent(sem)}/subjects.json`;
    const fbRes  = await fetch(fbUrl);

    if (!fbRes.ok) {
      return Response.json({ error: `Firebase HTTP ${fbRes.status}` }, { status: 502 });
    }

    const raw = await fbRes.json();

    // Firebase returns null when the path doesn't exist
    if (!raw) {
      return Response.json({ data: {} });
    }

    // Metadata-only payload for Notes page (never include chunk data)
    const normalised = normalizeSubjects(raw);

    // ── 3. Store in Redis for 10 days ──
    try {
      await redis.setex(cacheKey, SUBJECTS_TTL, normalised);
    } catch (e) {
      console.warn("[subjects] Redis setex failed:", e.message);
    }

    return Response.json({ data: normalised, source: "firebase" });

  } catch (err) {
    console.error("[subjects] route error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}