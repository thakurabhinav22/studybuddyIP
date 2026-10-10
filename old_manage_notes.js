  const renderManageNotes = () => {
    const branches = Object.keys(allNotes || {});
    
    return (
      <div className="admin-card">
        <h3 style={{ fontSize: "18px", fontWeight: 700, color: text1, margin: 0, marginBottom: "16px" }}>Manage Uploaded Notes</h3>
        
        {notesError && <div style={{ color: "#ef4444", marginBottom: "16px", padding: "12px", background: "rgba(239,68,68,0.1)", borderRadius: "8px" }}>Error: {notesError}</div>}
        
        {branches.length === 0 && !notesError && <div style={{ color: text2 }}>No notes found.</div>}
        
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {branches.map(branch => {
            const semsData = allNotes[branch] || {};
            const sems = Object.keys(semsData).sort((a, b) => a.localeCompare(b));
            
            return (
              <div key={branch} style={{ background: isDark ? "rgba(255,255,255,0.02)" : "#f8fafc", border: `1px solid ${bdr}`, borderRadius: "16px", padding: "16px" }}>
                <h4 style={{ fontSize: "16px", fontWeight: 700, color: text1, margin: "0 0 16px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="ms" style={{ color: "#3b82f6", fontSize: "20px" }}>folder</span>
                  {branch}
                </h4>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {sems.map(semKey => {
                    const subjectsData = semsData[semKey]?.subjects || {};
                    const subjects = Object.keys(subjectsData);
                    if(subjects.length === 0) return null;
                    
                    return (
                      <div key={semKey} style={{ background: isDark ? "rgba(255,255,255,0.03)" : "#ffffff", border: `1px solid ${bdr}`, borderRadius: "12px", padding: "12px" }}>
                        <h5 style={{ fontSize: "14px", fontWeight: 700, color: text1, margin: "0 0 12px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className="ms" style={{ color: "#f59e0b", fontSize: "18px" }}>snippet_folder</span>
                          {semKey}
                        </h5>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {subjects.map(subject => {
                            const modulesData = subjectsData[subject]?.modules || {};
                            const modules = Object.keys(modulesData);
                            return (
                              <div key={subject} style={{ borderLeft: `2px solid ${bdr}`, paddingLeft: "12px" }}>
                                <h6 style={{ fontSize: "13px", fontWeight: 600, color: text1, margin: "0 0 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span className="ms" style={{ color: "#14b8a6", fontSize: "16px" }}>book</span>
                                  {subject}
                                </h6>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  {modules.length === 0 ? (
                                    <span style={{ fontSize: "12px", color: text2 }}>No notes uploaded yet.</span>
                                  ) : (
                                    modules.map(modKey => {
                                    const note = modulesData[modKey];
                                    return (
                                      <div key={modKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: isDark ? "rgba(255,255,255,0.04)" : "#f1f5f9", padding: "10px 14px", borderRadius: "8px" }}>
                                        <div style={{ display: "flex", flexDirection: "column" }}>
                                          <span style={{ fontSize: "14px", fontWeight: 600, color: text1 }}>{modKey}: {note.Title || note.title}</span>
                                          <span style={{ fontSize: "11px", color: text2 }}>{note.fileName || "No file"} • Uploaded by {note.uploadedBy || "Admin"}</span>
                                        </div>
                                        <button 
                                          onClick={() => handleDeleteNote(branch, semKey.replace('Sem:', ''), subject, modKey, note.resourcesPDF)}
                                          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    );
                                  }))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
