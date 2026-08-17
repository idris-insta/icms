#!/usr/bin/env node
/**
 * Build the .xlsx fixtures used by import_test.py.
 *   node make_fixtures.js <supplier_code> <out_dir>
 */
const XLSX = require('./icms-backend/node_modules/xlsx');
const fs = require('fs');
const path = require('path');

const supplierCode = process.argv[2] || 'ISLB';
const outDir = process.argv[3] || '/tmp/icms-fixtures';
// Unique per run so re-running does not collide with previously imported POs.
const TAG = process.argv[4] || String(Date.now()).slice(-6);
fs.mkdirSync(outDir, { recursive: true });

// The master-data importers read CSV (their templates are text/csv), while the
// order importer reads .xlsx. Emit whichever the endpoint expects.
const writeCsv = (name, header, lines) => {
  const p = path.join(outDir, name);
  fs.writeFileSync(p, header + '\n' + lines.join('\n') + '\n');
  console.log('wrote', p, `(${lines.length} rows)`);
};

const write = (name, rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  const p = path.join(outDir, name);
  XLSX.writeFile(wb, p);
  console.log('wrote', p, `(${rows.length} rows)`);
};

// Historical orders: two POs, one with two line items, dates as real Date
// objects so the serial-number handling is exercised.
write('orders.xlsx', [
  {
    po_number: 'XLS-IMP-' + TAG + '-1', supplier_code: supplierCode, container_type: '40HC',
    status: 'Delivered', marking: 'XLSTEST/001',
    etd: new Date('2026-01-10'), eta: new Date('2026-02-14'),
    item_name: 'IMPORTED TAPE A', brand: 'ACME', thickness: '55 MIC',
    size: '480MM X 100M', liner_color: 'CLEAR',
    qty_ctn: 6, total_ctn: 120, total_roll: 720, unit_price: 2.45,
    price_per_sqm: 0.071, kg_pkg: 4.2, code: 'IMP-A-001',
    shipping_mark: 'ACME TAPE', item_notes: 'imported from excel',
  },
  {
    po_number: 'XLS-IMP-' + TAG + '-1', supplier_code: supplierCode,
    item_name: 'IMPORTED TAPE B', brand: 'ACME', thickness: '80 MIC',
    size: '1000MM X 500M', liner_color: 'WHITE',
    qty_ctn: 4, total_ctn: 40, total_roll: 160, unit_price: 8.10,
    price_per_sqm: 0.052, kg_pkg: 6.8, code: 'IMP-B-002',
    shipping_mark: 'ACME LINER', item_notes: '',
  },
  {
    po_number: 'XLS-IMP-' + TAG + '-2', supplier_code: supplierCode, container_type: '20FT',
    status: 'Delivered', marking: 'XLSTEST/002',
    etd: new Date('2026-03-01'), eta: new Date('2026-04-05'),
    item_name: 'IMPORTED FILM C', brand: 'BETA', thickness: '44 MIC',
    size: '1200MM X 300M', liner_color: 'BLACK',
    qty_ctn: 10, total_ctn: 200, total_roll: 400, unit_price: 3.75,
    price_per_sqm: 0.064, kg_pkg: 3.8, code: 'IMP-C-003',
    shipping_mark: 'BETA FILM', item_notes: 'second PO',
  },
]);

writeCsv('skus.csv',
  'sku_code,description,hsn_code,category,thickness,size,color,liner_color,roll_weight,item_code,shipping_marks,weight_per_unit,cbm_per_unit',
  [
    'CSV-SKU-001,Imported Tape,39190090,Adhesive,55 MIC,480MM X 100M,CLEAR,CLEAR,4.2,CSV-SKU-001-A,CLEAR TAPE ROLLS,0.48,0.0012',
    'CSV-SKU-002,Imported Liner,39201099,Liner,80 MIC,1000MM X 500M,WHITE,WHITE,6.8,CSV-SKU-002-B,WHITE LINER ROLLS,0.62,0.0018',
  ]);

writeCsv('suppliers.csv',
  'code,name,port,city,country,base_currency,contact_email,contact_phone,payment_terms_days',
  ['CSV-SUP-01,Imported Supplier Ltd,NINGBO,Ningbo,China,USD,contact@example.com,+86-21-000000,45']);

writeCsv('ports.csv', 'code,name,country,port_type',
  ['CSVPORT,Imported Test Port,China,origin']);
