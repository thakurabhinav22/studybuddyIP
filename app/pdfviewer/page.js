"use client";

import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref as dbRef, get, update, set } from "firebase/database";
import { flushPendingUsageStats, flushUsageStats } from "@/lib/usageStats";

function patchDashboardRecentNote(uid, note) {
  if (!uid || !note || typeof window === "undefined") return;
  try {
    const key = `studybuddy:dashboard-cache:v1:${uid}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const cached = JSON.parse(raw);
    if (!cached?.data) return;
    const data = cached.data;
    const prev = data.recentNotes && typeof data.recentNotes === "object" ? data.recentNotes : {};
    const noteKey = `${note.subject || "GEN"}_${note.key || note.title || "note"}`.replace(/[.#$\[\]/]/g, "_");
    data.recentNotes = {
      ...prev,
      [noteKey]: {
        ...(prev[noteKey] || {}),
        ...note,
        updatedAt: Date.now(),
      },
    };
    localStorage.setItem(key, JSON.stringify({ ...cached, data, updatedAt: Date.now() }));
  } catch { }
}

/* ─────────────────────────────────────────
   PDF LOCAL CACHE
───────────────────────────────────────── */
const PDF_LOCAL_CACHE_VERSION = 1;
const PDF_LOCAL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PDF_LOCAL_IDB_NAME = "studybuddy_pdf_cache";
const PDF_LOCAL_IDB_STORE = "pdfs";
const PDF_LOCAL_INDEX_KEY = "studybuddy:pdf-cache:index:v1";
const PDF_STREAM_CHUNK_BYTES = 500 * 1024 / 4 * 3;
const PDF_LOCAL_B64_CHUNK_SIZE = 500 * 1024;

function getPdfLocalCacheKey(branch, sem, subject, moduleKey) {
  return `studybuddy:pdf-cache:v${PDF_LOCAL_CACHE_VERSION}:${branch}:${sem}:${subject}:${moduleKey}`;
}

function openPdfLocalDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PDF_LOCAL_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PDF_LOCAL_IDB_STORE)) {
        db.createObjectStore(PDF_LOCAL_IDB_STORE, { keyPath: "cacheKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPdfLocalIdb(cacheKey) {
  const db = await openPdfLocalDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_LOCAL_IDB_STORE, "readonly");
    const store = tx.objectStore(PDF_LOCAL_IDB_STORE);
    const req = store.get(cacheKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function setPdfLocalIdb(cacheKey, value) {
  const db = await openPdfLocalDb();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_LOCAL_IDB_STORE, "readwrite");
    const store = tx.objectStore(PDF_LOCAL_IDB_STORE);
    const req = store.put({ cacheKey, ...value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function deletePdfLocalIdb(cacheKey) {
  const db = await openPdfLocalDb();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_LOCAL_IDB_STORE, "readwrite");
    const store = tx.objectStore(PDF_LOCAL_IDB_STORE);
    const req = store.delete(cacheKey);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function readPdfLocalMeta(branch, sem, subject, moduleKey) {
  if (typeof window === "undefined") return null;
  try {
    const key = getPdfLocalCacheKey(branch, sem, subject, moduleKey);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.savedAt || (Date.now() - cached.savedAt) > PDF_LOCAL_CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function writePdfLocalMeta(branch, sem, subject, moduleKey, payload) {
  if (typeof window === "undefined") return;
  try {
    const key = getPdfLocalCacheKey(branch, sem, subject, moduleKey);
    localStorage.setItem(key, JSON.stringify(payload));
  } catch { }
}

function clearPdfLocalChunkKeys(branch, sem, subject, moduleKey, chunkCount) {
  if (typeof window === "undefined") return;
  try {
    const key = getPdfLocalCacheKey(branch, sem, subject, moduleKey);
    for (let i = 0; i < chunkCount; i++) {
      localStorage.removeItem(`${key}:chunk:${i}`);
    }
  } catch { }
}

function readPdfLocalIndex() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PDF_LOCAL_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePdfLocalIndex(items) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PDF_LOCAL_INDEX_KEY, JSON.stringify(items));
  } catch { }
}

function upsertPdfLocalIndex(cacheKey, savedAt) {
  if (typeof window === "undefined") return;
  const items = readPdfLocalIndex();
  const next = items.filter((item) => item?.cacheKey !== cacheKey);
  next.push({ cacheKey, savedAt: savedAt || Date.now() });
  writePdfLocalIndex(next);
}

function touchPdfLocalIndex(cacheKey) {
  if (typeof window === "undefined") return;
  const items = readPdfLocalIndex();
  const next = items.map((item) => item?.cacheKey === cacheKey ? { ...item, savedAt: Date.now() } : item);
  writePdfLocalIndex(next);
}

function removePdfLocalIndex(cacheKey) {
  if (typeof window === "undefined") return;
  const items = readPdfLocalIndex();
  writePdfLocalIndex(items.filter((item) => item?.cacheKey !== cacheKey));
}

async function cleanupInactivePdfCaches() {
  if (typeof window === "undefined") return;
  const items = readPdfLocalIndex();
  if (!items.length) return;

  const now = Date.now();
  const active = [];

  for (const item of items) {
    const cacheKey = item?.cacheKey;
    const savedAt = Number(item?.savedAt) || 0;
    if (!cacheKey) continue;

    if (!savedAt || (now - savedAt) > PDF_LOCAL_CACHE_TTL_MS) {
      await deletePdfLocalIdb(cacheKey).catch(() => {});
      removePdfLocalLegacyChunks(cacheKey);
      continue;
    }

    active.push({ cacheKey, savedAt });
  }

  writePdfLocalIndex(active);
}

function removePdfLocalLegacyChunks(cacheKey) {
  if (typeof window === "undefined") return;
  try {
    const meta = localStorage.getItem(cacheKey);
    if (meta) {
      const parsed = JSON.parse(meta);
      const count = Number(parsed?.chunkCount) || 0;
      for (let i = 0; i < count; i++) localStorage.removeItem(`${cacheKey}:chunk:${i}`);
    }
    localStorage.removeItem(cacheKey);
  } catch { }
}

async function readPdfLocalCache(branch, sem, subject, moduleKey) {
  if (typeof window === "undefined") return null;
  try {
    const key = getPdfLocalCacheKey(branch, sem, subject, moduleKey);
    const cached = await getPdfLocalIdb(key);
    if (cached?.savedAt && (Date.now() - cached.savedAt) <= PDF_LOCAL_CACHE_TTL_MS && Array.isArray(cached.chunks) && cached.chunks.length) {
      touchPdfLocalIndex(key);
      return {
        meta: cached.meta || null,
        chunks: cached.chunks,
        source: "local",
        savedAt: cached.savedAt,
      };
    }

    const legacy = readPdfLocalMeta(branch, sem, subject, moduleKey);
    if (!legacy) return null;
    const chunkCount = Number(legacy.chunkCount) || 0;
    if (!chunkCount) return null;

    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const chunk = localStorage.getItem(`${key}:chunk:${i}`);
      if (chunk == null) return null;
      chunks.push(chunk);
    }

    await setPdfLocalIdb(key, { meta: legacy.meta || null, chunks, source: legacy.source || "local", savedAt: legacy.savedAt || Date.now() });
    clearPdfLocalChunkKeys(branch, sem, subject, moduleKey, chunkCount);
    writePdfLocalMeta(branch, sem, subject, moduleKey, {
      meta: legacy.meta || null,
      chunkCount,
      source: legacy.source || "local",
      savedAt: legacy.savedAt || Date.now(),
    });
    upsertPdfLocalIndex(key, legacy.savedAt || Date.now());
    touchPdfLocalIndex(key);

    return {
      meta: legacy.meta || null,
      chunks,
      source: "local",
      savedAt: legacy.savedAt || Date.now(),
    };
  } catch {
    return null;
  }
}

async function writePdfLocalCache(branch, sem, subject, moduleKey, { meta, chunks, source }) {
  if (typeof window === "undefined") return false;
  const key = getPdfLocalCacheKey(branch, sem, subject, moduleKey);
  const chunkCount = Array.isArray(chunks) ? chunks.length : 0;
  if (!chunkCount) return false;

  const savedAt = Date.now();
  const payload = {
    meta: meta || null,
    chunkCount,
    source: source || "redis",
    savedAt,
  };

  try {
    await setPdfLocalIdb(key, { meta: meta || null, chunks: Array.isArray(chunks) ? chunks : [], source: source || "redis", savedAt });
    writePdfLocalMeta(branch, sem, subject, moduleKey, payload);
    clearPdfLocalChunkKeys(branch, sem, subject, moduleKey, chunkCount);
    upsertPdfLocalIndex(key, savedAt);
    touchPdfLocalIndex(key);
    return true;
  } catch {
    return false;
  }
}

function assemblePdfBuffer(chunks) {
  const b64 = chunks.join("");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function chunkBase64(base64, size = PDF_LOCAL_B64_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < base64.length; i += size) {
    chunks.push(base64.slice(i, i + size));
  }
  return chunks;
}

function buildPdfStreamUrl(branch, sem, subject, moduleKey) {
  const params = new URLSearchParams({
    branch,
    sem,
    subject,
    module: moduleKey,
    type: "file",
  });
  return `/api/notes/pdf?${params.toString()}`;
}

/* ─────────────────────────────────────────
   SECURITY
───────────────────────────────────────── */
async function validateAccess(db, uid, reqBranch, reqSem, reqSubject, reqModule) {
  const snap = await get(dbRef(db, `users/${uid}`));
  if (!snap.exists()) return { allowed: false, reason: "User not found." };
  const { branch, sem, isAdmin } = snap.val();
  if (isAdmin === true) {
    const m = await get(dbRef(db, `notes/${reqBranch}/${reqSem}/subjects/${reqSubject}/modules/${reqModule}`));
    if (!m.exists()) return { allowed: false, reason: "Module does not exist." };
    return { allowed: true };
  }
  const ns = (r) => { if (!r) return ""; const s = r.toString().trim(); if (/^Sem:\d+$/.test(s)) return s; const n = s.replace(/[^0-9]/g, ""); return n ? `Sem:${n}` : s; };
  if (branch?.toLowerCase() !== reqBranch?.toLowerCase() || ns(sem) !== ns(reqSem))
    return { allowed: false, reason: "You can only view resources for your own branch and semester." };
  const m = await get(dbRef(db, `notes/${reqBranch}/${ns(reqSem)}/subjects/${reqSubject}/modules/${reqModule}`));
  if (!m.exists()) return { allowed: false, reason: "That module doesn't exist in your course." };
  return { allowed: true };
}

/* ─────────────────────────────────────────
   CHUNK REASSEMBLY
───────────────────────────────────────── */
async function loadPdfMeta(branch, sem, subject, moduleKey) {
  const res = await fetch(`/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(moduleKey)}&type=meta`);
  if (!res.ok) throw new Error(`Failed to load PDF metadata (${res.status})`);
  const payload = await res.json();
  return { data: payload?.data || null, source: payload?.source || "firebase" };
}

function normalizeSem(raw) {
  if (!raw) return "";
  const s = raw.toString().trim();
  if (/^Sem:\d+$/.test(s)) return s;
  const n = s.replace(/[^0-9]/g, "");
  return n ? `Sem:${n}` : s;
}

async function loadSubjectTitle(branch, sem, subject, moduleKey) {
  const res = await fetch(`/api/notes/subjects?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}`);
  if (!res.ok) return null;
  const payload = await res.json();
  const modules = payload?.data?.[subject]?.modules || {};
  const mod = modules?.[moduleKey];
  return mod?.Title || mod?.title || null;
}

async function loadPdfChunks(branch, sem, subject, moduleKey) {
  const res = await fetch(`/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(moduleKey)}&type=chunks`);
  if (!res.ok) throw new Error(`Failed to load PDF chunks (${res.status})`);
  const payload = await res.json();
  return { data: Array.isArray(payload?.data) ? payload.data : null, source: payload?.source || "firebase" };
}

async function loadPDF(branch, sem, subject, moduleKey, onProgress) {
  const localCached = await readPdfLocalCache(branch, sem, subject, moduleKey);
  if (localCached?.chunks?.length) {
    onProgress(3, "Loaded from local cache…");
    onProgress(6, "Preparing local PDF…");
    const buffer = assemblePdfBuffer(localCached.chunks);
    onProgress(100, "Ready from local cache");
    return { buffer, source: localCached.source || "local", meta: localCached.meta || null };
  }

  onProgress(5, "Reading PDF metadata…");
  const { data: meta, source: metaSource } = await loadPdfMeta(branch, sem, subject, moduleKey);
  if (!meta) throw new Error("No PDF uploaded for this module yet.");
  onProgress(14, "Fetching PDF from server…");

  const res = await fetch(buildPdfStreamUrl(branch, sem, subject, moduleKey));
  if (!res.ok) throw new Error(`Failed to load PDF file (${res.status})`);

  onProgress(48, "Reading PDF bytes…");
  const buffer = await res.arrayBuffer();

  onProgress(72, "Caching PDF locally…");
  try {
    const b64 = bufferToBase64(buffer);
    const chunks = chunkBase64(b64);
    await writePdfLocalCache(branch, sem, subject, moduleKey, {
      meta,
      chunks,
      source: res.headers.get("X-PDF-Source") || metaSource || "firebase",
    });
  } catch { }

  onProgress(100, "Ready");
  return {
    buffer,
    source: res.headers.get("X-PDF-Source") || metaSource || "firebase",
    meta,
  };
}

/* ─────────────────────────────────────────
   GROQ API  — proxied through /api/groq
   Key lives in GROQ_API_KEY (server-only,
   no NEXT_PUBLIC_ prefix needed).
───────────────────────────────────────── */
const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";
const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";

async function callGroq({ messages, model, max_tokens = 1200 }) {
  const res = await fetch("/api/groq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens, temperature: 0.4 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `API error ${res.status}`); }
  return (await res.json()).choices?.[0]?.message?.content || "No response.";
}

const BLOOM_LEVELS = ["Remember", "Understand", "Analyze"];

function normalizeQuestionLevel(level, fallback = "Understand") {
  const raw = (level || "").toString().trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.includes("remember")) return "Remember";
  if (raw.includes("understand") || raw.includes("compreh")) return "Understand";
  if (raw.includes("analy")) return "Analyze";
  return fallback;
}

function extractJsonBlock(text, kind) {
  const cleaned = (text || "").trim().replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  const regex = kind === "object" ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/;
  const match = cleaned.match(regex);
  return match ? match[0] : "";
}

function sanitizeJsonCandidate(raw) {
  return (raw || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

async function parseModelJson(rawText, { kind = "array", label = "response" } = {}) {
  const block = extractJsonBlock(rawText, kind);
  if (!block) throw new Error(`${label} returned an unexpected format.`);

  const tryDirect = sanitizeJsonCandidate(block);
  try {
    return JSON.parse(tryDirect);
  } catch { }

  const repaired = await callGroq({
    model: GROQ_TEXT_MODEL,
    max_tokens: 1800,
    messages: [{
      role: "user",
      content: `Fix this into strict valid JSON (${kind}) and return ONLY JSON. Do not add explanation:\n${block}`,
    }],
  });

  const repairedBlock = sanitizeJsonCandidate(extractJsonBlock(repaired, kind) || repaired);
  return JSON.parse(repairedBlock);
}

/* ─────────────────────────────────────────
   SHORT ANSWER AI GRADER
   Returns 0-100 similarity score
───────────────────────────────────────── */
async function gradeShortAnswers(questions, userAnswers) {
  const pairs = questions.map((q, i) => ({
    q: q.q,
    model: q.answer,
    user: userAnswers[i] || "(no answer)",
    idx: i,
  }));
  const prompt = `You are a strict but fair exam grader. Grade each student answer vs the model answer.
Return ONLY a JSON array — no markdown, no prose:
[{"idx":0,"score":85,"feedback":"Brief 1-line feedback"},...]
Score 0-100: 100=perfect match in meaning, 70+=mostly correct, 40-69=partially correct, 0-39=wrong/missing.
Be strict — penalize vague or incomplete answers. Award partial credit for correct concepts.
Questions to grade:
${JSON.stringify(pairs, null, 1)}`;
  try {
    const res = await callGroq({
      model: GROQ_TEXT_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = await parseModelJson(res, { kind: "array", label: "Grading" });
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

async function renderPageToBase64(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}

/* ─────────────────────────────────────────
   /command PARSER
───────────────────────────────────────── */
/* ─────────────────────────────────────────
   SLASH COMMANDS REGISTRY
───────────────────────────────────────── */
const SLASH_COMMANDS = [
  { cmd: "/current", icon: "pin", desc: "Page-only strict answer — no extra context", color: "#00CC00" },
  { cmd: "/draw", icon: "draw", desc: "Draw an ASCII diagram of the concept on this page", color: "#a78bfa" },
  { cmd: "/explain", icon: "school", desc: "Explain with a real-world example", color: "#38bdf8" },
  { cmd: "/fullexplain", icon: "auto_stories", desc: "Full detailed explanation with flow + exam tips", color: "#fb923c" },
  { cmd: "/diagram", icon: "account_tree", desc: "Generate a structured flowchart / diagram", color: "#34d399" },
];

function parseCommand(input) {
  const t = input.trim();
  for (const { cmd } of SLASH_COMMANDS) {
    if (t.startsWith(cmd + " ") || t === cmd) return { command: cmd.slice(1), query: t.slice(cmd.length).trim() };
  }
  return { command: null, query: t };
}

function buildSystemPrompt(command, moduleTitle, moduleKey, subject, sem, currentPage, totalPages) {
  const base = `You are Neural AI — expert engineering exam assistant in a PDF viewer.
Module: "${moduleTitle || moduleKey}" · Subject: ${subject} · Semester: ${sem} · Page: ${currentPage}/${totalPages}.`;
  switch (command) {
    case "current":
      return base + `\nSTRICT PAGE-ONLY MODE: Answer ONLY from what is visible on the current page image. No outside knowledge.\nBe concise. Bullet points where needed. Max 250 words.`;
    case "draw":
      return base + `\nDRAW MODE: Create a clear ASCII/text diagram of the concept from the page.\nUse box-drawing characters, arrows (→ ← ↑ ↓), labeled boxes [  ], and structured layouts.\nMake it educational with a ## Title. Show relationships and flow visually.`;
    case "explain":
      return base + `\nEXPLAIN WITH EXAMPLE MODE: Explain the concept then give ONE concrete real-world example.\nFormat:\n## Concept\n[clear explanation]\n## Real-world Example\n[relatable scenario]\n## How It Applies\n[connection back to the engineering topic]\nMax 300 words.`;
    case "fullexplain":
      return base + `\nFULL EXPLANATION MODE: Give a thorough structured explanation of the entire topic on this page.\nInclude: overview, step-by-step working, key formulas/rules, worked example, and ## Exam Tips.\nUse ## headings, bullet points, and examples. Max 600 words.`;
    case "diagram":
      return base + `\nDIAGRAM MODE: Generate a detailed structured diagram using ASCII art.\nUse → arrows, [Box] labels, ┌─┐ borders where helpful, indentation for hierarchy.\nAdd ## Title and ## Legend. Make every element clearly labeled.`;
    default:
      return base + `\nGive concise, exam-focused answers. Use bullet points when listing. Max 250 words unless asked.`;
  }
}

/* ─────────────────────────────────────────
   MARKDOWN RENDERER (Professional AI Output)
───────────────────────────────────────── */
function CopyButton({ code }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "6px",
        padding: "3px 8px",
        fontSize: "10px",
        color: copied ? "#00FF00" : "#94a3b8",
        cursor: "pointer",
        transition: "all 0.2s",
        fontFamily: "'Lexend',sans-serif",
      }}
    >
      <span className="ms" style={{ fontSize: "12px" }}>{copied ? "check" : "content_copy"}</span>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ─────────────────────────────────────────
   PDF ANNOTATIONS DB & CACHE
───────────────────────────────────────── */
const ANNOTATIONS_CACHE_PREFIX = "studybuddy_annot_v1:";

function getAnnotationStorageKey(branch, sem, subject, moduleKey, page) {
  return `${ANNOTATIONS_CACHE_PREFIX}${branch}_${sem}_${subject}_${moduleKey}_p${page}`;
}

function getFirebaseAnnotationPath(uid, branch, sem, subject, moduleKey, page) {
  const safeMod = (moduleKey || "").replace(/[.#$\[\]/]/g, "_");
  const safeSub = (subject || "").replace(/[.#$\[\]/]/g, "_");
  return `users/${uid}/annotations/${branch}_${sem}_${safeSub}_${safeMod}/p${page}`;
}

async function loadPageAnnotations(uid, branch, sem, subject, moduleKey, page) {
  const localKey = getAnnotationStorageKey(branch, sem, subject, moduleKey, page);
  let localData = null;
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(localKey);
      if (raw) localData = JSON.parse(raw);
    } catch { }
  }

  // Also check Firebase if user is logged in
  if (uid) {
    try {
      const fbRef = dbRef(db, getFirebaseAnnotationPath(uid, branch, sem, subject, moduleKey, page));
      const snap = await get(fbRef);
      if (snap.exists()) {
        const remoteData = snap.val();
        if (remoteData?.updatedAt && (!localData?.updatedAt || remoteData.updatedAt > localData.updatedAt)) {
          if (typeof window !== "undefined") {
            try { localStorage.setItem(localKey, JSON.stringify(remoteData)); } catch { }
          }
          return remoteData;
        }
      }
    } catch (e) {
      console.warn("Failed fetching annotations from Firebase:", e);
    }
  }
  return localData || { lines: [], updatedAt: 0 };
}

async function savePageAnnotations(uid, branch, sem, subject, moduleKey, page, payload) {
  const localKey = getAnnotationStorageKey(branch, sem, subject, moduleKey, page);
  const dataToSave = {
    lines: payload.lines || [],
    updatedAt: Date.now(),
    page,
  };

  // 1. Save local
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(localKey, JSON.stringify(dataToSave));
    } catch { }
  }

  // 2. Sync to Firebase
  if (uid) {
    try {
      const fbRef = dbRef(db, getFirebaseAnnotationPath(uid, branch, sem, subject, moduleKey, page));
      await set(fbRef, dataToSave);
    } catch (e) {
      console.warn("Failed persisting annotations to Firebase:", e);
    }
  }
}

/* ─────────────────────────────────────────
   DIAGRAM VIEWER MODAL
───────────────────────────────────────── */
function DiagramViewerModal({ diagramText, title = "Diagram Viewer", isDark, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const panelBg = isDark ? "#090f1d" : "#ffffff";
  const boardBg = isDark ? "#050a14" : "#f1f5f9";
  const textColor = isDark ? "#6ee7b7" : "#065f46";
  const borderCol = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";

  const handlePointerDown = (e) => {
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e) => {
    if (!isPanning) return;
    setPan({
      x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
      y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
    });
  };

  const handlePointerUp = () => setIsPanning(false);

  // Export diagram as PNG image
  const exportAsImage = () => {
    setExporting(true);
    try {
      const lines = diagramText.split("\n");
      const font = "14px 'Fira Code', 'Courier New', monospace";
      const dummyCanvas = document.createElement("canvas");
      const dummyCtx = dummyCanvas.getContext("2d");
      dummyCtx.font = font;

      let maxLineWidth = 0;
      for (const line of lines) {
        const w = dummyCtx.measureText(line).width;
        if (w > maxLineWidth) maxLineWidth = w;
      }

      const padding = 36;
      const lineHeight = 22;
      const canvasWidth = Math.max(600, Math.ceil(maxLineWidth + padding * 2));
      const canvasHeight = Math.ceil(lines.length * lineHeight + padding * 2 + 50);

      const expCanvas = document.createElement("canvas");
      expCanvas.width = canvasWidth;
      expCanvas.height = canvasHeight;
      const ctx = expCanvas.getContext("2d");

      // Draw background
      ctx.fillStyle = isDark ? "#090d16" : "#ffffff";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Title header
      ctx.fillStyle = "#00CC00";
      ctx.font = "bold 15px 'Lexend', sans-serif";
      ctx.fillText(title.toUpperCase(), padding, 32);

      // Subtitle
      ctx.fillStyle = isDark ? "#64748b" : "#94a3b8";
      ctx.font = "11px 'Lexend', sans-serif";
      ctx.fillText("Generated by StudyBuddy Neural AI", padding, 48);

      // Divider line
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, 58);
      ctx.lineTo(canvasWidth - padding, 58);
      ctx.stroke();

      // Draw code lines
      ctx.font = font;
      ctx.fillStyle = isDark ? "#a7f3d0" : "#047857";
      lines.forEach((line, idx) => {
        ctx.fillText(line, padding, 84 + idx * lineHeight);
      });

      // Watermark
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("StudyBuddy", canvasWidth - padding, canvasHeight - 14);

      const link = document.createElement("a");
      link.download = `${title.toLowerCase().replace(/\s+/g, "_") || "diagram"}.png`;
      link.href = expCanvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("Export diagram failed:", e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          width: "900px",
          maxWidth: "calc(100vw - 32px)",
          height: "85vh",
          background: panelBg,
          border: `1px solid ${borderCol}`,
          borderRadius: "20px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Modal Toolbar */}
        <div
          style={{
            height: "56px",
            borderBottom: `1px solid ${borderCol}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 18px",
            flexShrink: 0,
            background: isDark ? "rgba(255,255,255,0.02)" : "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "10px",
                background: "rgba(0,255,0,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span className="ms" style={{ fontSize: "20px", color: "#00CC00" }}>draw</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                {title}
              </p>
              <p style={{ margin: 0, fontSize: "10px", color: isDark ? "#94a3b8" : "#64748b" }}>
                Interactive Diagram Viewer · Pan & Zoom enabled
              </p>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => setZoom(z => Math.max(0.5, +(z - 0.2).toFixed(1)))}
              title="Zoom Out"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                border: `1px solid ${borderCol}`,
                background: "transparent",
                color: isDark ? "#e2e8f0" : "#334155",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span className="ms" style={{ fontSize: "18px" }}>remove</span>
            </button>
            <span style={{ fontSize: "11px", fontWeight: 700, color: isDark ? "#cbd5e1" : "#475569", minWidth: "40px", textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))}
              title="Zoom In"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                border: `1px solid ${borderCol}`,
                background: "transparent",
                color: isDark ? "#e2e8f0" : "#334155",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span className="ms" style={{ fontSize: "18px" }}>add</span>
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              title="Reset View"
              style={{
                padding: "6px 10px",
                borderRadius: "8px",
                border: `1px solid ${borderCol}`,
                background: "transparent",
                color: isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 600,
              }}
            >
              Reset
            </button>

            <div style={{ width: "1px", height: "20px", background: borderCol, margin: "0 4px" }} />

            <button
              onClick={exportAsImage}
              disabled={exporting}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "9px",
                background: "#00FF00",
                color: "#0f172a",
                border: "none",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                fontFamily: "'Lexend',sans-serif",
                boxShadow: "0 2px 10px rgba(0,255,0,0.3)",
              }}
            >
              <span className="ms" style={{ fontSize: "16px" }}>download</span>
              {exporting ? "Exporting…" : "Export PNG"}
            </button>

            <button
              onClick={onClose}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                border: "none",
                background: "transparent",
                color: isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginLeft: "4px",
              }}
            >
              <span className="ms" style={{ fontSize: "20px" }}>close</span>
            </button>
          </div>
        </div>

        {/* Pan/Zoom Canvas Area */}
        <div
          style={{
            flex: 1,
            background: boardBg,
            overflow: "hidden",
            position: "relative",
            cursor: isPanning ? "grabbing" : "grab",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            userSelect: "none",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Subtle grid pattern background */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: isDark
                ? "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)"
                : "radial-gradient(rgba(0,0,0,0.06) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.15s ease-out",
              padding: "40px",
              background: isDark ? "#080e1b" : "#ffffff",
              borderRadius: "16px",
              border: `1px solid ${borderCol}`,
              boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
            }}
          >
            <pre
              style={{
                fontFamily: "'Fira Code', 'Courier New', monospace",
                fontSize: "13px",
                lineHeight: 1.6,
                color: textColor,
                margin: 0,
                whiteSpace: "pre",
              }}
            >
              {diagramText}
            </pre>
          </div>

          {/* Hint overlay */}
          <div
            style={{
              position: "absolute",
              bottom: "14px",
              left: "14px",
              padding: "5px 12px",
              borderRadius: "9999px",
              background: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)",
              border: `1px solid ${borderCol}`,
              fontSize: "10px",
              color: isDark ? "#94a3b8" : "#64748b",
              pointerEvents: "none",
            }}
          >
            Drag to pan · Use toolbar buttons to zoom
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

function MarkdownText({ text, isDark, onOpenDiagram }) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  const textColor = isDark ? "#e2e8f0" : "#1e293b";
  const mutedColor = isDark ? "#94a3b8" : "#64748b";
  const headingColor = isDark ? "#ffffff" : "#0f172a";
  const codeBg = isDark ? "rgba(10,18,32,0.85)" : "#f8fafc";
  const codeBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const calloutBorder = isDark ? "rgba(0,255,0,0.3)" : "rgba(0,200,0,0.35)";

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // ── Fenced Code Blocks ──
    if (rawLine.trimStart().startsWith("```")) {
      const lang = rawLine.trim().slice(3).trim() || "code";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      const fullCode = codeLines.join("\n");
      elements.push(
        <div
          key={`code-block-${i}`}
          style={{
            margin: "12px 0",
            borderRadius: "10px",
            overflow: "hidden",
            border: `1px solid ${codeBorder}`,
            background: codeBg,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px",
              background: isDark ? "rgba(255,255,255,0.03)" : "#f1f5f9",
              borderBottom: `1px solid ${codeBorder}`,
            }}
          >
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#00CC00",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontFamily: "monospace",
              }}
            >
              {lang}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {(lang.toLowerCase().includes("ascii") || lang.toLowerCase().includes("diagram") || lang.toLowerCase().includes("draw") || fullCode.includes("┌") || fullCode.includes("-->") || fullCode.includes("->") || fullCode.includes("|") || fullCode.includes("+--")) && (
                <button
                  onClick={() => onOpenDiagram?.({ text: fullCode, title: `${lang.toUpperCase()} Diagram` })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "rgba(0,255,0,0.1)",
                    border: "1px solid rgba(0,255,0,0.25)",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#00CC00",
                    cursor: "pointer",
                    fontFamily: "'Lexend',sans-serif",
                    transition: "all 0.2s",
                  }}
                  title="View in interactive diagram viewer app"
                >
                  <span className="ms" style={{ fontSize: "12px" }}>open_in_full</span>
                  View Diagram
                </button>
              )}
              <CopyButton code={fullCode} />
            </div>
          </div>
          <pre
            style={{
              padding: "12px 14px",
              fontSize: "12px",
              lineHeight: 1.65,
              overflowX: "auto",
              margin: 0,
              fontFamily: "'Fira Code', 'Courier New', monospace",
              color: isDark ? "#a7f3d0" : "#065f46",
            }}
          >
            {fullCode}
          </pre>
        </div>
      );
      i++;
      continue;
    }

    // ── Blockquotes / Exam Callouts ──
    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ""));
        i++;
      }
      elements.push(
        <div
          key={`quote-${i}`}
          style={{
            margin: "10px 0",
            padding: "10px 14px",
            borderLeft: `3px solid ${calloutBorder}`,
            background: isDark ? "rgba(0,255,0,0.04)" : "rgba(0,200,0,0.04)",
            borderRadius: "0 10px 10px 0",
            fontSize: "12px",
            lineHeight: 1.65,
            color: mutedColor,
          }}
        >
          {quoteLines.map((ql, qk) => (
            <p key={qk} style={{ margin: "2px 0" }}>{inlineFormat(ql, isDark)}</p>
          ))}
        </div>
      );
      continue;
    }

    // ── Table Rows ──
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = row => row.slice(1, -1).split("|").map(c => c.trim());
        const headerCells = parseRow(tableLines[0]);
        const isDivider = line => /^\|?[\s-:]+\|?$/.test(line);
        const startRow = isDivider(tableLines[1]) ? 2 : 1;
        const bodyRows = tableLines.slice(startRow).map(parseRow);

        elements.push(
          <div key={`table-${i}`} style={{ overflowX: "auto", margin: "12px 0", borderRadius: "10px", border: `1px solid ${codeBorder}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: isDark ? "rgba(255,255,255,0.04)" : "#f1f5f9" }}>
                  {headerCells.map((hc, hk) => (
                    <th key={hk} style={{ padding: "8px 10px", fontWeight: 700, color: headingColor, borderBottom: `1px solid ${codeBorder}` }}>
                      {inlineFormat(hc, isDark)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((br, bk) => (
                  <tr key={bk} style={{ borderBottom: bk === bodyRows.length - 1 ? "none" : `1px solid ${codeBorder}` }}>
                    {br.map((bc, bck) => (
                      <td key={bck} style={{ padding: "7px 10px", color: textColor }}>
                        {inlineFormat(bc, isDark)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // ── Headings ──
    const hMatch = rawLine.match(/^(#{1,4})\s+(.+)/);
    if (hMatch) {
      const lvl = hMatch[1].length;
      const headingConfig = {
        1: { size: "15px", weight: 800, mt: "14px", mb: "6px", borderBottom: true },
        2: { size: "13.5px", weight: 700, mt: "12px", mb: "5px", borderBottom: false },
        3: { size: "12.5px", weight: 700, mt: "10px", mb: "4px", borderBottom: false },
        4: { size: "12px", weight: 700, mt: "8px", mb: "3px", borderBottom: false },
      };
      const cfg = headingConfig[lvl] || headingConfig[3];
      elements.push(
        <div key={`heading-${i}`} style={{ marginTop: cfg.mt, marginBottom: cfg.mb, paddingBottom: cfg.borderBottom ? "4px" : "0", borderBottom: cfg.borderBottom ? `1px solid ${codeBorder}` : "none" }}>
          <h4
            style={{
              fontSize: cfg.size,
              fontWeight: cfg.weight,
              margin: 0,
              color: headingColor,
              lineHeight: 1.4,
              letterSpacing: "-0.01em",
            }}
          >
            {inlineFormat(hMatch[2], isDark)}
          </h4>
        </div>
      );
      i++;
      continue;
    }

    // ── Unordered Lists ──
    if (/^[-*•]\s/.test(rawLine.trimStart())) {
      const items = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i].trimStart())) {
        items.push(lines[i].replace(/^[\s\-*•]+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ margin: "6px 0 8px", paddingLeft: "4px", listStyle: "none" }}>
          {items.map((item, k) => (
            <li
              key={k}
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "flex-start",
                fontSize: "12px",
                lineHeight: 1.65,
                margin: "4px 0",
                color: textColor,
              }}
            >
              <span
                style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  background: "#00CC00",
                  flexShrink: 0,
                  marginTop: "8px",
                }}
              />
              <span style={{ flex: 1 }}>{inlineFormat(item, isDark)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Ordered Lists ──
    if (/^\d+\.\s/.test(rawLine.trimStart())) {
      const items = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trimStart())) {
        items.push({ n: num++, text: lines[i].replace(/^\d+\.\s*/, "") });
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ margin: "6px 0 8px", paddingLeft: "4px", listStyle: "none" }}>
          {items.map(({ n, text: itmText }, k) => (
            <li
              key={k}
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "flex-start",
                fontSize: "12px",
                lineHeight: 1.65,
                margin: "4px 0",
                color: textColor,
              }}
            >
              <span
                style={{
                  minWidth: "18px",
                  height: "18px",
                  borderRadius: "5px",
                  background: isDark ? "rgba(0,255,0,0.12)" : "rgba(0,200,0,0.1)",
                  color: "#00CC00",
                  fontWeight: 700,
                  fontSize: "10px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: "2px",
                }}
              >
                {n}
              </span>
              <span style={{ flex: 1 }}>{inlineFormat(itmText, isDark)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // ── Horizontal Rule ──
    if (/^---+$|^\*\*\*+$/.test(trimmed)) {
      elements.push(
        <div key={`hr-${i}`} style={{ height: "1px", background: codeBorder, margin: "12px 0" }} />
      );
      i++;
      continue;
    }

    // ── Empty Space ──
    if (trimmed === "") {
      elements.push(<div key={`sp-${i}`} style={{ height: "6px" }} />);
      i++;
      continue;
    }

    // ── Regular Paragraph ──
    elements.push(
      <p
        key={`p-${i}`}
        style={{
          fontSize: "12px",
          lineHeight: 1.7,
          margin: "4px 0",
          color: textColor,
          wordBreak: "break-word",
        }}
      >
        {inlineFormat(rawLine, isDark)}
      </p>
    );
    i++;
  }
  return <>{elements}</>;
}

function inlineFormat(text, isDark) {
  if (typeof text !== "string") return text;
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0, m;
  const strongColor = isDark ? "#ffffff" : "#0f172a";
  const emColor = isDark ? "#cbd5e1" : "#334155";
  const codeColor = isDark ? "#4ade80" : "#15803d";
  const codeBg = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.08)";
  const codeBorder = isDark ? "rgba(0,255,0,0.2)" : "rgba(0,200,0,0.15)";

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`text-${last}-${m.index}`}>{text.slice(last, m.index)}</span>);
    }
    if (m[0].startsWith("**")) {
      parts.push(
        <strong key={`strong-${m.index}`} style={{ fontWeight: 700, color: strongColor }}>
          {m[2]}
        </strong>
      );
    } else if (m[0].startsWith("*")) {
      parts.push(
        <em key={`em-${m.index}`} style={{ fontStyle: "italic", color: emColor }}>
          {m[3]}
        </em>
      );
    } else if (m[0].startsWith("`")) {
      parts.push(
        <code
          key={`code-${m.index}`}
          style={{
            fontFamily: "'Fira Code', 'Courier New', monospace",
            background: codeBg,
            border: `1px solid ${codeBorder}`,
            padding: "1px 5px",
            borderRadius: "4px",
            fontSize: "11px",
            color: codeColor,
          }}
        >
          {m[4]}
        </code>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`text-${last}-${text.length}`}>{text.slice(last)}</span>);
  return parts.length ? parts : text;
}

/* ─────────────────────────────────────────
   SHARED MODAL HELPERS
───────────────────────────────────────── */
function ModalOverlay({ onClose, children }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", animation: "overlayIn 0.2s ease both", padding: "16px", overflowY: "auto" }}
      onClick={e => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      {children}
    </div>
  );
}

function modalBoxStyle(panel, bdr, width) {
  return {
    background: panel,
    border: `1px solid ${bdr}`,
    borderRadius: "20px",
    padding: "24px",
    width,
    maxWidth: "calc(100vw - 32px)",
    boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
    animation: "popIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both",
  };
}

function ModalHeader({ title, subtitle, icon, onClose, text1, text3 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(0,255,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="ms" style={{ fontSize: "20px", color: "#00CC00" }}>{icon}</span>
        </div>
        <div>
          <p style={{ fontSize: "14px", fontWeight: 700, color: text1, margin: 0 }}>{title}</p>
          <p style={{ fontSize: "10px", color: text3, margin: 0 }}>{subtitle}</p>
        </div>
      </div>
      {onClose && (
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: text3, width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "8px" }}>
          <span className="ms" style={{ fontSize: "20px" }}>close</span>
        </button>
      )}
    </div>
  );
}

function SectionLabel({ text, text3 }) {
  return <p style={{ fontSize: "11px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>{text}</p>;
}

function ChoiceCard({ id, icon, label, sub, selected, onSelect, isDark, bdr, text1, text3 }) {
  return (
    <button onClick={() => onSelect(id)} style={{
      padding: "14px 12px", borderRadius: "14px",
      border: `2px solid ${selected ? "#00FF00" : bdr}`,
      background: selected ? "rgba(0,255,0,0.08)" : "transparent",
      cursor: "pointer", textAlign: "left", transition: "all 0.18s",
      fontFamily: "'Lexend',sans-serif",
      boxShadow: selected ? "0 0 0 3px rgba(0,255,0,0.12)" : "none",
    }}>
      <span className="ms" style={{ fontSize: "22px", color: selected ? "#00FF00" : text3, display: "block", marginBottom: "6px" }}>{icon}</span>
      <p style={{ fontSize: "12px", fontWeight: 700, color: selected ? (isDark ? "#00FF00" : "#007700") : text1, margin: "0 0 2px" }}>{label}</p>
      <p style={{ fontSize: "10px", color: text3, margin: 0 }}>{sub}</p>
    </button>
  );
}

/* ─────────────────────────────────────────
   QUIZ MODAL  (setup → generate → live quiz → results)
───────────────────────────────────────── */
function QuizModal({ isDark, onClose, onComplete, weakByLevel, askedByLevel, pdfDoc, currentPage, totalPages, moduleTitle, moduleKey, subject, sem, text1, text2, text3, bdr, panel }) {
  const [phase, setPhase] = useState("setup"); // setup | generating | quiz | results
  const [mode, setMode] = useState(null);    // "mcq" | "short"
  const [count, setCount] = useState(5);
  const [scope, setScope] = useState("page");  // "page" | "pdf"
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [grades, setGrades] = useState(null); // [{idx, score, feedback}]
  const [genError, setGenError] = useState("");
  const [genProgress, setGenProgress] = useState("");
  const completionReportedRef = useRef(false);

  const weakFocusLevel = useMemo(() => {
    const weak = weakByLevel || {};
    const asked = askedByLevel || {};
    let best = { level: "Understand", score: -1 };
    for (const level of BLOOM_LEVELS) {
      const wrong = Number(weak[level]) || 0;
      const total = Number(asked[level]) || 0;
      const rate = total > 0 ? wrong / total : 0;
      const weighted = rate * 100 + wrong;
      if (weighted > best.score) best = { level, score: weighted };
    }
    return best.level;
  }, [weakByLevel, askedByLevel]);

  const canStart = !!mode;

  const startQuiz = async () => {
    if (!canStart) return;
    setPhase("generating");
    setGenError("");
    setGenProgress("Scanning content…");
    try {
      if (!pdfDoc) throw new Error("PDF not loaded yet.");
      const pagesToRead = scope === "pdf"
        ? Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1)
        : [currentPage];

      const imgs = [];
      for (const p of pagesToRead) {
        setGenProgress(scope === "pdf" ? `Reading page ${p} of ${pagesToRead.length}…` : `Reading page ${p}…`);
        const img = await renderPageToBase64(pdfDoc, p, 1.2);
        imgs.push(img);
      }

      setGenProgress("Generating questions with Neural AI…");

      const scopeNote = scope === "pdf"
        ? `Pages 1–${pagesToRead.length} of "${moduleTitle || moduleKey}" (${subject}, ${sem}).`
        : `Page ${currentPage} of "${moduleTitle || moduleKey}" (${subject}, ${sem}).`;

      const formatInstructions = mode === "mcq"
        ? `Generate exactly ${count} MCQ questions with Bloom levels. Return ONLY a raw JSON array (no markdown, no code fences, no prose):
      [{"q":"Question text","level":"Remember|Understand|Analyze","options":["A) option","B) option","C) option","D) option"],"answer":"A) correct option text","explanation":"1-sentence explanation"}]
      Ensure a balanced mix and prioritize more questions from level "${weakFocusLevel}".`
        : `Generate exactly ${count} short-answer exam questions. Return ONLY a raw JSON array (no markdown, no code fences, no prose):
      [{"q":"Question text","level":"Remember|Understand|Analyze","answer":"Precise one-line answer","explanation":"1-sentence context"}]`;

      const res = await callGroq({
        model: GROQ_VISION_MODEL,
        max_tokens: 2800,
        messages: [
          {
            role: "system",
            content: `You are an expert engineering exam question generator. ${scopeNote}\n${formatInstructions}\nFocus on exam-relevant concepts.`
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Generate ${count} ${mode === "mcq" ? "MCQ" : "short answer"} questions from this content:` },
              ...imgs.map(img => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } }))
            ]
          }
        ]
      });

      const parsed = await parseModelJson(res, { kind: "array", label: "Quiz generation" });
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("No questions were generated.");
      const defaults = ["Remember", "Understand", "Analyze"];
      const normalized = parsed.map((item, idx) => ({
        ...item,
        level: normalizeQuestionLevel(item?.level, defaults[idx % defaults.length]),
      }));
      setQuestions(normalized);
      setAnswers({});
      setRevealed(false);
      setPhase("quiz");
    } catch (err) {
      setGenError(err.message || "Failed to generate questions.");
      setPhase("setup");
    }
  };

  const score = questions.reduce((acc, q, i) => acc + (mode === "mcq" && answers[i] === q.answer ? 1 : 0), 0);
  const answeredCount = Object.keys(answers).length;

  // Short answer: avg AI grade score
  const shortScore = grades ? Math.round(grades.reduce((s, g) => s + g.score, 0) / grades.length) : null;

  const handleReveal = async () => {
    const askedInc = { Remember: 0, Understand: 0, Analyze: 0 };
    const weakInc = { Remember: 0, Understand: 0, Analyze: 0 };
    questions.forEach((q) => {
      const level = normalizeQuestionLevel(q?.level);
      askedInc[level] += 1;
    });

    if (mode === "short") {
      setGrading(true);
      const result = await gradeShortAnswers(questions, answers);
      setGrades(result);
      if (!completionReportedRef.current) {
        if (Array.isArray(result)) {
          result.forEach((g) => {
            const level = normalizeQuestionLevel(questions[g.idx]?.level);
            if ((Number(g?.score) || 0) < 70) weakInc[level] += 1;
          });
        }
        const solvedFromShort = Array.isArray(result) ? result.filter(g => Number(g?.score) >= 70).length : 0;
        onComplete?.({ solvedProblems: solvedFromShort, weakByLevelIncrement: weakInc, askedByLevelIncrement: askedInc });
        completionReportedRef.current = true;
      }
      setGrading(false);
    } else if (!completionReportedRef.current) {
      const solvedFromMcq = questions.reduce((acc, q, i) => acc + (answers[i] === q.answer ? 1 : 0), 0);
      questions.forEach((q, i) => {
        const level = normalizeQuestionLevel(q?.level);
        if (answers[i] !== q.answer) weakInc[level] += 1;
      });
      onComplete?.({ solvedProblems: solvedFromMcq, weakByLevelIncrement: weakInc, askedByLevelIncrement: askedInc });
      completionReportedRef.current = true;
    }
    setRevealed(true);
  };

  /* ── SETUP ── */
  if (phase === "setup") return (
    <ModalOverlay onClose={onClose}>
      <div style={modalBoxStyle(panel, bdr, "440px")}>
        <ModalHeader title="Quiz Me" subtitle="AI-generated from your notes" icon="quiz" onClose={onClose} text1={text1} text3={text3} />

        <SectionLabel text="Question Type" text3={text3} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
          <ChoiceCard id="mcq" icon="check_box" label="Multiple Choice" sub="4 options · auto-graded" selected={mode === "mcq"} onSelect={setMode} isDark={isDark} bdr={bdr} text1={text1} text3={text3} />
          <ChoiceCard id="short" icon="short_text" label="Short Answer" sub="One precise line" selected={mode === "short"} onSelect={setMode} isDark={isDark} bdr={bdr} text1={text1} text3={text3} />
        </div>

        <SectionLabel text="Scope" text3={text3} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
          <ChoiceCard id="page" icon="insert_drive_file" label="Current Page" sub={`Page ${currentPage}`} selected={scope === "page"} onSelect={setScope} isDark={isDark} bdr={bdr} text1={text1} text3={text3} />
          <ChoiceCard id="pdf" icon="auto_stories" label="Entire PDF" sub={`All ${totalPages} pages`} selected={scope === "pdf"} onSelect={setScope} isDark={isDark} bdr={bdr} text1={text1} text3={text3} />
        </div>

        <SectionLabel text="Number of Questions" text3={text3} />
        <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
          {[3, 5, 7, 10].map(n => (
            <button key={n} onClick={() => setCount(n)} style={{ flex: 1, padding: "10px 0", borderRadius: "10px", border: `2px solid ${count === n ? "#00FF00" : bdr}`, background: count === n ? "rgba(0,255,0,0.1)" : "transparent", color: count === n ? (isDark ? "#00FF00" : "#007700") : text2, fontWeight: 700, fontSize: "13px", cursor: "pointer", fontFamily: "'Lexend',sans-serif", transition: "all 0.18s" }}>{n}</button>
          ))}
        </div>

        {genError && (
          <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", marginBottom: "16px" }}>
            <p style={{ fontSize: "12px", color: "#ef4444", margin: 0 }}>⚠ {genError}</p>
          </div>
        )}

        <button onClick={startQuiz} disabled={!canStart} style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: canStart ? "#00FF00" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"), color: canStart ? "#0f172a" : text3, fontWeight: 700, fontSize: "13px", cursor: canStart ? "pointer" : "not-allowed", fontFamily: "'Lexend',sans-serif", transition: "all 0.18s", boxShadow: canStart ? "0 4px 20px rgba(0,255,0,0.3)" : "none" }}>
          {canStart ? `Generate ${count} ${mode === "mcq" ? "MCQ" : "Short Answer"} Questions` : "Select a question type to continue"}
        </button>
      </div>
    </ModalOverlay>
  );

  /* ── GENERATING ── */
  if (phase === "generating") return (
    <ModalOverlay onClose={() => { }}>
      <div style={modalBoxStyle(panel, bdr, "360px")}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", padding: "12px 0" }}>
          <div style={{ width: "64px", height: "64px", borderRadius: "18px", background: "rgba(0,255,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "28px", height: "28px", border: "3px solid rgba(0,255,0,0.2)", borderTopColor: "#00FF00", borderRadius: "9999px", animation: "spin 0.8s linear infinite" }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: "14px", fontWeight: 700, color: text1, margin: "0 0 6px" }}>Generating your quiz…</p>
            <p style={{ fontSize: "12px", color: text3, margin: 0 }}>{genProgress}</p>
          </div>
          <div style={{ width: "100%", height: "4px", background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", borderRadius: "9999px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: "60%", background: "linear-gradient(90deg,#00AA00,#00FF00)", borderRadius: "9999px", animation: "shimmer 1.5s linear infinite", backgroundSize: "200% 100%" }} />
          </div>
        </div>
      </div>
    </ModalOverlay>
  );

  /* ── LIVE QUIZ ── */
  if (phase === "quiz") return (
    <ModalOverlay onClose={onClose}>
      <div style={{ ...modalBoxStyle(panel, bdr, "580px"), maxHeight: "90vh", display: "flex", flexDirection: "column", overflowY: "hidden" }}>
        {/* Header */}
        <div style={{ paddingBottom: "14px", borderBottom: `1px solid ${bdr}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(0,255,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ fontSize: "20px", color: "#00CC00" }}>quiz</span>
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 700, color: text1, margin: 0 }}>{moduleTitle || moduleKey}</p>
              <p style={{ fontSize: "10px", color: text3, margin: 0 }}>{mode === "mcq" ? "Multiple Choice" : "Short Answer"} · {questions.length} questions</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: answeredCount === questions.length ? "#00CC00" : text2, margin: 0 }}>{answeredCount}/{questions.length} answered</p>
              <div style={{ width: "90px", height: "4px", background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", borderRadius: "9999px" }}>
                <div style={{ height: "100%", width: `${(answeredCount / questions.length) * 100}%`, background: "#00FF00", borderRadius: "9999px", transition: "width 0.3s" }} />
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: text3, width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ fontSize: "20px" }}>close</span>
            </button>
          </div>
        </div>

        {/* Notice banner */}
        {!revealed && (
          <div style={{ padding: "8px 14px", background: "rgba(0,200,0,0.06)", borderBottom: `1px solid ${bdr}`, display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <span className="ms" style={{ fontSize: "15px", color: "#00AA00" }}>lock</span>
            <p style={{ fontSize: "11px", color: text3, margin: 0 }}>Answer all questions, then tap <strong style={{ color: text2 }}>Reveal Answers</strong> to see your score and explanations.</p>
          </div>
        )}

        {/* Questions */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 0", display: "flex", flexDirection: "column", gap: "16px" }}>
          {questions.map((q, i) => {
            const userAns = answers[i];
            const isCorrect = userAns === q.answer;
            const grade = grades?.find(g => g.idx === i);
            const gradeScore = grade?.score ?? null;
            const gradeColor = gradeScore === null ? "#00CC00"
              : gradeScore >= 70 ? "#00CC00"
                : gradeScore >= 40 ? "#f59e0b"
                  : "#ef4444";

            const cardBorder = revealed
              ? mode === "mcq"
                ? (isCorrect ? "rgba(0,255,0,0.35)" : "rgba(239,68,68,0.35)")
                : gradeScore !== null
                  ? (gradeScore >= 70 ? "rgba(0,255,0,0.35)" : gradeScore >= 40 ? "rgba(245,158,11,0.35)" : "rgba(239,68,68,0.35)")
                  : "rgba(0,255,0,0.35)"
              : (userAns !== undefined ? "rgba(0,255,0,0.2)" : bdr);
            const cardBg = revealed
              ? mode === "mcq"
                ? (isCorrect ? "rgba(0,255,0,0.05)" : "rgba(239,68,68,0.05)")
                : gradeScore !== null
                  ? (gradeScore >= 70 ? "rgba(0,255,0,0.05)" : gradeScore >= 40 ? "rgba(245,158,11,0.05)" : "rgba(239,68,68,0.05)")
                  : "rgba(0,255,0,0.05)"
              : (isDark ? "rgba(255,255,255,0.02)" : "rgba(0,200,0,0.02)");

            return (
              <div key={i} style={{
                padding: "16px", borderRadius: "14px",
                border: `1px solid ${cardBorder}`,
                background: cardBg,
                transition: "all 0.25s",
              }}>
                {/* Question */}
                <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                  <span style={{ width: "26px", height: "26px", borderRadius: "8px", background: "rgba(0,200,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#00AA00", flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: "13px", fontWeight: 600, color: text1, margin: 0, lineHeight: 1.6 }}>{q.q}</p>
                    <span style={{ display: "inline-flex", marginTop: "6px", fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#00AA00", padding: "2px 7px", borderRadius: "9999px", background: "rgba(0,255,0,0.09)", border: "1px solid rgba(0,255,0,0.2)" }}>
                      {normalizeQuestionLevel(q.level)}
                    </span>
                  </div>
                </div>

                {/* MCQ Options */}
                {mode === "mcq" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "10px" }}>
                    {q.options?.map((opt, j) => {
                      const isSelected = userAns === opt;
                      const isAnswer = opt === q.answer;
                      let bg = isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)";
                      let border = bdr;
                      let color = text2;
                      if (isSelected && !revealed) { bg = "rgba(0,255,0,0.1)"; border = "rgba(0,255,0,0.4)"; color = isDark ? "#00FF00" : "#007700"; }
                      if (revealed && isAnswer) { bg = "rgba(0,255,0,0.12)"; border = "rgba(0,255,0,0.5)"; color = isDark ? "#00FF00" : "#007700"; }
                      if (revealed && isSelected && !isAnswer) { bg = "rgba(239,68,68,0.1)"; border = "rgba(239,68,68,0.4)"; color = "#ef4444"; }
                      return (
                        <button key={j}
                          disabled={revealed || userAns !== undefined}
                          onClick={() => !revealed && userAns === undefined && setAnswers(a => ({ ...a, [i]: opt }))}
                          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${border}`, background: bg, cursor: revealed || userAns !== undefined ? "default" : "pointer", textAlign: "left", fontFamily: "'Lexend',sans-serif", transition: "all 0.18s", width: "100%" }}
                        >
                          <span style={{ width: "22px", height: "22px", borderRadius: "6px", border: `1.5px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {revealed && isAnswer && <span className="ms" style={{ fontSize: "14px", color: "#00CC00" }}>check</span>}
                            {revealed && isSelected && !isAnswer && <span className="ms" style={{ fontSize: "14px", color: "#ef4444" }}>close</span>}
                            {!revealed && isSelected && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00FF00" }} />}
                          </span>
                          <span style={{ fontSize: "12px", fontWeight: 600, color, lineHeight: 1.5 }}>{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Short Answer input */}
                {mode === "short" && !revealed && (
                  <textarea
                    placeholder="Type your answer here…"
                    value={answers[i] || ""}
                    onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))}
                    rows={2}
                    style={{ width: "100%", background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,200,0,0.04)", border: `1px solid ${bdr}`, borderRadius: "10px", padding: "10px 12px", fontSize: "12px", fontFamily: "'Lexend',sans-serif", color: text1, outline: "none", resize: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
                  />
                )}

                {/* Revealed answer block */}
                {revealed && (
                  <div style={{ marginTop: "10px", borderRadius: "10px", overflow: "hidden", border: `1px solid ${gradeColor}33` }}>
                    {/* Short answer grade bar */}
                    {mode === "short" && gradeScore !== null && (
                      <div style={{ padding: "10px 14px", background: `${gradeColor}15`, borderBottom: `1px solid ${gradeColor}33`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span className="ms" style={{ fontSize: "16px", color: gradeColor }}>{gradeScore >= 70 ? "check_circle" : gradeScore >= 40 ? "info" : "cancel"}</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: gradeColor }}>
                            {gradeScore >= 70 ? "Correct" : gradeScore >= 40 ? "Partially Correct" : "Incorrect"}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ width: "80px", height: "6px", background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)", borderRadius: "9999px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${gradeScore}%`, background: gradeColor, borderRadius: "9999px", transition: "width 0.6s ease" }} />
                          </div>
                          <span style={{ fontSize: "13px", fontWeight: 800, color: gradeColor, minWidth: "36px", textAlign: "right" }}>{gradeScore}%</span>
                        </div>
                      </div>
                    )}
                    <div style={{ padding: "12px 14px", background: `${gradeColor}08` }}>
                      <p style={{ fontSize: "10px", fontWeight: 700, color: gradeColor, margin: "0 0 5px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {mode === "mcq" ? "Correct Answer" : "Model Answer"}
                      </p>
                      <p style={{ fontSize: "12px", fontWeight: 700, color: gradeColor, margin: "0 0 6px", lineHeight: 1.5 }}>{q.answer}</p>
                      {q.explanation && <p style={{ fontSize: "11px", color: text2, margin: 0, lineHeight: 1.6 }}>{q.explanation}</p>}
                      {mode === "short" && (
                        <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${bdr}` }}>
                          <p style={{ fontSize: "10px", fontWeight: 700, color: text3, margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Your Answer</p>
                          <p style={{ fontSize: "12px", color: text2, margin: "0 0 6px", lineHeight: 1.5 }}>{answers[i] || <em style={{ opacity: 0.5 }}>No answer given</em>}</p>
                          {grade?.feedback && (
                            <p style={{ fontSize: "11px", color: gradeColor, margin: 0, fontStyle: "italic", lineHeight: 1.5 }}>💬 {grade.feedback}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ paddingTop: "14px", borderTop: `1px solid ${bdr}`, flexShrink: 0 }}>
          {grading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", padding: "14px" }}>
              <div style={{ width: "20px", height: "20px", border: "2px solid rgba(0,255,0,0.2)", borderTopColor: "#00FF00", borderRadius: "9999px", animation: "spin 0.8s linear infinite" }} />
              <p style={{ fontSize: "13px", fontWeight: 600, color: text2, margin: 0 }}>Grading your answers with AI…</p>
            </div>
          ) : !revealed ? (
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => { setPhase("setup"); setQuestions([]); setAnswers({}); }} style={{ flex: 1, padding: "12px", borderRadius: "11px", border: `1px solid ${bdr}`, background: "transparent", color: text2, fontWeight: 700, fontSize: "12px", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}>
                ← Back
              </button>
              <button onClick={handleReveal} style={{ flex: 2, padding: "12px", borderRadius: "11px", border: "none", background: "#00FF00", color: "#0f172a", fontWeight: 700, fontSize: "13px", cursor: "pointer", fontFamily: "'Lexend',sans-serif", boxShadow: "0 4px 20px rgba(0,255,0,0.3)" }}>
                {mode === "mcq" ? "Reveal Answers & Score" : "Grade My Answers"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* MCQ score */}
              {mode === "mcq" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "rgba(0,255,0,0.08)", borderRadius: "12px", border: "1px solid rgba(0,255,0,0.2)" }}>
                  <div>
                    <p style={{ fontSize: "11px", fontWeight: 700, color: "#00AA00", margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Your Score</p>
                    <p style={{ fontSize: "24px", fontWeight: 700, color: isDark ? "#00FF00" : "#007700", margin: 0 }}>{score} <span style={{ fontSize: "14px", color: text3 }}>/ {questions.length}</span></p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: "22px", fontWeight: 700, color: isDark ? "#00FF00" : "#007700", margin: "0 0 3px" }}>{Math.round((score / questions.length) * 100)}%</p>
                    <p style={{ fontSize: "11px", color: text3, margin: 0 }}>{score === questions.length ? "🏆 Perfect!" : score >= questions.length * 0.7 ? "✅ Great work!" : score >= questions.length * 0.5 ? "📚 Keep studying" : "💪 More revision needed"}</p>
                  </div>
                </div>
              )}
              {/* Short answer score */}
              {mode === "short" && shortScore !== null && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: shortScore >= 70 ? "rgba(0,255,0,0.08)" : shortScore >= 40 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)", borderRadius: "12px", border: `1px solid ${shortScore >= 70 ? "rgba(0,255,0,0.2)" : shortScore >= 40 ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                  <div>
                    <p style={{ fontSize: "11px", fontWeight: 700, color: shortScore >= 70 ? "#00AA00" : shortScore >= 40 ? "#f59e0b" : "#ef4444", margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Overall Score</p>
                    <p style={{ fontSize: "13px", fontWeight: 600, color: text2, margin: 0 }}>AI-graded · {questions.length} questions</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: "28px", fontWeight: 800, color: shortScore >= 70 ? "#00CC00" : shortScore >= 40 ? "#f59e0b" : "#ef4444", margin: "0 0 2px", lineHeight: 1 }}>{shortScore}%</p>
                    <p style={{ fontSize: "11px", color: text3, margin: 0 }}>{shortScore >= 70 ? "✅ Strong answers" : shortScore >= 40 ? "📝 Needs detail" : "💪 Review needed"}</p>
                  </div>
                </div>
              )}
              {mode === "short" && !grades && (
                <div style={{ padding: "10px 14px", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderRadius: "10px", textAlign: "center" }}>
                  <p style={{ fontSize: "11px", color: text3, margin: 0 }}>Grading unavailable — AI returned no score. Review answers manually above.</p>
                </div>
              )}
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={() => { setPhase("setup"); setQuestions([]); setAnswers({}); setRevealed(false); setGrades(null); }} style={{ flex: 1, padding: "12px", borderRadius: "11px", border: `1px solid ${bdr}`, background: "transparent", color: text2, fontWeight: 700, fontSize: "12px", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}>New Quiz</button>
                <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: "11px", border: "none", background: "#00FF00", color: "#0f172a", fontWeight: 700, fontSize: "12px", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );

  return null;
}

/* ─────────────────────────────────────────
   ANALYZE PDF MODAL
───────────────────────────────────────── */
function AnalyzePDFModal({ isDark, onClose, pdfDoc, totalPages, moduleTitle, moduleKey, subject, sem, text1, text2, text3, bdr, panel }) {
  const [phase, setPhase] = useState("setup"); // setup | analyzing | done | error
  const [progress, setProgress] = useState("");
  const [pct, setPct] = useState(0);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [errorMsg, setErrorMsg] = useState("");

  const startAnalysis = async () => {
    if (!pdfDoc) return;
    setPhase("analyzing");
    setPct(5);
    setProgress("Loading pages…");
    try {
      const maxPages = Math.min(totalPages, 5);
      const imgs = [];
      for (let p = 1; p <= maxPages; p++) {
        setProgress(`Reading page ${p} of ${maxPages}…`);
        setPct(5 + Math.round((p / maxPages) * 52));
        const img = await renderPageToBase64(pdfDoc, p, 1.1);
        imgs.push(img);
      }
      setProgress("Neural AI is analyzing your module…");
      setPct(65);

      const systemPrompt = `You are an expert academic analyst for engineering students.
Module: "${moduleTitle || moduleKey}" · Subject: ${subject} · Semester: ${sem}.
Analyze ALL provided pages and return ONLY a valid JSON object — no markdown, no code fences, no prose:
{
  "overview": "2-3 sentence module overview",
  "mainTopics": ["topic1","topic2"],
  "flow": [
    {"step":1,"title":"Section title","description":"1-2 sentences on what this covers","pages":"1-3"},
    ...5-8 steps total
  ],
  "keyConcepts": [
    {"term":"Technical term","definition":"Clear 1-sentence definition"},
    ...8-12 concepts
  ],
  "examTopics": ["High-priority exam topic 1",...6-8 topics],
  "difficulty": "Beginner | Intermediate | Advanced",
  "studyTips": ["Practical study tip 1",...3-4 tips]
}`;

      const res = await callGroq({
        model: GROQ_VISION_MODEL,
        max_tokens: 3200,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: `Analyze this module comprehensively (${maxPages} pages):` },
              ...imgs.map(img => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } }))
            ]
          }
        ]
      });

      setPct(90);
      setProgress("Parsing analysis…");
      const parsed = await parseModelJson(res, { kind: "object", label: "Analysis" });
      setResult(parsed);
      setPhase("done");
      setPct(100);
    } catch (err) {
      setErrorMsg(err.message || "Analysis failed.");
      setPhase("error");
    }
  };

  const diffColor = { "Beginner": "#00CC00", "Intermediate": "#f59e0b", "Advanced": "#ef4444" };

  /* ── SETUP ── */
  if (phase === "setup") return (
    <ModalOverlay onClose={onClose}>
      <div style={modalBoxStyle(panel, bdr, "440px")}>
        <ModalHeader title="Analyze PDF" subtitle="Deep AI analysis of entire module" icon="analytics" onClose={onClose} text1={text1} text3={text3} />
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "22px" }}>
          {[
            { icon: "summarize", label: "Full Summary", desc: "Structured overview with chapter flow" },
            { icon: "account_tree", label: "Topic Flow", desc: "Visual step-by-step content timeline" },
            { icon: "lightbulb", label: "Key Concepts", desc: "All technical terms with definitions" },
            { icon: "school", label: "Exam Prep", desc: "High-priority topics for your exam" },
          ].map(({ icon, label, desc }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", background: isDark ? "rgba(0,255,0,0.04)" : "rgba(0,200,0,0.04)", border: `1px solid ${bdr}`, borderRadius: "12px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(0,255,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span className="ms" style={{ fontSize: "20px", color: "#00CC00" }}>{icon}</span>
              </div>
              <div>
                <p style={{ fontSize: "12px", fontWeight: 700, color: text1, margin: "0 0 2px" }}>{label}</p>
                <p style={{ fontSize: "11px", color: text3, margin: 0 }}>{desc}</p>
              </div>
              <span className="ms" style={{ marginLeft: "auto", fontSize: "16px", color: "#00CC00" }}>check_circle</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 14px", background: "rgba(0,200,0,0.06)", border: `1px solid ${bdr}`, borderRadius: "10px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="ms" style={{ fontSize: "18px", color: "#00AA00", flexShrink: 0 }}>info</span>
          <p style={{ fontSize: "11px", color: text3, margin: 0 }}>Analyzes up to {Math.min(totalPages, 5)} pages using vision AI. Takes 20–40 seconds.</p>
        </div>
        <button onClick={startAnalysis} style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: "#00FF00", color: "#0f172a", fontWeight: 700, fontSize: "13px", cursor: "pointer", fontFamily: "'Lexend',sans-serif", boxShadow: "0 4px 20px rgba(0,255,0,0.3)" }}>
          Start Deep Analysis
        </button>
      </div>
    </ModalOverlay>
  );

  /* ── ANALYZING ── */
  if (phase === "analyzing") return (
    <ModalOverlay onClose={() => { }}>
      <div style={modalBoxStyle(panel, bdr, "380px")}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", padding: "16px 0" }}>
          <div style={{ position: "relative", width: "72px", height: "72px" }}>
            <div style={{ width: "72px", height: "72px", borderRadius: "18px", background: "rgba(0,255,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ fontSize: "32px", color: "#00CC00" }}>analytics</span>
            </div>
            <div style={{ position: "absolute", inset: "-4px", borderRadius: "22px", border: "2px solid transparent", borderTopColor: "#00FF00", animation: "spin 1.2s linear infinite" }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: "15px", fontWeight: 700, color: text1, margin: "0 0 6px" }}>Analyzing your module…</p>
            <p style={{ fontSize: "12px", color: text3, margin: "0 0 16px" }}>{progress}</p>
            <div style={{ width: "260px", height: "6px", background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", borderRadius: "9999px", overflow: "hidden", margin: "0 auto" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#00AA00,#00FF00)", borderRadius: "9999px", transition: "width 0.5s ease" }} />
            </div>
            <p style={{ fontSize: "11px", color: "#00AA00", fontWeight: 700, marginTop: "8px" }}>{pct}%</p>
          </div>
          <p style={{ fontSize: "10px", color: text3, textAlign: "center", maxWidth: "280px" }}>Neural AI is reading up to 5 pages. This may take 20–40 seconds.</p>
        </div>
      </div>
    </ModalOverlay>
  );

  /* ── ERROR ── */
  if (phase === "error") return (
    <ModalOverlay onClose={onClose}>
      <div style={modalBoxStyle(panel, bdr, "360px")}>
        <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
          <div style={{ width: "64px", height: "64px", borderRadius: "18px", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <span className="ms" style={{ fontSize: "32px", color: "#ef4444" }}>error</span>
          </div>
          <p style={{ fontSize: "15px", fontWeight: 700, color: text1, margin: "0 0 8px" }}>Analysis Failed</p>
          <p style={{ fontSize: "12px", color: text3, margin: "0 0 20px" }}>{errorMsg}</p>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: "11px", border: `1px solid ${bdr}`, background: "transparent", color: text2, fontWeight: 700, fontSize: "12px", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}>Close</button>
            <button onClick={() => { setPhase("setup"); setErrorMsg(""); }} style={{ flex: 1, padding: "12px", borderRadius: "11px", border: "none", background: "#00FF00", color: "#0f172a", fontWeight: 700, fontSize: "12px", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}>Try Again</button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );

  /* ── RESULTS ── */
  if (phase === "done" && result) {
    const tabs = [
      { id: "summary", icon: "summarize", label: "Summary" },
      { id: "flow", icon: "account_tree", label: "Flow" },
      { id: "concepts", icon: "lightbulb", label: "Concepts" },
      { id: "exam", icon: "school", label: "Exam Prep" },
    ];
    return (
      <ModalOverlay onClose={onClose}>
        <div style={{ ...modalBoxStyle(panel, bdr, "620px"), maxHeight: "90vh", display: "flex", flexDirection: "column", overflowY: "hidden" }}>
          {/* Header */}
          <div style={{ paddingBottom: "14px", borderBottom: `1px solid ${bdr}`, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(0,255,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="ms" style={{ fontSize: "20px", color: "#00CC00" }}>analytics</span>
                </div>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 700, color: text1, margin: 0 }}>{moduleTitle || moduleKey}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "3px" }}>
                    <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 8px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.2)", borderRadius: "9999px", color: "#00AA00" }}>GROQ ANALYSIS</span>
                    {result.difficulty && (
                      <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 8px", background: `${diffColor[result.difficulty]}18`, border: `1px solid ${diffColor[result.difficulty]}44`, borderRadius: "9999px", color: diffColor[result.difficulty] }}>
                        {result.difficulty.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: text3, width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="ms" style={{ fontSize: "20px" }}>close</span>
              </button>
            </div>
            <p style={{ fontSize: "12px", color: text2, lineHeight: 1.65, margin: "0 0 12px" }}>{result.overview}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
              {[
                { label: "Topics", value: result.mainTopics?.length || 0 },
                { label: "Concepts", value: result.keyConcepts?.length || 0 },
                { label: "Pages", value: Math.min(totalPages, 5) },
              ].map(({ label, value }) => (
                <div key={label} style={{ padding: "10px", background: isDark ? "rgba(0,255,0,0.05)" : "rgba(0,200,0,0.05)", borderRadius: "10px", textAlign: "center" }}>
                  <p style={{ fontSize: "20px", fontWeight: 700, color: isDark ? "#00FF00" : "#007700", margin: "0 0 2px" }}>{value}</p>
                  <p style={{ fontSize: "10px", color: text3, margin: 0 }}>{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", padding: "10px 0", borderBottom: `1px solid ${bdr}`, flexShrink: 0, overflowX: "auto" }}>
            {tabs.map(({ id, icon, label }) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "7px 12px", borderRadius: "9px", border: "none", background: activeTab === id ? "rgba(0,255,0,0.1)" : "transparent", color: activeTab === id ? (isDark ? "#00FF00" : "#007700") : text2, fontWeight: activeTab === id ? 700 : 500, fontSize: "12px", cursor: "pointer", fontFamily: "'Lexend',sans-serif", transition: "all 0.18s", whiteSpace: "nowrap", flexShrink: 0 }}>
                <span className="ms" style={{ fontSize: "15px" }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>

            {/* SUMMARY */}
            {activeTab === "summary" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <SectionLabel text="Main Topics Covered" text3={text3} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "6px" }}>
                  {result.mainTopics?.map((t, i) => (
                    <span key={i} style={{ padding: "5px 12px", background: "rgba(0,255,0,0.08)", border: "1px solid rgba(0,255,0,0.2)", borderRadius: "9999px", fontSize: "11px", fontWeight: 600, color: isDark ? "#00EE00" : "#007700" }}>{t}</span>
                  ))}
                </div>
                <SectionLabel text="Study Tips" text3={text3} />
                {result.studyTips?.map((tip, i) => (
                  <div key={i} style={{ display: "flex", gap: "10px", padding: "12px 14px", background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,200,0,0.03)", border: `1px solid ${bdr}`, borderRadius: "11px" }}>
                    <span style={{ width: "24px", height: "24px", borderRadius: "7px", background: "rgba(0,200,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#00AA00", flexShrink: 0 }}>{i + 1}</span>
                    <p style={{ fontSize: "12px", color: text2, margin: 0, lineHeight: 1.6 }}>{tip}</p>
                  </div>
                ))}
              </div>
            )}

            {/* FLOW */}
            {activeTab === "flow" && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {result.flow?.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: "14px" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "34px", flexShrink: 0 }}>
                      <div style={{ width: "34px", height: "34px", borderRadius: "9999px", background: "rgba(0,255,0,0.15)", border: "2px solid #00CC00", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1, flexShrink: 0 }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#00CC00" }}>{step.step}</span>
                      </div>
                      {i < (result.flow.length - 1) && <div style={{ width: "2px", flex: 1, background: "rgba(0,200,0,0.2)", minHeight: "16px" }} />}
                    </div>
                    <div style={{ paddingBottom: "18px", flex: 1, paddingTop: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <p style={{ fontSize: "13px", fontWeight: 700, color: text1, margin: 0 }}>{step.title}</p>
                        {step.pages && <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 7px", background: "rgba(0,200,0,0.08)", border: "1px solid rgba(0,200,0,0.2)", borderRadius: "9999px", color: "#00AA00" }}>p.{step.pages}</span>}
                      </div>
                      <p style={{ fontSize: "12px", color: text2, margin: 0, lineHeight: 1.6 }}>{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* CONCEPTS */}
            {activeTab === "concepts" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.keyConcepts?.map((c, i) => (
                  <div key={i} style={{ padding: "12px 14px", background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,200,0,0.03)", border: `1px solid ${bdr}`, borderRadius: "12px" }}>
                    <p style={{ fontSize: "12px", fontWeight: 700, color: isDark ? "#00EE00" : "#007700", margin: "0 0 5px" }}>{c.term}</p>
                    <p style={{ fontSize: "12px", color: text2, margin: 0, lineHeight: 1.6 }}>{c.definition}</p>
                  </div>
                ))}
              </div>
            )}

            {/* EXAM PREP */}
            {activeTab === "exam" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ padding: "12px 14px", background: "rgba(0,255,0,0.07)", border: "1px solid rgba(0,255,0,0.2)", borderRadius: "12px", marginBottom: "4px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <span className="ms" style={{ fontSize: "18px", color: "#00AA00", flexShrink: 0 }}>tips_and_updates</span>
                  <div>
                    <p style={{ fontSize: "12px", fontWeight: 700, color: "#00AA00", margin: "0 0 3px" }}>High-Priority Exam Topics</p>
                    <p style={{ fontSize: "11px", color: text3, margin: 0 }}>Ranked by likelihood of appearing in your university exam.</p>
                  </div>
                </div>
                {result.examTopics?.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,200,0,0.03)", border: `1px solid ${bdr}`, borderRadius: "11px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: i < 3 ? "#00FF00" : i < 5 ? "#f59e0b" : "#888", flexShrink: 0 }} />
                    <p style={{ fontSize: "12px", fontWeight: 600, color: text1, margin: 0, flex: 1 }}>{t}</p>
                    {i < 3 && <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 8px", background: "rgba(0,255,0,0.1)", border: "1px solid rgba(0,255,0,0.2)", borderRadius: "9999px", color: "#00AA00", flexShrink: 0 }}>HIGH</span>}
                    {i >= 3 && i < 5 && <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 8px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "9999px", color: "#f59e0b", flexShrink: 0 }}>MED</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ModalOverlay>
    );
  }
  return null;
}

/* ─────────────────────────────────────────
   THEME HOOK
───────────────────────────────────────── */
function useTheme() {
  const KEY = "studybuddy_theme";
  const [theme, setThemeState] = useState("system");
  const [resolved, setResolved] = useState("light");
  useEffect(() => { try { setThemeState(localStorage.getItem(KEY) || "system"); } catch { } }, []);
  const setTheme = (val) => { try { localStorage.setItem(KEY, val); } catch { } setThemeState(val); };
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const upd = () => setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    upd(); mq.addEventListener("change", upd); return () => mq.removeEventListener("change", upd);
  }, [theme]);
  return { theme, setTheme, resolved };
}

/* ═══════════════════════════════════════════
   INNER VIEWER
═══════════════════════════════════════════ */
function PDFViewerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const chatInputRef = useRef(null);
  const pdfBufferRef = useRef(null);
  const pdfUrlRef = useRef("");
  const warmedPagesRef = useRef(new Set());

  const branch = searchParams.get("branch") || "";
  const sem = normalizeSem(searchParams.get("sem") || "");
  const subject = searchParams.get("subject") || "";
  const moduleKey = searchParams.get("module") || "";

  const [authUser, setAuthUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessReason, setAccessReason] = useState("");

  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.4);
  const [loadStatus, setLoadStatus] = useState("idle");
  const [loadMsg, setLoadMsg] = useState("");
  const [loadPct, setLoadPct] = useState(0);
  const [pdfSource, setPdfSource] = useState("");
  const [warmStatus, setWarmStatus] = useState({ active: false, done: 0, total: 0 });
  const [rendering, setRendering] = useState(false);
  const [moduleTitle, setModuleTitle] = useState("");
  const [fileName, setFileName] = useState("");

  const [chatOpen, setChatOpen] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([{
    role: "ai",
    text: "Hi! I'm your **Neural AI Assistant**.\n\nI can see your current page and answer questions about it.\n\n**Slash Commands:**\n- `/current` — Page-only strict answer\n- `/draw` — ASCII diagram of the concept\n- `/explain` — Concept + real-world example\n- `/diagram` — Structured flowchart\n- `/fullexplain` — Detailed explanation + exam tips\n\nOr use the quick action buttons above ↑",
  }]);
  const [aiLoading, setAiLoading] = useState(false);

  const [quizOpen, setQuizOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [activeDiagram, setActiveDiagram] = useState(null); // { text, title }

  // Resizable AI sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("studybuddy_sidebar_w");
        if (saved) return Math.max(280, Math.min(700, Number(saved)));
      } catch { }
    }
    return 380;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarResizeStartXRef = useRef(0);
  const sidebarResizeStartWRef = useRef(380);

  // PDF Page Fitting & Auto-fit
  const [autoFitWidth, setAutoFitWidth] = useState(true);

  // Annotations Layer State
  const [annotTool, setAnnotTool] = useState("view"); // 'view' | 'pen' | 'highlight' | 'eraser'
  const [annotColor, setAnnotColor] = useState("#ef4444");
  const [annotWidth, setAnnotWidth] = useState(3);
  const [annotLines, setAnnotLines] = useState([]); // Array of { id, tool, color, width, opacity, points: [{x, y}] }
  const [annotSaveStatus, setAnnotSaveStatus] = useState("idle"); // 'idle' | 'saving' | 'saved'
  const [cursorPos, setCursorPos] = useState(null); // { x, y } for pen/brush visual indicator
  const isDrawingRef = useRef(false);
  const currentLineRef = useRef(null);
  const annotCanvasRef = useRef(null);

  const [sheetHeight, setSheetHeight] = useState(55);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const sheetDragStart = useRef(null);
  const chatEndRef = useRef(null);

  const [ctxMenu, setCtxMenu] = useState(null);
  const sessionStartRef = useRef(null);
  const aiQuestionsRef = useRef(0);
  const solvedProblemsRef = useRef(0);
  const weakByLevelRef = useRef({ Remember: 0, Understand: 0, Analyze: 0 });
  const askedByLevelRef = useRef({ Remember: 0, Understand: 0, Analyze: 0 });
  const recentNoteWrittenRef = useRef(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const chk = () => setIsMobile(window.innerWidth <= 768);
    chk(); window.addEventListener("resize", chk); return () => window.removeEventListener("resize", chk);
  }, []);

  useEffect(() => {
    cleanupInactivePdfCaches();
  }, []);

  const bg = isDark ? "#080f1a" : "#f0f4f0";
  const panel = isDark ? "rgba(8,15,26,0.97)" : "rgba(255,255,255,0.97)";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.12)";

  /* ── Auth ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      const s = await get(dbRef(db, `users/${u.uid}`));
      if (s.exists()) setUserData(s.val());
      setAuthLoading(false);
      const r = await validateAccess(db, u.uid, branch, sem, subject, moduleKey);
      if (!r.allowed) { setAccessDenied(true); setAccessReason(r.reason || "Access denied."); }
    });
    return () => unsub();
  }, [router, branch, sem, subject, moduleKey]);

  const flushViewerStats = useCallback(async () => {
    if (!authUser?.uid || !sessionStartRef.current) return;
    const now = Date.now();
    const studyMs = Math.max(0, now - sessionStartRef.current);
    const aiQuestions = aiQuestionsRef.current;
    const solvedProblems = solvedProblemsRef.current;
    const weakByLevelIncrement = { ...weakByLevelRef.current };
    const askedByLevelIncrement = { ...askedByLevelRef.current };
    const weakSum = Object.values(weakByLevelIncrement).reduce((s, v) => s + (Number(v) || 0), 0);
    const askedSum = Object.values(askedByLevelIncrement).reduce((s, v) => s + (Number(v) || 0), 0);
    if (studyMs < 1000 && aiQuestions === 0 && solvedProblems === 0 && weakSum === 0 && askedSum === 0) return;

    sessionStartRef.current = now;
    aiQuestionsRef.current = 0;
    solvedProblemsRef.current = 0;
    weakByLevelRef.current = { Remember: 0, Understand: 0, Analyze: 0 };
    askedByLevelRef.current = { Remember: 0, Understand: 0, Analyze: 0 };
    await flushUsageStats(db, authUser.uid, { studyMs, aiQuestions, solvedProblems, weakByLevelIncrement, askedByLevelIncrement });
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid || authLoading || accessDenied) return;
    if (!sessionStartRef.current) sessionStartRef.current = Date.now();
    flushPendingUsageStats(db, authUser.uid);
  }, [authUser?.uid, authLoading, accessDenied]);

  useEffect(() => {
    if (!authUser?.uid || authLoading || accessDenied) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushViewerStats();
      } else if (!sessionStartRef.current) {
        sessionStartRef.current = Date.now();
      }
    };

    const onPageHide = () => { flushViewerStats(); };
    const onBeforeUnload = () => { flushViewerStats(); };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushViewerStats();
    };
  }, [authUser?.uid, authLoading, accessDenied, flushViewerStats]);

  /* ── Module title + filename ── */
  useEffect(() => {
    if (!branch || !sem || !subject || !moduleKey) return;
    loadSubjectTitle(branch, sem, subject, moduleKey).then(title => { if (title) setModuleTitle(title); });
    (async () => {
      const localCached = await readPdfLocalCache(branch, sem, subject, moduleKey);
      if (localCached?.meta?.fileName) {
        setFileName(localCached.meta.fileName || `${moduleKey}.pdf`);
        return;
      }
      loadPdfMeta(branch, sem, subject, moduleKey).then(({ data } = {}) => { if (data) setFileName(data.fileName || `${moduleKey}.pdf`); });
    })();
  }, [branch, sem, subject, moduleKey]);

  useEffect(() => {
    if (!authUser?.uid || !subject || !moduleKey || recentNoteWrittenRef.current) return;
    const safeKey = `${subject}_${moduleKey}`.replace(/[.#$\[\]/]/g, "_");
    const recentNotePayload = {
      key: moduleKey,
      module: moduleKey,
      subject,
      branch,
      sem,
      title: moduleTitle || moduleKey,
      desc: "Recently opened from PDF viewer",
      icon: "description",
      updatedAt: Date.now(),
    };
    update(dbRef(db, `users/${authUser.uid}/recentNotes/${safeKey}`), {
      ...recentNotePayload,
    }).catch(() => { });
    patchDashboardRecentNote(authUser.uid, recentNotePayload);
    recentNoteWrittenRef.current = true;
  }, [authUser?.uid, subject, moduleKey, moduleTitle]);

  /* ── Load PDF ── */
  const initPDFJS = useCallback(async ({ buffer, url }) => {
    try {
      const lib = window["pdfjs-dist/build/pdf"];
      if (!lib) return;
      lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const doc = buffer
        ? await lib.getDocument({ data: buffer.slice(0) }).promise
        : await lib.getDocument({
            url,
            rangeChunkSize: PDF_STREAM_CHUNK_BYTES,
            disableAutoFetch: false,
            disableStream: false,
          }).promise;
      warmedPagesRef.current = new Set([1]);
      setWarmStatus({ active: false, done: 0, total: 0 });
      setPdfDoc(doc); setTotalPages(doc.numPages); setCurrentPage(1); setLoadStatus("ready"); setLoadPct(100);
    } catch (err) { setLoadStatus("error"); setLoadMsg(err.message); }
  }, []);

  useEffect(() => {
    if (!pdfDoc || loadStatus !== "ready" || !totalPages) return;
    let cancelled = false;
    const targets = [];
    for (const p of [currentPage + 1, currentPage + 2, currentPage - 1]) {
      if (p >= 1 && p <= totalPages && !warmedPagesRef.current.has(p) && !targets.includes(p)) {
        targets.push(p);
      }
    }
    if (!targets.length) {
      setWarmStatus({ active: false, done: 0, total: 0 });
      return;
    }

    setWarmStatus({ active: true, done: 0, total: targets.length });

    const warm = async () => {
      for (let i = 0; i < targets.length; i++) {
        const pageNum = targets[i];
        try {
          await pdfDoc.getPage(pageNum);
          warmedPagesRef.current.add(pageNum);
          if (!cancelled) {
            setWarmStatus({ active: i + 1 < targets.length, done: i + 1, total: targets.length });
          }
        } catch { }
        if (cancelled) return;
        await new Promise(r => setTimeout(r, 0));
      }
      if (!cancelled) setWarmStatus({ active: false, done: targets.length, total: targets.length });
    };

    warm();
    return () => { cancelled = true; };
  }, [pdfDoc, loadStatus, currentPage, totalPages]);

  useEffect(() => {
    if (!branch || !sem || !subject || !moduleKey || authLoading || accessDenied) return;
    pdfBufferRef.current = null;
    pdfUrlRef.current = "";
    setPdfSource("");
    setLoadStatus("loading"); setLoadMsg("Loading PDF engine…"); setLoadPct(5);
    const existing = document.getElementById("pdfjs-script");
    const doLoad = async () => {
      try {
        const { buffer, url, source } = await loadPDF(branch, sem, subject, moduleKey, (p, m, source) => {
          setLoadPct(p);
          setLoadMsg(source ? `${m} · ${source === "local" ? "💾 Local" : source === "redis" ? "⚡ Redis" : source === "firebase" ? "🔴 Firebase" : source === "stream" ? "🌊 Stream" : `🔀 ${source}`}` : m);
        });
        pdfBufferRef.current = buffer;
        pdfUrlRef.current = url || "";
        setPdfSource(source || "firebase");
        await initPDFJS({ buffer, url });
      } catch (err) {
        setLoadStatus("error");
        setLoadMsg(err.message);
      }
    };
    if (existing) { doLoad(); return; }
    const sc = document.createElement("script");
    sc.id = "pdfjs-script";
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    sc.onload = doLoad;
    sc.onerror = () => { setLoadStatus("error"); setLoadMsg("Failed to load PDF engine."); };
    document.head.appendChild(sc);
  }, [branch, sem, subject, moduleKey, authLoading, accessDenied, initPDFJS]);

  const downloadPdf = useCallback(async () => {
    if (pdfBufferRef.current) return pdfBufferRef.current;
    if (!branch || !sem || !subject || !moduleKey) return null;
    const { data: chunks } = await loadPdfChunks(branch, sem, subject, moduleKey);
    if (!chunks?.length) return null;
    const buffer = assemblePdfBuffer(chunks);
    pdfBufferRef.current = buffer;
    return buffer;
  }, [branch, sem, subject, moduleKey]);

  /* ── Sidebar Resizing (Desktop) ── */
  const onSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarResizeStartXRef.current = e.clientX;
    sidebarResizeStartWRef.current = sidebarWidth;

    const onPointerMove = (ev) => {
      const deltaX = sidebarResizeStartXRef.current - ev.clientX; // drag left expands sidebar
      const nextW = Math.max(280, Math.min(720, sidebarResizeStartWRef.current + deltaX));
      setSidebarWidth(nextW);
    };

    const onPointerUp = (ev) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setIsResizingSidebar(false);
      const deltaX = sidebarResizeStartXRef.current - ev.clientX;
      const finalW = Math.max(280, Math.min(720, sidebarResizeStartWRef.current + deltaX));
      try { localStorage.setItem("studybuddy_sidebar_w", String(finalW)); } catch { }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [sidebarWidth]);

  /* ── Load Page Annotations ── */
  useEffect(() => {
    if (!branch || !sem || !subject || !moduleKey || !currentPage) return;
    let cancelled = false;
    loadPageAnnotations(authUser?.uid, branch, sem, subject, moduleKey, currentPage).then(data => {
      if (!cancelled) {
        setAnnotLines(data?.lines || []);
      }
    });
    return () => { cancelled = true; };
  }, [authUser?.uid, branch, sem, subject, moduleKey, currentPage]);

  /* ── Redraw Annotations Layer on Canvas ── */
  const redrawAnnotations = useCallback(() => {
    const cv = annotCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);

    annotLines.forEach(line => {
      if (!line.points || line.points.length < 2) return;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = line.color || "#ef4444";
      ctx.lineWidth = line.width || 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = line.opacity || 1;

      // Coordinate scaling based on current canvas dimension vs original
      const scaleX = cv.width;
      const scaleY = cv.height;

      const p0 = line.points[0];
      ctx.moveTo(p0.x * scaleX, p0.y * scaleY);

      for (let i = 1; i < line.points.length; i++) {
        const pt = line.points[i];
        ctx.lineTo(pt.x * scaleX, pt.y * scaleY);
      }
      ctx.stroke();
      ctx.restore();
    });
  }, [annotLines]);

  useEffect(() => {
    redrawAnnotations();
  }, [redrawAnnotations, annotLines, scale]);

  /* ── Auto-Fit to Width Handler ── */
  const fitWidth = useCallback(async () => {
    if (!containerRef.current || !pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const vp1 = page.getViewport({ scale: 1 });
      // Width available inside container minus padding
      const containerW = containerRef.current.clientWidth - (isMobile ? 24 : 80);
      const targetScale = Math.max(0.5, Math.min(2.8, +(containerW / vp1.width).toFixed(2)));
      setScale(targetScale);
    } catch { }
  }, [currentPage, pdfDoc, isMobile]);

  // Handle auto-fit on resize or load
  useEffect(() => {
    if (!autoFitWidth || !pdfDoc || loadStatus !== "ready") return;
    const handleResize = () => {
      fitWidth();
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [autoFitWidth, pdfDoc, loadStatus, fitWidth]);

  /* ── Annotation Pointer Handlers ── */
  const handleAnnotPointerDown = (e) => {
    if (annotTool === "view") return;
    const cv = annotCanvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (annotTool === "eraser") {
      // Find and remove lines near pointer
      const threshold = 0.03;
      setAnnotLines(lines => {
        const remaining = lines.filter(line => {
          return !line.points.some(p => Math.hypot(p.x - x, p.y - y) < threshold);
        });
        savePageAnnotations(authUser?.uid, branch, sem, subject, moduleKey, currentPage, { lines: remaining });
        return remaining;
      });
      return;
    }

    isDrawingRef.current = true;
    const newLine = {
      id: Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      tool: annotTool,
      color: annotTool === "highlight" ? (annotColor === "#ef4444" ? "#fef08a" : annotColor) : annotColor,
      width: annotTool === "highlight" ? Math.max(16, annotWidth * 4) : annotWidth,
      opacity: annotTool === "highlight" ? 0.38 : 1,
      points: [{ x, y }],
    };
    currentLineRef.current = newLine;
  };

  const handleAnnotPointerMove = (e) => {
    const cv = annotCanvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;

    // Track cursor position on canvas for pen/brush preview
    if (annotTool !== "view") {
      setCursorPos({ x: pixelX, y: pixelY });
    }

    if (!isDrawingRef.current || !currentLineRef.current) return;
    const x = pixelX / rect.width;
    const y = pixelY / rect.height;

    currentLineRef.current.points.push({ x, y });

    // Draw active stroke incrementally
    const ctx = cv.getContext("2d");
    const pts = currentLineRef.current.points;
    if (pts.length >= 2) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = currentLineRef.current.color;
      ctx.lineWidth = currentLineRef.current.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = currentLineRef.current.opacity;
      const pPrev = pts[pts.length - 2];
      ctx.moveTo(pPrev.x * cv.width, pPrev.y * cv.height);
      ctx.lineTo(x * cv.width, y * cv.height);
      ctx.stroke();
      ctx.restore();
    }
  };

  const handleAnnotPointerUp = () => {
    if (!isDrawingRef.current || !currentLineRef.current) return;
    isDrawingRef.current = false;
    const finishedLine = currentLineRef.current;
    currentLineRef.current = null;

    if (finishedLine.points.length > 1) {
      setAnnotLines(prev => {
        const next = [...prev, finishedLine];
        setAnnotSaveStatus("saving");
        savePageAnnotations(authUser?.uid, branch, sem, subject, moduleKey, currentPage, { lines: next })
          .then(() => {
            setAnnotSaveStatus("saved");
            setTimeout(() => setAnnotSaveStatus("idle"), 2000);
          });
        return next;
      });
    }
  };

  const clearCurrentPageAnnotations = () => {
    if (confirm("Clear all annotations on this page?")) {
      setAnnotLines([]);
      savePageAnnotations(authUser?.uid, branch, sem, subject, moduleKey, currentPage, { lines: [] });
    }
  };

  // Drag-to-scroll (pan) state for View mode
  const isPanningPdfRef = useRef(false);
  const panScrollStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const onPdfAreaPointerDown = (e) => {
    if (annotTool !== "view") return;
    if (!containerRef.current) return;
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".ctrl-bar")) return;

    isPanningPdfRef.current = true;
    panScrollStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    };
  };

  const onPdfAreaPointerMove = (e) => {
    if (!isPanningPdfRef.current || !containerRef.current || annotTool !== "view") return;
    const dx = e.clientX - panScrollStartRef.current.x;
    const dy = e.clientY - panScrollStartRef.current.y;
    containerRef.current.scrollLeft = panScrollStartRef.current.scrollLeft - dx;
    containerRef.current.scrollTop = panScrollStartRef.current.scrollTop - dy;
  };

  const onPdfAreaPointerUp = () => {
    isPanningPdfRef.current = false;
  };

  /* ── Random Page Jump ── */
  const goToRandomPage = () => {
    if (totalPages <= 1) return;
    let nextP = Math.floor(Math.random() * totalPages) + 1;
    if (nextP === currentPage) {
      nextP = (nextP % totalPages) + 1;
    }
    setCurrentPage(nextP);
  };

  /* ── Render page ── */
  const renderPage = useCallback(async (doc, pageNum, sc) => {
    if (!doc || !canvasRef.current) return;
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const vp = page.getViewport({ scale: sc });
      const cv = canvasRef.current;
      cv.width = vp.width; cv.height = vp.height;

      // Match annotation overlay canvas size exactly
      if (annotCanvasRef.current) {
        annotCanvasRef.current.width = vp.width;
        annotCanvasRef.current.height = vp.height;
      }

      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      redrawAnnotations();
    } catch { }
    setRendering(false);
  }, [redrawAnnotations]);

  useEffect(() => {
    if (pdfDoc && loadStatus === "ready") renderPage(pdfDoc, currentPage, scale);
  }, [pdfDoc, currentPage, scale, loadStatus, renderPage]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close); window.addEventListener("scroll", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close); };
  }, [ctxMenu]);

  const handleContextMenu = useCallback((e) => {
    if (loadStatus !== "ready") return;
    e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [loadStatus]);

  /* ── Send message ── */
  const sendMessage = useCallback(async (rawText) => {
    if (!rawText?.trim() || aiLoading) return;
    const { command, query } = parseCommand(rawText.trim());
    setChatInput("");
    requestAnimationFrame(() => chatInputRef.current?.focus());
    setMessages(m => [...m, { role: "user", text: rawText.trim(), command }]);
    aiQuestionsRef.current += 1;
    setAiLoading(true);
    const sysPrompt = buildSystemPrompt(command, moduleTitle, moduleKey, subject, sem, currentPage, totalPages);
    const userQuery = query || rawText.trim();
    const cmdLabels = { draw: "✏️ Drawing diagram…", diagram: "📐 Building diagram…", explain: "💡 Explaining with example…", fullexplain: "📖 Full explanation loading…" };
    const tempMsg = cmdLabels[command] || `📄 Reading page ${currentPage}…`;
    try {
      if (pdfDoc) {
        setMessages(m => [...m, { role: "ai", text: tempMsg, temp: true }]);
        try {
          const img = await renderPageToBase64(pdfDoc, currentPage, 1.5);
          setMessages(m => m.filter(x => !x.temp));
          const maxTok = (command === "fullexplain" || command === "diagram" || command === "draw") ? 2000 : 1200;
          const reply = await callGroq({
            model: GROQ_VISION_MODEL,
            max_tokens: maxTok,
            messages: [
              { role: "system", content: sysPrompt },
              {
                role: "user", content: [
                  { type: "text", text: userQuery || "Respond based on this page." },
                  { type: "text", text: `--- Page ${currentPage}/${totalPages} ---` },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } },
                ]
              },
            ],
          });
          setMessages(m => [...m, { role: "ai", text: reply, command }]);
          return;
        } catch (e) {
          console.warn("Vision failed, fallback:", e);
          setMessages(m => m.filter(x => !x.temp));
        }
      }
      const maxTok = (command === "fullexplain" || command === "diagram" || command === "draw") ? 2000 : 1200;
      const reply = await callGroq({
        model: GROQ_TEXT_MODEL,
        max_tokens: maxTok,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userQuery },
        ],
      });
      setMessages(m => [...m, { role: "ai", text: reply, command }]);
    } catch (err) {
      setMessages(m => m.filter(x => !x.temp));
      setMessages(m => [...m, { role: "ai", text: `⚠️ ${err.message || "Network error."}` }]);
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, pdfDoc, currentPage, totalPages, moduleTitle, moduleKey, subject, sem]);

  /* Quick actions */
  const quickActions = useMemo(() => [
    { icon: "summarize", label: "Summarize", prompt: `Summarize the key points of "${moduleTitle || moduleKey}" in bullet points for exam prep.` },
    { icon: "quiz", label: "Quiz me", isQuiz: true },
    { icon: "analytics", label: "Analyze PDF", isAnalyze: true },
    { icon: "draw", label: "Draw it", prompt: `/draw the main concept on this page as a clear labeled diagram` },
    { icon: "school", label: "Explain", prompt: `/explain the main concept on this page` },
    { icon: "auto_stories", label: "Full explain", prompt: `/fullexplain the entire topic on this page with examples and exam tips` },
    { icon: "account_tree", label: "Diagram", prompt: `/diagram of the main topic or process on this page` },
    { icon: "article", label: "This page", prompt: `/current Summarize what this page is about and list exam key points.` },
  ], [moduleTitle, moduleKey, currentPage]);

  /* Context menu AI actions */
  const ctxAiActions = useMemo(() => [
    { icon: "article", label: "Summarize this page", prompt: `/current Summarize page ${currentPage} of "${moduleTitle || moduleKey}" for exam revision.` },
    { icon: "quiz", label: "Quiz this page", isQuiz: true },
    { icon: "analytics", label: "Analyze entire PDF", isAnalyze: true },
    { icon: "draw", label: "Draw concept", prompt: `/draw the main concept on this page as a labeled diagram` },
    { icon: "school", label: "Explain with example", prompt: `/explain the main concept visible on this page` },
    { icon: "account_tree", label: "Flowchart this page", prompt: `/diagram of the process or system shown on this page` },
    { icon: "lightbulb", label: "Key points here", prompt: `/current List the most important exam points on this page.` },
  ], [currentPage, moduleTitle, moduleKey]);

  /* Mobile sheet drag */
  const onSheetPointerDown = (e) => { setIsDraggingSheet(true); sheetDragStart.current = { y: e.clientY, height: sheetHeight }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onSheetPointerMove = (e) => { if (!isDraggingSheet || !sheetDragStart.current) return; const d = (sheetDragStart.current.y - e.clientY) / window.innerHeight * 100; setSheetHeight(Math.min(92, Math.max(20, sheetDragStart.current.height + d))); };
  const onSheetPointerUp = () => { setIsDraggingSheet(false); if (sheetHeight < 28) { setChatOpen(false); setSheetHeight(55); } else if (sheetHeight > 75) setSheetHeight(88); else setSheetHeight(55); };

  const fullName = userData?.fullName || authUser?.displayName || "";
  const photoURL = userData?.photoURL || authUser?.photoURL || "";
  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";

  const AvatarEl = ({ size = 36 }) => (
    <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: "9999px", border: "2px solid #00FF00", overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0", flexShrink: 0 }}>
      {photoURL
        ? <img src={photoURL} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontSize: `${size * 0.4}px`, fontWeight: 900, fontFamily: "'Lexend',sans-serif" }}>{firstName?.[0]?.toUpperCase() || "?"}</div>
      }
    </div>
  );

  const SlashHint = useCallback(() => {
    if (!chatInput.startsWith("/")) return null;
    const typed = chatInput.split(" ")[0].toLowerCase();
    const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(typed));
    if (!filtered.length) return null;
    return (
      <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: isDark ? "#0d1626" : "#fff", border: `1px solid ${bdr}`, borderRadius: "14px", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,0.3)", zIndex: 10 }}>
        <div style={{ padding: "6px 12px 4px", fontSize: "9px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: `1px solid ${bdr}` }}>
          Commands
        </div>
        {filtered.map(({ cmd, icon, desc, color }) => (
          <button key={cmd}
            onMouseDown={e => { e.preventDefault(); setChatInput(cmd + " "); chatInputRef.current?.focus(); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: "'Lexend',sans-serif", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}
            onMouseLeave={e => e.currentTarget.style.background = "none"}
          >
            <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: "15px", color }}>{icon}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color, margin: 0, fontFamily: "'Lexend',sans-serif" }}>{cmd}</p>
              <p style={{ fontSize: "10px", color: text3, margin: "1px 0 0", fontFamily: "'Lexend',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{desc}</p>
            </div>
          </button>
        ))}
      </div>
    );
  }, [chatInput, isDark, bdr, text3]);

  const MessagesList = useMemo(() => messages.map((msg, i) => {
    const isAI = msg.role === "ai";
    const isTemp = !!msg.temp;
    const msgColor = isAI ? (isDark ? "#f1f5f9" : "#0f172a") : "#0f172a";
    return (
      <div key={i} style={{
        background: isAI
          ? (isDark ? "rgba(15,23,42,0.75)" : "#ffffff")
          : "#00FF00",
        border: isAI
          ? `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"}`
          : "none",
        borderRadius: "16px",
        borderTopLeftRadius: isAI ? "4px" : "16px",
        borderBottomRightRadius: isAI ? "16px" : "4px",
        padding: "14px 16px",
        color: msgColor,
        lineHeight: 1.65,
        alignSelf: isAI ? "stretch" : "flex-end",
        maxWidth: isAI ? "100%" : "85%",
        animation: "msgPop 0.25s cubic-bezier(0.16,1,0.3,1) both",
        boxShadow: isAI
          ? (isDark ? "0 4px 20px rgba(0,0,0,0.25)" : "0 2px 10px rgba(0,0,0,0.04)")
          : "0 4px 16px rgba(0,255,0,0.25)",
        opacity: isTemp ? 0.6 : 1,
      }}>
        {isAI && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", paddingBottom: "6px", borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "20px", height: "20px", borderRadius: "6px", background: "rgba(0,255,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="ms" style={{ fontSize: "13px", color: "#00CC00" }}>auto_awesome</span>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a", letterSpacing: "0.02em" }}>Neural AI</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.25)", borderRadius: "9999px", color: "#00AA00" }}>GROQ</span>
            </div>
          </div>
        )}
        {!isAI && msg.command && (() => {
          const sc = SLASH_COMMANDS.find(c => c.cmd === "/" + msg.command);
          const col = sc?.color || "#00CC00";
          const ico = sc?.icon || "terminal";
          return (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", background: "rgba(0,0,0,0.18)", borderRadius: "9999px", fontSize: "10px", fontWeight: 700, color: "#0f172a", marginBottom: "5px", fontFamily: "'Lexend',sans-serif" }}>
              <span className="ms" style={{ fontSize: "11px" }}>{ico}</span>
              /{msg.command} · p.{currentPage}
            </div>
          );
        })()}
        {isAI && msg.command && (() => {
          const sc = SLASH_COMMANDS.find(c => c.cmd === "/" + msg.command);
          if (!sc) return null;
          return (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 10px", background: `${sc.color}18`, border: `1px solid ${sc.color}44`, borderRadius: "9999px", fontSize: "10px", fontWeight: 700, color: sc.color, marginBottom: "8px" }}>
              <span className="ms" style={{ fontSize: "12px" }}>{sc.icon}</span>
              {sc.cmd}
            </div>
          );
        })()}
        {isAI
          ? <MarkdownText text={msg.text} isDark={isDark} onOpenDiagram={setActiveDiagram} />
          : <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {msg.command && msg.text.startsWith("/" + msg.command) ? msg.text.slice(msg.command.length + 1).trim() : msg.text}
          </p>
        }
      </div>
    );
  }), [messages, isDark, bdr, currentPage]);

  /* ACCESS DENIED */
  if (accessDenied) return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: bg, gap: "20px", fontFamily: "'Lexend',sans-serif", padding: "20px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;700&display=swap');@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');.ms{font-family:'Material Symbols Outlined'!important;line-height:1;display:inline-block;}`}</style>
      <div style={{ width: "80px", height: "80px", borderRadius: "20px", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="ms" style={{ fontSize: "44px", color: "#ef4444" }}>lock</span>
      </div>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, color: isDark ? "#f1f5f9" : "#0f172a", margin: "0 0 8px" }}>Access Denied</h2>
        <p style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#475569", margin: 0, maxWidth: "320px" }}>{accessReason}</p>
      </div>
      <button onClick={() => router.push("/notes")} style={{ padding: "12px 24px", background: "#00FF00", color: "#0f172a", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}>
        Back to Notes
      </button>
    </div>
  );

  if (authLoading) return null;

  const isChatOpenDesktop = chatOpen && !isMobile;
  const sidebarW = chatFullscreen ? "calc(100% - 300px)" : `${sidebarWidth}px`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;}
        body{font-family:'Lexend',sans-serif;background:${bg};color:${text1};overflow:hidden;}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;line-height:1;display:inline-block;white-space:nowrap;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes shimmer{0%{background-position:-200% 0;}100%{background-position:200% 0;}}
        @keyframes msgPop{from{opacity:0;transform:translateY(8px) scale(0.97);}to{opacity:1;transform:none;}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        @keyframes sheetSlideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
        @keyframes ctxFadeIn{from{opacity:0;transform:scale(0.92) translateY(-6px);}to{opacity:1;transform:none;}}
        @keyframes fabPop{from{transform:scale(0) rotate(-30deg);}to{transform:scale(1) rotate(0deg);}}
        @keyframes overlayIn{from{opacity:0;}to{opacity:1;}}
        @keyframes popIn{from{opacity:0;transform:scale(0.9) translateY(16px);}to{opacity:1;transform:none;}}

        .viewer-root{display:flex;flex-direction:column;height:100vh;overflow:hidden;background:${bg};}
        .top-bar{height:60px;background:${panel};backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};display:flex;align-items:center;padding:0 16px;gap:12px;flex-shrink:0;z-index:30;}
        .viewer-body{flex:1;display:flex;overflow:hidden;}
        .pdf-area{flex:1;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:32px 24px 120px;background:${isDark ? "#0a1628" : "#e4eae4"};transition:flex 0.3s;}
        .pdf-area::-webkit-scrollbar{width:4px;}
        .pdf-area::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}
        .canvas-wrap{background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.18);overflow:hidden;max-width:100%;}
        canvas{display:block;max-width:100%;height:auto;}

        .ctrl-bar{position:fixed;bottom:28px;left:50%;transform:translateX(calc(-50% - 180px));background:${isDark ? "rgba(15,23,42,0.96)" : "rgba(15,23,42,0.92)"};backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:9999px;padding:10px 24px;display:flex;align-items:center;gap:20px;z-index:40;box-shadow:0 8px 32px rgba(0,0,0,0.3);transition:left 0.3s,transform 0.3s;}
        .ctrl-bar.no-sidebar{left:50%;transform:translateX(-50%);}
        .ctrl-btn{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);display:flex;align-items:center;justify-content:center;padding:4px;border-radius:8px;transition:all 0.18s;}
        .ctrl-btn:hover{color:#00FF00;background:rgba(0,255,0,0.1);}
        .ctrl-btn:disabled{opacity:0.3;cursor:not-allowed;}
        .ctrl-div{width:1px;height:20px;background:rgba(255,255,255,0.15);}

        .ai-sidebar{height:100%;background:${isDark ? "rgba(10,16,28,0.98)" : "rgba(255,255,255,0.98)"};backdrop-filter:blur(16px);border-left:1px solid ${isDark ? "rgba(255,255,255,0.08)" : bdr};display:flex;flex-direction:column;z-index:20;transition:width 0.3s cubic-bezier(0.16,1,0.3,1),min-width 0.3s cubic-bezier(0.16,1,0.3,1);}
        .ai-sidebar.closed{width:0!important;min-width:0!important;overflow:hidden;}
        .chat-scroll{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:12px;}
        .chat-scroll::-webkit-scrollbar{width:4px;}
        .chat-scroll::-webkit-scrollbar-thumb{background:${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"};border-radius:2px;}
        .quick-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:${isDark ? "rgba(255,255,255,0.04)" : "#ffffff"};border:1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"};border-radius:10px;cursor:pointer;font-size:11px;font-weight:700;color:${text2};font-family:'Lexend',sans-serif;transition:all 0.18s;text-align:left;box-shadow:${isDark ? "none" : "0 1px 3px rgba(0,0,0,0.04)"};}
        .quick-btn:hover{background:${isDark ? "rgba(255,255,255,0.08)" : "#f8fafc"};color:${text1};border-color:${isDark ? "rgba(0,255,0,0.3)" : "rgba(0,200,0,0.3)"};}
        .quick-btn.special-btn{border-color:rgba(0,200,0,0.3);color:#00AA00;background:${isDark ? "rgba(0,255,0,0.06)" : "rgba(0,200,0,0.05)"};}
        .quick-btn.special-btn:hover{background:#00FF00;color:#0f172a;border-color:#00FF00;}
        .chat-input{width:100%;background:${isDark ? "rgba(255,255,255,0.05)" : "#f8fafc"};border:1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"};border-radius:14px;padding:12px 46px 12px 14px;font-size:12.5px;font-family:'Lexend',sans-serif;color:${text1};outline:none;resize:none;min-height:48px;max-height:140px;line-height:1.5;transition:border-color 0.2s,box-shadow 0.2s;}
        .chat-input:focus{border-color:rgba(0,255,0,0.5)!important;box-shadow:0 0 0 3px rgba(0,255,0,0.12)!important;}
        .chat-input::placeholder{color:${text3};}
        .progress-track{width:100%;height:6px;background:rgba(255,255,255,0.1);border-radius:9999px;overflow:hidden;}
        .progress-fill{height:100%;background:linear-gradient(90deg,#00AA00,#00FF00,#00AA00);background-size:200% 100%;animation:shimmer 1.5s linear infinite;border-radius:9999px;transition:width 0.3s;}

        .mob-fab{display:none;position:fixed;bottom:90px;right:20px;z-index:60;width:58px;height:58px;border-radius:9999px;background:#00FF00;border:none;box-shadow:0 6px 28px rgba(0,255,0,0.5);cursor:pointer;align-items:center;justify-content:center;animation:fabPop 0.4s cubic-bezier(0.34,1.56,0.64,1) both;}
        .mob-fab:active{transform:scale(0.9);}
        .mob-sheet-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:55;backdrop-filter:blur(4px);}
        .mob-sheet{display:none;position:fixed;left:0;right:0;bottom:0;z-index:60;border-radius:24px 24px 0 0;background:${panel};box-shadow:0 -12px 60px rgba(0,0,0,0.35);flex-direction:column;overflow:hidden;}
        .mob-ctrl-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;background:${isDark ? "rgba(10,16,26,0.97)" : "rgba(255,255,255,0.97)"};backdrop-filter:blur(20px);border-top:1px solid ${bdr};padding:10px 20px 24px;align-items:center;justify-content:center;gap:16px;}
        .mob-ctrl-btn{background:none;border:none;cursor:pointer;color:${text2};display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 10px;border-radius:10px;transition:all 0.18s;-webkit-tap-highlight-color:transparent;}
        .mob-ctrl-btn:active{transform:scale(0.88);}
        .mob-ctrl-btn.highlight{background:rgba(0,255,0,0.1);}
        .mob-ctrl-btn span.ms{font-size:22px;color:${text2};}
        .mob-ctrl-btn.highlight span.ms{color:#00CC00;}
        .mob-ctrl-btn span.lbl{font-size:9px;font-weight:700;color:${text3};font-family:'Lexend',sans-serif;}

        .ctx-menu{position:fixed;z-index:9999;background:${isDark ? "rgba(12,18,30,0.98)" : "rgba(255,255,255,0.98)"};backdrop-filter:blur(20px);border:1px solid ${bdr};border-radius:16px;padding:6px;box-shadow:0 16px 56px rgba(0,0,0,0.35);min-width:230px;animation:ctxFadeIn 0.18s ease both;font-family:'Lexend',sans-serif;}
        .ctx-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;color:${text1};border:none;background:none;width:100%;text-align:left;font-family:'Lexend',sans-serif;transition:background 0.15s;}
        .ctx-item:hover{background:${isDark ? "rgba(0,255,0,0.08)" : "rgba(0,200,0,0.08)"};}
        .ctx-item.ai-item:hover{background:rgba(0,255,0,0.12);}
        .ctx-divider{height:1px;background:${bdr};margin:4px 0;}
        .ctx-section{padding:6px 12px 3px;font-size:9px;font-weight:800;color:${text3};text-transform:uppercase;letter-spacing:0.1em;}

        @media(max-width:768px){
          .ai-sidebar{display:none!important;}
          .mob-fab{display:flex!important;}
          .mob-sheet{display:flex!important;}
          .mob-sheet-overlay{display:block!important;}
          .mob-ctrl-bar{display:flex!important;}
          .ctrl-bar{display:none!important;}
          .pdf-area{padding:16px 8px 160px;}
          .top-bar{height:56px;padding:0 12px;gap:8px;}
        }
      `}</style>

      <div className="viewer-root" onContextMenu={handleContextMenu}>

        {/* ── TOP BAR ── */}
        <div className="top-bar">
          <button onClick={() => router.push("/notes")} style={{ display: "flex", alignItems: "center", gap: "4px", background: "none", border: "none", cursor: "pointer", color: text2, fontSize: "13px", fontWeight: 600, fontFamily: "'Lexend',sans-serif", flexShrink: 0 }}>
            <span className="ms" style={{ fontSize: "20px" }}>arrow_back</span>
            <span style={{ display: isMobile ? "none" : "inline" }}>Notes</span>
          </button>
          <div style={{ width: "1px", height: "24px", background: bdr, flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
            <span className="ms" style={{ fontSize: "22px", color: "#ef4444", flexShrink: 0 }}>picture_as_pdf</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "13px", fontWeight: 700, color: text1, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{moduleTitle || moduleKey || "PDF Viewer"}</p>
              <p style={{ fontSize: "10px", color: text3, margin: 0 }}>{subject} · {sem} · {branch}</p>
            </div>
          </div>
          {loadStatus === "ready" && pdfSource && !isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px", background: "rgba(0,255,0,0.08)", border: "1px solid rgba(0,255,0,0.2)", borderRadius: "9999px", flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: "14px", color: "#00AA00" }}>bolt</span>
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#00AA00" }}>
                {warmStatus.active
                  ? `${pdfSource === "local" ? "Local" : pdfSource === "redis" ? "Redis" : pdfSource === "firebase" ? "Firebase" : "Mixed"} · warming`
                  : `${pdfSource === "local" ? "Local" : pdfSource === "redis" ? "Redis" : pdfSource === "firebase" ? "Firebase" : "Mixed"} · ready`}
              </span>
            </div>
          )}
          {loadStatus === "ready" && !isMobile && (
            <button title="Download PDF" onClick={async () => {
              const buf = await downloadPdf();
              if (!buf) return;
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
              a.download = fileName || `${moduleKey}.pdf`; a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 3000);
            }} style={{ width: "36px", height: "36px", borderRadius: "10px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)", border: `1px solid ${bdr}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: "20px", color: text2 }}>download</span>
            </button>
          )}
          {!isMobile && (
            <button onClick={() => setChatOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: chatOpen ? "#00FF00" : "none", border: `1px solid ${chatOpen ? "#00FF00" : bdr}`, borderRadius: "10px", cursor: "pointer", fontSize: "12px", fontWeight: 700, color: chatOpen ? "#0f172a" : text2, fontFamily: "'Lexend',sans-serif", transition: "all 0.2s", flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: "18px" }}>psychology</span>
              {chatOpen ? "Hide Neural" : "Neural AI"}
            </button>
          )}
          <AvatarEl size={36} />
        </div>

        {/* ── BODY ── */}
        <div className="viewer-body">

          {/* PDF Area */}
          <div
            className="pdf-area"
            ref={containerRef}
            onPointerDown={onPdfAreaPointerDown}
            onPointerMove={onPdfAreaPointerMove}
            onPointerUp={onPdfAreaPointerUp}
          >
            {loadStatus === "loading" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "20px", minHeight: "60vh", animation: "fadeUp 0.3s ease both" }}>
                <div style={{ width: "72px", height: "72px", borderRadius: "18px", background: "rgba(0,255,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: "32px", height: "32px", border: "3px solid rgba(0,255,0,0.2)", borderTopColor: "#00FF00", borderRadius: "9999px", animation: "spin 0.8s linear infinite" }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: "14px", fontWeight: 700, color: text1, margin: "0 0 6px" }}>{loadMsg}</p>
                  <div style={{ width: "280px" }}>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${loadPct}%` }} /></div>
                    <p style={{ fontSize: "11px", color: "#00AA00", fontWeight: 700, marginTop: "8px" }}>{loadPct}%</p>
                  </div>
                </div>
              </div>
            )}
            {loadStatus === "error" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "16px", minHeight: "60vh" }}>
                <div style={{ width: "72px", height: "72px", borderRadius: "18px", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="ms" style={{ fontSize: "36px", color: "#ef4444" }}>error</span>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: "15px", fontWeight: 700, color: text1, margin: "0 0 6px" }}>Failed to load PDF</p>
                  <p style={{ fontSize: "12px", color: text3, margin: 0 }}>{loadMsg}</p>
                </div>
                <button onClick={() => router.push("/notes")} style={{ padding: "10px 20px", background: "#00FF00", color: "#0f172a", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "13px", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}>Back to Notes</button>
              </div>
            )}
            {loadStatus === "ready" && (
              <div
                className="canvas-wrap"
                style={{
                  position: "relative",
                  opacity: rendering ? 0.7 : 1,
                  transition: "opacity 0.2s",
                  cursor: annotTool === "view" ? "grab" : annotTool === "eraser" ? "cell" : "crosshair",
                  userSelect: "none",
                }}
              >
                <canvas ref={canvasRef} />
                <canvas
                  ref={annotCanvasRef}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: annotTool === "view" ? "none" : "auto",
                    touchAction: annotTool === "view" ? "auto" : "none",
                  }}
                  onPointerDown={handleAnnotPointerDown}
                  onPointerMove={handleAnnotPointerMove}
                  onPointerUp={handleAnnotPointerUp}
                  onPointerLeave={() => {
                    handleAnnotPointerUp();
                    setCursorPos(null);
                  }}
                />

                {/* Floating Pen / Highlighter visual preview cursor */}
                {cursorPos && annotTool !== "view" && (
                  <div
                    style={{
                      position: "absolute",
                      left: cursorPos.x,
                      top: cursorPos.y,
                      pointerEvents: "none",
                      transform: "translate(-2px, -24px)",
                      zIndex: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))",
                    }}
                  >
                    <span
                      className="ms"
                      style={{
                        fontSize: "22px",
                        color: annotTool === "eraser" ? "#ffffff" : (annotColor || "#ef4444"),
                        transform: "rotate(-45deg)",
                      }}
                    >
                      {annotTool === "highlight" ? "ink_highlighter" : annotTool === "eraser" ? "ink_eraser" : "edit"}
                    </span>
                    <div
                      style={{
                        width: annotTool === "highlight" ? "12px" : "6px",
                        height: annotTool === "highlight" ? "12px" : "6px",
                        borderRadius: annotTool === "highlight" ? "2px" : "50%",
                        background: annotTool === "eraser" ? "#ef4444" : annotColor,
                        border: "1px solid #ffffff",
                        opacity: annotTool === "highlight" ? 0.6 : 0.9,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {loadStatus === "ready" && warmStatus.active && (
              <div style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "12px", background: isDark ? "rgba(0,255,0,0.06)" : "rgba(0,200,0,0.06)", border: `1px solid ${bdr}`, display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "9999px", background: "#00FF00", boxShadow: "0 0 12px rgba(0,255,0,0.55)" }} />
                <p style={{ fontSize: "11px", color: text2, margin: 0 }}>
                  Page {currentPage} is ready. Preloading nearby pages in background… {warmStatus.done}/{warmStatus.total}
                </p>
              </div>
            )}
          </div>

          {/* ── DESKTOP AI SIDEBAR ── */}
          <aside
            className={`ai-sidebar${isChatOpenDesktop ? "" : " closed"}`}
            style={{
              width: isChatOpenDesktop ? sidebarW : "0",
              minWidth: isChatOpenDesktop ? sidebarW : "0",
              position: "relative",
              userSelect: isResizingSidebar ? "none" : "auto",
            }}
          >
            {/* Drag Handle to Resize Sidebar */}
            {isChatOpenDesktop && !chatFullscreen && (
              <div
                title="Drag to resize AI sidebar · Double click to reset"
                onPointerDown={onSidebarResizeStart}
                onDoubleClick={() => {
                  setSidebarWidth(380);
                  try { localStorage.setItem("studybuddy_sidebar_w", "380"); } catch { }
                }}
                style={{
                  position: "absolute",
                  left: -4,
                  top: 0,
                  bottom: 0,
                  width: "8px",
                  cursor: "col-resize",
                  zIndex: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  touchAction: "none",
                }}
              >
                <div
                  style={{
                    width: "2px",
                    height: "36px",
                    borderRadius: "9999px",
                    background: isResizingSidebar ? "#00FF00" : (isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)"),
                    transition: "background 0.2s",
                  }}
                />
              </div>
            )}
            {/* Sidebar header */}
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${bdr}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "rgba(0,255,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="ms" style={{ fontSize: "20px", color: "#00CC00" }}>psychology</span>
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <p style={{ fontSize: "13px", fontWeight: 700, color: text1, margin: 0 }}>Neural AI</p>
                    <span style={{ fontSize: "9px", fontWeight: 700, padding: "1px 6px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.2)", borderRadius: "9999px", color: "#00AA00" }}>GROQ</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "9999px", background: "#00FF00", animation: "pulse 2s ease-in-out infinite" }} />
                    <p style={{ fontSize: "10px", color: "#00AA00", fontWeight: 700, margin: 0 }}>Sees current page</p>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, color: text3, background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", padding: "3px 8px", borderRadius: "9999px" }}>p.{currentPage}/{totalPages}</span>
                <button title={chatFullscreen ? "Restore size" : "Expand chat"} onClick={() => setChatFullscreen(f => !f)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: text3, width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "8px", transition: "color 0.18s" }}
                  onMouseEnter={e => e.currentTarget.style.color = text1} onMouseLeave={e => e.currentTarget.style.color = text3}>
                  <span className="ms" style={{ fontSize: "18px" }}>{chatFullscreen ? "close_fullscreen" : "open_in_full"}</span>
                </button>
                <button onClick={() => { setChatOpen(false); setChatFullscreen(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: text3, width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="ms" style={{ fontSize: "20px" }}>close</span>
                </button>
              </div>
            </div>

            {/* Quick actions */}
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${bdr}`, display: "grid", gridTemplateColumns: chatFullscreen ? "repeat(3,1fr)" : "1fr 1fr", gap: "8px", flexShrink: 0 }}>
              {quickActions.map(({ icon, label, prompt, isQuiz, isAnalyze }) => (
                <button key={label}
                  className={`quick-btn${(isQuiz || isAnalyze) ? " special-btn" : ""}`}
                  onClick={() => isQuiz ? setQuizOpen(true) : isAnalyze ? setAnalyzeOpen(true) : sendMessage(prompt)}>
                  <span className="ms" style={{ fontSize: "16px", color: (isQuiz || isAnalyze) ? "#00AA00" : "#00CC00" }}>{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {/* slash commands hint */}
            <div style={{ padding: "7px 14px", borderBottom: `1px solid ${bdr}`, display: "flex", alignItems: "center", gap: "7px", flexShrink: 0, background: isDark ? "rgba(0,200,0,0.025)" : "rgba(0,200,0,0.02)" }}>
              <span className="ms" style={{ fontSize: "13px", color: "#00AA00", flexShrink: 0 }}>terminal</span>
              <p style={{ fontSize: "10px", color: text3, margin: 0 }}>
                Type <span style={{ fontWeight: 700, color: "#00CC00", fontFamily: "monospace" }}>/</span> for commands:&nbsp;
                {["/draw", "current", "explain", "diagram"].map(c => (
                  <span key={c} style={{ fontWeight: 700, color: "#00BB00", fontFamily: "monospace", marginRight: "4px" }}>/{c}</span>
                ))}
              </p>
            </div>

            {/* Messages */}
            <div className="chat-scroll">
              {MessagesList}
              {aiLoading && (
                <div style={{ background: isDark ? "rgba(0,255,0,0.07)" : "rgba(0,200,0,0.06)", border: `1px solid ${bdr}`, borderRadius: "16px", borderTopLeftRadius: "4px", padding: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: "8px", height: "8px", borderRadius: "9999px", background: "#00CC00", animation: `pulse 1s ease-in-out ${i * 0.2}s infinite` }} />)}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: "12px", borderTop: `1px solid ${bdr}`, flexShrink: 0 }}>
              <div style={{ position: "relative" }}>
                <SlashHint />
                <textarea
                  ref={chatInputRef}
                  className="chat-input"
                  placeholder="Ask anything… or type / for commands"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput); } }}
                  rows={2}
                />
                <button onClick={() => sendMessage(chatInput)} disabled={!chatInput.trim() || aiLoading}
                  style={{ position: "absolute", right: "10px", bottom: "10px", width: "32px", height: "32px", background: "#00FF00", border: "none", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: (!chatInput.trim() || aiLoading) ? 0.4 : 1, transition: "opacity 0.2s" }}>
                  <span className="ms" style={{ fontSize: "18px", color: "#0f172a" }}>send</span>
                </button>
              </div>
              <p style={{ fontSize: "9px", color: text3, textAlign: "center", marginTop: "6px" }}>Enter to send · Shift+Enter new line · type / for commands</p>
            </div>
          </aside>
        </div>

        {/* ── DESKTOP CONTROLS ── */}
        {loadStatus === "ready" && (
          <div className={`ctrl-bar${isChatOpenDesktop ? "" : " no-sidebar"}`}>
            {/* Page navigation */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button className="ctrl-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)} title="Previous Page">
                <span className="ms" style={{ fontSize: "20px" }}>chevron_left</span>
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="number"
                  min={1}
                  max={totalPages || 1}
                  value={currentPage}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val >= 1 && val <= totalPages) setCurrentPage(val);
                  }}
                  style={{
                    width: "38px",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "6px",
                    color: "#ffffff",
                    textAlign: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    padding: "3px 0",
                    outline: "none",
                  }}
                />
                <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>/ {totalPages}</span>
              </div>
              <button className="ctrl-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} title="Next Page">
                <span className="ms" style={{ fontSize: "20px" }}>chevron_right</span>
              </button>
              <button className="ctrl-btn" onClick={goToRandomPage} title="Random Page Jump">
                <span className="ms" style={{ fontSize: "18px" }}>shuffle</span>
              </button>
            </div>

            <div className="ctrl-div" />

            {/* Zoom Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button className="ctrl-btn" onClick={() => { setAutoFitWidth(false); setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1))); }} title="Zoom Out">
                <span className="ms" style={{ fontSize: "20px" }}>remove</span>
              </button>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.9)", minWidth: "40px", textAlign: "center" }}>
                {Math.round(scale * 100)}%
              </span>
              <button className="ctrl-btn" onClick={() => { setAutoFitWidth(false); setScale(s => Math.min(3, +(s + 0.2).toFixed(1))); }} title="Zoom In">
                <span className="ms" style={{ fontSize: "20px" }}>add</span>
              </button>
              <button
                className="ctrl-btn"
                title={autoFitWidth ? "Auto-Fit Width is Active (click to recalculate)" : "Fit to Container Width"}
                onClick={() => {
                  setAutoFitWidth(true);
                  fitWidth();
                }}
                style={{
                  color: autoFitWidth ? "#00FF00" : "rgba(255,255,255,0.7)",
                  background: autoFitWidth ? "rgba(0,255,0,0.15)" : "transparent",
                }}
              >
                <span className="ms" style={{ fontSize: "19px" }}>fit_width</span>
              </button>
            </div>

            <div className="ctrl-div" />

            {/* Annotation Tools */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                className="ctrl-btn"
                title="View / Scroll Mode"
                onClick={() => setAnnotTool("view")}
                style={{
                  color: annotTool === "view" ? "#00FF00" : "rgba(255,255,255,0.7)",
                  background: annotTool === "view" ? "rgba(0,255,0,0.18)" : "transparent",
                }}
              >
                <span className="ms" style={{ fontSize: "19px" }}>pan_tool</span>
              </button>
              <button
                className="ctrl-btn"
                title="Pen Note (Draw / Write)"
                onClick={() => {
                  setAnnotTool("pen");
                  if (annotColor === "#fef08a") setAnnotColor("#ef4444");
                }}
                style={{
                  color: annotTool === "pen" ? "#00FF00" : "rgba(255,255,255,0.7)",
                  background: annotTool === "pen" ? "rgba(0,255,0,0.18)" : "transparent",
                }}
              >
                <span className="ms" style={{ fontSize: "19px" }}>edit</span>
              </button>
              <button
                className="ctrl-btn"
                title="Highlighter"
                onClick={() => {
                  setAnnotTool("highlight");
                  setAnnotColor("#fef08a");
                }}
                style={{
                  color: annotTool === "highlight" ? "#00FF00" : "rgba(255,255,255,0.7)",
                  background: annotTool === "highlight" ? "rgba(0,255,0,0.18)" : "transparent",
                }}
              >
                <span className="ms" style={{ fontSize: "19px" }}>ink_highlighter</span>
              </button>
              <button
                className="ctrl-btn"
                title="Eraser"
                onClick={() => setAnnotTool("eraser")}
                style={{
                  color: annotTool === "eraser" ? "#00FF00" : "rgba(255,255,255,0.7)",
                  background: annotTool === "eraser" ? "rgba(0,255,0,0.18)" : "transparent",
                }}
              >
                <span className="ms" style={{ fontSize: "19px" }}>ink_eraser</span>
              </button>

              {/* Color picker for pen */}
              {annotTool !== "view" && annotTool !== "eraser" && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "4px" }}>
                  {["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#fef08a"].map((c) => (
                    <div
                      key={c}
                      onClick={() => setAnnotColor(c)}
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        background: c,
                        cursor: "pointer",
                        border: annotColor === c ? "2px solid #ffffff" : "1px solid rgba(255,255,255,0.3)",
                        boxShadow: annotColor === c ? "0 0 8px rgba(255,255,255,0.5)" : "none",
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Clear button if page has annotations */}
              {annotLines.length > 0 && (
                <button
                  className="ctrl-btn"
                  onClick={clearCurrentPageAnnotations}
                  title="Clear Page Annotations"
                  style={{ color: "#f87171" }}
                >
                  <span className="ms" style={{ fontSize: "19px" }}>delete_sweep</span>
                </button>
              )}

              {/* Save status badge */}
              {annotSaveStatus !== "idle" && (
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: "9999px",
                    background: annotSaveStatus === "saving" ? "rgba(234,179,8,0.2)" : "rgba(0,255,0,0.2)",
                    color: annotSaveStatus === "saving" ? "#facc15" : "#4ade80",
                    marginLeft: "2px",
                  }}
                >
                  {annotSaveStatus === "saving" ? "Saving…" : "Saved"}
                </span>
              )}
            </div>

            {rendering && (
              <div
                style={{
                  width: "16px",
                  height: "16px",
                  border: "2px solid rgba(0,255,0,0.3)",
                  borderTopColor: "#00FF00",
                  borderRadius: "9999px",
                  animation: "spin 0.7s linear infinite",
                }}
              />
            )}
          </div>
        )}

        {/* ── MOBILE CONTROLS ── */}
        {loadStatus === "ready" && (
          <div className="mob-ctrl-bar">
            <button className="mob-ctrl-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)} style={{ opacity: currentPage <= 1 ? 0.3 : 1 }}><span className="ms">chevron_left</span><span className="lbl">Prev</span></button>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: text1 }}>{currentPage} / {totalPages}</span>
              <span style={{ fontSize: "9px", color: text3 }}>{Math.round(scale * 100)}%</span>
            </div>
            <button className="mob-ctrl-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} style={{ opacity: currentPage >= totalPages ? 0.3 : 1 }}><span className="ms">chevron_right</span><span className="lbl">Next</span></button>
            <div style={{ width: "1px", height: "36px", background: bdr, flexShrink: 0 }} />
            <button className="mob-ctrl-btn" onClick={() => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))}><span className="ms">zoom_out</span><span className="lbl">Out</span></button>
            <button className="mob-ctrl-btn" onClick={() => setScale(s => Math.min(3, +(s + 0.2).toFixed(1)))}><span className="ms">zoom_in</span><span className="lbl">In</span></button>
            <div style={{ width: "1px", height: "36px", background: bdr, flexShrink: 0 }} />
            <button className="mob-ctrl-btn highlight" onClick={() => { setChatOpen(true); setSheetHeight(55); }}><span className="ms">psychology</span><span className="lbl" style={{ color: "#00AA00" }}>AI</span></button>
          </div>
        )}

        {loadStatus !== "ready" && (
          <button className="mob-fab" onClick={() => { setChatOpen(true); setSheetHeight(55); }}>
            <span className="ms" style={{ fontSize: "28px", color: "#0f172a" }}>psychology</span>
          </button>
        )}

        {/* Mobile overlay */}
        {isMobile && chatOpen && (
          <div className="mob-sheet-overlay" style={{ opacity: chatOpen ? 1 : 0, transition: "opacity 0.3s" }} onClick={() => setChatOpen(false)} />
        )}

        {/* Mobile sheet */}
        {isMobile && (
          <div className="mob-sheet" style={{ height: chatOpen ? `${sheetHeight}vh` : "0", transition: isDraggingSheet ? "none" : "height 0.35s cubic-bezier(0.32,0.72,0,1)", display: "flex" }}>
            <div style={{ flexShrink: 0, paddingBottom: "8px", cursor: "ns-resize", touchAction: "none" }}
              onPointerDown={onSheetPointerDown} onPointerMove={onSheetPointerMove} onPointerUp={onSheetPointerUp}>
              <div style={{ width: "40px", height: "4px", borderRadius: "9999px", background: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)", margin: "12px auto 0" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "9px", background: "rgba(0,255,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="ms" style={{ fontSize: "18px", color: "#00CC00" }}>psychology</span>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <p style={{ fontSize: "13px", fontWeight: 700, color: text1, margin: 0 }}>Neural AI</p>
                      <span style={{ fontSize: "9px", fontWeight: 700, padding: "1px 5px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.2)", borderRadius: "9999px", color: "#00AA00" }}>GROQ</span>
                    </div>
                    <p style={{ fontSize: "9px", color: "#00AA00", fontWeight: 700, margin: 0 }}>p.{currentPage}/{totalPages} · sees page</p>
                  </div>
                </div>
                <button onClick={() => setChatOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: text3, width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="ms" style={{ fontSize: "20px" }}>keyboard_arrow_down</span>
                </button>
              </div>
            </div>

            {/* Quick actions mobile */}
            <div style={{ flexShrink: 0, padding: "8px 16px 0", borderBottom: `1px solid ${bdr}` }}>
              <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "12px" }}>
                {quickActions.map(({ icon, label, prompt, isQuiz, isAnalyze }) => (
                  <button key={label}
                    onClick={() => isQuiz ? setQuizOpen(true) : isAnalyze ? setAnalyzeOpen(true) : sendMessage(prompt)}
                    style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", background: (isQuiz || isAnalyze) ? "rgba(0,200,0,0.1)" : (isDark ? "rgba(0,255,0,0.07)" : "rgba(0,200,0,0.07)"), border: `1px solid ${(isQuiz || isAnalyze) ? "rgba(0,200,0,0.3)" : bdr}`, borderRadius: "9999px", cursor: "pointer", fontSize: "11px", fontWeight: 700, color: (isQuiz || isAnalyze) ? "#00AA00" : text2, fontFamily: "'Lexend',sans-serif", whiteSpace: "nowrap", flexShrink: 0 }}>
                    <span className="ms" style={{ fontSize: "15px", color: "#00CC00" }}>{icon}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="chat-scroll" style={{ flex: 1 }}>
              {MessagesList}
              {aiLoading && (
                <div style={{ background: isDark ? "rgba(0,255,0,0.07)" : "rgba(0,200,0,0.06)", border: `1px solid ${bdr}`, borderRadius: "16px", borderTopLeftRadius: "4px", padding: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: "8px", height: "8px", borderRadius: "9999px", background: "#00CC00", animation: `pulse 1s ease-in-out ${i * 0.2}s infinite` }} />)}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Mobile input */}
            <div style={{ padding: "12px", borderTop: `1px solid ${bdr}`, flexShrink: 0, paddingBottom: `calc(12px + env(safe-area-inset-bottom,0px))` }}>
              <div style={{ position: "relative" }}>
                <SlashHint />
                <textarea
                  ref={chatInputRef}
                  className="chat-input"
                  placeholder="Ask anything… or type / for commands"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput); } }}
                  rows={2}
                />
                <button onClick={() => sendMessage(chatInput)} disabled={!chatInput.trim() || aiLoading}
                  style={{ position: "absolute", right: "10px", bottom: "10px", width: "32px", height: "32px", background: "#00FF00", border: "none", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: (!chatInput.trim() || aiLoading) ? 0.4 : 1 }}>
                  <span className="ms" style={{ fontSize: "18px", color: "#0f172a" }}>send</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONTEXT MENU ── */}
        {ctxMenu && loadStatus === "ready" && (
          <div className="ctx-menu"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 250), top: Math.min(ctxMenu.y, window.innerHeight - 420) }}
            onClick={e => e.stopPropagation()}>
            <div className="ctx-section">✦ AI Actions · page {currentPage}</div>
            {ctxAiActions.map(({ icon, label, prompt, isQuiz, isAnalyze }) => (
              <button key={label} className="ctx-item ai-item"
                onClick={() => {
                  if (isQuiz) setQuizOpen(true);
                  else if (isAnalyze) setAnalyzeOpen(true);
                  else { sendMessage(prompt); if (!chatOpen) { setChatOpen(true); if (isMobile) setSheetHeight(55); } }
                  setCtxMenu(null);
                }}>
                <span className="ms" style={{ fontSize: "17px", color: "#00CC00" }}>{icon}</span>
                {label}
                {!isQuiz && !isAnalyze && <span style={{ marginLeft: "auto", fontSize: "9px", color: "#00AA00", fontWeight: 700, padding: "1px 5px", background: "rgba(0,200,0,0.1)", borderRadius: "9999px" }}>/current</span>}
              </button>
            ))}
            <div className="ctx-divider" />
            <div className="ctx-section">Navigation</div>
            {[
              { icon: "arrow_back", label: "Previous page", action: () => setCurrentPage(p => Math.max(1, p - 1)), hint: `p.${Math.max(1, currentPage - 1)}` },
              { icon: "arrow_forward", label: "Next page", action: () => setCurrentPage(p => Math.min(totalPages, p + 1)), hint: `p.${Math.min(totalPages, currentPage + 1)}` },
              { icon: "zoom_in", label: "Zoom in", action: () => setScale(s => Math.min(3, +(s + 0.2).toFixed(1))), hint: `${Math.round(Math.min(300, (scale + 0.2) * 100))}%` },
              { icon: "zoom_out", label: "Zoom out", action: () => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1))), hint: `${Math.round(Math.max(50, (scale - 0.2) * 100))}%` },
              { icon: "download", label: "Download PDF", action: async () => { const buf = await downloadPdf(); if (!buf) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf], { type: "application/pdf" })); a.download = fileName || `${moduleKey}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); } },
            ].map(({ icon, label, action, hint }) => (
              <button key={label} className="ctx-item" onClick={() => { action(); setCtxMenu(null); }}>
                <span className="ms" style={{ fontSize: "17px", color: text2 }}>{icon}</span>
                {label}
                {hint && <span style={{ marginLeft: "auto", fontSize: "9px", color: text3, fontWeight: 700 }}>{hint}</span>}
              </button>
            ))}
            <div className="ctx-divider" />
            <div style={{ padding: "6px 12px", fontSize: "10px", color: text3, display: "flex", justifyContent: "space-between" }}>
              <span>Page {currentPage} of {totalPages}</span>
              <span>{Math.round(scale * 100)}% zoom</span>
            </div>
          </div>
        )}

        {/* ── QUIZ MODAL ── */}
        {quizOpen && (
          <QuizModal
            isDark={isDark}
            onClose={() => setQuizOpen(false)}
            onComplete={({ solvedProblems = 0, weakByLevelIncrement = {}, askedByLevelIncrement = {} }) => {
              solvedProblemsRef.current += Math.max(0, Number(solvedProblems) || 0);
              weakByLevelRef.current.Remember += Math.max(0, Number(weakByLevelIncrement.Remember) || 0);
              weakByLevelRef.current.Understand += Math.max(0, Number(weakByLevelIncrement.Understand) || 0);
              weakByLevelRef.current.Analyze += Math.max(0, Number(weakByLevelIncrement.Analyze) || 0);
              askedByLevelRef.current.Remember += Math.max(0, Number(askedByLevelIncrement.Remember) || 0);
              askedByLevelRef.current.Understand += Math.max(0, Number(askedByLevelIncrement.Understand) || 0);
              askedByLevelRef.current.Analyze += Math.max(0, Number(askedByLevelIncrement.Analyze) || 0);
            }}
            weakByLevel={userData?.stats?.weakByLevel}
            askedByLevel={userData?.stats?.askedByLevel}
            pdfDoc={pdfDoc}
            currentPage={currentPage}
            totalPages={totalPages}
            moduleTitle={moduleTitle}
            moduleKey={moduleKey}
            subject={subject}
            sem={sem}
            text1={text1} text2={text2} text3={text3} bdr={bdr} panel={panel}
          />
        )}

        {/* ── ANALYZE PDF MODAL ── */}
        {analyzeOpen && (
          <AnalyzePDFModal
            isDark={isDark}
            onClose={() => setAnalyzeOpen(false)}
            pdfDoc={pdfDoc}
            totalPages={totalPages}
            moduleTitle={moduleTitle}
            moduleKey={moduleKey}
            subject={subject}
            sem={sem}
            text1={text1} text2={text2} text3={text3} bdr={bdr} panel={panel}
          />
        )}

        {/* ── DIAGRAM VIEWER MODAL ── */}
        {activeDiagram && (
          <DiagramViewerModal
            diagramText={activeDiagram.text}
            title={activeDiagram.title || "Diagram Viewer"}
            isDark={isDark}
            onClose={() => setActiveDiagram(null)}
          />
        )}
      </div>
    </>
  );
}

export default function PDFViewerPage() {
  return (
    <Suspense fallback={
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#080f1a", fontFamily: "'Lexend',sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "36px", height: "36px", border: "3px solid rgba(0,255,0,0.2)", borderTopColor: "#00FF00", borderRadius: "9999px", animation: "spin 0.8s linear infinite" }} />
          <p style={{ color: "#94a3b8", fontSize: "13px", fontWeight: 500 }}>Loading PDF Viewer…</p>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
      </div>
    }>
      <PDFViewerInner />
    </Suspense>
  );
}