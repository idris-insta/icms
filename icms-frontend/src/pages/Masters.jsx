import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
// ─── MASTER DATA ──────────────────────────────────────────────────────────────
const Masters = () => {
  const [tab, setTab]           = useState("SKUs");
  const [skus, setSkus]         = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [ports, setPorts]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const fileInputRef = useRef(null);
  const toast = useToast();
  const tabs = ["SKUs","Suppliers","Ports"];
  const [skuSearch, setSkuSearch] = useState("");
  const filteredSkus = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    if (!q) return skus;
    return skus.filter(s => [s.sku_code, s.description, s.category, s.brand, s.backing_material, s.adhesive_type, s.color, s.thickness, s.size]
      .some(v => String(v || "").toLowerCase().includes(q)));
  }, [skus, skuSearch]);

  const tabKey = tab === "SKUs" ? "skus" : tab === "Suppliers" ? "suppliers" : "ports";

  const downloadTemplate = () => apiDownload(`/masters/${tabKey}/template`, `${tabKey}_template.csv`);

  const exportCurrent = () => {
    const rows = tab === "SKUs" ? filteredSkus : tab === "Suppliers" ? suppliers : ports;
    if (!rows.length) { toast("Nothing to export", "warn"); return; }
    const clean = rows.map(({ id, created_at, updated_at, ...rest }) => rest);
    exportCSV(clean, `${tabKey}.csv`);
    toast(`${tab} exported to CSV`, "success");
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    setUploading(true); setBulkResult(null); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await apiUpload(`/masters/${tabKey}/bulk`, fd);
      setBulkResult(result);
      load();
      toast(`Bulk upload: ${result.inserted} inserted, ${result.updated} updated`, result.errors?.length ? "warn" : "success");
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [sRes, supRes, pRes] = await Promise.all([apiFetch("/masters/skus?limit=500"), apiFetch("/masters/suppliers?limit=500"), apiFetch("/masters/ports?limit=500")]);
      setSkus(sRes.skus || []); setSuppliers(supRes.suppliers || []); setPorts(pRes.ports || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openForm = (item = null) => {
    setEditItem(item);
    if (tab === "SKUs") setForm(item ? {
      sku_code:       item.sku_code       || "",
      description:    item.description    || "",
      hsn_code:       item.hsn_code       || "",
      category:       item.category       || "",
      thickness:      item.thickness      || "",
      size:           item.size           || "",
      color:          item.color          || "",
      liner_color:    item.liner_color    || "",
      roll_weight:    item.roll_weight    != null ? item.roll_weight : "",
      item_code:      item.item_code      || "",
      shipping_marks: item.shipping_marks || "",
      weight_per_unit: item.weight_per_unit != null ? item.weight_per_unit : "",
      cbm_per_unit:   item.cbm_per_unit   != null ? item.cbm_per_unit : "",
      brand:          item.brand          || "",
      uom:            item.uom            || "",
      qty_per_pkg:    item.qty_per_pkg    != null ? item.qty_per_pkg : "",
      adhesive_type:  item.adhesive_type  || "",
      backing_material: item.backing_material || "",
      width_mm:       item.width_mm       != null ? item.width_mm : "",
      length_mtr:     item.length_mtr     != null ? item.length_mtr : "",
      density:        item.density        || "",
    } : {
      sku_code: "", description: "", hsn_code: "", category: "",
      thickness: "", size: "", color: "", liner_color: "",
      roll_weight: "", item_code: "", shipping_marks: "",
      weight_per_unit: "", cbm_per_unit: "",
      brand: "", uom: "", qty_per_pkg: "", adhesive_type: "",
      backing_material: "", width_mm: "", length_mtr: "", density: "",
    });
    if (tab === "Suppliers") setForm(item ? {
      code: item.code, name: item.name, country: item.country || "",
      base_currency: item.base_currency, contact_email: item.contact_email || "",
      payment_terms_days: item.payment_terms_days,
      port: item.port || "", city: item.city || "", avg_value_usd: item.avg_value_usd ?? 0,
      ex_rate: item.ex_rate ?? 84, duty_percent: item.duty_percent ?? 10,
      expense_inr: item.expense_inr ?? 0, target_per_month: item.target_per_month ?? 1,
    } : {
      code: "", name: "", country: "", base_currency: "USD", contact_email: "",
      payment_terms_days: 30, port: "", city: "", avg_value_usd: 0,
      ex_rate: 84, duty_percent: 10, expense_inr: 0, target_per_month: 1,
    });
    if (tab === "Ports") setForm(item ? { code: item.code, name: item.name, country: item.country, port_type: item.port_type } : { code: "", name: "", country: "", port_type: "both" });
    setShowForm(true);
  };

  const saveItem = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const endpoint = tab === "SKUs" ? "/masters/skus" : tab === "Suppliers" ? "/masters/suppliers" : "/masters/ports";
      if (editItem) await apiFetch(`${endpoint}/${editItem.id}`, { method: "PUT", body: JSON.stringify(form) });
      else          await apiFetch(endpoint, { method: "POST", body: JSON.stringify(form) });
      setShowForm(false); load(); toast(`${tab.slice(0,-1)} ${editItem ? "updated" : "created"} successfully`, "success");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const deleteItem = async (id) => {
    if (!confirm("Delete this item?")) return;
    const endpoint = tab === "SKUs" ? "/masters/skus" : tab === "Suppliers" ? "/masters/suppliers" : "/masters/ports";
    try { await apiFetch(`${endpoint}/${id}`, { method: "DELETE" }); load(); toast("Deleted successfully", "warn"); }
    catch (e) { setError(e.message); }
  };

  const inp = { border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Master Data</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={exportCurrent} title={`Export ${tab} to CSV`}
            style={{ padding: "8px 13px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            📥 Export
          </button>
          <button onClick={downloadTemplate} title={`Download ${tab} CSV template`}
            style={{ padding: "8px 13px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            📥 Template
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleBulkUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            title={`Bulk upload ${tab} from CSV`}
            style={{ padding: "8px 13px", background: uploading ? "#94a3b8" : "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, cursor: uploading ? "not-allowed" : "pointer", fontSize: 13, color: uploading ? "#fff" : "#15803d", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            {uploading ? "⏳ Uploading…" : "📤 Bulk Upload"}
          </button>
          <button onClick={() => openForm(null)} style={{ padding: "8px 14px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>+ Add {tab.slice(0, -1)}</button>
        </div>
      </div>

      {bulkResult && (
        <div style={{ background: bulkResult.errors?.length ? "#fffbeb" : "#f0fdf4", border: `1px solid ${bulkResult.errors?.length ? "#fde68a" : "#bbf7d0"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
          <span>
            ✅ <strong>{bulkResult.inserted}</strong> inserted &nbsp;·&nbsp; 🔄 <strong>{bulkResult.updated}</strong> updated &nbsp;·&nbsp; 📊 <strong>{bulkResult.total}</strong> total
            {bulkResult.errors?.length > 0 && <span style={{ color: "#b45309" }}> &nbsp;·&nbsp; ⚠️ {bulkResult.errors.length} skipped</span>}
          </span>
          <button onClick={() => setBulkResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 16 }}>×</button>
        </div>
      )}

      <Err msg={error} />

      {showForm && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
            {editItem ? "Edit" : "Add"} {tab.slice(0, -1)}
            <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748b" }}>×</button>
          </div>
          <form onSubmit={saveItem}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
              {Object.entries(form).map(([key, val]) => (
                <div key={key}>
                  <label style={lbl}>{key.replace(/_/g, " ")}</label>
                  <input style={inp} value={val ?? ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} required={["code","name","sku_code"].includes(key)} disabled={editItem && ["code","sku_code"].includes(key)} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ padding: "8px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ padding: "8px 18px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 20, width: "fit-content" }}>
        {tabs.map(t => <button key={t} onClick={() => { setTab(t); setShowForm(false); setBulkResult(null); }} style={{ padding: "7px 18px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: tab === t ? 600 : 400, background: tab === t ? "#fff" : "transparent", color: tab === t ? "#1d4ed8" : "#64748b" }}>{t}</button>)}
      </div>

      {loading ? <Spinner /> : (
        <>
          {tab === "SKUs" && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                <input value={skuSearch} onChange={e => setSkuSearch(e.target.value)} placeholder="Search code, name, group, brand, backing, color…"
                  style={{ flex: 1, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none" }} />
                <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>{filteredSkus.length} of {skus.length}</span>
              </div>
              <div style={{ overflowX: "auto", maxWidth: "100%" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 1200 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["SKU Code","Item Name","Group","Brand","Backing","Adhesive","Thickness","Size","Color","UoM","Qty/Pkg",""].map(h =>
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {filteredSkus.map((s, i) => {
                    const dash = <span style={{ color: "#cbd5e1" }}>—</span>;
                    return (
                    <tr key={s.id} style={{ borderBottom: i < filteredSkus.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "#1e40af", fontFamily: "monospace", whiteSpace: "nowrap", fontSize: 12 }}>{s.sku_code}</td>
                      <td style={{ padding: "10px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</td>
                      <td style={{ padding: "10px 12px" }}><span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "2px 8px", borderRadius: 20, fontSize: 10, whiteSpace: "nowrap" }}>{s.category || "—"}</span></td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12, whiteSpace: "nowrap" }}>{s.brand || dash}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12 }}>{s.backing_material || dash}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12, whiteSpace: "nowrap" }}>{s.adhesive_type || dash}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12 }}>{s.thickness || dash}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12, whiteSpace: "nowrap" }}>{s.size || dash}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12 }}>{[s.liner_color, s.color].filter(Boolean).join(" / ") || dash}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12 }}>{s.uom || dash}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12, textAlign: "right" }}>{s.qty_per_pkg != null && s.qty_per_pkg !== "" ? s.qty_per_pkg : dash}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => openForm(s)} style={{ padding: "4px 8px", background: "#f1f5f9", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>Edit</button>
                          <button onClick={() => deleteItem(s.id)} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#dc2626" }}>Del</button>
                        </div>
                      </td>
                    </tr>
                  );})}
                  {!filteredSkus.length && <tr><td colSpan={12} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>{skus.length ? "No matches" : "No SKUs yet — add one above"}</td></tr>}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {tab === "Suppliers" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
              {suppliers.map((s) => (
                <div key={s.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, background: "#eff6ff", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🏭</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ background: s.is_active ? "#f0fdf4" : "#fef2f2", color: s.is_active ? "#16a34a" : "#dc2626", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.is_active ? "Active" : "Inactive"}</span>
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{s.name}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>📍 {[s.city, s.country].filter(Boolean).join(", ")} · {s.base_currency}{s.port ? ` · ⚓ ${s.port}` : ""}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>✉️ {s.contact_email}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 12 }}>💳 NET {s.payment_terms_days} days</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openForm(s)} style={{ flex: 1, padding: "6px", background: "#f1f5f9", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Edit</button>
                    <button onClick={() => deleteItem(s.id)} style={{ flex: 1, padding: "6px", background: "#fef2f2", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#dc2626" }}>Deactivate</button>
                  </div>
                </div>
              ))}
              {!suppliers.length && <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 40, textAlign: "center", color: "#94a3b8" }}>No suppliers yet</div>}
            </div>
          )}

          {tab === "Ports" && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>{["Code","Name","Country","Type",""].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {ports.map((p, i) => (
                    <tr key={p.id} style={{ borderBottom: i < ports.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <td style={{ padding: "11px 14px", fontFamily: "monospace", fontWeight: 700 }}>{p.code}</td>
                      <td style={{ padding: "11px 14px" }}>{p.name}</td>
                      <td style={{ padding: "11px 14px", color: "#64748b" }}>{p.country}</td>
                      <td style={{ padding: "11px 14px" }}><span style={{ background: "#f0fdf4", color: "#16a34a", padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>{p.port_type}</span></td>
                      <td style={{ padding: "11px 14px" }}><button onClick={() => deleteItem(p.id)} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#dc2626" }}>Del</button></td>
                    </tr>
                  ))}
                  {!ports.length && <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No ports yet</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export { Masters };
