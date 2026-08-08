import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from "react";

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:3001") + "/api";

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
  { id: "costing",   label: "Costing",           icon: "🧮" },
  { id: "scheduler", label: "Order Scheduler",   icon: "📅" },
  { id: "analytics", label: "Analytics",         icon: "📈" },
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

// ─── ORDER FORM HELPERS (module-level — prevents React unmounting inputs on state change) ────
const TH = ({ children, w }) => <th style={{ padding: "7px 6px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", minWidth: w || 70, border: "1px solid #2d4f7f" }}>{children}</th>;
const TD = ({ children, style }) => <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0", verticalAlign: "middle", ...style }}>{children}</td>;

export { apiFetch, apiUpload, apiDownload, ToastProvider, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, NAV, Sidebar, Header, KPICard, TH, TD };
