"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref as dbRef, onValue, set, update } from "firebase/database";

/* ─────────────────────────────────────────
   CHUNK CONFIG
   Firebase Realtime DB node limit ≈ 10MB
   We chunk base64 into 500KB pieces safely
───────────────────────────────────────── */
const CHUNK_SIZE = 500 * 1024; // 500KB per chunk (base64 chars)

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

async function uploadPDFChunked(db, path, file, onProgress) {
  onProgress(5, "Reading file…");
  const base64 = await fileToBase64(file);
  onProgress(20, "Splitting into chunks…");
  const chunks = chunkString(base64, CHUNK_SIZE);
  const totalChunks = chunks.length;
  onProgress(25, `Uploading ${totalChunks} chunks…`);

  const metaRef = dbRef(db, `${path}/pdfMeta`);
  await set(metaRef, {
    totalChunks,
    fileName: file.name,
    fileSize: file.size,
    mimeType: "application/pdf",
    uploadedAt: Date.now(),
  });

  for (let i = 0; i < chunks.length; i++) {
    const chunkRef = dbRef(db, `${path}/pdfChunks/chunk_${i}`);
    await set(chunkRef, chunks[i]);
    const pct = 25 + Math.round(((i + 1) / totalChunks) * 70);
    onProgress(pct, `Uploading chunk ${i + 1} of ${totalChunks}…`);
  }
  onProgress(100, "Done!");
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

const BRANCHES = ["IT", "CS", "EXTC", "MECH", "CIVIL"];
const SEMS = ["Sem:1","Sem:2","Sem:3","Sem:4","Sem:5","Sem:6","Sem:7","Sem:8"];
const NAV_ITEMS = [
  { id: "dashboard", icon: "dashboard", label: "Dashboard", href: "/dashboard" },
  { id: "notes", icon: "description", label: "Notes", href: "/notes" },
  { id: "test", icon: "quiz", label: "Test", href: "/test" },
  { id: "ai", icon: "psychology", label: "Neural AI", href: "/ai" },
  { id: "profile", icon: "person", label: "Profile", href: "/profile" },
  { id: "settings", icon: "settings", label: "Settings", href: "/settings" },
];

/* ═══════════════════════════════════════════
   MAIN COMPONENT - Updated with Description
═══════════════════════════════════════════ */
export default function AdminUploadPage() {
  const router = useRouter();
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  const fileRef = useRef(null);

  const [authUser, setAuthUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [branch, setBranch] = useState("IT");
  const [sem, setSem] = useState("Sem:3");
  const [subject, setSubject] = useState("");
  const [moduleKey, setModuleKey] = useState("module1");
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleDescription, setModuleDescription] = useState(""); // ← NEW FIELD

  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [subjects, setSubjects] = useState({});

  /* Auth */
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

  /* Load subjects */
  useEffect(() => {
    const r = dbRef(db, `notes/${branch}/${sem}/subjects`);
    return onValue(r, (snap) => {
      if (snap.exists()) {
        setSubjects(snap.val());
        setSubject(Object.keys(snap.val())[0] || "");
      } else {
        setSubjects({});
        setSubject("");
      }
    });
  }, [branch, sem]);

  /* Colors */
  const bg = isDark ? "#080f1a" : "#f5f8f5";
  const sidebar = isDark ? "rgba(8,15,26,0.96)" : "rgba(255,255,255,0.85)";
  const header = isDark ? "rgba(8,15,26,0.92)" : "rgba(255,255,255,0.85)";
  const card = isDark ? "rgba(15,23,42,0.9)" : "#ffffff";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.12)";
  const inputBg = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,200,0,0.04)";
  const inputBdr = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,200,0,0.2)";

  const fullName = userData?.fullName || authUser?.displayName || "";
  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";
  const photoURL = userData?.photoURL || authUser?.photoURL || "";

  const AvatarEl = ({ size = 40 }) => (
    <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: "9999px", border: "2.5px solid #00FF00", overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0", flexShrink: 0 }}>
      {photoURL
        ? <img src={photoURL} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontSize: `${size * 0.4}px`, fontWeight: 900, fontFamily: "'Lexend',sans-serif" }}>
            {firstName ? firstName[0].toUpperCase() : "?"}
          </div>
      }
    </div>
  );

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (f?.type === "application/pdf") {
      setFile(f); 
      setStatus("idle"); 
      setErrorMsg("");
    } else {
      setErrorMsg("Only PDF files are accepted."); 
      setStatus("error");
    }
  };

  const handleUpload = async () => {
    if (!file || !subject || !moduleKey || !moduleTitle) {
      setErrorMsg("Fill all required fields (Title, Subject, Module & PDF).");
      setStatus("error"); 
      return;
    }

    setStatus("uploading"); 
    setErrorMsg("");

    try {
      const dbPath = `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}`;

      // Save Title + Description directly under the module node
      await update(dbRef(db, dbPath), {
        Title: moduleTitle,
        Description: moduleDescription.trim() || "",   // ← Stored here
      });

      // Upload PDF in chunks
      await uploadPDFChunked(db, dbPath, file, (pct, msg) => {
        setProgress(pct);
        setStatusMsg(msg);
      });

      setStatus("success");
      setFile(null);
      // Optional: Reset description after success
      // setModuleDescription("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message);
    }
  };

  const inp = {
    width: "100%", padding: "12px 16px",
    background: inputBg, border: `1px solid ${inputBdr}`,
    borderRadius: "12px", color: text1, fontSize: "13px",
    fontFamily: "'Lexend',sans-serif", fontWeight: 500, outline: "none",
  };

  const lbl = {
    fontSize: "11px", fontWeight: 700, color: text3,
    textTransform: "uppercase", letterSpacing: "0.1em",
    marginBottom: "8px", display: "block",
  };

  if (authLoading) return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;}
        body{font-family:'Lexend',sans-serif;background:${bg};color:${text1};overflow:hidden;}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;line-height:1;display:inline-block;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes successPop{0%{transform:scale(0.85);opacity:0;}60%{transform:scale(1.05);}100%{transform:scale(1);opacity:1;}}
        @keyframes shimmer{0%{background-position:-200% 0;}100%{background-position:200% 0;}}
        .sb-root{display:flex;height:100vh;overflow:hidden;}
        .sb-sidebar{width:260px;min-width:260px;height:100vh;background:${sidebar};backdrop-filter:blur(12px);border-right:1px solid ${bdr};display:flex;flex-direction:column;padding:24px 20px;z-index:20;}
        .nav-link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9999px;font-size:13px;font-weight:600;color:${text2};transition:all 0.2s;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:'Lexend',sans-serif;}
        .nav-link:hover{background:rgba(0,200,0,0.08);color:${text1};}
        .nav-link.active{background:#00FF00;color:#0f172a;box-shadow:0 6px 20px rgba(0,255,0,0.28);}
        .nav-link.danger{color:#f87171;}
        .nav-link.danger:hover{background:rgba(248,113,113,0.1);}
        .sb-main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
        .sb-header{height:72px;background:${header};backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 32px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .sb-scroll{flex:1;overflow-y:auto;padding:36px;display:flex;flex-direction:column;gap:28px;}
        .sb-scroll::-webkit-scrollbar{width:4px;}
        .sb-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}
        .form-card{background:${card};border:1px solid ${bdr};border-radius:24px;padding:32px;display:flex;flex-direction:column;gap:22px;animation:fadeUp 0.35s ease both;}
        .form-row-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
        .form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;}
        select{appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;}
        .drop-zone{border:2px dashed ${bdr};border-radius:20px;padding:44px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;cursor:pointer;transition:all 0.22s;text-align:center;}
        .drop-zone:hover,.drop-zone.over{border-color:#00FF00;background:rgba(0,255,0,0.03);}
        .drop-zone.has-file{border-color:rgba(0,255,0,0.5);background:rgba(0,255,0,0.05);}
        .progress-track{width:100%;height:8px;background:${isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"};border-radius:9999px;overflow:hidden;}
        .progress-fill{height:100%;border-radius:9999px;background:linear-gradient(90deg,#00AA00,#00FF00,#00AA00);background-size:200% 100%;animation:shimmer 1.5s linear infinite;transition:width 0.3s ease;}
        .btn-up{width:100%;padding:16px;background:#00FF00;color:#0f172a;border:none;border-radius:14px;font-size:14px;font-weight:700;font-family:'Lexend',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:all 0.22s cubic-bezier(0.34,1.56,0.64,1);box-shadow:0 4px 20px rgba(0,255,0,0.3);}
        .btn-up:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,255,0,0.45);}
        .btn-up:disabled{opacity:0.4;cursor:not-allowed;transform:none;}
        @media(max-width:768px){.sb-sidebar{display:none;}.form-row-2,.form-row-3{grid-template-columns:1fr;}.sb-scroll{padding:20px 16px 80px;}}
      `}</style>

      <div className="sb-root">
        {/* Sidebar - unchanged */}
        <aside className="sb-sidebar">
          {/* ... your existing sidebar code ... */}
          <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"40px", padding:"0 4px" }}>
            <div style={{ width:"40px", height:"40px", background:"#00FF00", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 16px rgba(0,255,0,0.35)" }}>
              <span className="ms" style={{ color:"#0f172a", fontSize:"22px" }}>school</span>
            </div>
            <div>
              <h1 style={{ fontSize:"1.1rem", fontWeight:700, letterSpacing:"-0.04em", color:text1, lineHeight:1 }}>StudyBuddy</h1>
              <p style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.12em", marginTop:"3px" }}>Engineering AI</p>
            </div>
          </div>
          <nav style={{ flex:1, display:"flex", flexDirection:"column", gap:"4px" }}>
            {NAV_ITEMS.slice(0,4).map(({id,icon,label,href}) => (
              <button key={id} className="nav-link" onClick={() => router.push(href)}>
                <span className="ms" style={{ fontSize:"20px" }}>{icon}</span>{label}
              </button>
            ))}
            <button className="nav-link active">
              <span className="ms" style={{ fontSize:"20px" }}>upload_file</span>Admin Upload
            </button>
            <div style={{ padding:"16px 4px 8px", fontSize:"10px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em" }}>Account</div>
            {NAV_ITEMS.slice(4).map(({id,icon,label,href}) => (
              <button key={id} className="nav-link" onClick={() => router.push(href)}>
                <span className="ms" style={{ fontSize:"20px" }}>{icon}</span>{label}
              </button>
            ))}
            <button className="nav-link danger" onClick={() => signOut(auth).then(() => router.replace("/"))}>
              <span className="ms" style={{ fontSize:"20px" }}>logout</span>Sign Out
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="sb-main">
          <header className="sb-header">
            {/* ... your existing header ... */}
            <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
              <div style={{ width:"36px", height:"36px", background:"#00FF00", borderRadius:"9px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 12px rgba(0,255,0,0.4)" }}>
                <span className="ms" style={{ color:"#0f172a", fontSize:"20px" }}>upload_file</span>
              </div>
              <div>
                <h2 style={{ fontSize:"15px", fontWeight:700, color:text1, margin:0 }}>Admin Upload</h2>
                <p style={{ fontSize:"11px", color:text3, margin:0 }}>Chunks PDF → stores in Firebase Realtime DB · No storage fees</p>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"10px", cursor:"pointer" }} onClick={() => router.push("/profile")}>
              <div style={{ textAlign:"right" }}>
                <p style={{ fontSize:"12px", fontWeight:700, color:text1, margin:0 }}>{fullName || "—"}</p>
                <p style={{ fontSize:"10px", color:"#00AA00", fontWeight:700, margin:0 }}>Admin</p>
              </div>
              <AvatarEl size={40} />
            </div>
          </header>

          <div className="sb-scroll">
            {/* Heading */}
            <div style={{ animation:"fadeUp 0.3s ease both" }}>
              <h2 style={{ fontSize:"clamp(1.4rem,3vw,1.9rem)", fontWeight:700, letterSpacing:"-0.03em", color:text1, marginBottom:"6px" }}>Upload Module PDF</h2>
              <p style={{ fontSize:"14px", color:text2, margin:0 }}>PDF is split into 500KB chunks and stored directly in Firebase Realtime Database.</p>
            </div>

            {/* How it works - unchanged */}
            <div style={{ display:"flex", gap:"12px", flexWrap:"wrap", animation:"fadeUp 0.35s ease both" }}>
              {[
                { icon:"upload_file", label:"1. Pick PDF", sub:"Any size" },
                { icon:"cut", label:"2. Auto-chunks", sub:"500KB each" },
                { icon:"database", label:"3. Saves to Firebase", sub:"Realtime DB" },
                { icon:"picture_as_pdf",label:"4. Students view it", sub:"Your PDF viewer" },
              ].map(({icon,label,sub}) => (
                <div key={label} style={{ flex:"1 1 160px", background:card, border:`1px solid ${bdr}`, borderRadius:"16px", padding:"16px", display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{ width:"40px", height:"40px", borderRadius:"12px", background:"rgba(0,255,0,0.1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <span className="ms" style={{ fontSize:"22px", color:"#00CC00" }}>{icon}</span>
                  </div>
                  <div>
                    <p style={{ fontSize:"12px", fontWeight:700, color:text1, margin:0 }}>{label}</p>
                    <p style={{ fontSize:"11px", color:text3, margin:0 }}>{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Success & Error Messages */}
            {status === "success" && (
              <div style={{ background:"rgba(0,255,0,0.08)", border:"1px solid rgba(0,255,0,0.3)", borderRadius:"16px", padding:"20px 24px", display:"flex", alignItems:"center", gap:"16px", animation:"successPop 0.5s cubic-bezier(0.34,1.56,0.64,1) both" }}>
                <div style={{ width:"52px", height:"52px", borderRadius:"14px", background:"rgba(0,255,0,0.15)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <span className="ms" style={{ fontSize:"30px", color:"#00DD00" }}>check_circle</span>
                </div>
                <div>
                  <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:"0 0 4px" }}>Upload Complete!</p>
                  <p style={{ fontSize:"12px", color:text2, margin:0 }}>
                    Module saved successfully with Title and Description.
                  </p>
                </div>
              </div>
            )}

            {status === "error" && errorMsg && (
              <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:"16px", padding:"16px 20px", display:"flex", alignItems:"center", gap:"12px", animation:"fadeUp 0.3s ease both" }}>
                <span className="ms" style={{ fontSize:"24px", color:"#ef4444" }}>error</span>
                <p style={{ fontSize:"13px", color:text1, margin:0 }}>{errorMsg}</p>
              </div>
            )}

            {/* Form */}
            <div className="form-card">
              {/* Path preview */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${bdr}`, paddingBottom:"16px", flexWrap:"wrap", gap:"8px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <div style={{ width:"8px", height:"8px", borderRadius:"9999px", background:"#00FF00", boxShadow:"0 0 8px rgba(0,255,0,0.7)" }} />
                  <h3 style={{ fontSize:"14px", fontWeight:700, color:text1, margin:0 }}>Target Path</h3>
                </div>
                <code style={{ fontSize:"11px", color:text3, background:isDark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)", padding:"4px 10px", borderRadius:"8px" }}>
                  notes/{branch}/{sem}/subjects/{subject||"…"}/modules/{moduleKey}
                </code>
              </div>

              {/* Branch / Sem / Subject */}
              <div className="form-row-3">
                <div>
                  <label style={lbl}>Branch</label>
                  <select style={inp} value={branch} onChange={e => setBranch(e.target.value)}>
                    {BRANCHES.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Semester</label>
                  <select style={inp} value={sem} onChange={e => setSem(e.target.value)}>
                    {SEMS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Subject</label>
                  {Object.keys(subjects).length > 0
                    ? <select style={inp} value={subject} onChange={e => setSubject(e.target.value)}>
                        {Object.keys(subjects).map(c => <option key={c}>{c}</option>)}
                      </select>
                    : <input style={inp} placeholder="e.g. CN" value={subject} onChange={e => setSubject(e.target.value.toUpperCase())} />
                  }
                </div>
              </div>

              {/* Module Details - Updated with Description */}
              <div className="form-row-3">
                <div>
                  <label style={lbl}>Module</label>
                  <select style={inp} value={moduleKey} onChange={e => setModuleKey(e.target.value)}>
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={`module${n}`}>module{n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Module Title <span style={{color:"#ef4444"}}>*</span></label>
                  <input 
                    style={inp} 
                    placeholder="e.g. Introduction to Computer Networks" 
                    value={moduleTitle} 
                    onChange={e => setModuleTitle(e.target.value)} 
                  />
                </div>
                <div>
                  <label style={lbl}>Module Description</label>
                  <textarea
                    style={{
                      ...inp,
                      minHeight: "88px",
                      resize: "vertical",
                      padding: "12px 16px",
                      lineHeight: "1.5",
                    }}
                    placeholder="Brief description of what this module covers (optional)"
                    value={moduleDescription}
                    onChange={e => setModuleDescription(e.target.value)}
                  />
                </div>
              </div>

              {/* PDF Drop Zone */}
              <div>
                <label style={lbl}>PDF File</label>
                <div
                  className={`drop-zone${dragOver?" over":""}${file?" has-file":""}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <input ref={fileRef} type="file" accept="application/pdf" style={{ display:"none" }} onChange={handleFileDrop} />
                  {file ? (
                    <>
                      <div style={{ width:"56px", height:"56px", borderRadius:"14px", background:"rgba(239,68,68,0.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span className="ms" style={{ fontSize:"32px", color:"#ef4444" }}>picture_as_pdf</span>
                      </div>
                      <div>
                        <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:"0 0 4px" }}>{file.name}</p>
                        <p style={{ fontSize:"12px", color:text3, margin:0 }}>
                          {(file.size/1024/1024).toFixed(2)} MB ·{" "}
                          <span style={{ color:"#00AA00", fontWeight:700 }}>
                            ~{Math.ceil((file.size * 1.37) / CHUNK_SIZE)} chunks
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setFile(null); setStatus("idle"); }}
                        style={{ background:"rgba(239,68,68,0.1)", border:"none", borderRadius:"8px", padding:"6px 14px", cursor:"pointer", fontSize:"12px", fontWeight:700, color:"#ef4444", fontFamily:"'Lexend',sans-serif" }}
                      >Remove</button>
                    </>
                  ) : (
                    <>
                      <div style={{ width:"64px", height:"64px", borderRadius:"16px", background:isDark?"rgba(255,255,255,0.04)":"rgba(0,200,0,0.06)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span className="ms" style={{ fontSize:"36px", color:text3 }}>cloud_upload</span>
                      </div>
                      <div>
                        <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:"0 0 4px" }}>Drag & drop PDF here</p>
                        <p style={{ fontSize:"12px", color:text3, margin:0 }}>or click to browse · PDF only</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Upload progress */}
              {status === "uploading" && (
                <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:"12px", fontWeight:600, color:text2 }}>{statusMsg}</span>
                    <span style={{ fontSize:"12px", fontWeight:700, color:"#00AA00" }}>{progress}%</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width:`${progress}%` }} />
                  </div>
                </div>
              )}

              {/* Upload button */}
              <button className="btn-up" disabled={status==="uploading"||!file} onClick={handleUpload}>
                {status === "uploading"
                  ? <><div style={{ width:"18px", height:"18px", border:"2.5px solid rgba(15,23,42,0.3)", borderTopColor:"#0f172a", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />Uploading {progress}%…</>
                  : <><span className="ms" style={{ fontSize:"20px" }}>upload_file</span>Upload & Chunk to Firebase</>
                }
              </button>
            </div>

            {/* Warning card */}
            <div style={{ background:isDark?"rgba(245,158,11,0.06)":"rgba(245,158,11,0.05)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:"16px", padding:"16px 20px", display:"flex", gap:"12px", animation:"fadeUp 0.5s ease both" }}>
              <span className="ms" style={{ fontSize:"22px", color:"#f59e0b", flexShrink:0 }}>warning</span>
              <div>
                <p style={{ fontSize:"13px", fontWeight:700, color:text1, margin:"0 0 4px" }}>Large PDFs take time</p>
                <p style={{ fontSize:"12px", color:text2, margin:0, lineHeight:1.6 }}>
                  A 10MB PDF becomes ~13MB of base64, split into ~27 chunks. Each chunk is a separate Firebase write.
                  Keep the page open during upload. Recommended max: <strong>15MB per PDF</strong> for best performance.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}