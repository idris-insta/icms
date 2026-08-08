import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
// ─── COSTING PAGE ─────────────────────────────────────────────────────────────
const Costing = () => {
  const [tab, setTab]           = useState("containers");
  const [containers, setContainers] = useState([]);
  const [supCosts, setSupCosts] = useState([]);
  const [items, setItems]       = useState([]);
  const [priceList, setPriceList] = useState([]);
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
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [supFilter]);
  useEffect(() => { load(); }, [load]);

  const card  = { background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" };
  const thS   = { padding: "9px 10px", background: "#1e3a5f", color: "#fff", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", border: "1px solid #2d4f7f" };
  const tdS   = { padding: "8px 10px", border: "1px solid #eef1f5", fontSize: 12 };
  const right = { textAlign: "right" };
  const fmt2  = (n) => (parseFloat(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmt4  = (n) => (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  const TABS = [["containers","📦 Container-wise"],["suppliers","🏭 Supplier-wise"],["items","🧾 Item-wise"],["pricelist","💲 Price List"]];

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
  // plain function (not a component) → React keeps the <input> mounted, no focus loss
  const editNum = (c, field) => (
    <input type="number" value={c[field] ?? ""} style={editInp}
      onChange={e => editCell(c.id, field, e.target.value)}
      onBlur={e => saveCell(c.id, field, e.target.value)} />
  );

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Costing — USD Base</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>Landed ₹ = (goods + freight + insurance) × USD rate + duty + CHA + extra · yellow cells are editable</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={supFilter} onChange={e => setSupFilter(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, outline: "none", background: "#fff" }}>
            <option value="">All suppliers</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
          <button onClick={() => {
            const data = tab === "containers" ? containers.map(c => ({ PO: c.po_number, Supplier: c.supplier, Type: c.container_type, Status: c.status, Goods_USD: c.goods_value, USD_Rate: c.usd_rate, Freight_USD: c.freight_cost, Insurance_USD: c.insurance_cost, Duty_Pct: c.duty_rate, Duty_INR: c.duty_amount_inr, CHA_INR: c.cha_charges, Extra_INR: c.extra_charges, CIF_INR: c.cif_inr, Landed_INR: c.landed_cost_inr, Per_Roll_INR: c.landed_per_roll_inr, Per_KG_INR: c.landed_per_kg_inr, CP_Factor: c.cp_factor }))
              : tab === "suppliers" ? supCosts.map(s => ({ Code: s.code, Supplier: s.name, Containers: s.containers, Goods_USD: s.goods_value, Freight_USD: s.freight_cost, Duty_USD: s.duty_amount, Landed_USD: s.landed_cost_usd, Avg_Per_Container_USD: s.avg_landed_per_container, Per_Roll_USD: s.cost_per_roll_usd, CP_INR: s.cp_inr }))
              : tab === "items" ? items.map(i => ({ Item: i.item_name, Thickness: i.thickness, Size: i.size, Supplier: i.supplier, Rolls: i.total_rolls, Avg_Price_USD: i.avg_price, Min: i.min_price, Max: i.max_price, Last: i.last_price, Landed_Per_Roll_USD: i.landed_per_roll_usd }))
              : priceList.map(p => ({ Supplier: p.supplier, Item: p.item_name, Thickness: p.thickness, Size: p.size, Price_USD: p.unit_price_usd, Landed_INR_Per_Roll: p.landed_inr_per_roll, Last_PO: p.last_po, Date: (p.last_order_date || "").split("T")[0] }));
            exportCSV(data, `costing_${tab}.csv`); toast("Exported CSV", "success");
          }} style={{ padding: "8px 12px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>📥 Export CSV</button>
        </div>
      </div>
      <Err msg={error} />
      <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 4, marginBottom: 18 }}>
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: "9px 4px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: tab === t ? 700 : 400, background: tab === t ? "#fff" : "transparent", color: tab === t ? "#1d4ed8" : "#64748b", boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>{label}</button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            {tab === "containers" && (
              <table style={{ borderCollapse: "collapse", minWidth: 1500 }}>
                <thead><tr>{["PO","Supplier","Type","Goods $","USD ₹ Rate","Freight $","Insur. $","Duty %","Duty ₹","CHA ₹","Extra ₹","CIF ₹","Landed ₹","₹/Roll","₹/KG","CP ₹/$"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {containers.map((c, i) => (
                    <tr key={c.id} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...tdS, fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>{c.po_number}</td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>{c.supplier}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{c.container_type}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(c.goods_value)}</td>
                      <td style={{ ...tdS, width: 78 }}>{editNum(c, "usd_rate")}</td>
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
                    </tr>
                  ))}
                  {containers.length === 0 && <tr><td colSpan={16} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No containers found</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "suppliers" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Code","Supplier","Containers","Goods $","Freight $","Insur. $","Duty $","Landed $","Avg $/Container","$/Roll","$/KG","CP ₹/$"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {supCosts.map((s, i) => (
                    <tr key={s.id} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...tdS, fontWeight: 700, color: "#1d4ed8" }}>{s.code}</td>
                      <td style={{ ...tdS, fontWeight: 600 }}>{s.name}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{s.containers}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(s.goods_value)}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(s.freight_cost)}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(s.insurance_cost)}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(s.duty_amount)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>{fmt2(s.landed_cost_usd)}</td>
                      <td style={{ ...tdS, ...right }}>{fmt2(s.avg_landed_per_container)}</td>
                      <td style={{ ...tdS, ...right }}>{fmt4(s.cost_per_roll_usd)}</td>
                      <td style={{ ...tdS, ...right }}>{fmt4(s.cost_per_kg_usd)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#b45309", background: "#fffbeb" }}>₹{fmt2(s.cp_inr)}</td>
                    </tr>
                  ))}
                  {supCosts.length === 0 && <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No suppliers found</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "items" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Item","Thickness","Size","Supplier","Orders","Rolls","Avg $","Min $","Max $","Last $","Landed $/Roll","Last Order"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
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
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>{fmt4(it.landed_per_roll_usd)}</td>
                      <td style={{ ...tdS, fontSize: 11, color: "#64748b" }}>{(it.last_order_date || "").split("T")[0]}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No item data — add line items to orders to build item-wise costing</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "pricelist" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Supplier","Item","Thickness","Size","Liner","Code","Price $ (latest)","Landed ₹/Roll","Last PO","Date"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {priceList.map((p, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      <td style={{ ...tdS, fontWeight: 600, color: "#1d4ed8" }}>{p.supplier_code}</td>
                      <td style={{ ...tdS, fontWeight: 600 }}>{p.item_name}</td>
                      <td style={{ ...tdS, textAlign: "center" }}>{p.thickness || "—"}</td>
                      <td style={tdS}>{p.size || "—"}</td>
                      <td style={tdS}>{p.liner_color || "—"}</td>
                      <td style={{ ...tdS, fontSize: 10, color: "#64748b" }}>{p.code || "—"}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 800, color: "#15803d", background: "#f0fdf4" }}>{fmt4(p.unit_price_usd)}</td>
                      <td style={{ ...tdS, ...right, fontWeight: 700, color: "#7c3aed" }}>₹{fmt2(p.landed_inr_per_roll)}</td>
                      <td style={{ ...tdS, fontWeight: 600, color: "#1d4ed8", fontSize: 11 }}>{p.last_po}</td>
                      <td style={{ ...tdS, fontSize: 11, color: "#64748b" }}>{(p.last_order_date || "").split("T")[0]}</td>
                    </tr>
                  ))}
                  {priceList.length === 0 && <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No price data — add priced line items to orders</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export { Costing };
