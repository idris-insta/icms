import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, CURRENCIES, Spinner, Err, Ic } from "../lib/core";

const ROLES = ["owner", "manager", "staff", "viewer"];
const ROLE_DESC = {
  owner:   "Full control — users, settings, all data",
  manager: "Create/edit orders, costing, masters; no user admin",
  staff:   "Create/edit orders & costing; no settings",
  viewer:  "Read-only across the system",
};
// Reference matrix — the server enforces these via authorize()
const PERMISSIONS = [
  ["View dashboard & orders",           ["owner", "manager", "staff", "viewer"]],
  ["Create / edit orders",              ["owner", "manager", "staff"]],
  ["Delete orders",                     ["owner", "manager"]],
  ["Edit costing & rates",              ["owner", "manager", "staff"]],
  ["Import historical data",            ["owner", "manager", "staff"]],
  ["Manage masters (SKUs / suppliers)", ["owner", "manager"]],
  ["Edit system settings",              ["owner"]],
  ["Manage users & passwords",          ["owner"]],
];

const iconBtn = (color) => ({ background: "transparent", border: "none", cursor: "pointer", color, fontSize: 12, fontWeight: 600, padding: "3px 6px" });
const primaryBtn = { padding: "9px 18px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 };
const ghostBtn   = { padding: "9px 16px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#334155", fontWeight: 600 };
const inp = { width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 13, outline: "none", boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 5 };

// ─── SETTINGS ────────────────────────────────────────────────────────────────
const Settings = ({ user }) => {
  const isOwner = user && user.role === "owner";
  const [tab, setTab] = useState("general");
  const TABS = [["general", "General", "building"], ...(isOwner ? [["users", "Users", "users"]] : []),
    ["permissions", "Permissions", "lock"], ["import", "Import Data", "upload"]];

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 16 }}>System Settings</h1>
      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 18, maxWidth: 560 }}>
        {TABS.map(([t, label, icon]) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? "true" : undefined}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 6px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: tab === t ? 700 : 400, background: tab === t ? "#fff" : "transparent", color: tab === t ? "#1d4ed8" : "#64748b", boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
            <Ic n={icon} size={14} />{label}
          </button>
        ))}
      </div>
      {tab === "general"     && <GeneralSettings />}
      {tab === "users"       && isOwner && <UsersPanel currentUser={user} />}
      {tab === "permissions" && <PermissionsPanel />}
      {tab === "import"      && <ImportPanel />}
    </div>
  );
};

// ─── General + AI provider ────────────────────────────────────────────────────
const GeneralSettings = () => {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    apiFetch("/settings").then(r => setSettings(r.settings || {})).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  const save = async () => {
    setSaving(true); setError(""); setSuccess("");
    try {
      const r = await apiFetch("/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(r.settings); setSuccess("Settings saved.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  if (loading) return <Spinner />;

  return (
    <>
      <Err msg={error} />
      {success && <div style={{ padding: "8px 12px", background: "#f0fdf4", color: "#16a34a", borderRadius: 6, fontSize: 13, marginBottom: 12, border: "1px solid #bbf7d0" }}>{success}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 16 }}><Ic n="building" size={17} /> Company Information</div>
          {[["company_name","Company Name"],["company_address","Address"],["company_phone","Phone"],["company_email","Email"]].map(([k, l]) => (
            <div key={k} style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor={`s-${k}`}>{l}</label>
              <input id={`s-${k}`} style={inp} value={settings[k] || ""} onChange={e => set(k, e.target.value)} />
            </div>
          ))}
          <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 16 }}><Ic n="clipboard" size={17} /> PDF & Document Settings</div>
          {[["pdf_header_text","PDF Header Text"],["pdf_footer_text","PDF Footer Text"]].map(([k, l]) => (
            <div key={k} style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor={`s-${k}`}>{l}</label>
              <input id={`s-${k}`} style={inp} value={settings[k] || ""} onChange={e => set(k, e.target.value)} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "#f8fafc", borderRadius: 8, marginBottom: 14 }}>
            <span id="duty-lbl" style={{ fontSize: 13 }}>Show Duty Rate on PDF</span>
            <button type="button" role="switch" aria-checked={settings.show_duty_on_pdf === "true"} aria-labelledby="duty-lbl"
              onClick={() => set("show_duty_on_pdf", settings.show_duty_on_pdf === "true" ? "false" : "true")}
              style={{ width: 36, height: 20, padding: 0, background: settings.show_duty_on_pdf === "true" ? "#3b82f6" : "#cbd5e1", border: "none", borderRadius: 10, position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
              <span style={{ width: 16, height: 16, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, left: settings.show_duty_on_pdf === "true" ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl} htmlFor="s-cur">Default Currency</label>
            <select id="s-cur" style={inp} value={settings.default_currency || "USD"} onChange={e => set("default_currency", e.target.value)}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>

      {/* AI Assistant — Ollama (local) or Anthropic */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginTop: 20, maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 6 }}><Ic n="refresh" size={17} /> AI Assistant</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          Powers Ask-your-data, daily triage, FX advisor and invoice extraction. Use a local <b>Ollama</b> server (no key, private) or <b>Anthropic</b> (cloud).
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl} htmlFor="ai-prov">Provider</label>
          <select id="ai-prov" style={inp} value={settings.ai_provider || "none"} onChange={e => set("ai_provider", e.target.value)}>
            <option value="none">Off</option>
            <option value="ollama">Ollama (local)</option>
            <option value="anthropic">Anthropic (cloud)</option>
          </select>
        </div>
        {settings.ai_provider === "ollama" && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor="ai-url">Ollama URL</label>
              <input id="ai-url" style={inp} value={settings.ai_ollama_url || "http://localhost:11434"} onChange={e => set("ai_ollama_url", e.target.value)} placeholder="http://localhost:11434" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor="ai-model">Model</label>
              <input id="ai-model" style={inp} value={settings.ai_model || ""} onChange={e => set("ai_model", e.target.value)} placeholder="llama3.1" />
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
              Run <code>ollama serve</code>, then <code>ollama pull {settings.ai_model || "llama3.1"}</code>. Keep the URL on localhost unless Ollama runs elsewhere.
            </div>
          </>
        )}
        {settings.ai_provider === "anthropic" && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor="ai-key">Anthropic API key</label>
              <input id="ai-key" style={inp} type="password" autoComplete="off" value={settings.ai_anthropic_key || ""} onChange={e => set("ai_anthropic_key", e.target.value)} placeholder="sk-ant-…" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor="ai-model2">Model</label>
              <input id="ai-model2" style={inp} value={settings.ai_model || ""} onChange={e => set("ai_model", e.target.value)} placeholder="claude-sonnet-4-6" />
            </div>
          </>
        )}
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving…" : "Save AI Settings"}</button>
      </div>
    </>
  );
};

// ─── Users (owner only) ───────────────────────────────────────────────────────
const BLANK_USER = { email: "", name: "", password: "", role: "staff" };
const UsersPanel = ({ currentUser }) => {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [form, setForm]       = useState(BLANK_USER);
  const [editing, setEditing] = useState(null);
  const [pwFor, setPwFor]     = useState(null);
  const [pwVal, setPwVal]     = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/users").then(r => setUsers(r.users || [])).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try { await apiFetch("/users", { method: "POST", body: JSON.stringify(form) }); toast("User created", "success"); setForm(BLANK_USER); load(); }
    catch (e) { toast(e.message, "error"); }
  };
  const saveEdit = async () => {
    try {
      await apiFetch(`/users/${editing.id}`, { method: "PUT", body: JSON.stringify({ name: editing.name, email: editing.email, role: editing.role }) });
      toast("User updated", "success"); setEditing(null); load();
    } catch (e) { toast(e.message, "error"); }
  };
  const toggleActive = async (u) => {
    try { await apiFetch(`/users/${u.id}`, { method: "PUT", body: JSON.stringify({ is_active: !u.is_active }) }); load(); }
    catch (e) { toast(e.message, "error"); }
  };
  const resetPw = async () => {
    try {
      await apiFetch(`/users/${pwFor}/password`, { method: "PUT", body: JSON.stringify({ password: pwVal }) });
      toast("Password updated", "success"); setPwFor(null); setPwVal("");
    } catch (e) { toast(e.message, "error"); }
  };
  const del = async (u) => {
    if (!(await confirm(`Delete user "${u.name}"? This cannot be undone.`))) return;
    try { await apiFetch(`/users/${u.id}`, { method: "DELETE" }); toast("User deleted", "success"); load(); }
    catch (e) { toast(e.message, "error"); }
  };
  const roleBadge = (role) => {
    const c = { owner: ["#fef3c7", "#92400e"], manager: ["#dbeafe", "#1e40af"], staff: ["#dcfce7", "#166534"], viewer: ["#f1f5f9", "#475569"] }[role] || ["#f1f5f9", "#475569"];
    return <span style={{ background: c[0], color: c[1], padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{role}</span>;
  };

  if (loading) return <Spinner />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <Err msg={error} />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["User", "Email", "Role", "Status", ""].map(h => (
            <th key={h} style={{ padding: "10px 12px", background: "#1e3a5f", color: "#fff", fontSize: 11, textTransform: "uppercase", textAlign: "left", letterSpacing: "0.04em" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.id} style={{ background: i % 2 ? "#f8fafc" : "#fff", borderBottom: "1px solid #eef1f5" }}>
                <td style={{ padding: "9px 12px", fontWeight: 600, fontSize: 13 }}>
                  {u.name}{u.id === currentUser.id && <span style={{ color: "#94a3b8", fontWeight: 400 }}> (you)</span>}
                </td>
                <td style={{ padding: "9px 12px", fontSize: 12, color: "#475569" }}>{u.email}</td>
                <td style={{ padding: "9px 12px" }}>{roleBadge(u.role)}</td>
                <td style={{ padding: "9px 12px" }}>
                  <button onClick={() => toggleActive(u)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, color: u.is_active ? "#16a34a" : "#dc2626" }}>
                    {u.is_active ? "● Active" : "○ Inactive"}
                  </button>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => setEditing({ ...u })} style={iconBtn("#1d4ed8")}>Edit</button>
                  <button onClick={() => { setPwFor(u.id); setPwVal(""); }} style={iconBtn("#b45309")}>Password</button>
                  {u.id !== currentUser.id && <button onClick={() => del(u)} style={iconBtn("#dc2626")}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
        {editing ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 14, marginBottom: 14 }}><Ic n="edit" size={16} /> Edit User</div>
            <div style={{ marginBottom: 10 }}><label style={lbl} htmlFor="e-name">Name</label><input id="e-name" style={inp} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
            <div style={{ marginBottom: 10 }}><label style={lbl} htmlFor="e-mail">Email</label><input id="e-mail" style={inp} value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor="e-role">Role</label>
              <select id="e-role" style={inp} value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{ROLE_DESC[editing.role]}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveEdit} style={primaryBtn}>Save</button>
              <button onClick={() => setEditing(null)} style={ghostBtn}>Cancel</button>
            </div>
          </>
        ) : pwFor ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 14, marginBottom: 14 }}><Ic n="key" size={16} /> Reset Password</div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor="pw">New password (min 6 chars)</label>
              <input id="pw" style={inp} type="text" value={pwVal} onChange={e => setPwVal(e.target.value)} placeholder="new password" />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={resetPw} style={primaryBtn}>Update Password</button>
              <button onClick={() => setPwFor(null)} style={ghostBtn}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 14, marginBottom: 14 }}><Ic n="plus" size={16} /> Add User</div>
            <div style={{ marginBottom: 10 }}><label style={lbl} htmlFor="n-name">Name</label><input id="n-name" style={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div style={{ marginBottom: 10 }}><label style={lbl} htmlFor="n-mail">Email</label><input id="n-mail" style={inp} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div style={{ marginBottom: 10 }}><label style={lbl} htmlFor="n-pw">Password</label><input id="n-pw" style={inp} type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl} htmlFor="n-role">Role</label>
              <select id="n-role" style={inp} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{ROLE_DESC[form.role]}</div>
            </div>
            <button onClick={create} style={{ ...primaryBtn, width: "100%" }}>Create User</button>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Permissions reference ────────────────────────────────────────────────────
const PermissionsPanel = () => (
  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", maxWidth: 760 }}>
    <div style={{ padding: "14px 18px", borderBottom: "1px solid #eef1f5" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}><Ic n="lock" size={17} /> Role Permissions</div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>Roles are enforced on the server. Assign a user's role in the Users tab.</div>
    </div>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        <th style={{ padding: "9px 14px", textAlign: "left", background: "#f8fafc", fontSize: 11, textTransform: "uppercase", color: "#475569" }}>Capability</th>
        {ROLES.map(r => <th key={r} style={{ padding: "9px 6px", background: "#f8fafc", fontSize: 11, textTransform: "uppercase", color: "#475569" }}>{r}</th>)}
      </tr></thead>
      <tbody>
        {PERMISSIONS.map(([cap, allowed], i) => (
          <tr key={cap} style={{ background: i % 2 ? "#fff" : "#fcfdfe", borderTop: "1px solid #eef1f5" }}>
            <td style={{ padding: "9px 14px", fontSize: 13 }}>{cap}</td>
            {ROLES.map(r => (
              <td key={r} style={{ padding: "9px 6px", textAlign: "center", fontSize: 14, color: allowed.includes(r) ? "#16a34a" : "#cbd5e1" }}>
                {allowed.includes(r) ? "✓" : "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Import historical orders ─────────────────────────────────────────────────
const ImportPanel = () => {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const toast = useToast();
  const fileRef = useRef();

  const upload = async () => {
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await apiUpload("/orders/import", fd);
      setResult(r);
      toast(`Imported ${r.created} order(s)`, r.created ? "success" : "info");
      setFile(null); if (fileRef.current) fileRef.current.value = "";
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 6 }}><Ic n="upload" size={17} /> Import Old Orders (Excel / CSV)</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16, lineHeight: 1.5 }}>
          Upload an <b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> file with one row per line item. Rows group into orders by <b>po_number</b>.
          Suppliers are matched by <b>supplier_code</b> (must already exist in Masters). Download the template for the exact columns.
        </div>
        <button onClick={() => apiDownload("/orders/import/template", "orders_import_template.xlsx")}
          style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
          <Ic n="download" size={15} /> Download Template (.xlsx)
        </button>

        <div style={{ border: "2px dashed #cbd5e1", borderRadius: 10, padding: 22, textAlign: "center", background: "#f8fafc", marginBottom: 16 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files[0] || null)} style={{ fontSize: 13 }} />
          {file && <div style={{ marginTop: 10, fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>{file.name}</div>}
        </div>

        <button onClick={upload} disabled={!file || busy}
          style={{ ...primaryBtn, opacity: (!file || busy) ? 0.5 : 1, cursor: (!file || busy) ? "not-allowed" : "pointer" }}>
          {busy ? "Importing…" : "Import File"}
        </button>

        {result && (
          <div style={{ marginTop: 18, padding: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
            <div style={{ fontWeight: 700, color: "#15803d", fontSize: 14 }}>{result.created} of {result.groups} order group(s) imported</div>
            {result.errors && result.errors.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>Skipped / warnings:</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "#92400e" }}>
                  {result.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export { Settings };
