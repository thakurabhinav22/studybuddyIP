"use client";
import { useState, useEffect } from "react";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref, onValue } from "firebase/database";

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

export default function NotesPage() {
  const resolved = useResolvedTheme();
  const isDark   = resolved === "dark";
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (!u) return;
      const unsubDB = onValue(ref(db, `users/${u.uid}`), snap => { if (snap.exists()) setUserData(snap.val()); });
      return () => unsubDB();
    });
    return () => unsub();
  }, []);

  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr   = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const card  = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const branch = userData?.branch || null;
  const notes  = userData?.recentNotes ? Object.values(userData.recentNotes) : [];

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;display:inline-block;white-space:nowrap;}
        .note-card{background:${card};padding:20px;border-radius:18px;border:1px solid ${bdr};display:flex;gap:20px;transition:box-shadow 0.2s,transform 0.2s;}
        .note-card:hover{box-shadow:${isDark ? "0 8px 28px rgba(0,255,0,0.1)" : "0 8px 28px rgba(0,200,0,0.12)"};transform:translateY(-2px);}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px", animation: "fadeUp 0.4s ease both" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ fontSize: "clamp(1.4rem,3vw,1.8rem)", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 4px" }}>My Notes</h2>
            <p style={{ fontSize: "14px", color: text2, margin: 0 }}>{notes.length} notes saved</p>
          </div>
          <button style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 20px", background: "#00FF00", color: "#0f172a", border: "none", borderRadius: "9999px", fontSize: "13px", fontWeight: 900, cursor: "pointer", fontFamily: "'Inter',sans-serif", boxShadow: "0 4px 16px rgba(0,255,0,0.35)" }}>
            <span className="ms" style={{ fontSize: "18px" }}>add</span> New Note
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {["All", "Recent", "Favourites", "Shared"].map((tab, i) => (
            <button key={tab} style={{ padding: "7px 16px", borderRadius: "9999px", border: `1px solid ${i === 0 ? "rgba(0,255,0,0.5)" : bdr}`, background: i === 0 ? "rgba(0,255,0,0.1)" : "transparent", color: i === 0 ? "#009900" : text2, fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>{tab}</button>
          ))}
        </div>

        {/* Notes grid */}
        {notes.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 20px", gap: "16px", background: card, borderRadius: "20px", border: `1px solid ${bdr}` }}>
            <div style={{ width: "72px", height: "72px", borderRadius: "18px", background: "rgba(0,200,0,0.1)", border: `1px solid ${bdr}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ fontSize: "38px", color: "#00AA00" }}>description</span>
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, color: text1, margin: 0 }}>No notes yet</h3>
            <p style={{ fontSize: "13px", color: text2, margin: 0, textAlign: "center" }}>Create your first note to start building your knowledge base.</p>
            <button style={{ padding: "10px 24px", background: "#00FF00", color: "#0f172a", border: "none", borderRadius: "9999px", fontSize: "13px", fontWeight: 900, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>Create Note</button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "16px" }}>
            {notes.map((note, i) => (
              <div key={i} className="note-card">
                <div style={{ width: "90px", minWidth: "90px", height: "90px", borderRadius: "14px", background: "linear-gradient(135deg,rgba(0,255,0,0.18),rgba(0,255,0,0.05))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="ms" style={{ fontSize: "34px", color: "rgba(0,180,0,0.6)" }}>{note.icon || "description"}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: "9999px", background: "rgba(0,200,0,0.1)", color: "#009900", fontSize: "10px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>{note.subject || branch || "General"}</span>
                  <h4 style={{ fontSize: "14px", fontWeight: 800, color: text1, margin: "0 0 4px" }}>{note.title}</h4>
                  <p style={{ fontSize: "11px", color: text2, lineHeight: 1.5, margin: "0 0 10px" }}>{note.desc}</p>
                  <button style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 12px", background: isDark ? "#f1f5f9" : "#0f172a", color: isDark ? "#0f172a" : "#fff", border: "none", borderRadius: "8px", fontSize: "11px", fontWeight: 800, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                    Open <span className="ms" style={{ fontSize: "13px" }}>arrow_forward</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}