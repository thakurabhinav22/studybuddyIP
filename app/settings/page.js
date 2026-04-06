"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
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

// ── Theme Switcher (same as Profile) ──
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

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: "44px", height: "24px", borderRadius: "9999px", background: on ? "#00FF00" : "rgba(100,116,139,0.3)", border: "none", cursor: "pointer", position: "relative", transition: "background 0.22s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: "3px", left: on ? "23px" : "3px", width: "18px", height: "18px", borderRadius: "9999px", background: "#ffffff", boxShadow: "0 2px 6px rgba(0,0,0,0.25)", transition: "left 0.22s cubic-bezier(0.34,1.56,0.64,1)" }} />
    </button>
  );
}

function Section({ title, children, isDark }) {
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const card = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  return (
    <div style={{ background: card, borderRadius: "20px", border: `1px solid ${bdr}`, overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${bdr}` }}>
        <p style={{ fontSize: "12px", fontWeight: 900, color: "#009900", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>{title}</p>
      </div>
      {children}
    </div>
  );
}

function Row({ label, sub, right, isDark, last }) {
  const bdr = isDark ? "rgba(0,255,0,0.06)" : "rgba(0,0,0,0.05)";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#64748b" : "#94a3b8";
  return (
    <div style={{ padding: "16px 22px", borderBottom: last ? "none" : `1px solid ${bdr}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
      <div>
        <p style={{ fontSize: "14px", fontWeight: 700, color: text1, margin: 0 }}>{label}</p>
        {sub && <p style={{ fontSize: "11px", color: text2, margin: "2px 0 0", fontWeight: 500 }}>{sub}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePage] = useState("settings");
  const [showNotifs, setShowNotifs] = useState(false);

  const [notifs, setNotifs] = useState({ reminders: true, streaks: true, newNotes: false, aiSummary: true });
  const [prefs, setPrefs] = useState({ compactMode: false, animations: true, soundFx: false });

  const notifRef = useRef(null);
  const notifBtn = useRef(null);

  // Colors - same as Profile
  const bg = isDark ? "#080f1a" : "#f5f8f5";
  const sidebarBg = isDark ? "rgba(8,15,26,0.96)" : "rgba(255,255,255,0.75)";
  const headerBg = isDark ? "rgba(8,15,26,0.92)" : "rgba(255,255,255,0.75)";
  const card = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";

  const navItems = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard" },
    { id: "notes", icon: "description", label: "Notes" },
    { id: "test", icon: "quiz", label: "Test" },
    { id: "ai", icon: "psychology", label: "Neural AI" },
    { id: "profile", icon: "person", label: "Profile" },
    { id: "settings", icon: "settings", label: "Settings" },
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

        @media (max-width:768px) {
          .sidebar { display:none !important; }
          .dash-header { display:none !important; }
          .dash-scroll { padding:24px 16px 100px; }
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
        {/* ── Sidebar (exactly same as Profile) ── */}
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

        {/* ── Main ── */}
        <main className="dash-main">
          {/* Header - exactly same as Profile */}
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
                Settings
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
                    background: "#00FF00", borderRadius: "9999px",
                    border: `2px solid ${bg}`,
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
                  <p style={{ fontSize: "12px", fontWeight: 800, color: text1, margin: 0 }}>Soham</p>
                  <p style={{ fontSize: "10px", color: text3, marginTop: "2px" }}>TCET Student</p>
                </div>
                <div style={{
                  width: "40px", height: "40px", borderRadius: "9999px", border: "2.5px solid #00FF00",
                  overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"
                }}>
                  <div style={{
                    width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#00FF00", color: "#0f172a", fontSize: "18px", fontWeight: 900
                  }}>
                    S
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Content - your original content */}
          <div className="dash-scroll">
            <div style={{ maxWidth: "620px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px", animation: "fadeUp 0.4s ease both" }}>
              <div>
                <h2 style={{ fontSize: "clamp(1.4rem,3vw,1.8rem)", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 6px" }}>
                  Settings
                </h2>
                <p style={{ fontSize: "14px", color: text2, margin: 0 }}>
                  Manage your preferences and account settings
                </p>
              </div>

              {/* Appearance */}
              <Section title="Appearance" isDark={isDark}>
                <div style={{ padding: "20px 22px" }}>
                  <p style={{ fontSize: "12px", fontWeight: 700, color: text2, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Theme
                  </p>
                  <div style={{ display: "flex", gap: "10px" }}>
                    {[
                      { value: "light", icon: "light_mode", label: "Light" },
                      { value: "dark", icon: "dark_mode", label: "Dark" },
                      { value: "system", icon: "desktop_windows", label: "System" },
                    ].map(({ value, icon, label }) => {
                      const active = theme === value;
                      return (
                        <button
                          key={value}
                          onClick={() => setTheme(value)}
                          style={{
                            flex: 1, padding: "12px 8px", borderRadius: "14px",
                            border: `1.5px solid ${active ? "rgba(0,255,0,0.6)" : bdr}`,
                            background: active ? "rgba(0,255,0,0.1)" : "transparent",
                            cursor: "pointer", display: "flex", flexDirection: "column",
                            alignItems: "center", gap: "6px", transition: "all 0.2s"
                          }}
                        >
                          <span className="ms" style={{ fontSize: "22px", color: active ? "#00AA00" : text2 }}>
                            {icon}
                          </span>
                          <span style={{ fontSize: "11px", fontWeight: 800, color: active ? "#009900" : text2, fontFamily: "'Inter',sans-serif" }}>
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Row
                  isDark={isDark}
                  label="Compact Mode"
                  sub="Reduce spacing and padding"
                  right={<Toggle on={prefs.compactMode} onChange={v => setPrefs(p => ({ ...p, compactMode: v }))} />}
                />
                <Row
                  isDark={isDark}
                  label="Animations"
                  sub="Enable UI transitions and effects"
                  right={<Toggle on={prefs.animations} onChange={v => setPrefs(p => ({ ...p, animations: v }))} />}
                />
                <Row
                  isDark={isDark}
                  label="Sound Effects"
                  sub="Play sounds for actions and alerts"
                  right={<Toggle on={prefs.soundFx} onChange={v => setPrefs(p => ({ ...p, soundFx: v }))} />}
                  last
                />
              </Section>

              {/* Notifications */}
              <Section title="Notifications" isDark={isDark}>
                <Row
                  isDark={isDark}
                  label="Study Reminders"
                  sub="Daily nudge to keep your streak"
                  right={<Toggle on={notifs.reminders} onChange={v => setNotifs(p => ({ ...p, reminders: v }))} />}
                />
                <Row
                  isDark={isDark}
                  label="Streak Alerts"
                  sub="Be notified if your streak is at risk"
                  right={<Toggle on={notifs.streaks} onChange={v => setNotifs(p => ({ ...p, streaks: v }))} />}
                />
                <Row
                  isDark={isDark}
                  label="New Notes"
                  sub="When peers share notes with you"
                  right={<Toggle on={notifs.newNotes} onChange={v => setNotifs(p => ({ ...p, newNotes: v }))} />}
                />
                <Row
                  isDark={isDark}
                  label="AI Summaries"
                  sub="After each Neural AI session"
                  right={<Toggle on={notifs.aiSummary} onChange={v => setNotifs(p => ({ ...p, aiSummary: v }))} />}
                  last
                />
              </Section>

              {/* Account */}
              <Section title="Account" isDark={isDark}>
                <Row
                  isDark={isDark}
                  label="Change Password"
                  sub="Update your login password"
                  right={<span className="ms" style={{ fontSize: "18px", color: text2 }}>chevron_right</span>}
                />
                <Row
                  isDark={isDark}
                  label="Linked Accounts"
                  sub="Google, GitHub connections"
                  right={<span className="ms" style={{ fontSize: "18px", color: text2 }}>chevron_right</span>}
                />
                <Row
                  isDark={isDark}
                  label="Export My Data"
                  sub="Download all your notes & history"
                  right={<span className="ms" style={{ fontSize: "18px", color: text2 }}>chevron_right</span>}
                />
                <Row
                  isDark={isDark}
                  label="Delete Account"
                  sub="Permanently remove your account"
                  right={<span className="ms" style={{ fontSize: "18px", color: "#f87171" }}>chevron_right</span>}
                  last
                />
              </Section>

              {/* App info */}
              <div style={{ textAlign: "center", padding: "8px 0 20px" }}>
                <p style={{ fontSize: "11px", color: text2, fontWeight: 700, margin: "0 0 2px" }}>
                  StudyBuddy · Engineering AI
                </p>
                <p style={{ fontSize: "10px", color: isDark ? "#334155" : "#cbd5e1", margin: 0 }}>
                  Version 1.0.0 · Built with ❤️ for TCET
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Mobile bottom nav - same as Profile */}
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