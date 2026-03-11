"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref as dbRef, onValue, get } from "firebase/database";

/* ─────────────────────────────────────────
   CHUNK REASSEMBLY
   Reads pdfChunks/chunk_0 … chunk_N from
   Firebase and rebuilds the base64 PDF
───────────────────────────────────────── */
async function reassemblePDF(db, modulePath) {
  // modulePath = notes/IT/Sem:3/subjects/CN/modules/module1
  const metaSnap = await get(dbRef(db, `${modulePath}/pdfMeta`));
  if (!metaSnap.exists()) throw new Error("No PDF metadata found for this module.");
  const { totalChunks } = metaSnap.val();

  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const snap = await get(dbRef(db, `${modulePath}/pdfChunks/chunk_${i}`));
    if (!snap.exists()) throw new Error(`Missing chunk ${i}`);
    chunks.push(snap.val());
  }

  const base64 = chunks.join("");
  // Convert base64 → Uint8Array
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

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
    const update = () => setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);
  return { theme, setTheme, resolved };
}

const NAV_ITEMS = [
  { id: "dashboard", icon: "dashboard",   label: "Dashboard",  href: "/dashboard" },
  { id: "notes",     icon: "description", label: "Notes",      href: "/notes"     },
  { id: "test",      icon: "quiz",        label: "Test",       href: "/test"      },
  { id: "ai",        icon: "psychology",  label: "Neural AI",  href: "/ai"        },
];

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   Usage: /pdf-viewer?branch=IT&sem=Sem:3&subject=CN&module=module1
═══════════════════════════════════════════ */
export default function PDFViewerPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { resolved } = useTheme();
  const isDark       = resolved === "dark";

  const canvasRef    = useRef(null);
  const containerRef = useRef(null);

  /* Route params */
  const branch    = searchParams.get("branch")  || "";
  const sem       = searchParams.get("sem")     || "";
  const subject   = searchParams.get("subject") || "";
  const moduleKey = searchParams.get("module")  || "";

  /* Auth */
  const [authUser,    setAuthUser]    = useState(null);
  const [userData,    setUserData]    = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  /* PDF.js state */
  const [pdfDoc,      setPdfDoc]      = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages,  setTotalPages]  = useState(0);
  const [scale,       setScale]       = useState(1.4);
  const [loadStatus,  setLoadStatus]  = useState("idle"); // idle|loading|ready|error
  const [loadMsg,     setLoadMsg]     = useState("");
  const [loadPct,     setLoadPct]     = useState(0);
  const [rendering,   setRendering]   = useState(false);

  /* Module info */
  const [moduleTitle, setModuleTitle] = useState("");

  /* AI chat */
  const [chatOpen,    setChatOpen]    = useState(true);
  const [chatInput,   setChatInput]   = useState("");
  const [messages,    setMessages]    = useState([
    { role: "ai", text: "Hi! I've loaded your PDF. Ask me anything about it, or use the quick tools below." }
  ]);
  const [aiLoading,   setAiLoading]   = useState(false);
  const chatEndRef = useRef(null);

  /* Colors */
  const bg     = isDark ? "#080f1a"              : "#f0f4f0";
  const panel  = isDark ? "rgba(8,15,26,0.97)"   : "rgba(255,255,255,0.92)";
  const card   = isDark ? "rgba(15,23,42,0.9)"   : "#ffffff";
  const text1  = isDark ? "#f1f5f9"              : "#0f172a";
  const text2  = isDark ? "#94a3b8"              : "#475569";
  const text3  = isDark ? "#475569"              : "#94a3b8";
  const bdr    = isDark ? "rgba(0,255,0,0.1)"    : "rgba(0,200,0,0.12)";

  /* ── Auth guard ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      onValue(dbRef(db, `users/${u.uid}`), (snap) => {
        if (snap.exists()) setUserData(snap.val());
        setAuthLoading(false);
      });
    });
    return () => unsub();
  }, [router]);

  /* ── Load module title ── */
  useEffect(() => {
    if (!branch || !sem || !subject || !moduleKey) return;
    const r = dbRef(db, `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}/Title`);
    get(r).then(snap => { if (snap.exists()) setModuleTitle(snap.val()); });
  }, [branch, sem, subject, moduleKey]);

  /* ── Load PDF.js from CDN + reassemble PDF ── */
  useEffect(() => {
    if (!branch || !sem || !subject || !moduleKey || authLoading) return;

    setLoadStatus("loading");
    setLoadMsg("Loading PDF engine…");
    setLoadPct(5);

    // Dynamically load PDF.js
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = async () => {
      try {
        const pdfjsLib = window["pdfjs-dist/build/pdf"];
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

        setLoadMsg("Fetching PDF chunks from Firebase…");
        setLoadPct(15);

        const modulePath = `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}`;
        const metaSnap = await get(dbRef(db, `${modulePath}/pdfMeta`));
        if (!metaSnap.exists()) throw new Error("No PDF uploaded for this module yet.");
        const { totalChunks } = metaSnap.val();

        const chunks = [];
        for (let i = 0; i < totalChunks; i++) {
          const snap = await get(dbRef(db, `${modulePath}/pdfChunks/chunk_${i}`));
          if (!snap.exists()) throw new Error(`Missing chunk ${i} of ${totalChunks}`);
          chunks.push(snap.val());
          const pct = 15 + Math.round(((i + 1) / totalChunks) * 60);
          setLoadPct(pct);
          setLoadMsg(`Loading chunk ${i + 1} of ${totalChunks}…`);
        }

        setLoadMsg("Assembling PDF…");
        setLoadPct(80);

        const base64 = chunks.join("");
        const binary = atob(base64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        setLoadMsg("Rendering…");
        setLoadPct(90);

        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        setLoadStatus("ready");
        setLoadPct(100);
      } catch (err) {
        setLoadStatus("error");
        setLoadMsg(err.message);
      }
    };
    script.onerror = () => {
      setLoadStatus("error");
      setLoadMsg("Failed to load PDF engine. Check your internet connection.");
    };
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, [branch, sem, subject, moduleKey, authLoading]);

  /* ── Render page ── */
  const renderPage = useCallback(async (doc, pageNum, sc) => {
    if (!doc || !canvasRef.current) return;
    setRendering(true);
    try {
      const page     = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: sc });
      const canvas   = canvasRef.current;
      const ctx      = canvas.getContext("2d");
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {}
    setRendering(false);
  }, []);

  useEffect(() => {
    if (pdfDoc && loadStatus === "ready") renderPage(pdfDoc, currentPage, scale);
  }, [pdfDoc, currentPage, scale, loadStatus, renderPage]);

  /* ── Scroll chat to bottom ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── AI chat ── */
  const sendMessage = async (text) => {
    if (!text.trim() || aiLoading) return;
    const userMsg = text.trim();
    setChatInput("");
    setMessages(m => [...m, { role: "user", text: userMsg }]);
    setAiLoading(true);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are StudyBuddy AI — an engineering exam assistant embedded in a PDF viewer. 
The student is viewing: "${moduleTitle || moduleKey}" from subject "${subject}", semester "${sem}".
Give concise, exam-focused answers. Use bullet points when listing. Keep answers under 200 words unless asked to elaborate.`,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response.";
      setMessages(m => [...m, { role: "ai", text: reply }]);
    } catch {
      setMessages(m => [...m, { role: "ai", text: "Network error. Please try again." }]);
    }
    setAiLoading(false);
  };

  const quickActions = [
    { icon: "summarize",    label: "Summarize",   prompt: `Summarize the key points of "${moduleTitle || moduleKey}" in bullet points for exam preparation.` },
    { icon: "quiz",         label: "Quiz me",     prompt: `Generate 5 short exam questions with answers based on "${moduleTitle || moduleKey}".` },
    { icon: "lightbulb",    label: "Key concepts",prompt: `List the most important concepts from "${moduleTitle || moduleKey}" I need to know for exams.` },
    { icon: "psychology",   label: "Explain",     prompt: `Explain the core topic of "${moduleTitle || moduleKey}" in simple terms like I'm hearing it for the first time.` },
  ];

  const fullName = userData?.fullName  || authUser?.displayName || "";
  const photoURL = userData?.photoURL  || authUser?.photoURL    || "";
  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";

  const AvatarEl = ({ size = 36 }) => (
    <div style={{ width:`${size}px`, height:`${size}px`, borderRadius:"9999px", border:"2px solid #00FF00", overflow:"hidden", background:isDark?"rgba(255,255,255,0.1)":"#e2e8f0", flexShrink:0 }}>
      {photoURL
        ? <img src={photoURL} alt={fullName} style={{ width:"100%", height:"100%", objectFit:"cover" }} referrerPolicy="no-referrer" />
        : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", background:"#00FF00", color:"#0f172a", fontSize:`${size*0.4}px`, fontWeight:900, fontFamily:"'Lexend',sans-serif" }}>
            {firstName?.[0]?.toUpperCase() || "?"}
          </div>
      }
    </div>
  );

  if (authLoading) return null;

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
        @keyframes msgPop{from{opacity:0;transform:translateY(8px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}

        .viewer-root{display:flex;flex-direction:column;height:100vh;overflow:hidden;background:${bg};}

        /* Top bar */
        .top-bar{height:60px;background:${panel};backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};display:flex;align-items:center;padding:0 20px;gap:16px;flex-shrink:0;z-index:30;}

        /* Body */
        .viewer-body{flex:1;display:flex;overflow:hidden;}

        /* PDF area */
        .pdf-area{flex:1;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:32px 24px 120px;background:${isDark?"#0a1628":"#e8ede8"};}
        .pdf-area::-webkit-scrollbar{width:4px;}
        .pdf-area::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}

        /* PDF canvas wrapper */
        .canvas-wrap{background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.18);overflow:hidden;max-width:100%;}
        canvas{display:block;max-width:100%;height:auto;}

        /* Controls bar */
        .ctrl-bar{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:${isDark?"rgba(15,23,42,0.95)":"rgba(15,23,42,0.9)"};backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:9999px;padding:10px 24px;display:flex;align-items:center;gap:20px;z-index:40;box-shadow:0 8px 32px rgba(0,0,0,0.3);}
        .ctrl-btn{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);display:flex;align-items:center;justify-content:center;padding:4px;border-radius:8px;transition:all 0.18s;}
        .ctrl-btn:hover{color:#00FF00;background:rgba(0,255,0,0.1);}
        .ctrl-btn:disabled{opacity:0.3;cursor:not-allowed;}
        .ctrl-divider{width:1px;height:20px;background:rgba(255,255,255,0.15);}

        /* AI Sidebar */
        .ai-sidebar{width:360px;min-width:360px;height:100%;background:${panel};backdrop-filter:blur(12px);border-left:1px solid ${bdr};display:flex;flex-direction:column;z-index:20;transition:width 0.3s ease,min-width 0.3s ease;}
        .ai-sidebar.closed{width:0;min-width:0;overflow:hidden;}

        .chat-scroll{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;}
        .chat-scroll::-webkit-scrollbar{width:3px;}
        .chat-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}

        .msg-ai{background:${isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)"};border:1px solid ${bdr};border-radius:16px;border-top-left-radius:4px;padding:12px 14px;font-size:12px;color:${text1};line-height:1.65;animation:msgPop 0.25s ease both;}
        .msg-user{background:#00FF00;color:#0f172a;border-radius:16px;border-bottom-right-radius:4px;padding:12px 14px;font-size:12px;font-weight:600;line-height:1.65;align-self:flex-end;max-width:85%;animation:msgPop 0.25s ease both;}

        .quick-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:${isDark?"rgba(255,255,255,0.04)":"rgba(0,200,0,0.05)"};border:1px solid ${bdr};border-radius:10px;cursor:pointer;font-size:11px;font-weight:700;color:${text2};font-family:'Lexend',sans-serif;transition:all 0.18s;text-align:left;}
        .quick-btn:hover{background:rgba(0,200,0,0.1);color:${text1};border-color:rgba(0,200,0,0.3);}

        .chat-input-wrap{padding:12px;border-top:1px solid ${bdr};background:${panel};}
        .chat-input{width:100%;background:${isDark?"rgba(255,255,255,0.05)":"rgba(0,200,0,0.04)"};border:1px solid ${bdr};border-radius:12px;padding:10px 44px 10px 14px;font-size:12px;font-family:'Lexend',sans-serif;color:${text1};outline:none;resize:none;min-height:44px;max-height:120px;transition:border-color 0.2s;}
        .chat-input:focus{border-color:rgba(0,255,0,0.4);}
        .chat-input::placeholder{color:${text3};}

        .progress-track{width:100%;height:6px;background:rgba(255,255,255,0.1);border-radius:9999px;overflow:hidden;}
        .progress-fill{height:100%;background:linear-gradient(90deg,#00AA00,#00FF00,#00AA00);background-size:200% 100%;animation:shimmer 1.5s linear infinite;border-radius:9999px;transition:width 0.3s;}

        @media(max-width:768px){
          .ai-sidebar{position:fixed;right:0;top:60px;bottom:0;width:100%!important;min-width:0!important;z-index:50;}
          .ai-sidebar.closed{width:0!important;}
        }
      `}</style>

      <div className="viewer-root">

        {/* ── TOP BAR ── */}
        <div className="top-bar">
          {/* Back */}
          <button
            onClick={() => router.push("/notes")}
            style={{ display:"flex", alignItems:"center", gap:"6px", background:"none", border:"none", cursor:"pointer", color:text2, fontSize:"13px", fontWeight:600, fontFamily:"'Lexend',sans-serif", flexShrink:0 }}
          >
            <span className="ms" style={{ fontSize:"20px" }}>arrow_back</span>
            Notes
          </button>

          <div style={{ width:"1px", height:"24px", background:bdr, flexShrink:0 }} />

          {/* Title */}
          <div style={{ display:"flex", alignItems:"center", gap:"10px", flex:1, minWidth:0 }}>
            <span className="ms" style={{ fontSize:"22px", color:"#ef4444", flexShrink:0 }}>picture_as_pdf</span>
            <div style={{ minWidth:0 }}>
              <p style={{ fontSize:"13px", fontWeight:700, color:text1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {moduleTitle || moduleKey || "PDF Viewer"}
              </p>
              <p style={{ fontSize:"10px", color:text3, margin:0 }}>{subject} · {sem} · {branch}</p>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display:"flex", alignItems:"center", gap:"8px", flexShrink:0 }}>
            {/* Download */}
            {pdfDoc && (
              <button
                title="Download PDF"
                onClick={async () => {
                  const meta = await get(dbRef(db, `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}/pdfMeta`));
                  const fn = meta.val()?.fileName || `${moduleKey}.pdf`;
                  const canvas = canvasRef.current;
                  if (!canvas) return;
                  // Reassemble and download
                  const modulePath = `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}`;
                  const buf = await reassemblePDF(db, modulePath);
                  const blob = new Blob([buf], { type:"application/pdf" });
                  const url  = URL.createObjectURL(blob);
                  const a    = document.createElement("a");
                  a.href = url; a.download = fn; a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 3000);
                }}
                style={{ width:"36px", height:"36px", borderRadius:"10px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}
              >
                <span className="ms" style={{ fontSize:"20px", color:text2 }}>download</span>
              </button>
            )}

            {/* Toggle AI panel */}
            <button
              onClick={() => setChatOpen(o => !o)}
              style={{ display:"flex", alignItems:"center", gap:"6px", padding:"8px 14px", background:chatOpen?"#00FF00":"none", border:`1px solid ${chatOpen?"#00FF00":bdr}`, borderRadius:"10px", cursor:"pointer", fontSize:"12px", fontWeight:700, color:chatOpen?"#0f172a":text2, fontFamily:"'Lexend',sans-serif", transition:"all 0.2s" }}
            >
              <span className="ms" style={{ fontSize:"18px" }}>psychology</span>
              {chatOpen ? "Hide AI" : "AI Chat"}
            </button>

            <AvatarEl size={36} />
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="viewer-body">

          {/* PDF canvas area */}
          <div className="pdf-area" ref={containerRef}>

            {/* Loading state */}
            {loadStatus === "loading" && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flex:1, gap:"20px", minHeight:"60vh", animation:"fadeUp 0.3s ease both" }}>
                <div style={{ width:"72px", height:"72px", borderRadius:"18px", background:"rgba(0,255,0,0.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <div style={{ width:"32px", height:"32px", border:"3px solid rgba(0,255,0,0.2)", borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.8s linear infinite" }} />
                </div>
                <div style={{ textAlign:"center" }}>
                  <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:"0 0 6px" }}>{loadMsg}</p>
                  <p style={{ fontSize:"12px", color:text3, margin:"0 0 16px" }}>Reassembling chunks from Firebase…</p>
                  <div style={{ width:"280px" }}>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width:`${loadPct}%` }} />
                    </div>
                    <p style={{ fontSize:"11px", color:"#00AA00", fontWeight:700, marginTop:"8px" }}>{loadPct}%</p>
                  </div>
                </div>
              </div>
            )}

            {/* Error state */}
            {loadStatus === "error" && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flex:1, gap:"16px", minHeight:"60vh", animation:"fadeUp 0.3s ease both" }}>
                <div style={{ width:"72px", height:"72px", borderRadius:"18px", background:"rgba(239,68,68,0.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span className="ms" style={{ fontSize:"36px", color:"#ef4444" }}>error</span>
                </div>
                <div style={{ textAlign:"center" }}>
                  <p style={{ fontSize:"15px", fontWeight:700, color:text1, margin:"0 0 6px" }}>Failed to load PDF</p>
                  <p style={{ fontSize:"12px", color:text3, margin:0 }}>{loadMsg}</p>
                </div>
                <button onClick={() => router.push("/notes")} style={{ padding:"10px 20px", background:"#00FF00", color:"#0f172a", border:"none", borderRadius:"10px", fontWeight:700, fontSize:"13px", cursor:"pointer", fontFamily:"'Lexend',sans-serif" }}>
                  Back to Notes
                </button>
              </div>
            )}

            {/* PDF Canvas */}
            {loadStatus === "ready" && (
              <div className="canvas-wrap" style={{ opacity: rendering ? 0.7 : 1, transition:"opacity 0.2s" }}>
                <canvas ref={canvasRef} />
              </div>
            )}
          </div>

          {/* ── AI SIDEBAR ── */}
          <aside className={`ai-sidebar${chatOpen ? "" : " closed"}`}>
            {/* Header */}
            <div style={{ padding:"16px 20px", borderBottom:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                <div style={{ width:"34px", height:"34px", borderRadius:"10px", background:"rgba(0,255,0,0.12)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span className="ms" style={{ fontSize:"20px", color:"#00CC00" }}>psychology</span>
                </div>
                <div>
                  <p style={{ fontSize:"13px", fontWeight:700, color:text1, margin:0 }}>Neural AI</p>
                  <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
                    <div style={{ width:"6px", height:"6px", borderRadius:"9999px", background:"#00FF00", animation:"pulse 2s ease-in-out infinite" }} />
                    <p style={{ fontSize:"10px", color:"#00AA00", fontWeight:700, margin:0 }}>Online</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:text3 }}>
                <span className="ms" style={{ fontSize:"20px" }}>close</span>
              </button>
            </div>

            {/* Quick actions */}
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${bdr}`, display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", flexShrink:0 }}>
              {quickActions.map(({icon,label,prompt}) => (
                <button key={label} className="quick-btn" onClick={() => sendMessage(prompt)}>
                  <span className="ms" style={{ fontSize:"16px", color:"#00CC00" }}>{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div className="chat-scroll">
              {messages.map((msg, i) => (
                <div key={i} className={msg.role === "ai" ? "msg-ai" : "msg-user"}>
                  {msg.role === "ai" && (
                    <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"6px" }}>
                      <span className="ms" style={{ fontSize:"14px", color:"#00CC00" }}>auto_awesome</span>
                      <span style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.08em" }}>StudyBuddy AI</span>
                    </div>
                  )}
                  <p style={{ margin:0, whiteSpace:"pre-wrap" }}>{msg.text}</p>
                </div>
              ))}
              {aiLoading && (
                <div className="msg-ai" style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width:"8px", height:"8px", borderRadius:"9999px", background:"#00CC00", animation:`pulse 1s ease-in-out ${i*0.2}s infinite` }} />
                  ))}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="chat-input-wrap">
              <div style={{ position:"relative" }}>
                <textarea
                  className="chat-input"
                  placeholder="Ask anything about this PDF…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput); } }}
                  rows={2}
                />
                <button
                  onClick={() => sendMessage(chatInput)}
                  disabled={!chatInput.trim() || aiLoading}
                  style={{ position:"absolute", right:"10px", bottom:"10px", width:"32px", height:"32px", background:"#00FF00", border:"none", borderRadius:"9px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", opacity:(!chatInput.trim()||aiLoading)?0.4:1, transition:"opacity 0.2s" }}
                >
                  <span className="ms" style={{ fontSize:"18px", color:"#0f172a" }}>send</span>
                </button>
              </div>
              <p style={{ fontSize:"9px", color:text3, textAlign:"center", marginTop:"8px" }}>Press Enter to send · Shift+Enter for new line</p>
            </div>
          </aside>
        </div>

        {/* ── PAGE CONTROLS ── */}
        {loadStatus === "ready" && (
          <div className="ctrl-bar">
            {/* Page nav */}
            <button className="ctrl-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
              <span className="ms" style={{ fontSize:"22px" }}>chevron_left</span>
            </button>
            <span style={{ fontSize:"12px", fontWeight:600, color:"rgba(255,255,255,0.8)", whiteSpace:"nowrap" }}>
              {currentPage} / {totalPages}
            </span>
            <button className="ctrl-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
              <span className="ms" style={{ fontSize:"22px" }}>chevron_right</span>
            </button>

            <div className="ctrl-divider" />

            {/* Zoom */}
            <button className="ctrl-btn" onClick={() => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))}>
              <span className="ms" style={{ fontSize:"22px" }}>remove</span>
            </button>
            <span style={{ fontSize:"12px", fontWeight:600, color:"rgba(255,255,255,0.8)", whiteSpace:"nowrap" }}>
              {Math.round(scale * 100)}%
            </span>
            <button className="ctrl-btn" onClick={() => setScale(s => Math.min(3, +(s + 0.2).toFixed(1)))}>
              <span className="ms" style={{ fontSize:"22px" }}>add</span>
            </button>

            <div className="ctrl-divider" />

            {/* Fit width */}
            <button
              className="ctrl-btn"
              title="Fit to width"
              onClick={() => {
                if (containerRef.current) {
                  const w = containerRef.current.clientWidth - 64;
                  if (pdfDoc) pdfDoc.getPage(currentPage).then(p => {
                    const vp = p.getViewport({ scale: 1 });
                    setScale(+(w / vp.width).toFixed(2));
                  });
                }
              }}
            >
              <span className="ms" style={{ fontSize:"22px" }}>fit_width</span>
            </button>

            {/* Toggle rendering indicator */}
            {rendering && (
              <div style={{ width:"16px", height:"16px", border:"2px solid rgba(0,255,0,0.3)", borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />
            )}
          </div>
        )}
      </div>
    </>
  );
}