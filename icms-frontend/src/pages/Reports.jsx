import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
// ─── REPORTS ─────────────────────────────────────────────────────────────────
const Reports = () => {
  const [tab, setTab]     = useState("supplier");
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tabs = [["supplier","Supplier Summary"],["container","Container Report"],["tracking","Tracking"]];
  const toast = useToast();
  const exportReport = () => {
    if (!data || !data.length) { toast("Nothing to export", "warn"); return; }
    exportCSV(data, `report_${tab}.csv`);
    toast("Report exported to CSV", "success");
  };

  useEffect(() => {
    setLoading(true); setError(""); setData(null);
    const endpoint = tab === "supplier" ? "/reports/supplier-summary" : tab === "container" ? "/reports/containers" : "/reports/tracking";
    apiFetch(endpoint).then(r => setData(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [tab]);

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Reports & Analytics</h1>
        <button onClick={exportReport} style={{ padding: "8px 14px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500 }}>📥 Export CSV</button>
      </div>
      <Err msg={error} />

      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 20, width: "fit-content" }}>
        {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} style={{ padding: "7px 16px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: tab === id ? 600 : 400, background: tab === id ? "#fff" : "transparent", color: tab === id ? "#1d4ed8" : "#64748b", whiteSpace: "nowrap" }}>{label}</button>)}
      </div>

      {loading && <Spinner />}

      {!loading && tab === "supplier" && data && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc" }}>{["Supplier","Currency","Pending POs","Pending Value","Shipped POs","Shipped Value","Delivered Value","Balance Due"].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
            <tbody>
              {(data || []).map((s, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "11px 12px", fontWeight: 600 }}>{s.supplier}</td>
                  <td style={{ padding: "11px 12px", color: "#64748b" }}>{s.currency}</td>
                  <td style={{ padding: "11px 12px", textAlign: "center" }}><span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.pending_pos}</span></td>
                  <td style={{ padding: "11px 12px", fontWeight: 600 }}>{fmtUSD(s.pending_value)}</td>
                  <td style={{ padding: "11px 12px", textAlign: "center" }}><span style={{ background: "#fffbeb", color: "#92400e", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.shipped_pos}</span></td>
                  <td style={{ padding: "11px 12px" }}>{fmtUSD(s.shipped_value)}</td>
                  <td style={{ padding: "11px 12px", color: "#059669", fontWeight: 600 }}>{fmtUSD(s.delivered_value)}</td>
                  <td style={{ padding: "11px 12px", color: "#dc2626", fontWeight: 700 }}>{fmtUSD(s.balance_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === "container" && data && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc" }}>{["Type","Count","Avg Utilization","Total Weight","Total CBM","Total Value"].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
            <tbody>
              {(data || []).map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "11px 12px", fontWeight: 700 }}>{r.container_type}</td>
                  <td style={{ padding: "11px 12px" }}>{r.total_containers}</td>
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 60 }}><Progress value={parseFloat(r.avg_utilization)} /></div>
                      <span style={{ fontWeight: 700 }}>{parseFloat(r.avg_utilization || 0).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "11px 12px" }}>{(parseFloat(r.total_weight || 0) / 1000).toFixed(1)}t</td>
                  <td style={{ padding: "11px 12px" }}>{parseFloat(r.total_cbm || 0).toFixed(0)} m³</td>
                  <td style={{ padding: "11px 12px", fontWeight: 600, color: "#059669" }}>{fmtUSD(r.total_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === "tracking" && data && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc" }}>{["PO Number","Supplier","Container","Status","ETA","Value","Utilization"].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
            <tbody>
              {(data || []).map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "11px 12px", fontWeight: 700, color: "#3b82f6" }}>{r.po_number}</td>
                  <td style={{ padding: "11px 12px" }}>{r.supplier}</td>
                  <td style={{ padding: "11px 12px", color: "#64748b" }}>{r.container_type}</td>
                  <td style={{ padding: "11px 12px" }}><Badge status={r.status} /></td>
                  <td style={{ padding: "11px 12px", color: "#64748b" }}>{r.eta ? r.eta.split("T")[0] : "—"}</td>
                  <td style={{ padding: "11px 12px", fontWeight: 600, color: "#059669" }}>{fmtUSD(r.total_value)}</td>
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 50 }}><Progress value={parseFloat(r.utilization_percentage)} /></div>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{parseFloat(r.utilization_percentage || 0).toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export { Reports };
