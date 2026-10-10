"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref as dbRef, onValue, set, remove, get } from "firebase/database";
import { logoutAndClearCache } from "@/lib/logout";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "@/firebase";

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

function ThemeSwitcher({ theme, setTheme, resolved }) {
  const isDark = resolved === "dark";
  const opts = [
    { value:"light",  icon:"light_mode",     label:"Light"  },
    { value:"dark",   icon:"dark_mode",       label:"Dark"   },
    { value:"system", icon:"desktop_windows", label:"System" },
  ];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:"4px", padding:"5px", borderRadius:"9999px", background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border:`1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}` }}>
      {opts.map(({ value, icon, label }) => {
        const active = theme === value;
        return (
          <button key={value} onClick={() => setTheme(value)} title={label}
            style={{ display:"flex", alignItems:"center", gap:"6px", padding:"7px 14px", borderRadius:"9999px", border:"none", cursor:"pointer", fontFamily:"'Lexend',sans-serif", fontSize:"12px", fontWeight:700, background: active ? (isDark ? "rgba(0,255,0,0.18)" : "#00FF00") : "transparent", color: active ? (isDark ? "#00FF00" : "#0f172a") : (isDark ? "#64748b" : "#94a3b8") }}
          >
            <span className="ms" style={{ fontSize:"15px" }}>{icon}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [authUser, setAuthUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  
  const [selectedBranch, setSelectedBranch] = useState("All");
  const [selectedSem, setSelectedSem] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [undoAction, setUndoAction] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editForm, setEditForm] = useState({ fullName: "", branch: "", sem: "" });


  const [instSettings, setInstSettings] = useState({ collegeName: "", totalSems: 8, branches: "" });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");

  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [adminSaving, setAdminSaving] = useState(false);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteSem, setNoteSem] = useState("1");
  const [noteBranch, setNoteBranch] = useState("");
  const [noteSubject, setNoteSubject] = useState("");
  const [noteModule, setNoteModule] = useState("");
  const [noteFile, setNoteFile] = useState(null);
  const [notesMessage, setNotesMessage] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [newTeacherEmail, setNewTeacherEmail] = useState("");
  const [teacherMessage, setTeacherMessage] = useState("");
  const [teacherSaving, setTeacherSaving] = useState(false);
  const [allNotes, setAllNotes] = useState({});
  const [fileExplorerPath, setFileExplorerPath] = useState([]);
  const [renameModal, setRenameModal] = useState({ isOpen: false, oldName: "", newName: "", pathArr: [] });
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, branch: "", sem: "", subject: "", moduleKey: "", fileUrl: "" });
  
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace("/"); return; }
      setAuthUser(u);
      
      const snap = await get(dbRef(db, `users/${u.uid}`));
      if (snap.exists()) {
        const data = snap.val();
        if (data.role !== "admin") {
          router.replace("/dashboard");
          return;
        }
        setUserData(data);
        fetchUsers();
        fetchSettings();
        fetchNotes();
      } else {
        router.replace("/");
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, [router]);

  const fetchUsers = () => {
    onValue(dbRef(db, "users"), (snap) => {
      if (snap.exists()) {
        const usersObj = snap.val();
        const usersList = Object.keys(usersObj).map(uid => ({ ...usersObj[uid], uid }));
        setUsers(usersList);
      } else {
        setUsers([]);
      }
      setLoading(false);
    });
  };

  const fetchSettings = async () => {
    const snap = await get(dbRef(db, "settings/institution"));
    if (snap.exists()) {
      const val = snap.val();
      setInstSettings({ ...val, branches: val.branches || "" });
    }
  };

  const [notesError, setNotesError] = useState("");

  const fetchNotes = async () => {
    try {
      setNotesError("");
      const snap = await get(dbRef(db, "notes"));
      if (snap.exists()) {
        setAllNotes(snap.val());
      } else {
        setAllNotes({});
        setNotesError("Snap does not exist at /notes");
      }
    } catch (err) {
      console.error("Error fetching notes:", err);
      setNotesError(err.message || "Unknown error fetching notes");
    }
  };


  const handlePromote = async (uid, currentSem) => {
    if (!currentSem || currentSem === "Alumni") return;
    const maxSem = parseInt(instSettings.totalSems, 10) || 8;
    let nextSem = parseInt(currentSem, 10) + 1;
    if (nextSem > maxSem) {
      nextSem = "Alumni";
    }
    try {
      await set(dbRef(db, `users/${uid}/sem`), nextSem);
    } catch (error) {
      console.error("Error promoting student:", error);
    }
  };

  const handleDelete = async (uid) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      await remove(dbRef(db, `users/${uid}`));
    } catch (error) {
      console.error("Error deleting user:", error);
    }
  };
  
  const handleRemoveAdmin = async (uid) => {
    if (!confirm("Are you sure you want to remove admin privileges for this user?")) return;
    try {
      await set(dbRef(db, `users/${uid}/role`), "student");
    } catch (error) {
      console.error("Error removing admin:", error);
    }
  };

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    setAdminMessage("");
    if (!newAdminEmail) return;
    setAdminSaving(true);
    const userToPromote = users.find(u => u.email.toLowerCase() === newAdminEmail.toLowerCase());
    if (userToPromote) {
      try {
        await set(dbRef(db, `users/${userToPromote.uid}/role`), "admin");
        setAdminMessage("User promoted to admin successfully!");
        setNewAdminEmail("");
      } catch (err) {
        setAdminMessage("Error promoting user.");
      }
    } else {
      setAdminMessage("No user found with this email. They must sign in first.");
    }
    setAdminSaving(false);
    setTimeout(() => setAdminMessage(""), 3000);
  };

  const handleDeleteNote = (branch, sem, subject, moduleKey, fileUrl) => {
    setDeleteModal({ isOpen: true, branch, sem, subject, moduleKey, fileUrl });
  };

  const submitDeleteNote = async () => {
    const { branch, sem, subject, moduleKey, fileUrl } = deleteModal;
    try {
      await remove(dbRef(db, `notes/${branch}/${sem}/subjects/${subject}/modules/${moduleKey}`));
      // If it's stored in Firebase Storage, try to delete it
      if (fileUrl && fileUrl.includes("firebasestorage.app")) {
        try {
          // Decode the URL path to get the storage reference
          const decodedUrl = decodeURIComponent(fileUrl.split('/o/')[1].split('?')[0]);
          await deleteObject(storageRef(storage, decodedUrl));
        } catch (e) {
          console.error("Error deleting file from storage:", e);
        }
      }
    } catch (error) {
      console.error("Error deleting note:", error);
    }
    setDeleteModal({ isOpen: false, branch: "", sem: "", subject: "", moduleKey: "", fileUrl: "" });
    fetchNotes();
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSettingsMessage("");
    setSettingsSaving(true);
    try {
      await set(dbRef(db, "settings/institution"), instSettings);
      setSettingsMessage("Settings saved successfully!");
    } catch (err) {
      setSettingsMessage("Error saving settings.");
    }
    setSettingsSaving(false);
    setTimeout(() => setSettingsMessage(""), 3000);
  };

  const handleUploadNote = async (e) => {
    e.preventDefault();
    setNotesMessage("");
    if (!noteTitle || !noteBranch || !noteSubject || !noteModule) {
      setNotesMessage("Please fill all fields.");
      setTimeout(() => setNotesMessage(""), 3000);
      return;
    }
    setNotesSaving(true);
    setUploadProgress(0);
    try {
      const semKey = `Sem:${noteSem}`;
      let fileUrl = "";
      if (noteFile) {
        const sRef = storageRef(storage, `notes/${noteBranch}/${semKey}/${noteSubject}/${noteModule}/${noteFile.name}`);
        const uploadTask = uploadBytesResumable(sRef, noteFile);
        
        await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (error) => reject(error),
            async () => {
              fileUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve();
            }
          );
        });
      }
      
      const newNote = {
        Title: noteTitle,
        resourcesPDF: fileUrl,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userData.fullName || userData.email,
        fileName: noteFile ? noteFile.name : "No file",
      };
      
      await set(dbRef(db, `notes/${noteBranch}/${semKey}/subjects/${noteSubject}/Subject`), noteSubject);
      await set(dbRef(db, `notes/${noteBranch}/${semKey}/subjects/${noteSubject}/modules/${noteModule}`), newNote);
      
      setNotesMessage("Note saved successfully!");
      setNoteTitle("");
      setNoteModule("");
      setNoteFile(null);
      setUploadProgress(0);
    } catch (err) {
      console.error(err);
      setNotesMessage("Error saving note.");
      setUploadProgress(0);
    }
    setNotesSaving(false);
    setTimeout(() => setNotesMessage(""), 3000);
  };


  const handleConfirmLogout = async () => {
    try {
      await logoutAndClearCache(auth);
    } catch (e) {
      console.error("Logout error", e);
    } finally {
      router.replace("/");
    }
  };

  const handlePromoteAll = () => {
    if (processedStudents.length === 0) return;
    const maxSem = parseInt(instSettings.totalSems, 10) || 8;
    
    const snapshot = processedStudents.map(s => ({ uid: s.uid, sem: s.sem }));
    
    processedStudents.forEach(student => {
      let currentSem = student.sem;
      if (!currentSem || currentSem === "Alumni") return;
      let nextSem = parseInt(currentSem, 10) + 1;
      if (nextSem > maxSem) nextSem = "Alumni";
      set(dbRef(db, `users/${student.uid}/sem`), nextSem).catch(console.error);
    });
    
    if (undoAction && undoAction.timer) clearTimeout(undoAction.timer);
    
    const timer = setTimeout(() => {
      setUndoAction(null);
    }, 10000);
    
    setUndoAction({
      message: `Promoted ${processedStudents.length} students.`,
      snapshot,
      timer
    });
    
    setSelectedSem("All");
    setSelectedBranch("All");
    setSearchQuery("");
  };

  const handleUndo = () => {
    if (!undoAction) return;
    clearTimeout(undoAction.timer);
    undoAction.snapshot.forEach(record => {
      set(dbRef(db, `users/${record.uid}/sem`), record.sem || null).catch(console.error);
    });
    setUndoAction(null);
  };

  const handleToggleBlock = async (uid, isBlocked) => {
    if (!confirm(`Are you sure you want to ${isBlocked ? 'unblock' : 'block'} this student?`)) return;
    try {
      await set(dbRef(db, `users/${uid}/blocked`), !isBlocked);
    } catch (error) {
      console.error("Error toggling block:", error);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingStudent) return;
    try {
      if (editForm.fullName !== undefined) await set(dbRef(db, `users/${editingStudent.uid}/fullName`), editForm.fullName);
      if (editForm.branch !== undefined) await set(dbRef(db, `users/${editingStudent.uid}/branch`), editForm.branch);
      if (editForm.sem !== undefined) await set(dbRef(db, `users/${editingStudent.uid}/sem`), editForm.sem === "Alumni" ? "Alumni" : parseInt(editForm.sem));
      setEditingStudent(null);
    } catch (err) {
      console.error(err);
    }
  };


  const bg = isDark ? "#080f1a" : "#f5f8f5";
  const sidebarBg = isDark ? "rgba(8,15,26,0.96)" : "rgba(255,255,255,0.85)";
  const headerBg = isDark ? "rgba(8,15,26,0.92)" : "rgba(255,255,255,0.85)";
  const card = isDark ? "rgba(15,23,42,0.9)" : "#ffffff";
  const text1 = isDark ? "#f1f5f9" : "#0f172a";
  const text2 = isDark ? "#94a3b8" : "#475569";
  const text3 = isDark ? "#475569" : "#94a3b8";
  const bdr = isDark ? "rgba(0,255,0,0.1)" : "rgba(0,200,0,0.12)";

  if (authLoading) return null;

  const studentsOnly = users.filter(u => u.role !== "admin" && u.role !== "teacher");
  const teachersOnly = users.filter(u => u.role === "teacher");
  const adminsOnly = users.filter(u => u.role === "admin");
  
  const branches = ["All", ...new Set(studentsOnly.map(s => s.branch).filter(Boolean))];
  const sems = ["All", ...new Set(studentsOnly.map(s => s.sem).filter(Boolean).sort((a,b) => { if(a==="Alumni") return 1; if(b==="Alumni") return -1; return a - b; }))];
  
  let processedStudents = studentsOnly;
  if (selectedBranch !== "All") processedStudents = processedStudents.filter(s => s.branch === selectedBranch);
  if (selectedSem !== "All") processedStudents = processedStudents.filter(s => String(s.sem) === String(selectedSem));
  
  if (searchQuery.trim() !== "") {
    const q = searchQuery.toLowerCase();
    processedStudents = processedStudents.filter(s => 
      (s.fullName && s.fullName.toLowerCase().includes(q)) || 
      (s.email && s.email.toLowerCase().includes(q))
    );
  }
  
  processedStudents = [...processedStudents].sort((a, b) => {
    if (sortBy === "name") return (a.fullName || "").localeCompare(b.fullName || "");
    if (sortBy === "branch") return (a.branch || "").localeCompare(b.branch || "");
    if (sortBy === "semAsc") return (a.sem || 0) - (b.sem || 0);
    if (sortBy === "semDesc") return (b.sem || 0) - (a.sem || 0);
    return 0;
  });

  const renderDashboard = () => (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" }}>
        <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: "20px", padding: "24px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(0,255,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ color: "#00FF00", fontSize: "20px" }}>groups</span>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: text2 }}>Total Students</span>
          </div>
          <div style={{ fontSize: "32px", fontWeight: 900, color: text1 }}>{studentsOnly.length}</div>
        </div>
        
        <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: "20px", padding: "24px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ color: "#3b82f6", fontSize: "20px" }}>account_tree</span>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: text2 }}>Active Branches</span>
          </div>
          <div style={{ fontSize: "32px", fontWeight: 900, color: text1 }}>{new Set(studentsOnly.map(s => s.branch).filter(Boolean)).size}</div>
        </div>
        
        <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: "20px", padding: "24px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ color: "#f59e0b", fontSize: "20px" }}>admin_panel_settings</span>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: text2 }}>Total Admins</span>
          </div>
          <div style={{ fontSize: "32px", fontWeight: 900, color: text1 }}>{adminsOnly.length}</div>
        </div>
      </div>

      <div className="admin-card">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: 700, color: text1, margin: 0 }}>Student List</h3>
              <span style={{ fontSize: "12px", color: text3, fontWeight: 600 }}>Total: {processedStudents.length}</span>
            </div>
            {(selectedBranch !== "All" || selectedSem !== "All") && processedStudents.length > 0 && (
              <button 
                onClick={handlePromoteAll}
                style={{ background: "rgba(0,255,0,0.1)", color: "#00DD00", border: "1px solid rgba(0,255,0,0.2)", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span className="ms" style={{ fontSize: "16px" }}>upgrade</span>
                Promote All
              </button>
            )}
          </div>
          
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, borderRadius: "8px", padding: "6px 12px", flex: 1, minWidth: "200px" }}>
              <span className="ms" style={{ fontSize: "16px", color: text3, marginRight: "8px" }}>search</span>
              <input 
                type="text" 
                placeholder="Search by name or email..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ background: "transparent", border: "none", outline: "none", color: text1, fontSize: "13px", fontWeight: 500, width: "100%", fontFamily: "'Lexend',sans-serif" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: text3, fontWeight: 700, textTransform: "uppercase" }}>Branch:</span>
              <select 
                value={selectedBranch} 
                onChange={(e) => setSelectedBranch(e.target.value)}
                style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "6px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}
              >
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: text3, fontWeight: 700, textTransform: "uppercase" }}>Sem:</span>
              <select 
                value={selectedSem} 
                onChange={(e) => setSelectedSem(e.target.value)}
                style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "6px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}
              >
                {sems.map(s => <option key={s} value={s}>{s === "All" ? "All" : `Sem ${s}`}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: text3, fontWeight: 700, textTransform: "uppercase" }}>Sort:</span>
              <select 
                value={sortBy} 
                onChange={(e) => setSortBy(e.target.value)}
                style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "6px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: "'Lexend',sans-serif" }}
              >
                <option value="name">Name (A-Z)</option>
                <option value="branch">Branch (A-Z)</option>
                <option value="semAsc">Sem (Low-High)</option>
                <option value="semDesc">Sem (High-Low)</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: text3 }}>Loading...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {processedStudents.map((student) => (
              <div key={student.uid} className="student-row">
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#e2e8f0", overflow: "hidden" }}>
                    {student.photoURL ? (
                      <img src={student.photoURL} alt={student.fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontWeight: "bold" }}>
                        {student.fullName ? student.fullName.charAt(0) : "?"}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: text1, display: "flex", alignItems: "center", gap: "6px" }}>
                      {student.fullName || "Unknown"}
                      {student.blocked && (
                        <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.1)", color: "#ef4444", padding: "2px 6px", borderRadius: "4px", fontWeight: 700, textTransform: "uppercase" }}>Blocked</span>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", color: text2 }}>{student.email}</div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: "80px" }}>
                    <span style={{ fontSize: "10px", textTransform: "uppercase", color: text3, fontWeight: 700 }}>Branch</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: text1 }}>{student.branch || "N/A"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: "60px" }}>
                    <span style={{ fontSize: "10px", textTransform: "uppercase", color: text3, fontWeight: 700 }}>Sem</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: text1 }}>{student.sem || "N/A"}</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px", minWidth: "200px", justifyContent: "flex-end" }}>
                    <button 
                      onClick={() => { setEditingStudent(student); setEditForm({ fullName: student.fullName || "", branch: student.branch || "", sem: student.sem || "" }); }}
                      style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: text1, border: `1px solid ${bdr}`, padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      <span className="ms" style={{ fontSize: "16px" }}>edit</span>
                      Edit
                    </button>
                    <button 
                      onClick={() => handleToggleBlock(student.uid, student.blocked)}
                      style={{ background: student.blocked ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", color: student.blocked ? "#ef4444" : "#f59e0b", border: `1px solid ${student.blocked ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`, padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      <span className="ms" style={{ fontSize: "16px" }}>{student.blocked ? "lock_open" : "block"}</span>
                      {student.blocked ? "Unblock" : "Block"}
                    </button>
                    <button 
                      className="btn-promote" 
                      onClick={() => handlePromote(student.uid, student.sem)}
                      disabled={!student.sem || student.sem === "Alumni"}
                    >
                      <span className="ms" style={{ fontSize: "16px" }}>upgrade</span>
                      Promote
                    </button>
                    <button 
                      className="btn-delete" 
                      onClick={() => handleDelete(student.uid)}
                    >
                      <span className="ms" style={{ fontSize: "16px" }}>delete</span>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {processedStudents.length === 0 && !loading && (
              <div style={{ padding: "32px", textAlign: "center", color: text3 }}>No students found matching your criteria.</div>
            )}
          </div>
        )}
      </div>

      {undoAction && (
        <div style={{ position: "fixed", bottom: "32px", left: "50%", transform: "translateX(-50%)", background: isDark ? "#1e293b" : "#ffffff", border: `1px solid ${bdr}`, padding: "16px 24px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.2)", zIndex: 100 }}>
          <span style={{ color: text1, fontSize: "14px", fontWeight: 600 }}>{undoAction.message}</span>
          <button onClick={handleUndo} style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "none", padding: "6px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
            Undo (10s)
          </button>
        </div>
      )}

    </>
  );

  


  const handleAddTeacher = async (e) => {
    e.preventDefault();
    setTeacherMessage("");
    if (!newTeacherEmail) return;
    setTeacherSaving(true);
    const userToPromote = users.find(u => u.email.toLowerCase() === newTeacherEmail.toLowerCase());
    if (userToPromote) {
      try {
        await set(dbRef(db, `users/${userToPromote.uid}/role`), "teacher");
        setTeacherMessage("User promoted to teacher successfully!");
        setNewTeacherEmail("");
      } catch (err) {
        setTeacherMessage("Error promoting user.");
      }
    } else {
      setTeacherMessage("No user found with this email. They must sign in first.");
    }
    setTeacherSaving(false);
    setTimeout(() => setTeacherMessage(""), 3000);
  };

  const handleRemoveTeacher = async (uid) => {
    if (!confirm("Are you sure you want to remove teacher privileges for this user?")) return;
    try {
      await set(dbRef(db, `users/${uid}/role`), "student");
    } catch (error) {
      console.error("Error removing teacher:", error);
    }
  };

  const renderTeachers = () => (
    <div className="admin-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "16px" }}>
        <h3 style={{ fontSize: "18px", fontWeight: 700, color: text1, margin: 0 }}>Manage Teachers</h3>
        <form onSubmit={handleAddTeacher} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input 
            type="email" 
            placeholder="User's email to promote" 
            value={newTeacherEmail}
            onChange={e => setNewTeacherEmail(e.target.value)}
            style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "8px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, outline: "none", width: "220px", fontFamily: "'Lexend',sans-serif" }}
            required
          />
          <button type="submit" disabled={teacherSaving} style={{ background: "rgba(0,255,0,0.1)", color: "#00DD00", border: "1px solid rgba(0,255,0,0.2)", padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
            {teacherSaving ? "Promoting..." : "Promote to Teacher"}
          </button>
        </form>
      </div>
      {teacherMessage && <div style={{ fontSize: "13px", color: teacherMessage.includes("Error") || teacherMessage.includes("No user") ? "#ef4444" : "#00FF00", marginBottom: "16px", fontWeight: 600 }}>{teacherMessage}</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {teachersOnly.map((teacher) => (
          <div key={teacher.uid} className="student-row">
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#e2e8f0", overflow: "hidden" }}>
                {teacher.photoURL ? (
                  <img src={teacher.photoURL} alt={teacher.fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontWeight: "bold" }}>
                    {teacher.fullName ? teacher.fullName.charAt(0) : "T"}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: text1, display: "flex", alignItems: "center", gap: "6px" }}>
                  {teacher.fullName || "Unknown Teacher"}
                  <span className="ms" style={{ fontSize: "16px", color: "#3b82f6" }} title="Teacher">local_library</span>
                  {teacher.blocked && (
                    <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.1)", color: "#ef4444", padding: "2px 6px", borderRadius: "4px", fontWeight: 700, textTransform: "uppercase" }}>Blocked</span>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: text2 }}>{teacher.email}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button 
                onClick={() => { setEditingStudent(teacher); setEditForm({ fullName: teacher.fullName || "", branch: teacher.branch || "", sem: teacher.sem || "" }); }}
                style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: text1, border: `1px solid ${bdr}`, padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span className="ms" style={{ fontSize: "16px" }}>edit</span>
                Edit
              </button>
              <button 
                onClick={() => handleToggleBlock(teacher.uid, teacher.blocked)}
                style={{ background: teacher.blocked ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", color: teacher.blocked ? "#ef4444" : "#f59e0b", border: `1px solid ${teacher.blocked ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`, padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span className="ms" style={{ fontSize: "16px" }}>{teacher.blocked ? "lock_open" : "block"}</span>
                {teacher.blocked ? "Unblock" : "Block"}
              </button>
              <button 
                className="btn-delete" 
                onClick={() => handleRemoveTeacher(teacher.uid)}
              >
                <span className="ms" style={{ fontSize: "16px" }}>delete</span>
                Remove Teacher
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderAdmins = () => (
    <div className="admin-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "16px" }}>
        <h3 style={{ fontSize: "18px", fontWeight: 700, color: text1, margin: 0 }}>Manage Admins</h3>
        <form onSubmit={handleAddAdmin} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input 
            type="email" 
            placeholder="User's email to promote" 
            value={newAdminEmail}
            onChange={e => setNewAdminEmail(e.target.value)}
            style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "8px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, outline: "none", width: "220px", fontFamily: "'Lexend',sans-serif" }}
            required
          />
          <button type="submit" disabled={adminSaving} style={{ background: "rgba(0,255,0,0.1)", color: "#00DD00", border: "1px solid rgba(0,255,0,0.2)", padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
            {adminSaving ? "Promoting..." : "Promote to Admin"}
          </button>
        </form>
      </div>
      {adminMessage && <div style={{ fontSize: "13px", color: adminMessage.includes("Error") || adminMessage.includes("No user") ? "#ef4444" : "#00FF00", marginBottom: "16px", fontWeight: 600 }}>{adminMessage}</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {adminsOnly.map((admin) => (
          <div key={admin.uid} className="student-row">
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#e2e8f0", overflow: "hidden" }}>
                {admin.photoURL ? (
                  <img src={admin.photoURL} alt={admin.fullName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontWeight: "bold" }}>
                    {admin.fullName ? admin.fullName.charAt(0) : "A"}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: text1, display: "flex", alignItems: "center", gap: "6px" }}>
                  {admin.fullName || "Unknown Admin"}
                  <span className="ms" style={{ fontSize: "16px", color: "#00FF00" }} title="Admin">verified</span>
                  {admin.blocked && (
                    <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.1)", color: "#ef4444", padding: "2px 6px", borderRadius: "4px", fontWeight: 700, textTransform: "uppercase" }}>Blocked</span>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: text2 }}>{admin.email}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button 
                onClick={() => { setEditingStudent(admin); setEditForm({ fullName: admin.fullName || "", branch: admin.branch || "", sem: admin.sem || "" }); }}
                style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: text1, border: `1px solid ${bdr}`, padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span className="ms" style={{ fontSize: "16px" }}>edit</span>
                Edit
              </button>
              <button 
                onClick={() => handleToggleBlock(admin.uid, admin.blocked)}
                style={{ background: admin.blocked ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", color: admin.blocked ? "#ef4444" : "#f59e0b", border: `1px solid ${admin.blocked ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`, padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span className="ms" style={{ fontSize: "16px" }}>{admin.blocked ? "lock_open" : "block"}</span>
                {admin.blocked ? "Unblock" : "Block"}
              </button>
              <button 
                className="btn-delete" 
                onClick={() => handleRemoveAdmin(admin.uid)}
                disabled={admin.uid === authUser?.uid}
                title={admin.uid === authUser?.uid ? "You cannot delete yourself" : ""}
              >
                <span className="ms" style={{ fontSize: "16px" }}>delete</span>
                Remove Admin
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderNotes = () => (
    <div style={{ display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="admin-card" style={{ flex: "1 1 500px" }}>
        <h3 style={{ fontSize: "20px", fontWeight: 700, color: text1, margin: 0, marginBottom: "24px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="ms" style={{ color: "#00FF00", fontSize: "24px" }}>cloud_upload</span>
          Upload New Material
        </h3>
        <form onSubmit={handleUploadNote} style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* File Upload Area */}
          <div style={{ position: "relative", width: "100%", height: "180px", borderRadius: "16px", border: `2px dashed ${noteFile ? "#00FF00" : (isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)")}`, background: noteFile ? "rgba(0,255,0,0.05)" : (isDark ? "rgba(255,255,255,0.02)" : "#f8fafc"), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transition: "all 0.2s", cursor: "pointer", overflow: "hidden" }}
               onMouseEnter={e => { if(!noteFile) { e.currentTarget.style.borderColor = "rgba(0,255,0,0.5)"; e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.04)" : "#f1f5f9"; } }}
               onMouseLeave={e => { if(!noteFile) { e.currentTarget.style.borderColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)"; e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.02)" : "#f8fafc"; } }}>
            <input 
              type="file" 
              required
              onChange={e => setNoteFile(e.target.files[0])} 
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} 
            />
            {noteFile ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", pointerEvents: "none" }}>
                <span className="ms" style={{ fontSize: "40px", color: "#00FF00" }}>task</span>
                <span style={{ fontSize: "15px", fontWeight: 700, color: text1, textAlign: "center", maxWidth: "80%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{noteFile.name}</span>
                <span style={{ fontSize: "12px", color: text3, fontWeight: 600 }}>{(noteFile.size / 1024 / 1024).toFixed(2)} MB • Click to replace</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", pointerEvents: "none" }}>
                <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: isDark ? "rgba(255,255,255,0.08)" : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="ms" style={{ fontSize: "28px", color: text2 }}>upload_file</span>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: text1, display: "block", marginBottom: "4px" }}>Drag & Drop or <span style={{ color: "#00DD00" }}>Browse</span></span>
                  <span style={{ fontSize: "12px", color: text3, fontWeight: 500 }}>Supports PDF, PPT, DOCX</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ height: "1px", background: bdr, width: "100%" }} />

          {/* Metadata Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Document Title</label>
                <input type="text" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} required placeholder="e.g. Intro to ML" style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "12px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 500, outline: "none", fontFamily: "'Lexend',sans-serif", transition: "border 0.2s" }} onFocus={e=>e.currentTarget.style.borderColor="#00FF00"} onBlur={e=>e.currentTarget.style.borderColor=bdr} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Subject Code</label>
                  <input type="text" value={noteSubject} onChange={e => setNoteSubject(e.target.value.toUpperCase())} required placeholder="e.g. OS, DBMS" style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "12px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 500, outline: "none", fontFamily: "'Lexend',sans-serif", transition: "border 0.2s" }} onFocus={e=>e.currentTarget.style.borderColor="#00FF00"} onBlur={e=>e.currentTarget.style.borderColor=bdr} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Module Name</label>
                  <input type="text" value={noteModule} onChange={e => setNoteModule(e.target.value)} required placeholder="e.g. Module 1" style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "12px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 500, outline: "none", fontFamily: "'Lexend',sans-serif", transition: "border 0.2s" }} onFocus={e=>e.currentTarget.style.borderColor="#00FF00"} onBlur={e=>e.currentTarget.style.borderColor=bdr} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Branch</label>
                  <select 
                    value={noteBranch} 
                    onChange={e => setNoteBranch(e.target.value)} 
                    required 
                    style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "12px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 600, outline: "none", fontFamily: "'Lexend',sans-serif", cursor: "pointer" }}
                  >
                    <option value="">Select Branch</option>
                    <option value="IT">IT</option>
                    <option value="CS">CS</option>
                    <option value="EXTC">EXTC</option>
                    <option value="AI&DS">AI&DS</option>
                    <option value="COMP">COMP</option>
                    {noteBranch && !["IT","CS","EXTC","AI&DS","COMP"].includes(noteBranch) && (
                      <option value={noteBranch}>{noteBranch}</option>
                    )}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Semester</label>
                  <select 
                    value={noteSem} 
                    onChange={e => setNoteSem(e.target.value)} 
                    required 
                    style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "12px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 600, outline: "none", fontFamily: "'Lexend',sans-serif", cursor: "pointer" }}
                  >
                    <option value="">Select Sem</option>
                    {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Sem {s}</option>)}
                  </select>
                </div>
              </div>
            </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px" }}>
            <span style={{ fontSize: "13px", color: notesMessage.includes("Error") ? "#ef4444" : "#00FF00", fontWeight: 600, flex: 1 }}>{notesMessage}</span>
            <button type="submit" disabled={notesSaving || !noteFile} style={{ position: "relative", overflow: "hidden", background: (notesSaving || !noteFile) ? (isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1") : "#00FF00", color: (notesSaving || !noteFile) ? (isDark ? "#64748b" : "#64748b") : "#0f172a", border: "none", padding: "12px 28px", borderRadius: "10px", fontSize: "15px", fontWeight: 800, cursor: (notesSaving || !noteFile) ? "not-allowed" : "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "8px", boxShadow: (notesSaving || !noteFile) ? "none" : "0 8px 24px rgba(0,255,0,0.3)", zIndex: 1 }}>
              {notesSaving && (
                <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${uploadProgress}%`, background: "rgba(0, 180, 0, 0.6)", zIndex: -1, transition: "width 0.2s linear" }} />
              )}
              {notesSaving ? (
                <>
                  <span className="ms" style={{ animation: "spin 1s linear infinite" }}>sync</span>
                  {uploadProgress > 0 ? `Uploading... ${Math.round(uploadProgress)}%` : "Uploading..."}
                </>
              ) : (
                <>
                  <span className="ms">publish</span>
                  Publish Note
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Guidelines Card */}
      <div className="admin-card" style={{ flex: "1 1 300px", maxWidth: "400px", alignSelf: "stretch" }}>
        <h3 style={{ fontSize: "16px", fontWeight: 700, color: text1, margin: 0, marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="ms" style={{ color: "#3b82f6", fontSize: "20px" }}>info</span>
          Upload Guidelines
        </h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
          <li style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span className="ms" style={{ color: "#00FF00", fontSize: "18px", marginTop: "2px" }}>check_circle</span>
            <div>
              <span style={{ display: "block", fontSize: "13px", fontWeight: 700, color: text1, marginBottom: "4px" }}>Organize properly</span>
              <span style={{ display: "block", fontSize: "12px", color: text2, lineHeight: 1.5 }}>Always specify the correct branch and semester so students can find it easily.</span>
            </div>
          </li>
          <li style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span className="ms" style={{ color: "#00FF00", fontSize: "18px", marginTop: "2px" }}>check_circle</span>
            <div>
              <span style={{ display: "block", fontSize: "13px", fontWeight: 700, color: text1, marginBottom: "4px" }}>Clear titles</span>
              <span style={{ display: "block", fontSize: "12px", color: text2, lineHeight: 1.5 }}>Include the module/chapter number and topic name (e.g., "Mod 1: Intro to OS").</span>
            </div>
          </li>
          <li style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span className="ms" style={{ color: "#3b82f6", fontSize: "18px", marginTop: "2px" }}>shield</span>
            <div>
              <span style={{ display: "block", fontSize: "13px", fontWeight: 700, color: text1, marginBottom: "4px" }}>Quality check</span>
              <span style={{ display: "block", fontSize: "12px", color: text2, lineHeight: 1.5 }}>Ensure PDFs are properly scanned and legible before uploading.</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );

  const navigateTo = (folderName) => {
    setFileExplorerPath([...fileExplorerPath, folderName]);
  };

  const navigateUp = (index) => {
    if (index === -1) {
      setFileExplorerPath([]);
    } else {
      setFileExplorerPath(fileExplorerPath.slice(0, index + 1));
    }
  };

  const handleRenameNode = (oldName) => {
    setRenameModal({ isOpen: true, oldName, newName: oldName, pathArr: [...fileExplorerPath] });
  };

  const submitRenameNode = async () => {
    const { oldName, newName, pathArr } = renameModal;
    if (!newName || newName === oldName) {
      setRenameModal({ isOpen: false, oldName: "", newName: "", pathArr: [] });
      return;
    }
    
    const buildPath = (pArr, targetName) => {
      let p = "notes";
      if (pArr.length >= 1) p += `/${pArr.length === 1 ? targetName : pArr[0]}`;
      if (pArr.length >= 2) p += `/${pArr.length === 2 ? targetName : pArr[1]}`;
      if (pArr.length >= 3) p += `/subjects/${pArr.length === 3 ? targetName : pArr[2]}`;
      if (pArr.length >= 4) p += `/modules/${pArr.length === 4 ? targetName : pArr[3]}`;
      return p;
    };

    const oldDbPath = buildPath([...pathArr, oldName], oldName);
    const newDbPath = buildPath([...pathArr, newName], newName);
    
    try {
      const snap = await get(dbRef(db, oldDbPath));
      if (snap.exists()) {
        await set(dbRef(db, newDbPath), snap.val());
        await remove(dbRef(db, oldDbPath));
        fetchNotes();
      }
    } catch (err) {
      alert("Failed to rename: " + err.message);
    }
    setRenameModal({ isOpen: false, oldName: "", newName: "", pathArr: [] });
  };

  const renderManageNotes = () => {
    let currentDir = allNotes || {};
    let level = fileExplorerPath.length;
    
    if (level > 0) currentDir = currentDir[fileExplorerPath[0]] || {};
    if (level > 1) currentDir = currentDir[fileExplorerPath[1]]?.subjects || {};
    if (level > 2) currentDir = currentDir[fileExplorerPath[2]]?.modules || {};
    
    let items = Object.keys(currentDir).sort((a,b) => a.localeCompare(b));

    if (level === 0) {
      const settingBranches = instSettings?.branches ? instSettings.branches.split(',').map(b => b.trim()).filter(Boolean) : ["IT", "CS", "EXTC", "AI&DS", "COMP"];
      items = Array.from(new Set([...items, ...settingBranches])).sort((a,b) => a.localeCompare(b));
    } else if (level === 1) {
      const maxSem = parseInt(instSettings?.totalSems, 10) || 8;
      const defaultSems = Array.from({ length: maxSem }, (_, i) => `Sem:${i + 1}`);
      items = Array.from(new Set([...items, ...defaultSems])).sort((a,b) => a.localeCompare(b));
    }
    
    const getLevelIcon = (lvl) => {
      if (lvl === 0) return { icon: "domain", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" };
      if (lvl === 1) return { icon: "school", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" };
      if (lvl === 2) return { icon: "library_books", color: "#10b981", bg: "rgba(16,185,129,0.1)" };
      return { icon: "description", color: "#ef4444", bg: "rgba(239,68,68,0.1)" };
    };
    
    const levelMeta = getLevelIcon(level);

    return (
      <div className="admin-card" style={{ minHeight: "500px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h3 style={{ fontSize: "20px", fontWeight: 800, color: text1, margin: 0, letterSpacing: "-0.02em" }}>Notes Repository</h3>
        </div>
        
        {notesError && <div style={{ color: "#ef4444", marginBottom: "16px", padding: "12px", background: "rgba(239,68,68,0.1)", borderRadius: "8px", fontWeight: 600 }}>Error: {notesError}</div>}
        
        {/* Modern Path Navigator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: isDark ? "rgba(255,255,255,0.03)" : "#f8fafc", padding: "10px 16px", borderRadius: "12px", marginBottom: "24px", overflowX: "auto", border: `1px solid ${bdr}` }}>
          <button onClick={() => navigateUp(-1)} style={{ background: "transparent", border: "none", color: level === 0 ? text1 : text3, cursor: "pointer", fontWeight: level === 0 ? 700 : 500, fontSize: "14px", display: "flex", alignItems: "center", gap: "6px", transition: "color 0.2s" }}>
            <span className="ms" style={{ fontSize: "18px" }}>home</span> Repository
          </button>
          
          {fileExplorerPath.map((pathItem, index) => (
            <div key={index} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="ms" style={{ color: text3, fontSize: "18px", opacity: 0.5 }}>chevron_right</span>
              <button 
                onClick={() => navigateUp(index)}
                style={{ background: "transparent", border: "none", color: index === level - 1 ? text1 : text3, cursor: "pointer", fontWeight: index === level - 1 ? 700 : 500, fontSize: "14px", transition: "color 0.2s" }}
              >
                {pathItem}
              </button>
            </div>
          ))}
        </div>

        {/* Card Grid */}
        {items.length === 0 && !notesError ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: text3, gap: "16px" }}>
            <div style={{ width: "64px", height: "64px", borderRadius: "16px", background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="ms" style={{ fontSize: "32px", opacity: 0.5 }}>inventory_2</span>
            </div>
            <p style={{ fontWeight: 500 }}>No items found in this section.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
            {items.map(item => {
              const isFile = level === 3;
              const noteData = isFile ? currentDir[item] : null;
              
              return (
                <div key={item} style={{ background: isDark ? "rgba(15,23,42,0.6)" : "#ffffff", border: `1px solid ${bdr}`, borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", cursor: "pointer" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = isDark ? "0 12px 24px rgba(0,0,0,0.4)" : "0 12px 24px rgba(0,0,0,0.05)"; e.currentTarget.style.borderColor = levelMeta.color; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = bdr; }}
                  onClick={(e) => {
                    // Prevent navigation if clicking on buttons
                    if (e.target.closest('button')) return;
                    if (!isFile) {
                      navigateTo(item);
                    } else {
                      const semNum = fileExplorerPath[1].replace('Sem:', '').trim();
                      if (noteData?.pdfChunks || noteData?.pdfMeta) {
                        const url = `/pdfviewer?branch=${encodeURIComponent(fileExplorerPath[0])}&sem=${encodeURIComponent(semNum)}&subject=${encodeURIComponent(fileExplorerPath[2])}&module=${encodeURIComponent(item)}`;
                        window.open(url, '_blank');
                      } else if (noteData?.resourcesPDF) {
                        window.open(noteData.resourcesPDF, '_blank');
                      }
                    }
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: levelMeta.bg, color: levelMeta.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span className="ms" style={{ fontSize: "20px" }}>{levelMeta.icon}</span>
                    </div>
                    
                    {/* Action Menu (Inline) */}
                    <div style={{ display: "flex", gap: "4px" }}>
                      {level >= 2 && (
                        <button onClick={() => handleRenameNode(item)} title="Rename" style={{ width: "32px", height: "32px", borderRadius: "8px", background: "transparent", border: "none", color: text3, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.1)" : "#f1f5f9"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span className="ms" style={{ fontSize: "16px" }}>edit</span>
                        </button>
                      )}
                      {isFile && (
                        <button onClick={() => handleDeleteNote(fileExplorerPath[0], fileExplorerPath[1].replace('Sem:', ''), fileExplorerPath[2], item, noteData?.resourcesPDF)} title="Delete" style={{ width: "32px", height: "32px", borderRadius: "8px", background: "transparent", border: "none", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span className="ms" style={{ fontSize: "16px" }}>delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: text1, lineHeight: 1.3, wordBreak: "break-word" }}>
                      {item}
                    </span>
                    {isFile && noteData && (
                      <span style={{ fontSize: "12px", color: text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={noteData.fileName}>
                        {noteData.fileName || "No document attached"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };
  const renderSettings = () => (
    <div className="admin-card">
      <h3 style={{ fontSize: "18px", fontWeight: 700, color: text1, margin: 0, marginBottom: "16px" }}>Institution Settings</h3>
      <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "400px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: text3, textTransform: "uppercase" }}>College Name</label>
          <input 
            type="text" 
            value={instSettings.collegeName} 
            onChange={e => setInstSettings({...instSettings, collegeName: e.target.value})} 
            placeholder="e.g. TCET" 
            style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "10px 14px", borderRadius: "8px", fontSize: "14px", outline: "none", fontFamily: "'Lexend',sans-serif" }} 
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: text3, textTransform: "uppercase" }}>Total Semesters</label>
          <input 
            type="number" 
            value={instSettings.totalSems} 
            onChange={e => setInstSettings({...instSettings, totalSems: e.target.value})} 
            min="1" 
            style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "10px 14px", borderRadius: "8px", fontSize: "14px", outline: "none", fontFamily: "'Lexend',sans-serif" }} 
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: text3, textTransform: "uppercase" }}>Branches (comma-separated)</label>
          <input 
            type="text" 
            value={instSettings.branches} 
            onChange={e => setInstSettings({...instSettings, branches: e.target.value})} 
            placeholder="e.g. IT,CS,EXTC" 
            style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "10px 14px", borderRadius: "8px", fontSize: "14px", outline: "none", fontFamily: "'Lexend',sans-serif" }} 
          />
        </div>
        <p style={{ fontSize: "12px", color: text2, lineHeight: 1.5 }}>
          If Total Semesters is set to {instSettings.totalSems || 8}, any student promoted past Semester {instSettings.totalSems || 8} will be marked as "Alumni".
        </p>
        <button type="submit" disabled={settingsSaving} style={{ background: "rgba(0,255,0,0.1)", color: "#00DD00", border: "1px solid rgba(0,255,0,0.2)", padding: "10px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", alignSelf: "flex-start", marginTop: "8px" }}>
          {settingsSaving ? "Saving..." : "Save Settings"}
        </button>
        {settingsMessage && <div style={{ fontSize: "13px", color: settingsMessage.includes("Error") ? "#ef4444" : "#00FF00", fontWeight: 600 }}>{settingsMessage}</div>}
      </form>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;}
        body{font-family:'Lexend',sans-serif;background:${bg};color:${text1};overflow:hidden;}
        .ms{font-family:'Material Symbols Outlined'!important;font-weight:normal;font-style:normal;line-height:1;display:inline-block;}
        .sb-root{display:flex;height:100vh;overflow:hidden;}
        .sb-sidebar{width:260px;min-width:260px;height:100vh;background:${sidebarBg};backdrop-filter:blur(12px);border-right:1px solid ${bdr};display:flex;flex-direction:column;padding:24px 20px;z-index:20;}
        .nav-link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9999px;font-size:13px;font-weight:600;color:${text2};transition:all 0.2s;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:'Lexend',sans-serif;}
        .nav-link:hover{background:rgba(0,200,0,0.08);color:${text1};}
        .nav-link.active{background:#00FF00;color:#0f172a;box-shadow:0 6px 20px rgba(0,255,0,0.28);}
        .sb-main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
        .sb-header{height:72px;background:${headerBg};backdrop-filter:blur(12px);border-bottom:1px solid ${bdr};padding:0 32px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .sb-scroll{flex:1;overflow-y:auto;padding:36px;display:flex;flex-direction:column;gap:28px;}
        .sb-scroll::-webkit-scrollbar{width:4px;}
        .sb-scroll::-webkit-scrollbar-thumb{background:rgba(0,200,0,0.2);border-radius:2px;}
        .admin-card{background:${card};border:1px solid ${bdr};border-radius:24px;padding:32px;display:flex;flex-direction:column;gap:22px;}
        .student-row{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid ${bdr};}
        .student-row:last-child{border-bottom:none;}
        .btn-promote{background:rgba(0,255,0,0.1);color:#00DD00;border:1px solid rgba(0,255,0,0.2);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:6px;}
        .btn-promote:hover{background:rgba(0,255,0,0.2);}
        .btn-promote:disabled{opacity:0.5;cursor:not-allowed;}
        .btn-delete{background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:6px;}
        .btn-delete:hover{background:rgba(239,68,68,0.2);}
        .btn-delete:disabled{opacity:0.5;cursor:not-allowed;}
        @media(max-width:768px){.sb-sidebar{position:fixed;left:0;top:0;transform:translateX(-100%);transition:transform 0.3s;}
        .sb-sidebar.open{transform:translateX(0);}.sb-scroll{padding:20px 16px 80px;}}
      `}</style>

      <div className="sb-root">
        {mobileMenuOpen && (
          <div 
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10 }}
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        {/* Sidebar */}
        <aside className={`sb-sidebar ${mobileMenuOpen ? "open" : ""}`}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "40px", padding: "0 10px" }}>
            <div style={{ width: "40px", height: "40px", background: "#00FF00", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(0,255,0,0.35)" }}>
              <span className="ms" style={{ color: "#0f172a", fontSize: "22px" }}>school</span>
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: text1, margin: 0, lineHeight: 1.2 }}>Admin Panel</h2>
              <span style={{ fontSize: "11px", color: text2 }}>StudyBuddy App</span>
            </div>
          </div>
          
          <nav style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
            <button className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => { setActiveTab('dashboard'); setMobileMenuOpen(false); }}>
              <span className="ms" style={{ fontSize: "20px" }}>dashboard</span>
              Dashboard
            </button>
            <button className={`nav-link ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => { setActiveTab('notes'); setMobileMenuOpen(false); }}>
              <span className="ms" style={{ fontSize: "20px" }}>cloud_upload</span>
              Upload Notes
            </button>
            <button className={`nav-link ${activeTab === 'manage_notes' ? 'active' : ''}`} onClick={() => { setActiveTab('manage_notes'); setMobileMenuOpen(false); }}>
              <span className="ms" style={{ fontSize: "20px" }}>folder_open</span>
              Manage Notes
            </button>
            <button className={`nav-link ${activeTab === 'admins' ? 'active' : ''}`} onClick={() => { setActiveTab('admins'); setMobileMenuOpen(false); }}>
              <span className="ms" style={{ fontSize: "20px" }}>manage_accounts</span>
              Manage Admins
            </button>
            <button className={`nav-link ${activeTab === 'teachers' ? 'active' : ''}`} onClick={() => { setActiveTab('teachers'); setMobileMenuOpen(false); }}>
              <span className="ms" style={{ fontSize: "20px" }}>school</span>
              Manage Teachers
            </button>
            <button className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveTab('settings'); setMobileMenuOpen(false); }}>
              <span className="ms" style={{ fontSize: "20px" }}>settings</span>
              Institution Config
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="sb-main">
          <header className="sb-header">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button 
                className="mobile-menu-btn"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                style={{ background: "transparent", border: "none", color: text1, cursor: "pointer", display: "none" }}
              >
                <span className="ms" style={{ fontSize: "24px" }}>menu</span>
              </button>
              <style>{`@media(max-width:768px){.mobile-menu-btn{display:block!important;}}`}</style>
              <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: text1, margin: 0 }}>
                {activeTab === 'dashboard' && 'Student Dashboard'}
                {activeTab === 'notes' && 'Upload Notes'}
                {activeTab === 'manage_notes' && 'Manage Notes'}
                {activeTab === 'admins' && 'Manage Admins'}
                {activeTab === 'teachers' && 'Manage Teachers'}
                {activeTab === 'settings' && 'Settings'}
              </h1>
            </div>
            
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <ThemeSwitcher theme={theme} setTheme={setTheme} resolved={resolved} />
              
              {userData && (
                <div style={{ position: "relative" }}>
                  <div 
                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                    style={{ cursor: "pointer", width: "40px", height: "40px", borderRadius: "50%", overflow: "hidden", background: "#e2e8f0", border: `2px solid ${bdr}`, transition: "transform 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                  >
                    {userData.photoURL ? (
                      <img src={userData.photoURL} alt="Admin" style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00FF00", color: "#0f172a", fontWeight: "bold", fontSize: "14px" }}>
                        {userData.fullName ? userData.fullName.charAt(0) : "A"}
                      </div>
                    )}
                  </div>
                  
                  {showProfileMenu && (
                    <div style={{ position: "absolute", top: "100%", right: "0", marginTop: "12px", background: card, border: `1px solid ${bdr}`, borderRadius: "16px", padding: "12px", minWidth: "220px", boxShadow: "0 10px 30px rgba(0,0,0,0.2)", zIndex: 50 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px", borderBottom: `1px solid ${bdr}`, marginBottom: "8px" }}>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: text1 }}>{userData.fullName || "Admin"}</span>
                            <span className="ms" style={{ fontSize: "14px", color: "#00FF00" }} title="Admin">verified</span>
                          </div>
                          <span style={{ fontSize: "11px", color: text3 }}>{userData.email}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setShowProfileMenu(false);
                          setShowLogoutModal(true);
                        }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 600, transition: "background 0.2s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.2)"}
                        onMouseLeave={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                      >
                        <span className="ms" style={{ fontSize: "18px" }}>logout</span>
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </header>

          <div className="sb-scroll">
            {activeTab === 'dashboard' && renderDashboard()}
            {activeTab === 'notes' && renderNotes()}
            {activeTab === 'manage_notes' && renderManageNotes()}
            {activeTab === 'admins' && renderAdmins()}
            {activeTab === 'teachers' && renderTeachers()}
            {activeTab === 'settings' && renderSettings()}
          </div>
        </main>
      </div>

      
      {/* Rename Modal */}
      {renameModal.isOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: card, padding: "32px", borderRadius: "24px", width: "400px", maxWidth: "90%", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", border: `1px solid ${bdr}` }}>
            <h3 style={{ fontSize: "20px", fontWeight: 700, color: text1, marginBottom: "20px" }}>Rename Note</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "32px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: text3, textTransform: "uppercase" }}>New Name</label>
              <input 
                type="text" 
                value={renameModal.newName} 
                onChange={e => setRenameModal({...renameModal, newName: e.target.value})} 
                style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "10px 14px", borderRadius: "8px", fontSize: "14px", outline: "none", fontFamily: "'Lexend',sans-serif" }} 
              />
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button 
                onClick={() => setRenameModal({ isOpen: false, oldName: "", newName: "", pathArr: [] })} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: text1, fontWeight: 600, cursor: "pointer", transition: "background 0.2s" }}
              >
                Cancel
              </button>
              <button 
                onClick={submitRenameNode} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: "#00FF00", color: "#0f172a", fontWeight: 700, cursor: "pointer", transition: "opacity 0.2s" }}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal.isOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: card, padding: "32px", borderRadius: "24px", width: "400px", maxWidth: "90%", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", border: `1px solid ${bdr}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="ms" style={{ color: "#ef4444", fontSize: "24px" }}>delete</span>
              </div>
              <h3 style={{ fontSize: "20px", fontWeight: 700, color: text1, margin: 0 }}>Delete Note</h3>
            </div>
            <p style={{ color: text2, marginBottom: "32px", lineHeight: 1.5, fontSize: "14px" }}>Are you sure you want to delete <strong style={{ color: text1 }}>{deleteModal.moduleKey}</strong>? This action cannot be undone.</p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button 
                onClick={() => setDeleteModal({ isOpen: false, branch: "", sem: "", subject: "", moduleKey: "", fileUrl: "" })} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: text1, fontWeight: 600, cursor: "pointer", transition: "background 0.2s" }}
              >
                Cancel
              </button>
              <button 
                onClick={submitDeleteNote} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: "#ef4444", color: "#ffffff", fontWeight: 600, cursor: "pointer", transition: "background 0.2s" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editingStudent && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: card, padding: "32px", borderRadius: "24px", width: "400px", maxWidth: "90%", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", border: `1px solid ${bdr}` }}>
            <h3 style={{ fontSize: "20px", fontWeight: 700, color: text1, marginBottom: "20px" }}>Edit Student</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: text3, textTransform: "uppercase" }}>Full Name</label>
                <input 
                  type="text" 
                  value={editForm.fullName} 
                  onChange={e => setEditForm({...editForm, fullName: e.target.value})} 
                  style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "10px 14px", borderRadius: "8px", fontSize: "14px", outline: "none", fontFamily: "'Lexend',sans-serif" }} 
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: text3, textTransform: "uppercase" }}>Branch</label>
                <select 
                  value={editForm.branch} 
                  onChange={e => setEditForm({...editForm, branch: e.target.value})} 
                  style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "10px 14px", borderRadius: "8px", fontSize: "14px", outline: "none", fontFamily: "'Lexend',sans-serif", cursor: "pointer" }}
                >
                  <option value="">Select Branch</option>
                  <option value="IT">IT</option>
                  <option value="CS">CS</option>
                  <option value="EXTC">EXTC</option>
                  <option value="AI&DS">AI&DS</option>
                  <option value="COMP">COMP</option>
                  {editForm.branch && !["IT","CS","EXTC","AI&DS","COMP"].includes(editForm.branch) && (
                    <option value={editForm.branch}>{editForm.branch}</option>
                  )}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: text3, textTransform: "uppercase" }}>Semester</label>
                <select 
                  value={editForm.sem} 
                  onChange={e => setEditForm({...editForm, sem: e.target.value})} 
                  style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", border: `1px solid ${bdr}`, color: text1, padding: "10px 14px", borderRadius: "8px", fontSize: "14px", outline: "none", fontFamily: "'Lexend',sans-serif", cursor: "pointer" }}
                >
                  <option value="">Select Semester</option>
                  {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Sem {s}</option>)}
                  <option value="Alumni">Alumni</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button 
                onClick={() => setEditingStudent(null)} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: text1, fontWeight: 600, cursor: "pointer", transition: "background 0.2s" }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveEdit} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: "#00FF00", color: "#0f172a", fontWeight: 700, cursor: "pointer", transition: "opacity 0.2s" }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Logout Modal */}
      {showLogoutModal && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: card, padding: "32px", borderRadius: "24px", width: "400px", maxWidth: "90%", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", border: `1px solid ${bdr}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="ms" style={{ color: "#ef4444", fontSize: "24px" }}>logout</span>
              </div>
              <h3 style={{ fontSize: "20px", fontWeight: 700, color: text1, margin: 0 }}>Sign Out</h3>
            </div>
            <p style={{ color: text2, marginBottom: "32px", lineHeight: 1.5, fontSize: "14px" }}>Are you sure you want to sign out of the Admin Dashboard?</p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button 
                onClick={() => setShowLogoutModal(false)} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: text1, fontWeight: 600, cursor: "pointer", transition: "background 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}
                onMouseLeave={e => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9"}
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmLogout} 
                style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: "#ef4444", color: "#ffffff", fontWeight: 600, cursor: "pointer", transition: "background 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = "#dc2626"}
                onMouseLeave={e => e.currentTarget.style.background = "#ef4444"}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
