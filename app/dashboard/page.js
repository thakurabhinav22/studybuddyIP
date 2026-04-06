"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref, get, set } from "firebase/database";
import { logoutAndClearCache } from "@/lib/logout";

const DASH_CACHE_VERSION = 1;
const DASH_CACHE_TTL_MS = 3 * 60 * 1000;
const DASH_MIN_FETCH_GAP_MS = 20 * 1000;

function getDashCacheKey(uid) {
  return `studybuddy:dashboard-cache:v${DASH_CACHE_VERSION}:${uid}`;
}

function readDashCache(uid) {
  if (!uid || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getDashCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    return { ...parsed, updatedAt: parsed.updatedAt || Date.now() };
  } catch {
    return null;
  }
}

function normalizeSem(raw) {
  if (!raw) return "";
  const str = raw.toString().trim();
  if (/^Sem:\d+$/.test(str)) return str;
  const num = str.replace(/[^0-9]/g, "");
  return num ? `Sem:${num}` : str;
}

function writeDashCache(uid, data) {
  if (!uid || typeof window === "undefined") return;
  try {
    localStorage.setItem(getDashCacheKey(uid), JSON.stringify({ data, updatedAt: Date.now() }));
  } catch {}
}

/* ── Time-based greeting messages ── */
const TIME_GREETINGS = {
  dawn: { icon: "🌅", title: "The world wakes up with you.", sub: "Early birds catch more than worms — they catch clarity.", color: "#00FF00" },
  morning: { icon: "☀️", title: "Morning light, sharp mind.", sub: "A fresh day to learn something extraordinary.", color: "#00FF00" },
  afternoon: { icon: "🌤️", title: "Keep the momentum going.", sub: "Afternoon energy is a gift — don't let it drift away.", color: "#00FF00" },
  evening: { icon: "🌇", title: "The golden hour is yours.", sub: "Wind down, reflect, and let knowledge settle in.", color: "#00FF00" },
  night: { icon: "🌙", title: "Night has a quiet magic.", sub: "The stars are out. Your focus is unmatched right now.", color: "#00FF00" },
  midnight: { icon: "✨", title: "The world sleeps. You glow.", sub: "Midnight scholars write their own history. Stay the course.", color: "#00FF00" },
};

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 4 && h < 6) return "dawn";
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 20) return "evening";
  if (h >= 20 && h < 24) return "night";
  return "midnight";
}

/* ── Greeting Popup ── */
function GreetingPopup({ isDark, firstName, onClose }) {
  const tod = getTimeOfDay();
  const msg = TIME_GREETINGS[tod];
  const [visible, setVisible] = useState(false);
  const [prog, setProg] = useState(100);
  const DURATION = 5000;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const start = Date.now();
    const tick = setInterval(() => setProg(Math.max(0, 100 - ((Date.now() - start) / DURATION) * 100)), 50);
    const t = setTimeout(() => { setVisible(false); setTimeout(onClose, 380); }, DURATION);
    return () => { clearInterval(tick); clearTimeout(t); };
  }, [onClose]);

  const dismiss = () => { setVisible(false); setTimeout(onClose, 380); };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
      background: visible ? (isDark ? "rgba(4,8,20,0.72)" : "rgba(15,23,42,0.45)") : "rgba(0,0,0,0)",
      backdropFilter: visible ? "blur(12px)" : "blur(0px)",
      WebkitBackdropFilter: visible ? "blur(12px)" : "blur(0px)",
      transition: "background 0.36s, backdrop-filter 0.36s",
      pointerEvents: visible ? "auto" : "none",
    }}>
      <div style={{
        width: "100%", maxWidth: "400px", position: "relative", overflow: "hidden",
        background: isDark ? "rgba(10,16,30,0.98)" : "rgba(255,255,255,0.99)",
        borderRadius: "28px", border: `1.5px solid ${msg.color}30`,
        boxShadow: `0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px ${msg.color}15`,
        transform: visible ? "scale(1) translateY(0)" : "scale(0.88) translateY(24px)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.38s cubic-bezier(0.34,1.56,0.64,1), opacity 0.38s ease",
      }}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "160px", height: "160px", borderRadius: "9999px", background: `${msg.color}18`, filter: "blur(40px)", pointerEvents: "none" }} />
        <button onClick={dismiss} style={{ position: "absolute", top: "14px", right: "14px", width: "32px", height: "32px", borderRadius: "9999px", border: "none", background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1, transition: "background 0.18s, transform 0.18s" }}
          onMouseEnter={e => { e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"; e.currentTarget.style.transform = "scale(1.1)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"; e.currentTarget.style.transform = "scale(1)"; }}>
          <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "17px", lineHeight: 1, color: isDark ? "#64748b" : "#94a3b8" }}>close</span>
        </button>
        <div style={{ padding: "36px 32px 28px", position: "relative" }}>
          <div style={{ width: "68px", height: "68px", borderRadius: "18px", background: `${msg.color}18`, border: `1.5px solid ${msg.color}28`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "34px", marginBottom: "18px" }}>{msg.icon}</div>
          <p style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: msg.color, margin: "0 0 7px", fontFamily: "'Inter',sans-serif" }}>{tod.toUpperCase()}</p>
          <h2 style={{ fontSize: "21px", fontWeight: 900, letterSpacing: "-0.03em", color: isDark ? "#f1f5f9" : "#0f172a", margin: "0 0 9px", lineHeight: 1.2, fontFamily: "'Inter',sans-serif" }}>
            {firstName ? `${firstName}, ${msg.title.toLowerCase()}` : msg.title}
          </h2>
          <p style={{ fontSize: "13px", fontWeight: 500, lineHeight: 1.6, color: "#64748b", margin: "0 0 26px", fontFamily: "'Inter',sans-serif" }}>{msg.sub}</p>
          <button onClick={dismiss} style={{ width: "100%", height: "46px", borderRadius: "13px", border: "none", background: msg.color, color: "#0f172a", fontSize: "14px", fontWeight: 900, cursor: "pointer", fontFamily: "'Inter',sans-serif", boxShadow: `0 8px 24px ${msg.color}40`, transition: "transform 0.2s, box-shadow 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 12px 32px ${msg.color}55`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 8px 24px ${msg.color}40`; }}>
            Let&apos;s get studying 🚀
          </button>
        </div>
        <div style={{ height: "3px", background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}>
          <div style={{ height: "100%", background: msg.color, width: `${prog}%`, transition: "width 0.1s linear" }} />
        </div>
      </div>
    </div>
  );
}

/* ── iOS Notification Toasts ── */
const NOTIF_EMOJI = { quiz: "🎯", auto_stories: "📚", emoji_events: "🔥", psychology: "🧠", default: "💡" };

function IOSNotifToasts({ uid, isDark, onDone }) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!uid) return;
    import("firebase/database").then(({ get, push, ref: fbRef }) => {
      const nRef = fbRef(db, `notifications/${uid}`);
      get(nRef).then(snap => {
        if (!snap.exists()) {
          const demos = [
            { title: "Test Reminder", body: "Your DSA quiz is scheduled for tomorrow at 10 AM.", icon: "quiz", color: "#f59e0b", createdAt: Date.now(), read: false },
            { title: "New Notes Available", body: "CN Module 4 notes have been uploaded by your peer.", icon: "auto_stories", color: "#22c55e", createdAt: Date.now() - 120000, read: false },
            { title: "7-Day Streak! 🔥", body: "You've maintained a 7-day study streak. Keep going!", icon: "emoji_events", color: "#818cf8", createdAt: Date.now() - 3600000, read: true },
            { title: "Neural AI is ready", body: "Your last AI session summary has been saved.", icon: "psychology", color: "#00CC00", createdAt: Date.now() - 86400000, read: true },
          ];
          Promise.all(demos.map(d => push(nRef, d))).then(() => setReady(true));
        } else { setReady(true); }
      });
    });
  }, [uid]);

  useEffect(() => {
    if (!uid || !ready) return;
    import("firebase/database").then(({ onValue: fbOnValue, ref: fbRef }) => {
      const nRef = fbRef(db, `notifications/${uid}`);
      const unsub = fbOnValue(nRef, snap => {
        if (!snap.exists()) { setItems([]); return; }
        const list = Object.entries(snap.val())
          .map(([id, v]) => ({ id, ...v, visible: false, exiting: false }))
          .sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
        setItems(list);
      });
      return () => unsub();
    });
  }, [uid, ready]);

  useEffect(() => {
    if (!items.length) return;
    items.forEach((_, i) => setTimeout(() =>
      setItems(p => p.map((it, idx) => idx === i ? { ...it, visible: true } : it)), i * 150));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const fmt = ts => { const d = Date.now() - ts; if (d < 60000) return "just now"; if (d < 3600000) return `${Math.floor(d / 60000)}m ago`; if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`; return `${Math.floor(d / 86400000)}d ago`; };

  const dismiss = id => {
    setItems(p => p.map(it => it.id === id ? { ...it, exiting: true } : it));
    import("firebase/database").then(({ set: fbSet, ref: fbRef }) => fbSet(fbRef(db, `notifications/${uid}/${id}/read`), true));
    setTimeout(() => setItems(p => { const n = p.filter(it => it.id !== id); if (!n.length) onDone(); return n; }), 320);
  };

  if (!items.length) return null;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 8000, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "12px", gap: "8px", pointerEvents: "none" }}>
      {items.map(n => (
        <div key={n.id} style={{ width: "100%", maxWidth: "370px", padding: "0 12px", pointerEvents: "auto", transform: n.exiting ? "translateY(-14px) scale(0.93)" : n.visible ? "translateY(0) scale(1)" : "translateY(-20px) scale(0.92)", opacity: n.exiting ? 0 : n.visible ? 1 : 0, transition: "transform 0.32s cubic-bezier(0.34,1.56,0.64,1), opacity 0.26s ease" }}>
          <div style={{ background: isDark ? "rgba(12,18,32,0.97)" : "rgba(255,255,255,0.97)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderRadius: "18px", border: isDark ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(0,0,0,0.07)", boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.55)" : "0 8px 28px rgba(0,0,0,0.13)", overflow: "hidden" }}>
            <div style={{ padding: "8px 11px 7px", display: "flex", alignItems: "center", gap: "7px", borderBottom: isDark ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(0,0,0,0.04)" }}>
              <div style={{ width: "22px", height: "22px", borderRadius: "6px", background: `${n.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>{NOTIF_EMOJI[n.icon] || NOTIF_EMOJI.default}</div>
              <span style={{ fontSize: "11px", fontWeight: 800, color: isDark ? "#475569" : "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", flex: 1, fontFamily: "'Inter',sans-serif" }}>StudyBuddy</span>
              {!n.read && <div style={{ width: "7px", height: "7px", borderRadius: "9999px", background: n.color, boxShadow: `0 0 6px ${n.color}80`, flexShrink: 0 }} />}
              <span style={{ fontSize: "10px", fontWeight: 600, color: isDark ? "#334155" : "#cbd5e1", fontFamily: "'Inter',sans-serif" }}>{fmt(n.createdAt)}</span>
              <button onClick={() => dismiss(n.id)} style={{ background: "none", border: "none", cursor: "pointer", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}>
                <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "15px", lineHeight: 1, color: isDark ? "#334155" : "#cbd5e1" }}>close</span>
              </button>
            </div>
            <div style={{ padding: "10px 11px 12px" }}>
              <p style={{ fontSize: "13px", fontWeight: 800, color: isDark ? "#f1f5f9" : "#0f172a", margin: "0 0 3px", fontFamily: "'Inter',sans-serif" }}>{n.title}</p>
              <p style={{ fontSize: "12px", fontWeight: 500, color: isDark ? "#64748b" : "#475569", margin: 0, lineHeight: 1.4, fontFamily: "'Inter',sans-serif" }}>{n.body}</p>
            </div>
            <div style={{ height: "2px", background: `linear-gradient(90deg,${n.color} 0%,transparent 100%)` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Theme Switcher ── */
function ThemeSwitcher({ theme, setTheme, resolved }) {
  const isDark = resolved === "dark";
  const [hovered, setHovered] = useState(null);
  const opts = [
    { value: "light", icon: "light_mode", label: "Light" },
    { value: "dark", icon: "dark_mode", label: "Dark" },
    { value: "system", icon: "desktop_windows", label: "System" },
  ];
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "2px", padding: "4px", borderRadius: "9999px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`, position: "relative" }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <div key={value} style={{ position: "relative" }}>
            <button onClick={() => setTheme(value)} onMouseEnter={() => setHovered(value)} onMouseLeave={() => setHovered(null)} title={label}
              style={{ width: "32px", height: "32px", borderRadius: "9999px", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.22s cubic-bezier(0.34,1.56,0.64,1)", background: active ? (isDark ? "rgba(0,255,0,0.18)" : "#00FF00") : "transparent", boxShadow: active ? (isDark ? "0 0 14px rgba(0,255,0,0.3)" : "0 4px 12px rgba(0,255,0,0.35)") : "none", transform: active ? "scale(1.08)" : "scale(1)" }}>
              <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "16px", lineHeight: 1, color: active ? (isDark ? "#00FF00" : "#0f172a") : (isDark ? "#475569" : "#94a3b8") }}>{icon}</span>
            </button>
            {hovered === value && (
              <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: isDark ? "#1e293b" : "#0f172a", color: "#fff", fontSize: "10px", fontWeight: 700, padding: "4px 8px", borderRadius: "6px", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.3)", animation: "fadeUp 0.15s ease" }}>
                {label}
                <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `4px solid ${isDark ? "#1e293b" : "#0f172a"}` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Theme hook ── */
function useTheme() {
  const KEY = "studybuddy_theme";
  const [theme, setThemeState] = useState("system");
  const [resolved, setResolved] = useState("light");

  useEffect(() => { try { setThemeState(localStorage.getItem(KEY) || "system"); } catch { } }, []);

  const setTheme = (val) => { try { localStorage.setItem(KEY, val); } catch { } setThemeState(val); };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);

  return { theme, setTheme, resolved };
}

/* ── Skeleton ── */
function Skeleton({ w = "100%", h = "20px", r = "8px", isDark }) {
  return (
    <div style={{ width: w, height: h, borderRadius: r, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", animation: "skeletonPulse 1.6s ease-in-out infinite", overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, background: isDark ? "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)" : "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.7) 50%, transparent 100%)", animation: "skeletonShimmer 1.6s ease-in-out infinite" }} />
    </div>
  );
}

function StatCardSkeleton({ isDark }) {
  const bg = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.06)";
  return (
    <div style={{ background: bg, padding: "24px", borderRadius: "20px", border: `1px solid ${bdr}`, boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 2px 12px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <Skeleton w="36px" h="36px" r="10px" isDark={isDark} />
        <Skeleton w="80px" h="12px" r="6px" isDark={isDark} />
      </div>
      <Skeleton w="60%" h="11px" r="6px" isDark={isDark} />
      <div style={{ marginTop: "10px" }}><Skeleton w="50%" h="32px" r="8px" isDark={isDark} /></div>
      <div style={{ marginTop: "20px" }}><Skeleton w="100%" h="6px" r="9999px" isDark={isDark} /></div>
    </div>
  );
}

function NoteCardSkeleton({ isDark }) {
  const bg = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.06)";
  return (
    <div style={{ background: bg, padding: "20px", borderRadius: "18px", border: `1px solid ${bdr}`, display: "flex", gap: "20px" }}>
      <Skeleton w="100px" h="100px" r="14px" isDark={isDark} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
        <Skeleton w="40%" h="10px" r="6px" isDark={isDark} />
        <Skeleton w="70%" h="14px" r="6px" isDark={isDark} />
        <Skeleton w="90%" h="10px" r="6px" isDark={isDark} />
        <Skeleton w="80%" h="10px" r="6px" isDark={isDark} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}><Skeleton w="100px" h="32px" r="10px" isDark={isDark} /></div>
      </div>
    </div>
  );
}

const SEMESTERS = [1, 2, 3, 4, 5, 6];

/* ── Branch Popup ── */
const BRANCHES = [
  { code: "IT", label: "Information Technology", icon: "computer" },
  { code: "CS", label: "Computer Science", icon: "code" },
  { code: "EXTC", label: "Electronics & Telecomm.", icon: "memory" },
  { code: "MECH", label: "Mechanical Engineering", icon: "settings" },
  { code: "CIVIL", label: "Civil Engineering", icon: "architecture" },
  { code: "ELEC", label: "Electrical Engineering", icon: "bolt" },
];

function BranchPopup({ uid, isDark, onComplete }) {
  const [selected, setSelected] = useState("");
  const [sem, setSemester] = useState(null);
  const [step, setStep] = useState("select"); // "select" | "confirm"
  const [saving, setSaving] = useState(false);

  const bg = isDark ? "rgba(15,23,42,0.98)" : "rgba(255,255,255,0.98)";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#64748b" : "#64748b";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const cardBg = (on) => on ? "rgba(0,255,0,0.12)" : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)");
  const cardBdr = (on) => on ? "rgba(0,255,0,0.6)" : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)");

  const canProceed = selected && sem;

  const save = async () => {
    if (!canProceed) return;
    setSaving(true);
    await set(ref(db, `users/${uid}/branch`), selected);
    await set(ref(db, `users/${uid}/sem`), sem);
    setSaving(false);
    onComplete({ branch: selected, sem });
  };

  /* ── Step 1: Select ── */
  if (step === "select") return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: isDark ? "rgba(8,15,26,0.8)" : "rgba(15,23,42,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ width: "100%", maxWidth: "540px", background: bg, borderRadius: "28px", border: `1px solid ${isDark ? "rgba(0,255,0,0.2)" : "rgba(0,200,0,0.2)"}`, padding: "44px 36px", boxShadow: "0 40px 100px rgba(0,0,0,0.3)", animation: "popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)", maxHeight: "90vh", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginBottom: "32px" }}>
          <div style={{ width: "56px", height: "56px", background: "#00FF00", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 24px rgba(0,255,0,0.4)", marginBottom: "8px" }}>
            <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "30px", color: "#0f172a", lineHeight: 1 }}>school</span>
          </div>
          <h2 style={{ fontSize: "22px", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.03em" }}>Set Up Your Profile</h2>
          <p style={{ fontSize: "13px", color: text2, fontWeight: 500, margin: 0, textAlign: "center" }}>Choose your branch and sem. <strong style={{ color: "#f87171" }}>This cannot be changed later.</strong></p>
        </div>

        {/* Branch grid */}
        <p style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 12px" }}>Branch</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "10px", marginBottom: "28px" }}>
          {BRANCHES.map(({ code, label, icon }) => {
            const on = selected === code;
            return (
              <button key={code} onClick={() => setSelected(code)}
                style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1.5px solid ${cardBdr(on)}`, background: cardBg(on), cursor: "pointer", transition: "all 0.2s cubic-bezier(0.34,1.56,0.64,1)", boxShadow: on ? "0 0 18px rgba(0,255,0,0.2)" : "none", transform: on ? "scale(1.02)" : "scale(1)" }}
                onMouseEnter={e => { if (!on) { e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,200,0,0.06)"; e.currentTarget.style.borderColor = "rgba(0,255,0,0.3)"; } }}
                onMouseLeave={e => { if (!on) { e.currentTarget.style.background = cardBg(false); e.currentTarget.style.borderColor = cardBdr(false); } }}>
                <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "20px", color: on ? "#00FF00" : (isDark ? "#475569" : "#94a3b8"), lineHeight: 1 }}>{icon}</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: on ? "#00FF00" : text1, lineHeight: 1 }}>{code}</div>
                  <div style={{ fontSize: "10px", color: isDark ? "#475569" : "#94a3b8", fontWeight: 600, marginTop: "2px", lineHeight: 1.3 }}>{label}</div>
                </div>
                {on && <span style={{ marginLeft: "auto", fontFamily: "'Material Symbols Outlined'", fontSize: "18px", color: "#00FF00", lineHeight: 1 }}>check_circle</span>}
              </button>
            );
          })}
        </div>

        {/* sem selector */}
        <p style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 12px" }}>Current sem</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "8px", marginBottom: "32px" }}>
          {SEMESTERS.map(s => {
            const on = sem === s;
            return (
              <button key={s} onClick={() => setSemester(s)}
                style={{ height: "48px", borderRadius: "12px", border: `1.5px solid ${cardBdr(on)}`, background: cardBg(on), cursor: "pointer", fontSize: "14px", fontWeight: 900, color: on ? "#00FF00" : text2, transition: "all 0.2s cubic-bezier(0.34,1.56,0.64,1)", boxShadow: on ? "0 0 14px rgba(0,255,0,0.25)" : "none", transform: on ? "scale(1.08)" : "scale(1)", fontFamily: "'Inter',sans-serif" }}>
                {s}
              </button>
            );
          })}
        </div>

        {/* CTA */}
        <button onClick={() => setStep("confirm")} disabled={!canProceed}
          style={{ width: "100%", height: "52px", background: canProceed ? "#00FF00" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"), color: canProceed ? "#0f172a" : (isDark ? "#475569" : "#94a3b8"), border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 900, cursor: canProceed ? "pointer" : "not-allowed", fontFamily: "'Inter',sans-serif", transition: "all 0.25s cubic-bezier(0.34,1.56,0.64,1)", boxShadow: canProceed ? "0 8px 28px rgba(0,255,0,0.38)" : "none" }}>
          Review & Confirm →
        </button>
      </div>
    </div>
  );

  /* ── Step 2: Confirmation ── */
  return (
  <div style={{ position: "fixed", inset: 0, zIndex: 999, background: isDark ? "rgba(8,15,26,0.88)" : "rgba(15,23,42,0.6)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
    <div style={{ width: "100%", maxWidth: "420px", background: bg, borderRadius: "28px", border: "1px solid rgba(0,255,0,0.25)", padding: "44px 36px", boxShadow: "0 40px 100px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,255,0,0.08)", animation: "popIn 0.32s cubic-bezier(0.34,1.56,0.64,1)" }}>

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginBottom: "32px" }}>
        <div style={{ width: "60px", height: "60px", borderRadius: "16px", background: "rgba(0,255,0,0.1)", border: "1.5px solid rgba(0,255,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "4px", boxShadow: "0 0 20px rgba(0,255,0,0.15)" }}>
          <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "32px", color: "#00FF00", lineHeight: 1 }}>lock</span>
        </div>
        <h2 style={{ fontSize: "21px", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.03em", textAlign: "center" }}>Confirm Your Details</h2>
        <p style={{ fontSize: "13px", color: text2, fontWeight: 600, margin: 0, textAlign: "center", lineHeight: 1.6, maxWidth: "280px" }}>
          ⚠️ These details are <span style={{ color: "#00FF00", fontWeight: 800 }}>permanent</span> and cannot be changed after confirmation.
        </p>
      </div>

      {/* Summary card */}
      <div style={{ background: isDark ? "rgba(0,255,0,0.04)" : "rgba(0,200,0,0.04)", border: isDark ? "1px solid rgba(0,255,0,0.12)" : "1px solid rgba(0,200,0,0.15)", borderRadius: "16px", padding: "20px 24px", marginBottom: "28px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.1em" }}>Branch</span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "15px", fontWeight: 900, color: "#00FF00" }}>{selected}</span>
            <span style={{ fontSize: "11px", color: text2, fontWeight: 600 }}>{BRANCHES.find(b => b.code === selected)?.label}</span>
          </div>
        </div>
        <div style={{ height: "1px", background: isDark ? "rgba(0,255,0,0.08)" : "rgba(0,200,0,0.12)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.1em" }}>sem</span>
          <span style={{ fontSize: "15px", fontWeight: 900, color: "#00FF00" }}>sem {sem}</span>
        </div>
        <div style={{ height: "1px", background: isDark ? "rgba(0,255,0,0.08)" : "rgba(0,200,0,0.12)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.1em" }}>College</span>
          <span style={{ fontSize: "13px", fontWeight: 800, color: text2 }}>TCET</span>
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <button onClick={save} disabled={saving}
          style={{ width: "100%", height: "52px", background: "#00FF00", color: "#0f172a", border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 900, cursor: saving ? "not-allowed" : "pointer", fontFamily: "'Inter',sans-serif", transition: "all 0.22s", boxShadow: "0 8px 28px rgba(0,255,0,0.38)", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
          onMouseEnter={e => { if (!saving) { e.currentTarget.style.boxShadow = "0 12px 36px rgba(0,255,0,0.5)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
          onMouseLeave={e => { if (!saving) { e.currentTarget.style.boxShadow = "0 8px 28px rgba(0,255,0,0.38)"; e.currentTarget.style.transform = "translateY(0)"; } }}>
          {saving && <div style={{ width: "18px", height: "18px", border: "2px solid rgba(0,0,0,0.2)", borderTopColor: "#0f172a", borderRadius: "9999px", animation: "spin 0.7s linear infinite" }} />}
          {saving ? "Saving…" : "Confirm & Lock In"}
        </button>
        <button onClick={() => setStep("select")} disabled={saving}
          style={{ width: "100%", height: "44px", background: "none", border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)", borderRadius: "12px", fontSize: "13px", fontWeight: 700, color: text2, cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: "border-color 0.18s, color 0.18s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.4)"; e.currentTarget.style.color = text1; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"; e.currentTarget.style.color = text2; }}>
          ← Go Back & Edit
        </button>
      </div>
    </div>
  </div>
);
}

/* ── Stat Card ── */
function StatCard({ icon, label, value, subtext, progress, isDark }) {
  const bg = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#64748b" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.06)";
  return (
    <div style={{ background: bg, padding: "24px", borderRadius: "20px", boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 2px 12px rgba(0,0,0,0.05)", border: `1px solid ${bdr}`, transition: "box-shadow 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = isDark ? "0 8px 32px rgba(0,255,0,0.1)" : "0 8px 28px rgba(0,200,0,0.12)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = isDark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 2px 12px rgba(0,0,0,0.05)"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div style={{ padding: "8px", borderRadius: "10px", background: "rgba(0,200,0,0.1)" }}>
          <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "22px", color: "#009900", lineHeight: 1 }}>{icon}</span>
        </div>
        <span style={{ fontSize: "10px", fontWeight: 800, color: "#00AA00" }}>{subtext}</span>
      </div>
      <p style={{ fontSize: "11px", fontWeight: 700, color: text2, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>{label}</p>
      <h3 style={{ fontSize: "28px", fontWeight: 900, color: text1, margin: "0 0 16px", letterSpacing: "-0.03em" }}>{value}</h3>
      <div style={{ width: "100%", height: "6px", borderRadius: "9999px", background: isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: "#00FF00", borderRadius: "9999px" }} />
      </div>
    </div>
  );
}

/* ── Page Components ── */
function PagePlaceholder({ title, icon, isDark }) {
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#64748b" : "#94a3b8";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px", padding: "40px", minHeight: "400px" }}>
      <div style={{ width: "80px", height: "80px", borderRadius: "20px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "40px", color: "#00AA00", lineHeight: 1 }}>{icon}</span>
      </div>
      <h2 style={{ fontSize: "24px", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.03em" }}>{title}</h2>
      <p style={{ fontSize: "14px", color: text2, margin: 0, textAlign: "center", maxWidth: "300px", lineHeight: 1.6 }}>
        This section is coming soon. Stay tuned for updates!
      </p>
      <div style={{ padding: "8px 20px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.25)", borderRadius: "9999px", fontSize: "12px", fontWeight: 800, color: "#009900", fontFamily: "'Inter',sans-serif" }}>
        🚧 In Development
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════ */
export default function Dashboard() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [authUser, setAuthUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBranch, setShowBranch] = useState(false);
  const [activePage, setActivePage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showGreeting, setShowGreeting] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showIOSNotifs, setShowIOSNotifs] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [aiInsights, setAiInsights] = useState([]);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);
  const [aiInsightsError, setAiInsightsError] = useState("");
  const [mobileSearch, setMobileSearch] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const notifRef = useRef(null);
  const notifBtn = useRef(null);
  const searchRef = useRef(null);
  const inFlightFetchRef = useRef(false);
  const lastFetchAtRef = useRef(0);

  const applyUserData = useCallback((uid, data, source = "live") => {
    if (!data) return;
    setUserData(data);
    setShowBranch(!data.branch);
    setLoading(false);
    if (source === "live") {
      writeDashCache(uid, data);
      setLastSyncedAt(Date.now());
    }
  }, []);

  const fetchUserData = useCallback(async (uid, { force = false } = {}) => {
    if (!uid || inFlightFetchRef.current) return;
    const now = Date.now();
    if (!force && now - lastFetchAtRef.current < DASH_MIN_FETCH_GAP_MS) return;

    inFlightFetchRef.current = true;
    try {
      const snap = await get(ref(db, `users/${uid}`));
      if (snap.exists()) {
        applyUserData(uid, snap.val(), "live");
      } else {
        setLoading(false);
      }
      lastFetchAtRef.current = Date.now();
    } finally {
      inFlightFetchRef.current = false;
    }
  }, [applyUserData]);

  /* Close notifs on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (showNotifs && notifRef.current && !notifRef.current.contains(e.target) && notifBtn.current && !notifBtn.current.contains(e.target)) setShowNotifs(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNotifs]);

  /* Close mobile search on outside click */
  useEffect(() => {
    const handler = (e) => { if (mobileSearch && searchRef.current && !searchRef.current.contains(e.target)) setMobileSearch(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileSearch]);

  /* Auth guard */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { router.replace("/"); return; }
      setAuthUser(firebaseUser);

      const cached = readDashCache(firebaseUser.uid);
      if (cached?.data) {
        applyUserData(firebaseUser.uid, cached.data, "cache");
        setCacheHydrated(true);
      }

      const cacheFresh = cached?.updatedAt && (Date.now() - cached.updatedAt) < DASH_CACHE_TTL_MS;
      await fetchUserData(firebaseUser.uid, { force: !cacheFresh });

      if (!sessionStorage.getItem("sb_greeted")) {
        sessionStorage.setItem("sb_greeted", "1");
        setTimeout(() => setShowGreeting(true), 600);
        setTimeout(() => setShowIOSNotifs(true), 1400);
      }
    });
    return () => unsub();
  }, [router, applyUserData, fetchUserData]);

  useEffect(() => {
    if (!authUser?.uid) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchUserData(authUser.uid, { force: false });
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authUser?.uid, fetchUserData]);

  /* Derived colours */
  const bg = isDark ? "#080f1a" : "#f5f8f5";
  const sidebar = isDark ? "rgba(8,15,26,0.96)" : "rgba(255,255,255,0.75)";
  const header = isDark ? "rgba(8,15,26,0.92)" : "rgba(255,255,255,0.75)";
  const card = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const inputBg = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,200,0,0.05)";
  const rightBg = isDark ? "rgba(8,15,26,0.6)" : "rgba(255,255,255,0.5)";

  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";
  const fullName = userData?.fullName || authUser?.displayName || "";
  const photoURL = userData?.photoURL || authUser?.photoURL || "";
  const branch = userData?.branch || null;
  const email = userData?.email || authUser?.email || "";
  const studyHours = userData?.stats?.studyHours ?? 0;
  const aiQuestions = userData?.stats?.aiQuestions ?? 0;
  const solvedProblems = userData?.stats?.solvedProblems ?? 0;
  const streak = userData?.stats?.streak ?? 0;

  const formatCompactNumber = useCallback((input) => {
    const n = Number(input);
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs < 1000) return `${Math.round(n)}`;

    const suffixes = ["", "K", "M", "B", "T"];
    const power = Math.floor(Math.log10(abs) / 3);
    if (power >= suffixes.length) return n.toExponential(2);

    const scaled = n / (1000 ** power);
    const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    const rounded = scaled.toFixed(decimals).replace(/\.0+$|\.(\d*[1-9])0+$/, ".$1");
    return `${rounded}${suffixes[power]}`;
  }, []);

  const formatStreakDuration = useCallback((totalDays) => {
    const days = Number(totalDays) || 0;
    if (days <= 0) return { value: "—", subtext: "Start today!" };

    if (days < 30) {
      return {
        value: `${days} day${days === 1 ? "" : "s"}`,
        subtext: "Keep it up!",
      };
    }

    if (days < 365) {
      const months = Math.floor(days / 30);
      const remDays = days % 30;
      const value = remDays > 0
        ? `${months}m ${remDays}d`
        : `${months} month${months === 1 ? "" : "s"}`;
      return {
        value,
        subtext: `${days} days total`,
      };
    }

    const years = Math.floor(days / 365);
    const remDays = days % 365;
    const months = Math.floor(remDays / 30);
    const value = months > 0
      ? `${years}y ${months}m`
      : `${years} year${years === 1 ? "" : "s"}`;
    return {
      value,
      subtext: `${days} days total`,
    };
  }, []);

  const streakDisplay = formatStreakDuration(streak);

  const aiLevels = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];
  const askedByLevel = useMemo(() => {
    const raw = userData?.stats?.askedByLevel;
    const entries = aiLevels.map((level) => ({
      level,
      value: Number(raw?.[level] ?? 0) || 0,
    }));
    const max = entries.reduce((m, e) => Math.max(m, e.value), 0);
    return { entries, max, total: entries.reduce((s, e) => s + e.value, 0) };
  }, [userData?.stats?.askedByLevel]);

  const weakByLevel = useMemo(() => {
    const raw = userData?.stats?.weakByLevel;
    const entries = aiLevels.map((level) => ({
      level,
      value: Number(raw?.[level] ?? 0) || 0,
    }));
    const max = entries.reduce((m, e) => Math.max(m, e.value), 0);
    return { entries, max, total: entries.reduce((s, e) => s + e.value, 0) };
  }, [userData?.stats?.weakByLevel]);

  const hasAiAnalytics = askedByLevel.total > 0 || weakByLevel.total > 0;

  const generateAnalyticsInsights = useCallback(async () => {
    if (!hasAiAnalytics || aiInsightsLoading) return;

    setAiInsightsLoading(true);
    setAiInsightsError("");
    try {
      const payload = {
        streak,
        studyHours,
        aiQuestions,
        solvedProblems,
        askedByLevel: askedByLevel.entries.reduce((acc, item) => ({ ...acc, [item.level]: item.value }), {}),
        weakByLevel: weakByLevel.entries.reduce((acc, item) => ({ ...acc, [item.level]: item.value }), {}),
      };

      const res = await fetch("/api/groq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content: "You are an academic performance coach. Analyze the student's metrics and return ONLY a JSON array of 4 to 6 short actionable improvement points. Each point must be practical and specific. No markdown, no explanation outside the JSON array.",
            },
            {
              role: "user",
              content: `Student dashboard stats: ${JSON.stringify(payload)}`,
            },
          ],
        }),
      });

      if (!res.ok) throw new Error("Failed to analyze stats");
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";

      let nextInsights = [];
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          nextInsights = parsed.map((item) => `${item}`.trim()).filter(Boolean);
        }
      }

      if (!nextInsights.length) {
        nextInsights = content
          .split(/\n+/)
          .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
          .filter(Boolean)
          .slice(0, 6);
      }

      if (!nextInsights.length) throw new Error("No insights generated");
      setAiInsights(nextInsights);
    } catch (err) {
      setAiInsightsError(err?.message || "Could not generate insights right now.");
    } finally {
      setAiInsightsLoading(false);
    }
  }, [
    hasAiAnalytics,
    aiInsightsLoading,
    streak,
    studyHours,
    aiQuestions,
    solvedProblems,
    askedByLevel.entries,
    weakByLevel.entries,
  ]);

  const radarModel = useMemo(() => {
    const labels = aiLevels;
    const askedValues = labels.map((level) => Number(userData?.stats?.askedByLevel?.[level] ?? 0) || 0);
    const weakValues = labels.map((level) => Number(userData?.stats?.weakByLevel?.[level] ?? 0) || 0);
    const maxValue = Math.max(1, ...askedValues, ...weakValues);

    const size = 300;
    const center = size / 2;
    const radius = 105;
    const steps = 4;

    const pointAt = (index, valueRatio = 1) => {
      const angle = (-Math.PI / 2) + (index * (2 * Math.PI / labels.length));
      const r = radius * valueRatio;
      const x = center + Math.cos(angle) * r;
      const y = center + Math.sin(angle) * r;
      return { x, y };
    };

    const toPointString = (values) => values
      .map((value, i) => {
        const ratio = maxValue ? value / maxValue : 0;
        const p = pointAt(i, ratio);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" ");

    const toPoints = (values) => values.map((value, i) => {
      const ratio = maxValue ? value / maxValue : 0;
      const p = pointAt(i, ratio);
      return { level: labels[i], value, x: p.x, y: p.y };
    });

    const gridPolygons = Array.from({ length: steps }, (_, i) => {
      const ratio = (i + 1) / steps;
      return labels
        .map((_, idx) => {
          const p = pointAt(idx, ratio);
          return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        })
        .join(" ");
    });

    const axisLines = labels.map((_, idx) => {
      const p = pointAt(idx, 1);
      return { x1: center, y1: center, x2: p.x, y2: p.y };
    });

    const labelPoints = labels.map((label, idx) => {
      const p = pointAt(idx, 1.18);
      return { label, x: p.x, y: p.y };
    });

    return {
      size,
      center,
      gridPolygons,
      axisLines,
      labelPoints,
      askedPolygon: toPointString(askedValues),
      weakPolygon: toPointString(weakValues),
      askedPoints: toPoints(askedValues),
      weakPoints: toPoints(weakValues),
      askedValues,
      weakValues,
      maxValue,
    };
  }, [aiLevels, userData?.stats?.askedByLevel, userData?.stats?.weakByLevel]);

  const stats = [
    { icon: "schedule", label: "Study Hours", value: studyHours ? `${studyHours}h` : "—", subtext: studyHours ? "+12% vs last week" : "No data yet", progress: Math.min((studyHours / 50) * 100, 100) },
    { icon: "question_answer", label: "AI Questions", value: aiQuestions ? formatCompactNumber(aiQuestions) : "—", subtext: aiQuestions ? "Active with Neural AI" : "Ask your first question", progress: Math.min((aiQuestions / 200) * 100, 100) },
    { icon: "task_alt", label: "Solved Problems", value: solvedProblems || "—", subtext: solvedProblems ? "+8% vs last week" : "No data yet", progress: Math.min((solvedProblems / 100) * 100, 100) },
    { icon: "local_fire_department", label: "Active Streak", value: streakDisplay.value, subtext: streakDisplay.subtext, progress: Math.min((streak / 30) * 100, 100) },
  ];

  const recentNotes = useMemo(() => {
    if (!userData?.recentNotes) return [];
    return Object.values(userData.recentNotes)
      .sort((a, b) => (Number(b?.updatedAt || b?.createdAt || 0) - Number(a?.updatedAt || a?.createdAt || 0)))
      .slice(0, 6);
  }, [userData?.recentNotes]);

  const navItems = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard" },
    { id: "notes", icon: "description", label: "Notes" },
    { id: "test", icon: "quiz", label: "Test" },
    { id: "ai", icon: "psychology", label: "Neural AI" },
    { id: "profile", icon: "person", label: "Profile" },
    { id: "settings", icon: "settings", label: "Settings" },
  ];

  const hour = new Date().getHours();
  const greetWord = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  /* Page title map */
  const pageTitles = {
    dashboard: "Dashboard",
    notes: "My Notes",
    test: "Tests & Quizzes",
    ai: "Neural AI",
    profile: "Profile",
    settings: "Settings",
  };

  /* Loading skeleton */
  if (loading) return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Inter',sans-serif;background:${bg};overflow:hidden;}
        @keyframes skeletonPulse{0%,100%{opacity:1;}50%{opacity:0.5;}}
        @keyframes skeletonShimmer{0%{transform:translateX(-100%);}100%{transform:translateX(200%);}}
        .dash-loading-desktop{display:flex;height:100vh;background:${bg};}
        .dash-loading-mobile{display:none;height:100vh;background:${bg};flex-direction:column;}
        @media(max-width:768px){
          .dash-loading-desktop{display:none;}
          .dash-loading-mobile{display:flex;}
        }
      `}</style>

      <div className="dash-loading-desktop">
        <div style={{ width: "260px", minWidth: "260px", background: sidebar, borderRight: `1px solid ${bdr}`, padding: "24px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
            <Skeleton w="40px" h="40px" r="10px" isDark={isDark} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
              <Skeleton w="80%" h="14px" r="6px" isDark={isDark} />
              <Skeleton w="50%" h="10px" r="6px" isDark={isDark} />
            </div>
          </div>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px" }}>
              <Skeleton w="20px" h="20px" r="6px" isDark={isDark} />
              <Skeleton w="60%" h="13px" r="6px" isDark={isDark} />
            </div>
          ))}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ height: "72px", background: header, borderBottom: `1px solid ${bdr}`, padding: "0 32px", display: "flex", alignItems: "center", gap: "16px" }}>
            <Skeleton w="36px" h="36px" r="9999px" isDark={isDark} />
            <Skeleton w="360px" h="40px" r="9999px" isDark={isDark} />
            <div style={{ marginLeft: "auto", display: "flex", gap: "12px", alignItems: "center" }}>
              <Skeleton w="100px" h="36px" r="9999px" isDark={isDark} />
              <Skeleton w="40px" h="40px" r="9999px" isDark={isDark} />
            </div>
          </div>
          <div style={{ flex: 1, padding: "32px", display: "flex", flexDirection: "column", gap: "40px", overflowY: "auto" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <Skeleton w="340px" h="32px" r="8px" isDark={isDark} />
              <Skeleton w="220px" h="16px" r="6px" isDark={isDark} />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                <Skeleton w="160px" h="20px" r="6px" isDark={isDark} />
                <Skeleton w="40px" h="20px" r="9999px" isDark={isDark} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "16px" }}>
                {[...Array(4)].map((_, i) => <StatCardSkeleton key={i} isDark={isDark} />)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dash-loading-mobile">
        <div style={{ height: "64px", background: header, borderBottom: `1px solid ${bdr}`, padding: "0 14px", display: "flex", alignItems: "center", gap: "10px" }}>
          <Skeleton w="34px" h="34px" r="9px" isDark={isDark} />
          <Skeleton w="100%" h="36px" r="9999px" isDark={isDark} />
          <Skeleton w="36px" h="36px" r="9999px" isDark={isDark} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 120px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Skeleton w="72%" h="26px" r="8px" isDark={isDark} />
            <Skeleton w="48%" h="12px" r="6px" isDark={isDark} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ background: card, border: `1px solid ${bdr}`, borderRadius: "16px", padding: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <Skeleton w="30px" h="30px" r="9px" isDark={isDark} />
                  <Skeleton w="40px" h="12px" r="9999px" isDark={isDark} />
                </div>
                <Skeleton w="64%" h="10px" r="6px" isDark={isDark} />
                <div style={{ marginTop: "8px" }}><Skeleton w="80%" h="24px" r="8px" isDark={isDark} /></div>
              </div>
            ))}
          </div>

          {[...Array(2)].map((_, i) => (
            <div key={i} style={{ background: card, border: `1px solid ${bdr}`, borderRadius: "16px", padding: "14px", display: "flex", gap: "12px" }}>
              <Skeleton w="74px" h="74px" r="12px" isDark={isDark} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                <Skeleton w="34%" h="10px" r="6px" isDark={isDark} />
                <Skeleton w="72%" h="12px" r="6px" isDark={isDark} />
                <Skeleton w="90%" h="10px" r="6px" isDark={isDark} />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                  <Skeleton w="90px" h="30px" r="10px" isDark={isDark} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  /* ── Page content renderer ── */
  const renderPage = () => {
    switch (activePage) {
      case "dashboard":
        return (
          <>
            {/* Welcome */}
            <div style={{ animation: "fadeUp 0.4s ease both" }}>
              <h2 style={{ fontSize: "clamp(1.4rem,3vw,1.9rem)", fontWeight: 900, letterSpacing: "-0.03em", color: text1, marginBottom: "6px" }}>
                {firstName ? `Good ${greetWord}, ${firstName}! 👋` : `Good ${greetWord}! 👋`}
              </h2>
              <p style={{ fontSize: "14px", color: text2, fontWeight: 500, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", margin: 0 }}>
                Here&apos;s your academic overview.
                {branch && <span style={{ padding: "2px 10px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.2)", borderRadius: "9999px", fontSize: "11px", fontWeight: 800, color: "#009900" }}>{branch}</span>}
                {email && <span style={{ fontSize: "11px", color: text3, fontWeight: 500 }}>{email}</span>}
              </p>
            </div>
            {/* Stats */}
            <section style={{ animation: "fadeUp 0.4s ease 0.05s both" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.02em", color: text1, margin: 0 }}>Academic Overview</h3>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    onClick={() => setShowAnalytics((p) => !p)}
                    style={{ fontSize: "10px", fontWeight: 800, color: "#00AA00", background: "rgba(0,200,0,0.08)", border: "1px solid rgba(0,200,0,0.22)", padding: "4px 10px", borderRadius: "9999px", textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", fontFamily: "'Inter',sans-serif" }}
                  >
                    {showAnalytics ? "Hide Analytics" : "Show Analytics"}
                  </button>
                  <span style={{ fontSize: "10px", fontWeight: 800, color: text3, background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,200,0,0.06)", padding: "4px 12px", borderRadius: "9999px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {cacheHydrated && !lastSyncedAt ? "Cached" : "Live"}
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "16px" }}>
                {stats.map(s => <StatCard key={s.label} {...s} isDark={isDark} />)}
              </div>
            </section>
            {/* Recent Notes */}
            <section style={{ animation: "fadeUp 0.4s ease 0.1s both" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.02em", color: text1, margin: 0 }}>Recent Notes</h3>
                <button onClick={() => router.push("/notes")} style={{ fontSize: "13px", fontWeight: 800, color: "#00AA00", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "3px", fontFamily: "'Inter',sans-serif" }}>View All</button>
              </div>
              {recentNotes.length === 0 ? (
                <div className="note-card">
                  <div className="empty-state" style={{ width: "100%" }}>
                    <span className="ms" style={{ fontSize: "40px", color: text3 }}>auto_stories</span>
                    <p style={{ fontSize: "14px", fontWeight: 700, color: text2, margin: 0 }}>No notes yet</p>
                    <p style={{ fontSize: "12px", color: text3, margin: 0 }}>Your saved notes will appear here.</p>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: "16px" }}>
                  {recentNotes.map((note, i) => (
                    <div key={i} className="note-card">
                      <div className="note-icon-box">
                        <span className="ms" style={{ fontSize: "36px", color: "rgba(0,180,0,0.6)" }}>{note.icon || "description"}</span>
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                        <div>
                          <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: "9999px", background: "rgba(0,200,0,0.1)", color: "#009900", fontSize: "10px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>{note.subject || branch || "General"}</span>
                          <h4 style={{ fontSize: "14px", fontWeight: 800, color: text1, margin: "0 0 4px" }}>{note.title}</h4>
                          <p style={{ fontSize: "11px", color: text2, lineHeight: 1.5, margin: 0 }}>{note.desc}</p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: "12px" }}>
                          <button onClick={() => {
                            const noteBranch = note.branch || branch;
                            const noteSem = normalizeSem(note.sem || userData?.sem);
                            const noteSubject = note.subject;
                            const noteModule = note.key || note.module || note.moduleKey;
                            if (noteBranch && noteSem && noteSubject && noteModule) {
                              router.push(`/pdfviewer?branch=${encodeURIComponent(noteBranch)}&sem=${encodeURIComponent(noteSem)}&subject=${encodeURIComponent(noteSubject)}&module=${encodeURIComponent(noteModule)}`);
                              return;
                            }
                            router.push("/notes");
                          }} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: isDark ? "#f1f5f9" : "#0f172a", color: isDark ? "#0f172a" : "#fff", border: "none", borderRadius: "10px", fontSize: "11px", fontWeight: 800, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                            Open Note <span className="ms" style={{ fontSize: "14px" }}>arrow_forward</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        );
      case "notes": return <PagePlaceholder title="My Notes" icon="description" isDark={isDark} />;
      case "test": return <PagePlaceholder title="Tests & Quizzes" icon="quiz" isDark={isDark} />;
      case "ai": return <PagePlaceholder title="Neural AI" icon="psychology" isDark={isDark} />;
      case "profile": return <PagePlaceholder title="My Profile" icon="person" isDark={isDark} />;
      case "settings": return <PagePlaceholder title="Settings" icon="settings" isDark={isDark} />;
      default: return null;
    }
  };

  /* Avatar element (reused in header) */
  const AvatarEl = ({ size = 40 }) => (
    <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: "9999px", border: "2.5px solid #00FF00", overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0", flexShrink: 0 }}>
      {photoURL
        ? <img src={photoURL} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontSize: `${size * 0.4}px`, fontWeight: 900, fontFamily: "'Inter',sans-serif" }}>
          {firstName ? firstName.charAt(0).toUpperCase() : "?"}
        </div>
      }
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Inter',sans-serif;background:${bg};color:${text1};overflow:hidden;transition:background 0.3s,color 0.3s;}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;}
        @keyframes spin           {to{transform:rotate(360deg);}}
        @keyframes popIn          {from{opacity:0;transform:scale(0.88) translateY(20px);}to{opacity:1;transform:scale(1) translateY(0);}}
        @keyframes fadeUp         {from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        @keyframes slideDown      {from{opacity:0;transform:translateY(-8px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes skeletonPulse  {0%,100%{opacity:1;}50%{opacity:0.5;}}
        @keyframes skeletonShimmer{0%{transform:translateX(-100%);}100%{transform:translateX(200%);}}
        @keyframes searchSlide    {from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}

        /* ── Layout ── */
        .dash-root{display:flex;height:100vh;overflow:hidden;}

        /* ── Sidebar ── */
        .sidebar{width:260px;min-width:260px;height:100vh;background:${sidebar};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-right:1px solid ${bdr};display:flex;flex-direction:column;padding:24px 20px;z-index:20;transition:width 0.3s ease,min-width 0.3s ease;}
        .sidebar.collapsed{width:72px;min-width:72px;}
        .sidebar.collapsed .sl{display:none;}
        .sidebar-logo{display:flex;align-items:center;gap:12px;margin-bottom:40px;padding:0 4px;}
        .brand-text h1{font-size:1.15rem;font-weight:900;letter-spacing:-0.04em;line-height:1;color:${text1};}
        .brand-text p{font-size:10px;font-weight:800;color:#00AA00;text-transform:uppercase;letter-spacing:0.12em;margin-top:2px;}
        .nav-link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9999px;text-decoration:none;font-size:13px;font-weight:700;color:${text2};transition:all 0.2s ease;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:'Inter',sans-serif;}
        .nav-link:hover{background:rgba(0,200,0,0.08);color:${text1};}
        .nav-link.active{background:#00FF00;color:#0f172a;box-shadow:0 6px 20px rgba(0,255,0,0.3);}
        .nav-link.active .ms{color:#0f172a;}
        .nav-link.danger{color:#f87171;}
        .nav-link.danger:hover{background:rgba(248,113,113,0.1);}

        /* ── Main area ── */
        .dash-main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;}

        /* ── Desktop header ── */
        .dash-header{height:72px;background:${header};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 32px;display:flex;align-items:center;justify-content:space-between;z-index:10;flex-shrink:0;}
        .search-box{display:flex;align-items:center;gap:8px;background:${inputBg};border:1px solid ${bdr};border-radius:9999px;padding:10px 18px;max-width:380px;flex:1;transition:border-color 0.2s,box-shadow 0.2s;}
        .search-box:focus-within{border-color:rgba(0,255,0,0.4);box-shadow:0 0 0 3px rgba(0,255,0,0.08);}
        .search-box input{background:transparent;border:none;outline:none;font-size:13px;font-family:'Inter',sans-serif;color:${text1};flex:1;}
        .search-box input::placeholder{color:${text3};}

        /* ── Mobile header — shown only on mobile ── */
        .mob-header{
          display:none;
          height:64px;
          background:${header};
          backdrop-filter:blur(12px);
          -webkit-backdrop-filter:blur(12px);
          border-bottom:1px solid ${bdr};
          padding:0 16px;
          align-items:center;
          justify-content:space-between;
          z-index:10;
          flex-shrink:0;
          gap:10px;
        }
        .mob-search-bar{
          display:flex;align-items:center;gap:8px;
          background:${inputBg};border:1px solid ${bdr};border-radius:9999px;
          padding:8px 14px;flex:1;
          transition:border-color 0.2s,box-shadow 0.2s;
        }
        .mob-search-bar:focus-within{border-color:rgba(0,255,0,0.4);box-shadow:0 0 0 3px rgba(0,255,0,0.08);}
        .mob-search-bar input{background:transparent;border:none;outline:none;font-size:13px;font-family:'Inter',sans-serif;color:${text1};flex:1;width:100%;}
        .mob-search-bar input::placeholder{color:${text3};}

        /* ── Content ── */
        .dash-content{flex:1;display:flex;overflow:hidden;}
        .dash-scroll{flex:1;overflow-y:auto;padding:32px;display:flex;flex-direction:column;gap:40px;}
        .dash-scroll::-webkit-scrollbar{width:4px;}
        .dash-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}
        .right-panel{width:300px;min-width:300px;border-left:1px solid ${bdr};overflow-y:auto;padding:32px 24px;display:flex;flex-direction:column;gap:36px;background:${rightBg};}
        .right-panel::-webkit-scrollbar{width:4px;}
        .right-panel::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);}
        .note-card{background:${card};padding:20px;border-radius:18px;border:1px solid ${bdr};display:flex;gap:20px;transition:box-shadow 0.2s;}
        .note-card:hover{box-shadow:${isDark ? "0 8px 28px rgba(0,255,0,0.1)" : "0 8px 28px rgba(0,200,0,0.12)"};}
        .note-icon-box{width:100px;min-width:100px;height:100px;border-radius:14px;background:linear-gradient(135deg,rgba(0,255,0,0.18),rgba(0,255,0,0.05));display:flex;align-items:center;justify-content:center;}
        .empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:12px;opacity:0.5;}
        .analytics-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
        .analytics-modal-overlay{position:fixed;inset:0;background:rgba(2,6,12,0.58);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;z-index:600;}
        .analytics-modal{width:min(760px,100%);max-height:min(86vh,760px);overflow:auto;background:${card};border:1px solid ${bdr};border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,0.35);padding:18px;}
        .analytics-radar-wrap{background:${isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"};border:1px solid ${bdr};border-radius:12px;padding:12px;overflow:auto;}

        /* ── Mobile bottom nav ── */
        .mob-nav{
          display:none;
          position:fixed;
          bottom:20px;
          left:50%;
          transform:translateX(-50%);
          z-index:300;
          background:${isDark ? "rgba(14,20,36,0.95)" : "rgba(255,255,255,0.92)"};
          backdrop-filter:blur(28px);
          -webkit-backdrop-filter:blur(28px);
          border:1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)"};
          border-radius:9999px;
          padding:8px 24px;
          align-items:center;
          gap:6px;
          box-shadow:0 12px 48px rgba(0,0,0,0.22), 0 2px 10px rgba(0,0,0,0.12);
          min-width:340px;
        }
        .mob-tab{
          width:54px;height:54px;
          border-radius:9999px;
          display:flex;align-items:center;justify-content:center;
          background:none;border:none;cursor:pointer;
          font-family:'Inter',sans-serif;
          -webkit-tap-highlight-color:transparent;
          transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background 0.18s;
          flex-shrink:0;
        }
        .mob-tab:active{transform:scale(0.80);}
        .mob-tab .ms{
          font-size:22px;
          color:${isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.32)"};
          transition:color 0.18s;
        }
        .mob-tab.active{
          background:#00FF00;
          box-shadow:0 4px 22px rgba(0,255,0,0.55);
          transform:scale(1.12);
        }
        .mob-tab.active .ms{color:#0a1a0a;}
        .mob-tab.danger .ms{color:#f87171;}

        /* ── Responsive ── */
        @media(max-width:1200px){.right-panel{display:none;}}
        @media(max-width:768px){
          .sidebar{display:none!important;}
          .dash-header{display:none!important;}
          .mob-header{display:flex!important;}
          .mob-nav{display:flex!important;}
          .dash-scroll{padding:20px 16px 110px;}
          .analytics-grid{grid-template-columns:1fr;}
          .analytics-modal-overlay{align-items:flex-end;padding:0;}
          .analytics-modal{width:100%;max-height:88vh;border-radius:22px 22px 0 0;padding:16px 14px 24px;}
        }
      `}</style>

      {/* iOS Notification Toasts */}
      {showIOSNotifs && authUser && (
        <IOSNotifToasts uid={authUser.uid} isDark={isDark} onDone={() => setShowIOSNotifs(false)} />
      )}

      {/* Greeting popup */}
      {showGreeting && (
        <GreetingPopup isDark={isDark} firstName={firstName} onClose={() => setShowGreeting(false)} />
      )}

      {showBranch && authUser && (
        <BranchPopup uid={authUser.uid} isDark={isDark} // In BranchPopup usage — update the onComplete handler:
          onComplete={({ branch: b, se: s }) => {
            setUserData(prev => ({ ...prev, branch: b, sem: s }));
            setShowBranch(false);
          }} />
      )}

      <div className="dash-root">

        {/* ── Sidebar (desktop) ── */}
        <aside className={`sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div className="sidebar-logo">
            <div style={{ width: "40px", height: "40px", background: "#00FF00", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 16px rgba(0,255,0,0.35)" }}>
              <span className="ms" style={{ color: "#0f172a", fontSize: "22px" }}>school</span>
            </div>
            <div className="brand-text sl">
              <h1>StudyBuddy</h1>
              <p>Engineering AI</p>
            </div>
          </div>
          <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            {navItems.slice(0, 4).map(({ id, icon, label }) => (
              <button key={id} className={`nav-link${activePage === id ? " active" : ""}`} onClick={() => router.push(`/${id}`)}>
                <span className="ms" style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}
            <div style={{ padding: "16px 4px 8px", fontSize: "10px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.12em" }} className="sl">Account</div>
            {navItems.slice(4).map(({ id, icon, label }) => (
              <button key={id} className={`nav-link${activePage === id ? " active" : ""}`} onClick={() => router.push(`/${id}`)}>
                <span className="ms" style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}
            <button className="nav-link danger" onClick={() => logoutAndClearCache(auth).then(() => router.replace("/"))}>
              <span className="ms" style={{ fontSize: "20px", flexShrink: 0 }}>logout</span>
              <span className="sl">Sign Out</span>
            </button>
          </nav>
        </aside>

        {/* ── Main ── */}
        <main className="dash-main">

          {/* Desktop header */}
          <header className="dash-header">
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
              <button onClick={() => setSidebarOpen(s => !s)}
                style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)", border: "none", borderRadius: "9999px", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,200,0,0.14)"}
                onMouseLeave={e => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)"}>
                <span className="ms" style={{ fontSize: "20px", color: text2 }}>menu</span>
              </button>
              <div className="search-box">
                <span className="ms" style={{ fontSize: "18px", color: text3 }}>search</span>
                <input placeholder="Search notes, formulas, or topics…" type="text" />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "24px" }}>
              <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />
              {/* Notif button */}
              <div style={{ position: "relative" }}>
                <button ref={notifBtn} onClick={() => { setShowNotifs(s => !s); if (!showIOSNotifs) setShowIOSNotifs(true); }}
                  style={{ width: "40px", height: "40px", borderRadius: "9999px", background: showNotifs ? (isDark ? "rgba(0,255,0,0.12)" : "rgba(0,200,0,0.1)") : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)"), border: showNotifs ? "1px solid rgba(0,255,0,0.3)" : "1px solid transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative", transition: "all 0.2s" }}
                  onMouseEnter={e => { if (!showNotifs) e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,200,0,0.14)"; }}
                  onMouseLeave={e => { if (!showNotifs) e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)"; }}>
                  <span className="ms" style={{ fontSize: "22px", color: showNotifs ? "#00AA00" : text2 }}>notifications</span>
                  <span style={{ position: "absolute", top: "9px", right: "9px", width: "8px", height: "8px", background: "#00FF00", borderRadius: "9999px", border: `2px solid ${bg}`, boxShadow: "0 0 6px rgba(0,255,0,0.7)" }} />
                </button>
                {showNotifs && (
                  <div ref={notifRef} style={{ position: "absolute", top: "calc(100% + 12px)", right: 0, width: "280px", background: isDark ? "rgba(8,14,26,0.98)" : "rgba(255,255,255,0.98)", border: `1px solid ${bdr}`, borderRadius: "18px", boxShadow: "0 24px 60px rgba(0,0,0,0.25)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", zIndex: 500, overflow: "hidden", animation: "slideDown 0.22s cubic-bezier(0.34,1.56,0.64,1)", padding: "18px" }}>
                    <p style={{ fontSize: "13px", fontWeight: 900, color: text1, margin: "0 0 8px", fontFamily: "'Inter',sans-serif" }}>Notifications</p>
                    <p style={{ fontSize: "12px", color: text2, margin: "0 0 14px", lineHeight: 1.5, fontFamily: "'Inter',sans-serif" }}>Nothing to Show</p>
                    <button onClick={() => { setShowNotifs(false); setShowIOSNotifs(true); }} style={{ width: "100%", padding: "9px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.25)", borderRadius: "10px", fontSize: "12px", fontWeight: 800, color: "#009900", cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>GOT IT</button>
                  </div>
                )}
              </div>
              <div style={{ width: "1px", height: "32px", background: bdr }} />
              <div style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "12px", fontWeight: 800, color: text1, lineHeight: 1, margin: 0 }}>{fullName || "—"}</p>
                  <p style={{ fontSize: "10px", color: text3, fontWeight: 600, marginTop: "2px", margin: 0 }}>{branch || "No branch set"} · TCET</p>
                </div>
                <AvatarEl size={40} />
              </div>
            </div>
          </header>

          {/* ── Mobile header ── */}
          <header className="mob-header">
            {/* Left: logo mark */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <div style={{ width: "34px", height: "34px", background: "#00FF00", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(0,255,0,0.4)", flexShrink: 0 }}>
                <span className="ms" style={{ color: "#0f172a", fontSize: "18px" }}>school</span>
              </div>
            </div>

            {/* Centre: search bar — always visible */}
            <div className="mob-search-bar" style={{ flex: 1 }}>
              <span className="ms" style={{ fontSize: "16px", color: text3, flexShrink: 0 }}>search</span>
              <input placeholder="Search…" type="text" />
            </div>

            {/* Right: notif + avatar */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              {/* Notif bell */}
              <button onClick={() => { if (!showIOSNotifs) setShowIOSNotifs(true); }}
                style={{ width: "36px", height: "36px", borderRadius: "9999px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative", flexShrink: 0 }}>
                <span className="ms" style={{ fontSize: "20px", color: text2 }}>notifications</span>
                <span style={{ position: "absolute", top: "7px", right: "7px", width: "7px", height: "7px", background: "#00FF00", borderRadius: "9999px", border: `2px solid ${bg}`, boxShadow: "0 0 5px rgba(0,255,0,0.8)" }} />
              </button>
              {/* Avatar → goes to profile */}
              <button onClick={() => setActivePage("profile")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}>
                <AvatarEl size={36} />
              </button>
            </div>
          </header>

          <div className="dash-content">
            <div className="dash-scroll">
              {renderPage()}
            </div>
          </div>
        </main>
      </div>

      {showAnalytics && (
        <div className="analytics-modal-overlay" onClick={() => setShowAnalytics(false)}>
          <div className="analytics-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
              <div>
                <h4 style={{ fontSize: "15px", fontWeight: 800, color: text1, margin: "0 0 3px" }}>AI Analytics</h4>
                <p style={{ fontSize: "11px", color: text3, margin: 0 }}>
                  Asked: {formatCompactNumber(askedByLevel.total)} · Weak: {formatCompactNumber(weakByLevel.total)}
                </p>
              </div>
              <button
                onClick={() => setShowAnalytics(false)}
                style={{ width: "34px", height: "34px", borderRadius: "9999px", border: `1px solid ${bdr}`, background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <span className="ms" style={{ fontSize: "18px", color: text2 }}>close</span>
              </button>
            </div>

            {!hasAiAnalytics ? (
              <p style={{ fontSize: "12px", color: text2, margin: 0 }}>No AI analytics available yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="analytics-radar-wrap">
                  <svg width={radarModel.size} height={radarModel.size} viewBox={`0 0 ${radarModel.size} ${radarModel.size}`} style={{ display: "block", margin: "0 auto" }}>
                    {radarModel.gridPolygons.map((points, i) => (
                      <polygon key={`grid-modal-${i}`} points={points} fill="none" stroke={isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"} strokeWidth="1" />
                    ))}

                    {radarModel.axisLines.map((line, i) => (
                      <line key={`axis-modal-${i}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"} strokeWidth="1" />
                    ))}

                    <polygon points={radarModel.askedPolygon} fill="rgba(0,255,0,0.22)" stroke="#00FF00" strokeWidth="2" />
                    <polygon points={radarModel.weakPolygon} fill="rgba(59,130,246,0.20)" stroke="#3b82f6" strokeWidth="2" />

                    {radarModel.askedPoints.map(({ level, value, x, y }) => (
                      <circle key={`asked-point-${level}`} cx={x} cy={y} r="4" fill="#00FF00" stroke={isDark ? "#0f172a" : "#ffffff"} strokeWidth="1.5" style={{ cursor: "pointer" }}>
                        <title>{`${level} · Asked: ${formatCompactNumber(value)} (${value})`}</title>
                      </circle>
                    ))}

                    {radarModel.weakPoints.map(({ level, value, x, y }) => (
                      <circle key={`weak-point-${level}`} cx={x} cy={y} r="4" fill="#3b82f6" stroke={isDark ? "#0f172a" : "#ffffff"} strokeWidth="1.5" style={{ cursor: "pointer" }}>
                        <title>{`${level} · Weak: ${formatCompactNumber(value)} (${value})`}</title>
                      </circle>
                    ))}

                    {radarModel.labelPoints.map(({ label, x, y }) => (
                      <text key={`label-modal-${label}`} x={x} y={y} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: "10px", fill: isDark ? "#94a3b8" : "#475569", fontWeight: 700 }}>
                        {label}
                      </text>
                    ))}
                  </svg>
                </div>

                <div className="analytics-grid" style={{ gap: "10px" }}>
                  <div style={{ background: isDark ? "rgba(0,255,0,0.06)" : "rgba(0,200,0,0.08)", border: `1px solid ${bdr}`, borderRadius: "10px", padding: "10px" }}>
                    <p style={{ fontSize: "10px", fontWeight: 800, color: "#00AA00", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Asked</p>
                    <p style={{ fontSize: "14px", fontWeight: 900, color: text1, margin: 0 }}>{formatCompactNumber(askedByLevel.total)}</p>
                  </div>
                  <div style={{ background: isDark ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.10)", border: `1px solid ${bdr}`, borderRadius: "10px", padding: "10px" }}>
                    <p style={{ fontSize: "10px", fontWeight: 800, color: "#3b82f6", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Weak</p>
                    <p style={{ fontSize: "14px", fontWeight: 900, color: text1, margin: 0 }}>{formatCompactNumber(weakByLevel.total)}</p>
                  </div>
                </div>

                <div style={{ background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${bdr}`, borderRadius: "12px", padding: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", gap: "10px", flexWrap: "wrap" }}>
                    <p style={{ fontSize: "11px", fontWeight: 800, color: text2, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>AI Improvement Points</p>
                    <button
                      onClick={generateAnalyticsInsights}
                      disabled={aiInsightsLoading}
                      style={{ padding: "6px 10px", borderRadius: "9999px", border: `1px solid ${bdr}`, background: aiInsightsLoading ? (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)") : "rgba(0,200,0,0.08)", color: aiInsightsLoading ? text3 : "#00AA00", fontSize: "10px", fontWeight: 800, cursor: aiInsightsLoading ? "not-allowed" : "pointer", fontFamily: "'Inter',sans-serif" }}
                    >
                      {aiInsightsLoading ? "Analyzing..." : (aiInsights.length ? "Regenerate AI" : "Generate AI")}
                    </button>
                  </div>

                  {aiInsightsError && (
                    <p style={{ fontSize: "11px", color: "#ef4444", margin: "0 0 8px" }}>{aiInsightsError}</p>
                  )}

                  {!aiInsights.length && !aiInsightsLoading ? (
                    <p style={{ fontSize: "12px", color: text2, margin: 0 }}>No insights yet. Tap Refresh AI to analyze.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "6px" }}>
                      {aiInsights.map((point, idx) => (
                        <li key={`${idx}-${point.slice(0, 10)}`} style={{ fontSize: "12px", color: text1, lineHeight: 1.5 }}>
                          {point}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ MOBILE BOTTOM NAV ══ */}
      <nav className="mob-nav">
        {navItems.slice(0, 4).map(({ id, icon }) => (
          <button key={id} className={`mob-tab${activePage === id ? " active" : ""}`} onClick={() => router.push(`/${id}`)}>
            <span className="ms">{icon}</span>
          </button>
        ))}
        {/* Profile */}
        <button className={`mob-tab${activePage === "profile" ? " active" : ""}`} onClick={() => setActivePage("profile")}>
          <span className="ms">person</span>
        </button>
      </nav>
    </>
  );
}