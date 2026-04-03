"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue } from "firebase/database";

const TEST_IDB_NAME = "studybuddy_test_cache";
const TEST_IDB_STORE = "kv";
const TEST_SUBJECTS_TTL_MS = 15 * 60 * 1000;
const TEST_SUBJECTS_MEM = new Map();

function testSubjectsKey(branch, sem) {
  return `sb_test_subjects|${branch}|${sem}`;
}

const LS = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch {
      try { localStorage.removeItem(key); } catch { }
      return null;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
  },
};

function openTestDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TEST_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const dbInst = req.result;
      if (!dbInst.objectStoreNames.contains(TEST_IDB_STORE)) {
        dbInst.createObjectStore(TEST_IDB_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const dbInst = await openTestDb().catch(() => null);
  if (!dbInst) return null;
  return new Promise((resolve, reject) => {
    const tx = dbInst.transaction(TEST_IDB_STORE, "readonly");
    const store = tx.objectStore(TEST_IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
}

async function idbSet(key, value) {
  const dbInst = await openTestDb().catch(() => null);
  if (!dbInst) return false;
  return new Promise((resolve, reject) => {
    const tx = dbInst.transaction(TEST_IDB_STORE, "readwrite");
    const store = tx.objectStore(TEST_IDB_STORE);
    const req = store.put({ key, value, updatedAt: Date.now() });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  }).catch(() => false);
}

function normalizeSubjectsToList(map) {
  return Object.keys(map || {}).map((subjectName) => ({
    label: subjectName,
    color: "#00AA00",
    icon: "quiz",
    count: 0,
  }));
}

async function getSubjectsFromLocalCache(cacheKey) {
  const memCached = TEST_SUBJECTS_MEM.get(cacheKey);
  if (memCached?.savedAt && (Date.now() - memCached.savedAt) < TEST_SUBJECTS_TTL_MS && memCached?.data) {
    return memCached;
  }

  const lsCached = LS.get(cacheKey);
  if (lsCached?.savedAt && (Date.now() - lsCached.savedAt) < TEST_SUBJECTS_TTL_MS && lsCached?.data) {
    TEST_SUBJECTS_MEM.set(cacheKey, lsCached);
    void idbSet(cacheKey, lsCached);
    return lsCached;
  }

  const idbCached = await idbGet(cacheKey);
  if (idbCached?.savedAt && (Date.now() - idbCached.savedAt) < TEST_SUBJECTS_TTL_MS && idbCached?.data) {
    TEST_SUBJECTS_MEM.set(cacheKey, idbCached);
    LS.set(cacheKey, idbCached);
    return idbCached;
  }

  return null;
}

function setSubjectsLocalCache(cacheKey, data) {
  const payload = { data, savedAt: Date.now() };
  TEST_SUBJECTS_MEM.set(cacheKey, payload);
  LS.set(cacheKey, payload);
  void idbSet(cacheKey, payload);
}


// ── Theme Hook ──
function useTheme() {
  const KEY = "studybuddy_theme";
  const [theme, setThemeState] = useState("system");
  const [resolved, setResolved] = useState("light");
  useEffect(() => { try { setThemeState(localStorage.getItem(KEY) || "system"); } catch { } }, []);
  const setTheme = (val) => { try { localStorage.setItem(KEY, val); } catch { } setThemeState(val); };
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    update(); mq.addEventListener("change", update); return () => mq.removeEventListener("change", update);
  }, [theme]);
  return { theme, setTheme, resolved };
}

// ── Theme Switcher (same as NotesPage) ──
function ThemeSwitcher({ theme, setTheme, resolved }) {
  const isDark = resolved === "dark";
  const [hovered, setHovered] = useState(null);
  const opts = [
    { value: "light", icon: "light_mode", label: "Light" },
    { value: "dark", icon: "dark_mode", label: "Dark" },
    { value: "system", icon: "desktop_windows", label: "System" },
  ];
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "2px", padding: "4px",
      borderRadius: "9999px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`
    }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <div key={value} style={{ position: "relative" }}>
            <button
              onClick={() => setTheme(value)}
              onMouseEnter={() => setHovered(value)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: "32px", height: "32px", borderRadius: "9999px", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.22s cubic-bezier(0.34,1.56,0.64,1)",
                background: active ? (isDark ? "rgba(0,255,0,0.18)" : "#00FF00") : "transparent",
                boxShadow: active ? (isDark ? "0 0 14px rgba(0,255,0,0.3)" : "0 4px 12px rgba(0,255,0,0.35)") : "none",
                transform: active ? "scale(1.08)" : "scale(1)"
              }}
            >
              <span style={{
                fontFamily: "'Material Symbols Outlined'", fontSize: "16px", lineHeight: 1,
                color: active ? (isDark ? "#00FF00" : "#0f172a") : (isDark ? "#475569" : "#94a3b8")
              }}>
                {icon}
              </span>
            </button>
            {hovered === value && (
              <div style={{
                position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
                background: isDark ? "#1e293b" : "#0f172a", color: "#fff", fontSize: "10px", fontWeight: 700,
                padding: "4px 8px", borderRadius: "6px", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 100
              }}>
                {label}
                <div style={{
                  position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                  width: 0, height: 0,
                  borderLeft: "4px solid transparent", borderRight: "4px solid transparent",
                  borderTop: `4px solid ${isDark ? "#1e293b" : "#0f172a"}`
                }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function TestPage() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userBranch, setUserBranch] = useState(null);
  const [userSem, setUserSem] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [subjectsData, setSubjectsData] = useState({});
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  // Module Modal States
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [modules, setModules] = useState([]);
  const [selectedModules, setSelectedModules] = useState([]); // array of module keys
  const [loadingModules, setLoadingModules] = useState(false);
  const [showModuleModal, setShowModuleModal] = useState(false);

  // Colors (matched with NotesPage)
  const bg = isDark ? "#080f1a" : "#f5f8f5";
  const sidebar = isDark ? "rgba(8,15,26,0.96)" : "rgba(255,255,255,0.75)";
  const header = isDark ? "rgba(8,15,26,0.92)" : "rgba(255,255,255,0.75)";
  const card = isDark ? "rgba(15,23,42,0.85)" : "#ffffff";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";

  const [userName, setUserName] = useState(null);
  const [userAvatar, setUserAvatar] = useState(null);

  const navItems = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard" },
    { id: "notes", icon: "description", label: "Notes" },
    { id: "test", icon: "quiz", label: "Test" },
    { id: "ai", icon: "psychology", label: "Neural AI" },
    { id: "profile", icon: "person", label: "Profile" },
    { id: "settings", icon: "settings", label: "Settings" },
  ];

  // Fetch user data + subjects
  useEffect(() => {
    let unsubUser = null;

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      const userRef = ref(db, `users/${user.uid}`);
      unsubUser = onValue(userRef, async (snap) => {
        if (snap.exists()) {
          const data = snap.val();
          const branch = data.branch;
          const semRaw = data.sem;
          const sem = semRaw ? Number(semRaw.toString().replace(/\D/g, "")) : null;

          setUserBranch(branch);
          setUserSem(sem);

          // ✅ Set name & avatar here, right after reading data
          const name = data.displayName || data.name || user.displayName || "User";
          const avatar = data.photoURL || user.photoURL || null;
          setUserName(name);
          setUserAvatar(avatar);

          if (branch && sem) {
            try {
              setLoadingSubjects(true);
              const cacheKey = testSubjectsKey(branch, sem);
              const cached = await getSubjectsFromLocalCache(cacheKey);

              if (cached?.data) {
                setSubjectsData(cached.data);
                setSubjects(normalizeSubjectsToList(cached.data));
                setLoadingSubjects(false);
              }

              if (!cached?.data) {
                const params = new URLSearchParams({ branch, sem: String(sem) });
                const res = await fetch(`/api/notes/subjects?${params.toString()}`);
                const payload = await res.json();
                const map = payload?.data && typeof payload.data === "object" ? payload.data : {};

                setSubjectsData(map);
                setSubjects(normalizeSubjectsToList(map));
                setSubjectsLocalCache(cacheKey, map);
                setLoadingSubjects(false);
              }
            } catch {
              setSubjectsData({});
              setSubjects([]);
              setLoadingSubjects(false);
            }
          } else {
            setSubjectsData({});
            setSubjects([]);
            setLoadingSubjects(false);
          }

        } else {
          setSubjectsData({});
          setSubjects([]);
          setLoadingSubjects(false);
        }
      });

    });

    return () => {
      if (typeof unsubUser === "function") unsubUser();
      unsub();
    };
  }, [router]);

  const getModuleChapters = (moduleValue) => {
    if (!moduleValue || typeof moduleValue !== "object") return [];
    const excludedKeys = new Set([
      "Title",
      "title",
      "pdf",
      "pdfUrl",
      "pdfMeta",
      "pdfChunks",
      "Summary",
      "summary",
    ]);
    return Object.entries(moduleValue)
      .filter(([key]) => !excludedKeys.has(key) && /chapter/i.test(key))
      .map(([key, value]) => {
        if (typeof value === "string") {
          const text = value.trim();
          return text || key;
        }
        if (typeof value === "object" && value !== null) {
          return value.Title || value.title || value.name || key;
        }
        return String(value || "").trim() || key;
      })
      .filter(Boolean);
  };

  // Build modules from cached subjects payload
  const fetchModules = (subject) => {
    setLoadingModules(true);
    setModules([]);
    setSelectedModules([]);

    const subjectData = subjectsData?.[subject];
    const modulesMap = subjectData?.modules && typeof subjectData.modules === "object" ? subjectData.modules : {};

    const modList = Object.entries(modulesMap).map(([key, value]) => ({
      key,
      number: key.replace(/[^0-9]/g, "") || key.replace("module", ""),
      title: value?.Title || value?.title || `Module ${key.replace("module", "")}`,
      chapters: getModuleChapters(value),
    }));

    setModules(modList);
    setLoadingModules(false);
  };

  const handleSubjectClick = (subject) => {
    setSelectedSubject(subject);
    setShowModuleModal(true);
    fetchModules(subject);
  };

  const toggleModuleSelection = (moduleKey) => {
    if (selectedModules.includes(moduleKey)) {
      setSelectedModules(selectedModules.filter(k => k !== moduleKey));
    } else {
      setSelectedModules([...selectedModules, moduleKey]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedModules.length === modules.length) {
      setSelectedModules([]);
    } else {
      setSelectedModules(modules.map(m => m.key));
    }
  };

  const handleStartTest = () => {
    if (selectedModules.length === 0) return;

    const modulesParam = selectedModules.join(',');   // e.g. "module1,module3,module5"

    // Navigate to general quiz page with query params
    router.push(`/test/quiz?subject=${encodeURIComponent(selectedSubject)}&modules=${modulesParam}`);
  };

  const displayCategories = subjects.length > 0 ? subjects : [
    { label: "Data Structures", color: "#3b82f6" },
    { label: "Computer Networks", color: "#8b5cf6" },
    { label: "Digital Electronics", color: "#f59e0b" },
    { label: "DBMS", color: "#ef4444" },
  ];

  // Avatar Component (same as NotesPage)
  const AvatarEl = ({ size = 40 }) => {
    const fullName = userName || "User";
    const firstName = fullName.split(" ")[0] || "U";
    return (
      <div style={{
        width: `${size}px`, height: `${size}px`, borderRadius: "9999px",
        border: "2.5px solid #00FF00", overflow: "hidden",
        background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0", flexShrink: 0
      }}>
        {userAvatar ? (
          <img
            src={userAvatar}
            alt={fullName}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div style={{
            width: "100%", height: "100%", display: "flex", alignItems: "center",
            justifyContent: "center", background: "#00FF00", color: "#0f172a",
            fontSize: `${size * 0.45}px`, fontWeight: 900, fontFamily: "'Lexend',sans-serif"
          }}>
            {firstName?.[0]?.toUpperCase() || "?"}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;}
        body{font-family:'Lexend',sans-serif;background:${bg};color:${text1};overflow:hidden;}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;line-height:1;display:inline-block;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        .dash-root{display:flex;height:100vh;overflow:hidden;}
        .sidebar{width:260px;min-width:260px;height:100vh;background:${sidebar};backdrop-filter:blur(12px);border-right:1px solid ${bdr};display:flex;flex-direction:column;padding:24px 20px;z-index:20;}
        .sidebar.collapsed{width:72px;min-width:72px;}
        .sidebar.collapsed .sl{display:none;}
        .nav-link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9999px;font-size:13px;font-weight:600;color:${text2};transition:all 0.2s;cursor:pointer;border:none;background:none;width:100%;text-align:left;}
        .nav-link:hover{background:rgba(0,200,0,0.08);color:${text1};}
        .nav-link.active{background:#00FF00;color:#0f172a;box-shadow:0 6px 20px rgba(0,255,0,0.28);}
        .nav-link.danger{color:#f87171;}
        .nav-link.danger:hover{background:rgba(248,113,113,0.1);}
        .dash-main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
        .dash-header{height:72px;background:${header};backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 32px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .dash-scroll{flex:1;overflow-y:auto;padding:32px;display:flex;flex-direction:column;gap:36px;}
        .quiz-card{background:${card};border-radius:18px;border:1px solid ${bdr};padding:22px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:16px;}
        .quiz-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,255,0,0.12);}
        .modal-overlay{position:fixed;inset:0;background:${isDark ? "rgba(2,6,23,0.72)" : "rgba(15,23,42,0.35)"};backdrop-filter:blur(6px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;}
        .modal{background:${isDark ? "rgba(8,15,26,0.98)" : "rgba(255,255,255,0.98)"};border-radius:20px;width:min(720px, 100%);border:1px solid ${bdr};box-shadow:0 25px 70px rgba(0,0,0,0.45);overflow:hidden;}
        .modal-header{padding:20px 24px;border-bottom:1px solid ${bdr};display:flex;justify-content:space-between;align-items:center;}
        .modal-sub{font-size:12px;color:${text2};margin-top:2px;}
        .module-row{padding:16px 18px;border-radius:14px;border:1px solid ${bdr};background:${isDark ? "rgba(15,23,42,0.62)" : "#ffffff"};cursor:pointer;display:flex;align-items:flex-start;gap:12px;transition:all .18s ease;}
        .module-row:hover{border-color:${isDark ? "rgba(0,255,0,0.35)" : "rgba(0,200,0,0.3)"};transform:translateY(-1px);}
        .module-row.active{border:2px solid #00FF00;background:${isDark ? "rgba(0,255,0,0.09)" : "rgba(0,255,0,0.06)"};}
        .chapter-pill{display:inline-block;padding:4px 9px;border-radius:9999px;border:1px solid ${bdr};font-size:11px;font-weight:600;color:${text2};background:${isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"};}
        @media(max-width:768px){
          .sidebar{display:none!important;}
          .dash-header{display:none!important;}
          .dash-scroll{padding:20px 16px 100px;}
          .mob-nav{display:flex!important;}
        }
        .mob-nav{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:300;background:${isDark ? "rgba(14,20,36,0.95)" : "rgba(255,255,255,0.92)"};backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)"};border-radius:9999px;padding:8px 24px;align-items:center;gap:6px;box-shadow:0 12px 48px rgba(0,0,0,0.22), 0 2px 10px rgba(0,0,0,0.12);min-width:340px;}
        .mob-tab{width:54px;height:54px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;font-family:'Inter',sans-serif;-webkit-tap-highlight-color:transparent;transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1),background 0.18s;flex-shrink:0;}
        .mob-tab:active{transform:scale(0.80);}
        .mob-tab .ms{font-size:22px;color:${isDark?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.32)"};transition:color 0.18s;}
        .mob-tab.active{background:#00FF00;box-shadow:0 4px 22px rgba(0,255,0,0.55);transform:scale(1.12);}
        .mob-tab.active .ms{color:#0a1a0a;}
        .mob-tab.danger .ms{color:#f87171;}
      `}</style>

      <div className="dash-root">
        {/* Sidebar */}
        <aside className={`sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "40px", padding: "0 4px" }}>
            <div style={{ width: "40px", height: "40px", background: "#00FF00", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(0,255,0,0.35)" }}>
              <span className="ms" style={{ color: "#0f172a", fontSize: "22px" }}>school</span>
            </div>
            <div className="sl">
              <h1 style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "-0.04em", color: text1 }}>StudyBuddy</h1>
              <p style={{ fontSize: "10px", fontWeight: 700, color: "#00AA00", textTransform: "uppercase", letterSpacing: "0.12em" }}>ENGINEERING AI</p>
            </div>
          </div>
          <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            {navItems.slice(0, 4).map(({ id, icon, label }) => (
              <button key={id} className={`nav-link${id === "test" ? " active" : ""}`} onClick={() => router.push(`/${id}`)}>
                <span className="ms" style={{ fontSize: "20px" }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}
            <div className="sl" style={{ padding: "16px 4px 8px", fontSize: "10px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.12em" }}>ACCOUNT</div>
            {navItems.slice(4).map(({ id, icon, label }) => (
              <button key={id} className="nav-link" onClick={() => router.push(`/${id}`)}>
                <span className="ms" style={{ fontSize: "20px" }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}
            <button className="nav-link danger" onClick={() => signOut(auth).then(() => router.replace("/"))}>
              <span className="ms" style={{ fontSize: "20px" }}>logout</span>
              <span className="sl">Sign Out</span>
            </button>
          </nav>
        </aside>

        <main className="dash-main">
          {/* Header - Matched with NotesPage */}
          <header className="dash-header">
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
              <button
                onClick={() => setSidebarOpen(s => !s)}
                style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)", border: "none", borderRadius: "9999px", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <span className="ms" style={{ fontSize: "20px", color: text2 }}>menu</span>
              </button>
              <h1 style={{ fontSize: "1.4rem", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.02em" }}>Tests & Quizzes</h1>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />
              <div style={{ width: "1px", height: "32px", background: bdr }} />
              <div style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }} onClick={() => router.push("/profile")}>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "12px", fontWeight: 800, color: text1, margin: 0 }}>
                    {userName || "User"}
                  </p>
                  <p style={{ fontSize: "10px", color: text3, marginTop: "2px" }}>
                    {userBranch || "—"} · Sem {userSem || "—"}
                  </p>
                </div>
                <AvatarEl size={40} />
              </div>
            </div>
          </header>

          <div className="dash-scroll">
            <div style={{ maxWidth: "720px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "36px" }}>
              <div>
                <h2 style={{ fontSize: "clamp(1.4rem,3vw,1.8rem)", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 6px" }}>Tests & Quizzes</h2>
                <p style={{ fontSize: "14px", color: text2 }}>Practice with subject-wise quizzes and mock tests</p>
              </div>

              {/* Subjects Grid */}
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 800, color: text1, margin: "0 0 16px", letterSpacing: "-0.02em" }}>Choose a Subject</h3>
                {loadingSubjects ? (
                  <div style={{ textAlign: "center", color: text2, padding: "80px 0" }}>Loading subjects...</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
                    {displayCategories.map(({ label, color }) => (
                      <div key={label} className="quiz-card" onClick={() => handleSubjectClick(label)}>
                        <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: `${color}18`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span className="ms" style={{ fontSize: "24px", color }}>quiz</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: "14px", fontWeight: 800, color: text1 }}>{label}</p>
                          <p style={{ fontSize: "11px", color: text2 }}>Open to view all chapters first</p>
                        </div>
                        <span className="ms" style={{ fontSize: "20px", color: text3 }}>chevron_right</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="mob-nav">
        {navItems.slice(0, 4).map(({ id, icon }) => (
          <button key={id} className={`mob-tab${id === "test" ? " active" : ""}`} onClick={() => router.push(`/${id}`)}>
            <span className="ms">{icon}</span>
          </button>
        ))}
        <button className="mob-tab" onClick={() => router.push("/profile")}>
          <span className="ms">person</span>
        </button>
      </nav>

      {/* Module Selection Modal */}
      {showModuleModal && (
        <div className="modal-overlay" onClick={() => setShowModuleModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: "18px", fontWeight: 800, color: text1 }}>{selectedSubject}</h3>
                <p className="modal-sub">Select modules after reviewing chapters</p>
              </div>
              <button onClick={() => setShowModuleModal(false)} style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: `1px solid ${bdr}`, width: "34px", height: "34px", borderRadius: "9999px", fontSize: "20px", color: text2, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ padding: "24px", maxHeight: "460px", overflowY: "auto" }}>
              {loadingModules ? (
                <p style={{ textAlign: "center", color: text2, padding: "60px 0" }}>Loading modules...</p>
              ) : modules.length === 0 ? (
                <p style={{ textAlign: "center", color: text2 }}>No modules found.</p>
              ) : (
                <>
                  <div onClick={toggleSelectAll} style={{ padding: "14px 18px", borderRadius: "12px", background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", border: `1px solid ${bdr}`, marginBottom: "16px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", fontWeight: 700 }}>
                    <input type="checkbox" checked={selectedModules.length === modules.length && modules.length > 0} readOnly style={{ accentColor: "#00FF00", width: "18px", height: "18px" }} />
                    <span>Select All Modules</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {modules.map((mod) => (
                      <div
                        key={mod.key}
                        onClick={() => toggleModuleSelection(mod.key)}
                        className={`module-row${selectedModules.includes(mod.key) ? " active" : ""}`}
                      >
                        <input type="checkbox" checked={selectedModules.includes(mod.key)} readOnly style={{ accentColor: "#00FF00", width: "18px", height: "18px" }} />
                        <div>
                          <p style={{ fontWeight: 700, color: text1 }}>Module {mod.number}</p>
                          <p style={{ fontSize: "14px", color: text2 }}>{mod.title}</p>
                          {mod.chapters?.length > 0 ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                              {mod.chapters.slice(0, 6).map((chapter) => (
                                <span key={`${mod.key}-${chapter}`} className="chapter-pill">{chapter}</span>
                              ))}
                              {mod.chapters.length > 6 && (
                                <span className="chapter-pill">+{mod.chapters.length - 6} more</span>
                              )}
                            </div>
                          ) : (
                            <p style={{ fontSize: "12px", color: text3, marginTop: "6px" }}>
                              Chapters not available
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div style={{ padding: "20px 24px", borderTop: `1px solid ${bdr}`, display: "flex", gap: "12px" }}>
              <button onClick={() => setShowModuleModal(false)} style={{ flex: 1, padding: "14px", borderRadius: "12px", border: `1px solid ${bdr}`, background: "transparent", color: text2, fontWeight: 700 }}>Cancel</button>
              <button
                onClick={handleStartTest}
                disabled={selectedModules.length === 0}
                style={{
                  flex: 1, padding: "14px", borderRadius: "12px", border: "none",
                  background: selectedModules.length > 0 ? "#00FF00" : "rgba(0,255,0,0.3)",
                  color: selectedModules.length > 0 ? "#0f172a" : "#666",
                  fontWeight: 800,
                  cursor: selectedModules.length > 0 ? "pointer" : "not-allowed"
                }}
              >
                Start Test ({selectedModules.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}