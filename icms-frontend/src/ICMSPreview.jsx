import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from "react";

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000") + "/api";

const apiFetch = async (path, options = {}) => {
  const token = localStorage.getItem("icms_token");
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (networkErr) {
    throw new Error("Cannot reach server — check if the backend is running.");
  }
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
      else if (body.message) msg = body.message;
    } catch (_) {}
    // Map common DB error strings to friendlier messages
    if (msg.includes("ECONNREFUSED") || msg.includes("connect") || msg.includes("Connection terminated")) {
      msg = "Database unavailable — please start Docker / PostgreSQL.";
    }
    throw new Error(msg || "Request failed");
  }
  return res.json();
};

const apiUpload = async (path, formData) => {
  const token = localStorage.getItem("icms_token");
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: formData });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Upload failed"); }
  return res.json();
};

const apiDownload = (path, filename) => {
  const token = localStorage.getItem("icms_token");
  fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => r.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    });
};

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────────────────
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx) || (() => {});

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);
  const COLORS = { success: ["#f0fdf4","#bbf7d0","#166534","✅"], error: ["#fef2f2","#fecaca","#991b1b","❌"], warn: ["#fffbeb","#fde68a","#78350f","⚠️"], info: ["#eff6ff","#bfdbfe","#1e40af","ℹ️"] };
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div style={{ position:"fixed", bottom:24, right:24, zIndex:9999, display:"flex", flexDirection:"column-reverse", gap:8, pointerEvents:"none" }}>
        {toasts.map(t => {
          const [bg,border,color,icon] = COLORS[t.type] || COLORS.success;
          return (
            <div key={t.id} style={{ padding:"12px 18px", borderRadius:10, background:bg, border:`1px solid ${border}`, color, fontWeight:600, fontSize:13, minWidth:280, maxWidth:380, boxShadow:"0 4px 16px rgba(0,0,0,0.13)", display:"flex", alignItems:"center", gap:10, pointerEvents:"auto" }}>
              <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
              <span style={{ flex:1 }}>{t.msg}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
};

// ─── CONFIRM DIALOG ───────────────────────────────────────────────────────────
const useConfirm = () => {
  return useCallback((msg) => new Promise(res => {
    // fallback to native confirm — keeps code simple
    res(window.confirm(msg));
  }), []);
};

// ─── CSV EXPORT HELPER ────────────────────────────────────────────────────────
const exportCSV = (rows, filename) => {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const body = rows.map(r => keys.map(k => {
    const v = r[k] == null ? "" : String(r[k]);
    return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g,'""')}"` : v;
  }).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ─── HELPERS & CONSTANTS ──────────────────────────────────────────────────────
const fmtINR = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const fmtUSD = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtCur = (n, c) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n || 0); } catch { return `${c} ${n}`; } };

const STATUS_STYLE = {
  Draft: "bg-gray-100 text-gray-700", Tentative: "bg-blue-100 text-blue-700",
  Confirmed: "bg-green-100 text-green-700", Loaded: "bg-purple-100 text-purple-700",
  Shipped: "bg-orange-100 text-orange-700", "In Transit": "bg-yellow-100 text-yellow-700",
  Arrived: "bg-red-100 text-red-700", "Customs Clearance": "bg-pink-100 text-pink-700",
  Cleared: "bg-emerald-100 text-emerald-700", Delivered: "bg-green-200 text-green-800"
};
const KANBAN_COL_COLOR = {
  Draft: "#94a3b8", Confirmed: "#22c55e", Loaded: "#a855f7",
  Shipped: "#f97316", "In Transit": "#eab308", Arrived: "#ef4444", Delivered: "#10b981"
};
const STATUSES = ["Draft","Tentative","Confirmed","Loaded","Shipped","In Transit","Arrived","Customs Clearance","Cleared","Delivered"];
const CONTAINER_TYPES = ["20FT","40FT","40HC"];
const CURRENCIES = ["USD","CNY","EUR","INR","GBP","AED"];

const PRIORITY_COLOR = { urgent: "#dc2626", high: "#f59e0b", normal: "#10b981", low: "#94a3b8" };
const PRIORITY_BG    = { urgent: "#fef2f2", high: "#fffbeb", normal: "#f0fdf4", low: "#f8fafc" };

const Badge = ({ status, className = "" }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status] || "bg-gray-100 text-gray-700"} ${className}`}>{status}</span>
);
const PriorityBadge = ({ priority = "normal" }) => (
  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: PRIORITY_BG[priority] || "#f8fafc", color: PRIORITY_COLOR[priority] || "#64748b", fontWeight: 700, border: `1px solid ${PRIORITY_COLOR[priority] || "#e2e8f0"}22`, textTransform: "uppercase", letterSpacing: "0.05em" }}>{priority}</span>
);

// CSS Bar Chart (no external lib)
const BarChart = ({ data, colorFn, height = 160 }) => {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, paddingTop: 8 }}>
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        const color = colorFn ? colorFn(d.label) : "#3b82f6";
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#374151" }}>{d.value}</span>
            <div style={{ width: "100%", borderRadius: "4px 4px 0 0", background: color, height: `${Math.max(pct, 4)}%`, minHeight: 4, transition: "height 0.3s ease", opacity: 0.85 }} title={`${d.label}: ${d.value}`} />
            <span style={{ fontSize: 9, color: "#64748b", textAlign: "center", lineHeight: 1.2, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
};
const Progress = ({ value }) => (
  <div className="w-full bg-gray-100 rounded-full h-2">
    <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(value || 0, 100)}%`, background: (value || 0) > 90 ? "#ef4444" : (value || 0) > 70 ? "#10b981" : "#f59e0b" }} />
  </div>
);
const Spinner = () => <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Loading…</div>;
const Err = ({ msg }) => msg ? <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#dc2626", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{msg}</div> : null;

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", label: "Dashboard",        icon: "◈" },
  { id: "orders",    label: "Import Orders",     icon: "📦" },
  { id: "kanban",    label: "Container Status",  icon: "⬛" },
  { id: "financial", label: "Financial",         icon: "💰" },
  { id: "masters",   label: "Master Data",       icon: "🗄" },
  { id: "documents", label: "Documents",         icon: "📄" },
  { id: "reports",   label: "Reports",           icon: "📊" },
  { id: "settings",  label: "Settings",          icon: "⚙️" },
];

const Sidebar = ({ active, setActive, user, onLogout }) => (
  <div style={{ width: 240, background: "linear-gradient(135deg,#1e293b 0%,#334155 100%)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
    <div style={{ padding: "24px 20px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <div style={{ width: 36, height: 36, background: "rgba(255,255,255,0.1)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚢</div>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 16, fontFamily: "system-ui" }}>ICMS</div>
          <div style={{ color: "#93c5fd", fontSize: 10 }}>Complete System v2.0</div>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setActive(n.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: active === n.id ? 600 : 400, background: active === n.id ? "rgba(255,255,255,0.2)" : "transparent", color: active === n.id ? "#fff" : "#94a3b8", transition: "all 0.15s" }}>
            <span style={{ fontSize: 14 }}>{n.icon}</span>{n.label}
          </button>
        ))}
      </nav>
    </div>
    <div style={{ marginTop: "auto", padding: "16px 20px" }}>
      <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "#8b5cf6", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13 }}>{(user?.name || "U")[0].toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || "User"}</div>
            <div style={{ color: "#93c5fd", fontSize: 11 }}>{user?.role || "staff"}</div>
          </div>
          <button onClick={onLogout} title="Logout" style={{ background: "none", border: "none", cursor: "pointer", color: "#93c5fd", fontSize: 16 }}>↩</button>
        </div>
      </div>
    </div>
  </div>
);

const Header = ({ alertCount = 0, onAlertClick }) => (
  <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <div>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Import & Container Management</div>
      <div style={{ color: "#64748b", fontSize: 12 }}>Manage your logistics operations efficiently</div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div onClick={onAlertClick} style={{ position: "relative", width: 36, height: 36, borderRadius: "50%", background: alertCount > 0 ? "#fef2f2" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16 }}>
        🔔
        {alertCount > 0 && (
          <span style={{ position: "absolute", top: -2, right: -2, background: "#dc2626", color: "#fff", borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, border: "2px solid #fff" }}>{alertCount > 9 ? "9+" : alertCount}</span>
        )}
      </div>
    </div>
  </div>
);

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
const KPICard = ({ title, value, desc, color, icon }) => (
  <div style={{ background: color, borderRadius: 12, padding: "20px 22px", color: "#fff" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>{value ?? "—"}</div>
        {desc && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>{desc}</div>}
      </div>
      <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 8, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</div>
    </div>
  </div>
);

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const [tab, setTab]         = useState("overview");
  const [stats, setStats]     = useState(null);
  const [fin, setFin]         = useState(null);
  const [log, setLog]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const tabs = ["overview", "financial", "logistics", "analytics", "alerts"];

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [s, f, l] = await Promise.all([
        apiFetch("/dashboard/stats"),
        apiFetch("/dashboard/financial"),
        apiFetch("/dashboard/logistics"),
      ]);
      setStats(s); setFin(f); setLog(l);
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
        <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151" }}>⚡ Refresh</button>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
            <KPICard title="Total Orders"         value={stats.total_orders}        icon="📦" color="linear-gradient(135deg,#3b82f6,#1d4ed8)" />
            <KPICard title="Pipeline Value"       value={fmtINR(stats.pipeline_value)} desc="Orders in progress" icon="💰" color="linear-gradient(135deg,#10b981,#059669)" />
            <KPICard title="Container Utilization" value={`${parseFloat(stats.utilization_stats?.avg_utilization || 0).toFixed(1)}%`} icon="🎯" color="linear-gradient(135deg,#f59e0b,#d97706)" />
            <KPICard title="Active Suppliers"     value={stats.total_suppliers}      icon="🏭" color="linear-gradient(135deg,#8b5cf6,#7c3aed)" />
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
            <KPICard title="Total Paid"         value={fmtINR(fin.payment_summary?.total_paid)} desc={`${fin.payment_summary?.payment_count} payments`} icon="✅" color="linear-gradient(135deg,#10b981,#059669)" />
            <KPICard title="Balance Due"        value={fmtUSD(fin.payment_summary?.balance_due)} icon="⏳" color="linear-gradient(135deg,#f59e0b,#d97706)" />
            <KPICard title="FX Currencies"      value={Object.keys(fin.fx_exposure || {}).length} desc="Active currencies" icon="🌐" color="linear-gradient(135deg,#8b5cf6,#7c3aed)" />
            <KPICard title="Suppliers w/ Balance" value={fin.supplier_balances?.length} icon="🏭" color="linear-gradient(135deg,#3b82f6,#1d4ed8)" />
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
            <KPICard title="Containers Active" value={Object.values(log.container_utilization || {}).reduce((a, b) => a + b.count, 0)} icon="🚢" color="linear-gradient(135deg,#3b82f6,#1d4ed8)" />
            <KPICard title="Arriving (7 days)" value={log.arriving_soon?.length} desc="Next 7 days" icon="⏰" color="linear-gradient(135deg,#f59e0b,#d97706)" />
            <KPICard title="Demurrage Alerts"  value={log.demurrage_alerts?.length} icon="⚠️" color="linear-gradient(135deg,#ef4444,#dc2626)" />
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>↕ Variance Summary</div>
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📐</div>
              <div>Variance data from order line items</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Add order items to see variance analytics</div>
            </div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>📈 Pipeline Trend</div>
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
              <div>Chart coming soon</div>
            </div>
          </div>
        </div>
      )}

      {tab === "alerts" && log && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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

// ─── ORDER FORM MODAL ─────────────────────────────────────────────────────────
const BLANK_ITEM = { _sku_id: "", item_name: "", thickness: "", size: "", liner_color: "", qty_ctn: "", total_ctn: "", total_roll: "", unit_price: "", kg_pkg: "", code: "", shipping_mark: "", cbm: "" };
const DOC_CHECKLIST_ITEMS = ["Bill of Lading","Commercial Invoice","Packing List","Certificate of Origin","Insurance Certificate","Customs Declaration"];
const PRIORITIES = ["normal","high","urgent","low"];

const OrderForm = ({ order, suppliers, skus = [], onSave, onClose }) => {
  const isEdit = !!order?.id;
  const [form, setForm] = useState({
    po_number:     order?.po_number     || "",
    supplier_id:   order?.supplier_id   || "",
    marking:       order?.marking       || "",
    container_type: order?.container_type || "40FT",
    currency:      order?.currency      || "USD",
    status:        order?.status        || "Draft",
    priority:      order?.priority      || "normal",
    etd:           order?.etd ? order.etd.split("T")[0] : "",
    eta:           order?.eta ? order.eta.split("T")[0] : "",
    bl_number:     order?.bl_number     || "",
    shipment_date: order?.shipment_date ? order.shipment_date.split("T")[0] : "",
    payment_due_date: order?.payment_due_date ? order.payment_due_date.split("T")[0] : "",
    utilization_percentage: order?.utilization_percentage || "",
    notes:         order?.notes         || "",
    freight_cost:  order?.freight_cost  != null ? order.freight_cost  : "",
    insurance_cost: order?.insurance_cost != null ? order.insurance_cost : "",
    duty_rate:     order?.duty_rate     != null ? order.duty_rate     : "",
    free_days:     order?.free_days     != null ? order.free_days     : "7",
    demurrage_rate: order?.demurrage_rate != null ? order.demurrage_rate : "",
    container_returned_date: order?.container_returned_date ? order.container_returned_date.split("T")[0] : "",
    doc_checklist: order?.doc_checklist || {},
    shipped:       order?.shipped   || false,
    delivered:     order?.delivered || false,
  });

  // Auto-calc payment due date when shipment date or supplier changes
  const calcDueDate = (shipDate, supId, currentSuppliers) => {
    if (!shipDate || !supId) return "";
    const sup = (currentSuppliers || suppliers).find(s => String(s.id) === String(supId));
    if (!sup) return "";
    const d = new Date(shipDate);
    d.setDate(d.getDate() + (sup.payment_terms_days || 30));
    return d.toISOString().split("T")[0];
  };
  const [items, setItems] = useState(
    order?.items?.length
      ? order.items.map(i => ({ _sku_id: "", item_name: i.item_name || "", thickness: i.thickness || "", size: i.size || "", liner_color: i.liner_color || "", qty_ctn: i.qty_ctn || "", total_ctn: i.total_ctn || "", total_roll: i.total_roll || "", unit_price: i.unit_price || "", kg_pkg: i.kg_pkg || "", code: i.code || "", shipping_mark: i.shipping_mark || "", cbm: i.cbm || "" }))
      : [{ ...BLANK_ITEM }, { ...BLANK_ITEM }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [fetchingPO, setFetchingPO] = useState(false);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Auto-calc total_roll = total_ctn × qty_ctn when either changes
  const setItem  = (idx, k, v) => setItems(prev => prev.map((r, i) => {
    if (i !== idx) return r;
    const updated = { ...r, [k]: v };
    if ((k === "total_ctn" || k === "qty_ctn") && updated.qty_ctn && updated.total_ctn) {
      const calc = parseInt(updated.total_ctn) * parseInt(updated.qty_ctn);
      if (!isNaN(calc)) updated.total_roll = String(calc);
    }
    return updated;
  }));
  const addRow   = () => setItems(prev => [...prev, { ...BLANK_ITEM }]);
  const delRow   = (idx) => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  // Auto-generate PO number when supplier is selected on new orders
  useEffect(() => {
    if (isEdit || !form.supplier_id) return;
    setFetchingPO(true);
    apiFetch(`/orders/next-po-number?supplier_id=${form.supplier_id}`)
      .then(r => { if (r.next_po) setField("po_number", r.next_po); })
      .catch(() => {})
      .finally(() => setFetchingPO(false));
  }, [form.supplier_id, isEdit]);

  // Auto-fill row from SKU master selection
  const selectSku  = (idx, skuId) => {
    setItems(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      if (!skuId) return { ...r, _sku_id: "" };
      const sku = skus.find(s => String(s.id) === String(skuId));
      if (!sku) return { ...r, _sku_id: skuId };
      return {
        ...r,
        _sku_id:       skuId,
        item_name:     sku.description  || sku.sku_code || r.item_name,
        thickness:     sku.thickness    || r.thickness,
        size:          sku.size         || r.size,
        liner_color:   sku.liner_color  || sku.color || r.liner_color,
        kg_pkg:        sku.roll_weight  != null ? String(sku.roll_weight) : r.kg_pkg,
        code:          sku.item_code    || r.code,
        shipping_mark: sku.shipping_marks || r.shipping_mark,
      };
    }));
  };

  // Auto-calculated totals
  const totalCtn   = items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0), 0);
  const totalRoll  = items.reduce((s, i) => s + (parseInt(i.total_roll) || 0), 0);
  const totalValue = items.reduce((s, i) => s + (parseInt(i.total_roll) || 0) * (parseFloat(i.unit_price) || 0), 0);
  const totalKg    = items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0) * (parseFloat(i.kg_pkg)    || 0), 0);
  const totalCbm   = items.reduce((s, i) => s + (parseFloat(i.cbm)      || 0), 0);

  // Landed cost calculation
  const freightCost   = parseFloat(form.freight_cost)   || 0;
  const insuranceCost = parseFloat(form.insurance_cost) || 0;
  const dutyRate      = parseFloat(form.duty_rate)      || 0;
  const dutyAmt       = totalValue * (dutyRate / 100);
  const landedCost    = totalValue + freightCost + insuranceCost + dutyAmt;
  const landedPerRoll = totalRoll > 0 ? landedCost / totalRoll : 0;
  const landedPerKg   = totalKg   > 0 ? landedCost / totalKg   : 0;

  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const validItems = items.filter(i => i.item_name || i.total_roll);
      const payload = {
        ...form,
        supplier_id:    Number(form.supplier_id) || undefined,
        eta:            form.eta || null,
        etd:            form.etd || null,
        freight_cost:   parseFloat(form.freight_cost)   || 0,
        insurance_cost: parseFloat(form.insurance_cost) || 0,
        duty_rate:      parseFloat(form.duty_rate)      || 0,
        free_days:      parseInt(form.free_days)        || 7,
        demurrage_rate: parseFloat(form.demurrage_rate) || 0,
        container_returned_date: form.container_returned_date || null,
        doc_checklist:  form.doc_checklist || {},
        shipped:        !!form.shipped,
        delivered:      !!form.delivered,
        items: validItems,
      };
      const result = isEdit
        ? await apiFetch(`/orders/${order.id}`, { method: "PUT",  body: JSON.stringify(payload) })
        : await apiFetch("/orders",               { method: "POST", body: JSON.stringify(payload) });
      onSave(result);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const inp  = { border: "1px solid #e2e8f0", borderRadius: 5, padding: "5px 7px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box", background: "#fff" };
  const lbl  = { display: "block", fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 };
  const TH   = ({ children, w }) => <th style={{ padding: "7px 6px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", minWidth: w || 70, border: "1px solid #2d4f7f" }}>{children}</th>;
  const TD   = ({ children, style }) => <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0", verticalAlign: "middle", ...style }}>{children}</td>;
  const CI   = ({ idx, field, type = "text", placeholder = "" }) => (
    <input type={type} placeholder={placeholder} value={items[idx][field]} onChange={e => setItem(idx, field, e.target.value)}
      style={{ ...inp, textAlign: type === "number" ? "right" : "left" }} />
  );
  // SKU select dropdown — auto-fills the row; text input below for manual override
  const SkuCell = ({ idx }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <select value={items[idx]._sku_id || ""} onChange={e => selectSku(idx, e.target.value)}
        style={{ ...inp, fontSize: 11, color: items[idx]._sku_id ? "#0f172a" : "#94a3b8" }}>
        <option value="">— Select from Master —</option>
        {skus.map(s => <option key={s.id} value={s.id}>{s.description || s.sku_code}</option>)}
      </select>
      <input placeholder="or type item name…" value={items[idx].item_name}
        onChange={e => setItem(idx, "item_name", e.target.value)}
        style={{ ...inp, fontSize: 11, color: "#374151" }} />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "20px 12px" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 1100, padding: 28 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a" }}>{isEdit ? `Edit — ${order.po_number}` : "New Import Order"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#64748b", lineHeight: 1 }}>×</button>
        </div>
        <Err msg={error} />

        <form onSubmit={submit}>
          {/* ── Order Header Fields ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 0, padding: "16px 16px 12px", background: "#f8fafc", borderRadius: "10px 10px 0 0", border: "1px solid #e2e8f0", borderBottom: "none" }}>
            <div>
              <label style={lbl}>Supplier *</label>
              <select style={inp} value={form.supplier_id} onChange={e => setField("supplier_id", e.target.value)} required>
                <option value="">Select…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Order No * {fetchingPO && <span style={{ color: "#3b82f6", fontWeight: 400 }}>auto…</span>}</label>
              <input style={{ ...inp, background: fetchingPO ? "#eff6ff" : "#fff" }} value={form.po_number} onChange={e => setField("po_number", e.target.value)} required disabled={isEdit} placeholder="ISDS 00126" />
            </div>
            <div>
              <label style={lbl}>Marking</label>
              <input style={inp} value={form.marking} onChange={e => setField("marking", e.target.value)} placeholder="1MM" />
            </div>
            <div>
              <label style={lbl}>Status</label>
              <select style={inp} value={form.status} onChange={e => setField("status", e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Priority</label>
              <select style={{ ...inp, borderLeft: `3px solid ${PRIORITY_COLOR[form.priority] || "#94a3b8"}` }} value={form.priority} onChange={e => setField("priority", e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Container</label>
              <select style={inp} value={form.container_type} onChange={e => setField("container_type", e.target.value)}>
                {CONTAINER_TYPES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Currency</label>
              <select style={inp} value={form.currency} onChange={e => setField("currency", e.target.value)}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>ETD</label>
              <input style={inp} type="date" value={form.etd} onChange={e => setField("etd", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>ETA</label>
              <input style={inp} type="date" value={form.eta} onChange={e => setField("eta", e.target.value)} />
            </div>
          </div>
          {/* ── Shipped / Delivered flags ── */}
          <div style={{ display: "flex", gap: 20, padding: "8px 16px", background: "#f0f9ff", border: "1px solid #e2e8f0", borderTop: "1px dashed #bae6fd", borderBottom: "none" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, fontWeight: form.shipped ? 700 : 400, color: form.shipped ? "#1d4ed8" : "#64748b" }}>
              <input type="checkbox" checked={!!form.shipped} onChange={e => setField("shipped", e.target.checked)} style={{ accentColor: "#1d4ed8", width: 14, height: 14, cursor: "pointer" }} />
              🚢 SHIPPED (BL issued)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, fontWeight: form.delivered ? 700 : 400, color: form.delivered ? "#059669" : "#64748b" }}>
              <input type="checkbox" checked={!!form.delivered} onChange={e => setField("delivered", e.target.checked)} style={{ accentColor: "#059669", width: 14, height: 14, cursor: "pointer" }} />
              ✅ DELIVERED (cleared customs)
            </label>
          </div>
          {/* ── BL / Shipment / Payment Due ── */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12, marginBottom: 20, padding: "12px 16px 16px", background: "#f8fafc", borderRadius: "0 0 10px 10px", border: "1px solid #e2e8f0", borderTop: "1px dashed #cbd5e1" }}>
            <div>
              <label style={lbl}>BL Number</label>
              <input style={inp} value={form.bl_number} onChange={e => setField("bl_number", e.target.value)} placeholder="MAEU1234567890" />
            </div>
            <div>
              <label style={lbl}>Shipment Date</label>
              <input style={inp} type="date" value={form.shipment_date}
                onChange={e => {
                  const sd = e.target.value;
                  const due = calcDueDate(sd, form.supplier_id);
                  setForm(f => ({ ...f, shipment_date: sd, payment_due_date: due || f.payment_due_date }));
                }} />
            </div>
            <div>
              <label style={lbl}>Payment Due Date</label>
              <input style={{ ...inp, background: form.payment_due_date && new Date(form.payment_due_date) < new Date() ? "#fef2f2" : "#fff" }}
                type="date" value={form.payment_due_date} onChange={e => setField("payment_due_date", e.target.value)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              {form.bl_number && (
                <a href={`https://www.track-trace.com/container?container=${form.bl_number}`} target="_blank" rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 11, color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}>
                  🚢 Track Live
                </a>
              )}
            </div>
          </div>

          {/* ── Line Items Table ── */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Line Items</div>
              <button type="button" onClick={addRow} style={{ padding: "5px 12px", background: "#3b82f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#fff", fontWeight: 600 }}>+ Add Row</button>
            </div>
            <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <TH w={185}>Item</TH>
                    <TH w={65}>Thickness</TH>
                    <TH w={115}>Size</TH>
                    <TH w={90}>Liner/Color</TH>
                    <TH w={62}>QTY/CTN</TH>
                    <TH w={68}>Total CTN</TH>
                    <TH w={68}>Total Roll</TH>
                    <TH w={80}>Price $</TH>
                    <TH w={80}>Total $</TH>
                    <TH w={65}>KG/PKG</TH>
                    <TH w={75}>Total KG</TH>
                    <TH w={65}>CBM</TH>
                    <TH w={125}>Code</TH>
                    <TH w={155}>Shipping Mark</TH>
                    <TH w={36}></TH>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => {
                    const rowTotal   = (parseInt(row.total_roll) || 0) * (parseFloat(row.unit_price) || 0);
                    const rowTotalKg = (parseInt(row.total_ctn)  || 0) * (parseFloat(row.kg_pkg)    || 0);
                    const isEven = idx % 2 === 0;
                    return (
                      <tr key={idx} style={{ background: isEven ? "#fff" : "#f8fafc" }}>
                        <TD><SkuCell idx={idx} /></TD>
                        <TD><CI idx={idx} field="thickness"    placeholder="0.9MM" /></TD>
                        <TD><CI idx={idx} field="size"         placeholder="1000MM×50M" /></TD>
                        <TD><CI idx={idx} field="liner_color"  placeholder="YELLOW" /></TD>
                        <TD><CI idx={idx} field="qty_ctn"      type="number" placeholder="24" /></TD>
                        <TD><CI idx={idx} field="total_ctn"    type="number" placeholder="0" /></TD>
                        <TD style={{ background: "#f0fdf4" }}><CI idx={idx} field="total_roll" type="number" placeholder="0" /></TD>
                        <TD><CI idx={idx} field="unit_price"   type="number" placeholder="0.00" /></TD>
                        <TD style={{ background: "#fffbeb" }}>
                          <div style={{ padding: "5px 7px", textAlign: "right", fontWeight: 600, color: "#92400e", fontSize: 12 }}>
                            {rowTotal.toLocaleString()}
                          </div>
                        </TD>
                        <TD><CI idx={idx} field="kg_pkg"       type="number" placeholder="0" /></TD>
                        <TD style={{ background: "#fffbeb" }}>
                          <div style={{ padding: "5px 7px", textAlign: "right", fontWeight: 600, color: "#92400e", fontSize: 12 }}>
                            {rowTotalKg.toLocaleString()}
                          </div>
                        </TD>
                        <TD><CI idx={idx} field="cbm"          type="number" placeholder="0.00" /></TD>
                        <TD><CI idx={idx} field="code"         placeholder="IS-57145V-1.0YL" /></TD>
                        <TD><CI idx={idx} field="shipping_mark" placeholder="INSULATION…" /></TD>
                        <TD>
                          <button type="button" onClick={() => delRow(idx)} style={{ background: "#fef2f2", border: "none", borderRadius: 4, cursor: "pointer", color: "#dc2626", fontSize: 14, padding: "2px 6px", fontWeight: 700 }}>×</button>
                        </TD>
                      </tr>
                    );
                  })}
                  {/* Totals row */}
                  <tr style={{ background: "#1e3a5f" }}>
                    <td colSpan={4} style={{ padding: "8px 10px", color: "#fff", fontWeight: 700, fontSize: 12, border: "1px solid #2d4f7f" }}>TOTALS</td>
                    <td style={{ border: "1px solid #2d4f7f" }}></td>
                    <td style={{ padding: "8px 6px", color: "#fbbf24", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalCtn.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", color: "#fbbf24", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalRoll.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", border: "1px solid #2d4f7f" }}></td>
                    <td style={{ padding: "8px 6px", color: "#34d399", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>${totalValue.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", border: "1px solid #2d4f7f" }}></td>
                    <td style={{ padding: "8px 6px", color: "#34d399", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalKg.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", color: "#34d399", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalCbm.toFixed(2)}</td>
                    <td colSpan={3} style={{ border: "1px solid #2d4f7f" }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Landed Cost Calculator ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>🧮 Landed Cost Calculator</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div><label style={lbl}>Freight ($)</label><input style={inp} type="number" value={form.freight_cost} onChange={e => setField("freight_cost", e.target.value)} placeholder="0.00" /></div>
                <div><label style={lbl}>Insurance ($)</label><input style={inp} type="number" value={form.insurance_cost} onChange={e => setField("insurance_cost", e.target.value)} placeholder="0.00" /></div>
                <div><label style={lbl}>Duty Rate (%)</label><input style={inp} type="number" value={form.duty_rate} onChange={e => setField("duty_rate", e.target.value)} placeholder="0.00" /></div>
              </div>
              {totalValue > 0 && (
                <div style={{ background: "#f0fdf4", borderRadius: 8, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: "#374151" }}>Goods Value</span><span style={{ fontWeight: 600 }}>{fmtUSD(totalValue)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: "#374151" }}>+ Freight</span><span>{fmtUSD(freightCost)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: "#374151" }}>+ Insurance</span><span>{fmtUSD(insuranceCost)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
                    <span style={{ color: "#374151" }}>+ Duty ({dutyRate}%)</span><span>{fmtUSD(dutyAmt)}</span>
                  </div>
                  <div style={{ borderTop: "1px solid #bbf7d0", paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, color: "#15803d", fontSize: 12 }}>= Landed Cost</span>
                    <span style={{ fontWeight: 800, color: "#15803d", fontSize: 13 }}>{fmtUSD(landedCost)}</span>
                  </div>
                  {totalRoll > 0 && <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Per roll: {fmtUSD(landedPerRoll)} · Per kg: {fmtUSD(landedPerKg)}</div>}
                </div>
              )}
            </div>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>⏱ Demurrage Tracker</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div><label style={lbl}>Free Days</label><input style={inp} type="number" value={form.free_days} onChange={e => setField("free_days", e.target.value)} placeholder="7" /></div>
                <div><label style={lbl}>Rate ($/day)</label><input style={inp} type="number" value={form.demurrage_rate} onChange={e => setField("demurrage_rate", e.target.value)} placeholder="0.00" /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={lbl}>Arrived Date (ETA)</label><input style={inp} type="date" value={form.eta} onChange={e => setField("eta", e.target.value)} /></div>
                <div><label style={lbl}>Container Returned</label><input style={inp} type="date" value={form.container_returned_date} onChange={e => setField("container_returned_date", e.target.value)} /></div>
              </div>
              {form.eta && (
                (() => {
                  const arrived = new Date(form.eta);
                  const returned = form.container_returned_date ? new Date(form.container_returned_date) : new Date();
                  const daysUsed = Math.max(0, Math.ceil((returned - arrived) / 86400000));
                  const freeDaysN = parseInt(form.free_days) || 7;
                  const overDays = Math.max(0, daysUsed - freeDaysN);
                  const demurrageAmt = overDays * (parseFloat(form.demurrage_rate) || 0);
                  return (
                    <div style={{ marginTop: 10, background: overDays > 0 ? "#fef2f2" : "#f0fdf4", borderRadius: 8, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                        <span>Days Used</span><span style={{ fontWeight: 600 }}>{daysUsed}d</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                        <span>Free Days</span><span style={{ fontWeight: 600, color: "#059669" }}>{freeDaysN}d</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                        <span style={{ fontWeight: 700, color: overDays > 0 ? "#dc2626" : "#15803d" }}>Excess · Demurrage</span>
                        <span style={{ fontWeight: 800, color: overDays > 0 ? "#dc2626" : "#15803d" }}>{overDays}d · {fmtUSD(demurrageAmt)}</span>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>

          {/* ── Document Checklist ── */}
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>📋 Document Checklist</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              {DOC_CHECKLIST_ITEMS.map(doc => {
                const checked = !!(form.doc_checklist?.[doc]);
                return (
                  <label key={doc} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 7, background: checked ? "#f0fdf4" : "#f8fafc", border: `1px solid ${checked ? "#bbf7d0" : "#e2e8f0"}`, cursor: "pointer", fontSize: 12, color: checked ? "#15803d" : "#374151", fontWeight: checked ? 600 : 400, transition: "all 0.15s" }}>
                    <input type="checkbox" checked={checked} onChange={e => setField("doc_checklist", { ...form.doc_checklist, [doc]: e.target.checked })}
                      style={{ accentColor: "#16a34a", cursor: "pointer" }} />
                    {doc}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 20 }}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, height: 52, resize: "vertical" }} value={form.notes} onChange={e => setField("notes", e.target.value)} />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {items.filter(i => i.item_name).length} items · {totalRoll.toLocaleString()} rolls · ${totalValue.toLocaleString()} · {totalKg.toLocaleString()} kg · {totalCbm.toFixed(2)} CBM{landedCost > totalValue ? ` · Landed: ${fmtUSD(landedCost)}` : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose} style={{ padding: "9px 20px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ padding: "9px 24px", background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 700, opacity: saving ? 0.7 : 1 }}>{saving ? "Saving…" : (isEdit ? "Save Changes" : "Create Order")}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── IMPORT ORDERS ────────────────────────────────────────────────────────────
const ImportOrders = () => {
  const [search, setSearch]         = useState("");
  const [filter, setFilter]         = useState("All");
  const [view, setView]             = useState("list");   // "list" | "supplier"
  const [selected, setSelected]     = useState(null);    // full order with items
  const [orders, setOrders]         = useState([]);
  const [supplierSummary, setSupplierSummary] = useState([]);
  const [suppliers, setSuppliers]   = useState([]);
  const [skus, setSkus]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [showForm, setShowForm]     = useState(false);
  const [editOrder, setEditOrder]   = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [expandedOrders, setExpandedOrders] = useState({}); // { [orderId]: fullOrder }
  const [trackForm, setTrackForm]   = useState(null);
  const [sortKey, setSortKey]       = useState("created_at");
  const [sortDir, setSortDir]       = useState("desc");
  const toast = useToast();
  const statusFilters = ["All", ...STATUSES.slice(0, 7)];

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (filter !== "All") params.set("status", filter);
      if (search) params.set("search", search);
      const [oRes, sRes, skuRes, supSumRes] = await Promise.all([
        apiFetch(`/orders?${params}`),
        apiFetch("/masters/suppliers"),
        apiFetch("/masters/skus"),
        apiFetch("/orders/supplier-summary"),
      ]);
      setOrders(oRes.orders); setSuppliers(sRes.suppliers); setSkus(skuRes.skus);
      setSupplierSummary(supSumRes.suppliers || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filter, search]);

  // Fetch full order (with items) and set as selected
  const selectOrder = async (o) => {
    if (selected?.id === o.id) { setSelected(null); return; }
    try {
      const full = await apiFetch(`/orders/${o.id}`);
      setSelected(full);
    } catch { setSelected(o); }
  };

  // Toggle expand for supplier-view order rows
  const toggleExpand = async (orderId) => {
    if (expandedOrders[orderId]) {
      setExpandedOrders(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      return;
    }
    try {
      const full = await apiFetch(`/orders/${orderId}`);
      setExpandedOrders(prev => ({ ...prev, [orderId]: full }));
    } catch { /* ignore */ }
  };

  const addTracking = async () => {
    if (!trackForm?.event) return;
    try {
      await apiFetch(`/orders/${trackForm.orderId}/tracking`, {
        method: "POST",
        body: JSON.stringify({ event: trackForm.event, location: trackForm.location, note: trackForm.note }),
      });
      setTrackForm(null);
      const updated = await apiFetch(`/orders/${trackForm.orderId}`);
      setSelected(updated);
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    } catch (e) { setError(e.message); }
  };

  // Quick toggle shipped/delivered without opening the full form
  const quickToggle = async (o, field) => {
    try {
      const updated = await apiFetch(`/orders/${o.id}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: !o[field] }),
      });
      setOrders(prev => prev.map(x => x.id === updated.id ? updated : x));
      toast(`${o.po_number} ${field} toggled`, "success");
    } catch (e) { toast(e.message, "error"); }
  };

  // Open edit form with full order (including items) pre-loaded
  const openEdit = async (o) => {
    try {
      const full = await apiFetch(`/orders/${o.id}`);
      setEditOrder(full);
    } catch { setEditOrder(o); }
  };

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const handleDelete = async (id) => {
    if (!confirm("Delete this order?")) return;
    try { await apiFetch(`/orders/${id}`, { method: "DELETE" }); setOrders(o => o.filter(x => x.id !== id)); setSelected(null); toast("Order deleted", "warn"); }
    catch (e) { setError(e.message); }
  };

  const handleSave = (saved) => {
    setOrders(prev => {
      const exists = prev.find(o => o.id === saved.id);
      return exists ? prev.map(o => o.id === saved.id ? saved : o) : [saved, ...prev];
    });
    setShowForm(false); setEditOrder(null);
    toast(`Order ${saved.po_number} saved`, "success");
    // Refresh supplier summary counts
    apiFetch("/orders/supplier-summary").then(r => setSupplierSummary(r.suppliers || [])).catch(() => {});
  };

  const suppliersWithOrders = selectedSupplier
    ? orders.filter(o => o.supplier_id === selectedSupplier)
    : orders;

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av == null) av = ""; if (bv == null) bv = "";
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1  : -1;
      return 0;
    });
  }, [orders, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortTh = ({ k, children }) => (
    <th onClick={() => toggleSort(k)}
      style={{ padding: "11px 14px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e2e8f0", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      {children} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : <span style={{ opacity: 0.3 }}>↕</span>}
    </th>
  );

  const exportOrders = () => {
    exportCSV(sortedOrders.map(o => ({
      PO_Number: o.po_number, Supplier: o.supplier, Status: o.status, Priority: o.priority || "normal",
      Total_Value: o.total_value, Total_Qty: o.total_quantity, Total_Weight_kg: o.total_weight,
      Total_CBM: o.total_cbm, BL_Number: o.bl_number || "", Shipment_Date: o.shipment_date?.split("T")[0] || "",
      ETA: o.eta?.split("T")[0] || "", ETD: o.etd?.split("T")[0] || "",
      Payment_Due: o.payment_due_date?.split("T")[0] || "", Container: o.container_type, Currency: o.currency,
    })), "import_orders.csv");
    toast("Orders exported to CSV", "success");
  };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      {(showForm || editOrder) && (
        <OrderForm order={editOrder} suppliers={suppliers} skus={skus} onSave={handleSave} onClose={() => { setShowForm(false); setEditOrder(null); }} />
      )}

      {/* Track event modal */}
      {trackForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📍 Add Tracking Update</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input placeholder="Event (e.g. Departed Shanghai)" value={trackForm.event} onChange={e => setTrackForm(f => ({ ...f, event: e.target.value }))}
                style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
              <input placeholder="Location (optional)" value={trackForm.location} onChange={e => setTrackForm(f => ({ ...f, location: e.target.value }))}
                style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
              <input placeholder="Note (optional)" value={trackForm.note} onChange={e => setTrackForm(f => ({ ...f, note: e.target.value }))}
                style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setTrackForm(null)} style={{ padding: "7px 16px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={addTracking} style={{ padding: "7px 16px", background: "#3b82f6", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Import Orders</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{orders.length} orders</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 3, gap: 2 }}>
            {[["list","📋 List"],["supplier","🏭 By Supplier"]].map(([v, label]) => (
              <button key={v} onClick={() => { setView(v); setSelectedSupplier(null); setSelected(null); }}
                style={{ padding: "6px 12px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: view === v ? 600 : 400, background: view === v ? "#fff" : "transparent", color: view === v ? "#1d4ed8" : "#64748b" }}>{label}</button>
            ))}
          </div>
          <button onClick={exportOrders} style={{ padding: "8px 12px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#374151", fontWeight: 500 }}>📥 Export CSV</button>
          <button onClick={() => { setShowForm(true); setEditOrder(null); }} style={{ padding: "8px 14px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>+ New Order</button>
        </div>
      </div>
      <Err msg={error} />

      {/* ── BY SUPPLIER (MAIN SHEET) VIEW ── */}
      {view === "supplier" && !loading && (() => {
        const now = new Date();
        const monthLabel = now.toLocaleString("en", { month: "long", year: "numeric" });
        // Week labels for this month
        const yr = now.getFullYear(), mo = now.getMonth();
        const w = (d) => `${String(mo+1).padStart(2,"0")}/${d}`;
        const weekLabels = [`W1 (${w(1)}-${w(7)})`, `W2 (${w(8)}-${w(14)})`, `W3 (${w(15)}-${w(21)})`, `W4 (${w(22)}+)`];
        const TH2 = ({ children, w: wd, bg, align = "center" }) => (
          <th style={{ padding: "8px 7px", background: bg || "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: align, whiteSpace: "nowrap", minWidth: wd || 50, border: "1px solid #2d4f7f" }}>{children}</th>
        );
        const supOrders = selectedSupplier ? orders.filter(o => o.supplier_id === selectedSupplier) : [];
        return (
          <div>
            {/* MAIN summary table */}
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "11px 16px", background: "#1e3a5f", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>📊 Supplier Dashboard — {monthLabel}</span>
                <span style={{ color: "#93c5fd", fontSize: 11 }}>Click a row to see orders · CP = landed cost (₹ per $)</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <TH2 w={52} align="left">Code</TH2>
                      <TH2 w={100} align="left">Supplier</TH2>
                      <TH2 w={80} align="left">Port</TH2>
                      <TH2 w={40} bg="#1a4a2e">DEL</TH2>
                      <TH2 w={40} bg="#1a3a5c">SHIP</TH2>
                      <TH2 w={40} bg="#4a3a00">PEND</TH2>
                      <TH2 w={40} bg="#4a1a6e">OTW</TH2>
                      <TH2 w={55}>TARGET</TH2>
                      <TH2 w={80}>AVG VAL $</TH2>
                      <TH2 w={38}>MO</TH2>
                      <TH2 w={40}>EX ₹</TH2>
                      <TH2 w={42}>DUTY%</TH2>
                      <TH2 w={75}>EXPENSE</TH2>
                      <TH2 w={55} bg="#1a4a1a">CP ₹</TH2>
                      {weekLabels.map((wl, wi) => <TH2 key={wi} w={55} bg={wi % 2 === 0 ? "#0f2d6e" : "#1a3a8a"}>{wl}</TH2>)}
                    </tr>
                  </thead>
                  <tbody>
                    {supplierSummary.map((s, i) => {
                      const isSelected = selectedSupplier === s.id;
                      const odd = i % 2 !== 0;
                      const base = isSelected ? "#dbeafe" : odd ? "#f8fafc" : "#fff";
                      const cell = { padding: "9px 7px", border: "1px solid #e8ecf0", verticalAlign: "middle" };
                      return (
                        <tr key={s.id} onClick={() => setSelectedSupplier(isSelected ? null : s.id)}
                          style={{ background: base, cursor: "pointer", transition: "background 0.1s" }}>
                          <td style={{ ...cell, fontWeight: 800, color: "#1d4ed8", fontSize: 11 }}>{s.code}</td>
                          <td style={{ ...cell, fontWeight: 600 }}>{s.name}</td>
                          <td style={{ ...cell, color: "#64748b", fontSize: 11 }}>{s.port || "—"}</td>
                          <td style={{ ...cell, textAlign: "center", fontWeight: 700, color: "#059669", background: s.delivered_count > 0 ? "#f0fdf4" : base }}>{s.delivered_count || ""}</td>
                          <td style={{ ...cell, textAlign: "center", fontWeight: 700, color: "#1d4ed8", background: s.shipped_count > 0 ? "#eff6ff" : base }}>{s.shipped_count || ""}</td>
                          <td style={{ ...cell, textAlign: "center", fontWeight: 700, color: "#b45309", background: s.pending_count > 0 ? "#fffbeb" : base }}>{s.pending_count || ""}</td>
                          <td style={{ ...cell, textAlign: "center", fontWeight: 700, color: "#7c3aed", background: s.otw_count > 0 ? "#f5f3ff" : base }}>{s.otw_count || ""}</td>
                          <td style={{ ...cell, textAlign: "center", color: "#374151" }}>{s.target_per_month}</td>
                          <td style={{ ...cell, textAlign: "right" }}>${(s.avg_value_usd || 0).toLocaleString()}</td>
                          <td style={{ ...cell, textAlign: "center", fontWeight: 600, color: "#1d4ed8" }}>{s.month_total || ""}</td>
                          <td style={{ ...cell, textAlign: "right", color: "#374151" }}>{s.ex_rate}</td>
                          <td style={{ ...cell, textAlign: "right", color: "#374151" }}>{s.duty_percent}%</td>
                          <td style={{ ...cell, textAlign: "right", color: "#64748b", fontSize: 11 }}>₹{Math.round((s.expense_inr || 0) / 1000)}K</td>
                          <td style={{ ...cell, textAlign: "right", background: "#f0fdf4", fontWeight: 800, color: "#15803d", fontSize: 13 }}>₹{Math.round(s.cp_inr || 0)}</td>
                          {[s.week1, s.week2, s.week3, s.week4].map((wv, wi) => (
                            <td key={wi} style={{ ...cell, textAlign: "center", fontWeight: wv > 0 ? 700 : 400, color: wv > 0 ? "#1d4ed8" : "#cbd5e1", background: wv > 0 ? "#eff6ff" : base }}>{wv || ""}</td>
                          ))}
                        </tr>
                      );
                    })}
                    {supplierSummary.length === 0 && (
                      <tr><td colSpan={18} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No suppliers found — run migrations and add suppliers</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per-supplier orders drill-down */}
            {selectedSupplier && (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                <div style={{ padding: "10px 16px", background: "#1e3a5f", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>
                    {supplierSummary.find(s => s.id === selectedSupplier)?.name} — Orders
                  </span>
                  <button onClick={() => { setShowForm(true); setEditOrder(null); }} style={{ padding: "4px 10px", background: "#3b82f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#fff", fontWeight: 600 }}>+ New Order</button>
                </div>
                {supOrders.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No orders yet for this supplier</div>
                ) : (
                  supOrders.map((o, oi) => {
                    const exp = expandedOrders[o.id];
                    const overdue = o.payment_due_date && new Date(o.payment_due_date) < new Date();
                    return (
                      <div key={o.id} style={{ borderBottom: oi < supOrders.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        {/* Order header row */}
                        <div onClick={() => toggleExpand(o.id)}
                          style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 16px", cursor: "pointer", background: exp ? "#eff6ff" : "transparent" }}>
                          <span style={{ fontSize: 10, color: exp ? "#3b82f6" : "#94a3b8", width: 10 }}>{exp ? "▼" : "▶"}</span>
                          <span style={{ fontWeight: 700, color: "#1d4ed8", minWidth: 100 }}>{o.po_number}</span>
                          <span style={{ fontSize: 11, color: "#64748b", minWidth: 70 }}>{o.marking || "—"}</span>
                          <Badge status={o.status} />
                          {o.shipped   && <span style={{ fontSize: 10, background: "#eff6ff", color: "#1d4ed8", padding: "1px 7px", borderRadius: 20, fontWeight: 600, border: "1px solid #bfdbfe" }}>🚢 SHIP</span>}
                          {o.delivered && <span style={{ fontSize: 10, background: "#f0fdf4", color: "#059669", padding: "1px 7px", borderRadius: 20, fontWeight: 600, border: "1px solid #bbf7d0" }}>✅ DEL</span>}
                          <span style={{ fontSize: 11, color: "#64748b" }}>ETD: {o.etd?.split("T")[0] || "—"}</span>
                          <span style={{ fontSize: 11, color: "#64748b" }}>ETA: {o.eta?.split("T")[0] || "—"}</span>
                          <span style={{ fontWeight: 700, color: "#059669", marginLeft: "auto" }}>{fmtUSD(o.total_value)}</span>
                          <span style={{ fontSize: 11, color: overdue ? "#dc2626" : "#64748b" }}>{o.payment_due_date ? (overdue ? "⚠️ " : "") + o.payment_due_date.split("T")[0] : ""}</span>
                          <button onClick={e => { e.stopPropagation(); openEdit(o); setView("list"); }} style={{ padding: "3px 8px", background: "#f1f5f9", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, flexShrink: 0 }}>Edit</button>
                        </div>
                        {/* Items table (expanded) */}
                        {exp && (
                          <div style={{ overflowX: "auto", borderTop: "1px solid #e2e8f0", background: "#fafbfc" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead>
                                <tr style={{ background: "#334155" }}>
                                  {["ITEM","THICKNESS","SIZE","LINER/COLOR","QTY/CTN","TOTAL CTN","TOTAL ROLL","PRICE $","TOTAL $","KG/PKG","TOTAL KG","CODE","SHIPPING MARK"].map(h =>
                                    <th key={h} style={{ padding: "6px 8px", color: "#fff", fontWeight: 600, fontSize: 10, textAlign: h.includes("TOTAL") || h === "PRICE $" || h === "QTY/CTN" ? "right" : "left", whiteSpace: "nowrap", border: "1px solid #4b5563" }}>{h}</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {(exp.items || []).map((item, ii) => {
                                  const rowTotal   = (parseInt(item.total_roll) || 0) * (parseFloat(item.unit_price) || 0);
                                  const rowTotalKg = (parseInt(item.total_ctn)  || 0) * (parseFloat(item.kg_pkg)    || 0);
                                  return (
                                    <tr key={ii} style={{ background: ii % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                                      <td style={{ padding: "6px 8px", fontWeight: 500 }}>{item.item_name}</td>
                                      <td style={{ padding: "6px 8px" }}>{item.thickness}</td>
                                      <td style={{ padding: "6px 8px" }}>{item.size}</td>
                                      <td style={{ padding: "6px 8px" }}>{item.liner_color}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.qty_ctn || ""}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{item.total_ctn}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#1d4ed8" }}>{item.total_roll}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right" }}>${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#059669" }}>${rowTotal.toLocaleString()}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.kg_pkg}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#64748b" }}>{rowTotalKg.toLocaleString()}</td>
                                      <td style={{ padding: "6px 8px", fontSize: 10, color: "#475569" }}>{item.code}</td>
                                      <td style={{ padding: "6px 8px", fontSize: 10, color: "#475569" }}>{item.shipping_mark}</td>
                                    </tr>
                                  );
                                })}
                                {(!exp.items || exp.items.length === 0) && (
                                  <tr><td colSpan={13} style={{ padding: 12, textAlign: "center", color: "#94a3b8" }}>No items recorded for this order</td></tr>
                                )}
                                {exp.items?.length > 0 && (() => {
                                  const tCtn  = exp.items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0), 0);
                                  const tRoll = exp.items.reduce((s, i) => s + (parseInt(i.total_roll) || 0), 0);
                                  const tVal  = exp.items.reduce((s, i) => s + (parseInt(i.total_roll) || 0) * (parseFloat(i.unit_price) || 0), 0);
                                  const tKg   = exp.items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0) * (parseFloat(i.kg_pkg)    || 0), 0);
                                  return (
                                    <tr style={{ background: "#1e3a5f" }}>
                                      <td colSpan={4} style={{ padding: "6px 8px", color: "#fff", fontWeight: 700, fontSize: 11, border: "1px solid #2d4f7f" }}>TOTALS</td>
                                      <td style={{ border: "1px solid #2d4f7f" }}></td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#fbbf24", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tCtn.toLocaleString()}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#fbbf24", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tRoll.toLocaleString()}</td>
                                      <td style={{ border: "1px solid #2d4f7f" }}></td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#34d399", fontWeight: 800, border: "1px solid #2d4f7f" }}>${tVal.toLocaleString()}</td>
                                      <td style={{ border: "1px solid #2d4f7f" }}></td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#34d399", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tKg.toLocaleString()}</td>
                                      <td colSpan={2} style={{ border: "1px solid #2d4f7f" }}></td>
                                    </tr>
                                  );
                                })()}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── LIST VIEW ── */}
      {view === "list" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO, supplier…" style={{ flex: 1, minWidth: 180, padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none" }} />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {statusFilters.slice(0, 5).map(s => (
                <button key={s} onClick={() => setFilter(s)} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid " + (filter === s ? "#3b82f6" : "#e2e8f0"), background: filter === s ? "#3b82f6" : "#fff", color: filter === s ? "#fff" : "#374151", cursor: "pointer", fontSize: 12, fontWeight: filter === s ? 600 : 400 }}>{s}</button>
              ))}
            </div>
          </div>
          {loading ? <Spinner /> : (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <SortTh k="po_number">PO Number</SortTh>
                    <SortTh k="supplier">Supplier</SortTh>
                    <SortTh k="status">Status</SortTh>
                    <th style={{ padding: "11px 14px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" }}>Priority</th>
                    <SortTh k="total_value">Value</SortTh>
                    <SortTh k="bl_number">BL No</SortTh>
                    <SortTh k="shipment_date">Shipment</SortTh>
                    <SortTh k="payment_due_date">Payment Due</SortTh>
                    <SortTh k="eta">ETA</SortTh>
                    <th style={{ padding: "11px 14px", borderBottom: "1px solid #e2e8f0" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map((o, i) => {
                    const overdue = o.payment_due_date && new Date(o.payment_due_date) < new Date();
                    const dueSoon = o.payment_due_date && !overdue && (new Date(o.payment_due_date) - new Date()) < 7 * 86400000;
                    return (
                      <tr key={o.id} onClick={() => selectOrder(o)}
                        style={{ borderBottom: i < sortedOrders.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: selected?.id === o.id ? "#eff6ff" : "transparent" }}
                        onMouseEnter={e => { if (selected?.id !== o.id) e.currentTarget.style.background = "#f8fafc"; }}
                        onMouseLeave={e => { if (selected?.id !== o.id) e.currentTarget.style.background = selected?.id === o.id ? "#eff6ff" : "transparent"; }}>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 700, color: "#3b82f6", fontSize: 12 }}>{o.po_number}</div>
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{o.marking || ""}</div>
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 500, fontSize: 12 }}>{o.supplier}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <Badge status={o.status} />
                          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                            {o.shipped   && <span style={{ fontSize: 9, background: "#eff6ff", color: "#1d4ed8", padding: "1px 5px", borderRadius: 10, fontWeight: 600 }}>SHIP</span>}
                            {o.delivered && <span style={{ fontSize: 9, background: "#f0fdf4", color: "#059669", padding: "1px 5px", borderRadius: 10, fontWeight: 600 }}>DEL</span>}
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px" }}><PriorityBadge priority={o.priority || "normal"} /></td>
                        <td style={{ padding: "10px 14px", fontWeight: 700, color: "#059669", fontSize: 12 }}>{fmtUSD(o.total_value)}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: o.bl_number ? "#1d4ed8" : "#cbd5e1" }}>{o.bl_number || "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 11 }}>{o.shipment_date ? o.shipment_date.split("T")[0] : "—"}</td>
                        <td style={{ padding: "10px 14px", fontSize: 11, fontWeight: overdue || dueSoon ? 700 : 400, color: overdue ? "#dc2626" : dueSoon ? "#d97706" : "#64748b" }}>
                          {o.payment_due_date ? <>{overdue ? "⚠️ " : dueSoon ? "⏰ " : ""}{o.payment_due_date.split("T")[0]}</> : "—"}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 11 }}>{o.eta ? o.eta.split("T")[0] : "—"}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={e => { e.stopPropagation(); openEdit(o); }} style={{ padding: "4px 8px", background: "#f1f5f9", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>Edit</button>
                            <button onClick={e => { e.stopPropagation(); handleDelete(o.id); }} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#dc2626" }}>Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {orders.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No orders found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {/* ── Order Detail Panel ── */}
          {selected && (
            <div style={{ marginTop: 16, background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>📦 {selected.po_number} — {selected.supplier}
                  {selected.marking && <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 8, fontSize: 12 }}>({selected.marking})</span>}
                  {selected.shipped   && <span style={{ marginLeft: 8, fontSize: 10, background: "#eff6ff", color: "#1d4ed8", padding: "2px 7px", borderRadius: 20, fontWeight: 600, border: "1px solid #bfdbfe" }}>🚢 SHIPPED</span>}
                  {selected.delivered && <span style={{ marginLeft: 6, fontSize: 10, background: "#f0fdf4", color: "#059669", padding: "2px 7px", borderRadius: 20, fontWeight: 600, border: "1px solid #bbf7d0" }}>✅ DELIVERED</span>}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  {selected.bl_number && (
                    <a href={`https://www.track-trace.com/container?container=${selected.bl_number}`} target="_blank" rel="noreferrer"
                      style={{ padding: "5px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}>🚢 Track Live</a>
                  )}
                  <button onClick={() => setTrackForm({ orderId: selected.id, event: "", location: "", note: "" })}
                    style={{ padding: "5px 10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12, color: "#15803d", cursor: "pointer", fontWeight: 600 }}>+ Tracking</button>
                  <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 18 }}>×</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
                {[
                  ["Container", selected.container_type],
                  ["Status", selected.status],
                  ["Priority", selected.priority || "normal"],
                  ["BL Number", selected.bl_number || "—"],
                  ["Shipment Date", selected.shipment_date ? selected.shipment_date.split("T")[0] : "—"],
                  ["ETD", selected.etd ? selected.etd.split("T")[0] : "—"],
                  ["ETA", selected.eta ? selected.eta.split("T")[0] : "—"],
                  ["Payment Due", selected.payment_due_date ? selected.payment_due_date.split("T")[0] : "—"],
                  ["Total Value", fmtUSD(selected.total_value)],
                  ["Total Qty", (selected.total_quantity || 0).toLocaleString()],
                  ["Weight", `${(selected.total_weight || 0).toLocaleString()} kg`],
                  ["CBM", parseFloat(selected.total_cbm || 0).toFixed(1)],
                  ["Utilization", `${parseFloat(selected.utilization_percentage || 0).toFixed(1)}%`],
                  ["Free Days", selected.free_days || 7],
                ].map(([k, v]) => {
                  const isOverdue = k === "Payment Due" && selected.payment_due_date && new Date(selected.payment_due_date) < new Date();
                  const isPriority = k === "Priority";
                  return (
                    <div key={k} style={{ background: isOverdue ? "#fef2f2" : isPriority ? (PRIORITY_BG[v] || "#f8fafc") : "#f8fafc", borderRadius: 8, padding: "10px 12px", border: isOverdue ? "1px solid #fecaca" : "none" }}>
                      <div style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{k}</div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: isOverdue ? "#dc2626" : isPriority ? (PRIORITY_COLOR[v] || "#374151") : "#0f172a" }}>{isOverdue ? "⚠️ " : ""}{isPriority ? v.toUpperCase() : v}</div>
                    </div>
                  );
                })}
              </div>
              {/* Tracking timeline */}
              {(selected.tracking_updates?.length > 0) && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>📍 Tracking History</div>
                  <div style={{ borderLeft: "2px solid #e2e8f0", paddingLeft: 14 }}>
                    {[...selected.tracking_updates].reverse().map((t, i) => (
                      <div key={i} style={{ marginBottom: 10, position: "relative" }}>
                        <div style={{ position: "absolute", left: -20, top: 4, width: 8, height: 8, borderRadius: "50%", background: i === 0 ? "#3b82f6" : "#94a3b8" }} />
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{t.event}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{t.location && `${t.location} · `}{new Date(t.ts).toLocaleString()}</div>
                        {t.note && <div style={{ fontSize: 11, color: "#374151", marginTop: 2 }}>{t.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Landed Cost & Demurrage in detail panel */}
              {(parseFloat(selected.freight_cost) > 0 || parseFloat(selected.insurance_cost) > 0 || parseFloat(selected.duty_rate) > 0) && (
                <div style={{ marginTop: 12, background: "#f0fdf4", borderRadius: 8, padding: "10px 14px", border: "1px solid #bbf7d0" }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>🧮 Landed Cost</div>
                  <div style={{ display: "flex", gap: 20, fontSize: 12, flexWrap: "wrap" }}>
                    <span>Freight: <strong>{fmtUSD(selected.freight_cost)}</strong></span>
                    <span>Insurance: <strong>{fmtUSD(selected.insurance_cost)}</strong></span>
                    <span>Duty ({selected.duty_rate}%): <strong>{fmtUSD(selected.total_value * (selected.duty_rate / 100))}</strong></span>
                    <span style={{ fontWeight: 800, color: "#15803d" }}>Total Landed: {fmtUSD(parseFloat(selected.total_value) + parseFloat(selected.freight_cost || 0) + parseFloat(selected.insurance_cost || 0) + parseFloat(selected.total_value) * ((selected.duty_rate || 0) / 100))}</span>
                  </div>
                </div>
              )}
              {/* Demurrage tracking */}
              {selected.eta && parseFloat(selected.demurrage_rate) > 0 && (
                (() => {
                  const arrived = new Date(selected.eta);
                  const returned = selected.container_returned_date ? new Date(selected.container_returned_date) : new Date();
                  const daysUsed = Math.max(0, Math.ceil((returned - arrived) / 86400000));
                  const freeDays = parseInt(selected.free_days) || 7;
                  const overDays = Math.max(0, daysUsed - freeDays);
                  const demAmt = overDays * parseFloat(selected.demurrage_rate);
                  return (
                    <div style={{ marginTop: 8, background: overDays > 0 ? "#fef2f2" : "#fffbeb", borderRadius: 8, padding: "10px 14px", border: `1px solid ${overDays > 0 ? "#fecaca" : "#fde68a"}` }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: overDays > 0 ? "#b91c1c" : "#92400e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>⏱ Demurrage Status</div>
                      <div style={{ display: "flex", gap: 20, fontSize: 12, flexWrap: "wrap" }}>
                        <span>Days used: <strong>{daysUsed}d</strong></span>
                        <span>Free days: <strong style={{ color: "#059669" }}>{freeDays}d</strong></span>
                        <span style={{ fontWeight: 800, color: overDays > 0 ? "#dc2626" : "#059669" }}>
                          {overDays > 0 ? `⚠️ ${overDays} excess days · ${fmtUSD(demAmt)} owed` : "✅ Within free period"}
                        </span>
                      </div>
                    </div>
                  );
                })()
              )}
              {/* Document Checklist */}
              {selected.doc_checklist && Object.keys(selected.doc_checklist).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>📋 Document Checklist</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {DOC_CHECKLIST_ITEMS.map(doc => {
                      const done = !!(selected.doc_checklist?.[doc]);
                      return (
                        <span key={doc} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: done ? "#f0fdf4" : "#fef2f2", color: done ? "#15803d" : "#dc2626", border: `1px solid ${done ? "#bbf7d0" : "#fecaca"}`, fontWeight: 500 }}>
                          {done ? "✓" : "✗"} {doc}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {selected.notes && <div style={{ marginTop: 10, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, fontSize: 13, color: "#374151" }}>📝 {selected.notes}</div>}

              {/* Line Items Table (Excel-style) */}
              {selected.items?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>📋 Line Items</div>
                  <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: "#1e3a5f" }}>
                          {["ITEM","THICKNESS","SIZE","LINER/COLOR","QTY/CTN","TOTAL CTN","TOTAL ROLL","PRICE $","TOTAL $","KG/PKG","TOTAL KG","CODE","SHIPPING MARK"].map(h =>
                            <th key={h} style={{ padding: "7px 8px", color: "#fff", fontWeight: 700, fontSize: 10, textAlign: ["TOTAL CTN","TOTAL ROLL","PRICE $","TOTAL $","QTY/CTN","KG/PKG","TOTAL KG"].includes(h) ? "right" : "left", whiteSpace: "nowrap", border: "1px solid #2d4f7f" }}>{h}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {selected.items.map((item, ii) => {
                          const rt  = (parseInt(item.total_roll) || 0) * (parseFloat(item.unit_price) || 0);
                          const rkg = (parseInt(item.total_ctn)  || 0) * (parseFloat(item.kg_pkg)    || 0);
                          return (
                            <tr key={ii} style={{ background: ii % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "7px 8px", fontWeight: 500 }}>{item.item_name}</td>
                              <td style={{ padding: "7px 8px" }}>{item.thickness}</td>
                              <td style={{ padding: "7px 8px" }}>{item.size}</td>
                              <td style={{ padding: "7px 8px" }}>{item.liner_color}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right" }}>{item.qty_ctn || ""}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600 }}>{item.total_ctn}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: "#1d4ed8" }}>{item.total_roll}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right" }}>${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: "#059669" }}>${rt.toLocaleString()}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right" }}>{item.kg_pkg}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#64748b" }}>{rkg.toLocaleString()}</td>
                              <td style={{ padding: "7px 8px", fontSize: 10, color: "#475569" }}>{item.code}</td>
                              <td style={{ padding: "7px 8px", fontSize: 10, color: "#475569" }}>{item.shipping_mark}</td>
                            </tr>
                          );
                        })}
                        {(() => {
                          const tCtn  = selected.items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0), 0);
                          const tRoll = selected.items.reduce((s, i) => s + (parseInt(i.total_roll) || 0), 0);
                          const tVal  = selected.items.reduce((s, i) => s + (parseInt(i.total_roll) || 0) * (parseFloat(i.unit_price) || 0), 0);
                          const tKg   = selected.items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0) * (parseFloat(i.kg_pkg)    || 0), 0);
                          return (
                            <tr style={{ background: "#1e3a5f" }}>
                              <td colSpan={4} style={{ padding: "7px 8px", color: "#fff", fontWeight: 700, border: "1px solid #2d4f7f" }}>TOTALS</td>
                              <td style={{ border: "1px solid #2d4f7f" }}></td>
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#fbbf24", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tCtn.toLocaleString()}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#fbbf24", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tRoll.toLocaleString()}</td>
                              <td style={{ border: "1px solid #2d4f7f" }}></td>
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#34d399", fontWeight: 800, border: "1px solid #2d4f7f" }}>${tVal.toLocaleString()}</td>
                              <td style={{ border: "1px solid #2d4f7f" }}></td>
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#34d399", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tKg.toLocaleString()}</td>
                              <td colSpan={2} style={{ border: "1px solid #2d4f7f" }}></td>
                            </tr>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ─── KANBAN ───────────────────────────────────────────────────────────────────
const Kanban = () => {
  const [groups, setGroups]       = useState({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [qtyModal, setQtyModal]   = useState(null); // { card, fromCol, toCol, items }
  const [qtyItems, setQtyItems]   = useState([]);
  const [savingQty, setSavingQty] = useState(false);
  const dragCard                  = useRef(null);
  const cols = ["Draft","Confirmed","Loaded","Shipped","In Transit","Arrived","Delivered"];

  const loadGroups = () => {
    apiFetch("/orders/kanban").then(setGroups).catch(e => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(loadGroups, []);

  const onDragStart = (card, fromCol) => { dragCard.current = { card, fromCol }; };

  const onDrop = async (toCol) => {
    if (!dragCard.current || dragCard.current.fromCol === toCol) return;
    const { card, fromCol } = dragCard.current;
    dragCard.current = null;
    // If moving to Loaded/Shipped/Arrived — prompt qty edit
    if (["Loaded","Shipped","Arrived"].includes(toCol)) {
      try {
        const full = await apiFetch(`/orders/${card.id}`);
        setQtyItems((full.items || []).map(i => ({ ...i })));
        setQtyModal({ card, fromCol, toCol });
      } catch (e) { setError(e.message); }
      return;
    }
    await commitStatus(card, fromCol, toCol);
  };

  const commitStatus = async (card, fromCol, toCol, updatedItems) => {
    setGroups(prev => {
      const next = { ...prev };
      next[fromCol] = (next[fromCol] || []).filter(c => c.id !== card.id);
      next[toCol]   = [{ ...card }, ...(next[toCol] || [])];
      return next;
    });
    try {
      await apiFetch(`/orders/${card.id}/status`, { method: "PATCH", body: JSON.stringify({ status: toCol }) });
      if (updatedItems) {
        await apiFetch(`/orders/${card.id}`, { method: "PUT", body: JSON.stringify({ items: updatedItems }) });
      }
    } catch (e) {
      setError(e.message);
      setGroups(prev => {
        const next = { ...prev };
        next[toCol]   = (next[toCol] || []).filter(c => c.id !== card.id);
        next[fromCol] = [card, ...(next[fromCol] || [])];
        return next;
      });
    }
  };

  const confirmQtyAndMove = async () => {
    if (!qtyModal) return;
    setSavingQty(true);
    await commitStatus(qtyModal.card, qtyModal.fromCol, qtyModal.toCol, qtyItems);
    setSavingQty(false);
    setQtyModal(null);
  };

  if (loading) return <div style={{ padding: 24, flex: 1 }}><Spinner /></div>;

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      {/* Qty edit modal */}
      {qtyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 700, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>✏️ Update Quantities — {qtyModal.card.po_number}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Moving to <strong>{qtyModal.toCol}</strong> — verify or adjust quantities if anything changed during shipping</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1e3a5f" }}>
                  {["Item","Thickness","Size","Liner/Color","Total CTN","Total Roll","KG/PKG"].map(h =>
                    <th key={h} style={{ padding: "7px 8px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "left", border: "1px solid #2d4f7f" }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {qtyItems.map((item, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.item_name}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.thickness}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.size}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.liner_color}</td>
                    <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0" }}>
                      <input type="number" value={item.total_ctn} onChange={e => setQtyItems(prev => prev.map((r, i) => i === idx ? { ...r, total_ctn: e.target.value } : r))}
                        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "4px 6px", fontSize: 12, outline: "none", textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0" }}>
                      <input type="number" value={item.total_roll} onChange={e => setQtyItems(prev => prev.map((r, i) => i === idx ? { ...r, total_roll: e.target.value } : r))}
                        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "4px 6px", fontSize: 12, outline: "none", textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0" }}>
                      <input type="number" value={item.kg_pkg} onChange={e => setQtyItems(prev => prev.map((r, i) => i === idx ? { ...r, kg_pkg: e.target.value } : r))}
                        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "4px 6px", fontSize: 12, outline: "none", textAlign: "right" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setQtyModal(null)} style={{ padding: "8px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={() => commitStatus(qtyModal.card, qtyModal.fromCol, qtyModal.toCol)} style={{ padding: "8px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Skip (no changes)</button>
              <button onClick={confirmQtyAndMove} disabled={savingQty} style={{ padding: "8px 18px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>{savingQty ? "Saving…" : "Confirm & Move"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Container Status Board</h1>
        <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>Drag cards to update status · Moving to Loaded/Shipped/Arrived prompts quantity review</p>
      </div>
      <Err msg={error} />
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {cols.map(col => {
          const cards = groups[col] || [];
          const color = KANBAN_COL_COLOR[col] || "#94a3b8";
          return (
            <div key={col} style={{ minWidth: 200, flexShrink: 0 }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(col)}>
              <div style={{ padding: "8px 12px", borderRadius: "8px 8px 0 0", background: color, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 12 }}>{col}</span>
                <span style={{ background: "rgba(255,255,255,0.3)", color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{cards.length}</span>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: "0 0 8px 8px", border: "1px solid #e2e8f0", borderTop: "none", minHeight: 200, padding: 8 }}>
                {cards.map((c, i) => (
                  <div key={i} draggable onDragStart={() => onDragStart(c, col)}
                    style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", padding: 12, marginBottom: 8, cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f", marginBottom: 4 }}>{c.po_number}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{c.supplier}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, color: "#475569" }}>{c.container}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>{fmtUSD(c.value)}</span>
                    </div>
                  </div>
                ))}
                {cards.length === 0 && <div style={{ textAlign: "center", padding: "30px 0", color: "#cbd5e1", fontSize: 12 }}>Drop here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── FINANCIAL PAGE ───────────────────────────────────────────────────────────
const Financial = () => {
  const [tab, setTab]           = useState("payments");
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [showForm, setShowForm] = useState(false);
  const [orders, setOrders]     = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [alerts, setAlerts]     = useState([]);
  const [ledger, setLedger]     = useState([]);
  const [ledgerSupId, setLedgerSupId] = useState("");
  const [form, setForm]         = useState({ reference: "", order_id: "", supplier_id: "", amount: "", currency: "USD", payment_date: new Date().toISOString().split("T")[0], payment_type: "TT", notes: "" });
  const [saving, setSaving]     = useState(false);
  const toast = useToast();
  const tabs = [["payments","💳 Payments"], ["alerts","🔔 Due Alerts"], ["accounts","🏭 Supplier Accounts"], ["ledger","📒 Ledger"]];

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [pRes, oRes, sRes, accRes, alertRes] = await Promise.all([
        apiFetch("/financial/payments"),
        apiFetch("/orders"),
        apiFetch("/masters/suppliers"),
        apiFetch("/financial/supplier-accounts"),
        apiFetch("/financial/due-alerts"),
      ]);
      setData(pRes); setOrders(oRes.orders || []); setSuppliers(sRes.suppliers || []);
      setAccounts(accRes.accounts || []); setAlerts(alertRes.alerts || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const loadLedger = async (supId) => {
    if (!supId) return;
    try {
      const res = await apiFetch(`/financial/ledger/${supId}`);
      setLedger(res.ledger || []);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); }, [load]);

  const submitPayment = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      await apiFetch("/financial/payments", { method: "POST", body: JSON.stringify({ ...form, amount: parseFloat(form.amount), order_id: parseInt(form.order_id), supplier_id: parseInt(form.supplier_id) }) });
      setShowForm(false); load(); toast("Payment recorded successfully", "success");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const deletePayment = async (id) => {
    if (!confirm("Delete this payment?")) return;
    try { await apiFetch(`/financial/payments/${id}`, { method: "DELETE" }); load(); toast("Payment deleted", "warn"); }
    catch (e) { setError(e.message); }
  };

  const inp = { border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };

  if (loading) return <div style={{ padding: 24, flex: 1 }}><Spinner /></div>;

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Financial</h1>
        <button onClick={() => setShowForm(true)} style={{ padding: "8px 14px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>+ Record Payment</button>
      </div>
      <Err msg={error} />

      {showForm && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
            Record Payment
            <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748b" }}>×</button>
          </div>
          <form onSubmit={submitPayment}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
              <div><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>REFERENCE *</label><input style={inp} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} required placeholder="TT-2026-0025" /></div>
              <div><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>ORDER *</label>
                <select style={inp} value={form.order_id} onChange={e => { const o = orders.find(x => x.id === parseInt(e.target.value)); setForm(f => ({ ...f, order_id: e.target.value, supplier_id: o?.supplier_id || f.supplier_id })); }} required>
                  <option value="">Select order…</option>
                  {orders.map(o => <option key={o.id} value={o.id}>{o.po_number} — {o.supplier}</option>)}
                </select>
              </div>
              <div><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>SUPPLIER *</label>
                <select style={inp} value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))} required>
                  <option value="">Select supplier…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>AMOUNT *</label><input style={inp} type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required /></div>
              <div><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>CURRENCY</label>
                <select style={inp} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>DATE</label><input style={inp} type="date" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ padding: "8px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ padding: "8px 18px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>{saving ? "Saving…" : "Record Payment"}</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 20, width: "fit-content" }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: "7px 18px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: tab === id ? 600 : 400, background: tab === id ? "#fff" : "transparent", color: tab === id ? "#1d4ed8" : "#64748b" }}>{label}</button>
        ))}
      </div>

      {tab === "payments" && data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>✅ Payments Made</div>
            {(data.payments_made || []).map((p, i) => (
              <div key={i} style={{ background: "#f0fdf4", borderRadius: 8, padding: 12, marginBottom: 10, border: "1px solid #bbf7d0" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{p.reference}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, color: "#059669" }}>{fmtCur(p.amount, p.currency)}</span>
                    <button onClick={() => deletePayment(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 14 }}>×</button>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{p.po_number} · {p.supplier_name} · {p.payment_date?.split("T")[0]}</div>
              </div>
            ))}
            {!(data.payments_made || []).length && <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No payments recorded</div>}
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>⏰ Payments Due</div>
            {(data.payments_due || []).map((p, i) => (
              <div key={i} style={{ background: p.is_overdue ? "#fef2f2" : "#fffbeb", borderRadius: 8, padding: 12, marginBottom: 10, border: `1px solid ${p.is_overdue ? "#fecaca" : "#fde68a"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{p.po_number}</span>
                  <span style={{ fontWeight: 700, color: p.is_overdue ? "#dc2626" : "#d97706" }}>{fmtUSD(p.balance)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{p.supplier}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: p.is_overdue ? "#dc2626" : "#92400e" }}>{p.is_overdue ? "⚠️ OVERDUE" : `Due: ${p.due_date?.split("T")[0]}`}</span>
                </div>
              </div>
            ))}
            {!(data.payments_due || []).length && <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "20px 0" }}>All payments settled</div>}
          </div>
        </div>
      )}

      {/* ── Due Alerts ── */}
      {tab === "alerts" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
            {alerts.length === 0 && (
              <div style={{ background: "#f0fdf4", borderRadius: 12, border: "1px solid #bbf7d0", padding: 30, textAlign: "center", color: "#15803d", gridColumn: "1/-1" }}>
                ✅ No payment alerts — all dues are clear!
              </div>
            )}
            {alerts.map((a, i) => {
              const isOverdue = a.alert_type === "overdue";
              const isDueSoon = a.alert_type === "due_soon";
              return (
                <div key={i} style={{ background: isOverdue ? "#fef2f2" : isDueSoon ? "#fffbeb" : "#fff", borderRadius: 10, border: `1px solid ${isOverdue ? "#fecaca" : isDueSoon ? "#fde68a" : "#e2e8f0"}`, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{a.po_number}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{a.supplier}</div>
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 15, color: isOverdue ? "#dc2626" : isDueSoon ? "#d97706" : "#059669" }}>{fmtUSD(a.balance)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>Due: {a.payment_due_date?.split("T")[0]}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: isOverdue ? "#fee2e2" : isDueSoon ? "#fef9c3" : "#f0fdf4", color: isOverdue ? "#dc2626" : isDueSoon ? "#92400e" : "#15803d" }}>
                      {isOverdue ? `⚠️ ${Math.abs(a.days_remaining)}d OVERDUE` : isDueSoon ? `⏰ Due in ${a.days_remaining}d` : `${a.days_remaining}d remaining`}
                    </span>
                  </div>
                  {a.bl_number && <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>BL: {a.bl_number}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Supplier Accounts ── */}
      {tab === "accounts" && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              {["Supplier","Code","Orders","Total Invoiced","Total Paid","Outstanding","Currency"].map(h =>
                <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={a.id} style={{ borderBottom: i < accounts.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer" }}
                  onClick={() => { setTab("ledger"); setLedgerSupId(String(a.id)); loadLedger(a.id); }}>
                  <td style={{ padding: "12px 14px", fontWeight: 700 }}>{a.name}</td>
                  <td style={{ padding: "12px 14px", color: "#64748b", fontFamily: "monospace" }}>{a.code}</td>
                  <td style={{ padding: "12px 14px" }}>{a.order_count}</td>
                  <td style={{ padding: "12px 14px", fontWeight: 600 }}>{fmtUSD(a.total_invoiced)}</td>
                  <td style={{ padding: "12px 14px", color: "#059669", fontWeight: 600 }}>{fmtUSD(a.total_paid)}</td>
                  <td style={{ padding: "12px 14px", fontWeight: 700, color: parseFloat(a.outstanding) > 0 ? "#dc2626" : "#059669" }}>{fmtUSD(a.outstanding)}</td>
                  <td style={{ padding: "12px 14px", color: "#64748b" }}>{a.base_currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Ledger ── */}
      {tab === "ledger" && (
        <div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <select value={ledgerSupId} onChange={e => { setLedgerSupId(e.target.value); loadLedger(e.target.value); }}
              style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none", minWidth: 200 }}>
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {ledgerSupId && <span style={{ fontSize: 12, color: "#64748b" }}>{ledger.length} entries</span>}
          </div>
          {ledger.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#1e3a5f" }}>
                  {["Date","Reference","Type","Debit (Invoice)","Credit (Payment)","Balance"].map(h =>
                    <th key={h} style={{ padding: "10px 14px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "left", textTransform: "uppercase" }}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {ledger.map((e, i) => {
                    const isDebit  = parseFloat(e.debit) > 0;
                    const isCredit = parseFloat(e.credit) > 0;
                    const balance  = parseFloat(e.balance);
                    return (
                      <tr key={i} style={{ background: isCredit ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>{new Date(e.date).toLocaleDateString()}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600, color: isDebit ? "#1e40af" : "#15803d" }}>{e.ref}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: isDebit ? "#eff6ff" : "#f0fdf4", color: isDebit ? "#1d4ed8" : "#15803d" }}>{e.type}</span>
                        </td>
                        <td style={{ padding: "10px 14px", color: "#dc2626", fontWeight: isDebit ? 700 : 400 }}>{isDebit ? fmtUSD(e.debit) : "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#059669", fontWeight: isCredit ? 700 : 400 }}>{isCredit ? fmtUSD(e.credit) : "—"}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 700, color: balance > 0 ? "#dc2626" : "#059669" }}>{fmtUSD(Math.abs(balance))} {balance > 0 ? "DR" : "CR"}</td>
                      </tr>
                    );
                  })}
                  {/* Summary row */}
                  {(() => {
                    const totalDr = ledger.reduce((s, e) => s + parseFloat(e.debit), 0);
                    const totalCr = ledger.reduce((s, e) => s + parseFloat(e.credit), 0);
                    const net = totalDr - totalCr;
                    return (
                      <tr style={{ background: "#1e3a5f" }}>
                        <td colSpan={3} style={{ padding: "10px 14px", color: "#fff", fontWeight: 700 }}>TOTAL</td>
                        <td style={{ padding: "10px 14px", color: "#fca5a5", fontWeight: 700 }}>{fmtUSD(totalDr)}</td>
                        <td style={{ padding: "10px 14px", color: "#86efac", fontWeight: 700 }}>{fmtUSD(totalCr)}</td>
                        <td style={{ padding: "10px 14px", color: net > 0 ? "#fca5a5" : "#86efac", fontWeight: 800 }}>{fmtUSD(Math.abs(net))} {net > 0 ? "DR" : "CR"}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
          {ledgerSupId && ledger.length === 0 && (
            <div style={{ background: "#f0fdf4", borderRadius: 12, border: "1px solid #bbf7d0", padding: 30, textAlign: "center", color: "#15803d" }}>No transactions for this supplier yet</div>
          )}
        </div>
      )}
    </div>
  );
};

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

  const tabKey = tab === "SKUs" ? "skus" : tab === "Suppliers" ? "suppliers" : "ports";

  const downloadTemplate = () => apiDownload(`/masters/${tabKey}/template`, `${tabKey}_template.csv`);

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
      const [sRes, supRes, pRes] = await Promise.all([apiFetch("/masters/skus"), apiFetch("/masters/suppliers"), apiFetch("/masters/ports")]);
      setSkus(sRes.skus); setSuppliers(supRes.suppliers); setPorts(pRes.ports);
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
    } : {
      sku_code: "", description: "", hsn_code: "", category: "",
      thickness: "", size: "", color: "", liner_color: "",
      roll_weight: "", item_code: "", shipping_marks: "",
      weight_per_unit: "", cbm_per_unit: "",
    });
    if (tab === "Suppliers") setForm(item ? { code: item.code, name: item.name, country: item.country, base_currency: item.base_currency, contact_email: item.contact_email, payment_terms_days: item.payment_terms_days } : { code: "", name: "", country: "", base_currency: "USD", contact_email: "", payment_terms_days: 30 });
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
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["SKU Code","Description","Item Code","Thickness","Size","Liner/Color","Roll Wt (kg)","Category",""].map(h =>
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {skus.map((s, i) => (
                    <tr key={s.id} style={{ borderBottom: i < skus.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1e40af", fontFamily: "monospace", whiteSpace: "nowrap" }}>{s.sku_code}</td>
                      <td style={{ padding: "10px 14px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</td>
                      <td style={{ padding: "10px 14px", color: "#374151", fontFamily: "monospace", fontSize: 12 }}>{s.item_code || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ padding: "10px 14px", color: "#374151", fontSize: 12 }}>{s.thickness || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ padding: "10px 14px", color: "#374151", fontSize: 12 }}>{s.size || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ padding: "10px 14px", color: "#374151", fontSize: 12 }}>{[s.liner_color, s.color].filter(Boolean).join(" / ") || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ padding: "10px 14px", color: "#374151", fontSize: 12 }}>{s.roll_weight != null && s.roll_weight !== "" ? s.roll_weight : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ padding: "10px 14px" }}><span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>{s.category || "—"}</span></td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => openForm(s)} style={{ padding: "4px 8px", background: "#f1f5f9", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>Edit</button>
                          <button onClick={() => deleteItem(s.id)} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#dc2626" }}>Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!skus.length && <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No SKUs yet — add one above</td></tr>}
                </tbody>
              </table>
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
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>📍 {s.country} · {s.base_currency}</div>
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
      setDocs(dRes.documents); setOrders(oRes.orders);
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

// ─── REPORTS ─────────────────────────────────────────────────────────────────
const Reports = () => {
  const [tab, setTab]     = useState("supplier");
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tabs = [["supplier","Supplier Summary"],["container","Container Report"],["tracking","Tracking"]];

  useEffect(() => {
    setLoading(true); setError(""); setData(null);
    const endpoint = tab === "supplier" ? "/reports/supplier-summary" : tab === "container" ? "/reports/containers" : "/reports/tracking";
    apiFetch(endpoint).then(r => setData(r.data)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [tab]);

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Reports & Analytics</h1>
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

// ─── SETTINGS ────────────────────────────────────────────────────────────────
const Settings = () => {
  const [settings, setSettings] = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  useEffect(() => {
    apiFetch("/settings").then(r => setSettings(r.settings)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setError(""); setSuccess("");
    try {
      const r = await apiFetch("/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(r.settings); setSuccess("Settings saved successfully.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const inp = { width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 13, outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 };

  if (loading) return <div style={{ padding: 24, flex: 1 }}><Spinner /></div>;

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 24 }}>System Settings</h1>
      <Err msg={error} />
      {success && <div style={{ padding: "8px 12px", background: "#f0fdf4", color: "#16a34a", borderRadius: 6, fontSize: 13, marginBottom: 12, border: "1px solid #bbf7d0" }}>{success}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🏢 Company Information</div>
          {[["company_name","Company Name"],["company_address","Address"],["company_phone","Phone"],["company_email","Email"]].map(([key, label]) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <label style={lbl}>{label}</label>
              <input style={inp} value={settings[key] || ""} onChange={e => set(key, e.target.value)} />
            </div>
          ))}
          <button onClick={save} disabled={saving} style={{ padding: "9px 20px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📋 PDF & Document Settings</div>
          {[["pdf_header_text","PDF Header Text"],["pdf_footer_text","PDF Footer Text"]].map(([key, label]) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <label style={lbl}>{label}</label>
              <input style={inp} value={settings[key] || ""} onChange={e => set(key, e.target.value)} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "#f8fafc", borderRadius: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 13 }}>Show Duty Rate on PDF</span>
            <div onClick={() => set("show_duty_on_pdf", settings.show_duty_on_pdf === "true" ? "false" : "true")}
              style={{ width: 36, height: 20, background: settings.show_duty_on_pdf === "true" ? "#3b82f6" : "#cbd5e1", borderRadius: 10, position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
              <div style={{ width: 16, height: 16, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, left: settings.show_duty_on_pdf === "true" ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Default Currency</label>
              <select style={inp} value={settings.default_currency || "USD"} onChange={e => set("default_currency", e.target.value)}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <button onClick={save} disabled={saving} style={{ padding: "9px 20px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>
    </div>
  );
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const Login = ({ onLogin }) => {
  const [email, setEmail]       = useState("owner@icms.com");
  const [password, setPassword] = useState("owner123");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const { token, user } = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      localStorage.setItem("icms_token", token);
      onLogin(user);
    } catch (err) { setError(err.message || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#1e293b 0%,#334155 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 380, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🚢</div>
          <div style={{ fontWeight: 800, fontSize: 22, color: "#0f172a" }}>ICMS Login</div>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Import & Container Management System</div>
        </div>
        <Err msg={error} />
        <form onSubmit={submit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required style={{ width: "100%", padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Password</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" required style={{ width: "100%", padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button type="submit" disabled={loading} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.8 : 1 }}>{loading ? "Signing in…" : "Sign In"}</button>
        </form>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#94a3b8" }}>Default: owner@icms.com / owner123</div>
      </div>
    </div>
  );
};

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]         = useState(null);
  const [page, setPage]         = useState("dashboard");
  const [ready, setReady]       = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("icms_token");
    if (token) {
      apiFetch("/auth/me").then(u => setUser(u)).catch(() => localStorage.removeItem("icms_token")).finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, []);

  // Poll due alerts every 5 min to keep bell badge fresh
  useEffect(() => {
    if (!user) return;
    const fetch = () => apiFetch("/financial/due-alerts").then(r => {
      const critical = (r.alerts || []).filter(a => a.alert_type === "overdue" || a.alert_type === "due_soon").length;
      setAlertCount(critical);
    }).catch(() => {});
    fetch();
    const t = setInterval(fetch, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [user]);

  if (!ready) return <ToastProvider><div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: "system-ui" }}>Loading…</div></ToastProvider>;
  if (!user)  return <ToastProvider><Login onLogin={(u) => { setUser(u); setPage("dashboard"); }} /></ToastProvider>;

  const logout = () => { localStorage.removeItem("icms_token"); setUser(null); };

  const PAGE = {
    dashboard: <Dashboard />,
    orders:    <ImportOrders />,
    kanban:    <Kanban />,
    financial: <Financial />,
    masters:   <Masters />,
    documents: <Documents />,
    reports:   <Reports />,
    settings:  <Settings />,
  };

  return (
    <ToastProvider>
      <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14, background: "#f8fafc", overflow: "hidden" }}>
        <Sidebar active={page} setActive={setPage} user={user} onLogout={logout} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Header alertCount={alertCount} onAlertClick={() => setPage("financial")} />
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {PAGE[page] || <Dashboard />}
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
