import { useState, useEffect, useCallback } from "react";
import { apiFetch, useToast, Spinner, Err } from "../lib/core";

const FREQS = [["weekly","Weekly (7d)"],["biweekly","Every 15 days"],["monthly","Monthly (30d)"],["custom","Custom"]];
const CONTAINERS = ["20FT","40FT","40HC"];

// ─── ORDER SCHEDULER ──────────────────────────────────────────────────────────
const Scheduler = () => {
  const [tab, setTab]         = useState("schedules");
  const [schedules, setSchedules] = useState([]);
  const [calendar, setCalendar]   = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [skus, setSkus]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState(null);
  const toast = useToast();

  const blank = { supplier_id: "", sku_id: "", item_name: "", container_type: "40HC", currency: "USD",
    qty_per_shipment: 1, frequency: "weekly", interval_days: 7, total_shipments: 8,
    start_date: new Date().toISOString().split("T")[0], notes: "" };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [sc, cal, sup, sk] = await Promise.all([
        apiFetch("/schedules"),
        apiFetch("/schedules/calendar"),
        apiFetch("/masters/suppliers?limit=500"),
        apiFetch("/masters/skus?limit=500"),
      ]);
      setSchedules(sc.schedules || []); setCalendar(cal.events || []);
      setSuppliers(sup.suppliers || []); setSkus(sk.skus || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.supplier_id) { toast("Pick a supplier", "warn"); return; }
    try {
      if (form.id) await apiFetch(`/schedules/${form.id}`, { method: "PUT", body: JSON.stringify(form) });
      else         await apiFetch("/schedules", { method: "POST", body: JSON.stringify(form) });
      setShowForm(false); setForm(null); load();
      toast("Schedule saved", "success");
    } catch (e) { setError(e.message); }
  };
  const genOrder = async (id) => {
    try { const r = await apiFetch(`/schedules/${id}/generate`, { method: "POST" }); toast(`Order ${r.po_number} created (shipment ${r.shipment})`, "success"); load(); }
    catch (e) { toast(e.message, "error"); }
  };
  const del = async (id) => {
    if (!confirm("Delete this schedule line?")) return;
    try { await apiFetch(`/schedules/${id}`, { method: "DELETE" }); load(); toast("Deleted", "warn"); }
    catch (e) { setError(e.message); }
  };

  const inp = { border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 };
  const th  = { padding: "9px 11px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 10, textTransform: "uppercase", textAlign: "left", whiteSpace: "nowrap", border: "1px solid #2d4f7f" };
  const td  = { padding: "8px 11px", border: "1px solid #eef1f5", fontSize: 12 };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Order Scheduler</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>Give suppliers a shipping plan — e.g. this item 1 container weekly, that one every 15 days</p>
        </div>
        <button onClick={() => { setForm({ ...blank }); setShowForm(true); }} style={{ padding: "8px 14px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>+ New Schedule</button>
      </div>
      <Err msg={error} />

      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 18, width: "fit-content" }}>
        {[["schedules","📋 Schedule Lines"],["calendar","📅 Shipment Calendar"]].map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: tab === t ? 700 : 400, background: tab === t ? "#fff" : "transparent", color: tab === t ? "#1d4ed8" : "#64748b" }}>{l}</button>
        ))}
      </div>

      {showForm && form && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20, marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>{form.id ? "Edit" : "New"} Schedule</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
            <div><label style={lbl}>Supplier *</label>
              <select style={inp} value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
                <option value="">Select…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select></div>
            <div><label style={lbl}>Item (from master)</label>
              <select style={inp} value={form.sku_id} onChange={e => { const sk = skus.find(x => String(x.id) === e.target.value); setForm(f => ({ ...f, sku_id: e.target.value, item_name: sk?.description || f.item_name })); }}>
                <option value="">— optional —</option>
                {skus.map(s => <option key={s.id} value={s.id}>{s.description || s.sku_code}</option>)}
              </select></div>
            <div><label style={lbl}>Item Name</label><input style={inp} value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} placeholder="e.g. BOPP TAPE" /></div>
            <div><label style={lbl}>Container</label>
              <select style={inp} value={form.container_type} onChange={e => setForm(f => ({ ...f, container_type: e.target.value }))}>{CONTAINERS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div><label style={lbl}>Frequency</label>
              <select style={inp} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>{FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            {form.frequency === "custom" && <div><label style={lbl}>Interval (days)</label><input style={inp} type="number" value={form.interval_days} onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))} /></div>}
            <div><label style={lbl}>Containers / shipment</label><input style={inp} type="number" value={form.qty_per_shipment} onChange={e => setForm(f => ({ ...f, qty_per_shipment: e.target.value }))} /></div>
            <div><label style={lbl}>Total shipments</label><input style={inp} type="number" value={form.total_shipments} onChange={e => setForm(f => ({ ...f, total_shipments: e.target.value }))} /></div>
            <div><label style={lbl}>Start date</label><input style={inp} type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div style={{ gridColumn: "span 2" }}><label style={lbl}>Notes</label><input style={inp} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowForm(false); setForm(null); }} style={{ padding: "8px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
            <button onClick={save} style={{ padding: "8px 18px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>Save</button>
          </div>
        </div>
      )}

      {loading ? <Spinner /> : tab === "schedules" ? (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
              <thead><tr>{["Supplier","Item","Container","Frequency","Per Ship","Done / Total","Next Date","Status",""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {schedules.map((s, i) => (
                  <tr key={s.id} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                    <td style={{ ...td, fontWeight: 600 }}>{s.supplier_code} — {s.supplier}</td>
                    <td style={td}>{s.item_name || s.sku_desc || "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>{s.container_type}</td>
                    <td style={{ ...td, textTransform: "capitalize" }}>{s.frequency} <span style={{ color: "#94a3b8" }}>({s.interval_effective}d)</span></td>
                    <td style={{ ...td, textAlign: "center" }}>{s.qty_per_shipment}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{s.generated_count} / {s.total_shipments}</td>
                    <td style={{ ...td, fontWeight: 600, color: "#1d4ed8" }}>{s.next_date || "—"}</td>
                    <td style={td}><span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: s.status === "active" ? "#f0fdf4" : "#f1f5f9", color: s.status === "active" ? "#15803d" : "#64748b", textTransform: "uppercase" }}>{s.status}</span></td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button disabled={s.remaining === 0} onClick={() => genOrder(s.id)} title="Create next order" style={{ padding: "4px 8px", background: s.remaining ? "#eff6ff" : "#f1f5f9", border: "none", borderRadius: 5, cursor: s.remaining ? "pointer" : "not-allowed", fontSize: 11, color: s.remaining ? "#1d4ed8" : "#cbd5e1", fontWeight: 600 }}>+ Order</button>
                        <button onClick={() => { setForm({ ...s, start_date: (s.start_date || "").split("T")[0] }); setShowForm(true); }} style={{ padding: "4px 8px", background: "#f1f5f9", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>Edit</button>
                        <button onClick={() => del(s.id)} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#dc2626" }}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!schedules.length && <tr><td colSpan={9} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No schedules yet — add one to plan supplier shipments</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "11px 16px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 13 }}>📅 Upcoming Shipments — share with suppliers ({calendar.length})</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
              <thead><tr>{["Date","Supplier","Item","Container","Qty","Shipment #","Frequency"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {calendar.map((e, i) => {
                  const overdue = e.date < new Date().toISOString().split("T")[0];
                  return (
                  <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                    <td style={{ ...td, fontWeight: 700, color: overdue ? "#dc2626" : "#1d4ed8" }}>{overdue ? "⚠️ " : ""}{e.date}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{e.supplier_code} — {e.supplier}</td>
                    <td style={td}>{e.item}</td>
                    <td style={{ ...td, textAlign: "center" }}>{e.container_type}</td>
                    <td style={{ ...td, textAlign: "center" }}>{e.qty_per_shipment}</td>
                    <td style={{ ...td, textAlign: "center" }}>{e.seq} / {e.total}</td>
                    <td style={{ ...td, textTransform: "capitalize" }}>{e.frequency}</td>
                  </tr>
                );})}
                {!calendar.length && <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No upcoming shipments scheduled</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export { Scheduler };
