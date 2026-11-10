import {api,state,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,pageHeader,button,table,badge,empty,run} from '../components/ui.js';
/* Inventory: the stock itself — every batch with its quantity, expiry, location
   and value. The catalogue (names, codes, prices) lives on the Medicines page;
   stock adjustments, transfers and physical counts stay in their own modules. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('inventory'),t('stockInBatches'),button(t('adjustments'),'box','secondary','id="go-adjustments"'))+
    `<div class="stat-grid inventory-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('batches'))}</span><span class="stat-icon blue">${icon('box',19)}</span></div><div class="stat-value"><span>0</span></div><div class="stat-footer">${icon('pill',12)}<span>${e(t('medicines'))}</span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('stockValue'))}</span><span class="stat-icon">${icon('wallet',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div><div class="stat-footer">${icon('clock',12)}<span>${e(t('cost'))}</span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('lowStock'))}</span><span class="stat-icon amber">${icon('warning',19)}</span></div><div class="stat-value"><span>0</span></div><div class="stat-footer">${icon('box',12)}<span>${e(t('reorderLevel'))}</span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('expiring'))}</span><span class="stat-icon red">${icon('clock',19)}</span></div><div class="stat-value"><span>0</span></div><div class="stat-footer">${icon('clock',12)}<span id="warning-days"></span></div></article>
    </div>
    <section class="card">
      <div class="table-toolbar"><label class="search-field">${icon('search',17)}<input id="batch-search" placeholder="${e(t('search'))}" aria-label="${e(t('search'))}"></label><label class="dues-toggle"><input type="checkbox" id="only-expiring"><span class="toggle-track"><span class="toggle-dot"></span></span><span>${e(t('expiring'))}</span></label></div>
      <div id="batch-rows"></div>
    </section>`;
  let rows=[],search='',onlyExpiring=false,timer,days=90;
  const daysLeft=expiry=>Math.round((Date.parse(`${expiry}T00:00:00Z`)-Date.parse(`${today()}T00:00:00Z`))/86400000);
  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=rows.filter(row=>(!term||row.medicine.toLowerCase().includes(term)||String(row.batch_no||'').toLowerCase().includes(term)||String(row.location||'').toLowerCase().includes(term))&&(!onlyExpiring||daysLeft(row.expiry)<=days));
    root.querySelector('#batch-rows').innerHTML=visible.length?table(['medicine','batchNo','expiryDate','location','quantity','cost','value'],visible,row=>{
      const left=daysLeft(row.expiry);
      const tone=left<0?'muted':left<=30?'warn':left<=days?'good':'muted';
      return `<tr><td><span class="table-name">${e(row.medicine)}</span></td><td class="mono">${e(row.batch_no)}</td><td class="nowrap"><span class="badge ${tone}">${e(row.expiry)}</span></td><td class="muted">${e(row.location)}</td><td class="nowrap"><strong>${row.quantity}</strong></td><td class="nowrap">${money(row.cost)}</td><td class="nowrap">${money(row.value)}</td></tr>`;
    }):empty(t('noData'),t('inventory'),'box');
  };
  const load=async()=>{
    const book=await api('inventoryBook');
    rows=book.rows||[];days=book.totals.warningDays||90;
    const values=root.querySelectorAll('.inventory-stats .stat-value span');
    values[0].textContent=String(book.totals.batches);
    values[1].textContent=money(book.totals.value);
    values[2].textContent=String(book.totals.lowStock);
    values[3].textContent=String(book.totals.expiring);
    root.querySelector('#warning-days').textContent=`${days} ${t('expiryDays')}`;
    paint();
  };
  root.querySelector('#go-adjustments').onclick=()=>window.dispatchEvent(new CustomEvent('navigate',{detail:'adjustments'}));
  root.querySelector('#batch-search').oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,180);};
  root.querySelector('#only-expiring').onchange=ev=>{onlyExpiring=ev.target.checked;paint();};
  await run(load);
  return ()=>clearTimeout(timer);
}
