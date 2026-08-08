import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
const Documents = () => {
  const [docs, setDocs]         = useState([]);
  const [orders, setOrders]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [uploading, setUploading] = useState(false);
  const [orderId, setOrderId]   = useState("");
  const [docType, setDocType]   = useState("Bill of Lading");
  const fileRef                 = useRef();
  const DOC_TYPES = ["Bill of Lading","Commercial Invoice","Packing List","Certificate of Origin","Customs Declaration","Other"];

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [dRes, oRes] = await Promise.all([apiFetch("/documents"), apiFetch("/orders")]);
      setDocs(dRes.documents || []); setOrders(oRes.orders || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file || !orderId) { if (!orderId) setError("Select an order first"); return; }
    setUploading(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("order_id", orderId); fd.append("doc_type", docType);
      const doc = await apiUpload("/documents/upload", fd);
      setDocs(prev => [doc, ...prev]);
      fileRef.current.value = "";
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  };

  const deleteDoc = async (id) => {
    if (!confirm("Delete this document?")) return;
    try { await apiFetch(`/documents/${id}`, { method: "DELETE" }); setDocs(d => d.filter(x => x.id !== id)); }
    catch (e) { setError(e.message); }
  };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Document Vault</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>All import documents in one place</p>
        </div>
      </div>
      <Err msg={error} />

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📤 Upload Document</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>ORDER</label>
            <select value={orderId} onChange={e => setOrderId(e.target.value)} style={{ width: "100%", padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, outline: "none" }}>
              <option value="">Select order…</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.po_number}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>DOCUMENT TYPE</label>
            <select value={docType} onChange={e => setDocType(e.target.value)} style={{ width: "100%", padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, outline: "none" }}>
              {DOC_TYPES.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <input ref={fileRef} type="file" onChange={upload} disabled={uploading} style={{ display: "none" }} />
            <button onClick={() => fileRef.current.click()} disabled={uploading} style={{ padding: "9px 16px", background: uploading ? "#94a3b8" : "#3b82f6", border: "none", borderRadius: 8, cursor: uploading ? "not-allowed" : "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>{uploading ? "Uploading…" : "📁 Choose File"}</button>
          </div>
        </div>
      </div>

      {loading ? <Spinner /> : (
        <div>
          {docs.map((d, i) => (
            <div key={d.id} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "14px 18px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 40, height: 40, background: d.filename.endsWith(".pdf") ? "#fef2f2" : "#f0fdf4", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{d.filename.endsWith(".pdf") ? "📕" : "📗"}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{d.original_name}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{d.doc_type} · {d.po_number} · {d.file_size ? `${Math.round(d.file_size / 1024)} KB` : ""}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>{d.created_at?.split("T")[0]}</span>
                <span style={{ background: "#f0fdf4", color: "#16a34a", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>✓ Uploaded</span>
                <button onClick={() => apiDownload(`/documents/${d.id}/download`, d.original_name)} style={{ padding: "5px 10px", background: "#eff6ff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#3b82f6" }}>Download</button>
                <button onClick={() => deleteDoc(d.id)} style={{ padding: "5px 10px", background: "#fef2f2", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#dc2626" }}>Delete</button>
              </div>
            </div>
          ))}
          {!docs.length && <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 40, textAlign: "center", color: "#94a3b8" }}>No documents uploaded yet</div>}
        </div>
      )}
    </div>
  );
};

export { Documents };
