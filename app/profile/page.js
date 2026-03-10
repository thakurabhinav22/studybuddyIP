"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, update } from "firebase/database";

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

const BRANCHES = ["IT","CS","EXTC","MECH","CIVIL","ELEC"];

export default function ProfilePage() {
  const router   = useRouter();
  const resolved = useResolvedTheme();
  const isDark   = resolved === "dark";
  const [authUser, setAuthUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [form,     setForm]     = useState({ firstName: "", fullName: "", branch: "" });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      const unsubDB = onValue(ref(db, `users/${u.uid}`), snap => {
        if (snap.exists()) {
          const d = snap.val();
          setUserData(d);
          setForm({ firstName: d.firstName || "", fullName: d.fullName || "", branch: d.branch || "" });
        }
      });
      return () => unsubDB();
    });
    return () => unsub();
  }, [router]);

  const save = async () => {
    if (!authUser) return;
    setSaving(true);
    await update(ref(db, `users/${authUser.uid}`), form);
    setSaving(false);
    setEditing(false);
  };

  const text1   = isDark ? "#f1f5f9" : "#0f172a";
  const text2   = isDark ? "#94a3b8" : "#475569";
  const text3   = isDark ? "#475569" : "#94a3b8";
  const bdr     = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.1)";
  const card    = isDark ? "rgba(15,23,42,0.8)" : "#ffffff";
  const inputBg = isDark ? "rgba(255,255,255,0.05)" : "#f8fafc";

  const firstName = userData?.firstName || authUser?.displayName?.split(" ")[0] || "";
  const fullName  = userData?.fullName  || authUser?.displayName || "";
  const photoURL  = userData?.photoURL  || authUser?.photoURL    || "";
  const branch    = userData?.branch    || "—";
  const email     = userData?.email     || authUser?.email       || "—";
  const joined    = authUser?.metadata?.creationTime ? new Date(authUser.metadata.creationTime).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—";

  const inputStyle = { width: "100%", background: inputBg, border: `1.5px solid ${bdr}`, borderRadius: "12px", padding: "11px 14px", fontSize: "14px", fontFamily: "'Inter',sans-serif", color: text1, outline: "none", transition: "border-color 0.2s" };

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;font-size:24px;line-height:1;display:inline-block;white-space:nowrap;}
        input:focus,select:focus{border-color:rgba(0,255,0,0.5)!important;box-shadow:0 0 0 3px rgba(0,255,0,0.1)!important;}
        .stat-pill{background:${card};border:1px solid ${bdr};border-radius:14px;padding:16px 20px;display:flex;flex-direction:column;gap:4px;align-items:center;}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "28px", animation: "fadeUp 0.4s ease both", maxWidth: "680px" }}>

        {/* Profile hero */}
        <div style={{ background: card, borderRadius: "24px", border: `1px solid ${bdr}`, padding: "32px", display: "flex", alignItems: "flex-start", gap: "24px", flexWrap: "wrap" }}>
          {/* Avatar */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{ width: "88px", height: "88px", borderRadius: "9999px", border: "3px solid #00FF00", overflow: "hidden", background: isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0", boxShadow: "0 0 24px rgba(0,255,0,0.3)" }}>
              {photoURL
                ? <img src={photoURL} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontSize: "36px", fontWeight: 900, fontFamily: "'Inter',sans-serif" }}>
                    {firstName ? firstName.charAt(0).toUpperCase() : "?"}
                  </div>
              }
            </div>
            <div style={{ position: "absolute", bottom: "2px", right: "2px", width: "22px", height: "22px", borderRadius: "9999px", background: "#00FF00", border: `3px solid ${isDark ? "#080f1a" : "#f5f8f5"}`, boxShadow: "0 0 8px rgba(0,255,0,0.6)" }} />
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: "180px" }}>
            <h2 style={{ fontSize: "22px", fontWeight: 900, letterSpacing: "-0.03em", color: text1, margin: "0 0 4px" }}>{fullName || "—"}</h2>
            <p style={{ fontSize: "13px", color: text2, margin: "0 0 12px" }}>{email}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <span style={{ padding: "4px 12px", background: "rgba(0,200,0,0.1)", border: "1px solid rgba(0,200,0,0.25)", borderRadius: "9999px", fontSize: "11px", fontWeight: 800, color: "#009900" }}>{branch}</span>
              <span style={{ padding: "4px 12px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: `1px solid ${bdr}`, borderRadius: "9999px", fontSize: "11px", fontWeight: 700, color: text2 }}>TCET</span>
              <span style={{ padding: "4px 12px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: `1px solid ${bdr}`, borderRadius: "9999px", fontSize: "11px", fontWeight: 700, color: text2 }}>Joined {joined}</span>
            </div>
          </div>

          {/* Edit btn */}
          <button onClick={() => setEditing(e => !e)}
            style={{ padding: "9px 18px", background: editing ? "rgba(0,200,0,0.1)" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"), border: `1px solid ${editing ? "rgba(0,200,0,0.4)" : bdr}`, borderRadius: "10px", fontSize: "12px", fontWeight: 800, color: editing ? "#009900" : text2, cursor: "pointer", fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <span className="ms" style={{ fontSize: "16px" }}>{editing ? "close" : "edit"}</span>
            {editing ? "Cancel" : "Edit Profile"}
          </button>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "12px" }}>
          {[
            { label: "Study Hours",  value: userData?.stats?.studyHours     || 0,  icon: "schedule"              },
            { label: "AI Questions", value: userData?.stats?.aiQuestions     || 0,  icon: "question_answer"       },
            { label: "Problems",     value: userData?.stats?.solvedProblems  || 0,  icon: "task_alt"              },
            { label: "Day Streak",   value: userData?.stats?.streak          || 0,  icon: "local_fire_department" },
          ].map(({ label, value, icon }) => (
            <div key={label} className="stat-pill">
              <span className="ms" style={{ fontSize: "22px", color: "#009900" }}>{icon}</span>
              <p style={{ fontSize: "22px", fontWeight: 900, color: text1, margin: 0, letterSpacing: "-0.03em" }}>{value}</p>
              <p style={{ fontSize: "10px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Edit form */}
        {editing && (
          <div style={{ background: card, borderRadius: "20px", border: `1px solid ${bdr}`, padding: "28px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: text1, margin: "0 0 20px", letterSpacing: "-0.02em" }}>Edit Information</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "6px" }}>First Name</label>
                <input style={inputStyle} value={form.firstName} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} placeholder="First name" />
              </div>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "6px" }}>Full Name</label>
                <input style={inputStyle} value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))} placeholder="Full name" />
              </div>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: text3, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "6px" }}>Branch</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={form.branch} onChange={e => setForm(p => ({ ...p, branch: e.target.value }))}>
                  <option value="">Select branch</option>
                  {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <button onClick={save} disabled={saving}
                style={{ height: "48px", background: "#00FF00", color: "#0f172a", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 900, cursor: "pointer", fontFamily: "'Inter',sans-serif", boxShadow: "0 6px 20px rgba(0,255,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "4px" }}>
                {saving && <div style={{ width: "18px", height: "18px", border: "2px solid rgba(0,0,0,0.2)", borderTopColor: "#0f172a", borderRadius: "9999px", animation: "spin 0.7s linear infinite" }} />}
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        )}

        {/* Sign out */}
        <button onClick={() => signOut(auth).then(() => router.replace("/"))}
          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 20px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "14px", cursor: "pointer", color: "#f87171", fontSize: "13px", fontWeight: 800, fontFamily: "'Inter',sans-serif", width: "100%", justifyContent: "center", transition: "background 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(248,113,113,0.14)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(248,113,113,0.08)"}>
          <span className="ms" style={{ fontSize: "20px" }}>logout</span>
          Sign Out
        </button>

      </div>
    </>
  );
}