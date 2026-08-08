import { useState, useEffect } from "react";
import { apiFetch, ToastProvider, Sidebar, Header } from "./lib/core";
import { Dashboard }   from "./pages/Dashboard";
import { ImportOrders } from "./pages/Orders";
import { Costing }     from "./pages/Costing";
import { Scheduler }   from "./pages/Scheduler";
import { Analytics }   from "./pages/Analytics";
import { AgentChat }   from "./pages/AgentChat";
import { Kanban }      from "./pages/Kanban";
import { Financial }   from "./pages/Financial";
import { Masters }     from "./pages/Masters";
import { Documents }   from "./pages/Documents";
import { Reports }     from "./pages/Reports";
import { Settings }    from "./pages/SettingsPage";
import { Login }       from "./pages/Login";

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
    const fetch = () => apiFetch("/alerts").then(r => {
      setAlertCount((r.counts?.critical || 0) + (r.counts?.warning || 0));
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
    costing:   <Costing />,
    scheduler: <Scheduler />,
    analytics: <Analytics />,
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
          <AgentChat />
        </div>
      </div>
    </ToastProvider>
  );
}
