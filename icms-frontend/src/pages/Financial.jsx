import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
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
      setShowForm(false);
      setForm({ reference: "", order_id: "", supplier_id: "", amount: "", currency: "USD", payment_date: new Date().toISOString().split("T")[0], payment_type: "TT", notes: "" });
      load(); toast("Payment recorded successfully", "success");
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

export { Financial };
