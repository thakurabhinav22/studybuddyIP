"use client";

import { useRouter, usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from "../context/AuthContext";

const navItems = [
  { icon: "dashboard",   label: "Dashboard", href: "/dashboard" },
  { icon: "auto_stories",label: "AI Notes",  href: "/dashboard/notes" },
  { icon: "quiz",        label: "AI Test",   href: "/dashboard/test" },
  { icon: "forum",       label: "Doubt Solver", href: "/dashboard/doubt" },
  { icon: "psychology",  label: "Neural AI", href: "/dashboard/neural" },
];

const accountItems = [
  { icon: "person",   label: "Profile",  href: "/dashboard/profile" },
  { icon: "settings", label: "Settings", href: "/dashboard/settings" },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  async function handleLogout() {
    await signOut(auth);
    router.push("/");
  }

  return (
    <>
      <style>{`
        .sb-link {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 16px; border-radius: 9999px;
          font-size: 14px; font-weight: 500; color: rgba(15,23,42,0.6);
          text-decoration: none; transition: all 0.2s;
          cursor: pointer; border: none; background: none; width: 100%;
        }
        .sb-link:hover { background: rgba(0,255,0,0.1); color: #0f172a; }
        .sb-link.active { background: #00FF00; color: #0f172a; font-weight: 700; box-shadow: 0 4px 16px rgba(0,255,0,0.3); }
        .sb-link .material-symbols-outlined { font-size: 22px; }
      `}</style>

      <aside style={{
        width: "260px", minWidth: "260px", height: "100vh",
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        borderRight: "1px solid rgba(0,255,0,0.12)",
        display: "flex", flexDirection: "column", padding: "24px",
        fontFamily: "'Inter', sans-serif",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "36px", padding: "0 8px" }}>
          <div style={{ width: "40px", height: "40px", background: "#00FF00", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(0,255,0,0.35)" }}>
            <span className="material-symbols-outlined" style={{ color: "#0f172a", fontWeight: 700 }}>school</span>
          </div>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em" }}>StudyBuddy</div>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#00AA00", textTransform: "uppercase", letterSpacing: "0.1em" }}>TCET · IT</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
          {navItems.map(({ icon, label, href }) => (
            <button
              key={href}
              className={`sb-link${pathname === href ? " active" : ""}`}
              onClick={() => router.push(href)}
            >
              <span className="material-symbols-outlined">{icon}</span>
              <span>{label}</span>
            </button>
          ))}

          <div style={{ padding: "20px 16px 8px", fontSize: "10px", fontWeight: 800, color: "rgba(15,23,42,0.35)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Account
          </div>

          {accountItems.map(({ icon, label, href }) => (
            <button
              key={href}
              className={`sb-link${pathname === href ? " active" : ""}`}
              onClick={() => router.push(href)}
            >
              <span className="material-symbols-outlined">{icon}</span>
              <span>{label}</span>
            </button>
          ))}

          {/* Logout */}
          <button className="sb-link" onClick={handleLogout} style={{ marginTop: "4px", color: "#ef4444" }}>
            <span className="material-symbols-outlined" style={{ color: "#ef4444" }}>logout</span>
            <span>Logout</span>
          </button>
        </nav>

        {/* Upgrade card */}
        <div style={{ background: "#0f172a", borderRadius: "16px", padding: "20px", position: "relative", overflow: "hidden", marginTop: "16px" }}>
          <div style={{ position: "absolute", right: "-16px", top: "-16px", width: "80px", height: "80px", background: "rgba(0,255,0,0.2)", borderRadius: "9999px", filter: "blur(20px)" }} />
          <p style={{ color: "#fff", fontSize: "12px", fontWeight: 600, marginBottom: "12px", position: "relative", zIndex: 1 }}>
            Get full access to AI tools
          </p>
          <button style={{ width: "100%", padding: "10px", background: "#00FF00", color: "#0f172a", fontSize: "12px", fontWeight: 800, borderRadius: "10px", border: "none", cursor: "pointer", transition: "transform 0.2s", position: "relative", zIndex: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            Upgrade to Premium
          </button>
        </div>
      </aside>
    </>
  );
}