import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch, apiUpload, useToast, fmtUSD, fmtINR, KANBAN_COL_COLOR, Spinner, Err, Ic } from "../lib/core";
import { OrderForm } from "./Orders";

// ─── TRANSITION PROMPT RULES ──────────────────────────────────────────────────
// Each target status declares what to capture when a card moves there.
// `req` fields are flagged (warn-only) if blank — the move still succeeds.
// `fx` fields prefill from the live USD→INR rate. `payment` posts a payment row.
const TRANSITION_RULES = {
  Confirmed: { icon: "check", fields: [
    { k: "usd_rate", label: "Booking USD ₹ rate", type: "number", fx: true },
    { k: "etd", label: "Expected ETD", type: "date" },
  ], docs: ["Proforma Invoice"] },
  Loaded: { icon: "box", fields: [
    { k: "loading_date", label: "Loading date", type: "date", req: true },
    { k: "freight_cost", label: "Freight cost ($)", type: "number", req: true },
  ], docs: [] },
  Shipped: { icon: "ship", fields: [
    { k: "shipment_date", label: "Shipment date", type: "date", req: true },
    { k: "bl_number", label: "BL number", type: "text", req: true },
    { k: "etd", label: "ETD", type: "date" },
    { k: "eta", label: "ETA", type: "date" },
    { k: "insurance_cost", label: "Insurance ($)", type: "number" },
  ], docs: ["Bill of Lading", "Commercial Invoice", "Packing List"] },
  "In Transit": { icon: "refresh", fields: [
    { k: "eta", label: "ETA update", type: "date" },
  ], docs: ["Certificate of Origin"] },
  Arrived: { icon: "download", fields: [
    { k: "eta", label: "Arrival date", type: "date" },
    { k: "free_days", label: "Free days", type: "number" },
    { k: "demurrage_rate", label: "Demurrage / day ($)", type: "number" },
  ], docs: ["Customs Declaration"] },
  Cleared: { icon: "lock", fields: [
    { k: "duty_rate", label: "Actual duty (%)", type: "number" },
  ], docs: ["Customs Declaration"] },
  Delivered: { icon: "receipt", fields: [
    { k: "delivered_date", label: "Delivered date", type: "date", req: true },
    { k: "cha_charges", label: "Actual CHA (₹)", type: "number", req: true },
    { k: "extra_charges", label: "Extra charges (₹)", type: "number" },
    { k: "container_returned_date", label: "Container returned", type: "date" },
    { k: "usd_rate_delivery", label: "USD ₹ @ delivery", type: "number", fx: true, req: true },
  ], docs: ["Delivery Order"] },
  Paid: { icon: "dollar", payment: true, fields: [
    { k: "_pay_date", label: "Payment date", type: "date", req: true },
    { k: "_pay_amount", label: "Amount paid ($)", type: "number", req: true },
    { k: "_pay_rate", label: "USD ₹ @ payment", type: "number", fx: true, req: true },
    { k: "_pay_type", label: "Type", type: "select", opts: ["TT", "LC", "Advance", "Balance"] },
    { k: "_pay_ref", label: "Reference (optional)", type: "text" },
  ], docs: ["Payment Proof"] },
};

const STATUS_ORDER = ["Draft","Tentative","Confirmed","Loaded","Shipped","In Transit","Arrived","Customs Clearance","Cleared","Delivered","Paid"];
const rank = (s) => STATUS_ORDER.indexOf(s);
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null;

// Cumulative "what's still blank for this stage" check → drives the ⚠ badge
function missingFor(card) {
  const r = rank(card.status), m = [];
  const blank = (v) => v === null || v === undefined || v === "" || v === 0;
  if (r >= rank("Loaded"))    { if (blank(card.loading_date)) m.push("Loading date"); if (blank(card.freight_cost)) m.push("Freight"); }
  if (r >= rank("Shipped"))   { if (blank(card.shipment_date)) m.push("Shipment date"); if (blank(card.bl_number)) m.push("BL no."); }
  if (r >= rank("Delivered")) { if (blank(card.delivered_date)) m.push("Delivered date"); if (blank(card.cha_charges)) m.push("CHA"); if (blank(card.usd_rate_delivery)) m.push("Delivery rate"); }
  if (r >= rank("Paid"))      { if (!card.payment_count) m.push("Payment"); }
  return m;
}

// Free-days countdown once a container has arrived
const demurrageInfo = (card) => {
  if (!["Arrived", "Customs Clearance", "Cleared"].includes(card.status) || !card.eta) return null;
  const end = new Date(card.eta); end.setDate(end.getDate() + (parseInt(card.free_days) || 7));
  return { left: Math.ceil((end - Date.now()) / 86400000), rate: parseFloat(card.demurrage_rate) || 0 };
};

const fldStyle = { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 6, padding: "7px 9px", fontSize: 13, outline: "none" };
const lblStyle = { display: "block", fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 };

// ─── TRANSITION MODAL (module-level → inputs keep focus) ──────────────────────
const TransitionModal = ({ order, toCol, onClose, onDone }) => {
  const rule = TRANSITION_RULES[toCol] || { fields: [], docs: [] };
  const toast = useToast();
  const [form, setForm] = useState({});
  const [docs, setDocs] = useState({});
  const [files, setFiles] = useState({});
  const [fx, setFx] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const init = {};
    (rule.fields || []).forEach(f => {
      if (f.k.startsWith("_pay_")) {
        init[f.k] = f.k === "_pay_date" ? new Date().toISOString().slice(0, 10)
          : f.k === "_pay_amount" ? (order.total_value || "")
          : f.k === "_pay_type" ? "TT" : "";
      } else {
        let v = order[f.k];
        if (v && f.type === "date") v = String(v).slice(0, 10);
        init[f.k] = v ?? "";
      }
    });
    setForm(init);
    setDocs({ ...(order.doc_checklist || {}) });
    apiFetch("/costing/fx-rate").then(r => {
      setFx(r);
      setForm(prev => {
        const next = { ...prev };
        (rule.fields || []).forEach(f => { if (f.fx && !next[f.k]) next[f.k] = r.rate; });
        return next;
      });
    }).catch(() => {});
  }, [order, toCol]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const reqMissing = (rule.fields || []).filter(f => f.req && (form[f.k] === "" || form[f.k] == null));

  const submit = async () => {
    setBusy(true);
    try {
      const payload = { doc_checklist: docs };
      (rule.fields || []).forEach(f => { if (!f.k.startsWith("_pay_")) payload[f.k] = form[f.k]; });
      await apiFetch(`/orders/${order.id}`, { method: "PUT", body: JSON.stringify(payload) });
      await apiFetch(`/orders/${order.id}/status`, { method: "PATCH", body: JSON.stringify({ status: toCol }) });
      if (rule.payment) {
        await apiFetch("/financial/payments", { method: "POST", body: JSON.stringify({
          order_id: order.id, amount: form._pay_amount, usd_rate: form._pay_rate,
          payment_date: form._pay_date, payment_type: form._pay_type,
          reference: form._pay_ref || undefined,
        }) });
      }
      for (const doc of (rule.docs || [])) {
        if (files[doc]) {
          const fd = new FormData();
          fd.append("file", files[doc]); fd.append("order_id", order.id); fd.append("doc_type", doc);
          await apiUpload("/documents/upload", fd).catch(() => {});
        }
      }
      toast(`${order.po_number} → ${toCol}`, "success");
      onDone();
    } catch (e) { toast(e.message, "error"); setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 560, maxHeight: "86vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ color: KANBAN_COL_COLOR[toCol] || "#334155", display: "inline-flex" }}><Ic n={rule.icon || "edit"} size={18} /></span>
          <span style={{ fontWeight: 800, fontSize: 16 }}>Move to {toCol}</span>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          {order.po_number} — {order.supplier}. Fill what you have; you can move now and complete the rest later.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {(rule.fields || []).map(f => (
            <div key={f.k} style={{ gridColumn: (f.type === "select" || f.k === "_pay_ref") ? "1 / -1" : "auto" }}>
              <label style={lblStyle}>
                {f.label}{f.req && <span style={{ color: "#dc2626" }}> *</span>}
                {f.fx && fx && <span style={{ color: "#0369a1", fontWeight: 400 }}> · live {fx.rate}</span>}
              </label>
              {f.type === "select" ? (
                <select value={form[f.k] ?? ""} onChange={e => set(f.k, e.target.value)} style={fldStyle}>
                  {f.opts.map(o => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.type} value={form[f.k] ?? ""} onChange={e => set(f.k, e.target.value)}
                  inputMode={f.type === "number" ? "decimal" : undefined} style={fldStyle} />
              )}
            </div>
          ))}
        </div>

        {(rule.docs || []).length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>Documents</div>
            {rule.docs.map(doc => (
              <div key={doc} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #f1f5f9" }}>
                <input type="checkbox" id={`d-${doc}`} checked={!!docs[doc]}
                  onChange={e => setDocs(p => ({ ...p, [doc]: e.target.checked }))} style={{ width: 16, height: 16 }} />
                <label htmlFor={`d-${doc}`} style={{ flex: 1, fontSize: 13 }}>{doc}</label>
                <input type="file" onChange={e => { const f = e.target.files[0]; setFiles(p => ({ ...p, [doc]: f })); if (f) setDocs(p => ({ ...p, [doc]: true })); }}
                  style={{ fontSize: 11, maxWidth: 180 }} />
              </div>
            ))}
          </div>
        )}

        {reqMissing.length > 0 && (
          <div style={{ marginTop: 14, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#92400e", display: "flex", alignItems: "center", gap: 8 }}>
            <Ic n="warn" size={15} /> Missing: {reqMissing.map(f => f.label).join(", ")}. You can still move and fill later.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ padding: "9px 20px", background: KANBAN_COL_COLOR[toCol] || "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 700 }}>
            {busy ? "Saving…" : `Confirm → ${toCol}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── DETAIL MODAL (summary + Edit) ────────────────────────────────────────────
const DetailModal = ({ id, onClose, onEdit }) => {
  const [o, setO] = useState(null);
  useEffect(() => { apiFetch(`/orders/${id}`).then(setO).catch(() => {}); }, [id]);
  if (!o) return null;
  const d = (x) => x ? String(x).slice(0, 10) : "—";
  const row = (k, v) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
      <span style={{ color: "#64748b" }}>{k}</span><span style={{ fontWeight: 600 }}>{v ?? "—"}</span>
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 65, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 620, maxHeight: "86vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}><Ic n="orders" size={16} /> {o.po_number} — {o.supplier}</span>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#64748b", padding: 4 }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
          {row("Status", o.status)}{row("Container", o.container_type)}
          {row("ETD", d(o.etd))}{row("ETA", d(o.eta))}
          {row("Loading date", d(o.loading_date))}{row("Shipment date", d(o.shipment_date))}
          {row("BL number", o.bl_number)}{row("Delivered date", d(o.delivered_date))}
          {row("Freight $", o.freight_cost)}{row("Insurance $", o.insurance_cost)}
          {row("CHA ₹", o.cha_charges)}{row("Extra ₹", o.extra_charges)}
          {row("USD rate", o.usd_rate)}{row("Rate @ delivery", o.usd_rate_delivery)}
          {row("Total value", fmtUSD(o.total_value))}{row("Payment due", d(o.payment_due_date))}
        </div>
        {(o.items || []).length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 6, textTransform: "uppercase" }}>Items ({o.items.length})</div>
            {o.items.map((it, i) => (
              <div key={i} style={{ fontSize: 12, padding: "3px 0", color: "#475569" }}>
                {it.item_name}{it.brand ? ` · ${it.brand}` : ""} · {it.total_roll} rolls · ${it.unit_price}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Close</button>
          <button onClick={() => onEdit(o)} style={{ padding: "9px 18px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Ic n="edit" size={14} /> Edit
          </button>
        </div>
      </div>
    </div>
  );
};

const Stat = ({ label, value, sub, color }) => (
  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", minWidth: 120 }}>
    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 800, color: color || "#0f172a" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>}
  </div>
);

// ─── KANBAN ───────────────────────────────────────────────────────────────────
const Kanban = () => {
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [editCtx, setEditCtx] = useState(null);
  const [search, setSearch] = useState("");
  const [forecast, setForecast] = useState(null);
  const [fxDrift, setFxDrift] = useState(null);
  const [cashflow, setCashflow] = useState(null);
  const dragCard = useRef(null);
  const cols = ["Draft", "Confirmed", "Loaded", "Shipped", "In Transit", "Arrived", "Delivered", "Paid"];

  const loadGroups = useCallback(() => {
    apiFetch("/orders/kanban").then(setGroups).catch(e => setError(e.message)).finally(() => setLoading(false));
    apiFetch("/orders/forecast").then(setForecast).catch(() => {});
    apiFetch("/costing/fx-drift").then(setFxDrift).catch(() => {});
    apiFetch("/financial/cashflow-forecast").then(setCashflow).catch(() => {});
  }, []);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const onDrop = async (toCol) => {
    if (!dragCard.current || dragCard.current.fromCol === toCol) return;
    const { card } = dragCard.current;
    dragCard.current = null;
    try {
      const full = await apiFetch(`/orders/${card.id}`);
      setModal({ order: { ...full, supplier: card.supplier }, toCol });
    } catch (e) { setError(e.message); }
  };

  const openEdit = async (order) => {
    setDetailId(null);
    try {
      const [sup, sk, full] = await Promise.all([
        apiFetch("/masters/suppliers"),
        apiFetch("/masters/skus?limit=5000"),
        apiFetch(`/orders/${order.id}`),
      ]);
      setEditCtx({ order: full, suppliers: sup.suppliers || [], skus: sk.skus || [] });
    } catch (e) { setError(e.message); }
  };

  const q = search.trim().toLowerCase();
  const match = (c) => !q || (c.po_number || "").toLowerCase().includes(q) || (c.supplier || "").toLowerCase().includes(q);

  if (loading) return <div style={{ padding: 24, flex: 1 }}><Spinner /></div>;
  const fc = (forecast && forecast.counts) || {};

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      {modal && <TransitionModal order={modal.order} toCol={modal.toCol} onClose={() => setModal(null)} onDone={() => { setModal(null); loadGroups(); }} />}
      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} onEdit={openEdit} />}
      {editCtx && <OrderForm order={editCtx.order} suppliers={editCtx.suppliers} skus={editCtx.skus}
        onSave={() => { setEditCtx(null); loadGroups(); }} onClose={() => setEditCtx(null)} />}

      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Container Status Board</h1>
        <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>Drag to move — a prompt captures that stage's data · click a card to open · ⚠ marks missing data</p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Shipping this week" value={fc.this_week ?? "—"} sub={forecast ? fmtUSD(forecast.value.this_week) : ""} color="#ea580c" />
        <Stat label="Shipping this month" value={fc.this_month ?? "—"} sub={forecast ? fmtUSD(forecast.value.this_month) : ""} color="#1d4ed8" />
        {fc.overdue > 0 && <Stat label="ETD overdue" value={fc.overdue} sub={fmtUSD(forecast.value.overdue)} color="#dc2626" />}
        {fxDrift && fxDrift.live != null && (
          <Stat label="USD ₹ (live)" value={fxDrift.live}
            sub={fxDrift.drift_pct != null ? `${fxDrift.drift_pct > 0 ? "+" : ""}${fxDrift.drift_pct}% vs avg ${fxDrift.avg_booking_rate}` : ""}
            color={fxDrift.drift_pct > 2 ? "#dc2626" : fxDrift.drift_pct < -2 ? "#15803d" : "#0369a1"} />
        )}
        {cashflow && <Stat label="Payable this month" value={fmtINR(cashflow.value.this_month)} sub={cashflow.value.overdue > 0 ? `${fmtINR(cashflow.value.overdue)} overdue` : ""} color="#b45309" />}
        <div style={{ flex: 1, minWidth: 180, display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", width: "100%" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO or supplier…"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px 9px 32px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none" }} />
            <span style={{ position: "absolute", left: 9, top: 9, color: "#94a3b8" }}><Ic n="search" size={15} /></span>
          </div>
        </div>
      </div>

      <Err msg={error} />
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {cols.map(col => {
          const all = groups[col] || [];
          const cards = all.filter(match);
          const color = KANBAN_COL_COLOR[col] || "#94a3b8";
          const colVal = cards.reduce((s, c) => s + (c.value || 0), 0);
          return (
            <div key={col} style={{ minWidth: 220, flexShrink: 0 }} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(col)}>
              <div style={{ padding: "8px 12px", borderRadius: "8px 8px 0 0", background: color }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#fff", fontWeight: 700, fontSize: 12 }}>{col}</span>
                  <span style={{ background: "rgba(255,255,255,0.3)", color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>
                    {cards.length}{q && all.length !== cards.length ? `/${all.length}` : ""}
                  </span>
                </div>
                <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: 600, marginTop: 2 }}>{fmtUSD(colVal)}</div>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: "0 0 8px 8px", border: "1px solid #e2e8f0", borderTop: "none", minHeight: 200, maxHeight: "calc(100vh - 330px)", overflowY: "auto", padding: 8 }}>
                {cards.map(c => {
                  const miss = missingFor(c);
                  const age = daysSince(c.status_changed_at);
                  const dem = demurrageInfo(c);
                  return (
                    <div key={c.id} draggable onDragStart={() => { dragCard.current = { card: c, fromCol: col }; }}
                      onClick={() => setDetailId(c.id)}
                      style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", padding: 12, marginBottom: 8, cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f" }}>{c.po_number}</span>
                        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {miss.length > 0 && (
                            <span title={`Missing: ${miss.join(", ")}`} style={{ display: "inline-flex", alignItems: "center", gap: 2, background: "#fffbeb", color: "#b45309", borderRadius: 20, padding: "1px 6px", fontSize: 10, fontWeight: 700, border: "1px solid #fde68a" }}>
                              <Ic n="warn" size={10} />{miss.length}
                            </span>
                          )}
                          <button onClick={e => { e.stopPropagation(); setDetailId(c.id); }} aria-label="Open order" title="Open order"
                            style={{ border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 2, display: "inline-flex" }}>
                            <Ic n="search" size={13} />
                          </button>
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{c.supplier}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 10, background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, color: "#475569" }}>{c.container}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>{fmtUSD(c.value)}</span>
                      </div>
                      <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                        {age != null && age >= 1 && (
                          <span title="Days in this stage" style={{ fontSize: 9, background: age > 14 ? "#fef2f2" : "#f1f5f9", color: age > 14 ? "#dc2626" : "#64748b", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{age}d in stage</span>
                        )}
                        {dem && dem.left <= 5 && (
                          <span title={dem.rate ? `Demurrage $${dem.rate}/day` : "Demurrage risk"}
                            style={{ fontSize: 9, background: dem.left < 0 ? "#dc2626" : "#fffbeb", color: dem.left < 0 ? "#fff" : "#b45309", borderRadius: 4, padding: "1px 5px", fontWeight: 700, border: "1px solid #fde68a" }}>
                            {dem.left < 0 ? `demurrage +${-dem.left}d` : `free ${dem.left}d left`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 && <div style={{ textAlign: "center", padding: "30px 0", color: "#cbd5e1", fontSize: 12 }}>{q ? "No match" : "Drop here"}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { Kanban };
