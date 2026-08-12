import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD, Ic } from "../lib/core";
import { printPO, printOrderList, printOrdersDetailed } from "../lib/print";

// ─── CONTAINER LOAD PLANNER ───────────────────────────────────────────────────
const CONTAINER_CAP = { "20FT": { cbm: 33, kg: 28000 }, "40FT": { cbm: 67, kg: 26500 }, "40HC": { cbm: 76, kg: 26500 }, "40HQ": { cbm: 76, kg: 26500 } };
const LoadPlanner = ({ onClose }) => {
  const [ct, setCt] = useState("40HQ");
  const [cbm, setCbm] = useState("0.08");
  const [wt, setWt] = useState("12");
  const [rolls, setRolls] = useState("24");
  const [price, setPrice] = useState("");
  const cap = CONTAINER_CAP[ct] || CONTAINER_CAP["40HQ"];
  const c = parseFloat(cbm) || 0, w = parseFloat(wt) || 0;
  const maxByCbm = c > 0 ? Math.floor(cap.cbm / c) : 0;
  const maxByWt  = w > 0 ? Math.floor(cap.kg / w) : 0;
  const cartons = Math.min(maxByCbm || Infinity, maxByWt || Infinity);
  const fit = Number.isFinite(cartons) ? cartons : 0;
  const limit = (maxByCbm && maxByWt) ? (maxByCbm <= maxByWt ? "volume (CBM)" : "weight") : maxByCbm ? "volume (CBM)" : "weight";
  const usedCbm = fit * c, usedKg = fit * w;
  const inp = { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 6, padding: "7px 9px", fontSize: 13, outline: "none" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}><Ic n="kanban" size={17} /> Container Load Planner</span>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#64748b", padding: 4 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Max cartons that fit one container, by volume and weight.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div><label style={lbl}>Container</label><select style={inp} value={ct} onChange={e => setCt(e.target.value)}>{["20FT","40FT","40HC","40HQ"].map(x => <option key={x}>{x}</option>)}</select></div>
          <div><label style={lbl}>Capacity</label><div style={{ ...inp, background: "#f8fafc", color: "#475569" }}>{cap.cbm} m³ · {cap.kg / 1000}t</div></div>
          <div><label style={lbl}>CBM / carton (m³)</label><input type="number" style={inp} value={cbm} onChange={e => setCbm(e.target.value)} /></div>
          <div><label style={lbl}>Weight / carton (kg)</label><input type="number" style={inp} value={wt} onChange={e => setWt(e.target.value)} /></div>
          <div><label style={lbl}>Rolls / carton</label><input type="number" style={inp} value={rolls} onChange={e => setRolls(e.target.value)} /></div>
          <div><label style={lbl}>Price / roll $ (opt)</label><input type="number" style={inp} value={price} onChange={e => setPrice(e.target.value)} /></div>
        </div>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#15803d", fontWeight: 600, marginBottom: 8 }}>
            Fits ~<b style={{ fontSize: 22 }}>{fit.toLocaleString()}</b> cartons <span style={{ color: "#64748b", fontWeight: 400 }}>(limited by {limit})</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12.5 }}>
            <span>Total rolls: <b>{(fit * (parseInt(rolls) || 0)).toLocaleString()}</b></span>
            <span>Used volume: <b>{usedCbm.toFixed(1)} m³</b> ({Math.round(usedCbm / cap.cbm * 100)}%)</span>
            <span>Used weight: <b>{(usedKg / 1000).toFixed(1)} t</b> ({Math.round(usedKg / cap.kg * 100)}%)</span>
            {price && <span>Goods value: <b>{fmtUSD(fit * (parseInt(rolls) || 0) * (parseFloat(price) || 0))}</b></span>}
          </div>
        </div>
      </div>
    </div>
  );
};
// ─── SEARCHABLE SKU PICKER (module-level → no focus loss) ─────────────────────
// Multi-keyword search: every space-separated term must match the item's text.
const skuHaystack = (s) => [s.sku_code, s.description, s.category, s.brand, s.backing_material,
  s.adhesive_type, s.color, s.liner_color, s.thickness, s.size, s.item_code]
  .filter(Boolean).join(" ").toLowerCase();

const SkuPicker = ({ skus, value, onSelect }) => {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);
  const selected = value ? skus.find(s => String(s.id) === String(value)) : null;

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = !open ? [] : skus.filter(s => {
    if (!terms.length) return true;
    const hay = skuHaystack(s);
    return terms.every(t => hay.includes(t));
  }).slice(0, 60);

  const pick = (s) => { onSelect(String(s.id)); setOpen(false); setQuery(""); };
  const inpStyle = { border: "1px solid #e2e8f0", borderRadius: 5, padding: "5px 7px", fontSize: 11, outline: "none", width: "100%", boxSizing: "border-box", background: "#fff" };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        value={open ? query : (selected ? (selected.description || selected.sku_code) : "")}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        placeholder="🔍 Search master (e.g. bopp 38 brown)…"
        style={{ ...inpStyle, color: selected && !open ? "#0f172a" : "#374151" }} />
      {selected && !open && (
        <button type="button" title="Clear" onMouseDown={e => { e.preventDefault(); onSelect(""); }}
          style={{ position: "absolute", right: 4, top: 4, border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", fontSize: 12 }}>×</button>
      )}
      {open && (
        <div style={{ position: "absolute", zIndex: 70, top: "100%", left: 0, right: 0, marginTop: 2, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", maxHeight: 280, overflowY: "auto" }}>
          {matches.length === 0 && <div style={{ padding: "8px 10px", fontSize: 11, color: "#94a3b8" }}>No matches</div>}
          {matches.map(s => (
            <div key={s.id} onMouseDown={e => { e.preventDefault(); pick(s); }}
              style={{ padding: "6px 10px", fontSize: 11, cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
              onMouseEnter={e => e.currentTarget.style.background = "#eff6ff"}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
              <div style={{ fontWeight: 600, color: "#0f172a" }}>{s.description || s.sku_code}</div>
              <div style={{ color: "#64748b", fontSize: 10 }}>
                {[s.sku_code, s.category, s.brand, s.thickness, s.color].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── ORDER FORM MODAL ─────────────────────────────────────────────────────────
const BLANK_ITEM = { _sku_id: "", item_name: "", brand: "", thickness: "", size: "", liner_color: "", qty_ctn: "", total_ctn: "", total_roll: "", unit_price: "", price_per_sqm: "", kg_pkg: "", code: "", shipping_mark: "", marking: "", notes: "", cbm: "" };
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
      ? order.items.map(i => ({ _sku_id: "", item_name: i.item_name || "", brand: i.brand || "", thickness: i.thickness || "", size: i.size || "", liner_color: i.liner_color || "", qty_ctn: i.qty_ctn || "", total_ctn: i.total_ctn || "", total_roll: i.total_roll || "", unit_price: i.unit_price || "", price_per_sqm: i.price_per_sqm || "", kg_pkg: i.kg_pkg || "", code: i.code || "", shipping_mark: i.shipping_mark || "", marking: i.marking || "", notes: i.notes || "", cbm: i.cbm || "" }))
      : [{ ...BLANK_ITEM }, { ...BLANK_ITEM }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [fetchingPO, setFetchingPO] = useState(false);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Auto-calc total_roll = total_ctn × qty_ctn; auto-calc cbm = total_ctn × cbm_per_unit from SKU
  const setItem  = (idx, k, v) => setItems(prev => prev.map((r, i) => {
    if (i !== idx) return r;
    const updated = { ...r, [k]: v };
    if ((k === "total_ctn" || k === "qty_ctn") && updated.qty_ctn && updated.total_ctn) {
      const calc = parseInt(updated.total_ctn) * parseInt(updated.qty_ctn);
      if (!isNaN(calc)) updated.total_roll = String(calc);
    }
    if (k === "total_ctn" && updated._sku_id) {
      const sku = skus.find(s => String(s.id) === String(updated._sku_id));
      if (sku?.cbm_per_unit) {
        const cbm = (parseInt(updated.total_ctn) || 0) * parseFloat(sku.cbm_per_unit);
        if (!isNaN(cbm) && cbm > 0) updated.cbm = cbm.toFixed(3);
      }
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

  // Auto-fill row from SKU master selection (also sets CBM from cbm_per_unit × total_ctn)
  const selectSku  = (idx, skuId) => {
    setItems(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      if (!skuId) return { ...r, _sku_id: "" };
      const sku = skus.find(s => String(s.id) === String(skuId));
      if (!sku) return { ...r, _sku_id: skuId };
      const ctn = parseInt(r.total_ctn) || 0;
      const autoCbm = sku.cbm_per_unit
        ? (ctn > 0 ? (ctn * parseFloat(sku.cbm_per_unit)).toFixed(3) : String(parseFloat(sku.cbm_per_unit)))
        : r.cbm;
      return {
        ...r,
        _sku_id:       skuId,
        item_name:     sku.description  || sku.sku_code || r.item_name,
        brand:         sku.brand        || r.brand,
        thickness:     sku.thickness    || r.thickness,
        size:          sku.size         || r.size,
        liner_color:   sku.liner_color  || sku.color || r.liner_color,
        kg_pkg:        sku.roll_weight  != null ? String(sku.roll_weight) : r.kg_pkg,
        code:          sku.item_code    || r.code,
        shipping_mark: sku.shipping_marks || r.shipping_mark,
        cbm:           autoCbm,
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
                    <TH w={90}>Brand</TH>
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
                    <TH w={90}>Marking</TH>
                    <TH w={155}>Shipping Mark</TH>
                    <TH w={85}>$/SQM</TH>
                    <TH w={150}>Item Notes</TH>
                    <TH w={36}></TH>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => {
                    const rowTotal   = (parseInt(row.total_roll) || 0) * (parseFloat(row.unit_price) || 0);
                    const rowTotalKg = (parseInt(row.total_ctn)  || 0) * (parseFloat(row.kg_pkg)    || 0);
                    const isEven = idx % 2 === 0;
                    // ci() returns JSX directly (not a component) — avoids remount/focus-loss on state changes
                    const ci = (field, type = "text", ph = "") => (
                      <input type={type} placeholder={ph} value={row[field]}
                        onChange={e => setItem(idx, field, e.target.value)}
                        style={{ ...inp, textAlign: type === "number" ? "right" : "left" }} />
                    );
                    return (
                      <tr key={idx} style={{ background: isEven ? "#fff" : "#f8fafc" }}>
                        <TD>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <SkuPicker skus={skus} value={row._sku_id} onSelect={(id) => selectSku(idx, id)} />
                            <input placeholder="or type item name…" value={row.item_name}
                              onChange={e => setItem(idx, "item_name", e.target.value)}
                              style={{ ...inp, fontSize: 11, color: "#374151" }} />
                          </div>
                        </TD>
                        <TD>{ci("brand", "text", "STUK")}</TD>
                        <TD>{ci("thickness", "text", "0.9MM")}</TD>
                        <TD>{ci("size", "text", "1000MM×50M")}</TD>
                        <TD>{ci("liner_color", "text", "YELLOW")}</TD>
                        <TD>{ci("qty_ctn", "number", "24")}</TD>
                        <TD>{ci("total_ctn", "number", "0")}</TD>
                        <TD style={{ background: "#f0fdf4" }}>{ci("total_roll", "number", "0")}</TD>
                        <TD>{ci("unit_price", "number", "0.00")}</TD>
                        <TD style={{ background: "#fffbeb" }}>
                          <div style={{ padding: "5px 7px", textAlign: "right", fontWeight: 600, color: "#92400e", fontSize: 12 }}>
                            {rowTotal.toLocaleString()}
                          </div>
                        </TD>
                        <TD>{ci("kg_pkg", "number", "0")}</TD>
                        <TD style={{ background: "#fffbeb" }}>
                          <div style={{ padding: "5px 7px", textAlign: "right", fontWeight: 600, color: "#92400e", fontSize: 12 }}>
                            {rowTotalKg.toLocaleString()}
                          </div>
                        </TD>
                        <TD>{ci("cbm", "number", "0.000")}</TD>
                        <TD>{ci("code", "text", "IS-57145V-1.0YL")}</TD>
                        <TD>{ci("marking", "text", "1MM")}</TD>
                        <TD>{ci("shipping_mark", "text", "INSULATION…")}</TD>
                        <TD>{ci("price_per_sqm", "number", "0.00")}</TD>
                        <TD>{ci("notes", "text", "note…")}</TD>
                        <TD>
                          <button type="button" onClick={() => delRow(idx)} aria-label="Remove line item" title="Remove line item" style={{ background: "#fef2f2", border: "none", borderRadius: 4, cursor: "pointer", color: "#dc2626", fontSize: 16, padding: "4px 9px", fontWeight: 700, minHeight: 30 }}>×</button>
                        </TD>
                      </tr>
                    );
                  })}
                  {/* Totals row */}
                  <tr style={{ background: "#1e3a5f" }}>
                    <td colSpan={5} style={{ padding: "8px 10px", color: "#fff", fontWeight: 700, fontSize: 12, border: "1px solid #2d4f7f" }}>TOTALS</td>
                    <td style={{ border: "1px solid #2d4f7f" }}></td>
                    <td style={{ padding: "8px 6px", color: "#fbbf24", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalCtn.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", color: "#fbbf24", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalRoll.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", border: "1px solid #2d4f7f" }}></td>
                    <td style={{ padding: "8px 6px", color: "#34d399", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>${totalValue.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", border: "1px solid #2d4f7f" }}></td>
                    <td style={{ padding: "8px 6px", color: "#34d399", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalKg.toLocaleString()}</td>
                    <td style={{ padding: "8px 6px", color: "#34d399", fontWeight: 800, fontSize: 13, textAlign: "right", border: "1px solid #2d4f7f" }}>{totalCbm.toFixed(2)}</td>
                    <td colSpan={6} style={{ border: "1px solid #2d4f7f" }}></td>
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
  const [showPlanner, setShowPlanner] = useState(false);
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
  const [checked, setChecked]       = useState({});   // { [orderId]: true } for multi-print
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
        apiFetch("/masters/skus?limit=5000"),
        apiFetch("/orders/supplier-summary"),
      ]);
      setOrders(oRes.orders || []); setSuppliers(sRes.suppliers || []); setSkus(skuRes.skus || []);
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

  // Duplicate one order as a new Draft (new PO number, items copied)
  const handleDuplicate = async (id) => {
    try {
      const dup = await apiFetch(`/orders/${id}/duplicate`, { method: "POST" });
      setOrders(prev => [dup, ...prev]);
      toast(`Duplicated as ${dup.po_number}`, "success");
    } catch (e) { setError(e.message); }
  };

  // Bulk-create N copies of an order with a shipping schedule.
  // e.g. "this order × 10, ship 1 container weekly" → 10 POs, ETD staggered 7 days apart.
  const handleBulk = async (id) => {
    const n = parseInt(window.prompt("How many containers / orders? (e.g. 10)", "10"));
    if (!n || n < 1) return;
    const iv = parseInt(window.prompt("Ship 1 container every how many days?\n7 = weekly · 15 = fortnightly · 30 = monthly", "7"));
    const start = window.prompt("First shipment ETD (YYYY-MM-DD)", new Date().toISOString().split("T")[0]);
    try {
      const r = await apiFetch("/orders/bulk", { method: "POST", body: JSON.stringify({ source_order_id: id, count: n, interval_days: iv || 0, start_date: start || null }) });
      toast(`Created ${r.count} orders (batch ${r.batch_id})${iv ? `, 1 every ${iv}d` : ""}`, "success");
      load();
    } catch (e) { setError(e.message); }
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
      {showPlanner && <LoadPlanner onClose={() => setShowPlanner(false)} />}
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
            {[["list","📋 List"],["grouped","📂 By Supplier"],["supplier","🏭 Stats"]].map(([v, label]) => (
              <button key={v} onClick={() => { setView(v); setSelectedSupplier(null); setSelected(null); }}
                style={{ padding: "6px 12px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: view === v ? 600 : 400, background: view === v ? "#fff" : "transparent", color: view === v ? "#1d4ed8" : "#64748b" }}>{label}</button>
            ))}
          </div>
          <button onClick={() => setShowPlanner(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#374151", fontWeight: 500 }}><Ic n="kanban" size={14} /> Load Planner</button>
          <button onClick={exportOrders} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#374151", fontWeight: 500 }}><Ic n="download" size={14} /> Export CSV</button>
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
                                  {["ITEM","THICKNESS","SIZE","LINER/COLOR","QTY/CTN","TOTAL CTN","TOTAL ROLL","PRICE $","TOTAL $","KG/PKG","TOTAL KG","CBM","CODE","SHIPPING MARK"].map(h =>
                                    <th key={h} style={{ padding: "6px 8px", color: "#fff", fontWeight: 600, fontSize: 10, textAlign: h.includes("TOTAL") || h === "PRICE $" || h === "QTY/CTN" || h === "CBM" ? "right" : "left", whiteSpace: "nowrap", border: "1px solid #4b5563" }}>{h}</th>
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
                                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#7c3aed", fontWeight: 600 }}>{parseFloat(item.cbm || 0).toFixed(3)}</td>
                                      <td style={{ padding: "6px 8px", fontSize: 10, color: "#475569" }}>{item.code}</td>
                                      <td style={{ padding: "6px 8px", fontSize: 10, color: "#475569" }}>{item.shipping_mark}</td>
                                    </tr>
                                  );
                                })}
                                {(!exp.items || exp.items.length === 0) && (
                                  <tr><td colSpan={14} style={{ padding: 12, textAlign: "center", color: "#94a3b8" }}>No items recorded for this order</td></tr>
                                )}
                                {exp.items?.length > 0 && (() => {
                                  const tCtn  = exp.items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0), 0);
                                  const tRoll = exp.items.reduce((s, i) => s + (parseInt(i.total_roll) || 0), 0);
                                  const tVal  = exp.items.reduce((s, i) => s + (parseInt(i.total_roll) || 0) * (parseFloat(i.unit_price) || 0), 0);
                                  const tKg   = exp.items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0) * (parseFloat(i.kg_pkg)    || 0), 0);
                                  const tCbm  = exp.items.reduce((s, i) => s + (parseFloat(i.cbm) || 0), 0);
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
                                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#c4b5fd", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tCbm.toFixed(3)}</td>
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

      {/* ── GROUPED BY SUPPLIER VIEW ── */}
      {view === "grouped" && !loading && (() => {
        const grouped = orders.reduce((acc, o) => {
          const key = o.supplier || "Unknown";
          if (!acc[key]) acc[key] = { supplier: key, supplier_id: o.supplier_id, orders: [] };
          acc[key].orders.push(o);
          return acc;
        }, {});
        const groups = Object.values(grouped).sort((a, b) => a.supplier.localeCompare(b.supplier));
        return (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO, supplier…" style={{ flex: 1, minWidth: 180, padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none" }} />
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {statusFilters.slice(0, 5).map(s => (
                  <button key={s} onClick={() => setFilter(s)} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid " + (filter === s ? "#3b82f6" : "#e2e8f0"), background: filter === s ? "#3b82f6" : "#fff", color: filter === s ? "#fff" : "#374151", cursor: "pointer", fontSize: 12, fontWeight: filter === s ? 600 : 400 }}>{s}</button>
                ))}
              </div>
            </div>
            {groups.map(group => {
              const grpVal   = group.orders.reduce((s, o) => s + (parseFloat(o.total_value) || 0), 0);
              const grpCbm   = group.orders.reduce((s, o) => s + (parseFloat(o.total_cbm)  || 0), 0);
              const grpRolls = group.orders.reduce((s, o) => s + (parseInt(o.total_quantity) || 0), 0);
              return (
                <div key={group.supplier} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "linear-gradient(90deg,#1e3a5f,#2d5a8e)", borderRadius: "10px 10px 0 0" }}>
                    <span style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>🏭 {group.supplier}</span>
                    <span style={{ background: "rgba(255,255,255,0.15)", color: "#e2e8f0", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{group.orders.length} orders</span>
                    <span style={{ color: "#34d399", fontWeight: 700, fontSize: 13, marginLeft: "auto" }}>{fmtUSD(grpVal)}</span>
                    <span style={{ color: "#93c5fd", fontSize: 11 }}>{grpCbm.toFixed(2)} CBM</span>
                    <span style={{ color: "#fbbf24", fontSize: 11 }}>{grpRolls.toLocaleString()} rolls</span>
                    <button onClick={() => { setShowForm(true); setEditOrder(null); }}
                      style={{ padding: "3px 10px", background: "#3b82f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, color: "#fff", fontWeight: 600 }}>+ New</button>
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          {["PO Number","Marking","Status","Value","Total CBM","Total Rolls","BL No","ETD","ETA","Payment Due",""].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.orders.map((o, oi) => {
                          const overdue = o.payment_due_date && new Date(o.payment_due_date) < new Date();
                          const dueSoon = o.payment_due_date && !overdue && (new Date(o.payment_due_date) - new Date()) < 7 * 86400000;
                          return (
                            <tr key={o.id} onClick={() => selectOrder(o)}
                              style={{ borderBottom: oi < group.orders.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: selected?.id === o.id ? "#eff6ff" : "transparent" }}
                              onMouseEnter={e => { if (selected?.id !== o.id) e.currentTarget.style.background = "#f8fafc"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = selected?.id === o.id ? "#eff6ff" : "transparent"; }}>
                              <td style={{ padding: "8px 12px", fontWeight: 700, color: "#3b82f6" }}>{o.po_number}</td>
                              <td style={{ padding: "8px 12px", color: "#64748b", fontSize: 11 }}>{o.marking || "—"}</td>
                              <td style={{ padding: "8px 12px" }}><Badge status={o.status} /></td>
                              <td style={{ padding: "8px 12px", fontWeight: 700, color: "#059669" }}>{fmtUSD(o.total_value)}</td>
                              <td style={{ padding: "8px 12px", color: "#374151" }}>{parseFloat(o.total_cbm || 0).toFixed(2)}</td>
                              <td style={{ padding: "8px 12px", color: "#374151" }}>{(o.total_quantity || 0).toLocaleString()}</td>
                              <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: o.bl_number ? "#1d4ed8" : "#cbd5e1" }}>{o.bl_number || "—"}</td>
                              <td style={{ padding: "8px 12px", color: "#64748b", fontSize: 11 }}>{o.etd ? o.etd.split("T")[0] : "—"}</td>
                              <td style={{ padding: "8px 12px", color: "#64748b", fontSize: 11 }}>{o.eta ? o.eta.split("T")[0] : "—"}</td>
                              <td style={{ padding: "8px 12px", fontSize: 11, fontWeight: overdue || dueSoon ? 700 : 400, color: overdue ? "#dc2626" : dueSoon ? "#d97706" : "#64748b" }}>
                                {o.payment_due_date ? <>{overdue ? "⚠️ " : dueSoon ? "⏰ " : ""}{o.payment_due_date.split("T")[0]}</> : "—"}
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button onClick={e => { e.stopPropagation(); openEdit(o); }} style={{ padding: "3px 7px", background: "#f1f5f9", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>Edit</button>
                                  <button title="Print PO" onClick={e => { e.stopPropagation(); printPO(o.id); }} aria-label="Print PO" style={{ display: "inline-flex", padding: "5px 8px", background: "#eff6ff", border: "none", borderRadius: 5, cursor: "pointer", color: "#1d4ed8" }}><Ic n="printer" size={14} /></button>
                                  <button title="Duplicate" onClick={e => { e.stopPropagation(); handleDuplicate(o.id); }} style={{ padding: "3px 7px", background: "#f5f3ff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#7c3aed" }}>⧉</button>
                                  <button onClick={e => { e.stopPropagation(); handleDelete(o.id); }} style={{ padding: "3px 7px", background: "#fef2f2", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#dc2626" }}>Del</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {groups.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No orders found</div>}
            {selected && (
              <div style={{ marginTop: 16, background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}><Ic n="orders" size={15} /> {selected.po_number} — {selected.supplier}</span>
                  <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748b" }}>×</button>
                </div>
                {(selected.items || []).length > 0 && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead><tr style={{ background: "#334155" }}>
                        {["ITEM","THICKNESS","SIZE","LINER/COLOR","QTY/CTN","TOTAL CTN","TOTAL ROLL","PRICE $","TOTAL $","KG/PKG","TOTAL KG","CBM","CODE","SHIPPING MARK"].map(h =>
                          <th key={h} style={{ padding: "6px 8px", color: "#fff", fontWeight: 600, fontSize: 10, textAlign: "left", whiteSpace: "nowrap", border: "1px solid #4b5563" }}>{h}</th>
                        )}
                      </tr></thead>
                      <tbody>
                        {selected.items.map((item, ii) => {
                          const rt = (parseInt(item.total_roll) || 0) * (parseFloat(item.unit_price) || 0);
                          const rk = (parseInt(item.total_ctn) || 0) * (parseFloat(item.kg_pkg) || 0);
                          return (
                            <tr key={ii} style={{ background: ii % 2 === 0 ? "#fff" : "#f8fafc" }}>
                              <td style={{ padding: "5px 8px", fontWeight: 500 }}>{item.item_name}</td>
                              <td style={{ padding: "5px 8px" }}>{item.thickness}</td>
                              <td style={{ padding: "5px 8px" }}>{item.size}</td>
                              <td style={{ padding: "5px 8px" }}>{item.liner_color}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right" }}>{item.qty_ctn}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{item.total_ctn}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "#1d4ed8" }}>{item.total_roll}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right" }}>${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "#059669" }}>${rt.toLocaleString()}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right" }}>{item.kg_pkg}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right", color: "#64748b" }}>{rk.toLocaleString()}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right", color: "#7c3aed", fontWeight: 600 }}>{parseFloat(item.cbm || 0).toFixed(3)}</td>
                              <td style={{ padding: "5px 8px", fontSize: 10 }}>{item.code}</td>
                              <td style={{ padding: "5px 8px", fontSize: 10 }}>{item.shipping_mark}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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
            {(() => {
              const n = Object.values(checked).filter(Boolean).length;
              const pickList = () => {
                const ids = new Set(Object.entries(checked).filter(([, v]) => v).map(([k]) => Number(k)));
                const list = ids.size ? sortedOrders.filter(o => ids.has(o.id)) : sortedOrders;
                if (!list.length) { toast("No orders to print", "warn"); return null; }
                return list;
              };
              return (
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => { const l = pickList(); if (l) printOrderList(l); }}
                    title="One row per order (register)"
                    style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #1d4ed8", background: "#eff6ff", color: "#1d4ed8", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                    <Ic n="printer" size={14} /> List {n ? `(${n})` : "(All)"}
                  </button>
                  <button onClick={() => { const l = pickList(); if (l) printOrdersDetailed(l); }}
                    title="Summary + full line items & totals per order"
                    style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #1d4ed8", background: "#1d4ed8", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                    <Ic n="printer" size={14} /> Details {n ? `(${n})` : "(All)"}
                  </button>
                </div>
              );
            })()}
          </div>
          {loading ? <Spinner /> : (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: "11px 10px", borderBottom: "1px solid #e2e8f0", width: 30 }}>
                      <input type="checkbox" title="Select all"
                        checked={sortedOrders.length > 0 && sortedOrders.every(o => checked[o.id])}
                        onChange={e => { const v = e.target.checked; setChecked(v ? Object.fromEntries(sortedOrders.map(o => [o.id, true])) : {}); }} />
                    </th>
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
                        <td style={{ padding: "10px 10px" }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={!!checked[o.id]} onChange={e => setChecked(c => ({ ...c, [o.id]: e.target.checked }))} />
                        </td>
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
                            <button title="Print PO" onClick={e => { e.stopPropagation(); printPO(o.id); }} aria-label="Print PO" style={{ display: "inline-flex", padding: "5px 8px", background: "#eff6ff", border: "none", borderRadius: 5, cursor: "pointer", color: "#1d4ed8" }}><Ic n="printer" size={14} /></button>
                            <button title="Duplicate" onClick={e => { e.stopPropagation(); handleDuplicate(o.id); }} style={{ padding: "4px 8px", background: "#f5f3ff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#7c3aed" }}>⧉</button>
                            <button title="Bulk copies" onClick={e => { e.stopPropagation(); handleBulk(o.id); }} style={{ padding: "4px 8px", background: "#fffbeb", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#b45309" }}>⧉×N</button>
                            <button onClick={e => { e.stopPropagation(); handleDelete(o.id); }} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#dc2626" }}>Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {orders.length === 0 && (
                    <tr><td colSpan={11} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No orders found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {/* ── Order Detail Panel ── */}
          {selected && (
            <div style={{ marginTop: 16, background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ic n="orders" size={15} /> {selected.po_number} — {selected.supplier}
                  {selected.marking && <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 8, fontSize: 12 }}>({selected.marking})</span>}
                  {selected.shipped   && <span style={{ marginLeft: 8, fontSize: 10, background: "#eff6ff", color: "#1d4ed8", padding: "2px 7px", borderRadius: 20, fontWeight: 600, border: "1px solid #bfdbfe" }}>🚢 SHIPPED</span>}
                  {selected.delivered && <span style={{ marginLeft: 6, fontSize: 10, background: "#f0fdf4", color: "#059669", padding: "2px 7px", borderRadius: 20, fontWeight: 600, border: "1px solid #bbf7d0" }}>✅ DELIVERED</span>}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  {selected.bl_number && (
                    <a href={`https://www.track-trace.com/container?container=${selected.bl_number}`} target="_blank" rel="noreferrer"
                      style={{ padding: "5px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}>🚢 Track Live</a>
                  )}
                  <button onClick={() => printPO(selected.id)}
                    style={{ padding: "5px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, color: "#1d4ed8", cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}><Ic n="printer" size={14} /> Print PO</button>
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
                          {["ITEM","THICKNESS","SIZE","LINER/COLOR","QTY/CTN","TOTAL CTN","TOTAL ROLL","PRICE $","TOTAL $","KG/PKG","TOTAL KG","CBM","CODE","SHIPPING MARK"].map(h =>
                            <th key={h} style={{ padding: "7px 8px", color: "#fff", fontWeight: 700, fontSize: 10, textAlign: ["TOTAL CTN","TOTAL ROLL","PRICE $","TOTAL $","QTY/CTN","KG/PKG","TOTAL KG","CBM"].includes(h) ? "right" : "left", whiteSpace: "nowrap", border: "1px solid #2d4f7f" }}>{h}</th>
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
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#7c3aed", fontWeight: 600 }}>{parseFloat(item.cbm || 0).toFixed(3)}</td>
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
                          const tCbm  = selected.items.reduce((s, i) => s + (parseFloat(i.cbm) || 0), 0);
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
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#c4b5fd", fontWeight: 800, border: "1px solid #2d4f7f" }}>{tCbm.toFixed(3)}</td>
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

export { ImportOrders, DOC_CHECKLIST_ITEMS, OrderForm };
