"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref, onValue, set, remove, get } from "firebase/database";
import { flushPendingUsageStats, flushUsageStats } from "@/lib/usageStats";
import { logoutAndClearCache } from "@/lib/logout";

/* ═══════════════════════════════════════════
   SUBJECT ICON MAP  (matches NotesPage)
═══════════════════════════════════════════ */
const SUBJECT_ICON_MAP = {
  CN:       { icon:"router",       color:"#3b82f6" },
  COA:      { icon:"memory",       color:"#8b5cf6" },
  MATHS3:   { icon:"functions",    color:"#00FF00" },
  MATHS:    { icon:"functions",    color:"#00FF00" },
  NOSQL:    { icon:"database",     color:"#f59e0b" },
  MONOGPDB: { icon:"database",     color:"#f59e0b" },
  DSA:      { icon:"account_tree", color:"#ec4899" },
  OS:       { icon:"terminal",     color:"#14b8a6" },
  DBMS:     { icon:"storage",      color:"#f97316" },
  DEFAULT:  { icon:"description",  color:"#64748b" },
};
function getSubjectMeta(code) { return SUBJECT_ICON_MAP[code] || SUBJECT_ICON_MAP.DEFAULT; }

/* ── Nav items (matches NotesPage) ── */
const NAV_ITEMS = [
  { id:"dashboard", icon:"dashboard",   label:"Dashboard", href:"/dashboard" },
  { id:"notes",     icon:"description", label:"Notes",     href:"/notes"     },
  { id:"test",      icon:"quiz",        label:"Test",      href:"/test"      },
  { id:"ai",        icon:"psychology",  label:"Neural AI", href:"/ai"        },
  { id:"profile",   icon:"person",      label:"Profile",   href:"/profile"   },
  { id:"settings",  icon:"settings",    label:"Settings",  href:"/settings"  },
];

/* ── Quick suggestion prompts ── */
const SUGGESTIONS = [
  { icon:"summarize",    label:"Summarize topic"        },
  { icon:"quiz",         label:"Generate quiz questions" },
  { icon:"lightbulb",   label:"Explain key concepts"   },
  { icon:"history_edu", label:"Give exam tips"          },
];

/* ── Tools for Neural AI ── */
const TOOLS = [
  { id:"summarize",  name:"Summarize",      desc:"Quick summary", icon:"summarize" },
  { id:"quiz",       name:"Quiz Gen",       desc:"Practice questions", icon:"quiz" },
  { id:"concepts",   name:"Concepts",       desc:"Key ideas", icon:"lightbulb" },
  { id:"tips",       name:"Exam Tips",      desc:"Exam strategies", icon:"history_edu" },
  { id:"examples",   name:"Examples",       desc:"Use cases", icon:"case_notes" },
  { id:"compare",    name:"Compare",        desc:"Compare topics", icon:"scale" },
];

const INITIAL_GREETING = "Hi! I'm Neural AI, your engineering study assistant. Ask me anything about your coursework — DSA, Networks, Databases, OS and more.\n\nYou can also import a module from your notes to get targeted help on a specific topic, or use a tool like /summarize or /quiz to structure your learning!";

/* ── Groq API Client ── */
const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";

async function callGroqChat({ messages, max_tokens = 1500, temperature = 0.5 }) {
  const res = await fetch("/api/groq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: GROQ_TEXT_MODEL, messages, max_tokens, temperature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response right now.";
}

/* ── Theme hook (matches NotesPage) ── */
function useTheme() {
  const KEY = "studybuddy_theme";
  const [theme, setThemeState] = useState("system");
  const [resolved, setResolved] = useState("light");
  useEffect(() => {
    try { setThemeState(localStorage.getItem(KEY) || "system"); } catch {}
  }, []);
  const setTheme = (val) => {
    try { localStorage.setItem(KEY, val); } catch {}
    setThemeState(val);
  };
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);
  return { theme, setTheme, resolved };
}

/* ── Theme Switcher (matches NotesPage) ── */
function ThemeSwitcher({ theme, setTheme, resolved }) {
  const isDark = resolved === "dark";
  const [hovered, setHovered] = useState(null);
  const opts = [
    { value:"light",  icon:"light_mode",     label:"Light"  },
    { value:"dark",   icon:"dark_mode",       label:"Dark"   },
    { value:"system", icon:"desktop_windows", label:"System" },
  ];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:"2px", padding:"4px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", border:`1px solid ${isDark?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.08)"}` }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <div key={value} style={{ position:"relative" }}>
            <button
              onClick={() => setTheme(value)}
              onMouseEnter={() => setHovered(value)}
              onMouseLeave={() => setHovered(null)}
              style={{ width:"32px", height:"32px", borderRadius:"9999px", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.22s cubic-bezier(0.34,1.56,0.64,1)", background:active?(isDark?"rgba(0,255,0,0.18)":"#00FF00"):"transparent", boxShadow:active?(isDark?"0 0 14px rgba(0,255,0,0.3)":"0 4px 12px rgba(0,255,0,0.35)"):"none", transform:active?"scale(1.08)":"scale(1)" }}
            >
              <span style={{ fontFamily:"'Material Symbols Outlined'", fontSize:"16px", lineHeight:1, color:active?(isDark?"#00FF00":"#0f172a"):(isDark?"#475569":"#94a3b8") }}>{icon}</span>
            </button>
            {hovered === value && (
              <div style={{ position:"absolute", bottom:"calc(100% + 8px)", left:"50%", transform:"translateX(-50%)", background:isDark?"#1e293b":"#0f172a", color:"#fff", fontSize:"10px", fontWeight:700, padding:"4px 8px", borderRadius:"6px", whiteSpace:"nowrap", pointerEvents:"none", zIndex:100 }}>
                {label}
                <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", width:0, height:0, borderLeft:"4px solid transparent", borderRight:"4px solid transparent", borderTop:`4px solid ${isDark?"#1e293b":"#0f172a"}` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────
   COPY BUTTON & MARKDOWN RENDERER
───────────────────────────────────────── */
function CopyButton({ code }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "6px",
        padding: "3px 8px",
        fontSize: "10px",
        color: copied ? "#00FF00" : "#94a3b8",
        cursor: "pointer",
        transition: "all 0.2s",
        fontFamily: "'Lexend',sans-serif",
      }}
    >
      <span className="ms" style={{ fontSize: "12px" }}>{copied ? "check" : "content_copy"}</span>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function inlineFormat(text, isDark) {
  if (typeof text !== "string") return text;
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0, m;
  const strongColor = isDark ? "#ffffff" : "#0f172a";
  const emColor = isDark ? "#cbd5e1" : "#334155";
  const codeColor = isDark ? "#4ade80" : "#15803d";
  const codeBg = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.08)";
  const codeBorder = isDark ? "rgba(0,255,0,0.2)" : "rgba(0,200,0,0.15)";

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`text-${last}-${m.index}`}>{text.slice(last, m.index)}</span>);
    }
    if (m[0].startsWith("**")) {
      parts.push(<strong key={`strong-${m.index}`} style={{ fontWeight: 700, color: strongColor }}>{m[2]}</strong>);
    } else if (m[0].startsWith("*")) {
      parts.push(<em key={`em-${m.index}`} style={{ fontStyle: "italic", color: emColor }}>{m[3]}</em>);
    } else if (m[0].startsWith("`")) {
      parts.push(
        <code
          key={`code-${m.index}`}
          style={{
            fontFamily: "'Fira Code', 'Courier New', monospace",
            background: codeBg,
            border: `1px solid ${codeBorder}`,
            padding: "1px 5px",
            borderRadius: "4px",
            fontSize: "11px",
            color: codeColor,
          }}
        >
          {m[4]}
        </code>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`text-${last}-${text.length}`}>{text.slice(last)}</span>);
  return parts.length ? parts : text;
}

function MarkdownText({ text, isDark }) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  const textColor = isDark ? "#e2e8f0" : "#1e293b";
  const mutedColor = isDark ? "#94a3b8" : "#64748b";
  const headingColor = isDark ? "#ffffff" : "#0f172a";
  const codeBg = isDark ? "rgba(10,18,32,0.85)" : "#f8fafc";
  const codeBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const calloutBorder = isDark ? "rgba(0,255,0,0.3)" : "rgba(0,200,0,0.35)";

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Fenced Code Blocks
    if (rawLine.trimStart().startsWith("```")) {
      const lang = rawLine.trim().slice(3).trim() || "code";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      const fullCode = codeLines.join("\n");
      elements.push(
        <div
          key={`code-block-${i}`}
          style={{
            margin: "12px 0",
            borderRadius: "10px",
            overflow: "hidden",
            border: `1px solid ${codeBorder}`,
            background: codeBg,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px",
              background: isDark ? "rgba(255,255,255,0.03)" : "#f1f5f9",
              borderBottom: `1px solid ${codeBorder}`,
            }}
          >
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#00CC00",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontFamily: "monospace",
              }}
            >
              {lang}
            </span>
            <CopyButton code={fullCode} />
          </div>
          <pre
            style={{
              padding: "12px 14px",
              fontSize: "12px",
              lineHeight: 1.65,
              overflowX: "auto",
              margin: 0,
              fontFamily: "'Fira Code', 'Courier New', monospace",
              color: isDark ? "#a7f3d0" : "#065f46",
            }}
          >
            {fullCode}
          </pre>
        </div>
      );
      i++;
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ""));
        i++;
      }
      elements.push(
        <div
          key={`quote-${i}`}
          style={{
            margin: "10px 0",
            padding: "10px 14px",
            borderLeft: `3px solid ${calloutBorder}`,
            background: isDark ? "rgba(0,255,0,0.04)" : "rgba(0,200,0,0.04)",
            borderRadius: "0 10px 10px 0",
            fontSize: "12px",
            lineHeight: 1.65,
            color: mutedColor,
          }}
        >
          {quoteLines.map((ql, qk) => (
            <p key={qk} style={{ margin: "2px 0" }}>{inlineFormat(ql, isDark)}</p>
          ))}
        </div>
      );
      continue;
    }

    // Tables
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = row => row.slice(1, -1).split("|").map(c => c.trim());
        const headerCells = parseRow(tableLines[0]);
        const isDivider = line => /^\|?[\s-:]+\|?$/.test(line);
        const startRow = isDivider(tableLines[1]) ? 2 : 1;
        const bodyRows = tableLines.slice(startRow).map(parseRow);

        elements.push(
          <div key={`table-${i}`} style={{ overflowX: "auto", margin: "12px 0", borderRadius: "10px", border: `1px solid ${codeBorder}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: isDark ? "rgba(255,255,255,0.04)" : "#f1f5f9" }}>
                  {headerCells.map((hc, hk) => (
                    <th key={hk} style={{ padding: "8px 10px", fontWeight: 700, color: headingColor, borderBottom: `1px solid ${codeBorder}` }}>
                      {inlineFormat(hc, isDark)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((br, bk) => (
                  <tr key={bk} style={{ borderBottom: bk === bodyRows.length - 1 ? "none" : `1px solid ${codeBorder}` }}>
                    {br.map((bc, bck) => (
                      <td key={bck} style={{ padding: "7px 10px", color: textColor }}>
                        {inlineFormat(bc, isDark)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Headings
    const hMatch = rawLine.match(/^(#{1,4})\s+(.+)/);
    if (hMatch) {
      const lvl = hMatch[1].length;
      const headingConfig = {
        1: { size: "15px", weight: 800, mt: "14px", mb: "6px", borderBottom: true },
        2: { size: "13.5px", weight: 700, mt: "12px", mb: "5px", borderBottom: false },
        3: { size: "12.5px", weight: 700, mt: "10px", mb: "4px", borderBottom: false },
        4: { size: "12px", weight: 700, mt: "8px", mb: "3px", borderBottom: false },
      };
      const cfg = headingConfig[lvl] || headingConfig[3];
      elements.push(
        <div key={`heading-${i}`} style={{ marginTop: cfg.mt, marginBottom: cfg.mb, paddingBottom: cfg.borderBottom ? "4px" : "0", borderBottom: cfg.borderBottom ? `1px solid ${codeBorder}` : "none" }}>
          <h4 style={{ fontSize: cfg.size, fontWeight: cfg.weight, margin: 0, color: headingColor, lineHeight: 1.4, letterSpacing: "-0.01em" }}>
            {inlineFormat(hMatch[2], isDark)}
          </h4>
        </div>
      );
      i++;
      continue;
    }

    // Unordered Lists
    if (/^[-*•]\s/.test(rawLine.trimStart())) {
      const items = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i].trimStart())) {
        items.push(lines[i].replace(/^[\s\-*•]+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ margin: "6px 0 8px", paddingLeft: "4px", listStyle: "none" }}>
          {items.map((item, k) => (
            <li key={k} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: 1.65, margin: "4px 0", color: textColor }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#00CC00", flexShrink: 0, marginTop: "8px" }} />
              <span style={{ flex: 1 }}>{inlineFormat(item, isDark)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered Lists
    if (/^\d+\.\s/.test(rawLine.trimStart())) {
      const items = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trimStart())) {
        items.push({ n: num++, text: lines[i].replace(/^\d+\.\s*/, "") });
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ margin: "6px 0 8px", paddingLeft: "4px", listStyle: "none" }}>
          {items.map(({ n, text: itmText }, k) => (
            <li key={k} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: 1.65, margin: "4px 0", color: textColor }}>
              <span style={{ minWidth: "18px", height: "18px", borderRadius: "5px", background: isDark ? "rgba(0,255,0,0.12)" : "rgba(0,200,0,0.1)", color: "#00CC00", fontWeight: 700, fontSize: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>
                {n}
              </span>
              <span style={{ flex: 1 }}>{inlineFormat(itmText, isDark)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal Rule
    if (/^---+$|^\*\*\*+$/.test(trimmed)) {
      elements.push(<div key={`hr-${i}`} style={{ height: "1px", background: codeBorder, margin: "12px 0" }} />);
      i++;
      continue;
    }

    // Empty line
    if (trimmed === "") {
      elements.push(<div key={`sp-${i}`} style={{ height: "6px" }} />);
      i++;
      continue;
    }

    // Regular line
    elements.push(
      <p key={`p-${i}`} style={{ fontSize: "12px", lineHeight: 1.7, margin: "4px 0", color: textColor, wordBreak: "break-word" }}>
        {inlineFormat(rawLine, isDark)}
      </p>
    );
    i++;
  }
  return <>{elements}</>;
}

/* ═══════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════ */
export default function AiPage() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  /* ── Auth ── */
  const [authUser,    setAuthUser]    = useState(null);
  const [userData,    setUserData]    = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  /* ── Sidebar & Drawers ── */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  /* ── Sessions & Chat state ── */
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([
    { role:"ai", text:INITIAL_GREETING, ts: Date.now() }
  ]);
  const [input,       setInput]       = useState("");
  const [aiLoading,   setAiLoading]   = useState(false);
  const [importedMod, setImportedMod] = useState(null); // { subject, modKey, title }
  const bottomRef = useRef(null);
  const sessionStartRef = useRef(null);
  const aiQuestionsRef = useRef(0);

  /* ── Import sheet ── */
  const [importOpen,       setImportOpen]       = useState(false);
  const [importSubjects,   setImportSubjects]   = useState({});
  const [importLoading,    setImportLoading]    = useState(false);
  const [importActiveSub,  setImportActiveSub]  = useState(null);
  const importListenerRef = useRef(null);

  /* ── Tools ── */
  const [activeTool,   setActiveTool]   = useState(null);
  const [toolsOpen,    setToolsOpen]    = useState(false);

  const normaliseSem = useCallback((raw) => {
    if (!raw) return "";
    const str = raw.toString().trim();
    if (/^Sem:\d+$/.test(str)) return str;
    const num = str.replace(/[^0-9]/g, "");
    return num ? `Sem:${num}` : str;
  }, []);

  /* ── Auth guard ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      const unsubDB = onValue(ref(db, `users/${u.uid}`), (snap) => {
        if (snap.exists()) { const data = snap.val(); setUserData(data); }
        setAuthLoading(false);
      });
      return () => unsubDB();
    });
    return () => unsub();
  }, [router]);

  /* ── Load Sessions (Local Storage + Firebase) ── */
  useEffect(() => {
    if (!authUser?.uid) return;
    const uid = authUser.uid;
    const localKey = `studybuddy:chat_sessions:${uid}`;

    // Read local cache first for snappy startup
    try {
      const cached = localStorage.getItem(localKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
          setMessages(parsed[0].messages || [{ role:"ai", text:INITIAL_GREETING, ts: Date.now() }]);
        }
      }
    } catch { }

    // Sync from Firebase
    const chatsRef = ref(db, `users/${uid}/ai_chats`);
    const unsubChats = onValue(chatsRef, (snap) => {
      if (snap.exists()) {
        const raw = snap.val();
        const loadedSessions = Object.values(raw).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (loadedSessions.length > 0) {
          setSessions(loadedSessions);
          try { localStorage.setItem(localKey, JSON.stringify(loadedSessions)); } catch {}

          setActiveSessionId((curr) => {
            if (!curr) {
              setMessages(loadedSessions[0].messages || [{ role:"ai", text:INITIAL_GREETING, ts: Date.now() }]);
              return loadedSessions[0].id;
            }
            // If current active session exists in remote, sync messages
            const activeSess = loadedSessions.find(s => s.id === curr);
            if (activeSess) {
              setMessages(activeSess.messages || []);
            }
            return curr;
          });
        }
      }
    });

    return () => unsubChats();
  }, [authUser?.uid]);

  /* ── Helper to save session to LocalStorage & Firebase ── */
  const persistSession = useCallback((updatedSession, allSessions) => {
    if (!authUser?.uid) return;
    const uid = authUser.uid;
    const localKey = `studybuddy:chat_sessions:${uid}`;
    try {
      localStorage.setItem(localKey, JSON.stringify(allSessions));
    } catch {}

    // Save active session to Firebase
    try {
      const sessRef = ref(db, `users/${uid}/ai_chats/${updatedSession.id}`);
      set(sessRef, updatedSession);
    } catch (e) {
      console.warn("Failed syncing chat session to Firebase:", e);
    }
  }, [authUser?.uid]);

  /* ── Start a New Chat ── */
  const createNewChat = () => {
    const newId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newSession = {
      id: newId,
      title: "New Conversation",
      updatedAt: Date.now(),
      messages: [{ role:"ai", text:INITIAL_GREETING, ts: Date.now() }],
    };
    const nextSessions = [newSession, ...sessions.filter(s => s.messages && s.messages.length > 1)];
    setSessions(nextSessions);
    setActiveSessionId(newId);
    setMessages(newSession.messages);
    persistSession(newSession, nextSessions);
  };

  /* ── Switch Chat ── */
  const switchSession = (sess) => {
    setActiveSessionId(sess.id);
    setMessages(sess.messages || [{ role:"ai", text:INITIAL_GREETING, ts: Date.now() }]);
    setHistoryDrawerOpen(false);
  };

  /* ── Delete Chat ── */
  const deleteSession = async (sessId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm("Delete this conversation?")) return;
    const nextSessions = sessions.filter(s => s.id !== sessId);
    setSessions(nextSessions);
    if (authUser?.uid) {
      try {
        localStorage.setItem(`studybuddy:chat_sessions:${authUser.uid}`, JSON.stringify(nextSessions));
        await remove(ref(db, `users/${authUser.uid}/ai_chats/${sessId}`));
      } catch {}
    }

    if (activeSessionId === sessId) {
      if (nextSessions.length > 0) {
        setActiveSessionId(nextSessions[0].id);
        setMessages(nextSessions[0].messages || []);
      } else {
        createNewChat();
      }
    }
  };

  /* ── Auto scroll ── */
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, aiLoading]);

  const flushAiStats = useCallback(async () => {
    if (!authUser?.uid || !sessionStartRef.current) return;
    const now = Date.now();
    const studyMs = Math.max(0, now - sessionStartRef.current);
    const aiQuestions = aiQuestionsRef.current;
    if (studyMs < 1000 && aiQuestions === 0) return;

    sessionStartRef.current = now;
    aiQuestionsRef.current = 0;
    await flushUsageStats(db, authUser.uid, { studyMs, aiQuestions, solvedProblems: 0 });
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid || authLoading) return;
    if (!sessionStartRef.current) sessionStartRef.current = Date.now();
    flushPendingUsageStats(db, authUser.uid);
  }, [authUser?.uid, authLoading]);

  useEffect(() => {
    if (!authUser?.uid || authLoading) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushAiStats();
      } else if (!sessionStartRef.current) {
        sessionStartRef.current = Date.now();
      }
    };

    const onPageHide = () => { flushAiStats(); };
    const onBeforeUnload = () => { flushAiStats(); };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushAiStats();
    };
  }, [authUser?.uid, authLoading, flushAiStats]);

  /* ── Load subjects when import sheet opens ── */
  useEffect(() => {
    if (!importOpen || !userData?.branch || !userData?.sem) return;
    const { branch, sem } = userData;
    const semKey = normaliseSem(sem);
    setImportLoading(true);

    if (importListenerRef.current) { importListenerRef.current(); importListenerRef.current = null; }

    const subRef = ref(db, `notes/${branch}/${semKey}/subjects`);
    const unsub  = onValue(subRef, (snap) => {
      setImportLoading(false);
      if (!snap.exists()) { setImportSubjects({}); return; }
      const raw = snap.val();
      const normalised = {};
      Object.entries(raw).forEach(([code, val]) => {
        if (val === true) normalised[code] = { Subject:code, Totalmodules:0, modules:{} };
        else if (typeof val === "object" && val !== null) normalised[code] = val;
      });
      setImportSubjects(normalised);
      if (!importActiveSub) setImportActiveSub(Object.keys(normalised)[0] || null);
    }, () => setImportLoading(false));

    importListenerRef.current = unsub;
    return () => { unsub(); importListenerRef.current = null; };
  }, [importOpen, userData?.branch, userData?.sem, normaliseSem]);

  /* ── Send message ── */
  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || aiLoading) return;

    // Handle "/" command for tools
    if (msg.startsWith("/")) {
      const toolCmd = msg.slice(1).toLowerCase();
      const tool = TOOLS.find(t => t.name.toLowerCase().includes(toolCmd) || t.id === toolCmd);
      if (tool) {
        setActiveTool(tool.id);
        setInput("");
        return;
      }
    }

    setInput("");
    const userMsg = { role:"user", text:msg, ts:Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    aiQuestionsRef.current += 1;
    setAiLoading(true);

    // Determine session ID or create one
    let currSessionId = activeSessionId;
    if (!currSessionId) {
      currSessionId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      setActiveSessionId(currSessionId);
    }

    try {
      const toolPrefix = activeTool ? `Use the ${TOOLS.find(t => t.id === activeTool)?.name} approach. ` : "";
      const systemPrompt = importedMod
        ? `You are Neural AI — an expert engineering exam assistant.
The student is studying: "${importedMod.title}" from subject "${importedMod.subject}", semester "${userData?.sem}".
${toolPrefix}Give focused, structured, exam-oriented answers. Format clearly with headings (##), bullet points, and code/math blocks where helpful. Be concise unless asked to elaborate.`
        : `You are Neural AI — an expert engineering exam assistant for university students.
The student's branch is "${userData?.branch || "Engineering"}", semester "${userData?.sem || "N/A"}".
${toolPrefix}Give focused, structured, exam-oriented answers. Format clearly with headings (##), bullet points, and code/math blocks where helpful. Be concise unless asked to elaborate.`;

      // Build conversation history for Groq
      const historyPayload = [
        { role: "system", content: systemPrompt },
        ...nextMessages.slice(-10).map(m => ({
          role: m.role === "ai" ? "assistant" : "user",
          content: m.text,
        })),
      ];

      const reply = await callGroqChat({ messages: historyPayload, max_tokens: 1500 });
      const aiMsg = { role:"ai", text:reply, ts:Date.now() };
      const finalMessages = [...nextMessages, aiMsg];
      setMessages(finalMessages);

      // Title generation from first prompt
      const title = userMsg.text.length > 38 ? userMsg.text.slice(0, 38) + "…" : userMsg.text;
      const updatedSess = {
        id: currSessionId,
        title: sessions.find(s => s.id === currSessionId)?.title !== "New Conversation" && sessions.find(s => s.id === currSessionId)?.title
          ? sessions.find(s => s.id === currSessionId).title
          : title,
        updatedAt: Date.now(),
        messages: finalMessages,
      };

      const updatedSessions = [
        updatedSess,
        ...sessions.filter(s => s.id !== currSessionId),
      ];
      setSessions(updatedSessions);
      persistSession(updatedSess, updatedSessions);
    } catch (err) {
      const errorMsg = { role:"ai", text:"⚠️ Network error — unable to reach AI service. Please try again.", ts:Date.now() };
      setMessages(p => [...p, errorMsg]);
    }
    setAiLoading(false);
  };

  const importModule = (sub, modKey, mod) => {
    setImportedMod({ subject:sub, modKey, title:mod.Title || modKey });
    setImportOpen(false);
    setMessages(p => [...p, {
      role:"ai",
      text:`Module imported: **${mod.Title || modKey}** from **${sub}**\n\nI'm now focused on this topic. Ask me anything — summaries, exam questions, concept explanations, or practice problems!`,
      ts:Date.now()
    }]);
  };

  /* ── Colors (matching Design System) ── */
  const bg      = isDark ? "#080f1a"                : "#f5f8f5";
  const sidebar = isDark ? "rgba(8,15,26,0.96)"     : "rgba(255,255,255,0.75)";
  const header  = isDark ? "rgba(8,15,26,0.92)"     : "rgba(255,255,255,0.75)";
  const card    = isDark ? "rgba(15,23,42,0.85)"    : "#ffffff";
  const panel   = isDark ? "rgba(8,15,26,0.98)"     : "rgba(255,255,255,0.98)";
  const text1   = isDark ? "#f1f5f9"                : "#0f172a";
  const text2   = isDark ? "#94a3b8"                : "#475569";
  const text3   = isDark ? "#475569"                : "#94a3b8";
  const bdr     = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

  const fullName  = userData?.name || authUser?.displayName || "";
  const firstName = fullName.split(" ")[0] || "";
  const branch    = userData?.branch || "";
  const sem       = userData?.sem    || "";

  const activeModules = importActiveSub && importSubjects[importActiveSub]?.modules
    ? Object.entries(importSubjects[importActiveSub].modules).map(([k, v]) => ({ key:k, ...v }))
    : [];

  const fmtTime = (ts) => {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  };

  const fmtDate = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    }
    return d.toLocaleDateString([], { month:"short", day:"numeric" });
  };

  const AvatarEl = ({ size = 36 }) => {
    const photo = userData?.photoURL || authUser?.photoURL;
    if (photo) {
      return (
        <img
          src={photo}
          alt={fullName || "User"}
          style={{ width:`${size}px`, height:`${size}px`, borderRadius:"9999px", objectFit:"cover", border:"2px solid #00FF00", flexShrink:0 }}
        />
      );
    }
    const initial = (fullName || "U").charAt(0).toUpperCase();
    return (
      <div style={{ width:`${size}px`, height:`${size}px`, borderRadius:"9999px", background:"#00FF00", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:`${Math.round(size*0.4)}px`, color:"#0f172a", flexShrink:0, boxShadow:"0 0 12px rgba(0,255,0,0.3)" }}>
        {initial}
      </div>
    );
  };

  if (authLoading) {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:bg }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
          <div style={{ width:"36px", height:"36px", border:"3px solid rgba(0,255,0,0.2)", borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.8s linear infinite" }} />
          <p style={{ fontFamily:"'Lexend',sans-serif", fontSize:"13px", color:text2, margin:0 }}>Loading Neural AI…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700;800&family=Fira+Code:wght@400;500;600&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');

        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${bg};color:${text1};font-family:'Lexend',sans-serif;-webkit-font-smoothing:antialiased;}
        .ms{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:20px;line-height:1;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;-webkit-font-feature-settings:'liga';-webkit-font-smoothing:antialiased;}

        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes msgPop{from{opacity:0;transform:translateY(8px) scale(0.98);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes glow{0%,100%{box-shadow:0 0 16px rgba(0,255,0,0.35);}50%{box-shadow:0 0 28px rgba(0,255,0,0.65);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes overlayIn{from{opacity:0;}to{opacity:1;}}
        @keyframes slideInRight{from{transform:translateX(100%);}to{transform:translateX(0);}}
        @keyframes slideInLeft{from{transform:translateX(-100%);}to{transform:translateX(0);}}

        .sb-root{display:flex;height:100vh;overflow:hidden;background:${bg};position:relative;}

        /* ── Sidebar ── */
        .sb-sidebar{width:260px;min-width:260px;height:100vh;background:${sidebar};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-right:1px solid ${bdr};display:flex;flex-direction:column;padding:24px 20px;z-index:20;transition:width 0.3s,min-width 0.3s;}
        .sb-sidebar.collapsed{width:72px;min-width:72px;}
        .sb-sidebar.collapsed .sl{display:none;}
        .nav-link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9999px;font-size:13px;font-weight:600;color:${text2};transition:all 0.2s;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:'Lexend',sans-serif;}
        .nav-link:hover{background:rgba(0,200,0,0.08);color:${text1};}
        .nav-link.active{background:#00FF00;color:#0f172a;box-shadow:0 6px 20px rgba(0,255,0,0.28);}
        .nav-link.active .ms{color:#0f172a;}
        .nav-link.danger{color:#f87171;}
        .nav-link.danger:hover{background:rgba(248,113,113,0.1);}

        /* ── Main area ── */
        .sb-main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;}

        /* ── Desktop header ── */
        .sb-header{height:72px;background:${header};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 32px;display:flex;align-items:center;justify-content:space-between;z-index:10;flex-shrink:0;}

        /* ── Mobile header ── */
        .mob-header{display:none;height:64px;background:${header};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 16px;align-items:center;justify-content:space-between;gap:10px;z-index:10;flex-shrink:0;}

        /* ── Chat area ── */
        .chat-scroll{flex:1;overflow-y:auto;padding:28px 32px;display:flex;flex-direction:column;gap:20px;}
        .chat-scroll::-webkit-scrollbar{width:4px;}
        .chat-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.18);border-radius:2px;}

        /* ── Messages ── */
        .msg-ai{display:flex;gap:14px;animation:msgPop 0.28s cubic-bezier(0.34,1.56,0.64,1) both;}
        .msg-user{display:flex;gap:14px;flex-direction:row-reverse;animation:msgPop 0.28s cubic-bezier(0.34,1.56,0.64,1) both;}
        .bubble-ai{background:${card};border:1px solid ${bdr};border-radius:20px;border-top-left-radius:4px;padding:16px 20px;font-size:13px;line-height:1.75;color:${text1};max-width:76%;box-shadow:${isDark?"none":"0 2px 12px rgba(0,0,0,0.04)"};}
        .bubble-user{background:#00FF00;border-radius:20px;border-top-right-radius:4px;padding:14px 18px;font-size:13px;font-weight:600;color:#0f172a;max-width:76%;box-shadow:0 6px 20px rgba(0,255,0,0.25);line-height:1.65;}

        /* ── Input area ── */
        .input-wrap{padding:0 32px 24px;flex-shrink:0;}
        .input-shell{background:${card};border:1.5px solid ${bdr};border-radius:20px;overflow:hidden;transition:border-color 0.2s,box-shadow 0.2s;}
        .input-shell:focus-within{border-color:rgba(0,255,0,0.45);box-shadow:0 0 0 3px rgba(0,255,0,0.08);}
        .chat-input{background:transparent;border:none;outline:none;resize:none;width:100%;font-size:13px;font-family:'Lexend',sans-serif;color:${text1};line-height:1.6;padding:16px 20px 0;}
        .chat-input::placeholder{color:${text3};}

        /* ── Suggestion chips ── */
        .chip{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:9999px;border:1px solid ${bdr};background:${card};font-size:11px;font-weight:700;color:${text2};cursor:pointer;transition:all 0.18s;font-family:'Lexend',sans-serif;white-space:nowrap;}
        .chip:hover{background:rgba(0,200,0,0.09);border-color:rgba(0,200,0,0.3);color:${text1};}

        /* ── Buttons ── */
        .btn-action{display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:9999px;border:1.5px solid ${bdr};background:${isDark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.03)"};font-size:12px;font-weight:700;color:${text2};cursor:pointer;transition:all 0.2s;font-family:'Lexend',sans-serif;white-space:nowrap;}
        .btn-action:hover{background:rgba(0,200,0,0.1);color:#00CC00;border-color:rgba(0,200,0,0.3);}
        .btn-action.highlight{background:#00FF00;color:#0f172a;border-color:#00FF00;box-shadow:0 2px 10px rgba(0,255,0,0.25);}
        .btn-action.highlight:hover{background:#00ee00;transform:scale(1.02);}

        .btn-import{display:flex;align-items:center;gap:7px;padding:9px 16px;border-radius:9999px;border:1.5px solid rgba(0,200,0,0.3);background:rgba(0,200,0,0.07);font-size:12px;font-weight:700;color:#00AA00;cursor:pointer;transition:all 0.2s;font-family:'Lexend',sans-serif;white-space:nowrap;}
        .btn-import:hover{background:#00FF00;color:#0f172a;border-color:#00FF00;}
        .btn-import.active{background:#00FF00;color:#0f172a;border-color:#00FF00;animation:glow 2s ease-in-out infinite;}

        /* ── Send button ── */
        .btn-send{width:40px;height:40px;border-radius:12px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;flex-shrink:0;}
        .btn-send.ready{background:#00FF00;box-shadow:0 4px 14px rgba(0,255,0,0.35);}
        .btn-send.ready:hover{transform:scale(1.08);}
        .btn-send.empty{background:${isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)"};cursor:not-allowed;}

        /* ── AI typing dots ── */
        .typing-dot{width:7px;height:7px;border-radius:9999px;background:#00CC00;animation:pulse 1s ease-in-out infinite;}

        /* ── Overlay ── */
        .sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;backdrop-filter:blur(8px);animation:overlayIn 0.22s ease both;}

        /* ── Import & History Panel ── */
        .side-drawer{position:fixed;right:0;top:0;bottom:0;width:440px;max-width:100vw;background:${panel};border-left:1px solid ${bdr};display:flex;flex-direction:column;z-index:201;box-shadow:-24px 0 80px rgba(0,0,0,0.25);animation:slideInRight 0.32s cubic-bezier(0.32,0.72,0,1) both;}

        /* ── History item ── */
        .session-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid ${bdr};background:${card};cursor:pointer;transition:all 0.18s;font-family:'Lexend',sans-serif;}
        .session-item:hover{border-color:rgba(0,255,0,0.35);background:${isDark?"rgba(0,255,0,0.04)":"rgba(0,200,0,0.03)"};}
        .session-item.active{border-color:#00FF00;background:${isDark?"rgba(0,255,0,0.08)":"rgba(0,200,0,0.07)"};}

        .tool-pill{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:9999px;border:1px solid ${bdr};background:${card};font-size:11px;font-weight:600;color:${text2};cursor:pointer;transition:all 0.18s;white-space:nowrap;}
        .tool-pill:hover{background:rgba(0,200,0,0.08);border-color:rgba(0,200,0,0.3);color:${text1};}
        .tool-pill.active{background:#00FF00;color:#0f172a;border-color:#00FF00;}
        .tools-scroll{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;}
        .tools-scroll::-webkit-scrollbar{height:3px;}
        .tools-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}

        /* ── Subject tabs inside import panel ── */
        .sub-tab{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:12px;border:1.5px solid ${bdr};background:${card};cursor:pointer;transition:all 0.18s;font-family:'Lexend',sans-serif;-webkit-tap-highlight-color:transparent;}
        .sub-tab.active{border-color:#00FF00;background:${isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)"};}
        .sub-tab:hover:not(.active){background:rgba(0,200,0,0.05);}

        /* ── Module item in import panel ── */
        .mod-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:14px;border:1px solid ${bdr};background:${card};transition:all 0.18s;}
        .mod-item:hover{border-color:rgba(0,200,0,0.3);background:${isDark?"rgba(0,255,0,0.03)":"rgba(0,200,0,0.03)"};}

        /* ── Mobile nav ── */
        .mob-nav{display:none;position:fixed;bottom:0;left:0;right:0;height:64px;background:${header};backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-top:1px solid ${bdr};padding:0 8px;align-items:center;justify-content:space-around;z-index:100;}
        .mob-tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px 12px;border-radius:12px;border:none;background:none;color:${text3};cursor:pointer;}
        .mob-tab.active{color:#00CC00;}

        @media(max-width:768px){
          .sb-sidebar{display:none;}
          .sb-header{display:none;}
          .mob-header{display:flex;}
          .mob-nav{display:flex;}
          .input-wrap{padding:0 16px 80px;}
          .chat-scroll{padding:16px 16px 12px;}
          .bubble-ai, .bubble-user{max-width:88%;}
          .side-drawer{width:100vw;}
        }
      `}</style>

      <div className="sb-root">

        {/* ══ SIDEBAR ══ */}
        <aside className={`sb-sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"28px", padding:"0 4px" }}>
            <div style={{ width:"40px", height:"40px", background:"#00FF00", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 0 16px rgba(0,255,0,0.35)" }}>
              <span className="ms" style={{ color:"#0f172a", fontSize:"22px" }}>psychology</span>
            </div>
            <div className="sl">
              <h1 style={{ fontSize:"1.1rem", fontWeight:700, letterSpacing:"-0.04em", color:text1, lineHeight:1 }}>Neural AI</h1>
              <p style={{ fontSize:"10px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.12em", marginTop:"3px" }}>Study Assistant</p>
            </div>
          </div>

          {/* Quick New Chat Button */}
          <div className="sl" style={{ marginBottom:"18px" }}>
            <button
              onClick={createNewChat}
              style={{
                width:"100%",
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                gap:"8px",
                padding:"10px 16px",
                borderRadius:"12px",
                background:"#00FF00",
                color:"#0f172a",
                border:"none",
                fontWeight:700,
                fontSize:"12.5px",
                cursor:"pointer",
                boxShadow:"0 4px 14px rgba(0,255,0,0.25)",
                transition:"transform 0.2s, box-shadow 0.2s",
                fontFamily:"'Lexend',sans-serif",
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"}
              onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
            >
              <span className="ms" style={{ fontSize:"18px" }}>add</span>
              New Chat
            </button>
          </div>

          <nav style={{ flex:1, display:"flex", flexDirection:"column", gap:"4px", overflowY:"auto" }}>
            {NAV_ITEMS.slice(0, 4).map(({ id, icon, label, href }) => (
              <button key={id} className={`nav-link${id==="ai"?" active":""}`} onClick={() => router.push(href)}>
                <span className="ms" style={{ fontSize:"20px", flexShrink:0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}

            <button className="nav-link" onClick={() => setHistoryDrawerOpen(true)}>
              <span className="ms" style={{ fontSize:"20px", flexShrink:0 }}>history</span>
              <span className="sl">Chat History</span>
              {sessions.length > 0 && (
                <span className="sl" style={{ marginLeft:"auto", fontSize:"10px", background:isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)", padding:"2px 7px", borderRadius:"9999px" }}>
                  {sessions.length}
                </span>
              )}
            </button>

            <div style={{ padding:"16px 4px 8px", fontSize:"10px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em" }} className="sl">Account</div>
            {NAV_ITEMS.slice(4).map(({ id, icon, label, href }) => (
              <button key={id} className="nav-link" onClick={() => router.push(href)}>
                <span className="ms" style={{ fontSize:"20px", flexShrink:0 }}>{icon}</span>
                <span className="sl">{label}</span>
              </button>
            ))}
            <button className="nav-link danger" onClick={() => logoutAndClearCache(auth).then(() => router.replace("/"))}>
              <span className="ms" style={{ fontSize:"20px", flexShrink:0 }}>logout</span>
              <span className="sl">Sign Out</span>
            </button>
          </nav>

          {/* Sidebar footer — imported module context */}
          {importedMod && (
            <div className="sl" style={{ marginTop:"16px", padding:"14px", borderRadius:"14px", background:isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)", border:`1px solid ${bdr}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"6px" }}>
                <div style={{ width:"6px", height:"6px", borderRadius:"9999px", background:"#00FF00", boxShadow:"0 0 6px rgba(0,255,0,0.8)" }} />
                <span style={{ fontSize:"9px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.1em" }}>Active Context</span>
              </div>
              <p style={{ fontSize:"11px", fontWeight:700, color:text1, margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{importedMod.title}</p>
              <p style={{ fontSize:"10px", color:text2, margin:0 }}>{importedMod.subject}</p>
              <button onClick={() => setImportedMod(null)} style={{ marginTop:"8px", display:"flex", alignItems:"center", gap:"4px", background:"none", border:"none", cursor:"pointer", color:text3, fontSize:"10px", fontFamily:"'Lexend',sans-serif", fontWeight:600 }}>
                <span className="ms" style={{ fontSize:"13px" }}>close</span>
                Clear context
              </button>
            </div>
          )}
        </aside>

        {/* ══ MAIN ══ */}
        <main className="sb-main">

          {/* ── Desktop header ── */}
          <header className="sb-header">
            <div style={{ display:"flex", alignItems:"center", gap:"16px", flex:1 }}>
              <button
                onClick={() => setSidebarOpen(s => !s)}
                style={{ background:isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)", border:"none", borderRadius:"9999px", width:"36px", height:"36px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, transition:"background 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background=isDark?"rgba(255,255,255,0.1)":"rgba(0,200,0,0.14)"}
                onMouseLeave={e => e.currentTarget.style.background=isDark?"rgba(255,255,255,0.06)":"rgba(0,200,0,0.08)"}
              >
                <span className="ms" style={{ fontSize:"20px", color:text2 }}>menu</span>
              </button>

              {/* Title + context */}
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <h2 style={{ fontSize:"16px", fontWeight:700, color:text1, margin:0, letterSpacing:"-0.02em" }}>Neural AI</h2>
                  <span style={{ display:"flex", alignItems:"center", gap:"5px", padding:"2px 10px", borderRadius:"9999px", background:"rgba(0,200,0,0.1)", border:`1px solid ${bdr}` }}>
                    <div style={{ width:"5px", height:"5px", borderRadius:"9999px", background:"#00FF00", animation:"pulse 2s ease-in-out infinite" }} />
                    <span style={{ fontSize:"9px", fontWeight:700, color:"#00AA00", textTransform:"uppercase", letterSpacing:"0.1em" }}>Online (Groq 120B)</span>
                  </span>
                </div>
                {importedMod
                  ? <p style={{ fontSize:"11px", color:"#009900", fontWeight:600, margin:0, marginTop:"1px" }}>
                      {importedMod.subject} · {importedMod.title}
                    </p>
                  : <p style={{ fontSize:"11px", color:text3, margin:0, marginTop:"1px" }}>
                      {branch || "Engineering"}{sem ? ` · ${sem}` : ""}
                    </p>
                }
              </div>
            </div>

            <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
              <button
                className="btn-action highlight"
                onClick={createNewChat}
                title="Start a fresh chat"
              >
                <span className="ms" style={{ fontSize:"16px" }}>add</span>
                New Chat
              </button>

              <button
                className="btn-action"
                onClick={() => setHistoryDrawerOpen(true)}
                title="Open past chat history"
              >
                <span className="ms" style={{ fontSize:"16px" }}>history</span>
                History
                {sessions.length > 0 && <span style={{ fontSize:"11px", opacity:0.8 }}>({sessions.length})</span>}
              </button>

              <div style={{ width:"1px", height:"24px", background:bdr, margin:"0 4px" }} />

              <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />
              <div style={{ width:"1px", height:"32px", background:bdr }} />
              <div style={{ display:"flex", alignItems:"center", gap:"10px", cursor:"pointer" }} onClick={() => router.push("/profile")}>
                <div style={{ textAlign:"right" }}>
                  <p style={{ fontSize:"12px", fontWeight:700, color:text1, lineHeight:1, margin:0 }}>{fullName||"—"}</p>
                  <p style={{ fontSize:"10px", color:text3, fontWeight:500, margin:"2px 0 0" }}>{branch||"No branch"}{sem?` · ${sem}`:""}</p>
                </div>
                <AvatarEl size={40} />
              </div>
            </div>
          </header>

          {/* ── Mobile header ── */}
          <header className="mob-header">
            <div style={{ display:"flex", alignItems:"center", gap:"8px", minWidth:0, flex:1 }}>
              <div style={{ width:"34px", height:"34px", background:"#00FF00", borderRadius:"9px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 12px rgba(0,255,0,0.4)", flexShrink:0 }}>
                <span className="ms" style={{ color:"#0f172a", fontSize:"18px" }}>psychology</span>
              </div>
              <div style={{ minWidth:0 }}>
                <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>Neural AI</p>
                {importedMod && <p style={{ fontSize:"10px", color:"#009900", fontWeight:600, margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{importedMod.title}</p>}
              </div>
            </div>

            <div style={{ display:"flex", alignItems:"center", gap:"6px", flexShrink:0 }}>
              <button
                onClick={createNewChat}
                style={{ width:"32px", height:"32px", borderRadius:"8px", background:"#00FF00", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
                title="New Chat"
              >
                <span className="ms" style={{ fontSize:"18px", color:"#0f172a" }}>add</span>
              </button>

              <button
                onClick={() => setHistoryDrawerOpen(true)}
                style={{ width:"32px", height:"32px", borderRadius:"8px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", border:`1px solid ${bdr}`, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
                title="Chat History"
              >
                <span className="ms" style={{ fontSize:"18px", color:text2 }}>history</span>
              </button>

              <button onClick={() => router.push("/profile")} style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}>
                <AvatarEl size={32} />
              </button>
            </div>
          </header>

          {/* ══ CHAT MESSAGES ══ */}
          <div className="chat-scroll">

            {messages.map((msg, i) => (
              <div key={i} className={msg.role === "ai" ? "msg-ai" : "msg-user"} style={{ animationDelay:`${Math.min(i * 0.05, 0.3)}s` }}>

                {/* Avatar */}
                {msg.role === "ai" ? (
                  <div style={{ width:"36px", height:"36px", borderRadius:"10px", background:isDark?"rgba(0,255,0,0.12)":"rgba(0,200,0,0.1)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:"2px" }}>
                    <span className="ms" style={{ fontSize:"20px", color:"#00CC00" }}>psychology</span>
                  </div>
                ) : (
                  <div style={{ flexShrink:0, marginTop:"2px" }}>
                    <AvatarEl size={36} />
                  </div>
                )}

                {/* Bubble */}
                <div style={{ display:"flex", flexDirection:"column", gap:"5px", alignItems: msg.role==="user"?"flex-end":"flex-start", maxWidth:"76%" }}>
                  <span style={{ fontSize:"10px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em", paddingLeft: msg.role==="ai"?"4px":"0", paddingRight: msg.role==="user"?"4px":"0" }}>
                    {msg.role === "ai" ? "Neural AI" : (firstName || "You")}
                  </span>
                  <div className={msg.role === "ai" ? "bubble-ai" : "bubble-user"}>
                    {msg.role === "ai" ? (
                      <MarkdownText text={msg.text} isDark={isDark} />
                    ) : (
                      <span style={{ whiteSpace:"pre-wrap" }}>{msg.text}</span>
                    )}
                  </div>
                  <span style={{ fontSize:"10px", color:text3 }}>{fmtTime(msg.ts)}</span>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {aiLoading && (
              <div className="msg-ai">
                <div style={{ width:"36px", height:"36px", borderRadius:"10px", background:isDark?"rgba(0,255,0,0.12)":"rgba(0,200,0,0.1)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <span className="ms" style={{ fontSize:"20px", color:"#00CC00" }}>psychology</span>
                </div>
                <div className="bubble-ai" style={{ display:"flex", alignItems:"center", gap:"7px", padding:"16px 20px" }}>
                  {[0,1,2].map(i => <div key={i} className="typing-dot" style={{ animationDelay:`${i*0.18}s` }} />)}
                </div>
              </div>
            )}

            {/* Suggestions — only on fresh start */}
            {messages.length === 1 && !aiLoading && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:"8px", animation:"fadeUp 0.4s 0.2s ease both", opacity:0, animationFillMode:"forwards" }}>
                {SUGGESTIONS.map(s => (
                  <button key={s.label} className="chip" onClick={() => send(s.label)}>
                    <span className="ms" style={{ fontSize:"16px", color:"#00CC00" }}>{s.icon}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ══ INPUT AREA ══ */}
          <div className="input-wrap">
            {/* Imported module pill */}
            {importedMod && (
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px", padding:"8px 14px", borderRadius:"12px", background:isDark?"rgba(0,255,0,0.07)":"rgba(0,200,0,0.06)", border:`1px solid ${bdr}` }}>
                <span className="ms" style={{ fontSize:"14px", color:"#00CC00" }}>library_books</span>
                <span style={{ fontSize:"11px", fontWeight:700, color:"#009900", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {importedMod.subject} · {importedMod.title}
                </span>
                <button onClick={() => setImportedMod(null)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
                  <span className="ms" style={{ fontSize:"14px", color:text3 }}>close</span>
                </button>
              </div>
            )}

            {/* Active tool pill */}
            {activeTool && (
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px", padding:"8px 14px", borderRadius:"12px", background:"rgba(0,255,0,0.1)", border:`1px solid rgba(0,255,0,0.3)` }}>
                <span className="ms" style={{ fontSize:"14px", color:"#00FF00" }}>star</span>
                <span style={{ fontSize:"11px", fontWeight:700, color:"#00FF00", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  Tool: {TOOLS.find(t => t.id === activeTool)?.name}
                </span>
                <button onClick={() => setActiveTool(null)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
                  <span className="ms" style={{ fontSize:"14px", color:"#00FF00" }}>close</span>
                </button>
              </div>
            )}

            {/* Tools panel */}
            {toolsOpen && (
              <div style={{ marginBottom:"10px", padding:"10px 12px", borderRadius:"12px", background:isDark?"rgba(0,255,0,0.04)":"rgba(0,200,0,0.03)", border:`1px solid ${bdr}` }}>
                <div className="tools-scroll">
                  {TOOLS.map(tool => (
                    <button
                      key={tool.id}
                      className={`tool-pill${activeTool === tool.id ? " active" : ""}`}
                      onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
                      title={tool.desc}
                    >
                      <span className="ms" style={{ fontSize:"13px" }}>{tool.icon}</span>
                      {tool.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-shell">
              {/* Toolbar row */}
              <div style={{ display:"flex", alignItems:"center", gap:"6px", padding:"10px 14px 8px", borderBottom:`1px solid ${bdr}`, flexWrap:"wrap" }}>
                <button className={`btn-import${importedMod?" active":""}`} onClick={() => setImportOpen(true)}>
                  <span className="ms" style={{ fontSize:"14px" }}>import_contacts</span>
                  {importedMod ? "Module" : "Import"}
                </button>
                <button 
                  onClick={() => setToolsOpen(!toolsOpen)}
                  style={{ display:"flex", alignItems:"center", gap:"6px", padding:"8px 12px", borderRadius:"9999px", border:`1.5px solid ${bdr}`, background:toolsOpen?"rgba(0,255,0,0.12)":"transparent", fontSize:"12px", fontWeight:700, color:toolsOpen?"#00FF00":text2, cursor:"pointer", transition:"all 0.2s", fontFamily:"'Lexend',sans-serif", whiteSpace:"nowrap" }}
                >
                  <span className="ms" style={{ fontSize:"14px" }}>tune</span>
                  Tools
                </button>
                <div style={{ flex:1 }} />
                <span style={{ fontSize:"10px", color:text3, fontWeight:600 }}>Enter to send · Shift+Enter for newline</span>
              </div>

              {/* Text + send */}
              <div style={{ display:"flex", alignItems:"flex-end", gap:"10px", padding:"6px 14px 14px" }}>
                <textarea
                  className="chat-input"
                  rows={2}
                  placeholder={importedMod ? `Ask about "${importedMod.title}"…` : "Ask anything about your coursework…"}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                <button
                  className={`btn-send${input.trim() && !aiLoading ? " ready" : " empty"}`}
                  onClick={() => send()}
                  disabled={!input.trim() || aiLoading}
                >
                  <span className="ms" style={{ fontSize:"20px", color: input.trim() && !aiLoading ? "#0f172a" : text3 }}>
                    {aiLoading ? "hourglass_top" : "send"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ══ MOBILE BOTTOM NAV ══ */}
      <nav className="mob-nav">
        {NAV_ITEMS.slice(0, 4).map(({ id, icon, href }) => (
          <button key={id} className={`mob-tab${id==="ai"?" active":""}`} onClick={() => router.push(href)}>
            <span className="ms">{icon}</span>
          </button>
        ))}
        <button className="mob-tab" onClick={() => router.push("/profile")}>
          <span className="ms">person</span>
        </button>
      </nav>

      {/* ══ CHAT HISTORY DRAWER ══ */}
      {historyDrawerOpen && (
        <>
          <div className="sheet-overlay" onClick={() => setHistoryDrawerOpen(false)} />
          <div className="side-drawer">
            {/* Header */}
            <div style={{ padding:"16px 20px", borderBottom:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                <div style={{ width:"36px", height:"36px", borderRadius:"10px", background:"rgba(0,200,0,0.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span className="ms" style={{ fontSize:"20px", color:"#00CC00" }}>history</span>
                </div>
                <div>
                  <h3 style={{ fontSize:"15px", fontWeight:700, color:text1, margin:0 }}>Chat History</h3>
                  <p style={{ fontSize:"11px", color:text2, margin:0 }}>{sessions.length} saved sessions</p>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                <button
                  onClick={createNewChat}
                  style={{ display:"flex", alignItems:"center", gap:"4px", padding:"6px 12px", borderRadius:"8px", background:"#00FF00", border:"none", color:"#0f172a", fontSize:"11.5px", fontWeight:700, cursor:"pointer" }}
                >
                  <span className="ms" style={{ fontSize:"15px" }}>add</span>
                  New
                </button>
                <button onClick={() => setHistoryDrawerOpen(false)} style={{ width:"32px", height:"32px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span className="ms" style={{ fontSize:"18px", color:text2 }}>close</span>
                </button>
              </div>
            </div>

            {/* List */}
            <div style={{ flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:"8px" }}>
              {sessions.length === 0 ? (
                <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px", opacity:0.6 }}>
                  <span className="ms" style={{ fontSize:"40px", color:text3 }}>chat_bubble_outline</span>
                  <p style={{ fontSize:"13px", color:text2 }}>No chat history yet</p>
                </div>
              ) : (
                sessions.map(sess => {
                  const isActive = sess.id === activeSessionId;
                  const count = sess.messages ? sess.messages.length : 0;
                  return (
                    <div
                      key={sess.id}
                      className={`session-item${isActive ? " active" : ""}`}
                      onClick={() => switchSession(sess)}
                    >
                      <div style={{ minWidth:0, flex:1 }}>
                        <p style={{ fontSize:"12.5px", fontWeight:isActive ? 700 : 600, color:isActive ? (isDark?"#00FF00":"#007700") : text1, margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {sess.title || "Untitled Chat"}
                        </p>
                        <p style={{ fontSize:"10.5px", color:text3, margin:"3px 0 0" }}>
                          {fmtDate(sess.updatedAt)} · {count} {count === 1 ? "msg" : "msgs"}
                        </p>
                      </div>

                      <button
                        onClick={(e) => deleteSession(sess.id, e)}
                        style={{ width:"28px", height:"28px", borderRadius:"8px", background:"none", border:"none", color:text3, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}
                        title="Delete conversation"
                        onMouseEnter={e => { e.currentTarget.style.color="#ef4444"; e.currentTarget.style.background="rgba(239,68,68,0.1)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color=text3; e.currentTarget.style.background="none"; }}
                      >
                        <span className="ms" style={{ fontSize:"16px" }}>delete</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* ══ IMPORT MODULE PANEL ══ */}
      {importOpen && (
        <>
          <div className="sheet-overlay" onClick={() => setImportOpen(false)} />
          <div className="side-drawer">

            {/* Drag handle (mobile) */}
            <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 4px", flexShrink:0 }}>
              <div style={{ width:"36px", height:"4px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.1)" }} />
            </div>

            {/* Panel header */}
            <div style={{ padding:"8px 20px 16px", borderBottom:`1px solid ${bdr}`, flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{ width:"38px", height:"38px", borderRadius:"11px", background:"rgba(0,200,0,0.1)", border:`1px solid ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <span className="ms" style={{ fontSize:"22px", color:"#00CC00" }}>import_contacts</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize:"15px", fontWeight:700, color:text1, margin:0 }}>Import Module</h3>
                    <p style={{ fontSize:"11px", color:text2, margin:0, marginTop:"1px" }}>
                      {branch && sem ? `${branch} · ${sem}` : "Select a module to set as context"}
                    </p>
                  </div>
                </div>
                <button onClick={() => setImportOpen(false)} style={{ width:"34px", height:"34px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span className="ms" style={{ fontSize:"20px", color:text2 }}>close</span>
                </button>
              </div>
            </div>

            {importLoading ? (
              <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:"14px" }}>
                <div style={{ width:"24px", height:"24px", border:`3px solid ${bdr}`, borderTopColor:"#00FF00", borderRadius:"9999px", animation:"spin 0.7s linear infinite" }} />
                <span style={{ fontSize:"13px", color:text2 }}>Loading subjects…</span>
              </div>
            ) : !branch || !sem ? (
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px", padding:"32px" }}>
                <span className="ms" style={{ fontSize:"48px", color:text3 }}>person_off</span>
                <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:0 }}>Branch/sem not set</p>
                <p style={{ fontSize:"12px", color:text2, margin:0, textAlign:"center" }}>Update your profile to load your subjects and modules.</p>
                <button onClick={() => { setImportOpen(false); router.push("/profile"); }} style={{ marginTop:"8px", padding:"10px 20px", borderRadius:"12px", background:"#00FF00", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:700, color:"#0f172a", fontFamily:"'Lexend',sans-serif" }}>
                  Go to Profile
                </button>
              </div>
            ) : Object.keys(importSubjects).length === 0 ? (
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px", padding:"32px", opacity:0.6 }}>
                <span className="ms" style={{ fontSize:"48px", color:text3 }}>folder_off</span>
                <p style={{ fontSize:"14px", fontWeight:700, color:text1, margin:0 }}>No subjects found</p>
              </div>
            ) : (
              <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

                {/* ── Left: Subject list ── */}
                <div style={{ width:"150px", minWidth:"150px", borderRight:`1px solid ${bdr}`, padding:"14px 10px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"6px" }}>
                  <p style={{ fontSize:"9px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em", padding:"0 6px 8px" }}>Subjects</p>
                  {Object.entries(importSubjects).map(([code, data]) => {
                    const { icon, color } = getSubjectMeta(code);
                    const label = typeof data?.Subject === "string" ? data.Subject : code;
                    const active = importActiveSub === code;
                    return (
                      <button
                        key={code}
                        className={`sub-tab${active ? " active" : ""}`}
                        onClick={() => setImportActiveSub(code)}
                      >
                        <div style={{ width:"28px", height:"28px", borderRadius:"8px", background:active?"rgba(0,255,0,0.15)":`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <span className="ms" style={{ fontSize:"16px", color:active?"#00CC00":color }}>{icon}</span>
                        </div>
                        <span style={{ fontSize:"11px", fontWeight:700, color:active?(isDark?"#00FF00":"#007700"):text1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* ── Right: Module list ── */}
                <div style={{ flex:1, padding:"14px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"8px" }}>
                  <p style={{ fontSize:"9px", fontWeight:700, color:text3, textTransform:"uppercase", letterSpacing:"0.12em", padding:"0 2px 8px" }}>
                    Modules — {importActiveSub}
                    <span style={{ marginLeft:"6px", padding:"1px 7px", borderRadius:"9999px", background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)", fontSize:"9px", fontWeight:700 }}>
                      {activeModules.length}
                    </span>
                  </p>

                  {activeModules.length === 0 ? (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"32px 16px", gap:"10px", opacity:0.5 }}>
                      <span className="ms" style={{ fontSize:"36px", color:text3 }}>folder_open</span>
                      <p style={{ fontSize:"12px", color:text2, margin:0 }}>No modules in this subject</p>
                    </div>
                  ) : activeModules.map((mod, i) => {
                    const isImported = importedMod?.subject === importActiveSub && importedMod?.modKey === mod.key;
                    return (
                      <div key={mod.key} className={`mod-item${isImported ? " imported" : ""}`} style={{ animationDelay:`${i*0.04}s`, animation:"fadeUp 0.3s ease both" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"12px", flex:1, minWidth:0 }}>
                          <div style={{ width:"38px", height:"38px", minWidth:"38px", borderRadius:"10px", background:isImported?"rgba(0,255,0,0.12)":(isDark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)"), display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <span className="ms" style={{ fontSize:"20px", color:isImported?"#00CC00":text3 }}>
                              {mod.resourcesPDF ? "picture_as_pdf" : "menu_book"}
                            </span>
                          </div>
                          <div style={{ minWidth:0, flex:1 }}>
                            <p style={{ fontSize:"12px", fontWeight:700, color:text1, margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              <span style={{ display:"inline-flex", alignItems:"center", marginRight:"6px", padding:"1px 6px", background:"rgba(0,200,0,0.1)", border:"1px solid rgba(0,200,0,0.2)", borderRadius:"9999px", fontSize:"9px", fontWeight:700, color:"#009900" }}>
                                {mod.key.replace("module","M")}
                              </span>
                              {mod.Title || "Untitled Module"}
                            </p>
                            <p style={{ fontSize:"10px", color:text3, margin:0 }}>
                              {isImported ? (
                                <span style={{ color:"#009900", fontWeight:700 }}>✓ Active context</span>
                              ) : "Click to set as context"}
                            </p>
                          </div>
                        </div>
                        {isImported ? (
                          <button
                            onClick={() => setImportedMod(null)}
                            style={{ padding:"7px 12px", borderRadius:"9px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", color:"#ef4444", fontSize:"11px", fontWeight:700, cursor:"pointer", fontFamily:"'Lexend',sans-serif", flexShrink:0, display:"flex", alignItems:"center", gap:"4px" }}
                          >
                            <span className="ms" style={{ fontSize:"14px" }}>close</span>
                            Remove
                          </button>
                        ) : (
                          <button
                            onClick={() => importModule(importActiveSub, mod.key, mod)}
                            style={{ padding:"7px 12px", borderRadius:"9px", background:"rgba(0,200,0,0.09)", border:"1px solid rgba(0,200,0,0.25)", color:"#009900", fontSize:"11px", fontWeight:700, cursor:"pointer", fontFamily:"'Lexend',sans-serif", flexShrink:0, display:"flex", alignItems:"center", gap:"4px", transition:"all 0.18s" }}
                            onMouseEnter={e => { e.currentTarget.style.background="#00FF00"; e.currentTarget.style.color="#0f172a"; }}
                            onMouseLeave={e => { e.currentTarget.style.background="rgba(0,200,0,0.09)"; e.currentTarget.style.color="#009900"; }}
                          >
                            <span className="ms" style={{ fontSize:"14px" }}>add</span>
                            Import
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
