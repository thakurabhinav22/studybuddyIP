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

  const handleRenameNode = async (oldName) => {
    const newName = prompt(`Rename '${oldName}' to:`, oldName);
    if (!newName || newName === oldName) return;
    
    const buildPath = (pathArr, targetName) => {
      let p = "notes";
      if (pathArr.length >= 1) p += `/${pathArr.length === 1 ? targetName : pathArr[0]}`;
      if (pathArr.length >= 2) p += `/${pathArr.length === 2 ? targetName : pathArr[1]}`;
      if (pathArr.length >= 3) p += `/subjects/${pathArr.length === 3 ? targetName : pathArr[2]}`;
      if (pathArr.length >= 4) p += `/modules/${pathArr.length === 4 ? targetName : pathArr[3]}`;
      return p;
    };

    const oldDbPath = buildPath([...fileExplorerPath, oldName], oldName);
    const newDbPath = buildPath([...fileExplorerPath, newName], newName);
    
    if (confirm(`Are you sure you want to rename this to '${newName}'?`)) {
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
    }
  };

  const renderManageNotes = () => {
    let currentDir = allNotes || {};
    let level = fileExplorerPath.length;
    
    if (level > 0) currentDir = currentDir[fileExplorerPath[0]] || {};
    if (level > 1) currentDir = currentDir[fileExplorerPath[1]]?.subjects || {};
    if (level > 2) currentDir = currentDir[fileExplorerPath[2]]?.modules || {};
    
    const items = Object.keys(currentDir).sort((a,b) => a.localeCompare(b));

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
                <div key={item} style={{ background: isDark ? "rgba(15,23,42,0.6)" : "#ffffff", border: `1px solid ${bdr}`, borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", cursor: isFile ? "default" : "pointer" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = isDark ? "0 12px 24px rgba(0,0,0,0.4)" : "0 12px 24px rgba(0,0,0,0.05)"; e.currentTarget.style.borderColor = levelMeta.color; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = bdr; }}
                  onClick={(e) => {
                    // Prevent navigation if clicking on buttons
                    if (e.target.closest('button')) return;
                    if (!isFile) navigateTo(item);
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: levelMeta.bg, color: levelMeta.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span className="ms" style={{ fontSize: "20px" }}>{levelMeta.icon}</span>
                    </div>
                    
                    {/* Action Menu (Inline) */}
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button onClick={() => handleRenameNode(item)} title="Rename" style={{ width: "32px", height: "32px", borderRadius: "8px", background: "transparent", border: "none", color: text3, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.1)" : "#f1f5f9"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span className="ms" style={{ fontSize: "16px" }}>edit</span>
                      </button>
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
