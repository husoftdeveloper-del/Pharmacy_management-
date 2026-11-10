import {api,state,money,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,pageHeader,button,table,badge,empty,run} from '../components/ui.js';
import {openRecord} from '../components/records.js';
/* Medicines: the catalogue only — name, generic name, code, category, price,
   reorder level and status. Quantities, batches, expiry and stock value stay on
   the Inventory page. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('medicines'),t('inventory'),button(t('addMedicine'),'plus','primary','id="add-medicine"'))+
    `<div class="stat-grid medicine-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalMedicines'))}</span><span class="stat-icon blue">${icon('pill',19)}</span></div><div class="stat-value"><span>0</span></div><div class="stat-footer">${icon('check',12)}<span id="active-medicines"></span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('lowStock'))}</span><span class="stat-icon amber">${icon('warning',19)}</span></div><div class="stat-value"><span>0</span></div><div class="stat-footer">${icon('box',12)}<span>${e(t('reorderLevel'))}</span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('stockValue'))}</span><span class="stat-icon">${icon('wallet',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div><div class="stat-footer">${icon('clock',12)}<span>${e(t('inventory'))}</span></div></article>
    </div>
    <section class="card">
      <div class="table-toolbar"><label class="search-field">${icon('search',17)}<input id="medicine-search" placeholder="${e(t('search'))}" aria-label="${e(t('search'))}"></label><span class="muted" id="medicine-count"></span></div>
      <div id="medicine-rows"></div>
    </section>`;
  let rows=[],search=params.search||'',timer;

  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=term?rows.filter(row=>row.name.toLowerCase().includes(term)||String(row.generic_name||'').toLowerCase().includes(term)||String(row.sku||'').toLowerCase().includes(term)||String(row.barcode||'').toLowerCase().includes(term)):rows;
    root.querySelector('#medicine-count').textContent=`${visible.length} ${t('medicines')}`;
    root.querySelector('#medicine-rows').innerHTML=visible.length?table(['name','sku','category','price','stock','reorderLevel','active','actions'],visible,row=>`<tr>
        <td><span class="table-name">${e(row.name)}</span>${row.generic_name?`<small class="table-sub">${e(row.generic_name)}</small>`:''}</td>
        <td class="mono">${e(row.sku)}</td>
        <td>${row.category?e(row.category):'<span class="muted">—</span>'}</td>
        <td class="nowrap">${money(row.price)} <small class="muted">/ ${e(row.unit)}</small></td>
        <td class="nowrap ${Number(row.stock)===0?'negative':''}"><strong>${row.stock}</strong></td>
        <td class="nowrap muted">${row.reorder_level}</td>
        <td>${badge(Number(row.active)?'active':'inactive')}</td>
        <td><button class="btn btn-ghost btn-sm" data-edit="${row.id}">${e(t('edit'))}</button></td></tr>`)
      :empty(t('noMedicines'),t('noMedicinesHint'),'pill');
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openRecord('medicines',rows.find(row=>row.id===Number(b.dataset.edit)),load));
  };
  const load=async()=>{
    const book=await api('medicineBook');
    rows=book.rows||[];
    const values=root.querySelectorAll('.medicine-stats .stat-value span');
    values[0].textContent=String(book.totals.medicines);
    values[1].textContent=String(book.totals.lowStock);
    values[2].textContent=money(book.totals.value);
    root.querySelector('#active-medicines').textContent=`${book.totals.active} ${t('active')}`;
    paint();
  };
  root.querySelector('#add-medicine').onclick=()=>openRecord('medicines',{},load);
  root.querySelector('#medicine-search').oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,180);};
  await run(load);
  return ()=>clearTimeout(timer);
}
