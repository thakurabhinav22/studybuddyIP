"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function NotFound() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .nf-body {
          font-family: 'Inter', sans-serif;
          background: #F6FFF7;
          color: #0f172a;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
        }

        .ms {
          font-family: 'Material Symbols Outlined' !important;
          font-weight: normal; font-style: normal;
          font-size: 24px; line-height: 1;
          letter-spacing: normal; text-transform: none;
          display: inline-block; white-space: nowrap; direction: ltr;
        }

        /* ── Navbar ── */
        .nf-nav {
          width: 100%;
          border-bottom: 1px solid rgba(0,200,0,0.12);
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(246,255,247,0.88);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          position: sticky;
          top: 0;
          z-index: 50;
        }

        .nf-nav-left  { display: flex; align-items: center; gap: 32px; }
        .nf-nav-right { display: flex; align-items: center; gap: 14px; }

        .nf-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
        .nf-logo-icon {
          background: #00FF00;
          padding: 6px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 16px rgba(0,255,0,0.35);
        }
        .nf-logo-text { font-size: 1.15rem; font-weight: 900; letter-spacing: -0.04em; color: #0f172a; }

        .nf-nav-links { display: flex; align-items: center; gap: 24px; }
        .nf-nav-links a { font-size: 13px; font-weight: 700; color: #475569; text-decoration: none; transition: color 0.2s; }
        .nf-nav-links a:hover { color: #00AA00; }

        .nf-search-box {
          display: flex; align-items: center; gap: 8px;
          background: rgba(0,200,0,0.06);
          border: 1px solid rgba(0,200,0,0.2);
          border-radius: 10px; padding: 8px 14px;
        }
        .nf-search-box input {
          background: transparent; border: none; outline: none;
          font-size: 13px; width: 176px; color: #0f172a;
          font-family: 'Inter', sans-serif;
        }
        .nf-search-box input::placeholder { color: #94a3b8; }

        .nf-btn-profile {
          background: #00FF00; color: #0f172a;
          border: none; border-radius: 10px;
          padding: 9px 20px; font-size: 13px; font-weight: 800;
          cursor: pointer; font-family: 'Inter', sans-serif;
          box-shadow: 0 4px 14px rgba(0,255,0,0.3);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .nf-btn-profile:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(0,255,0,0.42); }

        /* ── Main ── */
        .nf-main {
          flex: 1;
          display: flex; align-items: center; justify-content: center;
          position: relative; overflow: hidden;
          padding: 56px 24px 72px;
        }

        .nf-blob {
          position: absolute; border-radius: 9999px;
          pointer-events: none; z-index: 0;
        }

        /* Decorative floating cards */
        .nf-deco-card {
          position: absolute;
          background: rgba(255,255,255,0.65);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(0,200,0,0.12);
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.07);
          padding: 20px; z-index: 1;
        }
        .nf-bar { height: 8px; border-radius: 9999px; margin-bottom: 8px; }

        /* Center column */
        .nf-center {
          position: relative; z-index: 2;
          max-width: 640px; width: 100%;
          display: flex; flex-direction: column;
          align-items: center; text-align: center;
        }

        /* Illustration */
        .nf-illus {
          position: relative; width: 200px; height: 200px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 48px;
        }
        .nf-illus-glow {
          position: absolute; inset: 0;
          background: rgba(0,255,0,0.18);
          border-radius: 9999px; filter: blur(32px);
        }
        .nf-badge {
          position: absolute; top: -10px; right: -10px;
          background: #fff;
          border: 2px solid rgba(0,200,0,0.25);
          border-radius: 9999px;
          width: 52px; height: 52px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(0,0,0,0.09);
        }

        /* Typography */
        .nf-404 {
          font-size: clamp(5.5rem, 18vw, 9.5rem);
          font-weight: 900; letter-spacing: -0.05em; line-height: 1;
          color: #0f172a; margin-bottom: 14px;
        }
        .nf-title {
          font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 800;
          letter-spacing: -0.025em; color: #1e293b;
          margin-bottom: 14px;
        }
        .nf-desc {
          font-size: 1.05rem; color: #64748b; line-height: 1.75;
          max-width: 420px; font-weight: 500;
          margin-bottom: 40px;
        }

        /* Buttons */
        .nf-actions {
          display: flex; flex-wrap: wrap;
          justify-content: center; gap: 14px;
          margin-bottom: 52px; width: 100%;
        }
        .nf-btn-p {
          display: flex; align-items: center; gap: 8px;
          background: #00FF00; color: #0f172a;
          border: none; border-radius: 14px;
          padding: 16px 32px; font-size: 1rem; font-weight: 900;
          cursor: pointer; font-family: 'Inter', sans-serif;
          text-decoration: none;
          transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s;
          box-shadow: 0 8px 28px rgba(0,255,0,0.38);
        }
        .nf-btn-p:hover { transform: translateY(-3px) scale(1.04); box-shadow: 0 18px 44px rgba(0,255,0,0.52); }

        .nf-btn-s {
          display: flex; align-items: center; gap: 8px;
          background: rgba(255,255,255,0.7);
          border: 1.5px solid rgba(0,200,0,0.3);
          border-radius: 14px;
          padding: 16px 28px; font-size: 1rem; font-weight: 800;
          cursor: pointer; font-family: 'Inter', sans-serif;
          color: #0f172a; text-decoration: none;
          transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s, background 0.2s;
          backdrop-filter: blur(8px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.06);
        }
        .nf-btn-s:hover { transform: translateY(-3px) scale(1.02); background: rgba(0,255,0,0.1); box-shadow: 0 10px 28px rgba(0,255,0,0.18); }

        /* Quick links */
        .nf-qlinks { display: flex; flex-wrap: wrap; justify-content: center; gap: 20px 32px; }
        .nf-qlinks a {
          font-size: 11.5px; font-weight: 800; color: #94a3b8;
          text-decoration: none; text-transform: uppercase; letter-spacing: 0.1em;
          transition: color 0.2s;
        }
        .nf-qlinks a:hover { color: #00AA00; }

        /* Footer */
        .nf-footer {
          text-align: center; padding: 20px 24px;
          border-top: 1px solid rgba(0,200,0,0.08);
          font-size: 12px; font-weight: 600; color: #94a3b8;
        }

        @media (max-width: 768px) {
          .nf-nav-links, .nf-search-box, .nf-deco-card { display: none; }
        }
      `}</style>

      <div className="nf-body">

        {/* ── Navbar ── */}
        <header className="nf-nav">
          <div className="nf-nav-left">
            <Link href="/" className="nf-logo">
              <div className="nf-logo-icon">
                <span className="ms" style={{ color: "#0f172a", fontSize: "22px" }}>school</span>
              </div>
              <span className="nf-logo-text">StudyBuddy</span>
            </Link>
            <nav className="nf-nav-links">
              <Link href="/">Dashboard</Link>
              <Link href="/#notes">Courses</Link>
              <Link href="/#notes">Resources</Link>
              <Link href="/#doubt">AI Tutor</Link>
            </nav>
          </div>
          <div className="nf-nav-right">
            <div className="nf-search-box">
              <span className="ms" style={{ color: "#00AA00", fontSize: "18px" }}>search</span>
              <input placeholder="Search knowledge..." type="text" />
            </div>
            <button className="nf-btn-profile">Profile</button>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="nf-main">

          {/* Blobs */}
          <div className="nf-blob" style={{ top: "20%", right: "20%", width: "280px", height: "280px", background: "rgba(0,255,0,0.06)", filter: "blur(64px)" }} />
          <div className="nf-blob" style={{ bottom: "15%", left: "10%", width: "340px", height: "340px", background: "rgba(0,255,0,0.08)", filter: "blur(80px)" }} />

          {/* Deco card — top left */}
          <div className="nf-deco-card" style={{ top: "12%", left: "5%", transform: "rotate(-12deg)" }}>
            <div className="nf-bar" style={{ width: "96px", background: "rgba(0,200,0,0.2)" }} />
            <div className="nf-bar" style={{ width: "64px", background: "rgba(0,200,0,0.1)", marginBottom: 0 }} />
            <span className="ms" style={{ color: "rgba(0,180,0,0.3)", fontSize: "28px", position: "absolute", top: "-14px", right: "-14px" }}>menu_book</span>
          </div>

          {/* Deco card — bottom right */}
          <div className="nf-deco-card" style={{ bottom: "18%", right: "5%", transform: "rotate(8deg)" }}>
            <div className="nf-bar" style={{ width: "80px",  background: "rgba(0,200,0,0.2)" }} />
            <div className="nf-bar" style={{ width: "110px", background: "rgba(0,200,0,0.1)" }} />
            <div className="nf-bar" style={{ width: "48px",  background: "rgba(0,200,0,0.1)", marginBottom: 0 }} />
            <span className="ms" style={{ color: "rgba(0,180,0,0.3)", fontSize: "34px", position: "absolute", bottom: "-14px", left: "-14px" }}>psychology</span>
          </div>

          {/* ── Center ── */}
          <div className="nf-center">

            {/* Illustration */}
            <div className="nf-illus">
              <div className="nf-illus-glow" />
              <span className="ms" style={{ fontSize: "140px", color: "#00DD00", position: "relative", zIndex: 1, lineHeight: 1 }}>auto_stories</span>
              <div className="nf-badge">
                <span className="ms" style={{ color: "#00BB00", fontSize: "24px" }}>link_off</span>
              </div>
            </div>

            {/* Text */}
            <h1 className="nf-404">404</h1>
            <h2 className="nf-title">Looks like this page skipped class.</h2>
            <p className="nf-desc">
              The engineering resource you&apos;re looking for seems to have been misplaced. Don&apos;t worry, your AI tutor is still on duty.
            </p>

            {/* Buttons */}
            <div className="nf-actions">
              <Link href="/" className="nf-btn-p">
                <span className="ms" style={{ fontSize: "20px", color: "#0f172a" }}>dashboard</span>
                Return to Dashboard
              </Link>
            </div>

            {/* Quick links */}
            <div className="nf-qlinks">
              <Link href="/#notes">Engineering Library</Link>
              <Link href="/#test">Exam Prep</Link>
              <Link href="/#notes">Formula Sheets</Link>
              <a href="#">Contact Support</a>
            </div>

          </div>
        </main>

        {/* ── Footer ── */}
        <footer className="nf-footer">
          © {new Date().getFullYear()} StudyBuddy — Built for TCET students, by TCET students.
        </footer>

      </div>
    </>
  );
}