import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, LineChart, Progress, Spinner, Err, KPICard, TH, TD, Ic } from "../lib/core";
// ─── DASHBOARD ────────────────────────────────────────────────────────────────
// ─── dashboard helpers ────────────────────────────────────────────────────────
const Panel = ({ title, children }) => (
  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>{title}</div>
    {children}
  </div>
);
const MiniKpi = ({ label, value, sub, color }) => (
  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "14px 16px" }}>
    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: color || "#0f172a" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>}
  </div>
);
const EmptyBox = () => <div style={{ padding: 30, textAlign: "center", color: "#cbd5e1", fontSize: 12 }}>No data yet</div>;
const ExcList = ({ title, icon, color, items, render }) => (
  <div style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 12.5, color, marginBottom: 8 }}>
      <Ic n={icon} size={14} /> {title}
      <span style={{ marginLeft: "auto", background: (items && items.length) ? "#fef2f2" : "#f1f5f9", color: (items && items.length) ? "#dc2626" : "#94a3b8", borderRadius: 20, padding: "1px 8px", fontSize: 11 }}>{(items && items.length) || 0}</span>
    </div>
    {(items || []).slice(0, 6).map((x, i) => <div key={i} style={{ fontSize: 12, color: "#475569", padding: "3px 0", borderTop: "1px solid #f8fafc" }}>{render(x)}</div>)}
    {(!items || items.length === 0) && <div style={{ fontSize: 12, color: "#94a3b8" }}>All clear</div>}
  </div>
);

const Dashboard = () => {
  const [tab, setTab]         = useState("overview");
  const [stats, setStats]     = useState(null);
  const [fin, setFin]         = useState(null);
  const [log, setLog]         = useState(null);
  const [dueAlerts, setDueAlerts] = useState([]);
  const [feed, setFeed]       = useState({ alerts: [], counts: {} });
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const tabs = ["overview", "financial", "logistics", "analytics", "alerts"];

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [s, f, l, da, feed] = await Promise.all([
        apiFetch("/dashboard/stats"),
        apiFetch("/dashboard/financial"),
        apiFetch("/dashboard/logistics"),
        apiFetch("/financial/due-alerts").catch(() => ({ alerts: [] })),
        apiFetch("/alerts").catch(() => ({ alerts: [], counts: {} })),
      ]);
      setStats(s); setFin(f); setLog(l); setDueAlerts(da.alerts || []); setFeed(feed);
      apiFetch("/dashboard/insights").then(setInsights).catch(() => {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 24, flex: 1 }}><Spinner /></div>;

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>ICMS Intelligence Dashboard</h1>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Comprehensive view of your import and container operations</p>
        </div>
        <button onClick={load} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151" }}><Ic n="refresh" size={14} /> Refresh</button>
      </div>
      <Err msg={error} />

      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: "8px 4px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: tab === t ? 600 : 400, background: tab === t ? "#fff" : "transparent", color: tab === t ? "#1d4ed8" : "#64748b", boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.15s", textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>

      {tab === "overview" && stats && (
        <div>
          {/* Action Center — top automation alerts */}
          {(feed.alerts || []).length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "14px 18px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>⚡ Action Center</span>
                {feed.counts?.critical > 0 && <span style={{ fontSize: 11, fontWeight: 800, background: "#fef2f2", color: "#b91c1c", padding: "2px 9px", borderRadius: 20, border: "1px solid #fecaca" }}>{feed.counts.critical} critical</span>}
                {feed.counts?.warning  > 0 && <span style={{ fontSize: 11, fontWeight: 800, background: "#fffbeb", color: "#b45309", padding: "2px 9px", borderRadius: 20, border: "1px solid #fde68a" }}>{feed.counts.warning} warnings</span>}
                <button onClick={() => setTab("alerts")} style={{ marginLeft: "auto", padding: "4px 12px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#374151" }}>View all →</button>
              </div>
              {(feed.alerts || []).slice(0, 5).map((a, i) => {
                const C = a.severity === "critical" ? ["#fef2f2", "#b91c1c"] : a.severity === "warning" ? ["#fffbeb", "#b45309"] : ["#f8fafc", "#475569"];
                const ICON = { payment: "💸", demurrage: "⏱", stale: "🕸", docs: "📋", arrival: "🚢" };
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: C[0], borderRadius: 8, marginBottom: 4 }}>
                    <span>{ICON[a.type] || "🔔"}</span>
                    <span style={{ fontWeight: 700, color: "#1d4ed8", fontSize: 12, minWidth: 100 }}>{a.po_number}</span>
                    <span style={{ fontSize: 12, color: C[1], fontWeight: 600, flex: 1 }}>{a.title}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{a.supplier}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Status pipeline strip */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "14px 18px", marginBottom: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a", marginBottom: 12 }}>🚚 Order Pipeline</div>
            <div style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
              {STATUSES.map((st, i) => {
                const n = (stats.orders_by_status || {})[st] || 0;
                const colors = { Draft:"#94a3b8", Tentative:"#60a5fa", Confirmed:"#22c55e", Loaded:"#a855f7", Shipped:"#f97316", "In Transit":"#eab308", Arrived:"#ef4444", "Customs Clearance":"#ec4899", Cleared:"#10b981", Delivered:"#059669" };
                return (
                  <div key={st} style={{ flex: 1, textAlign: "center", position: "relative" }}>
                    <div style={{ background: n > 0 ? colors[st] : "#f1f5f9", color: n > 0 ? "#fff" : "#cbd5e1", borderRadius: 8, padding: "10px 2px", fontWeight: 800, fontSize: 18 }}>{n}</div>
                    <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>{st}</div>
                    {i < STATUSES.length - 1 && <span style={{ position: "absolute", right: -5, top: 12, color: "#cbd5e1", fontSize: 12 }}>›</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
            <KPICard title="Total Orders"         value={stats.total_orders}        icon={<Ic n="orders" size={22} color="#fff" />} color="linear-gradient(135deg,#3b82f6,#1d4ed8)" />
            <KPICard title="Pipeline Value"       value={fmtINR(stats.pipeline_value)} desc="Orders in progress" icon={<Ic n="dollar" size={22} color="#fff" />} color="linear-gradient(135deg,#10b981,#059669)" />
            <KPICard title="Container Utilization" value={`${parseFloat(stats.utilization_stats?.avg_utilization || 0).toFixed(1)}%`} icon={<Ic n="kanban" size={22} color="#fff" />} color="linear-gradient(135deg,#f59e0b,#d97706)" />
            <KPICard title="Active Suppliers"     value={stats.total_suppliers}      icon={<Ic n="factory" size={22} color="#fff" />} color="linear-gradient(135deg,#8b5cf6,#7c3aed)" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 16 }}>📊 Orders by Status</div>
              <BarChart
                data={Object.entries(stats.orders_by_status || {}).map(([label, value]) => ({ label, value }))}
                colorFn={(label) => {
                  const c = { Draft:"#94a3b8", Tentative:"#60a5fa", Confirmed:"#22c55e", Loaded:"#a855f7", Shipped:"#f97316", "In Transit":"#eab308", Arrived:"#ef4444", "Customs Clearance":"#ec4899", Cleared:"#10b981", Delivered:"#059669" };
                  return c[label] || "#6b7280";
                }}
                height={140}
              />
            </div>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 12 }}>📦 Container Utilization</div>
              {[["Under-utilized (<70%)", stats.utilization_stats?.underutilized, "#ef4444", 60], ["Optimal (70–90%)", stats.utilization_stats?.optimal, "#10b981", 80], ["Over-utilized (>90%)", stats.utilization_stats?.overutilized, "#f59e0b", 95]].map(([label, val, color, pct]) => (
                <div key={label} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#374151" }}>{label}</span>
                    <span style={{ fontWeight: 700, color, fontSize: 12 }}>{val ?? 0} containers</span>
                  </div>
                  <div style={{ height: 6, background: "#f1f5f9", borderRadius: 4 }}>
                    <div style={{ height: "100%", borderRadius: 4, background: color, width: `${Math.min((val || 0) / Math.max(stats.total_orders, 1) * 100, 100)}%`, transition: "width 0.5s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 16 }}>🕐 Recent Orders</div>
            {(stats.recent_orders || []).map((o, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#f8fafc", borderRadius: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{o.po_number}</span>
                  <Badge status={o.status} />
                </div>
                <span style={{ fontWeight: 700, color: "#059669", fontSize: 13 }}>{fmtUSD(o.total_value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "financial" && fin && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
            <KPICard title="Total Paid"         value={fmtINR(fin.payment_summary?.total_paid)} desc={`${fin.payment_summary?.payment_count} payments`} icon={<Ic n="success" size={22} color="#fff" />} color="linear-gradient(135deg,#10b981,#059669)" />
            <KPICard title="Balance Due"        value={fmtUSD(fin.payment_summary?.balance_due)} icon={<Ic n="dollar" size={22} color="#fff" />} color="linear-gradient(135deg,#f59e0b,#d97706)" />
            <KPICard title="FX Currencies"      value={Object.keys(fin.fx_exposure || {}).length} desc="Active currencies" icon={<Ic n="refresh" size={22} color="#fff" />} color="linear-gradient(135deg,#8b5cf6,#7c3aed)" />
            <KPICard title="Suppliers w/ Balance" value={fin.supplier_balances?.length} icon={<Ic n="factory" size={22} color="#fff" />} color="linear-gradient(135deg,#3b82f6,#1d4ed8)" />
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>🌐 Currency Exposure</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {Object.entries(fin.fx_exposure || {}).map(([c, d]) => (
                <div key={c} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{c}</div>
                  <div style={{ fontWeight: 800, fontSize: 20, color: "#3b82f6" }}>{fmtCur(d.value, c)}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{d.orders} orders</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>🏭 Supplier Balances</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f1f5f9" }}>{["Supplier","Orders","Total Value","Paid","Balance"].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: h === "Supplier" ? "left" : "right", fontWeight: 600, color: "#374151" }}>{h}</th>)}</tr></thead>
              <tbody>
                {(fin.supplier_balances || []).map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>{s.supplier_name}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{s.total_orders}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmtUSD(s.total_value)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#059669", fontWeight: 600 }}>{fmtUSD(s.total_paid)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: s.balance > 0 ? "#ef4444" : "#059669", fontWeight: 700 }}>{fmtUSD(s.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "logistics" && log && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 20 }}>
            <KPICard title="Containers Active" value={Object.values(log.container_utilization || {}).reduce((a, b) => a + b.count, 0)} icon={<Ic n="ship" size={22} color="#fff" />} color="linear-gradient(135deg,#3b82f6,#1d4ed8)" />
            <KPICard title="Arriving (7 days)" value={log.arriving_soon?.length} desc="Next 7 days" icon={<Ic n="download" size={22} color="#fff" />} color="linear-gradient(135deg,#f59e0b,#d97706)" />
            <KPICard title="Demurrage Alerts"  value={log.demurrage_alerts?.length} icon={<Ic n="warn" size={22} color="#fff" />} color="linear-gradient(135deg,#ef4444,#dc2626)" />
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>📦 Container Type Performance</div>
            {Object.entries(log.container_utilization || {}).map(([type, data]) => (
              <div key={type} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontWeight: 700 }}>{type} Containers</span>
                  <span style={{ background: "#f1f5f9", padding: "2px 10px", borderRadius: 20, fontSize: 12 }}>{data.count} orders</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                  <span>Average Utilization</span><span style={{ fontWeight: 700 }}>{parseFloat(data.avg_utilization).toFixed(1)}%</span>
                </div>
                <Progress value={parseFloat(data.avg_utilization)} />
                <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 12, color: "#64748b" }}>
                  <span>Weight: {(data.total_weight / 1000).toFixed(0)}t</span>
                  <span>CBM: {parseFloat(data.total_cbm).toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>🚚 Orders Arriving Soon</div>
            {(log.arriving_soon || []).map((o, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#fffbeb", borderRadius: 8, marginBottom: 8, border: "1px solid #fde68a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600 }}>{o.po_number}</span><Badge status={o.status} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#92400e" }}>ETA</div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{o.eta}</div>
                </div>
              </div>
            ))}
            {(log.demurrage_alerts || []).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#b91c1c", marginBottom: 10 }}>⚠️ Demurrage Alerts</div>
                {log.demurrage_alerts.map((a, i) => (
                  <div key={i} style={{ padding: 12, background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
                    <span style={{ fontWeight: 700, color: "#7f1d1d" }}>{a.po_number}</span>
                    <span style={{ fontSize: 12, color: "#b91c1c", marginLeft: 12 }}>Since: {a.demurrage_start}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "analytics" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <MiniKpi label="Avg lead time" value={insights?.kpi?.avg_lead_days != null ? `${insights.kpi.avg_lead_days} d` : "—"} sub="ETD → delivered" />
            <MiniKpi label="On-time %" value={insights?.kpi?.on_time_pct != null ? `${insights.kpi.on_time_pct}%` : "—"} sub="delivered ≤ ETA"
              color={insights?.kpi?.on_time_pct >= 80 ? "#15803d" : "#b45309"} />
            <MiniKpi label="Open exceptions" value={insights ? Object.values(insights.exceptions).reduce((a, b) => a + b.length, 0) : "—"} sub="need attention" color="#dc2626" />
            <MiniKpi label="Stages tracked" value={insights?.funnel?.length || "—"} sub="status funnel" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Panel title="Status funnel">
              {insights?.funnel?.length
                ? <BarChart data={insights.funnel.map(f => ({ label: f.status, value: f.n }))} colorFn={l => KANBAN_COL_COLOR[l] || "#6366f1"} />
                : <EmptyBox />}
            </Panel>
            <Panel title="Monthly volume (orders)">
              {insights?.monthly?.length
                ? <LineChart data={insights.monthly.map(m => ({ label: m.month.slice(2), value: m.orders }))} color="#1d4ed8" />
                : <EmptyBox />}
            </Panel>
          </div>

          <Panel title="Exceptions — needs attention">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }}>
              <ExcList title="Missing docs" icon="clipboard" color="#b45309" items={insights?.exceptions?.missing_docs} render={x => `${x.po_number} · ${x.supplier}`} />
              <ExcList title="Stale orders" icon="refresh" color="#7c3aed" items={insights?.exceptions?.stale} render={x => `${x.po_number} · ${x.days}d in ${x.status}`} />
              <ExcList title="Overdue payments" icon="dollar" color="#dc2626" items={insights?.exceptions?.overdue_payments} render={x => `${x.po_number} · ${fmtUSD(x.outstanding)}`} />
              <ExcList title="Demurrage risk" icon="warn" color="#ea580c" items={insights?.exceptions?.demurrage_risk} render={x => `${x.po_number} · ${x.supplier}`} />
            </div>
          </Panel>
        </div>
      )}

      {tab === "alerts" && log && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Consolidated automation feed — full width */}
          <div style={{ gridColumn: "1 / -1", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 14 }}>⚡ Automation Feed <span style={{ fontWeight: 400, fontSize: 11, color: "#64748b" }}>— payments · demurrage · stale orders · missing docs · arrivals</span></div>
            {(feed.alerts || []).length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "14px 0" }}>Nothing needs attention 🎉</div>}
            {(feed.alerts || []).map((a, i) => {
              const C = a.severity === "critical" ? ["#fef2f2", "#fecaca", "#b91c1c"] : a.severity === "warning" ? ["#fffbeb", "#fde68a", "#b45309"] : ["#f8fafc", "#e2e8f0", "#475569"];
              const ICON = { payment: "💸", demurrage: "⏱", stale: "🕸", docs: "📋", arrival: "🚢" };
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: C[0], border: `1px solid ${C[1]}`, borderRadius: 8, marginBottom: 5 }}>
                  <span>{ICON[a.type] || "🔔"}</span>
                  <span style={{ fontWeight: 700, color: "#1d4ed8", minWidth: 105, fontSize: 12 }}>{a.po_number}</span>
                  <span style={{ fontSize: 12, color: C[2], fontWeight: 600, flex: 1 }}>{a.title}</span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{a.supplier}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: C[1], color: C[2], textTransform: "uppercase" }}>{a.severity}</span>
                </div>
              );
            })}
          </div>
          {/* Payment due / overdue — full width */}
          <div style={{ gridColumn: "1 / -1", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 14 }}>💸 Payment Schedule</div>
            {dueAlerts.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "16px 0" }}>No outstanding payments due 🎉</div>}
            {dueAlerts.map((a, i) => {
              const C = a.alert_type === "overdue"
                ? ["#fef2f2", "#fecaca", "#b91c1c", "OVERDUE"]
                : a.alert_type === "due_soon"
                ? ["#fffbeb", "#fde68a", "#b45309", "DUE SOON"]
                : ["#f8fafc", "#e2e8f0", "#475569", "UPCOMING"];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 14px", background: C[0], border: `1px solid ${C[1]}`, borderRadius: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: "#1d4ed8", minWidth: 110 }}>{a.po_number}</span>
                  <span style={{ fontSize: 12, color: "#374151", flex: 1 }}>{a.supplier}</span>
                  <span style={{ fontWeight: 800, color: C[2] }}>{fmtUSD(a.balance)}</span>
                  <span style={{ fontSize: 11, color: "#64748b", minWidth: 84 }}>{(a.payment_due_date || "").split("T")[0]}</span>
                  <span style={{ fontSize: 11, color: "#64748b", minWidth: 56, textAlign: "right" }}>{a.days_remaining < 0 ? `${-a.days_remaining}d late` : `${a.days_remaining}d left`}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: C[1], color: C[2] }}>{C[3]}</span>
                </div>
              );
            })}
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #fecaca", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#b91c1c", marginBottom: 16 }}>⚠️ Critical Alerts</div>
            {(log.demurrage_alerts || []).length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No active alerts</div>}
            {(log.demurrage_alerts || []).map((a, i) => (
              <div key={i} style={{ padding: 12, background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, color: "#7f1d1d" }}>{a.po_number}</span>
                  <span style={{ background: "#fecaca", color: "#991b1b", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>Demurrage</span>
                </div>
                <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 6 }}>Since: {a.demurrage_start}</p>
              </div>
            ))}
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #fde68a", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#92400e", marginBottom: 16 }}>🕐 Upcoming Events</div>
            {(log.arriving_soon || []).map((e, i) => (
              <div key={i} style={{ padding: 12, background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, color: "#78350f" }}>{e.po_number}</span>
                  <span style={{ background: "#fde68a", color: "#78350f", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>Arriving</span>
                </div>
                <p style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>ETA: {e.eta}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export { Dashboard };
