"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function DocViewerContent() {
  const searchParams = useSearchParams();
  const branch = searchParams.get("branch");
  const sem = searchParams.get("sem");
  const subject = searchParams.get("subject");
  const module = searchParams.get("module");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isImage, setIsImage] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [docBlob, setDocBlob] = useState(null);
  const [fileName, setFileName] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (!branch || !sem || !subject || !module) {
      setError("Missing document parameters.");
      setLoading(false);
      return;
    }
    
    // Set a decent fallback filename
    setFileName(`${module} - ${subject}`);

    const loadFile = async () => {
      try {
        setLoading(true);
        // First get meta to check type
        const metaRes = await fetch(`/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(module)}&type=meta`);
        const metaData = await metaRes.json();
        
        if (!metaData || !metaData.data) {
          setError("File metadata not found. The file may have been deleted.");
          setLoading(false);
          return;
        }

        const contentType = metaData.data.contentType || "application/octet-stream";
        
        // Fetch the actual file
        const fileRes = await fetch(`/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(module)}&type=file`);
        
        if (!fileRes.ok) {
          setError("Failed to load file content.");
          setLoading(false);
          return;
        }

        const blob = await fileRes.blob();

        if (contentType.startsWith("image/")) {
          setIsImage(true);
          setImageUrl(URL.createObjectURL(blob));
          setLoading(false);
          return;
        }

        if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
            contentType === "application/msword") {
          
          // Instead of rendering directly, we save the blob. 
          // The other useEffect will render it once the container is mounted.
          setDocBlob(blob);
          return;
        }

        // Fallback for unknown types
        setError(`Cannot preview file type: ${contentType}. Please download it instead.`);
        setLoading(false);

      } catch (err) {
        console.error(err);
        setError("Error loading document: " + err.message);
        setLoading(false);
      }
    };

    loadFile();
  }, [branch, sem, subject, module]);

  // Effect to handle rendering docx once blob is ready and container is present
  useEffect(() => {
    if (!docBlob || !containerRef.current) return;

    const renderDocx = () => {
      if (window.docx) {
        window.docx.renderAsync(docBlob, containerRef.current)
          .then(() => setLoading(false))
          .catch((err) => {
            console.error("Docx render error", err);
            setError("Failed to render document contents.");
            setLoading(false);
          });
      } else {
        setError("Document viewer library failed to load.");
        setLoading(false);
      }
    };

    // Load scripts if not loaded
    if (!window.docx) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/jszip/dist/jszip.min.js";
      document.body.appendChild(script);
      
      script.onload = () => {
        const docxScript = document.createElement("script");
        docxScript.src = "https://unpkg.com/docx-preview/dist/docx-preview.min.js";
        document.body.appendChild(docxScript);
        
        docxScript.onload = renderDocx;
      };
    } else {
      renderDocx();
    }

  }, [docBlob]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#f3f4f6", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header style={{ 
        backgroundColor: "#ffffff", 
        borderBottom: "1px solid #e5e7eb", 
        padding: "12px 24px", 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
        position: "sticky",
        top: 0,
        zIndex: 10
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* File Icon */}
          <div style={{ width: "40px", height: "40px", backgroundColor: "#eff6ff", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: "#3b82f6" }}>
            {isImage ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            )}
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#111827", lineHeight: 1.2 }}>{fileName}</h1>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "#6b7280" }}>{branch} • Sem {sem} • Document Preview</p>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: "12px" }}>
          <button 
            onClick={() => {
              const url = `/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(module)}&type=file`;
              const a = document.createElement("a");
              a.href = url;
              a.download = "";
              a.target = "_blank";
              a.click();
            }}
            style={{ 
              display: "flex", alignItems: "center", gap: "8px",
              padding: "8px 16px", backgroundColor: "#ffffff", color: "#374151", 
              border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", 
              fontWeight: 500, fontSize: "0.875rem", transition: "all 0.2s" 
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download Original
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: "24px", display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto" }}>
        
        {loading && !error && (
          <div style={{ 
            marginTop: "10vh", display: "flex", flexDirection: "column", alignItems: "center", 
            gap: "24px", background: "white", padding: "40px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)" 
          }}>
            <div style={{ width: "48px", height: "48px", border: "4px solid #e2e8f0", borderTop: "4px solid #3b82f6", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
            <p style={{ color: "#475569", fontWeight: 500, fontSize: "1.1rem" }}>Preparing document preview...</p>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && (
          <div style={{ 
            marginTop: "10vh", maxWidth: "480px", background: "#fef2f2", 
            border: "1px solid #fecaca", padding: "24px", borderRadius: "12px", 
            display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", textAlign: "center"
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div>
              <h3 style={{ margin: "0 0 8px 0", color: "#991b1b", fontSize: "1.25rem" }}>Preview Unavailable</h3>
              <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p>
            </div>
            <button 
              onClick={() => {
                const url = `/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(module)}&type=file`;
                const a = document.createElement("a");
                a.href = url;
                a.download = "";
                a.target = "_blank";
                a.click();
              }}
              style={{ padding: "10px 20px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600, marginTop: "8px" }}
            >
              Download File Instead
            </button>
          </div>
        )}

        <div 
          style={{ 
            display: (loading || error) ? "none" : "block", 
            width: "100%", 
            maxWidth: "1200px", 
            backgroundColor: "#ffffff", 
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)", 
            borderRadius: "8px", 
            overflow: "hidden" 
          }}
        >
          {isImage && imageUrl && (
            <div style={{ padding: "40px", display: "flex", justifyContent: "center" }}>
              <img src={imageUrl} alt="Document Preview" style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain", border: "1px solid #e2e8f0", borderRadius: "4px" }} />
            </div>
          )}
          
          {/* Docx Container - Always in DOM so ref works, but hidden until loaded */}
          <div 
            ref={containerRef} 
            style={{ 
              width: "100%", 
              minHeight: "80vh",
              display: isImage ? "none" : "block",
              // docx-preview styling tweaks
              "& .docx-wrapper": { background: "transparent", padding: 0 },
              "& .docx": { boxShadow: "none", margin: "0 auto" }
            }}
          ></div>
        </div>
      </main>
    </div>
  );
}

export default function DocViewer() {
  return (
    <Suspense fallback={
      <div style={{ height: "100vh", display: "flex", justifyContent: "center", alignItems: "center", background: "#f3f4f6" }}>
        <div style={{ width: "40px", height: "40px", border: "4px solid #e2e8f0", borderTop: "4px solid #3b82f6", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <DocViewerContent />
    </Suspense>
  );
}
