'use strict';
const { escapeXml } = require('./barcode');
const e=escapeXml;

// Receipts: the printed bill. The layout follows the pharmacy's own paper
// bill — pharmacy name and phone at the top, #/Name/Date/Time/Dr meta block,
// a four-column item table, Total Amount/Discount/Grand Total, the total in
// words, and who printed it. Three dresses share that structure: classic (the
// boxed bill), compact (no borders, for narrow paper) and boxed (framed).
const {amountInWords}=require('./words');
const money=value=>Number(value||0).toFixed(2);
const stamp=value=>String(value||'').slice(0,16).replace('T',' ');
const dayOf=value=>stamp(value).slice(0,10);
const timeOf=value=>stamp(value).slice(11,16);
const RECEIPT_CSS=`
  @page{margin:0}
  body{margin:0;padding:0;background:#fff;color:#111;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
  .receipt{box-sizing:border-box;margin:0 auto;padding:4mm 3mm;font-size:10px;line-height:1.45}
  .p-58mm{width:58mm}.p-80mm{width:80mm}.p-A4{width:210mm;padding:12mm;font-size:11px}
  .receipt+.receipt{break-before:page;page-break-before:always}
  .rhead{text-align:center;margin-bottom:2.5mm}
  .rhead strong{display:block;font-size:15px;letter-spacing:.2px;line-height:1.25}
  .rhead small{display:block;font-size:9px;color:#333}
  .rphone{margin-top:.6mm}
  .rmeta{display:grid;grid-template-columns:1fr 1fr;gap:.6mm 4mm;font-size:9.5px;margin:2mm 0}
  .rmeta div{display:flex;gap:2mm;min-width:0}
  .rmeta span{color:#333;white-space:nowrap}
  .rmeta b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rtable{width:100%;border-collapse:collapse;font-size:9.5px;table-layout:fixed}
  .rtable th{font-weight:600;text-align:left;padding:1.2mm 1.4mm;border:1px solid #111}
  .rtable td{padding:1.2mm 1.4mm;border:1px solid #111;vertical-align:top;word-break:break-word}
  .rtable .num{text-align:right;white-space:nowrap}
  .rtable col.c-desc{width:50%}.rtable col.c-qty{width:11%}.rtable col.c-price{width:19.5%}.rtable col.c-total{width:19.5%}
  .rtotals{margin-top:2.5mm;font-size:9.5px}
  .rtotals div{display:flex;justify-content:space-between;gap:4mm;padding:.7mm 0}
  .rtotals span{color:#111}
  .rtotals b{font-weight:600;white-space:nowrap}
  .rgrand{font-weight:700;font-size:10.5px}
  .rwords{margin-top:1.5mm;font-size:9px;font-style:italic;color:#222;border-top:1px solid #111;padding-top:1.4mm}
  .rrule{border-top:1px solid #111;margin:2.5mm 0 1.6mm}
  .rprinted{font-size:9px;color:#111}
  .rfoot{margin-top:1.6mm;font-size:9px;color:#444;text-align:center}
  /* classic: the paper bill, with a boxed item table and the words line rule */
  .t-classic .rhead strong{text-transform:none}
  /* compact: same data, no boxes, tighter rows — fits more on 58mm paper */
  .t-compact{font-size:9.5px;line-height:1.3;padding:3mm 2mm}
  .t-compact .rtable th,.t-compact .rtable td{border:0;border-bottom:1px dotted #999;padding:.8mm 1mm}
  .t-compact .rtable th{border-bottom:1px solid #111}
  .t-compact .rhead{margin-bottom:1.5mm}
  .t-compact .rhead strong{font-size:13px}
  .t-compact .rmeta{margin:1mm 0}
  .t-compact .rtotals div{padding:.3mm 0}
  .t-compact .rwords{border-top:1px dotted #999;font-style:normal}
  .t-compact .rrule{display:none}
  /* boxed: framed sections for a formal invoice look */
  .t-boxed .rhead{border:1px solid #111;padding:2mm}
  .t-boxed .rmeta{border:1px solid #111;padding:1.6mm 2mm}
  .t-boxed .rtotals{border:1px solid #111;padding:1.4mm 2mm}
  .t-boxed .rwords{border-top:0;font-style:normal}
  .t-boxed .rgrand{border-top:1px solid #111;margin-top:.8mm;padding-top:.8mm}
`;
function receiptHTML(data,preferences){
  const template=['classic','compact','boxed'].includes(preferences.receipt_template)?preferences.receipt_template:'classic';
  const paper=['80mm','58mm','A4'].includes(preferences.receipt_paper)?preferences.receipt_paper:'80mm';
  const copies=Math.min(5,Math.max(1,Number(preferences.receipt_copies)||1));
  const currency=preferences.currency||'';
  const items=Array.isArray(data.items)?data.items:[];
  const filled=(value,fallback)=>String(value===undefined||value===null||value===''?fallback:value);
  const withCurrency=value=>`${money(value)}${currency?` ${currency}`:''}`;
  const date=dayOf(data.date||data.created_at);
  const time=timeOf(data.date||data.created_at);
  const buyer=filled(data.patientName||data.party?.name||data.customer,'Walk-in');
  const doctor=filled(data.doctor,'General');
  const rows=items.map(item=>{
    const qty=Number(item.quantity||0),price=Number(item.price||0),line=Number(item.total??qty*price)||0;
    return `<tr><td>${e(item.name||'')}</td><td class="num">${qty}</td><td class="num">${money(price)}</td><td class="num">${money(line)}</td></tr>`;
  }).join('');
  const block=`
  <section class="receipt t-${template} p-${paper}">
    <header class="rhead">
      <strong>${e(filled(preferences.pharmacy_name||data.pharmacyName,'Pharmacy Management'))}</strong>
      ${preferences.address?`<small>${e(preferences.address)}</small>`:''}
      ${preferences.phone?`<small class="rphone">Phone: ${e(preferences.phone)}</small>`:''}
    </header>
    <div class="rmeta">
      <div><span>#:</span><b>${e(filled(data.invoice_no,''))}</b></div>
      <div><span>Name:</span><b>${e(buyer)}</b></div>
      <div><span>Date:</span><b>${e(date)}</b></div>
      <div><span>Time:</span><b>${e(time)}</b></div>
      <div><span>Dr:</span><b>${e(doctor)}</b></div>
      <div><span>Item:</span><b>${items.length}</b></div>
    </div>
    <table class="rtable">
      <colgroup><col class="c-desc"><col class="c-qty"><col class="c-price"><col class="c-total"></colgroup>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="4">&nbsp;</td></tr>'}</tbody>
    </table>
    <div class="rtotals">
      <div><span>Total Amount:</span><b>${withCurrency(data.subtotal)}</b></div>
      ${Number(data.tax)?`<div><span>Tax:</span><b>${withCurrency(data.tax)}</b></div>`:''}
      <div><span>Total Discount:</span><b>${withCurrency(data.discount)}</b></div>
      <div class="rgrand"><span>Grand Total:</span><b>${withCurrency(data.total)}</b></div>
    </div>
    <div class="rwords">${e(amountInWords(data.total))} Only</div>
    <div class="rrule"></div>
    <div class="rprinted">Printed By: <b>${e(filled(data.cashier,''))}</b></div>
    <div class="rfoot">${e(preferences.receipt_footer||'Thank you. Get well soon.')}</div>
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

