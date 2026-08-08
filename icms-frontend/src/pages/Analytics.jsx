import { useState, useEffect, useCallback } from "react";
import { apiFetch, useToast, exportCSV, fmtUSD, BarChart, Spinner, Err, KPICard } from "../lib/core";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── ANALYTICS / TURNOVER ─────────────────────────────────────────────────────
const Analytics = () => {
  const [year, setYear]   = useState(new Date().getFullYear());
  const [years, setYears] = useState([]);
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [t, y] = await Promise.all([
        apiFetch(`/analytics/turnover?year=${year}`),
        apiFetch("/analytics/years"),
      ]);
      setData(t); setYears(y.years || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const th = { padding: "9px 11px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 10, textTransform: "uppercase", textAlign: "left", whiteSpace: "nowrap", border: "1px solid #2d4f7f" };
  const td = { padding: "8px 11px", border: "1px solid #eef1f5", fontSize: 12 };
  const r  = { textAlign: "right" };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Turnover & Volume Analytics</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>Yearly turnover and order volume — supplier-wise and item-wise</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, background: "#fff" }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => { if (data?.by_supplier?.length) { exportCSV(data.by_supplier, `turnover_suppliers_${year}.csv`); toast("Exported", "success"); } }} style={{ padding: "8px 14px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500 }}>📥 Export</button>
        </div>
      </div>
      <Err msg={error} />

      {loading ? <Spinner /> : data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 18 }}>
            <KPICard title={`Turnover ${year}`} value={fmtUSD(data.totals.turnover_usd)} icon="💵" color="linear-gradient(135deg,#10b981,#059669)" />
            <KPICard title="Containers" value={data.totals.containers} icon="🚢" color="linear-gradient(135deg,#3b82f6,#1d4ed8)" />
            <KPICard title="Total Rolls" value={(data.totals.rolls || 0).toLocaleString()} icon="🧻" color="linear-gradient(135deg,#8b5cf6,#7c3aed)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📈 Monthly Turnover</div>
              <BarChart data={data.by_month.map(m => ({ label: MONTHS[m.month - 1], value: Math.round(m.turnover_usd) }))} colorFn={() => "#3b82f6"} height={150} />
            </div>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🏆 Top Volume Items (rolls)</div>
              {(data.top_volume_items || []).map((it, i) => {
                const max = data.top_volume_items[0]?.rolls || 1;
                return (
                  <div key={i} style={{ marginBottom: 7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                      <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>{it.item_name}</span>
                      <span style={{ fontWeight: 700, color: "#1d4ed8" }}>{it.rolls.toLocaleString()}</span>
                    </div>
                    <div style={{ height: 6, background: "#f1f5f9", borderRadius: 4 }}><div style={{ height: "100%", borderRadius: 4, background: "#8b5cf6", width: `${(it.rolls / max) * 100}%` }} /></div>
                  </div>
                );
              })}
              {!data.top_volume_items?.length && <div style={{ color: "#94a3b8", fontSize: 13, padding: "10px 0" }}>No item data</div>}
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 18 }}>
            <div style={{ padding: "11px 16px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 13 }}>🏭 Supplier-wise Turnover {year}</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 700 }}>
                <thead><tr>{["Code","Supplier","Containers","Turnover $","Rolls","CBM"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.by_supplier.map((s, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...td, fontWeight: 700, color: "#1d4ed8" }}>{s.code}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{s.supplier}</td>
                      <td style={{ ...td, ...r }}>{s.containers}</td>
                      <td style={{ ...td, ...r, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>{fmtUSD(s.turnover_usd)}</td>
                      <td style={{ ...td, ...r }}>{(s.total_rolls || 0).toLocaleString()}</td>
                      <td style={{ ...td, ...r }}>{(s.total_cbm || 0).toFixed(1)}</td>
                    </tr>
                  ))}
                  {!data.by_supplier.length && <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No orders in {year}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
              <span>🧾 Item-wise Turnover {year}</span>
              <button onClick={() => { if (data.by_item?.length) { exportCSV(data.by_item, `turnover_items_${year}.csv`); toast("Exported", "success"); } }} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 11 }}>📥 Export</button>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 420 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 700 }}>
                <thead><tr>{["Item","Thickness","Size","Orders","Rolls","Cartons","Turnover $"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.by_item.map((it, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...td, fontWeight: 600 }}>{it.item_name}</td>
                      <td style={{ ...td, textAlign: "center" }}>{it.thickness || "—"}</td>
                      <td style={td}>{it.size || "—"}</td>
                      <td style={{ ...td, ...r }}>{it.orders}</td>
                      <td style={{ ...td, ...r, fontWeight: 700, color: "#1d4ed8" }}>{(it.rolls || 0).toLocaleString()}</td>
                      <td style={{ ...td, ...r }}>{(it.cartons || 0).toLocaleString()}</td>
                      <td style={{ ...td, ...r, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>{fmtUSD(it.turnover_usd)}</td>
                    </tr>
                  ))}
                  {!data.by_item.length && <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No item data in {year}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export { Analytics };
