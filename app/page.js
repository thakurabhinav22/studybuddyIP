"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, set, get } from "firebase/database";

/* ── Firebase ── */
const firebaseConfig = {
  apiKey: "AIzaSyBwMv_hfByidn1IVp9o4FN4WmvCpcST0hU",
  authDomain: "studybuddytcet.firebaseapp.com",
  projectId: "studybuddytcet",
  storageBucket: "studybuddytcet.firebasestorage.app",
  messagingSenderId: "603759519713",
  appId: "1:603759519713:web:544660c31f2af12c8c54a0",
  databaseURL: "https://studybuddytcet-default-rtdb.firebaseio.com/",
};
const app  = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db   = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

/* ── Theme Hook ── */
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
    const update = () => setResolved(
      theme === "system" ? (mq.matches ? "dark" : "light") : theme
    );
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);

  return { theme, setTheme, resolved };
}

/* ── Login Modal ── */
function LoginModal({ onClose, resolved, onSignInSuccess }) {
  const isDark = resolved === "dark";
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const handleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const u = result.user;

      const userRef   = ref(db, `users/${u.uid}`);
      const snapshot  = await get(userRef);

      const isTcetEmail = u.email && u.email.endsWith("@tcetmumbai.in");
      const accountExists = snapshot.exists();
      const isAdmin = accountExists && snapshot.val().role === "admin";

      if (!isTcetEmail && !accountExists) {
        await auth.signOut();
        setError("New accounts must use a @tcetmumbai.in email.");
        setLoading(false);
        return;
      }

      const nameParts = (u.displayName || "").trim().split(/\s+/);

      if (!snapshot.exists()) {
        await set(userRef, {
          uid:         u.uid,
          email:       u.email        || "",
          firstName:   nameParts[0]   || "",
          lastName:    nameParts.slice(1).join(" ") || "",
          fullName:    u.displayName  || "",
          photoURL:    u.photoURL     || "",
          branch:      null,
          role:        "student",
          createdAt:   new Date().toISOString(),
          lastSignInAt:new Date().toISOString(),
        });
      } else {
        await set(ref(db, `users/${u.uid}/lastSignInAt`), new Date().toISOString());
      }

      onSignInSuccess(isAdmin);
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user") setError("Sign-in cancelled.");
      else setError("Sign-in failed. Please try again.");
      setLoading(false);
    }
  };

  const c = {
    card:    isDark ? "rgba(15,23,42,0.97)" : "rgba(255,255,255,0.97)",
    border:  isDark ? "rgba(0,255,0,0.2)"  : "rgba(255,255,255,0.4)",
    text1:   isDark ? "#f1f5f9"            : "#0f172a",
    text2:   isDark ? "#94a3b8"            : "#64748b",
    btnBg:   isDark ? "rgba(255,255,255,0.06)" : "#ffffff",
    btnBdr:  isDark ? "rgba(255,255,255,0.12)" : "#e2e8f0",
    divider: isDark ? "rgba(255,255,255,0.1)"  : "#e2e8f0",
    divTxt:  isDark ? "#475569"            : "#94a3b8",
    closeBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
    closeHv: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)",
  };

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:999, background:"rgba(15,23,42,0.55)", backdropFilter:"blur(18px)", WebkitBackdropFilter:"blur(18px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position:"absolute", top:"15%", left:"20%",  width:"300px", height:"300px", background:"rgba(0,255,0,0.08)", borderRadius:"9999px", filter:"blur(100px)", pointerEvents:"none" }} />
      <div style={{ position:"absolute", bottom:"15%", right:"20%", width:"250px", height:"250px", background:"rgba(0,255,0,0.12)", borderRadius:"9999px", filter:"blur(80px)",  pointerEvents:"none" }} />

      <div style={{ position:"relative", width:"100%", maxWidth:"420px", background:c.card, borderRadius:"24px", boxShadow:"0 32px 80px rgba(0,0,0,0.2)", border:`1px solid ${c.border}`, padding:"40px 32px", display:"flex", flexDirection:"column", alignItems:"center", animation:"modalIn 0.3s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <button onClick={onClose}
          style={{ position:"absolute", top:"16px", right:"16px", width:"36px", height:"36px", borderRadius:"9999px", border:"none", background:c.closeBg, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = c.closeHv)}
          onMouseLeave={(e) => (e.currentTarget.style.background = c.closeBg)}
        >
          <span className="material-symbols-outlined" style={{ fontSize:"20px", color: isDark ? "#94a3b8" : "#475569" }}>close</span>
        </button>

        <div style={{ width:"64px", height:"64px", background:"#00FF00", borderRadius:"16px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 28px rgba(0,255,0,0.4)", marginBottom:"24px", marginTop:"8px" }}>
          <span className="material-symbols-outlined" style={{ fontSize:"36px", color:"#0f172a" }}>school</span>
        </div>

        <h1 style={{ fontSize:"24px", fontWeight:800, color:c.text1, margin:"0 0 6px", letterSpacing:"-0.03em", textAlign:"center" }}>Welcome to StudyBuddy</h1>
        <p  style={{ fontSize:"14px", color:c.text2, fontWeight:500, margin:"0 0 8px", textAlign:"center" }}>Exclusively for TCET Students</p>

        <div style={{ display:"inline-flex", alignItems:"center", gap:"6px", padding:"4px 12px", background:"rgba(0,255,0,0.1)", border:"1px solid rgba(0,255,0,0.25)", borderRadius:"9999px", marginBottom:"28px" }}>
          <span className="material-symbols-outlined" style={{ fontSize:"14px", color:"#009900" }}>verified</span>
          <span style={{ fontSize:"11px", fontWeight:800, color:"#009900", textTransform:"uppercase", letterSpacing:"0.08em" }}>TCET Verified</span>
        </div>

        {error && (
          <div style={{ width:"100%", padding:"10px 14px", background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.3)", borderRadius:"10px", marginBottom:"12px", fontSize:"13px", color:"#f87171", fontWeight:600, textAlign:"center" }}>
            {error}
          </div>
        )}

        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:"16px" }}>
          <button
            onClick={handleSignIn}
            disabled={loading}
            style={{ width:"100%", height:"52px", background:c.btnBg, border:`1.5px solid ${c.btnBdr}`, borderRadius:"14px", display:"flex", alignItems:"center", justifyContent:"center", gap:"12px", cursor: loading ? "not-allowed" : "pointer", fontSize:"15px", fontWeight:700, color:c.text1, opacity: loading ? 0.7 : 1, transition:"all 0.25s cubic-bezier(0.34,1.56,0.64,1)", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}
            onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor="rgba(0,255,0,0.5)"; e.currentTarget.style.boxShadow="0 0 20px rgba(0,255,0,0.2)"; e.currentTarget.style.transform="translateY(-2px) scale(1.01)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor=c.btnBdr; e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.06)"; e.currentTarget.style.transform="translateY(0) scale(1)"; }}
          >
            {loading
              ? <div style={{ width:"20px", height:"20px", border:"2px solid rgba(0,255,0,0.3)", borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />
              : <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            }
            {loading ? "Signing in…" : "Continue with TCET ID"}
          </button>

          <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
            <div style={{ flex:1, height:"1px", background:c.divider }} />
            <span style={{ fontSize:"11px", fontWeight:800, textTransform:"uppercase", letterSpacing:"0.1em", color:c.divTxt }}>Secured by Google</span>
            <div style={{ flex:1, height:"1px", background:c.divider }} />
          </div>
        </div>

        <p style={{ fontSize:"12px", color: isDark ? "#64748b" : "#94a3b8", lineHeight:1.6, maxWidth:"280px", margin:"24px 0 0", textAlign:"center" }}>
          By continuing, you agree to our{" "}
          <a href="#" style={{ color:"#00BB00", textDecoration:"none", fontWeight:600 }}>Terms</a>{" "}and{" "}
          <a href="#" style={{ color:"#00BB00", textDecoration:"none", fontWeight:600 }}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

/* ── Theme Switcher ── */
function ThemeSwitcher({ theme, setTheme, resolved }) {
  const isDark = resolved === "dark";
  const opts = [
    { value:"light",  icon:"light_mode",     label:"Light"  },
    { value:"dark",   icon:"dark_mode",       label:"Dark"   },
    { value:"system", icon:"desktop_windows", label:"System" },
  ];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:"4px", padding:"5px", borderRadius:"9999px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border:`1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`, boxShadow: isDark ? "0 2px 12px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.06)" }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <button key={value} onClick={() => setTheme(value)} title={label}
            style={{ display:"flex", alignItems:"center", gap:"6px", padding:"7px 14px", borderRadius:"9999px", border:"none", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:"12px", fontWeight:700, transition:"all 0.22s cubic-bezier(0.34,1.56,0.64,1)", background: active ? (isDark ? "rgba(0,255,0,0.18)" : "#00FF00") : "transparent", color: active ? (isDark ? "#00FF00" : "#0f172a") : (isDark ? "#64748b" : "#94a3b8"), boxShadow: active ? (isDark ? "0 0 16px rgba(0,255,0,0.3)" : "0 4px 14px rgba(0,255,0,0.35)") : "none", transform: active ? "scale(1.04)" : "scale(1)" }}
            onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"; e.currentTarget.style.color = isDark ? "#94a3b8" : "#475569"; } }}
            onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = isDark ? "#64748b" : "#94a3b8"; } }}
          >
            <span className="material-symbols-outlined" style={{ fontSize:"15px" }}>{icon}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior:"smooth", block:"start" });
}

/* ══════════════════════════════════════════ */
export default function Home() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isTcetEmail = user.email && user.email.endsWith("@tcetmumbai.in");
        let isAdmin = false;
        let accountExists = false;
        
        try {
          const userRef = ref(db, `users/${user.uid}`);
          const snapshot = await get(userRef);
          if (snapshot.exists()) {
            accountExists = true;
            if (snapshot.val().role === "admin") {
              isAdmin = true;
            }
          }
        } catch (e) {
          console.error(e);
        }

        if (isTcetEmail || accountExists) {
          if (isAdmin) {
            router.replace("/admin");
          } else {
            router.replace("/dashboard");
          }
        } else {
          await auth.signOut();
        }
      }
    });
    return () => unsub();
  }, [router]);

  /* derived colours */
  const bg      = isDark ? "#080f1a"               : "#F6FFF7";
  const surface = isDark ? "rgba(15,23,42,0.96)"   : "rgba(255,255,255,0.94)";
  const text1   = isDark ? "#f1f5f9"               : "#0f172a";
  const text2   = isDark ? "#94a3b8"               : "#475569";
  const border  = isDark ? "rgba(0,255,0,0.14)"    : "rgba(0,255,0,0.18)";
  const navBg   = isDark ? "rgba(8,15,26,0.92)"    : "rgba(255,255,255,0.9)";

  const navLinks = [
    { icon:"home",         label:"Home",         target:"hero"  },
    { icon:"auto_stories", label:"AI Notes",     target:"notes" },
    { icon:"quiz",         label:"AI Test",      target:"test"  },
    { icon:"forum",        label:"Doubt Solver", target:"doubt" },
  ];

  const subjects = [
    { code:"DSA",   label:"Data Structures & Algorithms" },
    { code:"DBMS",  label:"Database Management Systems"  },
    { code:"OS",    label:"Operating Systems"            },
    { code:"CN",    label:"Computer Networks"            },
    { code:"SE",    label:"Software Engineering"         },
    { code:"AI/ML", label:"Artificial Intelligence & ML" },
    { code:"TOC",   label:"Theory of Computation"        },
    { code:"CD",    label:"Compiler Design"              },
  ];

  const tools = [
    { id:"notes", icon:"auto_stories", tag:"AI Notes",      title:"Smart Notes Generator",   desc:"Upload any TCET lecture slide, PDF, or textbook chapter. Get structured notes with key concepts, diagrams explained, and exam-ready summaries — tailored to your syllabus.", chips:["Chapter Summaries","Mind Maps","Formula Sheets","Revision Cards"],   demo:{ q:"Summarise OS Unit 3 — Deadlocks for me.",         a:"Deadlock occurs when 4 conditions hold simultaneously: Mutual Exclusion, Hold & Wait, No Preemption, and Circular Wait. The Banker's Algorithm is used for avoidance by checking safe states before resource allocation..." } },
    { id:"test",  icon:"quiz",         tag:"AI Test",        title:"Adaptive Exam Simulator", desc:"Practice with AI-generated MCQs, 2-mark, and long-answer questions aligned with TCET University exam patterns. Adaptive difficulty targets your weak spots.",              chips:["MCQ Practice","2-Mark Questions","University Pattern","Score Analysis"], demo:{ q:"Generate 5 DBMS questions on Normalization.",      a:"Q1. What anomalies does 2NF eliminate? Q2. Define Boyce-Codd Normal Form... Q3. A relation R(A,B,C) with FD A→B, B→C is in which NF?..." } },
    { id:"doubt", icon:"forum",        tag:"AI Doubt Solver",title:"Instant Doubt Solver",    desc:"Stuck at 2AM before an exam? Ask any IT subject doubt and get a clear, step-by-step explanation with examples, pseudocode, diagrams described in plain text — instantly.", chips:["Step-by-Step","Code Examples","Pseudocode","Concept Clarity"],           demo:{ q:"I don't get how TCP 3-way handshake works.",     a:"Think of it like a phone call: SYN = 'Can you hear me?', SYN-ACK = 'Yes, can you hear me?', ACK = 'Yes!' — Client sends SYN, Server replies SYN+ACK, Client confirms with ACK. Connection established ✓" } },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:auto!important;}
        :root{--primary:#00FF00;--glow:rgba(0,255,0,0.4);}
        body{background:${bg};font-family:'Inter',sans-serif!important;overflow-x:hidden;margin:0;color:${text1};transition:background 0.3s,color 0.3s;}
        .material-symbols-outlined{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;}
        .glass{background:${surface};border:1px solid ${border};border-radius:28px;box-shadow:${isDark?"0 4px 24px rgba(0,0,0,0.4)":"0 4px 24px rgba(0,0,0,0.07)"};transition:background 0.3s,border-color 0.3s;}
        .liquid-nav{background:${navBg};backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid ${isDark?"rgba(0,255,0,0.15)":"rgba(255,255,255,0.7)"};box-shadow:${isDark?"0 8px 32px rgba(0,0,0,0.4)":"0 8px 32px rgba(0,0,0,0.1)"};}
        .nav-item{display:flex;align-items:center;justify-content:center;overflow:hidden;transition:all 0.3s ease-out;padding:8px 16px;border-radius:9999px;cursor:pointer;}
        .nav-label{max-width:0;opacity:0;white-space:nowrap;transition:all 0.3s ease-out;font-size:0.875rem;font-weight:700;color:${text1};}
        .nav-item:hover{background:${isDark?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.8)"};}
        .nav-item:hover .nav-label{max-width:110px;opacity:1;margin-left:8px;}
        .nav-item:hover .material-symbols-outlined{transform:scale(1.1);color:#00FF00!important;}
        .btn-green{position:relative;overflow:hidden;background:#00FF00;color:#0f172a;border:none;border-radius:28px;cursor:pointer;font-weight:900;font-family:'Inter',sans-serif;transition:transform 0.28s cubic-bezier(0.34,1.56,0.64,1),box-shadow 0.25s ease;box-shadow:0 8px 28px rgba(0,255,0,0.38);}
        .btn-green:hover{transform:translateY(-3px) scale(1.04);box-shadow:0 18px 44px rgba(0,255,0,0.52);}
        .btn-green:active{transform:translateY(1px) scale(0.97);}
        .btn-outline{position:relative;overflow:hidden;background:${isDark?"rgba(255,255,255,0.05)":"rgba(255,255,255,0.94)"};border:1.5px solid ${isDark?"rgba(0,255,0,0.25)":"rgba(0,255,0,0.3)"};border-radius:28px;cursor:pointer;font-weight:700;font-family:'Inter',sans-serif;color:${text1};transition:transform 0.28s cubic-bezier(0.34,1.56,0.64,1),box-shadow 0.25s ease,border-color 0.2s;box-shadow:${isDark?"0 4px 16px rgba(0,0,0,0.2)":"0 4px 16px rgba(0,0,0,0.06)"};}
        .btn-outline:hover{transform:translateY(-3px) scale(1.02);border-color:rgba(0,255,0,0.6);box-shadow:0 10px 28px rgba(0,255,0,0.18);}
        .bg-blob{filter:blur(90px);z-index:-1;pointer-events:none;}
        @keyframes modalIn{from{opacity:0;transform:scale(0.9) translateY(16px);}to{opacity:1;transform:scale(1) translateY(0);}}
        @keyframes bounceSlow{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
        @keyframes pulse2{0%,100%{opacity:1;}50%{opacity:0.5;}}
        @keyframes spin{to{transform:rotate(360deg);}}
        .bounce{animation:bounceSlow 4s ease-in-out infinite;}
        .pulse{animation:pulse2 2.2s ease-in-out infinite;}
        .tool-card{transition:transform 0.28s cubic-bezier(0.34,1.56,0.64,1),box-shadow 0.25s ease;}
        .tool-card:hover{transform:translateY(-6px);box-shadow:0 24px 56px rgba(0,255,0,0.28)!important;}
        .tool-card:hover .tool-icon{background:#00FF00!important;}
        .chip{display:inline-flex;align-items:center;padding:5px 14px;background:rgba(0,255,0,0.1);border:1px solid rgba(0,255,0,0.22);border-radius:9999px;font-size:12px;font-weight:700;color:#009900;}
        .subj-pill{transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1),box-shadow 0.2s,background 0.2s;}
        .subj-pill:hover{transform:scale(1.05);background:rgba(0,255,0,0.18)!important;box-shadow:0 4px 16px rgba(0,255,0,0.25);}
      `}</style>

      {showModal && (
        <LoginModal
          onClose={() => setShowModal(false)}
          resolved={resolved}
          onSignInSuccess={(isAdmin) => {
            if (isAdmin) {
              router.replace("/admin");
            } else {
              router.replace("/dashboard");
            }
          }}
        />
      )}

      <div className="bg-blob" style={{ position:"fixed", top:"-10%", left:"-10%", width:"50%", height:"50%", background: isDark ? "rgba(0,255,0,0.06)" : "rgba(0,255,0,0.11)", borderRadius:"9999px" }} />
      <div className="bg-blob" style={{ position:"fixed", bottom:"-10%", right:"-10%", width:"40%", height:"40%", background: isDark ? "rgba(0,255,0,0.07)" : "rgba(0,255,0,0.13)", borderRadius:"9999px" }} />

      {/* Floating Nav */}
      <div style={{ position:"fixed", bottom:"32px", left:"50%", transform:"translateX(-50%)", zIndex:100 }}>
        <nav className="liquid-nav" style={{ display:"flex", alignItems:"center", gap:"4px", padding:"8px", borderRadius:"9999px" }}>
          {navLinks.map(({ icon, label, target }) => (
            <div key={label} className="nav-item" onClick={() => scrollTo(target)}>
              <span className="material-symbols-outlined" style={{ color: isDark ? "#94a3b8" : "#334155" }}>{icon}</span>
              <span className="nav-label">{label}</span>
            </div>
          ))}
          <div style={{ width:"1px", height:"28px", background: isDark ? "rgba(255,255,255,0.12)" : "#cbd5e1", margin:"0 6px" }} />
          <div className="nav-item btn-green" style={{ padding:"8px 20px", borderRadius:"9999px", fontSize:"14px" }} onClick={() => setShowModal(true)}>
            <span className="material-symbols-outlined" style={{ color:"#0f172a" }}>rocket_launch</span>
            <span className="nav-label" style={{ color:"#0f172a" }}>Get Started</span>
          </div>
        </nav>
      </div>

      <main style={{ maxWidth:"1280px", margin:"0 auto", padding:"48px 24px 160px" }}>

        {/* Hero */}
        <section id="hero" style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:"72px", padding:"64px 0 100px" }}>
          <div style={{ flex:1, minWidth:"300px", display:"flex", flexDirection:"column", gap:"36px" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:"10px", padding:"8px 18px", background:"rgba(0,255,0,0.08)", border:"1px solid rgba(0,255,0,0.25)", borderRadius:"9999px", width:"fit-content" }}>
              <span className="material-symbols-outlined" style={{ fontSize:"16px", color:"#009900" }}>verified</span>
              <span style={{ fontSize:"12px", fontWeight:800, color: isDark ? "#d1fae5" : "#1e293b", textTransform:"uppercase", letterSpacing:"0.08em" }}>Thakur College of Engineering.</span>
            </div>
            <h1 style={{ fontSize:"clamp(2.8rem,7vw,5.2rem)", fontWeight:900, lineHeight:1.04, letterSpacing:"-0.03em", color:text1, margin:0 }}>
              Master <span style={{ color:"#00FF00" }}>Complexity</span> with AI.
            </h1>
            <p style={{ fontSize:"1.15rem", color:text2, lineHeight:1.75, maxWidth:"460px", fontWeight:500, margin:0 }}>
              Your personal AI study partner — built specifically for TCET students. From DSA to AI/ML, ace every subject with smart notes, instant doubt solving, and adaptive mock tests.
            </p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"14px" }}>
              <button className="btn-green" style={{ padding:"20px 40px", fontSize:"1.05rem" }} onClick={() => setShowModal(true)}>Start Studying Free</button>
              <button className="btn-outline" style={{ padding:"20px 36px", fontSize:"1.05rem", display:"flex", alignItems:"center", gap:"10px" }} onClick={() => scrollTo("notes")}>
                <span className="material-symbols-outlined" style={{ fontSize:"24px" }}>arrow_downward</span>
                Explore Tools
              </button>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"10px" }}>
              {[{ val:"TCET", label:"Syllabus Aligned" },{ val:"24/7", label:"AI Availability" }].map(({ val, label }) => (
                <div key={label} style={{ padding:"8px 16px", background:"rgba(0,255,0,0.08)", border:"1px solid rgba(0,255,0,0.2)", borderRadius:"9999px", display:"flex", alignItems:"center", gap:"7px" }}>
                  <span style={{ fontWeight:900, fontSize:"14px", color:"#009900" }}>{val}</span>
                  <span style={{ fontSize:"13px", fontWeight:600, color:text2 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chat card */}
          <div style={{ flex:1, minWidth:"300px", position:"relative" }}>
            <div className="glass" style={{ padding:"36px", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg,rgba(0,255,0,0.06),transparent)", borderRadius:"28px", pointerEvents:"none" }} />
              <div style={{ position:"relative", display:"flex", flexDirection:"column", gap:"24px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingBottom:"18px", borderBottom:`1px solid ${isDark?"rgba(255,255,255,0.08)":"rgba(148,163,184,0.28)"}` }}>
                  <div style={{ display:"flex", gap:"8px" }}>
                    {["#f87171","#facc15","#00FF00"].map(c => <div key={c} style={{ width:"12px", height:"12px", borderRadius:"9999px", background:c }} />)}
                  </div>
                  <span style={{ fontSize:"11px", fontFamily:"monospace", fontWeight:700, color: isDark ? "#475569" : "#94a3b8" }}>studybuddy_neural_engine</span>
                </div>
                <div style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#fff", borderRadius:"16px", padding:"16px 18px", maxWidth:"86%", border:`1px solid ${isDark?"rgba(255,255,255,0.08)":"#f1f5f9"}`, boxShadow:`0 2px 8px rgba(0,0,0,${isDark?"0.2":"0.05"})` }}>
                  <p style={{ fontSize:"14px", fontWeight:600, color: isDark ? "#cbd5e1" : "#334155", margin:0 }}>Explain Deadlock in OS with Banker's Algorithm example.</p>
                </div>
                <div style={{ background:"rgba(0,255,0,0.08)", borderRadius:"16px", padding:"20px", marginLeft:"auto", maxWidth:"92%", border:"1px solid rgba(0,255,0,0.25)" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"7px", marginBottom:"10px" }}>
                    <span className="material-symbols-outlined" style={{ color:"#00CC00", fontSize:"17px" }}>memory</span>
                    <span style={{ fontSize:"11px", fontWeight:900, textTransform:"uppercase", color: isDark ? "#86efac" : "#1e293b", letterSpacing:"-0.01em" }}>StudyBuddy · TCET</span>
                  </div>
                  <p style={{ fontSize:"13px", lineHeight:1.75, color: isDark ? "#d1fae5" : "#1e293b", fontWeight:500, margin:0 }}>
                    Deadlock needs 4 conditions: Mutual Exclusion, Hold &amp; Wait, No Preemption, Circular Wait.{" "}
                    <strong style={{ color: isDark ? "#4ade80" : "#0f172a" }}>Banker's Algorithm</strong> prevents it by checking if granting a resource leaves the system in a safe state — if yes, allocate; else, make the process wait...
                  </p>
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"8px" }}>
                  {[{ icon:"quiz", label:"Test Me on This" },{ icon:"summarize", label:"Make Notes" }].map(({ icon, label }) => (
                    <div key={label}
                      style={{ padding:"10px 16px", borderRadius:"12px", display:"flex", alignItems:"center", gap:"8px", cursor:"pointer", background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.7)", border:"1px solid rgba(0,255,0,0.18)", transition:"background 0.2s,transform 0.2s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background="rgba(0,255,0,0.14)"; e.currentTarget.style.transform="scale(1.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background= isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.7)"; e.currentTarget.style.transform="scale(1)"; }}
                    >
                      <span className="material-symbols-outlined" style={{ color:"#00BB00", fontSize:"18px" }}>{icon}</span>
                      <span style={{ fontSize:"13px", fontWeight:800, color:text1 }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="glass bounce" style={{ position:"absolute", bottom:"-22px", left:"-22px", padding:"16px", border:"2px solid rgba(0,255,0,0.35)" }}>
              <span className="material-symbols-outlined" style={{ color:"#00CC00", fontSize:"32px" }}>terminal</span>
            </div>
            <div className="glass pulse" style={{ position:"absolute", top:"-36px", right:"-14px", padding:"14px", border:"2px solid rgba(0,255,0,0.35)" }}>
              <span className="material-symbols-outlined" style={{ color:"#00CC00", fontSize:"26px" }}>data_object</span>
            </div>
          </div>
        </section>

        {/* Subjects */}
        <section style={{ padding:"0 0 80px" }}>
          <p style={{ textAlign:"center", fontSize:"12px", fontWeight:800, textTransform:"uppercase", letterSpacing:"0.12em", color: isDark ? "#475569" : "#94a3b8", marginBottom:"20px" }}>Covers all TCET subjects</p>
          <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"center", gap:"10px" }}>
            {subjects.map(({ code, label }) => (
              <div key={code} className="subj-pill" style={{ padding:"10px 20px", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.92)", border:`1px solid ${isDark?"rgba(0,255,0,0.15)":"rgba(0,255,0,0.2)"}`, borderRadius:"9999px", display:"flex", alignItems:"center", gap:"8px", cursor:"default", boxShadow:`0 2px 10px rgba(0,0,0,${isDark?"0.2":"0.05"})` }}>
                <span style={{ fontSize:"12px", fontWeight:900, color:"#009900" }}>{code}</span>
                <span style={{ fontSize:"13px", fontWeight:600, color: isDark ? "#94a3b8" : "#334155" }}>{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Tools */}
        {tools.map(({ id, icon, tag, title, desc, chips, demo }, idx) => (
          <section key={id} id={id} style={{ padding:"80px 0", borderTop:`1px solid ${isDark?"rgba(0,255,0,0.08)":"rgba(0,255,0,0.1)"}`, display:"flex", flexWrap:"wrap", alignItems:"center", gap:"64px", flexDirection: idx%2===1 ? "row-reverse" : "row" }}>
            <div style={{ flex:1, minWidth:"280px", display:"flex", flexDirection:"column", gap:"24px" }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:"8px", padding:"6px 14px", background:"rgba(0,255,0,0.1)", border:"1px solid rgba(0,255,0,0.22)", borderRadius:"9999px", width:"fit-content" }}>
                <span className="material-symbols-outlined" style={{ fontSize:"16px", color:"#009900" }}>{icon}</span>
                <span style={{ fontSize:"11px", fontWeight:900, color:"#009900", textTransform:"uppercase", letterSpacing:"0.08em" }}>{tag}</span>
              </div>
              <h2 style={{ fontSize:"clamp(1.8rem,4vw,2.6rem)", fontWeight:900, letterSpacing:"-0.03em", color:text1, margin:0 }}>{title}</h2>
              <p style={{ fontSize:"1.05rem", color:text2, lineHeight:1.75, fontWeight:500, margin:0 }}>{desc}</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"8px" }}>
                {chips.map(c => <span key={c} className="chip">{c}</span>)}
              </div>
              <div style={{ display:"flex", gap:"12px", flexWrap:"wrap" }}>
                <button className="btn-green" style={{ padding:"16px 32px", fontSize:"0.95rem" }} onClick={() => setShowModal(true)}>Try {tag}</button>
                <button className="btn-outline" style={{ padding:"16px 28px", fontSize:"0.95rem" }} onClick={() => scrollTo(id)}>Learn More</button>
              </div>
            </div>
            <div style={{ flex:1, minWidth:"280px" }}>
              <div className="glass tool-card" style={{ padding:"32px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"20px", paddingBottom:"16px", borderBottom:`1px solid ${isDark?"rgba(255,255,255,0.07)":"rgba(148,163,184,0.2)"}` }}>
                  <div className="tool-icon" style={{ width:"40px", height:"40px", borderRadius:"12px", background:"rgba(0,210,0,0.15)", display:"flex", alignItems:"center", justifyContent:"center", transition:"background 0.3s" }}>
                    <span className="material-symbols-outlined" style={{ fontSize:"22px", color:"#009900" }}>{icon}</span>
                  </div>
                  <div>
                    <div style={{ fontSize:"13px", fontWeight:800, color:text1 }}>{tag}</div>
                    <div style={{ fontSize:"11px", color: isDark ? "#475569" : "#94a3b8", fontWeight:600 }}>TCET · Ready</div>
                  </div>
                  <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"5px" }}>
                    <span className="pulse" style={{ display:"block", width:"8px", height:"8px", borderRadius:"9999px", background:"#00FF00", boxShadow:"0 0 6px #00FF00" }} />
                    <span style={{ fontSize:"11px", fontWeight:700, color:"#009900" }}>Live</span>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                  <div style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#fff", borderRadius:"14px", padding:"14px 16px", maxWidth:"88%", border:`1px solid ${isDark?"rgba(255,255,255,0.07)":"#f1f5f9"}` }}>
                    <p style={{ fontSize:"13px", fontWeight:600, color: isDark ? "#cbd5e1" : "#334155", margin:0 }}>{demo.q}</p>
                  </div>
                  <div style={{ background:"rgba(0,255,0,0.08)", borderRadius:"14px", padding:"16px", marginLeft:"auto", maxWidth:"94%", border:"1px solid rgba(0,255,0,0.22)" }}>
                    <p style={{ fontSize:"13px", lineHeight:1.7, color: isDark ? "#d1fae5" : "#1e293b", fontWeight:500, margin:0 }}>{demo.a}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ))}

        {/* CTA */}
        <section style={{ padding:"96px 0 0" }}>
          <div style={{ background:"#0f172a", borderRadius:"28px", border:"1px solid rgba(0,255,0,0.28)", padding:"80px 40px", textAlign:"center", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", inset:0, background:"radial-gradient(circle at 50% 50%,rgba(0,255,0,0.14),transparent 70%)", pointerEvents:"none" }} />
            <div style={{ position:"relative", zIndex:1, maxWidth:"680px", margin:"0 auto", display:"flex", flexDirection:"column", gap:"24px", alignItems:"center" }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:"8px", padding:"6px 16px", background:"rgba(0,255,0,0.12)", border:"1px solid rgba(0,255,0,0.3)", borderRadius:"9999px" }}>
                <span className="material-symbols-outlined" style={{ fontSize:"14px", color:"#00FF00" }}>school</span>
                <span style={{ fontSize:"11px", fontWeight:800, color:"#00FF00", textTransform:"uppercase", letterSpacing:"0.1em" }}>Thakur College of Engineering</span>
              </div>
              <h2 style={{ fontSize:"clamp(2rem,5vw,3.2rem)", fontWeight:900, letterSpacing:"-0.03em", lineHeight:1.15, color:"#ffffff", margin:0 }}>
                Ready to Master <span style={{ color:"#00FF00" }}>Every Subject?</span>
              </h2>
              <p style={{ fontSize:"1.1rem", fontWeight:500, color:"#94a3b8", margin:0, maxWidth:"480px" }}>
                Join TCET students who are scoring higher, studying smarter, and never getting stuck again.
              </p>
              <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"center", gap:"16px", paddingTop:"8px" }}>
                <button className="btn-green" style={{ padding:"20px 44px", fontSize:"1.1rem" }} onClick={() => setShowModal(true)}>Get Started Free</button>
                <button className="btn-outline" style={{ padding:"20px 40px", fontSize:"1.1rem", background:"rgba(255,255,255,0.07)", color:"#fff", borderColor:"rgba(255,255,255,0.2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background="rgba(255,255,255,0.15)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.4)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background="rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.2)"; }}
                  onClick={() => scrollTo("notes")}
                >Explore Tools</button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ padding:"64px 0 0", marginTop:"80px", borderTop:`1px solid ${isDark?"rgba(255,255,255,0.07)":"#e2e8f0"}` }}>
          <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between", gap:"28px", opacity:0.9, marginBottom:"32px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
              <div style={{ background:"#00FF00", padding:"6px", borderRadius:"8px" }}>
                <span className="material-symbols-outlined" style={{ color:"#0f172a" }}>auto_stories</span>
              </div>
              <div>
                <div style={{ fontSize:"1.1rem", fontWeight:900, letterSpacing:"-0.04em", color:text1, lineHeight:1 }}>StudyBuddy</div>
                <div style={{ fontSize:"11px", fontWeight:700, color: isDark ? "#475569" : "#64748b", marginTop:"2px" }}>Thakur College of Engineering · IT</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:"36px", fontSize:"13px", fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em" }}>
              {["About","Privacy","Contact"].map(link => (
                <a key={link} href="#" style={{ textDecoration:"none", color: isDark ? "#475569" : "#475569", transition:"color 0.2s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color="#00CC00")}
                  onMouseLeave={(e) => (e.currentTarget.style.color="")}
                >{link}</a>
              ))}
            </div>
            <div style={{ display:"flex", gap:"10px" }}>
              {["hub","terminal","code"].map(icon => (
                <div key={icon} className="glass" style={{ width:"42px", height:"42px", borderRadius:"9999px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"background 0.2s,transform 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background="#00FF00"; e.currentTarget.style.transform="scale(1.12)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background=""; e.currentTarget.style.transform="scale(1)"; }}
                >
                  <span className="material-symbols-outlined" style={{ color: isDark ? "#64748b" : "#334155", fontSize:"18px" }}>{icon}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Theme row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"16px", padding:"20px 24px", borderRadius:"20px", background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border:`1px solid ${isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"}`, marginBottom:"28px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
              <span className="material-symbols-outlined" style={{ fontSize:"18px", color: isDark ? "#475569" : "#94a3b8" }}>{resolved==="dark" ? "dark_mode" : "light_mode"}</span>
              <div>
                <div style={{ fontSize:"13px", fontWeight:800, color:text1, lineHeight:1 }}>Appearance</div>
                <div style={{ fontSize:"11px", fontWeight:600, color: isDark ? "#475569" : "#94a3b8", marginTop:"2px" }}>
                  {theme==="system" ? `System (${resolved})` : `${resolved.charAt(0).toUpperCase()+resolved.slice(1)} mode`}
                </div>
              </div>
            </div>
            <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />
          </div>

          <div style={{ textAlign:"center", paddingBottom:"32px" }}>
            <p style={{ fontSize:"12px", fontWeight:600, color: isDark ? "#334155" : "#94a3b8", margin:0 }}>
              © {new Date().getFullYear()} StudyBuddy — Built for TCET students, by TCET students.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}