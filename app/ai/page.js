"use client";
import { useState, useEffect, useRef } from "react";

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

const SUGGESTIONS = [
  "Explain TCP/IP handshake in simple terms",
  "What is Big O notation? Give examples",
  "Difference between process and thread",
  "How does a relational database work?",
];

export default function Page() {
  const resolved = useResolvedTheme();
  const isDark   = resolved === "dark";
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "ai", text: "Hi! I'm Neural AI, your engineering study assistant. Ask me anything about your coursework — DSA, networks, databases, OS, and more. 🚀" }
  ]);
  const bottomRef = useRef(null);

  const text1   = isDark ? "#f1f5f9" : "#0f172a";
  const text2   = isDark ? "#94a3b8" : "#475569";
  const text3   = isDark ? "#475569" : "#94a3b8";
  const bdr     = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const inputBg = isDark ? "rgba(255,255,255,0.05)" : "#ffffff";
  const chatBg  = isDark ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.6)";

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    setMessages(p => [...p, { role: "user", text: input.trim() }, { role: "ai", text: "This feature is coming soon! Neural AI will answer your engineering questions in real time. Stay tuned 🧠" }]);
    setInput("");
  };

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;display:inline-block;white-space:nowrap;}
        .chat-input{background:${inputBg};border:1.5px solid ${bdr};border-radius:9999px;padding:13px 20px;font-size:14px;font-family:'Inter',sans-serif;color:${text1};outline:none;width:100%;transition:border-color 0.2s,box-shadow 0.2s;}
        .chat-input:focus{border-color:rgba(0,255,0,0.5);box-shadow:0 0 0 3px rgba(0,255,0,0.1);}
        .chat-input::placeholder{color:${text3};}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", animation: "fadeUp 0.4s ease both", height: "calc(100vh - 130px)", minHeight: "400px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexShrink: 0 }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "rgba(0,200,0,0.1)", border: `1px solid ${bdr}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span className="ms" style={{ fontSize: "26px", color: "#009900" }}>psychology</span>
          </div>
          <div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: 0 }}>Neural AI</h2>
            <p style={{ fontSize: "12px", color: "#009900", fontWeight: 700, margin: 0 }}>● Online · Engineering Study Assistant</p>
          </div>
        </div>

        {/* Chat messages */}
        <div style={{ flex: 1, overflowY: "auto", background: chatBg, borderRadius: "20px", border: `1px solid ${bdr}`, padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "72%", padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                background: m.role === "user" ? "#00FF00" : (isDark ? "rgba(255,255,255,0.06)" : "#ffffff"),
                border: m.role === "user" ? "none" : `1px solid ${bdr}`,
                color: m.role === "user" ? "#0f172a" : text1,
                fontSize: "13px", fontWeight: 500, lineHeight: 1.6,
                boxShadow: m.role === "user" ? "0 4px 14px rgba(0,255,0,0.3)" : (isDark ? "none" : "0 2px 8px rgba(0,0,0,0.05)")
              }}>
                {m.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {messages.length < 2 && (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", flexShrink: 0 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => setInput(s)}
                style={{ padding: "7px 14px", borderRadius: "9999px", border: `1px solid ${bdr}`, background: "transparent", color: text2, fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: "all 0.18s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,200,0,0.08)"; e.currentTarget.style.color = text1; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = text2; }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
          <input className="chat-input" placeholder="Ask anything about your coursework…" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
          <button onClick={send}
            style={{ width: "48px", height: "48px", borderRadius: "9999px", background: input.trim() ? "#00FF00" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"), border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() ? "pointer" : "not-allowed", flexShrink: 0, transition: "all 0.2s", boxShadow: input.trim() ? "0 4px 16px rgba(0,255,0,0.4)" : "none" }}>
            <span className="ms" style={{ fontSize: "22px", color: input.trim() ? "#0f172a" : (isDark ? "#475569" : "#94a3b8") }}>send</span>
          </button>
        </div>

      </div>
    </>
  );
}