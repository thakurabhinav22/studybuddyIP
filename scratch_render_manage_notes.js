  const navigateTo = (folderName) => {
    setFileExplorerPath([...fileExplorerPath, folderName]);
  };

  const navigateUp = (index) => {
    setFileExplorerPath(fileExplorerPath.slice(0, index + 1));
  };

  const handleRenameNode = async (oldName) => {
    const newName = prompt(`Rename ${oldName} to:`, oldName);
    if (!newName || newName === oldName) return;
    
    // Construct paths
    let oldDbPath = "notes";
    let newDbPath = "notes";
    
    const buildPath = (pathArr, targetName) => {
      let p = "notes";
      if (pathArr.length >= 1) p += `/${pathArr.length === 1 ? targetName : pathArr[0]}`; // Branch
      if (pathArr.length >= 2) p += `/${pathArr.length === 2 ? targetName : pathArr[1]}`; // Sem
      if (pathArr.length >= 3) p += `/subjects/${pathArr.length === 3 ? targetName : pathArr[2]}`; // Subject
      if (pathArr.length >= 4) p += `/modules/${pathArr.length === 4 ? targetName : pathArr[3]}`; // Module
      return p;
    };

    const currentLevel = fileExplorerPath.length + 1;
    oldDbPath = buildPath([...fileExplorerPath, oldName], oldName);
    newDbPath = buildPath([...fileExplorerPath, newName], newName);
    
    if (confirm(`Are you sure you want to rename to ${newName}? This might affect student side if they depend on exact names.`)) {
      try {
        const snap = await get(dbRef(db, oldDbPath));
        if (snap.exists()) {
          await set(dbRef(db, newDbPath), snap.val());
          await remove(dbRef(db, oldDbPath));
          fetchNotes(); // Refresh
        }
      } catch (err) {
        alert("Failed to rename: " + err.message);
      }
    }
  };

  const renderManageNotes = () => {
    // Determine current directory contents
    let currentDir = allNotes || {};
    let level = fileExplorerPath.length; // 0=Branch, 1=Sem, 2=Subject, 3=Module
    
    if (level > 0) currentDir = currentDir[fileExplorerPath[0]] || {};
    if (level > 1) currentDir = currentDir[fileExplorerPath[1]]?.subjects || {};
    if (level > 2) currentDir = currentDir[fileExplorerPath[2]]?.modules || {};
    
    const items = Object.keys(currentDir).sort((a,b) => a.localeCompare(b));

    return (
      <div className="admin-card" style={{ minHeight: "400px", display: "flex", flexDirection: "column" }}>
        <h3 style={{ fontSize: "18px", fontWeight: 700, color: text1, margin: 0, marginBottom: "16px" }}>Manage Uploaded Notes</h3>
        
        {notesError && <div style={{ color: "#ef4444", marginBottom: "16px", padding: "12px", background: "rgba(239,68,68,0.1)", borderRadius: "8px" }}>Error: {notesError}</div>}
        
        {/* Breadcrumbs */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", padding: "12px 16px", borderRadius: "12px", marginBottom: "20px", overflowX: "auto" }}>
          <button onClick={() => setFileExplorerPath([])} style={{ background: "transparent", border: "none", color: level === 0 ? text1 : text3, cursor: "pointer", fontWeight: level === 0 ? 700 : 500, fontSize: "14px", display: "flex", alignItems: "center", gap: "4px" }}>
            <span className="ms" style={{ fontSize: "18px" }}>home</span> Root
          </button>
          
          {fileExplorerPath.map((pathItem, index) => (
            <div key={index} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="ms" style={{ color: text3, fontSize: "16px" }}>chevron_right</span>
              <button 
                onClick={() => navigateUp(index)}
                style={{ background: "transparent", border: "none", color: index === level - 1 ? text1 : text3, cursor: "pointer", fontWeight: index === level - 1 ? 700 : 500, fontSize: "14px" }}
              >
                {pathItem}
              </button>
            </div>
          ))}
        </div>

        {/* Folder Contents */}
        {items.length === 0 && !notesError ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: text3, gap: "12px" }}>
            <span className="ms" style={{ fontSize: "48px", opacity: 0.5 }}>folder_open</span>
            <p>This folder is empty.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
            {items.map(item => {
              const isFile = level === 3;
              const noteData = isFile ? currentDir[item] : null;
              
              return (
                <div key={item} style={{ background: isDark ? "rgba(255,255,255,0.03)" : "#ffffff", border: `1px solid ${bdr}`, borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", position: "relative", transition: "transform 0.2s, box-shadow 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 10px 25px rgba(0,0,0,0.1)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  <div 
                    onClick={() => !isFile && navigateTo(item)}
                    style={{ display: "flex", alignItems: "center", gap: "12px", cursor: isFile ? "default" : "pointer" }}
                  >
                    <span className="ms" style={{ fontSize: "32px", color: isFile ? "#ef4444" : "#3b82f6" }}>
                      {isFile ? "picture_as_pdf" : "folder"}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item}>
                        {item}
                      </span>
                      {isFile && noteData && (
                        <span style={{ fontSize: "11px", color: text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={noteData.fileName}>
                          {noteData.fileName || "No file"}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "auto", borderTop: `1px solid ${bdr}`, paddingTop: "12px" }}>
                    <button onClick={() => handleRenameNode(item)} style={{ flex: 1, padding: "6px 0", background: isDark ? "rgba(255,255,255,0.1)" : "#f1f5f9", border: "none", borderRadius: "6px", color: text1, fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                      <span className="ms" style={{ fontSize: "14px" }}>edit</span> Rename
                    </button>
                    {isFile && (
                      <button 
                        onClick={() => handleDeleteNote(fileExplorerPath[0], fileExplorerPath[1].replace('Sem:', ''), fileExplorerPath[2], item, noteData?.resourcesPDF)}
                        style={{ padding: "6px 12px", background: "rgba(239,68,68,0.1)", border: "none", borderRadius: "6px", color: "#ef4444", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                      >
                        Delete
                      </button>
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
