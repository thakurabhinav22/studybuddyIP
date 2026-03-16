import { ref as dbRef, runTransaction } from "firebase/database";

const PENDING_KEY = "studybuddy_pending_stats_v1";

function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isPreviousDay(prevKey, currentKey) {
  if (!prevKey || !currentKey) return false;
  const [py, pm, pd] = prevKey.split("-").map(Number);
  const [cy, cm, cd] = currentKey.split("-").map(Number);
  if (!py || !pm || !pd || !cy || !cm || !cd) return false;
  const prev = new Date(py, pm - 1, pd);
  const curr = new Date(cy, cm - 1, cd);
  const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
  return diff === 1;
}

function roundHours(ms = 0) {
  const hours = Number(ms) / 3600000;
  return Math.max(0, Math.round(hours * 100) / 100);
}

function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePending(data) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(data));
  } catch {}
}

function enqueuePending(uid, payload) {
  if (!uid) return;
  const all = readPending();
  const prev = all[uid] || {
    studyMs: 0,
    aiQuestions: 0,
    solvedProblems: 0,
    weakByLevelIncrement: { Remember: 0, Understand: 0, Analyze: 0 },
    askedByLevelIncrement: { Remember: 0, Understand: 0, Analyze: 0 },
  };
  const weakInc = payload.weakByLevelIncrement || {};
  const askedInc = payload.askedByLevelIncrement || {};
  all[uid] = {
    studyMs: (prev.studyMs || 0) + (payload.studyMs || 0),
    aiQuestions: (prev.aiQuestions || 0) + (payload.aiQuestions || 0),
    solvedProblems: (prev.solvedProblems || 0) + (payload.solvedProblems || 0),
    weakByLevelIncrement: {
      Remember: (prev.weakByLevelIncrement?.Remember || 0) + (weakInc.Remember || 0),
      Understand: (prev.weakByLevelIncrement?.Understand || 0) + (weakInc.Understand || 0),
      Analyze: (prev.weakByLevelIncrement?.Analyze || 0) + (weakInc.Analyze || 0),
    },
    askedByLevelIncrement: {
      Remember: (prev.askedByLevelIncrement?.Remember || 0) + (askedInc.Remember || 0),
      Understand: (prev.askedByLevelIncrement?.Understand || 0) + (askedInc.Understand || 0),
      Analyze: (prev.askedByLevelIncrement?.Analyze || 0) + (askedInc.Analyze || 0),
    },
  };
  writePending(all);
}

export async function flushUsageStats(db, uid, payload = {}) {
  if (!db || !uid) return;
  const studyMs = Math.max(0, Number(payload.studyMs) || 0);
  const aiQuestions = Math.max(0, Number(payload.aiQuestions) || 0);
  const solvedProblems = Math.max(0, Number(payload.solvedProblems) || 0);
  const weakByLevelIncrement = payload.weakByLevelIncrement || {};
  const askedByLevelIncrement = payload.askedByLevelIncrement || {};
  const weakRemember = Math.max(0, Number(weakByLevelIncrement.Remember) || 0);
  const weakUnderstand = Math.max(0, Number(weakByLevelIncrement.Understand) || 0);
  const weakAnalyze = Math.max(0, Number(weakByLevelIncrement.Analyze) || 0);
  const askedRemember = Math.max(0, Number(askedByLevelIncrement.Remember) || 0);
  const askedUnderstand = Math.max(0, Number(askedByLevelIncrement.Understand) || 0);
  const askedAnalyze = Math.max(0, Number(askedByLevelIncrement.Analyze) || 0);

  if (
    studyMs <= 0 &&
    aiQuestions <= 0 &&
    solvedProblems <= 0 &&
    weakRemember <= 0 &&
    weakUnderstand <= 0 &&
    weakAnalyze <= 0 &&
    askedRemember <= 0 &&
    askedUnderstand <= 0 &&
    askedAnalyze <= 0
  ) return;

  const hoursDelta = roundHours(studyMs);
  const statsRef = dbRef(db, `users/${uid}/stats`);

  try {
    await runTransaction(statsRef, (current) => {
      const prev = current || {};
      const prevHours = Number(prev.studyHours) || 0;
      const prevAi = Number(prev.aiQuestions) || 0;
      const prevSolved = Number(prev.solvedProblems) || 0;
      const todayKey = localDateKey();
      const prevActive = prev.lastActiveDateKey || "";
      const prevStreak = Math.max(0, Number(prev.streak) || 0);

      let nextStreak = prevStreak;
      if (!prevActive) nextStreak = Math.max(1, prevStreak || 1);
      else if (prevActive === todayKey) nextStreak = prevStreak || 1;
      else if (isPreviousDay(prevActive, todayKey)) nextStreak = Math.max(1, prevStreak) + 1;
      else nextStreak = 1;

      const weakByLevel = {
        Remember: (Number(prev.weakByLevel?.Remember) || 0) + weakRemember,
        Understand: (Number(prev.weakByLevel?.Understand) || 0) + weakUnderstand,
        Analyze: (Number(prev.weakByLevel?.Analyze) || 0) + weakAnalyze,
      };

      const askedByLevel = {
        Remember: (Number(prev.askedByLevel?.Remember) || 0) + askedRemember,
        Understand: (Number(prev.askedByLevel?.Understand) || 0) + askedUnderstand,
        Analyze: (Number(prev.askedByLevel?.Analyze) || 0) + askedAnalyze,
      };

      return {
        ...prev,
        studyHours: Math.round((prevHours + hoursDelta) * 100) / 100,
        aiQuestions: prevAi + aiQuestions,
        solvedProblems: prevSolved + solvedProblems,
        streak: nextStreak,
        lastActiveDateKey: todayKey,
        weakByLevel,
        askedByLevel,
        lastUpdatedAt: Date.now(),
      };
    });
  } catch {
    enqueuePending(uid, {
      studyMs,
      aiQuestions,
      solvedProblems,
      weakByLevelIncrement: { Remember: weakRemember, Understand: weakUnderstand, Analyze: weakAnalyze },
      askedByLevelIncrement: { Remember: askedRemember, Understand: askedUnderstand, Analyze: askedAnalyze },
    });
  }
}

export async function flushPendingUsageStats(db, uid) {
  if (!db || !uid || typeof window === "undefined") return;

  const all = readPending();
  const pending = all[uid];
  if (!pending) return;

  try {
    await flushUsageStats(db, uid, pending);
    delete all[uid];
    writePending(all);
  } catch {}
}
