"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref, onValue, update } from "firebase/database";
import { logoutAndClearCache } from "@/lib/logout";

// ── Theme Hook ──
function useTheme() {
  const KEY = "studybuddy_theme";
  const [theme, setThemeState] = useState("system");
  const [resolved, setResolved] = useState("light");
  useEffect(() => { try { setThemeState(localStorage.getItem(KEY) || "system"); } catch {} }, []);
  const setTheme = (val) => { try { localStorage.setItem(KEY, val); } catch {} setThemeState(val); };
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    update(); mq.addEventListener("change", update); return () => mq.removeEventListener("change", update);
  }, [theme]);
  return { theme, setTheme, resolved };
}

// ── Theme Switcher ──
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
      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`, position: "relative"
    }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <div key={value} style={{ position: "relative" }}>
            <button
              onClick={() => setTheme(value)}
              onMouseEnter={() => setHovered(value)}
              onMouseLeave={() => setHovered(null)}
              title={label}
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
                padding: "4px 8px", borderRadius: "6px", whiteSpace: "nowrap", pointerEvents: "none",
                zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.3)", animation: "fadeUp 0.15s ease"
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

const BRANCHES = ["IT", "CS", "EXTC", "MECH", "CIVIL", "ELEC"];

export default function Profile() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [authUser, setAuthUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ firstName: "", fullName: "", branch: "" });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePage] = useState("profile");
  const [showNotifs, setShowNotifs] = useState(false);

  const notifRef = useRef(null);
  const notifBtn = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      const unsubDB = onValue(ref(db, `users/${u.uid}`), snap => {
        if (snap.exists()) {
          const d = snap.val();
          setUserData(d);
          setForm({
            firstName: d.firstName || "",
            fullName: d.fullName || "",
            branch: d.branch || ""
          });
        }
      });
      return () => unsubDB();
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    const handler = (e) => {
      if (showNotifs && notifRef.current && !notifRef.current.contains(e.target) &&
          notifBtn.current && !notifBtn.current.contains(e.target)) {
        setShowNotifs(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNotifs]);

  const save = async () => {
    if (!authUser) return;
    setSaving(true);
    await update(ref(db, `users/${authUser.uid}`), form);
    setSaving(false);
    setEditing(false);
  };

  // Colors
  const bg = isDark ? "#080f1a" : "#f5f8f5";
  const sidebarBg = isDark ? "rgba(8,15,26,0.96)" : "rgba(255,255,255,0.75)";
  const headerBg = isDark ? "rgba(8,15,26,0.92)" : "rgba(255,255,255,0.75)";
  const card = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const inputBg = isDark ? "rgba(255,255,255,0.05)" : "#f8fafc";

  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";
  const fullName = userData?.fullName || authUser?.displayName || "";
  const photoURL = userData?.photoURL || authUser?.photoURL || "";
  const branchVal = userData?.branch || "—";
  const email = userData?.email || authUser?.email || "—";
  const joined = authUser?.metadata?.creationTime
    ? new Date(authUser.metadata.creationTime).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "—";

  const stats = [
    { label: "Study Hours", value: userData?.stats?.studyHours || 0, icon: "schedule" },
    { label: "AI Questions", value: userData?.stats?.aiQuestions || 0, icon: "question_answer" },
    { label: "Problems", value: userData?.stats?.solvedProblems || 0, icon: "task_alt" },
    { label: "Day Streak", value: userData?.stats?.streak || 0, icon: "local_fire_department" },
  ];

  const navItems = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard" },
    { id: "notes", icon: "description", label: "Notes" },
    { id: "test", icon: "quiz", label: "Test" },
    { id: "ai", icon: "psychology", label: "Neural AI" },
    { id: "profile", icon: "person", label: "Profile" },
    { id: "settings", icon: "settings", label: "Settings" },
  ];

  const inputStyle = {
    width: "100%",
    background: inputBg,
    border: `1.5px solid ${bdr}`,
    borderRadius: "10px",
    padding: "12px 16px",
    fontSize: "14px",
    fontFamily: "'Inter',sans-serif",
    color: text1,
    outline: "none",
    transition: "all 0.2s ease",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'Inter',sans-serif; background:${bg}; color:${text1}; overflow:hidden; }
        .ms { font-family:'Material Symbols Outlined'!important; font-weight:normal; font-style:normal; font-size:24px; line-height:1; display:inline-block; white-space:nowrap; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px);} to{opacity:1;transform:translateY(0);} }
        @keyframes spin { to{transform:rotate(360deg);} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-8px) scale(0.97);} to{opacity:1;transform:translateY(0) scale(1);} }

        .dash-root { display:flex; height:100vh; overflow:hidden; }
        .sidebar { width:260px; min-width:260px; height:100vh; background:${sidebarBg}; backdrop-filter:blur(12px); border-right:1px solid ${bdr}; display:flex; flex-direction:column; padding:24px 20px; transition:width 0.3s; z-index:20; }
        .sidebar.collapsed { width:72px; min-width:72px; }
        .sidebar.collapsed .sl { display:none; }
        .sidebar-logo { display:flex; align-items:center; gap:12px; margin-bottom:40px; padding:0 4px; }
        .brand-text h1 { font-size:1.15rem; font-weight:900; letter-spacing:-0.04em; line-height:1; color:${text1}; margin:0; }
        .brand-text p { font-size:10px; font-weight:800; color:#00AA00; text-transform:uppercase; letter-spacing:0.12em; margin-top:2px; }
        .nav-link { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:9999px; border:none; background:none; width:100%; text-align:left; font-size:13px; font-weight:700; color:${text2}; transition:all 0.2s; cursor:pointer; font-family:'Inter',sans-serif; }
        .nav-link:hover { background:rgba(0,200,0,0.08); color:${text1}; }
        .nav-link.active { background:#00FF00; color:#0f172a; box-shadow:0 6px 20px rgba(0,255,0,0.3); }
        .nav-link.active .ms { color:#0f172a; }
        .nav-link.danger { color:#f87171; }
        .nav-link.danger:hover { background:rgba(248,113,113,0.1); }
        .dash-main { flex:1; display:flex; flex-direction:column; height:100vh; overflow:hidden; }
        .dash-header { height:72px; background:${headerBg}; backdrop-filter:blur(12px); border-bottom:1px solid ${bdr}; padding:0 32px; display:flex; align-items:center; justify-content:space-between; z-index:10; flex-shrink:0; }
        .dash-scroll { flex:1; overflow-y:auto; padding:32px; display:flex; flex-direction:column; gap:40px; }
        .stat-pill { background:${card}; border:1px solid ${bdr}; border-radius:14px; padding:16px 20px; display:flex; flex-direction:column; gap:4px; align-items:center; transition:box-shadow 0.2s; }
        .stat-pill:hover { box-shadow: ${isDark ? "0 8px 32px rgba(0,255,0,0.12)" : "0 8px 28px rgba(0,200,0,0.12)"}; }
        input:focus, select:focus { border-color:rgba(0,255,0,0.5)!important; box-shadow:0 0 0 3px rgba(0,255,0,0.12)!important; }

        @media (max-width:768px) {
          .sidebar { display:none !important; }
          .dash-header { display:none !important; }
          .dash-scroll { padding:24px 16px calc(140px + env(safe-area-inset-bottom, 0px)); }
          .mob-nav { display:flex !important; }
        }

        .mob-nav {
          display:none; position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
          z-index:300; background:${isDark ? "rgba(14,20,36,0.95)" : "rgba(255,255,255,0.92)"};
          backdrop-filter:blur(28px); -webkit-backdrop-filter:blur(28px);
          border:1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)"}; border-radius:9999px;
          padding:8px 24px; align-items:center; gap:6px; box-shadow:0 12px 48px rgba(0,0,0,0.22), 0 2px 10px rgba(0,0,0,0.12);
          min-width:340px;
        }
        .mob-tab {
          width:54px; height:54px; border-radius:9999px; display:flex; align-items:center; justify-content:center;
          background:none; border:none; cursor:pointer; font-family:'Inter',sans-serif;
          -webkit-tap-highlight-color:transparent; transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background 0.18s;
          flex-shrink:0;
        }
        .mob-tab:active { transform:scale(0.80); }
        .mob-tab .ms {
          font-size:22px; color:${isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.32)"}; transition:color 0.18s;
        }
        .mob-tab.active { background:#00FF00; box-shadow:0 4px 22px rgba(0,255,0,0.55); transform:scale(1.12); }
        .mob-tab.active .ms { color:#0a1a0a; }
        .mob-tab.danger .ms { color:#f87171; }
      `}</style>

      <div className="dash-root">
        {/* ── Sidebar ── now matches dashboard exactly ── */}
        <aside className={`sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div className="sidebar-logo">
            <div style={{
              width: "40px", height: "40px", background: "#00FF00", borderRadius: "10px",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, boxShadow: "0 0 16px rgba(0,255,0,0.35)"
            }}>
              <span className="ms" style={{ color: "#0f172a", fontSize: "22px" }}>school</span>
            </div>
            <div className="brand-text sl">
              <h1>StudyBuddy</h1>
              <p>ENGINEERING AI</p>
            </div>
          </div>

          <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            {navItems.slice(0, 4).map(({ id, icon, label }) => (
              <button
                key={id}
                className={`nav-link${activePage === id ? " active" : ""}`}
                onClick={() => router.push(`/${id}`)}
              >
                <span className="ms" style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}

            <div className="sl" style={{
              padding: "16px 4px 8px",
              fontSize: "10px", fontWeight: 800, color: text3,
              textTransform: "uppercase", letterSpacing: "0.12em"
            }}>
              ACCOUNT
            </div>

            {navItems.slice(4).map(({ id, icon, label }) => (
              <button
                key={id}
                className={`nav-link${activePage === id ? " active" : ""}`}
                onClick={() => router.push(`/${id}`)}
              >
                <span className="ms" style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}

            <button
              className="nav-link danger"
              onClick={() => logoutAndClearCache(auth).then(() => router.replace("/"))}
            >
              <span className="ms" style={{ fontSize: "20px", flexShrink: 0 }}>logout</span>
              <span className="sl">Sign Out</span>
            </button>
          </nav>
        </aside>

        {/* ── Main content (rest remains the same) ── */}
        <main className="dash-main">
          <header className="dash-header">
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
              <button
                onClick={() => setSidebarOpen(s => !s)}
                style={{
                  background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)",
                  border: "none", borderRadius: "9999px", width: "36px", height: "36px",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
                }}
              >
                <span className="ms" style={{ fontSize: "20px", color: text2 }}>menu</span>
              </button>
              <h1 style={{ fontSize: "1.4rem", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.02em" }}>
                Profile
              </h1>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />

              <div style={{ position: "relative" }}>
                <button
                  ref={notifBtn}
                  onClick={() => setShowNotifs(s => !s)}
                  style={{
                    width: "40px", height: "40px", borderRadius: "9999px",
                    background: showNotifs ? (isDark ? "rgba(0,255,0,0.12)" : "rgba(0,200,0,0.1)") : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,200,0,0.08)"),
                    border: showNotifs ? "1px solid rgba(0,255,0,0.3)" : "1px solid transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", position: "relative", transition: "all 0.2s"
                  }}
                >
                  <span className="ms" style={{ fontSize: "22px", color: showNotifs ? "#00AA00" : text2 }}>notifications</span>
                  <span style={{
                    position: "absolute", top: "9px", right: "9px", width: "8px", height: "8px",
                    background: "#00FF00", borderRadius: "9999px", border: `2px solid ${bg}`,
                    boxShadow: "0 0 6px rgba(0,255,0,0.7)"
                  }} />
                </button>

                {showNotifs && (
                  <div
                    ref={notifRef}
                    style={{
                      position: "absolute", top: "calc(100% + 12px)", right: 0, width: "280px",
                      background: isDark ? "rgba(8,14,26,0.98)" : "rgba(255,255,255,0.98)",
                      border: `1px solid ${bdr}`, borderRadius: "18px",
                      boxShadow: "0 24px 60px rgba(0,0,0,0.25)", backdropFilter: "blur(20px)",
                      zIndex: 500, animation: "slideDown 0.22s cubic-bezier(0.34,1.56,0.64,1)",
                      padding: "18px"
                    }}
                  >
                    <p style={{ fontSize: "13px", fontWeight: 900, color: text1, margin: "0 0 8px" }}>Notifications</p>
                    <p style={{ fontSize: "12px", color: text2, margin: "0 0 14px", lineHeight: 1.5 }}>No new notifications</p>
                    <button
                      onClick={() => setShowNotifs(false)}
                      style={{
                        width: "100%", padding: "9px", background: "rgba(0,200,0,0.1)",
                        border: "1px solid rgba(0,200,0,0.25)", borderRadius: "10px",
                        fontSize: "12px", fontWeight: 800, color: "#009900", cursor: "pointer"
                      }}
                    >
                      GOT IT
                    </button>
                  </div>
                )}
              </div>

              <div style={{ width: "1px", height: "32px", background: bdr }} />

              <div style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "12px", fontWeight: 800, color: text1, margin: 0 }}>{fullName || "—"}</p>
                  <p style={{ fontSize: "10px", color: text3, marginTop: "2px" }}>{branchVal} · TCET</p>
                </div>
                <div style={{
                  width: "40px", height: "40px", borderRadius: "9999px", border: "2.5px solid #00FF00",
                  overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"
                }}>
                  {photoURL ? (
                    <img src={photoURL} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                  ) : (
                    <div style={{
                      width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                      background: "#00FF00", color: "#0f172a", fontSize: "18px", fontWeight: 900
                    }}>
                      {firstName ? firstName[0].toUpperCase() : "?"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          <div className="dash-scroll">
            <div style={{ maxWidth: "720px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "32px" }}>
              {/* Profile Hero */}
              <div style={{
                background: card, borderRadius: "24px", border: `1px solid ${bdr}`, padding: "32px",
                display: "flex", alignItems: "flex-start", gap: "24px", flexWrap: "wrap"
              }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{
                    width: "88px", height: "88px", borderRadius: "9999px", border: "3px solid #00FF00",
                    overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0",
                    boxShadow: "0 0 24px rgba(0,255,0,0.3)"
                  }}>
                    {photoURL ? (
                      <img src={photoURL} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                    ) : (
                      <div style={{
                        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                        background: "#00FF00", color: "#0f172a", fontSize: "36px", fontWeight: 900
                      }}>
                        {firstName ? firstName[0].toUpperCase() : "?"}
                      </div>
                    )}
                  </div>
                  <div style={{
                    position: "absolute", bottom: "2px", right: "2px", width: "22px", height: "22px",
                    borderRadius: "9999px", background: "#00FF00",
                    border: `3px solid ${isDark ? "#080f1a" : "#f5f8f5"}`,
                    boxShadow: "0 0 8px rgba(0,255,0,0.6)"
                  }} />
                </div>

                <div style={{ flex: 1, minWidth: "220px" }}>
                  <h2 style={{ fontSize: "22px", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 4px" }}>
                    {fullName || "—"}
                  </h2>
                  <p style={{ fontSize: "13px", color: text2, margin: "0 0 12px" }}>{email}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    <span style={{ padding: "4px 12px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.25)", borderRadius: "9999px", fontSize: "11px", fontWeight: 800, color: "#009900" }}>
                      {branchVal}
                    </span>
                    <span style={{ padding: "4px 12px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: `1px solid ${bdr}`, borderRadius: "9999px", fontSize: "11px", fontWeight: 700, color: text2 }}>
                      TCET
                    </span>
                    <span style={{ padding: "4px 12px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: `1px solid ${bdr}`, borderRadius: "9999px", fontSize: "11px", fontWeight: 700, color: text2 }}>
                      Joined {joined}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setEditing(e => !e)}
                  style={{
                    padding: "10px 20px",
                    background: editing ? "rgba(0,200,0,0.12)" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"),
                    border: `1px solid ${editing ? "rgba(0,200,0,0.45)" : bdr}`,
                    borderRadius: "12px",
                    fontSize: "13px", fontWeight: 800, color: editing ? "#00AA00" : text2,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                    flexShrink: 0, transition: "all 0.2s"
                  }}
                >
                  <span className="ms" style={{ fontSize: "18px" }}>{editing ? "close" : "edit"}</span>
                  {editing ? "Cancel" : "Edit Profile"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "16px" }}>
                {stats.map(({ label, value, icon }) => (
                  <div key={label} className="stat-pill">
                    <span className="ms" style={{ fontSize: "24px", color: "#009900" }}>{icon}</span>
                    <p style={{ fontSize: "24px", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.02em" }}>
                      {value}
                    </p>
                    <p style={{ fontSize: "10px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              {editing && (
                <div style={{
                  background: card, borderRadius: "20px", border: `1px solid ${bdr}`, padding: "32px 28px",
                  boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.25)" : "0 4px 20px rgba(0,0,0,0.08)"
                }}>
                  <h3 style={{ fontSize: "18px", fontWeight: 900, color: text1, margin: "0 0 24px", letterSpacing: "-0.02em" }}>
                    Edit Profile Information
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    <div>
                      <label style={{ fontSize: "12px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "8px" }}>
                        First Name
                      </label>
                      <input
                        style={inputStyle}
                        value={form.firstName}
                        onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))}
                        placeholder="e.g. Soham"
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: "12px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "8px" }}>
                        Full Name
                      </label>
                      <input
                        style={inputStyle}
                        value={form.fullName}
                        onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
                        placeholder="e.g. Soham Sharma"
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: "12px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "8px" }}>
                        Branch
                      </label>
                      <select
                        style={{
                          ...inputStyle,
                          appearance: "none",
                          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='${encodeURIComponent(text2)}' viewBox='0 0 24 24'><path d='M7 10l5 5 5-5z'/></svg>")`,
                          backgroundRepeat: "no-repeat",
                          backgroundPosition: "right 16px center"
                        }}
                        value={form.branch}
                        onChange={e => setForm(p => ({ ...p, branch: e.target.value }))}
                      >
                        <option value="">Select your branch</option>
                        {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>

                    <button
                      onClick={save}
                      disabled={saving}
                      style={{
                        marginTop: "12px", height: "52px", background: "#00FF00", color: "#0f172a",
                        border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 900,
                        cursor: saving ? "not-allowed" : "pointer",
                        boxShadow: "0 8px 28px rgba(0,255,0,0.4)",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                        transition: "all 0.2s"
                      }}
                    >
                      {saving && (
                        <div style={{
                          width: "20px", height: "20px", border: "3px solid rgba(0,0,0,0.2)",
                          borderTopColor: "#0f172a", borderRadius: "50%",
                          animation: "spin 0.8s linear infinite"
                        }} />
                      )}
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={() => logoutAndClearCache(auth).then(() => router.replace("/"))}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                  padding: "16px 24px", background: "rgba(248,113,113,0.08)",
                  border: "1px solid rgba(248,113,113,0.25)", borderRadius: "14px",
                  cursor: "pointer", color: "#f87171", fontSize: "14px", fontWeight: 800,
                  width: "100%", transition: "background 0.2s"
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(248,113,113,0.16)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(248,113,113,0.08)"}
              >
                <span className="ms" style={{ fontSize: "22px" }}>logout</span>
                Sign Out
              </button>
            </div>
          </div>
        </main>
      </div>

      <nav className="mob-nav">
        {navItems.slice(0, 4).map(({ id, icon }) => (
          <button
            key={id}
            className={`mob-tab${activePage === id ? " active" : ""}`}
            onClick={() => router.push(`/${id}`)}
          >
            <span className="ms">{icon}</span>
          </button>
        ))}
        <button
          className={`mob-tab${activePage === "profile" ? " active" : ""}`}
          onClick={() => router.push("/profile")}
        >
          <span className="ms">person</span>
        </button>
        <button
          className="mob-tab danger"
          onClick={() => logoutAndClearCache(auth).then(() => router.replace("/"))}
          title="Sign Out"
          aria-label="Sign Out"
        >
          <span className="ms">logout</span>
        </button>
      </nav>
    </>
  );
}