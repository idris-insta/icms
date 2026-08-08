import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
// ─── SETTINGS ────────────────────────────────────────────────────────────────
const Settings = () => {
  const [settings, setSettings] = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  useEffect(() => {
    apiFetch("/settings").then(r => setSettings(r.settings || {})).catch(e => setError(e.message)).finally(() => setLoading(false));
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

export { Settings };
