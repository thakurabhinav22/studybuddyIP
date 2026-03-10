"use client";
import { useState, useEffect } from "react";

function useResolvedTheme() {
  const [resolved, setResolved] = useState("light");
  useEffect(() => {
    const stored = localStorage.getItem("studybuddy_theme") || "system";
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(stored === "system" ? (mq.matches ? "dark" : "light") : stored);
    update(); mq.addEventListener("change", update); return () => mq.removeEventListener("change", update);
  }, []);
  return resolved;
}

const QUIZ_CATEGORIES = [
  { icon: "code",            label: "Data Structures",    count: 24, color: "#3b82f6" },
  { icon: "wifi",            label: "Computer Networks",  count: 18, color: "#8b5cf6" },
  { icon: "memory",          label: "Digital Electronics",count: 12, color: "#f59e0b" },
  { icon: "database",        label: "DBMS",               count: 20, color: "#ef4444" },
  { icon: "calculate",       label: "Engineering Maths",  count: 15, color: "#10b981" },
  { icon: "developer_board", label: "OS Concepts",        count: 16, color: "#f97316" },
];

export default function TestPage() {
  const resolved = useResolvedTheme();
  const isDark   = resolved === "dark";

  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr   = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const card  = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;display:inline-block;white-space:nowrap;}
        .quiz-card{background:${card};border-radius:18px;border:1px solid ${bdr};padding:22px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:16px;}
        .quiz-card:hover{transform:translateY(-3px);box-shadow:${isDark ? "0 12px 32px rgba(0,0,0,0.4)" : "0 12px 32px rgba(0,0,0,0.1)"};}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "36px", animation: "fadeUp 0.4s ease both" }}>

        <div>
          <h2 style={{ fontSize: "clamp(1.4rem,3vw,1.8rem)", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 6px" }}>Tests &amp; Quizzes</h2>
          <p style={{ fontSize: "14px", color: text2, margin: 0 }}>Practice with subject-wise quizzes and mock tests</p>
        </div>

        {/* Quick stats strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px" }}>
          {[
            { label: "Quizzes Done", value: "0", icon: "task_alt" },
            { label: "Best Score",   value: "—",  icon: "emoji_events" },
            { label: "Avg Score",    value: "—",  icon: "bar_chart" },
          ].map(({ label, value, icon }) => (
            <div key={label} style={{ background: card, borderRadius: "16px", border: `1px solid ${bdr}`, padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(0,200,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span className="ms" style={{ fontSize: "20px", color: "#009900" }}>{icon}</span>
              </div>
              <div>
                <p style={{ fontSize: "10px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>{label}</p>
                <p style={{ fontSize: "20px", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.03em" }}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Categories */}
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: 800, color: text1, margin: "0 0 16px", letterSpacing: "-0.02em" }}>Choose a Subject</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "12px" }}>
            {QUIZ_CATEGORIES.map(({ icon, label, count, color }) => (
              <div key={label} className="quiz-card">
                <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: `${color}18`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span className="ms" style={{ fontSize: "24px", color }}>{icon}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: "14px", fontWeight: 800, color: text1, margin: "0 0 3px" }}>{label}</p>
                  <p style={{ fontSize: "11px", color: text2, margin: 0 }}>{count} questions</p>
                </div>
                <span className="ms" style={{ fontSize: "20px", color: text3 }}>chevron_right</span>
              </div>
            ))}
          </div>
        </div>

        {/* Coming soon banner */}
        <div style={{ background: "rgba(0,200,0,0.06)", border: "1px solid rgba(0,200,0,0.2)", borderRadius: "16px", padding: "20px 24px", display: "flex", alignItems: "center", gap: "14px" }}>
          <span className="ms" style={{ fontSize: "28px", color: "#00AA00" }}>rocket_launch</span>
          <div>
            <p style={{ fontSize: "14px", fontWeight: 800, color: text1, margin: "0 0 3px" }}>Mock Tests Coming Soon</p>
            <p style={{ fontSize: "12px", color: text2, margin: 0 }}>Full-length semester mock papers with timer and detailed analysis.</p>
          </div>
        </div>

      </div>
    </>
  );
}