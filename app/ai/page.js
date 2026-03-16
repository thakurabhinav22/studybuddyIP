"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue } from "firebase/database";
import { flushPendingUsageStats, flushUsageStats } from "@/lib/usageStats";

/* ═══════════════════════════════════════════
   SUBJECT ICON MAP  (matches NotesPage)
═══════════════════════════════════════════ */
const SUBJECT_ICON_MAP = {
  CN:       { icon:"router",       color:"#3b82f6" },
  COA:      { icon:"memory",       color:"#8b5cf6" },
  MATHS3:   { icon:"functions",    color:"#00FF00" },
  MATHS:    { icon:"functions",    color:"#00FF00" },
  NOSQL:    { icon:"database",     color:"#f59e0b" },
  MONOGPDB: { icon:"database",     color:"#f59e0b" },
  DSA:      { icon:"account_tree", color:"#ec4899" },
  OS:       { icon:"terminal",     color:"#14b8a6" },
  DBMS:     { icon:"storage",      color:"#f97316" },
  DEFAULT:  { icon:"description",  color:"#64748b" },
};
function getSubjectMeta(code) { return SUBJECT_ICON_MAP[code] || SUBJECT_ICON_MAP.DEFAULT; }

/* ── Nav items (matches NotesPage) ── */
const NAV_ITEMS = [
  { id:"dashboard", icon:"dashboard",   label:"Dashboard", href:"/dashboard" },
  { id:"notes",     icon:"description", label:"Notes",     href:"/notes"     },
  { id:"test",      icon:"quiz",        label:"Test",      href:"/test"      },
  { id:"ai",        icon:"psychology",  label:"Neural AI", href:"/ai"        },
  { id:"profile",   icon:"person",      label:"Profile",   href:"/profile"   },
  { id:"settings",  icon:"settings",    label:"Settings",  href:"/settings"  },
];

/* ── Quick suggestion prompts ── */
const SUGGESTIONS = [
  { icon:"summarize",    label:"Summarize topic"        },
  { icon:"quiz",         label:"Generate quiz questions" },
  { icon:"lightbulb",   label:"Explain key concepts"   },
  { icon:"history_edu", label:"Give exam tips"          },
];

/* ── Tools for Neural AI ── */
const TOOLS = [
  { id:"summarize",  name:"Summarize",      desc:"Quick summary", icon:"summarize" },
  { id:"quiz",       name:"Quiz Gen",       desc:"Practice questions", icon:"quiz" },
  { id:"concepts",   name:"Concepts",       desc:"Key ideas", icon:"lightbulb" },
  { id:"tips",       name:"Exam Tips",      desc:"Exam strategies", icon:"history_edu" },
  { id:"examples",   name:"Examples",       desc:"Use cases", icon:"case_notes" },
  { id:"compare",    name:"Compare",        desc:"Compare topics", icon:"scale" },
];

/* ── Theme hook (matches NotesPage) ── */
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
    const update = () => setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);
  return { theme, setTheme, resolved };
}

/* ── Theme Switcher (matches NotesPage) ── */
function ThemeSwitcher({ theme, setTheme, resolved }) {
  const isDark = resolved === "dark";
  const [hovered, setHovered] = useState(null);
  const opts = [
    { value:"light",  icon:"light_mode",     label:"Light"  },
    { value:"dark",   icon:"dark_mode",       label:"Dark"   },
    { value:"system", icon:"desktop_windows", label:"System" },
  ];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:"2px", padding:"4px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", border:`1px solid ${isDark?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.08)"}` }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <div key={value} style={{ position:"relative" }}>
            <button
              onClick={() => setTheme(value)}
              onMouseEnter={() => setHovered(value)}
              onMouseLeave={() => setHovered(null)}
              style={{ width:"32px", height:"32px", borderRadius:"9999px", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.22s cubic-bezier(0.34,1.56,0.64,1)", background:active?(isDark?"rgba(0,255,0,0.18)":"#00FF00"):"transparent", boxShadow:active?(isDark?"0 0 14px rgba(0,255,0,0.3)":"0 4px 12px rgba(0,255,0,0.35)"):"none", transform:active?"scale(1.08)":"scale(1)" }}
            >
              <span style={{ fontFamily:"'Material Symbols Outlined'", fontSize:"16px", lineHeight:1, color:active?(isDark?"#00FF00":"#0f172a"):(isDark?"#475569":"#94a3b8") }}>{icon}</span>
            </button>
            {hovered === value && (
              <div style={{ position:"absolute", bottom:"calc(100% + 8px)", left:"50%", transform:"translateX(-50%)", background:isDark?"#1e293b":"#0f172a", color:"#fff", fontSize:"10px", fontWeight:700, padding:"4px 8px", borderRadius:"6px", whiteSpace:"nowrap", pointerEvents:"none", zIndex:100 }}>
                {label}
                <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", width:0, height:0, borderLeft:"4px solid transparent", borderRight:"4px solid transparent", borderTop:`4px solid ${isDark?"#1e293b":"#0f172a"}` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════ */
export default function AiPage() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  /* ── Auth ── */
  const [authUser,    setAuthUser]    = useState(null);
  const [userData,    setUserData]    = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  /* ── Sidebar ── */
  const [sidebarOpen, setSidebarOpen] = useState(true);

  /* ── Chat state ── */
  const [messages,    setMessages]    = useState([
    { role:"ai", text:"Hi! I'm Neural AI, your engineering study assistant. Ask me anything about your coursework — DSA, Networks, Databases, OS and more.\n\nYou can also import a module from your notes to get targeted help on a specific topic, or use a tool like /summarize or /quiz to structure your learning!", ts: Date.now() }
  ]);
  const [input,       setInput]       = useState("");
  const [aiLoading,   setAiLoading]   = useState(false);
  const [importedMod, setImportedMod] = useState(null); // { subject, modKey, title }
  const bottomRef = useRef(null);
  const sessionStartRef = useRef(null);
  const aiQuestionsRef = useRef(0);

  /* ── Import sheet ── */
  const [importOpen,       setImportOpen]       = useState(false);
  const [importSubjects,   setImportSubjects]   = useState({});
  const [importLoading,    setImportLoading]    = useState(false);
  const [importActiveSub,  setImportActiveSub]  = useState(null);
  const importListenerRef = useRef(null);

  /* ── Tools ── */
  const [activeTool,   setActiveTool]   = useState(null);
  const [toolsOpen,    setToolsOpen]    = useState(false);

  /* ── Mobile ── */
  const [mobMenuOpen, setMobMenuOpen] = useState(false);

  const normaliseSem = useCallback((raw) => {
    if (!raw) return "";
    const str = raw.toString().trim();
    if (/^Sem:\d+$/.test(str)) return str;
    const num = str.replace(/[^0-9]/g, "");
    return num ? `Sem:${num}` : str;
  }, []);

  /* ── Auth guard ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      const unsubDB = onValue(ref(db, `users/${u.uid}`), (snap) => {
        if (snap.exists()) setUserData(snap.val());
        setAuthLoading(false);
      });
      return () => unsubDB();
    });
    return () => unsub();
  }, [router]);

  /* ── Auto scroll ── */
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, aiLoading]);

  const flushAiStats = useCallback(async () => {
    if (!authUser?.uid || !sessionStartRef.current) return;
    const now = Date.now();
    const studyMs = Math.max(0, now - sessionStartRef.current);
    const aiQuestions = aiQuestionsRef.current;
    if (studyMs < 1000 && aiQuestions === 0) return;

    sessionStartRef.current = now;
    aiQuestionsRef.current = 0;
    await flushUsageStats(db, authUser.uid, { studyMs, aiQuestions, solvedProblems: 0 });
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid || authLoading) return;
    if (!sessionStartRef.current) sessionStartRef.current = Date.now();
    flushPendingUsageStats(db, authUser.uid);
  }, [authUser?.uid, authLoading]);

  useEffect(() => {
    if (!authUser?.uid || authLoading) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushAiStats();
      } else if (!sessionStartRef.current) {
        sessionStartRef.current = Date.now();
      }
    };

    const onPageHide = () => { flushAiStats(); };
    const onBeforeUnload = () => { flushAiStats(); };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushAiStats();
    };
  }, [authUser?.uid, authLoading, flushAiStats]);

  /* ── Load subjects when import sheet opens ── */
  useEffect(() => {
    if (!importOpen || !userData?.branch || !userData?.sem) return;
    const { branch, sem } = userData;
    const semKey = normaliseSem(sem);
    setImportLoading(true);

    if (importListenerRef.current) { importListenerRef.current(); importListenerRef.current = null; }

    const subRef = ref(db, `notes/${branch}/${semKey}/subjects`);
    const unsub  = onValue(subRef, (snap) => {
      setImportLoading(false);
      if (!snap.exists()) { setImportSubjects({}); return; }
      const raw = snap.val();
      const normalised = {};
      Object.entries(raw).forEach(([code, val]) => {
        if (val === true) normalised[code] = { Subject:code, Totalmodules:0, modules:{} };
        else if (typeof val === "object" && val !== null) normalised[code] = val;
      });
      setImportSubjects(normalised);
      if (!importActiveSub) setImportActiveSub(Object.keys(normalised)[0] || null);
    }, () => setImportLoading(false));

    importListenerRef.current = unsub;
    return () => { unsub(); importListenerRef.current = null; };
  }, [importOpen, userData?.branch, userData?.sem, normaliseSem]);

  /* ── Send message ── */
  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || aiLoading) return;

    // Handle "/" command for tools
    if (msg.startsWith("/")) {
      const toolCmd = msg.slice(1).toLowerCase();
      const tool = TOOLS.find(t => t.name.toLowerCase().includes(toolCmd) || t.id === toolCmd);
      if (tool) {
        setActiveTool(tool.id);
        setInput("");
        return;
      }
    }

    setInput("");
    const userMsg = { role:"user", text:msg, ts:Date.now() };
    setMessages(p => [...p, userMsg]);
    aiQuestionsRef.current += 1;
    setAiLoading(true);

    try {
      const toolPrefix = activeTool ? `Use the ${TOOLS.find(t => t.id === activeTool)?.name} approach. ` : "";
      const systemPrompt = importedMod
        ? `You are Neural AI — an expert engineering exam assistant.
The student is studying: "${importedMod.title}" from subject "${importedMod.subject}", semester "${userData?.sem}".
${toolPrefix}Give focused, exam-oriented answers. Use bullet points for lists. Be concise (under 250 words) unless asked to elaborate.`
        : `You are Neural AI — an expert engineering exam assistant for students.
The student's branch is "${userData?.branch || "Engineering"}", semester "${userData?.sem || "N/A"}".
${toolPrefix}Give focused, exam-oriented answers. Use bullet points for lists. Be concise (under 250 words) unless asked to elaborate.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system: systemPrompt,
          messages:[{ role:"user", content:msg }],
        }),
      });
      const data  = await res.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't generate a response right now.";
      setMessages(p => [...p, { role:"ai", text:reply, ts:Date.now() }]);
    } catch {
      setMessages(p => [...p, { role:"ai", text:"Network error — please try again.", ts:Date.now() }]);
    }
    setAiLoading(false);
  };

  const importModule = (sub, modKey, mod) => {
    setImportedMod({ subject:sub, modKey, title:mod.Title || modKey });
    setImportOpen(false);
    setMessages(p => [...p, {
      role:"ai",
      text:`Module imported: **${mod.Title || modKey}** from **${sub}**\n\nI'm now focused on this topic. Ask me anything — summaries, exam questions, concept explanations, or practice problems!`,
      ts:Date.now()
    }]);
  };

  /* ── Colors (exactly matching NotesPage) ── */
  const bg      = isDark ? "#080f1a"                : "#f5f8f5";
  const sidebar = isDark ? "rgba(8,15,26,0.96)"     : "rgba(255,255,255,0.75)";
  const header  = isDark ? "rgba(8,15,26,0.92)"     : "rgba(255,255,255,0.75)";
  const card    = isDark ? "rgba(15,23,42,0.85)"    : "#ffffff";
  const panel   = isDark ? "rgba(8,15,26,0.98)"     : "rgba(255,255,255,0.98)";
  const text1   = isDark ? "#f1f5f9"                : "#0f172a";
  const text2   = isDark ? "#94a3b8"                : "#475569";
  const text3   = isDark ? "#475569"                : "#94a3b8";
  const bdr     = isDark ? "rgba(0,255,0,0.1)"      : "rgba(0,200,0,0.1)";
  const inputBg = isDark ? "rgba(255,255,255,0.05)" : "#ffffff";

  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";
  const fullName  = userData?.fullName  || authUser?.displayName || "";
  const photoURL  = userData?.photoURL  || authUser?.photoURL    || "";
  const branch    = userData?.branch    || "";
  const sem       = userData?.sem       || "";

  /* ── Avatar ── */
  const AvatarEl = ({ size = 40 }) => (
    <div style={{ width:`${size}px`, height:`${size}px`, borderRadius:"9999px", border:"2.5px solid #00FF00", overflow:"hidden", background:isDark?"rgba(255,255,255,0.1)":"#e2e8f0", flexShrink:0 }}>
      {photoURL
        ? <img src={photoURL} alt={fullName} style={{ width:"100%", height:"100%", objectFit:"cover" }} referrerPolicy="no-referrer" />
        : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", background:"#00FF00", color:"#0f172a", fontSize:`${size*0.4}px`, fontWeight:900, fontFamily:"'Lexend',sans-serif" }}>
            {firstName?.[0]?.toUpperCase() || "?"}
          </div>
      }
    </div>
  );

  /* ── Format time ── */
  const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "";

  /* ── Active subject modules ── */
  const activeSubData  = importActiveSub ? importSubjects[importActiveSub] : null;
  const activeModules  = activeSubData?.modules
    ? Object.entries(activeSubData.modules).map(([key, mod]) => ({ key, ...mod }))
    : [];

  if (authLoading) return (
    <div style={{ display:"flex", height:"100vh", alignItems:"center", justifyContent:"center", background:bg }}>
      <div style={{ width:"32px", height:"32px", border:`3px solid ${bdr}`, borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;}
        body{font-family:'Lexend',sans-serif;background:${bg};color:${text1};overflow:hidden;transition:background 0.3s,color 0.3s;}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;line-height:1;display:inline-block;white-space:nowrap;direction:ltr;}

        /* ── Animations ── */
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.45;}}
        @keyframes msgPop{from{opacity:0;transform:translateY(10px) scale(0.97);}to{opacity:1;transform:none;}}
        @keyframes sheetSlideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
        @keyframes overlayIn{from{opacity:0;}to{opacity:1;}}
        @keyframes glow{0%,100%{box-shadow:0 0 12px rgba(0,255,0,0.25);}50%{box-shadow:0 0 24px rgba(0,255,0,0.5);}}

        /* ── Layout ── */
        .sb-root{display:flex;height:100vh;overflow:hidden;background:${bg};}

        /* ── Sidebar (exact match NotesPage) ── */
        .sb-sidebar{width:260px;min-width:260px;height:100vh;background:${sidebar};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-right:1px solid ${bdr};display:flex;flex-direction:column;padding:24px 20px;z-index:20;transition:width 0.3s,min-width 0.3s;}
        .sb-sidebar.collapsed{width:72px;min-width:72px;}
        .sb-sidebar.collapsed .sl{display:none;}
        .nav-link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9999px;font-size:13px;font-weight:600;color:${text2};transition:all 0.2s;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:'Lexend',sans-serif;}
        .nav-link:hover{background:rgba(0,200,0,0.08);color:${text1};}
        .nav-link.active{background:#00FF00;color:#0f172a;box-shadow:0 6px 20px rgba(0,255,0,0.28);}
        .nav-link.active .ms{color:#0f172a;}
        .nav-link.danger{color:#f87171;}
        .nav-link.danger:hover{background:rgba(248,113,113,0.1);}

        /* ── Main area ── */
        .sb-main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;}

        /* ── Desktop header ── */
        .sb-header{height:72px;background:${header};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 32px;display:flex;align-items:center;justify-content:space-between;z-index:10;flex-shrink:0;}

        /* ── Mobile header ── */
        .mob-header{display:none;height:64px;background:${header};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 16px;align-items:center;justify-content:space-between;gap:10px;z-index:10;flex-shrink:0;}

        /* ── Chat area ── */
        .chat-scroll{flex:1;overflow-y:auto;padding:28px 32px;display:flex;flex-direction:column;gap:20px;}
        .chat-scroll::-webkit-scrollbar{width:4px;}
        .chat-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.18);border-radius:2px;}

        /* ── Messages ── */
        .msg-ai{display:flex;gap:14px;animation:msgPop 0.28s cubic-bezier(0.34,1.56,0.64,1) both;}
        .msg-user{display:flex;gap:14px;flex-direction:row-reverse;animation:msgPop 0.28s cubic-bezier(0.34,1.56,0.64,1) both;}
        .bubble-ai{background:${card};border:1px solid ${bdr};border-radius:20px;border-top-left-radius:4px;padding:16px 20px;font-size:13px;line-height:1.75;color:${text1};max-width:72%;box-shadow:${isDark?"none":"0 2px 12px rgba(0,0,0,0.04)"};}
        .bubble-user{background:#00FF00;border-radius:20px;border-top-right-radius:4px;padding:14px 18px;font-size:13px;font-weight:600;color:#0f172a;max-width:72%;box-shadow:0 6px 20px rgba(0,255,0,0.25);line-height:1.65;}

        /* ── Input area ── */
        .input-wrap{padding:0 32px 24px;flex-shrink:0;}
        .input-shell{background:${card};border:1.5px solid ${bdr};border-radius:20px;overflow:hidden;transition:border-color 0.2s,box-shadow 0.2s;}
        .input-shell:focus-within{border-color:rgba(0,255,0,0.45);box-shadow:0 0 0 3px rgba(0,255,0,0.08);}
        .chat-input{background:transparent;border:none;outline:none;resize:none;width:100%;font-size:13px;font-family:'Lexend',sans-serif;color:${text1};line-height:1.6;padding:16px 20px 0;}
        .chat-input::placeholder{color:${text3};}

        /* ── Suggestion chips ── */
        .chip{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:9999px;border:1px solid ${bdr};background:${card};font-size:11px;font-weight:700;color:${text2};cursor:pointer;transition:all 0.18s;font-family:'Lexend',sans-serif;white-space:nowrap;}
        .chip:hover{background:rgba(0,200,0,0.09);border-color:rgba(0,200,0,0.3);color:${text1};}

        /* ── Import button ── */
        .btn-import{display:flex;align-items:center;gap:7px;padding:9px 16px;border-radius:9999px;border:1.5px solid rgba(0,200,0,0.3);background:rgba(0,200,0,0.07);font-size:12px;font-weight:700;color:#00AA00;cursor:pointer;transition:all 0.2s;font-family:'Lexend',sans-serif;white-space:nowrap;}
        .btn-import:hover{background:#00FF00;color:#0f172a;border-color:#00FF00;}
        .btn-import.active{background:#00FF00;color:#0f172a;border-color:#00FF00;animation:glow 2s ease-in-out infinite;}

        /* ── Send button ── */
        .btn-send{width:40px;height:40px;border-radius:12px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;flex-shrink:0;}
        .btn-send.ready{background:#00FF00;box-shadow:0 4px 14px rgba(0,255,0,0.35);}
        .btn-send.ready:hover{transform:scale(1.08);}
        .btn-send.empty{background:${isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)"};cursor:not-allowed;}

        /* ── AI typing dots ── */
        .typing-dot{width:7px;height:7px;border-radius:9999px;background:#00CC00;animation:pulse 1s ease-in-out infinite;}

        /* ── Import sheet overlay ── */
        .sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;backdrop-filter:blur(8px);animation:overlayIn 0.22s ease both;}

        /* ── Import panel (right drawer on desktop, bottom sheet on mobile) ── */
        .import-panel{position:fixed;right:0;top:0;bottom:0;width:480px;max-width:100vw;background:${panel};border-left:1px solid ${bdr};display:flex;flex-direction:column;z-index:201;box-shadow:-24px 0 80px rgba(0,0,0,0.25);animation:slideInRight 0.32s cubic-bezier(0.32,0.72,0,1) both;}
        @keyframes slideInRight{from{transform:translateX(100%);}to{transform:translateX(0);}}

        /* ── Subject tabs inside import panel ── */
        .sub-tab{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:12px;border:1.5px solid ${bdr};background:${card};cursor:pointer;transition:all 0.18s;font-family:'Lexend',sans-serif;-webkit-tap-highlight-color:transparent;}
        .sub-tab.active{border-color:#00FF00;background:${isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)"};}
        .sub-tab:hover:not(.active){background:rgba(0,200,0,0.05);}

        /* ── Module item in import panel ── */
        .mod-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:14px;border:1px solid ${bdr};background:${card};transition:all 0.18s;}
        .mod-item:hover{border-color:rgba(0,200,0,0.3);background:${isDark?"rgba(0,255,0,0.03)":"rgba(0,200,0,0.03)"};}
        .mod-item.imported{border-color:#00FF00;background:${isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)"};}

        /* ── Mobile bottom nav ── */
        .mob-nav{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:300;background:${isDark?"rgba(14,20,36,0.95)":"rgba(255,255,255,0.92)"};backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid ${isDark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.07)"};border-radius:9999px;padding:8px 20px;align-items:center;gap:4px;box-shadow:0 12px 48px rgba(0,0,0,0.22);}
        .mob-tab{width:52px;height:52px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1),background 0.18s;flex-shrink:0;}
        .mob-tab:active{transform:scale(0.8);}
        .mob-tab .ms{font-size:22px;color:${isDark?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.32)"};transition:color 0.18s;}
        .mob-tab.active{background:#00FF00;box-shadow:0 4px 22px rgba(0,255,0,0.55);transform:scale(1.12);}
        .mob-tab.active .ms{color:#0a1a0a;}

        /* ── Scrollbars in panel ── */
        .panel-scroll{overflow-y:auto;}
        .panel-scroll::-webkit-scrollbar{width:3px;}
        .panel-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.18);border-radius:2px;}

        /* ── Tool buttons ── */
        .tool-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9999px;border:1.5px solid rgba(0,200,0,0.25);background:rgba(0,200,0,0.07);font-size:11px;font-weight:700;color:#009900;cursor:pointer;transition:all 0.18s;font-family:'Lexend',sans-serif;white-space:nowrap;}
        .tool-pill:hover{background:rgba(0,200,0,0.15);border-color:rgba(0,200,0,0.4);color:#00FF00;}
        .tool-pill.active{background:#00FF00;border-color:#00FF00;color:#0f172a;box-shadow:0 4px 12px rgba(0,255,0,0.25);}

        /* ── Tools panel ── */
        .tools-scroll{display:flex;gap:8px;overflow-x:auto;padding:0 2px;align-items:center;}
        .tools-scroll::-webkit-scrollbar{height:2px;}
        .tools-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.15);border-radius:1px;}

        /* ── Responsive ── */
        @media(max-width:768px){
          .sb-sidebar{display:none!important;}
          .sb-header{display:none!important;}
          .mob-header{display:flex!important;}
          .mob-nav{display:flex!important;}
          .chat-scroll{padding:16px 12px 20px;}
          .input-wrap{padding:0 12px 120px;}
          .bubble-ai,.bubble-user{max-width:88%;}
          .chat-input{font-size:14px;}
          .import-panel{right:0;left:0;top:auto;bottom:0;width:100%;border-left:none;border-top:1px solid ${bdr};border-radius:24px 24px 0 0;max-height:90vh;animation:sheetSlideUp 0.35s cubic-bezier(0.32,0.72,0,1) both;}
          .chip{font-size:12px;padding:9px 12px;}
          .tool-pill{font-size:10px;padding:6px 10px;}
        }
        @media(max-width:480px){
          .bubble-ai,.bubble-user{max-width:92%;}
          .chat-input{font-size:15px;}
          .input-wrap{padding:0 10px 130px;}
          .chip{font-size:11px;padding:8px 11px;}
          .tool-pill{font-size:9px;padding:5px 9px;}
          .btn-import{font-size:11px;padding:8px 12px;}
        }
       ` }} />

      <div className="sb-root">

        {/* ══ SIDEBAR ══ */}
        <aside className={`sb-sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"40px", padding:"0 4px" }}>
            <div style={{ width:"40px", height:"40px", background:"#00FF00", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 0 16px rgba(0,255,0,0.35)" }}>
              <span className="ms" style={{ color:"#0f172a", fontSize:"22px" }}>school</span>
            </div>
            <div className="sl">
              <h1 style={{ fontSize:"1.1rem", fontWeight:700, letterSpacing:"-0.04em", color:text1, lineHeight:1 }}>Neural AI</h1>
              <p style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.12em", marginTop:"3px" }}>Study Assistant</p>
            </div>
          </div>

          <nav style={{ flex:1, display:"flex", flexDirection:"column", gap:"4px" }}>
            {NAV_ITEMS.slice(0, 4).map(({ id, icon, label, href }) => (
              <button key={id} className={`nav-link${id==="ai"?" active":""}`} onClick={() => router.push(href)}>
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

          {/* Sidebar footer — imported module context */}
          {importedMod && (
            <div className="sl" style={{ marginTop:"16px", padding:"14px", borderRadius:"14px", background:isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)", border:`1px solid ${bdr}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"6px" }}>
                <div style={{ width:"6px", height:"6px", borderRadius:"9999px", background:"#00FF00", boxShadow:"0 0 6px rgba(0,255,0,0.8)" }} />
                <span style={{ fontSize:"9px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.1em" }}>Active Context</span>
              </div>
              <p style={{ fontSize:"11px", fontWeight:700, color:text1, margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{importedMod.title}</p>
              <p style={{ fontSize:"10px", color:text2, margin:0 }}>{importedMod.subject}</p>
              <button onClick={() => setImportedMod(null)} style={{ marginTop:"8px", display:"flex", alignItems:"center", gap:"4px", background:"none", border:"none", cursor:"pointer", color:text3, fontSize:"10px", fontFamily:"'Lexend',sans-serif", fontWeight:600 }}>
                <span className="ms" style={{ fontSize:"13px" }}>close</span>
                Clear context
              </button>
            </div>
          )}
        </aside>

        {/* ══ MAIN ══ */}
        <main className="sb-main">

          {/* ── Desktop header ── */}
          <header className="sb-header">
            <div style={{ display:"flex", alignItems:"center", gap:"16px", flex:1 }}>
              <button
                onClick={() => setSidebarOpen(s => !s)}
                style={{ background:isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)", border:"none", borderRadius:"9999px", width:"36px", height:"36px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, transition:"background 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background=isDark?"rgba(255,255,255,0.1)":"rgba(0,200,0,0.14)"}
                onMouseLeave={e => e.currentTarget.style.background=isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)"}
              >
                <span className="ms" style={{ fontSize:"20px", color:text2 }}>menu</span>
              </button>

              {/* Title + context */}
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <h2 style={{ fontSize:"16px", fontWeight:700, color:text1, margin:0, letterSpacing:"-0.02em" }}>Neural AI</h2>
                  <span style={{ display:"flex", alignItems:"center", gap:"5px", padding:"2px 10px", borderRadius:"9999px", background:"rgba(0,200,0,0.1)", border:`1px solid ${bdr}` }}>
                    <div style={{ width:"5px", height:"5px", borderRadius:"9999px", background:"#00FF00", animation:"pulse 2s ease-in-out infinite" }} />
                    <span style={{ fontSize:"9px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.1em" }}>Online</span>
                  </span>
                </div>
                {importedMod
                  ? <p style={{ fontSize:"11px", color:"#009900", fontWeight:600, margin:0, marginTop:"1px" }}>
                      {importedMod.subject} · {importedMod.title}
                    </p>
                  : <p style={{ fontSize:"11px", color:text3, margin:0, marginTop:"1px" }}>
                      {branch || "Engineering"}{sem ? ` · ${sem}` : ""}
                    </p>
                }
              </div>
            </div>

            <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
              <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />
              <div style={{ width:"1px", height:"32px", background:bdr }} />
              <div style={{ display:"flex", alignItems:"center", gap:"10px", cursor:"pointer" }} onClick={() => router.push("/profile")}>
                <div style={{ textAlign:"right" }}>
                  <p style={{ fontSize:"12px", fontWeight:700, color:text1, lineHeight:1, margin:0 }}>{fullName||"—"}</p>
                  <p style={{ fontSize:"10px", color:text3, fontWeight:500, margin:"2px 0 0" }}>{branch||"No branch"}{sem?` · ${sem}`:""}</p>
                </div>
                <AvatarEl size={40} />
              </div>
            </div>
          </header>

          {/* ── Mobile header ── */}
          <header className="mob-header">
            <div style={{ width:"34px", height:"34px", background:"#00FF00", borderRadius:"9px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 12px rgba(0,255,0,0.4)", flexShrink:0 }}>
              <span className="ms" style={{ color:"#0f172a", fontSize:"18px" }}>psychology</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:0 }}>Neural AI</p>
              {importedMod && <p style={{ fontSize:"10px", color:"#009900", fontWeight:600, margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{importedMod.title}</p>}
            </div>
            <button onClick={() => router.push("/profile")} style={{ background:"none", border:"none", padding:0, cursor:"pointer", flexShrink:0 }}>
              <AvatarEl size={36} />
            </button>
          </header>

          {/* ══ CHAT MESSAGES ══ */}
          <div className="chat-scroll">

            {messages.map((msg, i) => (
              <div key={i} className={msg.role === "ai" ? "msg-ai" : "msg-user"} style={{ animationDelay:`${Math.min(i * 0.05, 0.3)}s` }}>

                {/* Avatar */}
                {msg.role === "ai" ? (
                  <div style={{ width:"36px", height:"36px", borderRadius:"10px", background:isDark?"rgba(0,255,0,0.12)":"rgba(0,200,0,0.1)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:"2px" }}>
                    <span className="ms" style={{ fontSize:"20px", color:"#00CC00" }}>psychology</span>
                  </div>
                ) : (
                  <div style={{ flexShrink:0, marginTop:"2px" }}>
                    <AvatarEl size={36} />
                  </div>
                )}

                {/* Bubble */}
                <div style={{ display:"flex", flexDirection:"column", gap:"5px", alignItems: msg.role==="user"?"flex-end":"flex-start", maxWidth:"72%" }}>
                  <span style={{ fontSize:"10px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em", paddingLeft: msg.role==="ai"?"4px":"0", paddingRight: msg.role==="user"?"4px":"0" }}>
                    {msg.role === "ai" ? "Neural AI" : (firstName || "You")}
                  </span>
                  <div className={msg.role === "ai" ? "bubble-ai" : "bubble-user"}>
                    {/* Render text with bold markdown (**text**) */}
                    {msg.text.split(/(\*\*[^*]+\*\*)/).map((part, pi) =>
                      part.startsWith("**") && part.endsWith("**")
                        ? <strong key={pi}>{part.slice(2, -2)}</strong>
                        : <span key={pi}>{part}</span>
                    )}
                  </div>
                  <span style={{ fontSize:"10px", color:text3 }}>{fmtTime(msg.ts)}</span>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {aiLoading && (
              <div className="msg-ai">
                <div style={{ width:"36px", height:"36px", borderRadius:"10px", background:isDark?"rgba(0,255,0,0.12)":"rgba(0,200,0,0.1)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <span className="ms" style={{ fontSize:"20px", color:"#00CC00" }}>psychology</span>
                </div>
                <div className="bubble-ai" style={{ display:"flex", alignItems:"center", gap:"7px", padding:"16px 20px" }}>
                  {[0,1,2].map(i => <div key={i} className="typing-dot" style={{ animationDelay:`${i*0.18}s` }} />)}
                </div>
              </div>
            )}

            {/* Suggestions — only on fresh start */}
            {messages.length === 1 && !aiLoading && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:"8px", animation:"fadeUp 0.4s 0.2s ease both", opacity:0, animationFillMode:"forwards" }}>
                {SUGGESTIONS.map(s => (
                  <button key={s.label} className="chip" onClick={() => send(s.label)}>
                    <span className="ms" style={{ fontSize:"16px", color:"#00CC00" }}>{s.icon}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ══ INPUT AREA ══ */}
          <div className="input-wrap">
            {/* Imported module pill */}
            {importedMod && (
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px", padding:"8px 14px", borderRadius:"12px", background:isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)", border:`1px solid ${bdr}` }}>
                <span className="ms" style={{ fontSize:"14px", color:"#00CC00" }}>library_books</span>
                <span style={{ fontSize:"11px", fontWeight:700, color:"#009900", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {importedMod.subject} · {importedMod.title}
                </span>
                <button onClick={() => setImportedMod(null)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
                  <span className="ms" style={{ fontSize:"14px", color:text3 }}>close</span>
                </button>
              </div>
            )}

            {/* Active tool pill */}
            {activeTool && (
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px", padding:"8px 14px", borderRadius:"12px", background:"rgba(0,255,0,0.1)", border:`1px solid rgba(0,255,0,0.3)` }}>
                <span className="ms" style={{ fontSize:"14px", color:"#00FF00" }}>star</span>
                <span style={{ fontSize:"11px", fontWeight:700, color:"#00FF00", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  Tool: {TOOLS.find(t => t.id === activeTool)?.name}
                </span>
                <button onClick={() => setActiveTool(null)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
                  <span className="ms" style={{ fontSize:"14px", color:"#00FF00" }}>close</span>
                </button>
              </div>
            )}

            {/* Tools panel */}
            {toolsOpen && (
              <div style={{ marginBottom:"10px", padding:"10px 12px", borderRadius:"12px", background:isDark?"rgba(0,255,0,0.04)":"rgba(0,200,0,0.03)", border:`1px solid ${bdr}` }}>
                <div className="tools-scroll">
                  {TOOLS.map(tool => (
                    <button
                      key={tool.id}
                      className={`tool-pill${activeTool === tool.id ? " active" : ""}`}
                      onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
                      title={tool.desc}
                    >
                      <span className="ms" style={{ fontSize:"13px" }}>{tool.icon}</span>
                      {tool.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-shell">
              {/* Toolbar row */}
              <div style={{ display:"flex", alignItems:"center", gap:"6px", padding:"10px 14px 8px", borderBottom:`1px solid ${bdr}`, flexWrap:"wrap" }}>
                <button className={`btn-import${importedMod?" active":""}`} onClick={() => setImportOpen(true)}>
                  <span className="ms" style={{ fontSize:"14px" }}>import_contacts</span>
                  {importedMod ? "Module" : "Import"}
                </button>
                <button 
                  onClick={() => setToolsOpen(!toolsOpen)}
                  style={{ display:"flex", alignItems:"center", gap:"6px", padding:"8px 12px", borderRadius:"9999px", border:`1.5px solid ${bdr}`, background:toolsOpen?"rgba(0,255,0,0.12)":"transparent", fontSize:"12px", fontWeight:700, color:toolsOpen?"#00FF00":text2, cursor:"pointer", transition:"all 0.2s", fontFamily:"'Lexend',sans-serif", whiteSpace:"nowrap" }}
                >
                  <span className="ms" style={{ fontSize:"14px" }}>tune</span>
                  Tools
                </button>
                <div style={{ flex:1 }} />
                <span style={{ fontSize:"10px", color:text3, fontWeight:600 }}>Enter to send</span>
              </div>

              {/* Text + send */}
              <div style={{ display:"flex", alignItems:"flex-end", gap:"10px", padding:"6px 14px 14px" }}>
                <textarea
                  className="chat-input"
                  rows={2}
                  placeholder={importedMod ? `Ask about "${importedMod.title}"…` : "Ask anything about your coursework…"}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                <button
                  className={`btn-send${input.trim() && !aiLoading ? " ready" : " empty"}`}
                  onClick={() => send()}
                  disabled={!input.trim() || aiLoading}
                >
                  <span className="ms" style={{ fontSize:"20px", color: input.trim() && !aiLoading ? "#0f172a" : text3 }}>
                    {aiLoading ? "hourglass_top" : "send"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ══ MOBILE BOTTOM NAV ══ */}
      <nav className="mob-nav">
        {NAV_ITEMS.slice(0, 4).map(({ id, icon, href }) => (
          <button key={id} className={`mob-tab${id==="ai"?" active":""}`} onClick={() => router.push(href)}>
            <span className="ms">{icon}</span>
          </button>
        ))}
        <button className="mob-tab" onClick={() => router.push("/profile")}>
          <span className="ms">person</span>
        </button>
      </nav>

      {/* ══ IMPORT MODULE PANEL ══ */}
      {importOpen && (
        <>
          <div className="sheet-overlay" onClick={() => setImportOpen(false)} />
          <div className="import-panel">

            {/* Drag handle (mobile) */}
            <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 4px", flexShrink:0 }}>
              <div style={{ width:"36px", height:"4px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.1)" }} />
            </div>

            {/* Panel header */}
            <div style={{ padding:"8px 20px 16px", borderBottom:`1px solid ${bdr}`, flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{ width:"38px", height:"38px", borderRadius:"11px", background:"rgba(0,200,0,0.1)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <span className="ms" style={{ fontSize:"22px", color:"#00CC00" }}>import_contacts</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize:"15px", fontWeight:700, color:text1, margin:0 }}>Import Module</h3>
                    <p style={{ fontSize:"11px", color:text2, margin:0, marginTop:"1px" }}>
                      {branch && sem ? `${branch} · ${sem}` : "Select a module to set as context"}
                    </p>
                  </div>
                </div>
                <button onClick={() => setImportOpen(false)} style={{ width:"34px", height:"34px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span className="ms" style={{ fontSize:"20px", color:text2 }}>close</span>
                </button>
              </div>
            </div>

            {importLoading ? (
              <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:"14px" }}>
                <div style={{ width:"24px", height:"24px", border:`3px solid ${bdr}`, borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />
                <span style={{ fontSize:"13px", color:text2 }}>Loading subjects…</span>
              </div>
            ) : !branch || !sem ? (
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px", padding:"32px" }}>
                <span className="ms" style={{ fontSize:"48px", color:text3 }}>person_off</span>
                <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:0 }}>Branch/sem not set</p>
                <p style={{ fontSize:"12px", color:text2, margin:0, textAlign:"center" }}>Update your profile to load your subjects and modules.</p>
                <button onClick={() => { setImportOpen(false); router.push("/profile"); }} style={{ marginTop:"8px", padding:"10px 20px", borderRadius:"12px", background:"#00FF00", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:700, color:"#0f172a", fontFamily:"'Lexend',sans-serif" }}>
                  Go to Profile
                </button>
              </div>
            ) : Object.keys(importSubjects).length === 0 ? (
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px", padding:"32px", opacity:0.6 }}>
                <span className="ms" style={{ fontSize:"48px", color:text3 }}>folder_off</span>
                <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:0 }}>No subjects found</p>
              </div>
            ) : (
              <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

                {/* ── Left: Subject list ── */}
                <div style={{ width:"160px", minWidth:"160px", borderRight:`1px solid ${bdr}`, padding:"14px 10px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"6px" }} className="panel-scroll">
                  <p style={{ fontSize:"9px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em", padding:"0 6px 8px" }}>Subjects</p>
                  {Object.entries(importSubjects).map(([code, data]) => {
                    const { icon, color } = getSubjectMeta(code);
                    const label = typeof data?.Subject === "string" ? data.Subject : code;
                    const active = importActiveSub === code;
                    return (
                      <button
                        key={code}
                        className={`sub-tab${active ? " active" : ""}`}
                        onClick={() => setImportActiveSub(code)}
                      >
                        <div style={{ width:"28px", height:"28px", borderRadius:"8px", background:active?"rgba(0,255,0,0.15)":`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <span className="ms" style={{ fontSize:"16px", color:active?"#00CC00":color }}>{icon}</span>
                        </div>
                        <span style={{ fontSize:"11px", fontWeight:700, color:active?(isDark?"#00FF00":"#007700"):text1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* ── Right: Module list ── */}
                <div style={{ flex:1, padding:"14px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"8px" }} className="panel-scroll">
                  <p style={{ fontSize:"9px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em", padding:"0 2px 8px" }}>
                    Modules — {importActiveSub}
                    <span style={{ marginLeft:"6px", padding:"1px 7px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", fontSize:"9px", fontWeight:700 }}>
                      {activeModules.length}
                    </span>
                  </p>

                  {activeModules.length === 0 ? (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"32px 16px", gap:"10px", opacity:0.5 }}>
                      <span className="ms" style={{ fontSize:"36px", color:text3 }}>folder_open</span>
                      <p style={{ fontSize:"12px", color:text2, margin:0 }}>No modules in this subject</p>
                    </div>
                  ) : activeModules.map((mod, i) => {
                    const isImported = importedMod?.subject === importActiveSub && importedMod?.modKey === mod.key;
                    return (
                      <div key={mod.key} className={`mod-item${isImported ? " imported" : ""}`} style={{ animationDelay:`${i*0.04}s`, animation:"fadeUp 0.3s ease both" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"12px", flex:1, minWidth:0 }}>
                          <div style={{ width:"38px", height:"38px", minWidth:"38px", borderRadius:"10px", background:isImported?"rgba(0,255,0,0.12)":(isDark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)"), display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <span className="ms" style={{ fontSize:"20px", color:isImported?"#00CC00":text3 }}>
                              {mod.resourcesPDF ? "picture_as_pdf" : "menu_book"}
                            </span>
                          </div>
                          <div style={{ minWidth:0, flex:1 }}>
                            <p style={{ fontSize:"12px", fontWeight:700, color:text1, margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              <span style={{ display:"inline-flex", alignItems:"center", marginRight:"6px", padding:"1px 6px", background:"rgba(0,200,0,0.1)", border:"1px solid rgba(0,200,0,0.2)", borderRadius:"9999px", fontSize:"9px", fontWeight:700, color:"#009900" }}>
                                {mod.key.replace("module","M")}
                              </span>
                              {mod.Title || "Untitled Module"}
                            </p>
                            <p style={{ fontSize:"10px", color:text3, margin:0 }}>
                              {isImported ? (
                                <span style={{ color:"#009900", fontWeight:700 }}>✓ Active context</span>
                              ) : "Click to set as context"}
                            </p>
                          </div>
                        </div>
                        {isImported ? (
                          <button
                            onClick={() => setImportedMod(null)}
                            style={{ padding:"7px 12px", borderRadius:"9px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", color:"#ef4444", fontSize:"11px", fontWeight:700, cursor:"pointer", fontFamily:"'Lexend',sans-serif", flexShrink:0, display:"flex", alignItems:"center", gap:"4px" }}
                          >
                            <span className="ms" style={{ fontSize:"14px" }}>close</span>
                            Remove
                          </button>
                        ) : (
                          <button
                            onClick={() => importModule(importActiveSub, mod.key, mod)}
                            style={{ padding:"7px 12px", borderRadius:"9px", background:"rgba(0,200,0,0.09)", border:"1px solid rgba(0,200,0,0.25)", color:"#009900", fontSize:"11px", fontWeight:700, cursor:"pointer", fontFamily:"'Lexend',sans-serif", flexShrink:0, display:"flex", alignItems:"center", gap:"4px", transition:"all 0.18s" }}
                            onMouseEnter={e => { e.currentTarget.style.background="#00FF00"; e.currentTarget.style.color="#0f172a"; }}
                            onMouseLeave={e => { e.currentTarget.style.background="rgba(0,200,0,0.09)"; e.currentTarget.style.color="#009900"; }}
                          >
                            <span className="ms" style={{ fontSize:"14px" }}>add</span>
                            Import
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}