'use strict';
const { escapeXml } = require('./barcode');
const e=escapeXml;

// Receipts: one printed layout chosen in Settings → Receipt. The template class
// and the paper width travel into the print stylesheet, so the preview in the
// app and the PDF that leaves the printer share the same structure.
const money=value=>Number(value||0).toFixed(2);
const RECEIPT_CSS=`
  @page{margin:0}
  body{margin:0;padding:0;background:#fff;color:#152536;font-family:'Segoe UI',Arial,sans-serif}
  .receipt{box-sizing:border-box;margin:0 auto;padding:4mm 3mm;font-size:10px;line-height:1.45}
  .p-58mm{width:58mm}.p-80mm{width:80mm}.p-A4{width:210mm;padding:12mm}
  .receipt+.receipt{break-before:page;page-break-before:always}
  .rhead{text-align:center;margin-bottom:3mm}
  .rhead strong{display:block;font-size:14px;letter-spacing:.2px}
  .rhead small{display:block;font-size:9px;color:#627080}
  .rmeta{display:flex;justify-content:space-between;gap:6px;font-size:9px;margin-bottom:2mm}
  .rmeta b{font-weight:600;text-align:right}
  .rline{display:flex;justify-content:space-between;gap:6px;padding:1.6mm 0}
  .rname small{display:block;font-size:8px;color:#627080}
  .rsum{white-space:nowrap;text-align:right}
  .rtotals{margin-top:2mm}
  .rtotals div{display:flex;justify-content:space-between;gap:6px;padding:.8mm 0}
  .rgrand{font-weight:700;font-size:11px}
  .rfoot{text-align:center;color:#627080;font-size:9px;margin-top:3mm}
  .t-classic .rmeta,.t-classic .ritems,.t-classic .rtotals{border-top:1px dashed #7d8a96}
  .t-classic .rtotals{border-bottom:1px dashed #7d8a96;padding-bottom:1mm;margin-bottom:1mm}
  .t-classic .rline{border-bottom:1px dashed #cfd8e0}
  .t-classic .rhead-row{border-bottom:1px dashed #7d8a96;font-weight:600}
  .t-compact{font-size:9.5px;line-height:1.25}
  .t-compact .rline{padding:.7mm 0}
  .t-compact .rhead{margin-bottom:1.5mm}
  .t-compact .rtotals div{padding:.4mm 0}
  .t-boxed .rmeta,.t-boxed .ritems,.t-boxed .rtotals{border:1px solid #98a6b3;border-radius:2mm;padding:1.6mm 2mm;margin-bottom:2mm}
  .t-boxed .rhead{border:1px solid #98a6b3;border-radius:2mm;padding:2mm}
  .t-boxed .rgrand{border-top:1px solid #98a6b3;margin-top:1mm;padding-top:1mm}
`;
function receiptHTML(data,preferences){
    const template=['classic','compact','boxed'].includes(preferences.receipt_template)?preferences.receipt_template:'classic';
  const paper=['80mm','58mm','A4'].includes(preferences.receipt_paper)?preferences.receipt_paper:'80mm';
  const copies=Math.min(5,Math.max(1,Number(preferences.receipt_copies)||1));
  const items=Array.isArray(data.items)?data.items:[];
  const rows=items.map(item=>{
    const qty=Number(item.quantity||0),price=Number(item.price||0),line=Number(item.total??qty*price)||0;
    return `<div class="rline"><div class="rname">${e(item.name||'')}${item.batch_no?` <span class="rbatch">${e(item.batch_no)}</span>`:''}<small>${qty} × ${money(price)}</small></div><div class="rsum">${money(line)}</div></div>`;
  }).join('');
  const block=`
  <section class="receipt t-${template} p-${paper}">
    <header class="rhead"><strong>${e(preferences.pharmacy_name||data.pharmacyName||'Pharmacy Management')}</strong>
      ${preferences.address?`<small>${e(preferences.address)}</small>`:''}
      ${preferences.phone?`<small>${e(preferences.phone)}</small>`:''}
    </header>
    <div class="rmeta"><span>Invoice</span><b>${e(data.invoice_no||'')}</b><span>Date</span><b>${e((data.created_at||data.date||'').slice(0,16).replace('T',' '))}</b><span>Cashier</span><b>${e(data.cashier||'')}</b></div>
    <div class="ritems"><div class="rline rhead-row"><div class="rname">Item</div><div class="rsum">Total</div></div>${rows}</div>
    <div class="rtotals">
      <div><span>Subtotal</span><b>${money(data.subtotal)}</b></div>
      ${Number(data.discount)?`<div><span>Discount</span><b>- ${money(data.discount)}</b></div>`:''}
      ${Number(data.tax)?`<div><span>Tax</span><b>${money(data.tax)}</b></div>`:''}
      <div class="rgrand"><span>TOTAL</span><b>${money(data.total)}</b></div>
    </div>
    <footer class="rfoot">${e(preferences.receipt_footer||'Thank you. Get well soon.')}</footer>
  </section>`;
  return Array.from({length:copies},()=>block).join('');
}

function table(columns,rows) {return `<table><thead><tr>${columns.map(c=>`<th>${e(c.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${e(r[c]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
async function renderPDF(kind,data,preferences={}) {
  let body='';
  if(kind==='receipt')return printReceipt(data,preferences);
  else if(kind==='printBarcode')body=`<div class="barcode">${data.svg}</div>`;
  else if(kind==='printLabels')body=`<div class="labels">${data.items.map(item=>Array.from({length:item.copies},()=>`<div class="label"><strong>${e(item.name)}</strong>${item.generic?`<span class="generic">${e(item.generic)}</span>`:''}<div class="code">${item.svg}</div><span class="price">${e(data.currency||'')} ${e(item.price.toFixed(2))}</span></div>`).join('')).join('')}</div>`;
  else body=`<p>${e(data.from)} — ${e(data.to)} · ${e(data.currency||preferences.currency||'')}</p>${table(data.columns,data.rows)}`;
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font:12px Arial,sans-serif;color:#152536;margin:28px}h1{font-size:23px;color:#087f75}p{line-height:1.7}table{width:100%;border-collapse:collapse;font-size:10px}th,td{text-align:left;padding:8px;border-bottom:1px solid #dce4eb}th{background:#edf5f4}tr{break-inside:avoid}thead{display:table-header-group}.barcode{width:320px}svg{max-width:100%}footer{margin-top:24px;color:#627080}.labels{display:flex;flex-wrap:wrap;gap:3mm}.label{width:60mm;height:32mm;box-sizing:border-box;border:1px dashed #c9d3dc;border-radius:2mm;padding:2mm 2.5mm;break-inside:avoid;overflow:hidden;text-align:center}.label strong{display:block;font-size:9px;line-height:1.25;color:#152536}.label .generic{display:block;font-size:7px;color:#627080;margin-bottom:1mm}.label .code svg{width:100%;height:12mm;max-width:100%}.label .price{display:block;font-size:9px;font-weight:bold;color:#087f75}</style></head><body><h1>${e(preferences.pharmacy_name||data.pharmacyName||'Pharmacy Management')}</h1><p>${e(preferences.address||'')} ${e(preferences.phone||'')}</p><h2>${e(kind==='receipt'?'Sales receipt':kind==='printBarcode'?'Medicine barcode':kind==='printLabels'?`Medicine labels (${data.total})`:data.kind+' report')}</h2>${body}<footer>${e(preferences.receipt_footer||'Generated by Pharmacy Management')}</footer></body></html>`;
  const {BrowserWindow}=require('electron');
  const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascriptEnabled:false}});
  try{await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return await win.webContents.printToPDF({printBackground:true,pageSize:'A4',margins:{top:0.4,bottom:0.4,left:0.4,right:0.4}});}
  finally{win.destroy();}
}

// A receipt is its own document: narrow paper, no report header, and one page
// per requested copy.
async function printReceipt(data,preferences){
  const paper=['80mm','58mm','A4'].includes(preferences.receipt_paper)?preferences.receipt_paper:'80mm';
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>${RECEIPT_CSS}</style></head><body>${receiptHTML(data,preferences)}</body></html>`;
  const {BrowserWindow}=require('electron');
  const win=new BrowserWindow({show:false,width:900,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascriptEnabled:false}});
  const pageSize=paper==='A4'?'A4':{width:(paper==='58mm'?58:80)/25.4,height:297/25.4};
  const margins=paper==='A4'?{top:0.3,bottom:0.3,left:0.3,right:0.3}:{top:0,bottom:0,left:0,right:0};
  try{await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return await win.webContents.printToPDF({printBackground:true,pageSize,margins});}
  finally{win.destroy();}
}
module.exports={renderPDF,receiptHTML};

