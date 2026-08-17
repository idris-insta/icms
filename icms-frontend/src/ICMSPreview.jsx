import { useEffect } from "react";
import { ToastProvider, Sidebar, Header } from "./lib/core";
import { useAuth } from "./store/auth";
import { useUI } from "./store/ui";
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
  const user   = useAuth(s => s.user);
  const ready  = useAuth(s => s.ready);
  const hydrate = useAuth(s => s.hydrate);
  const logout = useAuth(s => s.logout);

  const page       = useUI(s => s.page);
  const setPage    = useUI(s => s.setPage);
  const alertCount = useUI(s => s.alertCount);
  const applyTheme = useUI(s => s.applyTheme);

  useEffect(() => { applyTheme(); hydrate(); }, [applyTheme, hydrate]);

  // Keep the bell badge fresh while signed in.
  useEffect(() => {
    if (!user) return;
    const { startAlertPolling, stopAlertPolling } = useUI.getState();
    startAlertPolling();
    return stopAlertPolling;
  }, [user]);

  if (!ready) return <ToastProvider><div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: "system-ui" }}>Loading…</div></ToastProvider>;
  if (!user)  return <ToastProvider><Login onLogin={(u) => { useAuth.getState().setUser(u); setPage("dashboard"); }} /></ToastProvider>;

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
    settings:  <Settings user={user} />,
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
