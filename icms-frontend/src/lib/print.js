import { apiFetch } from "./core";
// ─── PO PRINT ─────────────────────────────────────────────────────────────────
const printPO = async (orderId) => {
  let o;
  try { o = await apiFetch(`/orders/${orderId}`); } catch { return; }
  let company = "ICMS";
  try {
    const st = await apiFetch("/settings");
    company = st.settings?.company_name || st.company_name || company;
  } catch {}
  const fd = (d) => d ? d.split("T")[0] : "—";
  const items = o.items || [];
  const tCtn  = items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0), 0);
  const tRoll = items.reduce((s, i) => s + (parseInt(i.total_roll) || 0), 0);
  const tVal  = items.reduce((s, i) => s + (parseInt(i.total_roll) || 0) * (parseFloat(i.unit_price) || 0), 0);
  const tKg   = items.reduce((s, i) => s + (parseInt(i.total_ctn)  || 0) * (parseFloat(i.kg_pkg)    || 0), 0);
  const tCbm  = items.reduce((s, i) => s + (parseFloat(i.cbm) || 0), 0);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const rows = items.map((it, i) => `
    <tr>
      <td>${i + 1}</td><td class="l">${esc(it.item_name)}</td><td class="l">${esc(it.brand)}</td><td>${esc(it.thickness)}</td>
      <td>${esc(it.size)}</td><td>${esc(it.liner_color)}</td><td class="r">${it.qty_ctn || ""}</td>
      <td class="r">${it.total_ctn || 0}</td><td class="r">${it.total_roll || 0}</td>
      <td class="r">${parseFloat(it.unit_price || 0).toFixed(2)}</td>
      <td class="r">${((parseInt(it.total_roll) || 0) * (parseFloat(it.unit_price) || 0)).toFixed(2)}</td>
      <td class="r">${it.kg_pkg || ""}</td><td class="r">${parseFloat(it.cbm || 0).toFixed(3)}</td>
      <td class="l">${esc(it.code)}</td><td class="l">${esc(it.marking)}</td><td class="l">${esc(it.shipping_mark)}</td><td class="l">${esc(it.notes)}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html><html><head><title>${esc(o.po_number)} — Purchase Order</title><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:28px}
    h1{font-size:20px;margin:0}.muted{color:#555}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:14px}
    .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 18px;margin-bottom:14px}
    .meta div b{display:block;font-size:9px;text-transform:uppercase;color:#666;letter-spacing:.04em}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th{background:#1e3a5f;color:#fff;padding:5px 6px;border:1px solid #2d4f7f;font-size:9px;text-transform:uppercase}
    td{padding:4px 6px;border:1px solid #cbd5e1}.r{text-align:right}.l{text-align:left}td{text-align:center}
    tfoot td{font-weight:bold;background:#eef2f7}
    .sign{display:flex;justify-content:space-between;margin-top:48px}
    .sign div{width:200px;border-top:1px solid #333;padding-top:5px;text-align:center;font-size:10px}
    @media print{body{margin:8mm}}
  </style></head><body>
    <div class="head">
      <div><h1>${esc(company)}</h1><div class="muted">PURCHASE ORDER</div></div>
      <div style="text-align:right"><h1>${esc(o.po_number)}</h1>
        <div class="muted">Date: ${fd(o.created_at)}</div>
      </div>
    </div>
    <div class="meta">
      <div><b>Supplier</b>${esc(o.supplier)} (${esc(o.supplier_code)})</div>
      <div><b>Container</b>${esc(o.container_type)}</div>
      <div><b>Currency</b>${esc(o.currency)}</div>
      <div><b>Status</b>${esc(o.status)}</div>
      <div><b>Marking</b>${esc(o.marking) || "—"}</div>
      <div><b>ETD</b>${fd(o.etd)}</div>
      <div><b>ETA</b>${fd(o.eta)}</div>
      <div><b>BL Number</b>${esc(o.bl_number) || "—"}</div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Item</th><th>Brand</th><th>Thickness</th><th>Size</th><th>Liner</th><th>Qty/Ctn</th><th>Total Ctn</th><th>Total Roll</th><th>Price $</th><th>Total $</th><th>KG/Pkg</th><th>CBM</th><th>Code</th><th>Marking</th><th>Shipping Mark</th><th>Notes</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="17">No line items</td></tr>`}</tbody>
      <tfoot><tr><td colspan="7" class="l">TOTALS</td><td class="r">${tCtn.toLocaleString()}</td><td class="r">${tRoll.toLocaleString()}</td><td></td><td class="r">$${tVal.toLocaleString(undefined,{maximumFractionDigits:2})}</td><td class="r">${tKg.toLocaleString()} kg</td><td class="r">${tCbm.toFixed(3)}</td><td colspan="4"></td></tr></tfoot>
    </table>
    ${o.notes ? `<p><b>Notes:</b> ${esc(o.notes)}</p>` : ""}
    <div class="sign"><div>Prepared by</div><div>Approved by</div><div>Supplier confirmation</div></div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=1000,height=750");
  if (!w) return;
  w.document.write(html);
  w.document.close();
};

// Print a register/list of multiple orders (one row per order, sorted by PO number).
// `orders` are the summary rows already loaded in the list view.
const printOrderList = async (orders) => {
  if (!orders || !orders.length) return;
  let company = "ICMS";
  try { const st = await apiFetch("/settings"); company = st.settings?.company_name || st.company_name || company; } catch {}
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const fd = (d) => d ? String(d).split("T")[0] : "—";
  const sorted = [...orders].sort((a, b) => String(a.po_number).localeCompare(String(b.po_number)));
  const num = (v) => parseFloat(v) || 0;
  const tVal = sorted.reduce((s, o) => s + num(o.total_value), 0);
  const tCbm = sorted.reduce((s, o) => s + num(o.total_cbm), 0);
  const tRoll = sorted.reduce((s, o) => s + (parseInt(o.total_quantity) || 0), 0);
  const rows = sorted.map((o, i) => `
    <tr>
      <td>${i + 1}</td><td class="l b">${esc(o.po_number)}</td><td class="l">${esc(o.supplier)}</td>
      <td>${esc(o.marking) || "—"}</td><td>${esc(o.status)}</td><td>${esc(o.container_type)}</td>
      <td>${fd(o.etd)}</td><td>${fd(o.eta)}</td><td class="l">${esc(o.bl_number) || "—"}</td>
      <td>${fd(o.payment_due_date)}</td>
      <td class="r">${num(o.total_cbm).toFixed(2)}</td><td class="r">${(parseInt(o.total_quantity)||0).toLocaleString()}</td>
      <td class="r">$${num(o.total_value).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html><html><head><title>Order List</title><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:24px}
    h1{font-size:18px;margin:0}.muted{color:#555;font-size:11px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th{background:#1e3a5f;color:#fff;padding:5px 6px;border:1px solid #2d4f7f;font-size:9px;text-transform:uppercase}
    td{padding:4px 6px;border:1px solid #cbd5e1;text-align:center}.r{text-align:right}.l{text-align:left}.b{font-weight:bold}
    tfoot td{font-weight:bold;background:#eef2f7}
    @media print{body{margin:8mm}}
  </style></head><body>
    <div class="head">
      <div><h1>${esc(company)}</h1><div class="muted">ORDER LIST — ${sorted.length} orders</div></div>
      <div style="text-align:right" class="muted">Printed: ${new Date().toISOString().split("T")[0]}</div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Order No</th><th>Supplier</th><th>Marking</th><th>Status</th><th>Container</th><th>ETD</th><th>ETA</th><th>BL No</th><th>Payment Due</th><th>CBM</th><th>Rolls</th><th>Value</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="10" class="l">TOTALS — ${sorted.length} orders</td><td class="r">${tCbm.toFixed(2)}</td><td class="r">${tRoll.toLocaleString()}</td><td class="r">$${tVal.toLocaleString(undefined,{maximumFractionDigits:0})}</td></tr></tfoot>
    </table>
    <script>window.onload=()=>window.print()</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.write(html); w.document.close();
};

// Detailed bulk print: a summary register + each order's full line items with
// totals, one order per page. `orders` are the summary rows from the list view.
const printOrdersDetailed = async (orders) => {
  if (!orders || !orders.length) return;
  let company = "ICMS";
  try { const st = await apiFetch("/settings"); company = st.settings?.company_name || st.company_name || company; } catch {}
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const fd = (d) => d ? String(d).split("T")[0] : "—";
  const num = (v) => parseFloat(v) || 0;

  // Fetch full order (with items) for each selected order, in PO-number order
  const sorted = [...orders].sort((a, b) => String(a.po_number).localeCompare(String(b.po_number)));
  const full = [];
  for (const row of sorted) {
    try { full.push(await apiFetch(`/orders/${row.id}`)); } catch { full.push(row); }
  }

  // Grand totals across all orders
  let gVal = 0, gCbm = 0, gRoll = 0;
  const summaryRows = full.map((o, i) => {
    gVal += num(o.total_value); gCbm += num(o.total_cbm); gRoll += parseInt(o.total_quantity) || 0;
    return `<tr><td>${i + 1}</td><td class="l b">${esc(o.po_number)}</td><td class="l">${esc(o.supplier)}</td>
      <td>${esc(o.status)}</td><td>${fd(o.etd)}</td><td>${fd(o.eta)}</td>
      <td class="r">${num(o.total_cbm).toFixed(2)}</td><td class="r">${(parseInt(o.total_quantity)||0).toLocaleString()}</td>
      <td class="r">$${num(o.total_value).toLocaleString(undefined,{maximumFractionDigits:0})}</td></tr>`;
  }).join("");

  const blocks = full.map(o => {
    const items = o.items || [];
    const tCtn  = items.reduce((s, it) => s + (parseInt(it.total_ctn)  || 0), 0);
    const tRoll = items.reduce((s, it) => s + (parseInt(it.total_roll) || 0), 0);
    const tVal  = items.reduce((s, it) => s + (parseInt(it.total_roll) || 0) * (parseFloat(it.unit_price) || 0), 0);
    const tKg   = items.reduce((s, it) => s + (parseInt(it.total_ctn)  || 0) * (parseFloat(it.kg_pkg)    || 0), 0);
    const tCbm  = items.reduce((s, it) => s + (parseFloat(it.cbm) || 0), 0);
    const rows = items.map((it, i) => `<tr>
        <td>${i + 1}</td><td class="l">${esc(it.item_name)}</td><td class="l">${esc(it.brand)}</td><td>${esc(it.thickness)}</td>
        <td>${esc(it.size)}</td><td>${esc(it.liner_color)}</td><td class="r">${it.qty_ctn || ""}</td>
        <td class="r">${it.total_ctn || 0}</td><td class="r">${it.total_roll || 0}</td>
        <td class="r">${parseFloat(it.unit_price || 0).toFixed(2)}</td>
        <td class="r">${((parseInt(it.total_roll)||0)*(parseFloat(it.unit_price)||0)).toFixed(2)}</td>
        <td class="r">${it.kg_pkg || ""}</td><td class="r">${parseFloat(it.cbm || 0).toFixed(3)}</td>
        <td class="l">${esc(it.code)}</td><td class="l">${esc(it.marking)}</td><td class="l">${esc(it.shipping_mark)}</td><td class="l">${esc(it.notes)}</td>
      </tr>`).join("");
    return `<div class="po">
      <div class="pohead"><span class="b">${esc(o.po_number)}</span> — ${esc(o.supplier)} (${esc(o.supplier_code)})
        &nbsp;·&nbsp; ${esc(o.container_type)} ·  ${esc(o.currency)} · ${esc(o.status)}
        &nbsp;·&nbsp; ETD ${fd(o.etd)} · ETA ${fd(o.eta)} · BL ${esc(o.bl_number) || "—"}</div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th>Brand</th><th>Thick</th><th>Size</th><th>Liner</th><th>Qty/Ctn</th><th>Tot Ctn</th><th>Tot Roll</th><th>Price $</th><th>Total $</th><th>KG/Pkg</th><th>CBM</th><th>Code</th><th>Marking</th><th>Ship Mark</th><th>Notes</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="17">No line items</td></tr>`}</tbody>
        <tfoot><tr><td colspan="7" class="l">TOTALS</td><td class="r">${tCtn.toLocaleString()}</td><td class="r">${tRoll.toLocaleString()}</td><td></td><td class="r">$${tVal.toLocaleString(undefined,{maximumFractionDigits:2})}</td><td class="r">${tKg.toLocaleString()} kg</td><td class="r">${tCbm.toFixed(3)}</td><td colspan="4"></td></tr></tfoot>
      </table>
    </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Orders — Detailed</title><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:22px}
    h1{font-size:18px;margin:0}.muted{color:#555;font-size:11px}.b{font-weight:bold}
    .head{display:flex;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:9.5px;margin-bottom:6px}
    th{background:#1e3a5f;color:#fff;padding:4px 5px;border:1px solid #2d4f7f;font-size:8.5px;text-transform:uppercase}
    td{padding:3px 5px;border:1px solid #cbd5e1;text-align:center}.r{text-align:right}.l{text-align:left}
    tfoot td{font-weight:bold;background:#eef2f7}
    .po{margin-bottom:16px}.pohead{background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 9px;font-size:11px;margin-bottom:0}
    .po{page-break-inside:avoid}.po+.po{page-break-before:always}
    .summary{page-break-after:always}
    @media print{body{margin:8mm}}
  </style></head><body>
    <div class="head"><div><h1>${esc(company)}</h1><div class="muted">ORDER SUMMARY + DETAILS — ${full.length} orders</div></div>
      <div class="muted" style="text-align:right">Printed: ${new Date().toISOString().split("T")[0]}</div></div>
    <div class="summary"><table>
      <thead><tr><th>#</th><th>Order No</th><th>Supplier</th><th>Status</th><th>ETD</th><th>ETA</th><th>CBM</th><th>Rolls</th><th>Value</th></tr></thead>
      <tbody>${summaryRows}</tbody>
      <tfoot><tr><td colspan="6" class="l">GRAND TOTAL — ${full.length} orders</td><td class="r">${gCbm.toFixed(2)}</td><td class="r">${gRoll.toLocaleString()}</td><td class="r">$${gVal.toLocaleString(undefined,{maximumFractionDigits:0})}</td></tr></tfoot>
    </table></div>
    ${blocks}
    <script>window.onload=()=>window.print()</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.write(html); w.document.close();
};

export { printPO, printOrderList, printOrdersDetailed };
