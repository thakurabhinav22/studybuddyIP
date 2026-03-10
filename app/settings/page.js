"use client";
import { useState, useEffect } from "react";

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

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: "44px", height: "24px", borderRadius: "9999px", background: on ? "#00FF00" : "rgba(100,116,139,0.3)", border: "none", cursor: "pointer", position: "relative", transition: "background 0.22s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: "3px", left: on ? "23px" : "3px", width: "18px", height: "18px", borderRadius: "9999px", background: "#ffffff", boxShadow: "0 2px 6px rgba(0,0,0,0.25)", transition: "left 0.22s cubic-bezier(0.34,1.56,0.64,1)" }} />
    </button>
  );
}

function Section({ title, children, isDark }) {
  const bdr  = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const card = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const text1= isDark ? "#f1f5f9" : "#0f172a";
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
  const bdr  = isDark ? "rgba(0,255,0,0.06)" : "rgba(0,0,0,0.05)";
  const text1= isDark ? "#f1f5f9" : "#0f172a";
  const text2= isDark ? "#64748b" : "#94a3b8";
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
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [notifs, setNotifs] = useState({ reminders: true, streaks: true, newNotes: false, aiSummary: true });
  const [prefs,  setPrefs]  = useState({ compactMode: false, animations: true, soundFx: false });

  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const bdr   = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";

  const themeOpts = [
    { value: "light",  icon: "light_mode",     label: "Light"  },
    { value: "dark",   icon: "dark_mode",       label: "Dark"   },
    { value: "system", icon: "desktop_windows", label: "System" },
  ];

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;display:inline-block;white-space:nowrap;}
        @keyframes spin{to{transform:rotate(360deg);}}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px", animation: "fadeUp 0.4s ease both", maxWidth: "620px" }}>

        <div>
          <h2 style={{ fontSize: "clamp(1.4rem,3vw,1.8rem)", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 6px" }}>Settings</h2>
          <p style={{ fontSize: "14px", color: text2, margin: 0 }}>Manage your preferences and account settings</p>
        </div>

        {/* Appearance */}
        <Section title="Appearance" isDark={isDark}>
          <div style={{ padding: "20px 22px" }}>
            <p style={{ fontSize: "12px", fontWeight: 700, color: text2, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Theme</p>
            <div style={{ display: "flex", gap: "10px" }}>
              {themeOpts.map(({ value, icon, label }) => {
                const active = theme === value;
                return (
                  <button key={value} onClick={() => setTheme(value)}
                    style={{ flex: 1, padding: "12px 8px", borderRadius: "14px", border: `1.5px solid ${active ? "rgba(0,255,0,0.6)" : bdr}`, background: active ? "rgba(0,255,0,0.1)" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", transition: "all 0.2s" }}>
                    <span className="ms" style={{ fontSize: "22px", color: active ? "#00AA00" : text2 }}>{icon}</span>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: active ? "#009900" : text2, fontFamily: "'Inter',sans-serif" }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Row isDark={isDark} label="Compact Mode"    sub="Reduce spacing and padding"          right={<Toggle on={prefs.compactMode} onChange={v => setPrefs(p => ({...p, compactMode: v}))} />} />
          <Row isDark={isDark} label="Animations"      sub="Enable UI transitions and effects"   right={<Toggle on={prefs.animations}  onChange={v => setPrefs(p => ({...p, animations: v}))}  />} />
          <Row isDark={isDark} label="Sound Effects"   sub="Play sounds for actions and alerts"  right={<Toggle on={prefs.soundFx}     onChange={v => setPrefs(p => ({...p, soundFx: v}))}     />} last />
        </Section>

        {/* Notifications */}
        <Section title="Notifications" isDark={isDark}>
          <Row isDark={isDark} label="Study Reminders"  sub="Daily nudge to keep your streak"       right={<Toggle on={notifs.reminders}  onChange={v => setNotifs(p => ({...p, reminders: v}))}  />} />
          <Row isDark={isDark} label="Streak Alerts"    sub="Be notified if your streak is at risk" right={<Toggle on={notifs.streaks}    onChange={v => setNotifs(p => ({...p, streaks: v}))}    />} />
          <Row isDark={isDark} label="New Notes"        sub="When peers share notes with you"        right={<Toggle on={notifs.newNotes}   onChange={v => setNotifs(p => ({...p, newNotes: v}))}   />} />
          <Row isDark={isDark} label="AI Summaries"     sub="After each Neural AI session"           right={<Toggle on={notifs.aiSummary}  onChange={v => setNotifs(p => ({...p, aiSummary: v}))}  />} last />
        </Section>

        {/* Account */}
        <Section title="Account" isDark={isDark}>
          <Row isDark={isDark} label="Change Password"   sub="Update your login password"        right={<span className="ms" style={{ fontSize: "18px", color: text2 }}>chevron_right</span>} />
          <Row isDark={isDark} label="Linked Accounts"   sub="Google, GitHub connections"         right={<span className="ms" style={{ fontSize: "18px", color: text2 }}>chevron_right</span>} />
          <Row isDark={isDark} label="Export My Data"    sub="Download all your notes & history"  right={<span className="ms" style={{ fontSize: "18px", color: text2 }}>chevron_right</span>} />
          <Row isDark={isDark} label="Delete Account"    sub="Permanently remove your account"    right={<span className="ms" style={{ fontSize: "18px", color: "#f87171" }}>chevron_right</span>} last />
        </Section>

        {/* App info */}
        <div style={{ textAlign: "center", padding: "8px 0 20px" }}>
          <p style={{ fontSize: "11px", color: text2, fontWeight: 700, margin: "0 0 2px" }}>StudyBuddy · Engineering AI</p>
          <p style={{ fontSize: "10px", color: isDark ? "#334155" : "#cbd5e1", margin: 0 }}>Version 1.0.0 · Built with ❤️ for TCET</p>
        </div>

      </div>
    </>
  );
}