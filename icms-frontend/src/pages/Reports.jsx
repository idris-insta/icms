import { useState, useEffect } from "react";
import { apiFetch, useToast, exportCSV, fmtINR, fmtUSD, BarChart, Badge, Spinner, Err, Ic } from "../lib/core";

// ─── cell formatters ──────────────────────────────────────────────────────────
const F = {
  usd:  (v) => fmtUSD(v),
  inr:  (v) => fmtINR(v),
  pct:  (v) => v == null ? "—" : v + "%",
  n4:   (v) => v == null ? "—" : Number(v).toFixed(4),
  n2:   (v) => v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }),
  date: (v) => v ? String(v).slice(0, 10) : "—",
  int:  (v) => v == null ? "—" : Number(v).toLocaleString(),
  c:    (v) => v == null ? "—" : v,
};

// ─── report definitions: [key, header, format, flag] ──────────────────────────
const REPORTS = [
  { id: "supplier", label: "Supplier Summary",
    load: async () => ({ rows: (await apiFetch("/reports/supplier-summary")).data }),
    cols: [["supplier","Supplier"],["currency","Cur"],["pending_pos","Pending POs","c"],["pending_value","Pending $","usd"],["shipped_value","Shipped $","usd"],["delivered_value","Delivered $","usd"],["balance_due","Balance $","usd","red"]] },

  { id: "scorecard", label: "Supplier Scorecard",
    load: async () => ({ rows: (await apiFetch("/reports/supplier-scorecard")).data }),
    cols: [["name","Supplier"],["orders","Orders","c"],["volume_usd","Volume $","usd"],["on_time_pct","On-time %","pct"],["avg_lead_days","Avg lead (d)","c"],["avg_usd_rate","Avg ₹ rate","n4"],["avg_freight","Avg freight $","usd"]] },

  { id: "cycle", label: "Cycle Time",
    load: async () => {
      const r = await apiFetch("/reports/cycle-time");
      return {
        rows: r.stages,
        summary: `Average total cycle: ${r.total_cycle ?? "—"} days`,
        chart: r.stages.map(s => ({ label: (s.stage.split(" → ")[1] || s.stage), value: s.days || 0 })),
      };
    },
    cols: [["stage","Stage"],["days","Avg days","c"]] },

  { id: "fximpact", label: "FX Impact",
    load: async () => {
      const r = await apiFetch("/reports/fx-impact");
      const t = r.total_fx_impact_inr;
      return { rows: r.data, summary: `Portfolio FX impact: ${fmtINR(t)}${t > 0 ? " (paid more)" : t < 0 ? " (saved)" : ""}` };
    },
    cols: [["po_number","PO"],["supplier","Supplier"],["cif_usd","CIF $","usd"],["rate_delivery","Rate @ del","n4"],["rate_payment","Rate @ pay","n4"],["fx_impact_inr","FX Δ ₹","inr","red"]] },

  { id: "landed", label: "Landed Cost",
    load: async () => ({ rows: (await apiFetch("/costing/containers")).containers }),
    cols: [["po_number","PO"],["supplier","Supplier"],["goods_value","Goods $","usd"],["cif_inr","CIF ₹","inr"],["duty_amount_inr","Duty ₹","inr"],["landed_cost_inr","Landed ₹","inr"],["landed_per_roll_inr","₹/Roll","n2"],["cp_factor","CP ₹/$","n2"]] },

  { id: "payables", label: "Payables Aging",
    load: async () => {
      const r = await apiFetch("/financial/cashflow-forecast");
      const tag = { overdue: "Overdue", this_week: "This week", this_month: "This month", later: "Later" };
      const rows = [];
      Object.keys(tag).forEach(k => (r.buckets[k] || []).forEach(x => rows.push({ ...x, bucket: tag[k] })));
      return { rows, summary: `Overdue ${fmtINR(r.value.overdue)} · This week ${fmtINR(r.value.this_week)} · This month ${fmtINR(r.value.this_month)}` };
    },
    cols: [["bucket","Due"],["po_number","PO"],["supplier","Supplier"],["payment_due_date","Due date","date"],["invoiced","Invoiced $","usd"],["paid","Paid $","usd"],["outstanding","Outstanding $","usd","red"]] },

  { id: "priceforecast", label: "Price Forecast",
    load: async () => ({ rows: (await apiFetch("/analytics/price-forecast")).data }),
    cols: [["item_name","Item"],["thickness","Thick"],["size","Size"],["n","Orders","c"],["first_price","First $","n4"],["last_price","Last $","n4"],["projected_next","Projected $","n4"],["change_pct","Trend %","pct"],["direction","Dir"]] },

  { id: "predicteta", label: "Predicted ETA",
    load: async () => {
      const r = await apiFetch("/analytics/predict-eta");
      const s = r.suppliers.filter(x => x.avg_transit_days != null).map(x => `${x.name} ${x.avg_transit_days}d`).join(" · ");
      return { rows: r.predictions, summary: s ? `Average transit — ${s}` : "" };
    },
    cols: [["po_number","PO"],["supplier","Supplier"],["shipment_date","Shipped","date"],["transit_days","Transit (d)","c"],["booked_eta","Booked ETA","date"],["predicted_eta","Predicted ETA","date"]] },

  { id: "variance", label: "Qty Variance",
    load: async () => ({ rows: (await apiFetch("/reports/variance")).data }),
    cols: [["sku_code","SKU"],["description","Description"],["ordered_qty","Ordered","int"],["avg_weight_variance","Wt variance","n2"],["avg_cbm_variance","CBM variance","n2"]] },

  { id: "tracking", label: "In-Transit Tracking",
    load: async () => ({ rows: (await apiFetch("/reports/tracking")).data }),
    cols: [["po_number","PO"],["supplier","Supplier"],["container_type","Cont."],["status","Status","badge"],["eta","ETA","date"],["total_value","Value $","usd"]] },
];

const align = (c) => c[2] === "c" ? "center" : (["usd","inr","n4","n2","int","pct"].includes(c[2]) ? "right" : "left");
const cell = (row, c) => {
  const [k, , f, flag] = c;
  const v = row[k];
  if (f === "badge") return <Badge status={v} />;
  const out = F[f] ? F[f](v) : (v ?? "—");
  if (flag === "red" && typeof v === "number") {
    return <span style={{ color: v < 0 ? "#15803d" : "#dc2626", fontWeight: 700 }}>{out}</span>;
  }
  return <span>{out}</span>;
};

// Open a clean print/PDF window for the active report
function printReport(title, cols, rows) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const head = cols.map(c => `<th style="text-align:${align(c)}">${esc(c[1])}</th>`).join("");
  const body = rows.map(r => "<tr>" + cols.map(c => {
    const fn = F[c[2]];
    const txt = c[2] === "badge" ? r[c[0]] : (fn ? fn(r[c[0]]) : (r[c[0]] ?? "—"));
    return `<td style="text-align:${align(c)}">${esc(txt)}</td>`;
  }).join("") + "</tr>").join("");
  w.document.write(`<html><head><title>${esc(title)}</title><style>
    body{font:12px system-ui,sans-serif;padding:24px;color:#0f172a}
    h1{font-size:18px;margin:0 0 4px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border:1px solid #cbd5e1;padding:6px 8px}
    th{background:#1e3a5f;color:#fff;font-size:10px;text-transform:uppercase}
  </style></head><body><h1>${esc(title)}</h1>
  <div style="color:#64748b">${new Date().toLocaleString()}</div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

const btn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500 };

// ─── REPORTS PAGE ─────────────────────────────────────────────────────────────
const Reports = () => {
  const [tab, setTab] = useState("supplier");
  const [state, setState] = useState({ rows: [], summary: "", chart: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const def = REPORTS.find(r => r.id === tab);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setState({ rows: [], summary: "", chart: null });
    def.load()
      .then(r => { if (alive) setState({ rows: r.rows || [], summary: r.summary || "", chart: r.chart || null }); })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tab]);

  const thS = { padding: "10px 12px", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Reports & Analytics</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { if (!state.rows.length) { toast("Nothing to export", "warn"); return; } exportCSV(state.rows, `report_${tab}.csv`); toast("Exported CSV", "success"); }} style={btn}>
            <Ic n="download" size={14} /> CSV
          </button>
          <button onClick={() => printReport(def.label, def.cols, state.rows)} style={btn}>
            <Ic n="printer" size={14} /> Print / PDF
          </button>
        </div>
      </div>
      <Err msg={error} />

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18 }}>
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => setTab(r.id)} aria-current={tab === r.id ? "true" : undefined}
            style={{ padding: "7px 14px", border: "1px solid " + (tab === r.id ? "#1d4ed8" : "#e2e8f0"), borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: tab === r.id ? 700 : 500, background: tab === r.id ? "#eff6ff" : "#fff", color: tab === r.id ? "#1d4ed8" : "#475569" }}>
            {r.label}
          </button>
        ))}
      </div>

      {state.summary && (
        <div style={{ padding: "10px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#0369a1", marginBottom: 14 }}>{state.summary}</div>
      )}
      {state.chart && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <BarChart data={state.chart} colorFn={() => "#6366f1"} />
        </div>
      )}

      {loading ? <Spinner /> : (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              {def.cols.map(c => <th key={c[0]} style={{ ...thS, textAlign: align(c) }}>{c[1]}</th>)}
            </tr></thead>
            <tbody>
              {state.rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  {def.cols.map(c => <td key={c[0]} style={{ padding: "10px 12px", textAlign: align(c) }}>{cell(row, c)}</td>)}
                </tr>
              ))}
              {state.rows.length === 0 && (
                <tr><td colSpan={def.cols.length} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No data for this report yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export { Reports };
