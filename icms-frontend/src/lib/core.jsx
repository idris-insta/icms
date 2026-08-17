import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from "react";
import { useUI } from "../store/ui";
import { LayoutDashboard, Package, LayoutGrid, Wallet, Calculator, CalendarDays, TrendingUp, Database, FileText, BarChart3, Settings as SettingsIcon, Ship, LogOut, Bell, CheckCircle2, XCircle, AlertTriangle, Info, Printer, List, Factory, Receipt, DollarSign, RefreshCw, Download, Upload, Users, Lock, Building2, ClipboardList, Plus, Pencil, KeyRound, Search, Trash2, X, ChevronDown, Moon, Sun } from "lucide-react";

// ─── ICON HELPER (SVG via lucide — replaces emoji icons) ──────────────────────
const ICONS = {
  dashboard: LayoutDashboard, orders: Package, kanban: LayoutGrid, financial: Wallet,
  costing: Calculator, scheduler: CalendarDays, analytics: TrendingUp, masters: Database,
  documents: FileText, reports: BarChart3, settings: SettingsIcon, ship: Ship, logout: LogOut,
  bell: Bell, success: CheckCircle2, error: XCircle, warn: AlertTriangle, info: Info,
  printer: Printer, list: List, factory: Factory, receipt: Receipt, dollar: DollarSign,
  refresh: RefreshCw, download: Download, upload: Upload, users: Users, lock: Lock,
  building: Building2, clipboard: ClipboardList, plus: Plus, edit: Pencil, key: KeyRound,
  search: Search, trash: Trash2, close: X, chevron: ChevronDown, calculator: Calculator,
  box: Package, moon: Moon, sun: Sun, check: CheckCircle2,
};
const Ic = ({ n, size = 16, ...p }) => { const C = ICONS[n] || Package; return <C size={size} strokeWidth={2} aria-hidden="true" {...p} />; };

// ─── API CLIENT ───────────────────────────────────────────────────────────────
// In production the SPA is served by the API itself, so requests go to the same
// origin and the base is just "/api". VITE_API_URL only needs setting when the
// two are on different hosts (the dev server, or a separately-hosted frontend).
const API_BASE = (import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? "http://localhost:3001" : "")) + "/api";

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
      msg = "Database unavailable — the MariaDB server is not reachable.";
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
  const COLORS = { success: ["#f0fdf4","#bbf7d0","#166534","success"], error: ["#fef2f2","#fecaca","#991b1b","error"], warn: ["#fffbeb","#fde68a","#78350f","warn"], info: ["#eff6ff","#bfdbfe","#1e40af","info"] };
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div style={{ position:"fixed", bottom:24, right:24, zIndex:9999, display:"flex", flexDirection:"column-reverse", gap:8, pointerEvents:"none" }}>
        {toasts.map(t => {
          const [bg,border,color,icon] = COLORS[t.type] || COLORS.success;
          return (
            <div key={t.id} role="status" style={{ padding:"12px 18px", borderRadius:10, background:bg, border:`1px solid ${border}`, color, fontWeight:600, fontSize:13, minWidth:280, maxWidth:380, boxShadow:"0 4px 16px rgba(0,0,0,0.13)", display:"flex", alignItems:"center", gap:10, pointerEvents:"auto" }}>
              <Ic n={icon} size={18} color={color} style={{ flexShrink:0 }} />
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
  Cleared: "bg-emerald-100 text-emerald-700", Delivered: "bg-green-200 text-green-800",
  Paid: "bg-teal-100 text-teal-800"
};
const KANBAN_COL_COLOR = {
  Draft: "#94a3b8", Confirmed: "#22c55e", Loaded: "#a855f7",
  Shipped: "#f97316", "In Transit": "#eab308", Arrived: "#ef4444", Delivered: "#10b981", Paid: "#0d9488"
};
const STATUSES = ["Draft","Tentative","Confirmed","Loaded","Shipped","In Transit","Arrived","Customs Clearance","Cleared","Delivered","Paid"];
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
// Simple SVG line chart (no external lib). data = [{label, value}]
const LineChart = ({ data, height = 160, color = "#2563eb", fmt = (v) => v }) => {
  const vals = data.map(d => d.value).filter(v => v != null);
  if (!vals.length) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>No data</div>;
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const W = 520, H = height, padX = 12, padY = 16, plotW = W - padX * 2, plotH = H - padY * 2;
  const x = (i) => padX + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v) => padY + plotH - ((v - min) / span) * plotH;
  const pts = data.map((d, i) => d.value == null ? null : `${x(i)},${y(d.value)}`).filter(Boolean).join(" ");
  const every = Math.ceil(data.length / 6) || 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} role="img" aria-label="trend chart">
      <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#e2e8f0" strokeWidth="1" />
      <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="#e2e8f0" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => d.value == null ? null : (
        <g key={i}><circle cx={x(i)} cy={y(d.value)} r="3" fill={color} /><title>{d.label}: {fmt(d.value)}</title></g>
      ))}
      {data.map((d, i) => (i % every === 0 || i === data.length - 1)
        ? <text key={`l${i}`} x={x(i)} y={H - 3} fontSize="9" fill="#64748b" textAnchor="middle">{d.label}</text> : null)}
      <text x={padX + 2} y={padY - 4} fontSize="9" fill="#94a3b8">{fmt(max)}</text>
      <text x={padX + 2} y={H - padY + 10} fontSize="9" fill="#94a3b8">{fmt(min)}</text>
    </svg>
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
  { id: "dashboard", label: "Dashboard",        icon: "dashboard" },
  { id: "orders",    label: "Import Orders",     icon: "orders" },
  { id: "kanban",    label: "Container Status",  icon: "kanban" },
  { id: "financial", label: "Financial",         icon: "financial" },
  { id: "costing",   label: "Costing",           icon: "costing" },
  { id: "scheduler", label: "Order Scheduler",   icon: "scheduler" },
  { id: "analytics", label: "Analytics",         icon: "analytics" },
  { id: "masters",   label: "Master Data",       icon: "masters" },
  { id: "documents", label: "Documents",         icon: "documents" },
  { id: "reports",   label: "Reports",           icon: "reports" },
  { id: "settings",  label: "Settings",          icon: "settings" },
];

const Sidebar = ({ active, setActive, user, onLogout }) => (
  <div style={{ width: 240, background: "linear-gradient(135deg,#1e293b 0%,#334155 100%)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
    <div style={{ padding: "24px 20px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <div style={{ width: 36, height: 36, background: "rgba(255,255,255,0.1)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Ic n="ship" size={20} /></div>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 16, fontFamily: "system-ui" }}>ICMS</div>
          <div style={{ color: "#93c5fd", fontSize: 10 }}>Complete System v2.0</div>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setActive(n.id)} aria-current={active === n.id ? "page" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: active === n.id ? 600 : 400, background: active === n.id ? "rgba(255,255,255,0.2)" : "transparent", color: active === n.id ? "#fff" : "#94a3b8", transition: "all 0.15s" }}>
            <Ic n={n.icon} size={16} />{n.label}
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
          <button onClick={onLogout} title="Logout" aria-label="Log out" style={{ background: "none", border: "none", cursor: "pointer", color: "#93c5fd", display: "flex", alignItems: "center", padding: 6 }}><Ic n="logout" size={16} /></button>
        </div>
      </div>
    </div>
  </div>
);

// Dark mode toggle — smart-invert theme. State lives in the UI store so the
// button, the <html> class and localStorage can never drift apart.
const ThemeToggle = () => {
  const dark = useUI(s => s.dark);
  const toggle = useUI(s => s.toggleDark);
  return (
    <button onClick={toggle} title="Toggle dark mode" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#475569" }}>
      <span data-no-invert style={{ display: "flex" }}><Ic n={dark ? "sun" : "moon"} size={18} /></span>
    </button>
  );
};

const Header = ({ alertCount = 0, onAlertClick }) => (
  <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <div>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Import & Container Management</div>
      <div style={{ color: "#64748b", fontSize: 12 }}>Manage your logistics operations efficiently</div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ThemeToggle />
      <button onClick={onAlertClick} aria-label={alertCount > 0 ? `${alertCount} alerts` : "Alerts"}
        style={{ position: "relative", width: 40, height: 40, borderRadius: "50%", border: "none", background: alertCount > 0 ? "#fef2f2" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: alertCount > 0 ? "#dc2626" : "#475569" }}>
        <Ic n="bell" size={18} />
        {alertCount > 0 && (
          <span style={{ position: "absolute", top: -2, right: -2, background: "#dc2626", color: "#fff", borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, border: "2px solid #fff" }}>{alertCount > 9 ? "9+" : alertCount}</span>
        )}
      </button>
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

export { apiFetch, apiUpload, apiDownload, ToastProvider, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, LineChart, Progress, Spinner, Err, NAV, Sidebar, Header, KPICard, TH, TD, Ic };
