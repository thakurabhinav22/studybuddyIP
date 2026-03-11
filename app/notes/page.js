"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, get } from "firebase/database";  // ← added get

/* ─────────────────────────────────────────
   THEME HOOK
───────────────────────────────────────── */
function useTheme() {
  const KEY = "studybuddy_theme";
  const [theme, setThemeState] = useState("system");
  const [resolved, setResolved] = useState("light");

  useEffect(() => {
    try { setThemeState(localStorage.getItem(KEY) || "system"); } catch {}
  }, []);

  const setTheme = (val) => {
    try { localStorage.setItem(KEY, val); } catch {}
    setThemeState(val);
  };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);

  return { theme, setTheme, resolved };
}

/* ─────────────────────────────────────────
   THEME SWITCHER
───────────────────────────────────────── */
function ThemeSwitcher({ theme, setTheme, resolved }) {
  const isDark = resolved === "dark";
  const [hovered, setHovered] = useState(null);
  const opts = [
    { value: "light",  icon: "light_mode",     label: "Light"  },
    { value: "dark",   icon: "dark_mode",       label: "Dark"   },
    { value: "system", icon: "desktop_windows", label: "System" },
  ];
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "2px", padding: "4px", borderRadius: "9999px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}` }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <div key={value} style={{ position: "relative" }}>
            <button
              onClick={() => setTheme(value)}
              onMouseEnter={() => setHovered(value)}
              onMouseLeave={() => setHovered(null)}
              style={{ width: "32px", height: "32px", borderRadius: "9999px", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.22s cubic-bezier(0.34,1.56,0.64,1)", background: active ? (isDark ? "rgba(0,255,0,0.18)" : "#00FF00") : "transparent", boxShadow: active ? (isDark ? "0 0 14px rgba(0,255,0,0.3)" : "0 4px 12px rgba(0,255,0,0.35)") : "none", transform: active ? "scale(1.08)" : "scale(1)" }}
            >
              <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "16px", lineHeight: 1, color: active ? (isDark ? "#00FF00" : "#0f172a") : (isDark ? "#475569" : "#94a3b8") }}>{icon}</span>
            </button>
            {hovered === value && (
              <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: isDark ? "#1e293b" : "#0f172a", color: "#fff", fontSize: "10px", fontWeight: 700, padding: "4px 8px", borderRadius: "6px", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 100 }}>
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

/* ─────────────────────────────────────────
   SKELETON
───────────────────────────────────────── */
function Skeleton({ w = "100%", h = "20px", r = "8px", isDark }) {
  return (
    <div style={{ width: w, height: h, borderRadius: r, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", animation: "skeletonPulse 1.6s ease-in-out infinite", overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, background: isDark ? "linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.06) 50%,transparent 100%)" : "linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.7) 50%,transparent 100%)", animation: "skeletonShimmer 1.6s ease-in-out infinite" }} />
    </div>
  );
}

/* ─────────────────────────────────────────
   ICON MAP
───────────────────────────────────────── */
const SUBJECT_ICON_MAP = {
  CN:      { icon: "router",       color: "#3b82f6" },
  COA:     { icon: "memory",       color: "#8b5cf6" },
  MATHS3:  { icon: "functions",    color: "#00FF00" },
  MATHS:   { icon: "functions",    color: "#00FF00" },
  NOSQL:   { icon: "database",     color: "#f59e0b" },
  MONOGPDB:{ icon: "database",     color: "#f59e0b" },
  DSA:     { icon: "account_tree", color: "#ec4899" },
  OS:      { icon: "terminal",     color: "#14b8a6" },
  DBMS:    { icon: "storage",      color: "#f97316" },
  DEFAULT: { icon: "description",  color: "#64748b" },
};
function getSubjectMeta(code) {
  return SUBJECT_ICON_MAP[code] || SUBJECT_ICON_MAP.DEFAULT;
}

/* ─────────────────────────────────────────
   NAV ITEMS
───────────────────────────────────────── */
const NAV_ITEMS = [
  { id: "dashboard", icon: "dashboard",   label: "Dashboard",  href: "/dashboard" },
  { id: "notes",     icon: "description", label: "Notes",      href: "/notes"     },
  { id: "test",      icon: "quiz",        label: "Test",       href: "/test"      },
  { id: "ai",        icon: "psychology",  label: "Neural AI",  href: "/ai"        },
  { id: "profile",   icon: "person",      label: "Profile",    href: "/profile"   },
  { id: "settings",  icon: "settings",    label: "Settings",   href: "/settings"  },
];

/* ═══════════════════════════════════════════
   MAIN PAGE COMPONENT
═══════════════════════════════════════════ */
export default function NotesPage() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [authUser,    setAuthUser]    = useState(null);
  const [userData,    setUserData]    = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [subjects,     setSubjects]     = useState({});
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError,   setNotesError]   = useState(null);

  const [activeSubject, setActiveSubject] = useState(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);
  const [search,        setSearch]        = useState("");
  const [hoveredFile,   setHoveredFile]   = useState(null);
  const [dlAnim,        setDlAnim]        = useState(null);

  /* ── NEW: track which modules have chunked PDFs ── */
  const [chunkedModules, setChunkedModules] = useState({}); // { module1: true, ... }

  /* ── Auth guard ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) { router.replace("/"); return; }
      setAuthUser(firebaseUser);
      const userRef = ref(db, `users/${firebaseUser.uid}`);
      const unsubDB = onValue(userRef, (snap) => {
        if (snap.exists()) setUserData(snap.val());
        setAuthLoading(false);
      });
      return () => unsubDB();
    });
    return () => unsub();
  }, [router]);

  /* ── Fetch subjects ── */
  useEffect(() => {
    if (!userData?.branch || !userData?.sem) return;
    const { branch, sem } = userData;

    const normaliseSem = (raw) => {
      const str = raw.toString().trim();
      if (/^Sem:\d+$/.test(str)) return str;
      const num = str.replace(/[^0-9]/g, "");
      if (!num) return str;
      return `Sem:${num}`;
    };

    const semKey = normaliseSem(sem);
    const subjectsRef = ref(db, `notes/${branch}/${semKey}/subjects`);
    setNotesLoading(true);
    setNotesError(null);

    const unsubNotes = onValue(
      subjectsRef,
      (snap) => {
        setNotesLoading(false);
        if (!snap.exists()) { setSubjects({}); setActiveSubject(null); return; }
        const raw = snap.val();
        const normalised = {};
        Object.entries(raw).forEach(([code, val]) => {
          if (val === true) normalised[code] = { Subject: code, Totalmodules: 0, modules: {} };
          else if (typeof val === "object" && val !== null) normalised[code] = val;
        });
        setSubjects(normalised);
        const firstCode = Object.keys(normalised)[0] || null;
        setActiveSubject((prev) => prev && normalised[prev] ? prev : firstCode);
      },
      (err) => { setNotesLoading(false); setNotesError(err.message); }
    );
    return () => unsubNotes();
  }, [userData?.branch, userData?.sem]);

  /* ── NEW: When active subject changes, check which modules have pdfMeta (chunked) ── */
  useEffect(() => {
    if (!activeSubject || !userData?.branch || !userData?.sem) return;
    const { branch, sem } = userData;
    const normaliseSem = (raw) => {
      const str = raw.toString().trim();
      if (/^Sem:\d+$/.test(str)) return str;
      const num = str.replace(/[^0-9]/g, "");
      return num ? `Sem:${num}` : str;
    };
    const semKey = normaliseSem(sem);
    const modulesData = subjects[activeSubject]?.modules || {};

    // Check each module for pdfMeta existence
    const checks = Object.keys(modulesData).map(async (modKey) => {
      const metaRef = ref(db, `notes/${branch}/${semKey}/subjects/${activeSubject}/modules/${modKey}/pdfMeta`);
      const snap = await get(metaRef);
      return [modKey, snap.exists()];
    });

    Promise.all(checks).then((results) => {
      const map = {};
      results.forEach(([key, hasChunks]) => { map[key] = hasChunks; });
      setChunkedModules(map);
    });
  }, [activeSubject, subjects, userData?.branch, userData?.sem]);

  /* ── Derived values ── */
  const bg      = isDark ? "#080f1a"                 : "#f5f8f5";
  const sidebar  = isDark ? "rgba(8,15,26,0.96)"     : "rgba(255,255,255,0.75)";
  const header   = isDark ? "rgba(8,15,26,0.92)"     : "rgba(255,255,255,0.75)";
  const card     = isDark ? "rgba(15,23,42,0.85)"    : "#ffffff";
  const text1    = isDark ? "#f1f5f9"                : "#0f172a";
  const text2    = isDark ? "#94a3b8"                : "#475569";
  const text3    = isDark ? "#475569"                : "#94a3b8";
  const bdr      = isDark ? "rgba(0,255,0,0.1)"      : "rgba(0,200,0,0.1)";
  const inputBg  = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,200,0,0.05)";

  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";
  const fullName  = userData?.fullName  || authUser?.displayName || "";
  const photoURL  = userData?.photoURL  || authUser?.photoURL    || "";
  const branch    = userData?.branch    || "";
  const sem       = userData?.sem       || "";

  const activeSubjectData = activeSubject ? subjects[activeSubject] : null;
  const allModules = activeSubjectData?.modules
    ? Object.entries(activeSubjectData.modules).map(([key, mod]) => ({ key, ...mod }))
    : [];
  const filteredModules = search.trim()
    ? allModules.filter((m) => (m.Title || "").toLowerCase().includes(search.toLowerCase()))
    : allModules;

  const handleDownload = (idx) => {
    setDlAnim(idx);
    setTimeout(() => setDlAnim(null), 1200);
  };

  /* ── NEW: Open PDF — routes to viewer if chunked, else opens URL ── */
  const handleOpenPDF = (mod) => {
    const isChunked = chunkedModules[mod.key];
    const normaliseSem = (raw) => {
      const str = raw.toString().trim();
      if (/^Sem:\d+$/.test(str)) return str;
      const num = str.replace(/[^0-9]/g, "");
      return num ? `Sem:${num}` : str;
    };
    const semKey = normaliseSem(sem);

    if (isChunked) {
      // Route to our custom PDF viewer
      router.push(
        `/pdfviewer?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(semKey)}&subject=${encodeURIComponent(activeSubject)}&module=${encodeURIComponent(mod.key)}`
      );
    } else if (mod.resourcesPDF) {
      // Fallback: open external URL
      window.open(mod.resourcesPDF, "_blank");
    }
  };

  /* ── NEW: Download PDF — reassemble from chunks if chunked ── */
  const handleDownloadPDF = async (mod, idx) => {
    const isChunked = chunkedModules[mod.key];
    if (isChunked) {
      handleDownload(idx);
      try {
        const normaliseSem = (raw) => {
          const str = raw.toString().trim();
          if (/^Sem:\d+$/.test(str)) return str;
          const num = str.replace(/[^0-9]/g, "");
          return num ? `Sem:${num}` : str;
        };
        const semKey = normaliseSem(sem);
        const basePath = `notes/${branch}/${semKey}/subjects/${activeSubject}/modules/${mod.key}`;
        const metaSnap = await get(ref(db, `${basePath}/pdfMeta`));
        if (!metaSnap.exists()) return;
        const { totalChunks, fileName } = metaSnap.val();
        const chunks = [];
        for (let i = 0; i < totalChunks; i++) {
          const s = await get(ref(db, `${basePath}/pdfChunks/chunk_${i}`));
          if (s.exists()) chunks.push(s.val());
        }
        const base64 = chunks.join("");
        const binary = atob(base64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = fileName || `${mod.Title || mod.key}.pdf`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } catch (err) { console.error("Download failed:", err); }
    } else if (mod.resourcesPDF) {
      handleDownload(idx);
      const a = document.createElement("a");
      a.href = mod.resourcesPDF;
      a.download = `${mod.Title || mod.key}.pdf`;
      a.target = "_blank";
      a.click();
    }
  };

  const AvatarEl = ({ size = 40 }) => (
    <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: "9999px", border: "2.5px solid #00FF00", overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0", flexShrink: 0 }}>
      {photoURL
        ? <img src={photoURL} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontSize: `${size * 0.4}px`, fontWeight: 900, fontFamily: "'Lexend',sans-serif" }}>
            {firstName ? firstName.charAt(0).toUpperCase() : "?"}
          </div>
      }
    </div>
  );

  if (authLoading) return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Lexend',sans-serif;background:${bg};overflow:hidden;}
        @keyframes skeletonPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        @keyframes skeletonShimmer{0%{transform:translateX(-100%);}100%{transform:translateX(200%);}}
      `}</style>
      <div style={{ display: "flex", height: "100vh", background: bg }}>
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
            <Skeleton w="360px" h="40px" r="9999px" isDark={isDark} />
            <div style={{ marginLeft: "auto", display: "flex", gap: "12px" }}>
              <Skeleton w="120px" h="36px" r="9999px" isDark={isDark} />
              <Skeleton w="40px" h="40px" r="9999px" isDark={isDark} />
            </div>
          </div>
          <div style={{ flex: 1, padding: "32px", display: "flex", flexDirection: "column", gap: "32px" }}>
            <Skeleton w="240px" h="32px" r="8px" isDark={isDark} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px" }}>
              {[...Array(4)].map((_, i) => <Skeleton key={i} w="100%" h="160px" r="20px" isDark={isDark} />)}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;}
        body{font-family:'Lexend',sans-serif;background:${bg};color:${text1};overflow:hidden;transition:background 0.3s,color 0.3s;}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes dlPulse{0%{transform:scale(1);}40%{transform:scale(0.82);}80%{transform:scale(1.12);}100%{transform:scale(1);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes skeletonPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        @keyframes skeletonShimmer{0%{transform:translateX(-100%);}100%{transform:translateX(200%);}}
        .sb-root{display:flex;height:100vh;overflow:hidden;background:${bg};}
        .sb-sidebar{width:260px;min-width:260px;height:100vh;background:${sidebar};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-right:1px solid ${bdr};display:flex;flex-direction:column;padding:24px 20px;z-index:20;transition:width 0.3s ease,min-width 0.3s ease;}
        .sb-sidebar.collapsed{width:72px;min-width:72px;}
        .sb-sidebar.collapsed .sl{display:none;}
        .nav-link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9999px;font-size:13px;font-weight:600;color:${text2};transition:all 0.2s ease;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:'Lexend',sans-serif;text-decoration:none;}
        .nav-link:hover{background:rgba(0,200,0,0.08);color:${text1};}
        .nav-link.active{background:#00FF00;color:#0f172a;box-shadow:0 6px 20px rgba(0,255,0,0.28);}
        .nav-link.active .ms{color:#0f172a;}
        .nav-link.danger{color:#f87171;}
        .nav-link.danger:hover{background:rgba(248,113,113,0.1);}
        .sb-main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
        .sb-header{height:72px;background:${header};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 32px;display:flex;align-items:center;justify-content:space-between;z-index:10;flex-shrink:0;}
        .search-box{display:flex;align-items:center;gap:8px;background:${inputBg};border:1px solid ${bdr};border-radius:9999px;padding:10px 18px;max-width:380px;flex:1;transition:border-color 0.2s,box-shadow 0.2s;}
        .search-box:focus-within{border-color:rgba(0,255,0,0.4);box-shadow:0 0 0 3px rgba(0,255,0,0.08);}
        .search-box input{background:transparent;border:none;outline:none;font-size:13px;font-family:'Lexend',sans-serif;color:${text1};flex:1;}
        .search-box input::placeholder{color:${text3};}
        .mob-header{display:none;height:64px;background:${header};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 16px;align-items:center;justify-content:space-between;gap:10px;z-index:10;flex-shrink:0;}
        .mob-search{display:flex;align-items:center;gap:8px;background:${inputBg};border:1px solid ${bdr};border-radius:9999px;padding:8px 14px;flex:1;transition:border-color 0.2s;}
        .mob-search:focus-within{border-color:rgba(0,255,0,0.4);}
        .mob-search input{background:transparent;border:none;outline:none;font-size:13px;font-family:'Lexend',sans-serif;color:${text1};flex:1;width:100%;}
        .mob-search input::placeholder{color:${text3};}
        .sb-scroll{flex:1;overflow-y:auto;padding:32px;display:flex;flex-direction:column;gap:36px;}
        .sb-scroll::-webkit-scrollbar{width:4px;}
        .sb-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}
        .subject-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;}
        .subject-card{background:${card};padding:24px 20px;border-radius:20px;border:2px solid ${bdr};cursor:pointer;transition:all 0.22s cubic-bezier(0.34,1.56,0.64,1);display:flex;flex-direction:column;gap:12px;animation:fadeUp 0.35s ease both;}
        .subject-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,255,0,0.1);}
        .subject-card.active{border-color:#00FF00;box-shadow:0 0 0 3px rgba(0,255,0,0.12),0 12px 32px rgba(0,255,0,0.1);}
        .module-row{background:${card};padding:14px 18px;border-radius:16px;border:1px solid ${bdr};display:flex;align-items:center;justify-content:space-between;gap:16px;transition:all 0.2s ease;animation:fadeUp 0.3s ease both;}
        .module-row:hover{background:${isDark?"rgba(0,255,0,0.03)":"rgba(0,200,0,0.04)"};border-color:rgba(0,255,0,0.22);}
        .module-title{font-size:13px;font-weight:600;color:${text1};margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px;}
        .module-meta{font-size:11px;color:${text3};margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
        .module-meta span{font-weight:600;color:${text2};}
        .dot{width:3px;height:3px;border-radius:9999px;background:${text3};display:inline-block;flex-shrink:0;}

        /* ── UPDATED button styles ── */
        .btn-open{
          display:flex;align-items:center;gap:6px;
          padding:8px 16px;font-size:12px;font-weight:700;
          color:#ffffff;
          background:#0f172a;
          border:none;border-radius:10px;
          cursor:pointer;font-family:'Lexend',sans-serif;
          transition:all 0.18s;white-space:nowrap;
        }
        .btn-open:hover{background:#00FF00;color:#0f172a;}
        .btn-open:disabled{opacity:0.35;cursor:not-allowed;}
        .btn-dl{display:flex;align-items:center;gap:6px;padding:8px 16px;font-size:12px;font-weight:700;color:${isDark?"#f1f5f9":"#ffffff"};background:${isDark?"rgba(255,255,255,0.08)":"#334155"};border:none;border-radius:10px;cursor:pointer;font-family:'Lexend',sans-serif;transition:background 0.2s,color 0.2s;white-space:nowrap;}
        .btn-dl:hover{background:#00FF00!important;color:#0f172a!important;}
        .btn-dl.done{background:rgba(0,200,0,0.12)!important;color:#00AA00!important;animation:dlPulse 0.5s ease;}
        .btn-dl:disabled{opacity:0.35;cursor:not-allowed;}

        /* ── chunked badge ── */
        .badge-chunked{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(0,200,0,0.1);border:1px solid rgba(0,200,0,0.25);border-radius:9999px;font-size:10px;font-weight:700;color:#009900;}

        .mob-nav{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:300;background:${isDark?"rgba(14,20,36,0.95)":"rgba(255,255,255,0.92)"};backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid ${isDark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.07)"};border-radius:9999px;padding:8px 20px;align-items:center;gap:4px;box-shadow:0 12px 48px rgba(0,0,0,0.22),0 2px 10px rgba(0,0,0,0.12);min-width:320px;}
        .mob-tab{width:52px;height:52px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1),background 0.18s;flex-shrink:0;}
        .mob-tab:active{transform:scale(0.8);}
        .mob-tab .ms{font-size:22px;color:${isDark?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.32)"};transition:color 0.18s;}
        .mob-tab.active{background:#00FF00;box-shadow:0 4px 22px rgba(0,255,0,0.55);transform:scale(1.12);}
        .mob-tab.active .ms{color:#0a1a0a;}
        @media(max-width:768px){
          .sb-sidebar{display:none!important;}
          .sb-header{display:none!important;}
          .mob-header{display:flex!important;}
          .mob-nav{display:flex!important;}
          .sb-scroll{padding:20px 16px 110px;}
          .subject-grid{grid-template-columns:repeat(2,1fr);gap:12px;}
          .module-row{flex-wrap:wrap;}
          .module-title{max-width:100%;}
        }
        @media(max-width:480px){.subject-grid{grid-template-columns:repeat(2,1fr);}}
      `}</style>

      <div className="sb-root">
        {/* ══ SIDEBAR ══ */}
        <aside className={`sb-sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"40px", padding:"0 4px" }}>
            <div style={{ width:"40px", height:"40px", background:"#00FF00", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 0 16px rgba(0,255,0,0.35)" }}>
              <span className="ms" style={{ color:"#0f172a", fontSize:"22px" }}>school</span>
            </div>
            <div className="sl">
              <h1 style={{ fontSize:"1.1rem", fontWeight:700, letterSpacing:"-0.04em", color:text1, lineHeight:1 }}>StudyBuddy</h1>
              <p style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.12em", marginTop:"3px" }}>Engineering AI</p>
            </div>
          </div>
          <nav style={{ flex:1, display:"flex", flexDirection:"column", gap:"4px" }}>
            {NAV_ITEMS.slice(0, 4).map(({ id, icon, label, href }) => (
              <button key={id} className={`nav-link${id === "notes" ? " active" : ""}`} onClick={() => router.push(href)}>
                <span className="ms" style={{ fontSize:"20px", flexShrink:0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}
            <div style={{ padding:"16px 4px 8px", fontSize:"10px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em" }} className="sl">Account</div>
            {NAV_ITEMS.slice(4).map(({ id, icon, label, href }) => (
              <button key={id} className="nav-link" onClick={() => router.push(href)}>
                <span className="ms" style={{ fontSize:"20px", flexShrink:0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}
            <button className="nav-link danger" onClick={() => signOut(auth).then(() => router.replace("/"))}>
              <span className="ms" style={{ fontSize:"20px", flexShrink:0 }}>logout</span>
              <span className="sl">Sign Out</span>
            </button>
          </nav>
        </aside>

        {/* ══ MAIN ══ */}
        <main className="sb-main">
          {/* Desktop header */}
          <header className="sb-header">
            <div style={{ display:"flex", alignItems:"center", gap:"16px", flex:1 }}>
              <button
                onClick={() => setSidebarOpen((s) => !s)}
                style={{ background:isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)", border:"none", borderRadius:"9999px", width:"36px", height:"36px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, transition:"background 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = isDark?"rgba(255,255,255,0.1)":"rgba(0,200,0,0.14)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)")}
              >
                <span className="ms" style={{ fontSize:"20px", color:text2 }}>menu</span>
              </button>
              <div className="search-box">
                <span className="ms" style={{ fontSize:"18px", color:text3 }}>search</span>
                <input placeholder="Search modules or topics…" value={search} onChange={(e) => setSearch(e.target.value)} type="text" />
                {search && (
                  <button onClick={() => setSearch("")} style={{ background:"none", border:"none", cursor:"pointer", display:"flex", padding:0 }}>
                    <span className="ms" style={{ fontSize:"16px", color:text3 }}>close</span>
                  </button>
                )}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"12px", marginLeft:"24px" }}>
              <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />
              <div style={{ width:"1px", height:"32px", background:bdr }} />
              <div style={{ display:"flex", alignItems:"center", gap:"10px", cursor:"pointer" }} onClick={() => router.push("/profile")}>
                <div style={{ textAlign:"right" }}>
                  <p style={{ fontSize:"12px", fontWeight:700, color:text1, lineHeight:1, margin:0 }}>{fullName || "—"}</p>
                  <p style={{ fontSize:"10px", color:text3, fontWeight:500, marginTop:"2px", margin:0 }}>{branch || "No branch"}{sem ? ` · ${sem}` : ""}</p>
                </div>
                <AvatarEl size={40} />
              </div>
            </div>
          </header>

          {/* Mobile header */}
          <header className="mob-header">
            <div style={{ width:"34px", height:"34px", background:"#00FF00", borderRadius:"9px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 12px rgba(0,255,0,0.4)", flexShrink:0 }}>
              <span className="ms" style={{ color:"#0f172a", fontSize:"18px" }}>school</span>
            </div>
            <div className="mob-search">
              <span className="ms" style={{ fontSize:"16px", color:text3, flexShrink:0 }}>search</span>
              <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} type="text" />
              {search && (
                <button onClick={() => setSearch("")} style={{ background:"none", border:"none", cursor:"pointer", padding:0 }}>
                  <span className="ms" style={{ fontSize:"16px", color:text3 }}>close</span>
                </button>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", flexShrink:0 }}>
              <button onClick={() => router.push("/profile")} style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}>
                <AvatarEl size={36} />
              </button>
            </div>
          </header>

          {/* ══ CONTENT ══ */}
          <div className="sb-scroll">
            {/* Page heading */}
            <div style={{ animation:"fadeUp 0.35s ease both" }}>
              <h2 style={{ fontSize:"clamp(1.4rem,3vw,1.9rem)", fontWeight:700, letterSpacing:"-0.03em", color:text1, marginBottom:"6px" }}>Subjects</h2>
              <p style={{ fontSize:"14px", color:text2, fontWeight:400, margin:0, display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
                Access lecture notes uploaded by your professors.
                {branch && <span style={{ padding:"2px 10px", background:"rgba(0,200,0,0.1)", border:"1px solid rgba(0,200,0,0.2)", borderRadius:"9999px", fontSize:"11px", fontWeight:700, color:"#009900" }}>{branch}</span>}
                {sem && <span style={{ padding:"2px 10px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.04)", border:`1px solid ${bdr}`, borderRadius:"9999px", fontSize:"11px", fontWeight:700, color:text2 }}>{sem}</span>}
              </p>
            </div>

            {(!branch || !sem) && (
              <div style={{ display:"flex", alignItems:"center", gap:"14px", padding:"18px 20px", background:isDark?"rgba(245,158,11,0.08)":"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:"16px", animation:"fadeUp 0.3s ease both" }}>
                <span className="ms" style={{ fontSize:"26px", color:"#f59e0b" }}>info</span>
                <div>
                  <p style={{ fontSize:"13px", fontWeight:700, color:text1, margin:"0 0 3px" }}>Branch or semester not set</p>
                  <p style={{ fontSize:"12px", color:text2, margin:0 }}>
                    Please update your profile.{" "}
                    <button onClick={() => router.push("/profile")} style={{ background:"none", border:"none", cursor:"pointer", color:"#f59e0b", fontWeight:700, fontSize:"12px", fontFamily:"'Lexend',sans-serif", textDecoration:"underline" }}>Go to Profile →</button>
                  </p>
                </div>
              </div>
            )}

            {notesLoading && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"60px 20px", gap:"14px" }}>
                <div style={{ width:"28px", height:"28px", border:`3px solid ${bdr}`, borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />
                <p style={{ fontSize:"14px", color:text2, fontWeight:500 }}>Loading subjects…</p>
              </div>
            )}

            {notesError && (
              <div style={{ display:"flex", alignItems:"center", gap:"14px", padding:"18px 20px", background:isDark?"rgba(239,68,68,0.08)":"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:"16px" }}>
                <span className="ms" style={{ fontSize:"26px", color:"#ef4444" }}>error</span>
                <div>
                  <p style={{ fontSize:"13px", fontWeight:700, color:text1, margin:"0 0 3px" }}>Failed to load notes</p>
                  <p style={{ fontSize:"12px", color:text2, margin:0 }}>{notesError}</p>
                </div>
              </div>
            )}

            {/* Subject cards */}
            {!notesLoading && !notesError && Object.keys(subjects).length > 0 && (
              <section>
                <div className="subject-grid">
                  {Object.entries(subjects).map(([code, data], i) => {
                    const active = activeSubject === code;
                    const { icon, color } = getSubjectMeta(code);
                    const label = typeof data?.Subject === "string" ? data.Subject : code;
                    const totalModules = data?.Totalmodules ?? Object.keys(data?.modules || {}).length;
                    return (
                      <div key={code} className={`subject-card${active ? " active" : ""}`} style={{ animationDelay:`${i*0.06}s`, borderColor:active?"#00FF00":bdr }} onClick={() => { setActiveSubject(code); setSearch(""); }}>
                        <div style={{ width:"56px", height:"56px", borderRadius:"14px", background:active?"rgba(0,255,0,0.15)":`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", transition:"background 0.2s" }}>
                          <span className="ms" style={{ fontSize:"30px", color:active?"#00DD00":color }}>{icon}</span>
                        </div>
                        <div>
                          <h3 style={{ fontSize:"17px", fontWeight:700, color:active?(isDark?"#00FF00":"#007700"):text1, marginBottom:"4px", transition:"color 0.2s" }}>{label}</h3>
                          <p style={{ fontSize:"11px", color:text3, lineHeight:1.5, margin:0 }}>
                            {totalModules > 0 ? `${totalModules} module${totalModules!==1?"s":""}` : "No modules yet"}
                          </p>
                        </div>
                        {active && (
                          <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                            <div style={{ width:"6px", height:"6px", borderRadius:"9999px", background:"#00FF00", boxShadow:"0 0 6px rgba(0,255,0,0.8)" }} />
                            <span style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.08em" }}>Selected</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {!notesLoading && !notesError && branch && sem && Object.keys(subjects).length === 0 && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 20px", gap:"14px", opacity:0.6, animation:"fadeUp 0.3s ease both" }}>
                <span className="ms" style={{ fontSize:"48px", color:text3 }}>folder_off</span>
                <p style={{ fontSize:"15px", fontWeight:600, color:text2, margin:0 }}>No subjects found</p>
              </div>
            )}

            {/* Module list */}
            {activeSubject && activeSubjectData && (
              <section>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${bdr}`, paddingBottom:"16px", marginBottom:"20px", flexWrap:"wrap", gap:"12px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                    <div style={{ width:"8px", height:"8px", borderRadius:"9999px", background:"#00FF00", boxShadow:"0 0 8px rgba(0,255,0,0.7)" }} />
                    <h3 style={{ fontSize:"16px", fontWeight:700, color:text1, margin:0 }}>Resources for {activeSubjectData?.Subject || activeSubject}</h3>
                  </div>
                  <span style={{ fontSize:"11px", fontWeight:700, color:text3, background:isDark?"rgba(255,255,255,0.05)":"rgba(0,200,0,0.07)", padding:"4px 12px", borderRadius:"9999px", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                    {filteredModules.length} {filteredModules.length===1?"Module":"Modules"}
                  </span>
                </div>

                {filteredModules.length === 0 && search ? (
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"60px 20px", gap:"14px", opacity:0.5 }}>
                    <span className="ms" style={{ fontSize:"48px", color:text3 }}>search_off</span>
                    <p style={{ fontSize:"15px", fontWeight:600, color:text2, margin:0 }}>No modules match your search</p>
                  </div>
                ) : filteredModules.length === 0 ? (
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"60px 20px", gap:"14px", opacity:0.5 }}>
                    <span className="ms" style={{ fontSize:"48px", color:text3 }}>folder_open</span>
                    <p style={{ fontSize:"15px", fontWeight:600, color:text2, margin:0 }}>No modules yet</p>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                    {filteredModules.map((mod, i) => {
                      const isChunked = chunkedModules[mod.key];
                      const hasPDF    = isChunked || !!mod.resourcesPDF;
                      return (
                        <div key={mod.key} className="module-row" style={{ animationDelay:`${i*0.04}s` }} onMouseEnter={() => setHoveredFile(i)} onMouseLeave={() => setHoveredFile(null)}>
                          {/* Icon + info */}
                          <div style={{ display:"flex", alignItems:"center", gap:"16px", flex:1, minWidth:0 }}>
                            <div style={{ width:"48px", height:"48px", minWidth:"48px", borderRadius:"12px", background:hasPDF?"rgba(239,68,68,0.08)":(isDark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.04)"), display:"flex", alignItems:"center", justifyContent:"center", transition:"transform 0.2s", transform:hoveredFile===i?"scale(1.08)":"scale(1)" }}>
                              <span className="ms" style={{ fontSize:"24px", color:hasPDF?"#ef4444":text3 }}>
                                {hasPDF ? "picture_as_pdf" : "folder_open"}
                              </span>
                            </div>
                            <div style={{ minWidth:0, flex:1 }}>
                              <p className="module-title">
                                <span style={{ display:"inline-flex", alignItems:"center", marginRight:"8px", padding:"2px 8px", background:"rgba(0,200,0,0.1)", border:"1px solid rgba(0,200,0,0.2)", borderRadius:"9999px", fontSize:"10px", fontWeight:700, color:"#009900", letterSpacing:"0.04em" }}>
                                  {mod.key.replace("module","M")}
                                </span>
                                {mod.Title || "Untitled Module"}
                              </p>
                              <p className="module-meta">
                                {isChunked ? (
                                  <><span className="badge-chunked"><span className="ms" style={{ fontSize:"12px" }}>check_circle</span>PDF Ready</span><span className="dot" />Opens in StudyBuddy viewer</>
                                ) : hasPDF ? (
                                  <><span>PDF Available</span><span className="dot" />External link</>
                                ) : (
                                  <span style={{ color:"#f59e0b", fontWeight:600 }}>No resource uploaded yet</span>
                                )}
                              </p>
                            </div>
                          </div>

                          {/* ── UPDATED Actions ── */}
                          <div style={{ display:"flex", alignItems:"center", gap:"8px", flexShrink:0 }}>
                            <button
                              className="btn-open"
                              disabled={!hasPDF}
                              onClick={() => handleOpenPDF(mod)}
                              title={isChunked ? "Open in StudyBuddy PDF Viewer" : "Open external PDF"}
                            >
                              <span className="ms" style={{ fontSize:"16px" }}>
                                {isChunked ? "open_in_full" : "open_in_new"}
                              </span>
                              Open
                            </button>
                            <button
                              className={`btn-dl${dlAnim === i ? " done" : ""}`}
                              disabled={!hasPDF}
                              onClick={() => handleDownloadPDF(mod, i)}
                            >
                              <span className="ms" style={{ fontSize:"16px" }}>{dlAnim===i?"check":"download"}</span>
                              {dlAnim===i?"Saved!":"Download"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>

      {/* ══ MOBILE BOTTOM NAV ══ */}
      <nav className="mob-nav">
        {NAV_ITEMS.slice(0, 4).map(({ id, icon, href }) => (
          <button key={id} className={`mob-tab${id==="notes"?" active":""}`} onClick={() => router.push(href)}>
            <span className="ms">{icon}</span>
          </button>
        ))}
        <button className="mob-tab" onClick={() => router.push("/profile")}>
          <span className="ms">person</span>
        </button>
      </nav>
    </>
  );
}