"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue } from "firebase/database";


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

export default function TestPage() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePage] = useState("test");
  const [showNotifs, setShowNotifs] = useState(false);
  const [userBranch, setUserBranch] = useState(null);
  const [userSem, setUserSem] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  const notifRef = useRef(null);
  const notifBtn = useRef(null);

  // Colors (consistent with dashboard & profile)
  const bg = isDark ? "#080f1a" : "#f5f8f5";
  const sidebarBg = isDark ? "rgba(8,15,26,0.96)" : "rgba(255,255,255,0.75)";
  const headerBg = isDark ? "rgba(8,15,26,0.92)" : "rgba(255,255,255,0.75)";
  const card = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
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

  // Fetch user branch/semester + subjects from Firebase
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      const userRef = ref(db, `users/${user.uid}`);  // ✅ declared BEFORE onValue
      onValue(userRef, (snap) => {
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
            const subjectsRef = ref(db, `notes/${branch}/Sem:${sem}/subjects`);
            onValue(subjectsRef, (subSnap) => {
              if (subSnap.exists()) {
                const subsList = Object.keys(subSnap.val() || {}).map((subjectName) => ({
                  icon: "quiz",
                  label: subjectName,
                  count: 0,
                  color: "#00AA00"
                }));
                setSubjects(subsList);
              } else {
                setSubjects([]);
              }
              setLoadingSubjects(false);
            });
          } else {
            setLoadingSubjects(false);
          }

        } else {
          setLoadingSubjects(false);
        }
      });
    });

    return () => unsub();
  }, [router]);

  // Fallback to your original static list if no dynamic subjects
  const displayCategories = subjects.length > 0 ? subjects : [
    { icon: "code", label: "Data Structures", count: 24, color: "#3b82f6" },
    { icon: "wifi", label: "Computer Networks", count: 18, color: "#8b5cf6" },
    { icon: "memory", label: "Digital Electronics", count: 12, color: "#f59e0b" },
    { icon: "database", label: "DBMS", count: 20, color: "#ef4444" },
    { icon: "calculate", label: "Engineering Maths", count: 15, color: "#10b981" },
    { icon: "developer_board", label: "OS Concepts", count: 16, color: "#f97316" },
  ];

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

        .quiz-card { background:${card}; border-radius:18px; border:1px solid ${bdr}; padding:22px; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; gap:16px; }
        .quiz-card:hover { transform:translateY(-3px); box-shadow:${isDark ? "0 12px 32px rgba(0,0,0,0.4)" : "0 12px 32px rgba(0,0,0,0.1)"}; }

        @media (max-width:768px) {
          .sidebar { display:none !important; }
          .dash-header { display:none !important; }
          .dash-scroll { padding:24px 16px 100px; }
          .mob-nav { display:flex !important; }
        }

        .mob-nav {
          display:none; position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
          z-index:300; background:${isDark ? "rgba(14,20,36,0.95)" : "rgba(255,255,255,0.92)"};
          backdrop-filter:blur(28px); border:1px solid ${bdr}; border-radius:9999px;
          padding:8px 24px; align-items:center; gap:6px; box-shadow:0 12px 48px rgba(0,0,0,0.25);
        }
        .mob-tab {
          width:54px; height:54px; border-radius:9999px; display:flex; align-items:center; justify-content:center;
          background:none; border:none; cursor:pointer; transition:transform 0.22s, background 0.18s;
        }
        .mob-tab:active { transform:scale(0.82); }
        .mob-tab.active { background:#00FF00; box-shadow:0 4px 22px rgba(0,255,0,0.55); transform:scale(1.12); }
        .mob-tab.active .ms { color:#0a1a0a; }
      `}</style>

      <div className="dash-root">
        {/* ── Sidebar ── */}
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
              onClick={() => signOut(auth).then(() => router.replace("/"))}
            >
              <span className="ms" style={{ fontSize: "20px", flexShrink: 0 }}>logout</span>
              <span className="sl">Sign Out</span>
            </button>
          </nav>
        </aside>

        <main className="dash-main">
          {/* Header */}
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
                Tests & Quizzes
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
                  <p style={{ fontSize: "12px", fontWeight: 800, color: text1, margin: 0 }}>
                    {userName || "User"}
                  </p>
                  <p style={{ fontSize: "10px", color: text3, marginTop: "2px" }}>
                    {userBranch || "—"} · Sem {userSem || "—"}
                  </p>
                </div>
                <div style={{
                  width: "40px", height: "40px", borderRadius: "9999px", border: "2.5px solid #00FF00",
                  overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"
                }}>
                  <div style={{
                    width: "40px", height: "40px", borderRadius: "9999px", border: "2.5px solid #00FF00",
                    overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0",
                    position: "relative"  // ✅ no extra inner wrapper
                  }}>
                    {userAvatar ? (
                      <img
                        src={userAvatar}
                        alt={userName || "User"}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.nextElementSibling.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <div style={{
                      width: "100%", height: "100%",
                      display: userAvatar ? "none" : "flex",  // ✅ shown only when no avatar
                      alignItems: "center", justifyContent: "center",
                      background: "#00FF00", color: "#0f172a", fontSize: "18px", fontWeight: 900
                    }}>
                      {(userName || "U")[0].toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Content */}
          <div className="dash-scroll">
            <div style={{ maxWidth: "720px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "36px", animation: "fadeUp 0.4s ease both" }}>
              <div>
                <h2 style={{ fontSize: "clamp(1.4rem,3vw,1.8rem)", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 6px" }}>
                  Tests & Quizzes
                </h2>
                <p style={{ fontSize: "14px", color: text2, margin: 0 }}>
                  Practice with subject-wise quizzes and mock tests
                </p>
              </div>

              {/* Quick stats strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px" }}>
                {[
                  { label: "Quizzes Done", value: "0", icon: "task_alt" },
                  { label: "Best Score", value: "—", icon: "emoji_events" },
                  { label: "Avg Score", value: "—", icon: "bar_chart" },
                ].map(({ label, value, icon }) => (
                  <div key={label} style={{
                    background: card, borderRadius: "16px", border: `1px solid ${bdr}`,
                    padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px"
                  }}>
                    <div style={{
                      width: "36px", height: "36px", borderRadius: "10px",
                      background: "rgba(0,200,0,0.1)", display: "flex", alignItems: "center",
                      justifyContent: "center", flexShrink: 0
                    }}>
                      <span className="ms" style={{ fontSize: "20px", color: "#009900" }}>{icon}</span>
                    </div>
                    <div>
                      <p style={{
                        fontSize: "10px", fontWeight: 700, color: text3,
                        textTransform: "uppercase", letterSpacing: "0.08em", margin: 0
                      }}>{label}</p>
                      <p style={{
                        fontSize: "20px", fontWeight: 900, color: text1,
                        margin: 0, letterSpacing: "-0.03em"
                      }}>{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Subjects / Categories */}
              <div>
                <h3 style={{
                  fontSize: "16px", fontWeight: 800, color: text1,
                  margin: "0 0 16px", letterSpacing: "-0.02em"
                }}>
                  Choose a Subject
                </h3>

                {loadingSubjects ? (
                  <div style={{ textAlign: "center", color: text2, padding: "60px 0", fontSize: "15px" }}>
                    Loading your semester subjects...
                  </div>
                ) : displayCategories.length === 0 ? (
                  <div style={{
                    background: card, borderRadius: "16px", padding: "40px 24px", textAlign: "center",
                    border: `1px solid ${bdr}`, boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.3)" : "0 4px 20px rgba(0,0,0,0.08)"
                  }}>
                    <span className="ms" style={{ fontSize: "48px", color: text3, display: "block", marginBottom: "16px" }}>
                      school
                    </span>
                    <p style={{ fontSize: "16px", fontWeight: 700, color: text1, margin: "0 0 8px" }}>
                      No subjects found for your semester
                    </p>
                    <p style={{ fontSize: "14px", color: text2, margin: 0 }}>
                      Please check your branch and semester settings in Profile, or contact support.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "12px" }}>
                    {displayCategories.map(({ icon, label, count, color }) => (
                      <div key={label} className="quiz-card">
                        <div style={{
                          width: "48px", height: "48px", borderRadius: "14px",
                          background: `${color || "#00AA00"}18`, border: `1px solid ${color || "#00AA00"}30`,
                          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                        }}>
                          <span className="ms" style={{ fontSize: "24px", color: color || "#00AA00" }}>
                            {icon}
                          </span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: "14px", fontWeight: 800, color: text1, margin: "0 0 3px" }}>
                            {label}
                          </p>
                          <p style={{ fontSize: "11px", color: text2, margin: 0 }}>
                            {count} questions
                          </p>
                        </div>
                        <span className="ms" style={{ fontSize: "20px", color: text3 }}>chevron_right</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Coming soon banner */}
              <div style={{
                background: "rgba(0,200,0,0.06)", border: "1px solid rgba(0,200,0,0.2)",
                borderRadius: "16px", padding: "20px 24px",
                display: "flex", alignItems: "center", gap: "14px"
              }}>
                <span className="ms" style={{ fontSize: "28px", color: "#00AA00" }}>rocket_launch</span>
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 800, color: text1, margin: "0 0 3px" }}>
                    Mock Tests Coming Soon
                  </p>
                  <p style={{ fontSize: "12px", color: text2, margin: 0 }}>
                    Full-length semester mock papers with timer and detailed analysis.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
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
      </nav>
    </>
  );
}