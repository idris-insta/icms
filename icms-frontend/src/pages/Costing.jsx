import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, LineChart, Progress, Spinner, Err, KPICard, TH, TD, Ic } from "../lib/core";
// ─── COSTING PAGE ─────────────────────────────────────────────────────────────
const Costing = () => {
  const [tab, setTab]           = useState("containers");
  const [containers, setContainers] = useState([]);
  const [supCosts, setSupCosts] = useState([]);
  const [items, setItems]       = useState([]);
  const [priceList, setPriceList] = useState([]);
  const [trends, setTrends]       = useState([]);
  const [fx, setFx]               = useState(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [supFilter, setSupFilter] = useState("");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const q = supFilter ? `?supplier_id=${supFilter}` : "";
      const [c, s, it, pl, sup] = await Promise.all([
        apiFetch(`/costing/containers${q}`),
        apiFetch("/costing/suppliers"),
        apiFetch(`/costing/items${q}`),
        apiFetch(`/costing/price-list${q}`),
        apiFetch("/masters/suppliers"),
      ]);
      setContainers(c.containers || []); setSupCosts(s.suppliers || []);
      setItems(it.items || []); setPriceList(pl.price_list || []);
      setSuppliers(sup.suppliers || []);
      apiFetch("/analytics/trends").then(t => setTrends(t.trends || [])).catch(() => {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [supFilter]);
  useEffect(() => { load(); }, [load]);

  // Live USD→INR rate (server caches for 1h)
  const fetchFx = useCallback(async (notify) => {
    setFxLoading(true);
    try {
      const r = await apiFetch("/costing/fx-rate");
      setFx(r);
      if (notify) toast(`Live USD ₹ ${r.rate}`, "success");
    } catch (e) { if (notify) toast("Live rate unavailable", "error"); }
    finally { setFxLoading(false); }
  }, [toast]);
  useEffect(() => { fetchFx(false); }, [fetchFx]);

  const card  = { background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" };
  const thS   = { padding: "9px 10px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", border: "1px solid #2d4f7f" };
  const tdS   = { padding: "8px 10px", border: "1px solid #eef1f5", fontSize: 12 };
  const right = { textAlign: "right" };
  const fmt2  = (n) => (parseFloat(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmt4  = (n) => (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  const TABS = [["containers","Container-wise","orders"],["suppliers","Supplier-wise","factory"],["items","Item-wise","receipt"],["pricelist","Price List","dollar"],["trends","Trends","analytics"]];

  // Recompute landed cost (INR) for a container row from its editable inputs.
  // Landed ₹ = (goods + freight + insurance) × USD rate + duty + CHA + extra
  const recompute = (c) => {
    const goods = parseFloat(c.goods_value) || 0;
    const rate  = parseFloat(c.usd_rate) || 0;
    const frt   = parseFloat(c.freight_cost) || 0;
    const ins   = parseFloat(c.insurance_cost) || 0;
    const duty  = parseFloat(c.duty_rate) || 0;
    const cha   = parseFloat(c.cha_charges) || 0;
    const extra = parseFloat(c.extra_charges) || 0;
    const cif_usd = goods + frt + ins;
    const cif_inr = cif_usd * rate;
    const duty_inr = cif_inr * (duty / 100);
    const landed_inr = cif_inr + duty_inr + cha + extra;
    const qty = parseFloat(c.total_quantity) || 0;
    const kg  = parseFloat(c.total_weight) || 0;
    return { ...c, cif_usd, cif_inr, duty_amount_inr: duty_inr, landed_cost_inr: landed_inr,
      landed_per_roll_inr: qty > 0 ? landed_inr / qty : 0,
      landed_per_kg_inr:   kg  > 0 ? landed_inr / kg  : 0,
      cp_factor: goods > 0 ? landed_inr / goods : 0 };
  };

  const editCell = (id, field, value) => {
    setContainers(prev => prev.map(c => c.id === id ? recompute({ ...c, [field]: value }) : c));
  };
  const saveCell = async (id, field, value) => {
    try { await apiFetch(`/costing/containers/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value === "" ? 0 : value }) }); }
    catch (e) { toast(e.message, "error"); }
  };
  const editInp = { width: "100%", boxSizing: "border-box", border: "1px solid #dbe2ea", borderRadius: 4, padding: "4px 5px", fontSize: 11, textAlign: "right", outline: "none", background: "#fffdf5" };
  const liveBtn = { border: "1px solid #a5f3fc", background: "#ecfeff", color: "#0369a1", borderRadius: 4, cursor: "pointer", fontSize: 11, padding: "5px 7px", marginLeft: 4, fontWeight: 700, minHeight: 28, lineHeight: 1, flexShrink: 0 };
  // plain function (not a component) → React keeps the <input> mounted, no focus loss
  const editNum = (c, field) => (
    <input type="number" value={c[field] ?? ""} style={editInp}
      onChange={e => editCell(c.id, field, e.target.value)}
      onBlur={e => saveCell(c.id, field, e.target.value)} />
  );
  const applyFxToContainer = (id) => { if (!fx) return; editCell(id, "usd_rate", fx.rate); saveCell(id, "usd_rate", fx.rate); };

  // Supplier default rate (ex_rate) — applies to that supplier's price list and to
  // any of its orders that have no rate of their own. Reload after save to recompute.
  const editSupRate = (id, field, value) => setSupCosts(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  const saveSupRate = async (id, field, value) => {
    try { await apiFetch(`/costing/suppliers/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value === "" ? null : value }) }); load(); }
    catch (e) { toast(e.message, "error"); }
  };
  const applyFxToSupplier = (id) => { if (!fx) return; editSupRate(id, "ex_rate", fx.rate); saveSupRate(id, "ex_rate", fx.rate); };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Costing — USD Base</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>Landed ₹ = (goods + freight + insurance) × USD rate + duty + CHA + extra · yellow cells are editable · CHA/extra are per-container</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => fetchFx(true)} disabled={fxLoading} title="Fetch live USD→INR rate" aria-label="Fetch live USD to INR rate"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", background: "#ecfeff", border: "1px solid #a5f3fc", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0369a1" }}>
            <Ic n="dollar" size={14} /> {fx ? `USD ₹ ${fx.rate}` : "Live rate"} <Ic n="refresh" size={13} style={{ opacity: fxLoading ? 0.5 : 1 }} />
          </button>
          <select value={supFilter} onChange={e => setSupFilter(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, outline: "none", background: "#fff" }}>
            <option value="">All suppliers</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
          <button onClick={() => {
            const data = tab === "containers" ? containers.map(c => ({ PO: c.po_number, Supplier: c.supplier, Type: c.container_type, Status: c.status, Goods_USD: c.goods_value, USD_Rate: c.usd_rate, Freight_USD: c.freight_cost, Insurance_USD: c.insurance_cost, Duty_Pct: c.duty_rate, Duty_INR: c.duty_amount_inr, CHA_INR: c.cha_charges, Extra_INR: c.extra_charges, CIF_INR: c.cif_inr, Landed_INR: c.landed_cost_inr, Per_Roll_INR: c.landed_per_roll_inr, Per_KG_INR: c.landed_per_kg_inr, CP_Factor: c.cp_factor, FX_Impact_INR: c.fx_impact_inr }))
              : tab === "suppliers" ? supCosts.map(s => ({ Code: s.code, Supplier: s.name, Containers: s.containers, Goods_USD: s.goods_value, CIF_USD: s.cif_usd, Default_USD_Rate: s.ex_rate, Blended_Rate_DCA: s.avg_usd_rate, CIF_INR: s.cif_inr, Duty_INR: s.duty_amount_inr, CHA_INR: s.cha_charges, Extra_INR: s.extra_charges, Landed_INR: s.landed_cost_inr, Per_Roll_INR: s.landed_per_roll_inr, CP_Factor: s.cp_factor }))
              : tab === "items" ? items.map(i => ({ Item: i.item_name, Thickness: i.thickness, Size: i.size, Supplier: i.supplier, Rolls: i.total_rolls, Avg_Price_USD: i.avg_price, Min: i.min_price, Max: i.max_price, Last: i.last_price, Landed_Per_Roll_INR: i.landed_per_roll_inr }))
              : tab === "trends" ? trends
              : priceList.map(p => ({ Supplier: p.supplier, Item: p.item_name, Brand: p.brand, Thickness: p.thickness, Size: p.size, Price_USD_Roll: p.unit_price_usd, Price_USD_SQM: p.price_per_sqm, USD_Rate: p.usd_rate, Landed_INR_Per_Roll: p.landed_inr_per_roll, Landed_INR_Per_SQM: p.landed_inr_per_sqm, Last_PO: p.last_po, Date: (p.last_order_date || "").split("T")[0] }));
            exportCSV(data, `costing_${tab}.csv`); toast("Exported CSV", "success");
          }} style={{ padding: "8px 12px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}><Ic n="download" size={14} /> Export CSV</button>
        </div>
      </div>
      <Err msg={error} />
      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 18 }}>
        {TABS.map(([t, label, icon]) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? "true" : undefined}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 4px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: tab === t ? 700 : 400, background: tab === t ? "#fff" : "transparent", color: tab === t ? "#1d4ed8" : "#64748b", boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}><Ic n={icon} size={14} />{label}</button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            {tab === "containers" && (
              <table style={{ borderCollapse: "collapse", minWidth: 1500 }}>
                <thead><tr>{["PO","Supplier","Type","Goods $","USD ₹ Rate","Freight $","Insur. $","Duty %","Duty ₹","CHA ₹","Extra ₹","CIF ₹","Landed ₹","₹/Roll","₹/KG","CP ₹/$","FX Δ ₹"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {containers.map((c, i) => (
                    <tr key={c.id} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...tdS, fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>{c.po_number}</td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>{c.supplier}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{c.container_type}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(c.goods_value)}</td>
                      <td style={{ ...tdS, width: 108 }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          {editNum(c, "usd_rate")}
                          {fx && <button title={"Apply live rate " + fx.rate} aria-label={"Apply live rate " + fx.rate} style={liveBtn} onClick={() => applyFxToContainer(c.id)}>live</button>}
                        </div>
                      </td>
                      <td style={{ ...tdS, width: 80 }}>{editNum(c, "freight_cost")}</td>
                      <td style={{ ...tdS, width: 80 }}>{editNum(c, "insurance_cost")}</td>
                      <td style={{ ...tdS, width: 60 }}>{editNum(c, "duty_rate")}</td>
                      <td style={{ ...tdS, ...right, color: "#64748b" }}>₹{fmt2(c.duty_amount_inr)}</td>
                      <td style={{ ...tdS, width: 80 }}>{editNum(c, "cha_charges")}</td>
                      <td style={{ ...tdS, width: 80 }}>{editNum(c, "extra_charges")}</td>
                      <td style={{ ...tdS, ...right, color: "#64748b" }}>₹{fmt2(c.cif_inr)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>₹{fmt2(c.landed_cost_inr)}</td>
                      <td style={{ ...tdS, ...right, color: "#7c3aed", fontWeight: 600 }}>₹{fmt2(c.landed_per_roll_inr)}</td>
                      <td style={{ ...tdS, ...right }}>₹{fmt2(c.landed_per_kg_inr)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: "#b45309" }}>{fmt2(c.cp_factor)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: c.fx_impact_inr == null ? "#cbd5e1" : c.fx_impact_inr > 0 ? "#dc2626" : "#15803d" }}
                        title={c.fx_impact_inr == null ? "Needs a delivery rate and a payment with rate" : "Delivery rate " + (c.usd_rate_delivery || c.usd_rate) + " → payment rate " + c.usd_rate_payment}>
                        {c.fx_impact_inr == null ? "—" : (c.fx_impact_inr > 0 ? "+" : "") + "₹" + fmt2(c.fx_impact_inr)}
                      </td>
                    </tr>
                  ))}
                  {containers.length === 0 && <tr><td colSpan={17} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No containers found</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "suppliers" && (
              <table style={{ borderCollapse: "collapse", minWidth: 1400 }}>
                <thead><tr>{["Code","Supplier","Containers","Goods $","CIF $","Default USD ₹","Blended ₹ (DCA)","CIF ₹","Duty ₹","CHA ₹ (tot)","Extra ₹ (tot)","Landed ₹","₹/Roll","₹/KG","CP ₹/$"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {supCosts.map((s, i) => (
                    <tr key={s.id} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...tdS, fontWeight: 700, color: "#1d4ed8" }}>{s.code}</td>
                      <td style={{ ...tdS, fontWeight: 600, whiteSpace: "nowrap" }}>{s.name}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{s.containers}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(s.goods_value)}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(s.cif_usd)}</td>
                      <td style={{ ...tdS, width: 110 }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <input type="number" value={s.ex_rate ?? ""} style={editInp}
                            onChange={e => editSupRate(s.id, "ex_rate", e.target.value)}
                            onBlur={e => saveSupRate(s.id, "ex_rate", e.target.value)} />
                          {fx && <button title={"Apply live rate " + fx.rate} aria-label={"Apply live rate " + fx.rate} style={liveBtn} onClick={() => applyFxToSupplier(s.id)}>live</button>}
                        </div>
                      </td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: "#0369a1", background: "#f0f9ff" }}>{fmt4(s.avg_usd_rate)}</td>
                      <td style={{ ...tdS, ...right, color: "#64748b" }}>₹{fmt2(s.cif_inr)}</td>
                      <td style={{ ...tdS, ...right, color: "#64748b" }}>₹{fmt2(s.duty_amount_inr)}</td>
                      <td style={{ ...tdS, ...right }}>₹{fmt2(s.cha_charges)}</td>
                      <td style={{ ...tdS, ...right }}>₹{fmt2(s.extra_charges)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>₹{fmt2(s.landed_cost_inr)}</td>
                      <td style={{ ...tdS, ...right, color: "#7c3aed", fontWeight: 600 }}>₹{fmt2(s.landed_per_roll_inr)}</td>
                      <td style={{ ...tdS, ...right }}>₹{fmt2(s.landed_per_kg_inr)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#b45309", background: "#fffbeb" }}>{fmt2(s.cp_factor)}</td>
                    </tr>
                  ))}
                  {supCosts.length === 0 && <tr><td colSpan={15} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No suppliers found</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "items" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Item","Thickness","Size","Supplier","Orders","Rolls","Avg $","Min $","Max $","Last $","Landed ₹/Roll","Last Order"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...tdS, fontWeight: 600 }}>{it.item_name}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{it.thickness || "—"}</td>
                      <td style={tdS}>{it.size || "—"}</td>
                      <td style={{ ...tdS, fontSize: 11, color: "#64748b" }}>{it.supplier}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{it.orders}</td>
                      <td style={{ ...tdS, ...right }}>{(it.total_rolls || 0).toLocaleString()}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700 }}>{fmt4(it.avg_price)}</td>
                      <td style={{ ...tdS, ...right, color: "#059669" }}>{fmt4(it.min_price)}</td>
                      <td style={{ ...tdS, ...right, color: "#dc2626" }}>{fmt4(it.max_price)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: "#1d4ed8" }}>{fmt4(it.last_price)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>₹{fmt2(it.landed_per_roll_inr)}</td>
                      <td style={{ ...tdS, fontSize: 11, color: "#64748b" }}>{(it.last_order_date || "").split("T")[0]}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No item data — add line items to orders to build item-wise costing</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "pricelist" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Supplier","Item","Brand","Thickness","Size","Code","Price $/Roll","Price $/SQM","USD ₹ (order)","Landed ₹/Roll","Landed ₹/SQM","Last PO","Date"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {priceList.map((p, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...tdS, fontWeight: 600, color: "#1d4ed8" }}>{p.supplier_code}</td>
                      <td style={{ ...tdS, fontWeight: 600 }}>{p.item_name}</td>
                      <td style={tdS}>{p.brand || "—"}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{p.thickness || "—"}</td>
                      <td style={tdS}>{p.size || "—"}</td>
                      <td style={{ ...tdS, fontSize: 10, color: "#64748b" }}>{p.code || "—"}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>{fmt4(p.unit_price_usd)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: "#0369a1" }}>{p.price_per_sqm > 0 ? fmt4(p.price_per_sqm) : "—"}</td>
                      <td style={{ ...tdS, ...right, color: "#64748b" }}>{fmt4(p.usd_rate)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: "#7c3aed" }}>₹{fmt2(p.landed_inr_per_roll)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: "#7c3aed" }}>{p.landed_inr_per_sqm > 0 ? "₹" + fmt2(p.landed_inr_per_sqm) : "—"}</td>
                      <td style={{ ...tdS, fontWeight: 600, color: "#1d4ed8", fontSize: 11 }}>{p.last_po}</td>
                      <td style={{ ...tdS, fontSize: 11, color: "#64748b" }}>{(p.last_order_date || "").split("T")[0]}</td>
                    </tr>
                  ))}
                  {priceList.length === 0 && <tr><td colSpan={13} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No price data — add priced line items to orders</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "trends" && (
              <div style={{ padding: 18 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Average freight ($) by month</div>
                    <LineChart data={trends.map(t => ({ label: t.month.slice(2), value: t.avg_freight }))} color="#ea580c" fmt={v => "$" + fmt2(v)} />
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Average USD ₹ rate by month</div>
                    <LineChart data={trends.map(t => ({ label: t.month.slice(2), value: t.avg_usd_rate }))} color="#0369a1" fmt={v => "₹" + fmt2(v)} />
                  </div>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 18 }}>
                  <thead><tr>{["Month","Orders","Avg Freight $","Total Freight $","Freight $/CBM","Avg USD ₹"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                  <tbody>
                    {trends.map((t, i) => (
                      <tr key={t.month} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                        <td style={{ ...tdS, fontWeight: 600 }}>{t.month}</td>
                        <td style={{ ...tdS, textAlign: "center" }}>{t.orders}</td>
                        <td style={{ ...tdS, ...right }}>{fmt2(t.avg_freight)}</td>
                        <td style={{ ...tdS, ...right }}>{fmt2(t.total_freight)}</td>
                        <td style={{ ...tdS, ...right }}>{t.freight_per_cbm != null ? fmt2(t.freight_per_cbm) : "—"}</td>
                        <td style={{ ...tdS, ...right, fontWeight: 700, color: "#0369a1" }}>{fmt4(t.avg_usd_rate)}</td>
                      </tr>
                    ))}
                    {trends.length === 0 && <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No trend data yet — add orders with freight and USD rate</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export { Costing };
