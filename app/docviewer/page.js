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
  const containerRef = useRef(null);

  useEffect(() => {
    if (!branch || !sem || !subject || !module) {
      setError("Missing parameters");
      setLoading(false);
      return;
    }

    const loadFile = async () => {
      try {
        setLoading(true);
        // First get meta to check type
        const metaRes = await fetch(`/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(module)}&type=meta`);
        const metaData = await metaRes.json();
        
        if (!metaData || !metaData.data) {
          setError("File metadata not found");
          setLoading(false);
          return;
        }

        const contentType = metaData.data.contentType || "application/octet-stream";
        
        // Fetch the actual file
        const fileRes = await fetch(`/api/notes/pdf?branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}&subject=${encodeURIComponent(subject)}&module=${encodeURIComponent(module)}&type=file`);
        
        if (!fileRes.ok) {
          setError("Failed to load file content");
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
          // Load docx-preview script dynamically
          const script = document.createElement("script");
          script.src = "https://unpkg.com/jszip/dist/jszip.min.js";
          document.body.appendChild(script);
          
          script.onload = () => {
            const docxScript = document.createElement("script");
            docxScript.src = "https://unpkg.com/docx-preview/dist/docx-preview.min.js";
            document.body.appendChild(docxScript);
            
            docxScript.onload = () => {
              if (window.docx && containerRef.current) {
                window.docx.renderAsync(blob, containerRef.current)
                  .then(() => setLoading(false))
                  .catch((err) => {
                    console.error("Docx render error", err);
                    setError("Failed to render document");
                    setLoading(false);
                  });
              } else {
                setError("Failed to load document viewer");
                setLoading(false);
              }
            };
          };
          return;
        }

        // Fallback for unknown types
        setError(`Cannot view file type: ${contentType}. Please download it instead.`);
        setLoading(false);

      } catch (err) {
        console.error(err);
        setError("Error loading document: " + err.message);
        setLoading(false);
      }
    };

    loadFile();
  }, [branch, sem, subject, module]);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "20px", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto", background: "#fff", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", padding: "20px", minHeight: "80vh" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: "16px", marginBottom: "20px" }}>
          <h1 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#0f172a" }}>Document Viewer</h1>
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
              style={{ padding: "8px 16px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600 }}
            >
              Download
            </button>
            <button 
              onClick={() => window.close()} 
              style={{ padding: "8px 16px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600 }}
            >
              Close
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh", flexDirection: "column", gap: "16px" }}>
            <div style={{ width: "40px", height: "40px", border: "4px solid #f1f5f9", borderTop: "4px solid #3b82f6", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
            <p style={{ color: "#64748b", fontWeight: 500 }}>Loading document...</p>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
            <div style={{ background: "#fef2f2", color: "#ef4444", padding: "16px 24px", borderRadius: "8px", fontWeight: 600 }}>
              {error}
            </div>
          </div>
        )}

        {!loading && !error && (
          <div style={{ width: "100%", overflowX: "auto" }}>
            {isImage ? (
              <img src={imageUrl} alt="Document" style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }} />
            ) : (
              <div ref={containerRef} style={{ width: "100%", minHeight: "500px" }}></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocViewer() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Loading viewer...</div>}>
      <DocViewerContent />
    </Suspense>
  );
}
