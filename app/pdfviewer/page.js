"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref as dbRef, get } from "firebase/database";

/* ─────────────────────────────────────────
   IN-MEMORY PDF CACHE
───────────────────────────────────────── */
const PDF_CACHE = new Map();
function getCacheKey(branch, sem, subject, moduleKey) {
  return `${branch}|${sem}|${subject}|${moduleKey}`;
}

/* ─────────────────────────────────────────
   SECURITY: Validate user has access
   Also validates the exact moduleKey exists
   in their branch/sem — prevents URL forking
───────────────────────────────────────── */
async function validateAccess(db, uid, requestedBranch, requestedSem, requestedSubject, requestedModule) {
  const snap = await get(dbRef(db, `users/${uid}`));
  if (!snap.exists()) return { allowed: false, reason: "User not found." };
  const { branch, sem, isAdmin } = snap.val();

  if (isAdmin === true) {
    // Admin: still verify module exists
    const modSnap = await get(dbRef(db, `notes/${requestedBranch}/${requestedSem}/subjects/${requestedSubject}/modules/${requestedModule}`));
    if (!modSnap.exists()) return { allowed: false, reason: "Module does not exist." };
    return { allowed: true };
  }

  const normaliseSem = (raw) => {
    if (!raw) return "";
    const str = raw.toString().trim();
    if (/^Sem:\d+$/.test(str)) return str;
    const num = str.replace(/[^0-9]/g, "");
    return num ? `Sem:${num}` : str;
  };

  const userSem = normaliseSem(sem);
  const reqSem  = normaliseSem(requestedSem);

  if (branch?.toLowerCase() !== requestedBranch?.toLowerCase() || userSem !== reqSem) {
    return { allowed: false, reason: "You can only view resources for your own branch and semester." };
  }

  // Verify the specific module exists in their branch/sem/subject
  const modSnap = await get(dbRef(db, `notes/${requestedBranch}/${reqSem}/subjects/${requestedSubject}/modules/${requestedModule}`));
  if (!modSnap.exists()) return { allowed: false, reason: "That module doesn't exist in your course." };

  return { allowed: true };
}

/* ─────────────────────────────────────────
   CHUNK REASSEMBLY (with cache)
───────────────────────────────────────── */
async function loadPDF(db, branch, sem, subject, moduleKey, onProgress) {
  const cacheKey = getCacheKey(branch, sem, subject, moduleKey);
  if (PDF_CACHE.has(cacheKey)) {
    onProgress(100, "Loaded from cache");
    return PDF_CACHE.get(cacheKey);
  }
  const basePath = `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}`;
  onProgress(5, "Reading PDF metadata…");
  const metaSnap = await get(dbRef(db, `${basePath}/pdfMeta`));
  if (!metaSnap.exists()) throw new Error("No PDF uploaded for this module yet.");
  const { totalChunks } = metaSnap.val();
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const snap = await get(dbRef(db, `${basePath}/pdfChunks/chunk_${i}`));
    if (!snap.exists()) throw new Error(`Corrupted PDF: missing chunk ${i} of ${totalChunks}.`);
    chunks.push(snap.val());
    const pct = 10 + Math.round(((i + 1) / totalChunks) * 75);
    onProgress(pct, `Loading chunk ${i + 1} / ${totalChunks}…`);
  }
  onProgress(88, "Assembling PDF…");
  const base64 = chunks.join("");
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = bytes.buffer;
  PDF_CACHE.set(cacheKey, buffer);
  onProgress(100, "Ready");
  return buffer;
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

/* ═══════════════════════════════════════════
   INNER VIEWER
═══════════════════════════════════════════ */
function PDFViewerInner() {
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

  /* Security */
  const [accessDenied,  setAccessDenied]  = useState(false);
  const [accessReason,  setAccessReason]  = useState("");

  /* PDF.js */
  const [pdfDoc,      setPdfDoc]      = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages,  setTotalPages]  = useState(0);
  const [scale,       setScale]       = useState(1.4);
  const [loadStatus,  setLoadStatus]  = useState("idle");
  const [loadMsg,     setLoadMsg]     = useState("");
  const [loadPct,     setLoadPct]     = useState(0);
  const [rendering,   setRendering]   = useState(false);
  const [moduleTitle, setModuleTitle] = useState("");
  const [fileName,    setFileName]    = useState("");

  /* AI chat */
  const [chatOpen,       setChatOpen]       = useState(false);
  const [chatInput,      setChatInput]      = useState("");
  const [messages,       setMessages]       = useState([
    { role: "ai", text: "Hi! I'm your Neural AI Assistant. How can I help you today with this Topic?" }
  ]);
  const [aiLoading,      setAiLoading]      = useState(false);
  const [sheetHeight,    setSheetHeight]    = useState(55); // % of screen height for mobile sheet
  const [isDraggingSheet,setIsDraggingSheet]= useState(false);
  const sheetDragStart   = useRef(null);
  const chatEndRef       = useRef(null);

  /* Context menu */
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y }

  /* Mobile detection */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  /* Colors */
  const bg    = isDark ? "#080f1a"             : "#f0f4f0";
  const panel = isDark ? "rgba(8,15,26,0.97)"  : "rgba(255,255,255,0.97)";
  const text1 = isDark ? "#f1f5f9"             : "#0f172a";
  const text2 = isDark ? "#94a3b8"             : "#475569";
  const text3 = isDark ? "#475569"             : "#94a3b8";
  const bdr   = isDark ? "rgba(0,255,0,0.1)"   : "rgba(0,200,0,0.12)";

  /* ── Auth + deep security check ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      const snap = await get(dbRef(db, `users/${u.uid}`));
      if (snap.exists()) setUserData(snap.val());
      setAuthLoading(false);

      // Deep validation: branch + sem + subject + exact module
      const result = await validateAccess(db, u.uid, branch, sem, subject, moduleKey);
      if (!result.allowed) {
        setAccessDenied(true);
        setAccessReason(result.reason || "Access denied.");
      }
    });
    return () => unsub();
  }, [router, branch, sem, subject, moduleKey]);

  /* ── Load module title + filename ── */
  useEffect(() => {
    if (!branch || !sem || !subject || !moduleKey) return;
    get(dbRef(db, `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}/Title`))
      .then(s => { if (s.exists()) setModuleTitle(s.val()); });
    get(dbRef(db, `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}/pdfMeta`))
      .then(s => { if (s.exists()) setFileName(s.val().fileName || `${moduleKey}.pdf`); });
  }, [branch, sem, subject, moduleKey]);

  /* ── Load PDF ── */
  const initPDFJS = useCallback(async (buffer) => {
    try {
      const pdfjsLib = window["pdfjs-dist/build/pdf"];
      if (!pdfjsLib) return;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const doc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      setCurrentPage(1);
      setLoadStatus("ready");
      setLoadPct(100);
    } catch (err) {
      setLoadStatus("error"); setLoadMsg(err.message);
    }
  }, []);

  useEffect(() => {
    if (!branch || !sem || !subject || !moduleKey || authLoading || accessDenied) return;
    const cacheKey = getCacheKey(branch, sem, subject, moduleKey);
    if (PDF_CACHE.has(cacheKey)) {
      setLoadStatus("loading");
      setLoadMsg("Loading from cache…");
      setLoadPct(50);
      initPDFJS(PDF_CACHE.get(cacheKey));
      return;
    }
    setLoadStatus("loading");
    setLoadMsg("Loading PDF engine…");
    setLoadPct(5);

    const existingScript = document.getElementById("pdfjs-script");
    if (existingScript) { startLoad(); return; }

    const script = document.createElement("script");
    script.id    = "pdfjs-script";
    script.src   = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload  = startLoad;
    script.onerror = () => { setLoadStatus("error"); setLoadMsg("Failed to load PDF engine."); };
    document.head.appendChild(script);

    async function startLoad() {
      try {
        const pdfjsLib = window["pdfjs-dist/build/pdf"];
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const buffer = await loadPDF(db, branch, sem, subject, moduleKey, (pct, msg) => {
          setLoadPct(pct); setLoadMsg(msg);
        });
        await initPDFJS(buffer);
      } catch (err) {
        setLoadStatus("error"); setLoadMsg(err.message);
      }
    }
  }, [branch, sem, subject, moduleKey, authLoading, accessDenied, initPDFJS]);

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

  /* ── Chat scroll ── */
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  /* ── Close context menu on click outside ── */
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close); };
  }, [ctxMenu]);

  /* ── Right-click context menu handler ── */
  const handleContextMenu = useCallback((e) => {
    if (loadStatus !== "ready") return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [loadStatus]);

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
          system: `You are Neural AI Assistant — an engineering exam assistant embedded in a PDF viewer.
The student is viewing: "${moduleTitle || moduleKey}" from subject "${subject}", semester "${sem}".
Current page: ${currentPage} of ${totalPages}.
Give concise, exam-focused answers. Use bullet points when listing. Keep answers under 200 words unless asked to elaborate.`,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const data  = await res.json();
      const reply = data.content?.[0]?.text || "Sorry, couldn't get a response.";
      setMessages(m => [...m, { role: "ai", text: reply }]);
    } catch {
      setMessages(m => [...m, { role: "ai", text: "Network error. Please try again." }]);
    }
    setAiLoading(false);
  };

  /* Quick actions — available on both desktop and mobile */
  const quickActions = [
    { icon: "summarize",        label: "Summarize",         prompt: `Summarize the key points of "${moduleTitle || moduleKey}" in bullet points for exam prep.` },
    { icon: "quiz",             label: "Quiz me",           prompt: `Generate 5 short exam questions with answers on "${moduleTitle || moduleKey}".` },
    { icon: "lightbulb",        label: "Key concepts",      prompt: `List the most important concepts from "${moduleTitle || moduleKey}" for exams.` },
    { icon: "psychology",       label: "Explain topic",     prompt: `Explain the core topic of "${moduleTitle || moduleKey}" simply.` },
    { icon: "article",          label: "Page summary",      prompt: `I'm on page ${currentPage} of ${totalPages} in "${moduleTitle || moduleKey}". Summarize what this page is likely covering based on the module topic and give me key exam points for this section.` },
    { icon: "format_list_numbered", label: "Prev pages",   prompt: `I've read up to page ${currentPage} of "${moduleTitle || moduleKey}". Give me a running summary of what's been covered so far.` },
  ];

  /* Context menu actions */
  const ctxActions = [
    { icon: "article",          label: "Summarize this page",  prompt: `Summarize page ${currentPage} of "${moduleTitle || moduleKey}" for exam revision.` },
    { icon: "quiz",             label: "Quiz on this page",    prompt: `Create 3 focused exam questions based on page ${currentPage} content of "${moduleTitle || moduleKey}".` },
    { icon: "lightbulb",        label: "Key points here",      prompt: `What are the most important exam points from page ${currentPage} of "${moduleTitle || moduleKey}"?` },
    { icon: "translate",        label: "Simplify this page",   prompt: `Explain page ${currentPage} of "${moduleTitle || moduleKey}" in the simplest possible terms.` },
    { icon: "arrow_back",       label: "Previous page",        action: () => setCurrentPage(p => Math.max(1, p - 1)) },
    { icon: "arrow_forward",    label: "Next page",            action: () => setCurrentPage(p => Math.min(totalPages, p + 1)) },
    { icon: "zoom_in",          label: "Zoom in",              action: () => setScale(s => Math.min(3, +(s + 0.2).toFixed(1))) },
    { icon: "zoom_out",         label: "Zoom out",             action: () => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1))) },
    { icon: "download",         label: "Download PDF",         action: async () => {
        const buffer = PDF_CACHE.get(getCacheKey(branch, sem, subject, moduleKey));
        if (!buffer) return;
        const blob = new Blob([buffer], { type: "application/pdf" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = fileName || `${moduleKey}.pdf`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    }},
  ];

  /* ── Mobile sheet drag ── */
  const onSheetPointerDown = (e) => {
    setIsDraggingSheet(true);
    sheetDragStart.current = { y: e.clientY, height: sheetHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSheetPointerMove = (e) => {
    if (!isDraggingSheet || !sheetDragStart.current) return;
    const dy = sheetDragStart.current.y - e.clientY;
    const delta = (dy / window.innerHeight) * 100;
    const newH  = Math.min(92, Math.max(20, sheetDragStart.current.height + delta));
    setSheetHeight(newH);
  };
  const onSheetPointerUp = (e) => {
    setIsDraggingSheet(false);
    // Snap: if < 28% → close; if > 70% → full
    if (sheetHeight < 28) { setChatOpen(false); setSheetHeight(55); }
    else if (sheetHeight > 75) setSheetHeight(88);
    else setSheetHeight(55);
  };

  const fullName  = userData?.fullName  || authUser?.displayName || "";
  const photoURL  = userData?.photoURL  || authUser?.photoURL    || "";
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

  /* ── ACCESS DENIED ── */
  if (accessDenied) return (
    <div style={{ height:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:bg, gap:"20px", fontFamily:"'Lexend',sans-serif", padding:"20px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;700&display=swap');@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');.ms{font-family:'Material Symbols Outlined'!important;line-height:1;display:inline-block;}`}</style>
      <div style={{ width:"80px", height:"80px", borderRadius:"20px", background:"rgba(239,68,68,0.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span className="ms" style={{ fontSize:"44px", color:"#ef4444" }}>lock</span>
      </div>
      <div style={{ textAlign:"center" }}>
        <h2 style={{ fontSize:"20px", fontWeight:700, color:isDark?"#f1f5f9":"#0f172a", margin:"0 0 8px" }}>Access Denied</h2>
        <p style={{ fontSize:"13px", color:isDark?"#94a3b8":"#475569", margin:0, maxWidth:"320px" }}>{accessReason}</p>
      </div>
      <button onClick={() => router.push("/notes")} style={{ padding:"12px 24px", background:"#00FF00", color:"#0f172a", border:"none", borderRadius:"12px", fontWeight:700, fontSize:"14px", cursor:"pointer", fontFamily:"'Lexend',sans-serif" }}>
        Back to Notes
      </button>
    </div>
  );

  if (authLoading) return null;

  const isChatOpenDesktop = chatOpen && !isMobile;

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

        .viewer-root{display:flex;flex-direction:column;height:100vh;overflow:hidden;background:${bg};}
        .top-bar{height:60px;background:${panel};backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};display:flex;align-items:center;padding:0 16px;gap:12px;flex-shrink:0;z-index:30;}
        .viewer-body{flex:1;display:flex;overflow:hidden;}
        .pdf-area{flex:1;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:32px 24px 120px;background:${isDark?"#0a1628":"#e4eae4"};}
        .pdf-area::-webkit-scrollbar{width:4px;}
        .pdf-area::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}
        .canvas-wrap{background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.18);overflow:hidden;max-width:100%;}
        canvas{display:block;max-width:100%;height:auto;}

        /* Desktop controls */
        .ctrl-bar{position:fixed;bottom:28px;left:50%;transform:translateX(calc(-50% - 180px));background:${isDark?"rgba(15,23,42,0.96)":"rgba(15,23,42,0.92)"};backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:9999px;padding:10px 24px;display:flex;align-items:center;gap:20px;z-index:40;box-shadow:0 8px 32px rgba(0,0,0,0.3);transition:left 0.3s,transform 0.3s;}
        .ctrl-bar.no-sidebar{left:50%;transform:translateX(-50%);}
        .ctrl-btn{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);display:flex;align-items:center;justify-content:center;padding:4px;border-radius:8px;transition:all 0.18s;}
        .ctrl-btn:hover{color:#00FF00;background:rgba(0,255,0,0.1);}
        .ctrl-btn:disabled{opacity:0.3;cursor:not-allowed;}
        .ctrl-div{width:1px;height:20px;background:rgba(255,255,255,0.15);}

        /* Desktop AI sidebar */
        .ai-sidebar{width:360px;min-width:360px;height:100%;background:${panel};backdrop-filter:blur(12px);border-left:1px solid ${bdr};display:flex;flex-direction:column;z-index:20;transition:width 0.3s,min-width 0.3s;}
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

        /* Mobile bottom sheet */
        .mob-fab{display:none;position:fixed;bottom:90px;right:20px;z-index:60;width:58px;height:58px;border-radius:9999px;background:#00FF00;border:none;box-shadow:0 6px 28px rgba(0,255,0,0.5);cursor:pointer;align-items:center;justify-content:center;animation:fabPop 0.4s cubic-bezier(0.34,1.56,0.64,1) both;}
        .mob-fab:active{transform:scale(0.9);}
        .mob-sheet-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:55;backdrop-filter:blur(4px);}
        .mob-sheet{display:none;position:fixed;left:0;right:0;bottom:0;z-index:60;border-radius:24px 24px 0 0;background:${panel};box-shadow:0 -12px 60px rgba(0,0,0,0.35);flex-direction:column;overflow:hidden;}
        .mob-sheet-handle{width:40px;height:4px;borderRadius:9999px;background:${isDark?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.15)"};margin:12px auto 0;}
        .mob-ctrl-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;background:${isDark?"rgba(10,16,26,0.97)":"rgba(255,255,255,0.97)"};backdrop-filter:blur(20px);border-top:1px solid ${bdr};padding:10px 20px 24px;align-items:center;justify-content:center;gap:16px;}
        .mob-ctrl-btn{background:none;border:none;cursor:pointer;color:${text2};display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 10px;border-radius:10px;transition:all 0.18s;-webkit-tap-highlight-color:transparent;}
        .mob-ctrl-btn:active{transform:scale(0.88);}
        .mob-ctrl-btn.highlight{background:rgba(0,255,0,0.1);}
        .mob-ctrl-btn span.ms{font-size:22px;color:${text2};}
        .mob-ctrl-btn.highlight span.ms{color:#00CC00;}
        .mob-ctrl-btn span.lbl{font-size:9px;font-weight:700;color:${text3};font-family:'Lexend',sans-serif;}

        /* Right-click context menu */
        .ctx-menu{position:fixed;z-index:9999;background:${isDark?"rgba(12,18,30,0.98)":"rgba(255,255,255,0.98)"};backdrop-filter:blur(20px);border:1px solid ${bdr};border-radius:16px;padding:6px;box-shadow:0 16px 56px rgba(0,0,0,0.35);min-width:220px;animation:ctxFadeIn 0.18s ease both;font-family:'Lexend',sans-serif;}
        .ctx-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;color:${text1};border:none;background:none;width:100%;text-align:left;font-family:'Lexend',sans-serif;transition:background 0.15s;}
        .ctx-item:hover{background:${isDark?"rgba(0,255,0,0.08)":"rgba(0,200,0,0.08)"};}
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
          <button
            onClick={() => router.push("/notes")}
            style={{ display:"flex", alignItems:"center", gap:"4px", background:"none", border:"none", cursor:"pointer", color:text2, fontSize:"13px", fontWeight:600, fontFamily:"'Lexend',sans-serif", flexShrink:0 }}
          >
            <span className="ms" style={{ fontSize:"20px" }}>arrow_back</span>
            <span style={{ display: isMobile ? "none" : "inline" }}>Notes</span>
          </button>

          <div style={{ width:"1px", height:"24px", background:bdr, flexShrink:0 }} />

          <div style={{ display:"flex", alignItems:"center", gap:"10px", flex:1, minWidth:0 }}>
            <span className="ms" style={{ fontSize:"22px", color:"#ef4444", flexShrink:0 }}>picture_as_pdf</span>
            <div style={{ minWidth:0 }}>
              <p style={{ fontSize:"13px", fontWeight:700, color:text1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {moduleTitle || moduleKey || "PDF Viewer"}
              </p>
              <p style={{ fontSize:"10px", color:text3, margin:0 }}>{subject} · {sem} · {branch}</p>
            </div>
          </div>

          {/* Cache badge */}
          {loadStatus === "ready" && PDF_CACHE.has(getCacheKey(branch, sem, subject, moduleKey)) && !isMobile && (
            <div style={{ display:"flex", alignItems:"center", gap:"5px", padding:"4px 10px", background:"rgba(0,255,0,0.08)", border:"1px solid rgba(0,255,0,0.2)", borderRadius:"9999px", flexShrink:0 }}>
              <span className="ms" style={{ fontSize:"14px", color:"#00AA00" }}>bolt</span>
              <span style={{ fontSize:"10px", fontWeight:700, color:"#00AA00" }}>Cached</span>
            </div>
          )}

          {/* Download — desktop */}
          {loadStatus === "ready" && !isMobile && (
            <button
              title="Download PDF"
              onClick={async () => {
                try {
                  const buffer = PDF_CACHE.get(getCacheKey(branch, sem, subject, moduleKey));
                  if (!buffer) return;
                  const blob = new Blob([buffer], { type:"application/pdf" });
                  const url  = URL.createObjectURL(blob);
                  const a    = document.createElement("a");
                  a.href = url; a.download = fileName || `${moduleKey}.pdf`; a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 3000);
                } catch {}
              }}
              style={{ width:"36px", height:"36px", borderRadius:"10px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}
            >
              <span className="ms" style={{ fontSize:"20px", color:text2 }}>download</span>
            </button>
          )}

          {/* Toggle AI — desktop only */}
          {!isMobile && (
            <button
              onClick={() => setChatOpen(o => !o)}
              style={{ display:"flex", alignItems:"center", gap:"6px", padding:"8px 14px", background:chatOpen?"#00FF00":"none", border:`1px solid ${chatOpen?"#00FF00":bdr}`, borderRadius:"10px", cursor:"pointer", fontSize:"12px", fontWeight:700, color:chatOpen?"#0f172a":text2, fontFamily:"'Lexend',sans-serif", transition:"all 0.2s", flexShrink:0 }}
            >
              <span className="ms" style={{ fontSize:"18px" }}>psychology</span>
              {chatOpen ? "Hide Neural" : "Neural AI"}
            </button>
          )}

          <AvatarEl size={36} />
        </div>

        {/* ── BODY ── */}
        <div className="viewer-body">

          {/* PDF Area */}
          <div className="pdf-area" ref={containerRef}>
            {loadStatus === "loading" && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flex:1, gap:"20px", minHeight:"60vh", animation:"fadeUp 0.3s ease both" }}>
                <div style={{ width:"72px", height:"72px", borderRadius:"18px", background:"rgba(0,255,0,0.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <div style={{ width:"32px", height:"32px", border:"3px solid rgba(0,255,0,0.2)", borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.8s linear infinite" }} />
                </div>
                <div style={{ textAlign:"center" }}>
                  <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:"0 0 6px" }}>{loadMsg}</p>
                  <div style={{ width:"280px" }}>
                    <div className="progress-track"><div className="progress-fill" style={{ width:`${loadPct}%` }} /></div>
                    <p style={{ fontSize:"11px", color:"#00AA00", fontWeight:700, marginTop:"8px" }}>{loadPct}%</p>
                  </div>
                </div>
              </div>
            )}
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
            {loadStatus === "ready" && (
              <div className="canvas-wrap" style={{ opacity:rendering?0.7:1, transition:"opacity 0.2s" }}>
                <canvas ref={canvasRef} />
              </div>
            )}
          </div>

          {/* ── DESKTOP AI SIDEBAR ── */}
          <aside className={`ai-sidebar${isChatOpenDesktop ? "" : " closed"}`}>
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
              <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                <span style={{ fontSize:"10px", fontWeight:700, color:text3, background:isDark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)", padding:"3px 8px", borderRadius:"9999px" }}>
                  p.{currentPage}/{totalPages}
                </span>
                <button onClick={() => setChatOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:text3 }}>
                  <span className="ms" style={{ fontSize:"20px" }}>close</span>
                </button>
              </div>
            </div>

            {/* Quick actions grid — desktop */}
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
                <div key={i} className={msg.role==="ai"?"msg-ai":"msg-user"}>
                  {msg.role==="ai" && (
                    <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"6px" }}>
                      <span className="ms" style={{ fontSize:"14px", color:"#00CC00" }}>auto_awesome</span>
                      <span style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.08em" }}>Neural AI Assistant</span>
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

            <div className="chat-input-wrap">
              <div style={{ position:"relative" }}>
                <textarea
                  className="chat-input"
                  placeholder="Ask anything about this PDF…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(chatInput);} }}
                  rows={2}
                />
                <button
                  onClick={() => sendMessage(chatInput)}
                  disabled={!chatInput.trim()||aiLoading}
                  style={{ position:"absolute", right:"10px", bottom:"10px", width:"32px", height:"32px", background:"#00FF00", border:"none", borderRadius:"9px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", opacity:(!chatInput.trim()||aiLoading)?0.4:1, transition:"opacity 0.2s" }}
                >
                  <span className="ms" style={{ fontSize:"18px", color:"#0f172a" }}>send</span>
                </button>
              </div>
              <p style={{ fontSize:"9px", color:text3, textAlign:"center", marginTop:"8px" }}>Enter to send · Shift+Enter for new line</p>
            </div>
          </aside>
        </div>

        {/* ── DESKTOP PAGE CONTROLS ── */}
        {loadStatus === "ready" && (
          <div className={`ctrl-bar${isChatOpenDesktop ? "" : " no-sidebar"}`}>
            <button className="ctrl-btn" disabled={currentPage<=1} onClick={() => setCurrentPage(p=>p-1)}>
              <span className="ms" style={{ fontSize:"22px" }}>chevron_left</span>
            </button>
            <span style={{ fontSize:"12px", fontWeight:600, color:"rgba(255,255,255,0.8)", whiteSpace:"nowrap" }}>
              {currentPage} / {totalPages}
            </span>
            <button className="ctrl-btn" disabled={currentPage>=totalPages} onClick={() => setCurrentPage(p=>p+1)}>
              <span className="ms" style={{ fontSize:"22px" }}>chevron_right</span>
            </button>
            <div className="ctrl-div" />
            <button className="ctrl-btn" onClick={() => setScale(s=>Math.max(0.5,+(s-0.2).toFixed(1)))}>
              <span className="ms" style={{ fontSize:"22px" }}>remove</span>
            </button>
            <span style={{ fontSize:"12px", fontWeight:600, color:"rgba(255,255,255,0.8)", whiteSpace:"nowrap" }}>
              {Math.round(scale*100)}%
            </span>
            <button className="ctrl-btn" onClick={() => setScale(s=>Math.min(3,+(s+0.2).toFixed(1)))}>
              <span className="ms" style={{ fontSize:"22px" }}>add</span>
            </button>
            <div className="ctrl-div" />
            <button className="ctrl-btn" title="Fit width" onClick={() => {
              if (containerRef.current && pdfDoc) {
                const w = containerRef.current.clientWidth - 64;
                pdfDoc.getPage(currentPage).then(p => {
                  const vp = p.getViewport({ scale:1 });
                  setScale(+(w/vp.width).toFixed(2));
                });
              }
            }}>
              <span className="ms" style={{ fontSize:"22px" }}>fit_width</span>
            </button>
            {rendering && <div style={{ width:"16px", height:"16px", border:"2px solid rgba(0,255,0,0.3)", borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />}
          </div>
        )}

        {/* ════════════════════════════════
            MOBILE CONTROLS
        ════════════════════════════════ */}

        {/* Mobile bottom control bar */}
        {loadStatus === "ready" && (
          <div className="mob-ctrl-bar">
            <button className="mob-ctrl-btn" disabled={currentPage<=1} onClick={() => setCurrentPage(p=>p-1)} style={{ opacity:currentPage<=1?0.3:1 }}>
              <span className="ms">chevron_left</span>
              <span className="lbl">Prev</span>
            </button>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"2px" }}>
              <span style={{ fontSize:"13px", fontWeight:700, color:text1 }}>{currentPage} / {totalPages}</span>
              <span style={{ fontSize:"9px", color:text3 }}>{Math.round(scale*100)}%</span>
            </div>
            <button className="mob-ctrl-btn" disabled={currentPage>=totalPages} onClick={() => setCurrentPage(p=>p+1)} style={{ opacity:currentPage>=totalPages?0.3:1 }}>
              <span className="ms">chevron_right</span>
              <span className="lbl">Next</span>
            </button>
            <div style={{ width:"1px", height:"36px", background:bdr, flexShrink:0 }} />
            <button className="mob-ctrl-btn" onClick={() => setScale(s=>Math.max(0.5,+(s-0.2).toFixed(1)))}>
              <span className="ms">zoom_out</span>
              <span className="lbl">Out</span>
            </button>
            <button className="mob-ctrl-btn" onClick={() => setScale(s=>Math.min(3,+(s+0.2).toFixed(1)))}>
              <span className="ms">zoom_in</span>
              <span className="lbl">In</span>
            </button>
            <div style={{ width:"1px", height:"36px", background:bdr, flexShrink:0 }} />
            <button className="mob-ctrl-btn highlight" onClick={() => { setChatOpen(true); setSheetHeight(55); }}>
              <span className="ms">psychology</span>
              <span className="lbl" style={{ color:"#00AA00" }}>AI</span>
            </button>
          </div>
        )}

        {/* Mobile AI FAB (when PDF not loaded) */}
        {loadStatus !== "ready" && (
          <button className="mob-fab" onClick={() => { setChatOpen(true); setSheetHeight(55); }}>
            <span className="ms" style={{ fontSize:"28px", color:"#0f172a" }}>psychology</span>
          </button>
        )}

        {/* Mobile sheet overlay */}
        {isMobile && chatOpen && (
          <div
            className="mob-sheet-overlay"
            style={{ opacity: chatOpen ? 1 : 0, transition:"opacity 0.3s" }}
            onClick={() => setChatOpen(false)}
          />
        )}

        {/* Mobile bottom sheet */}
        {isMobile && (
          <div
            className="mob-sheet"
            style={{
              height: chatOpen ? `${sheetHeight}vh` : "0",
              transition: isDraggingSheet ? "none" : "height 0.35s cubic-bezier(0.32,0.72,0,1)",
              overflow: chatOpen ? "hidden" : "hidden",
              display: "flex",
            }}
          >
            {/* Drag handle */}
            <div
              style={{ flexShrink:0, paddingBottom:"8px", cursor:"ns-resize", touchAction:"none" }}
              onPointerDown={onSheetPointerDown}
              onPointerMove={onSheetPointerMove}
              onPointerUp={onSheetPointerUp}
            >
              <div className="mob-sheet-handle" />
              {/* Sheet header */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 20px 0" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <div style={{ width:"32px", height:"32px", borderRadius:"9px", background:"rgba(0,255,0,0.12)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span className="ms" style={{ fontSize:"18px", color:"#00CC00" }}>psychology</span>
                  </div>
                  <div>
                    <p style={{ fontSize:"13px", fontWeight:700, color:text1, margin:0 }}>Neural AI</p>
                    <div style={{ display:"flex", alignItems:"center", gap:"4px" }}>
                      <div style={{ width:"5px", height:"5px", borderRadius:"9999px", background:"#00FF00", animation:"pulse 2s ease-in-out infinite" }} />
                      <p style={{ fontSize:"9px", color:"#00AA00", fontWeight:700, margin:0 }}>Page {currentPage}/{totalPages}</p>
                    </div>
                  </div>
                </div>
                <button onClick={() => setChatOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:text3, width:"36px", height:"36px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span className="ms" style={{ fontSize:"20px" }}>keyboard_arrow_down</span>
                </button>
              </div>
            </div>

            {/* Quick actions — mobile horizontal scroll */}
            <div style={{ flexShrink:0, padding:"8px 16px 0", borderBottom:`1px solid ${bdr}` }}>
              <div style={{ display:"flex", gap:"8px", overflowX:"auto", paddingBottom:"12px" }}>
                {quickActions.map(({icon,label,prompt}) => (
                  <button
                    key={label}
                    onClick={() => sendMessage(prompt)}
                    style={{ display:"flex", alignItems:"center", gap:"6px", padding:"7px 12px", background:isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.07)", border:`1px solid ${bdr}`, borderRadius:"9999px", cursor:"pointer", fontSize:"11px", fontWeight:700, color:text2, fontFamily:"'Lexend',sans-serif", whiteSpace:"nowrap", flexShrink:0, transition:"all 0.18s" }}
                  >
                    <span className="ms" style={{ fontSize:"15px", color:"#00CC00" }}>{icon}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Messages */}
            <div className="chat-scroll" style={{ flex:1 }}>
              {messages.map((msg, i) => (
                <div key={i} className={msg.role==="ai"?"msg-ai":"msg-user"}>
                  {msg.role==="ai" && (
                    <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"6px" }}>
                      <span className="ms" style={{ fontSize:"14px", color:"#00CC00" }}>auto_awesome</span>
                      <span style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.08em" }}>Neural AI Assistant</span>
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
            <div className="chat-input-wrap" style={{ flexShrink:0 }}>
              <div style={{ position:"relative" }}>
                <textarea
                  className="chat-input"
                  placeholder="Ask anything…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(chatInput);} }}
                  rows={2}
                />
                <button
                  onClick={() => sendMessage(chatInput)}
                  disabled={!chatInput.trim()||aiLoading}
                  style={{ position:"absolute", right:"10px", bottom:"10px", width:"32px", height:"32px", background:"#00FF00", border:"none", borderRadius:"9px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", opacity:(!chatInput.trim()||aiLoading)?0.4:1 }}
                >
                  <span className="ms" style={{ fontSize:"18px", color:"#0f172a" }}>send</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════
            RIGHT-CLICK CONTEXT MENU
        ════════════════════════════════ */}
        {ctxMenu && loadStatus === "ready" && (
          <div
            className="ctx-menu"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 240),
              top:  Math.min(ctxMenu.y, window.innerHeight - 380),
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* AI actions */}
            <div className="ctx-section">✦ AI Actions</div>
            {ctxActions.slice(0, 4).map(({icon,label,prompt}) => (
              <button
                key={label}
                className="ctx-item ai-item"
                onClick={() => {
                  sendMessage(prompt);
                  if (!chatOpen) { setChatOpen(true); if (isMobile) setSheetHeight(55); }
                  setCtxMenu(null);
                }}
              >
                <span className="ms" style={{ fontSize:"17px", color:"#00CC00" }}>{icon}</span>
                {label}
                <span style={{ marginLeft:"auto", fontSize:"9px", color:text3, fontWeight:700 }}>AI</span>
              </button>
            ))}

            <div className="ctx-divider" />
            <div className="ctx-section">Navigation</div>

            {/* Page nav + zoom + download */}
            {ctxActions.slice(4).map(({icon,label,action}) => (
              <button
                key={label}
                className="ctx-item"
                onClick={() => { action(); setCtxMenu(null); }}
              >
                <span className="ms" style={{ fontSize:"17px", color:text2 }}>{icon}</span>
                {label}
                {label === "Previous page" && <span style={{ marginLeft:"auto", fontSize:"9px", color:text3, fontWeight:700 }}>p.{Math.max(1,currentPage-1)}</span>}
                {label === "Next page" && <span style={{ marginLeft:"auto", fontSize:"9px", color:text3, fontWeight:700 }}>p.{Math.min(totalPages,currentPage+1)}</span>}
                {label === "Zoom in" && <span style={{ marginLeft:"auto", fontSize:"9px", color:text3, fontWeight:700 }}>{Math.round(Math.min(300,(scale+0.2)*100))}%</span>}
                {label === "Zoom out" && <span style={{ marginLeft:"auto", fontSize:"9px", color:text3, fontWeight:700 }}>{Math.round(Math.max(50,(scale-0.2)*100))}%</span>}
              </button>
            ))}

            <div className="ctx-divider" />
            {/* Current page info */}
            <div style={{ padding:"6px 12px 6px", fontSize:"10px", color:text3, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span>Page {currentPage} of {totalPages}</span>
              <span>{Math.round(scale*100)}% zoom</span>
            </div>
          </div>
        )}

      </div>
    </>
  );
}

/* ═══════════════════════════════════════════
   EXPORTED PAGE — wraps in Suspense
═══════════════════════════════════════════ */
export default function PDFViewerPage() {
  return (
    <Suspense fallback={
      <div style={{ height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#080f1a", fontFamily:"'Lexend',sans-serif" }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
          <div style={{ width:"36px", height:"36px", border:"3px solid rgba(0,255,0,0.2)", borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.8s linear infinite" }} />
          <p style={{ color:"#94a3b8", fontSize:"13px", fontWeight:500 }}>Loading PDF Viewer…</p>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
      </div>
    }>
      <PDFViewerInner />
    </Suspense>
  );
}