import {api,money,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,run} from '../components/ui.js';

/* Inventory: what is on the shelf right now. One row per medicine with its
   barcode, total quantity and nearest expiry, filtered by All stock, Low Stock,
   Out of Stock or Expiring Soon. The search box also accepts a barcode scanner. */
const FILTERS=[
  {key:'all',label:'allStock',symbol:'box'},
  {key:'low',label:'lowStock',symbol:'warning'},
  {key:'out',label:'outOfStock',symbol:'transfer'},
  {key:'expiring',label:'expiringSoon',symbol:'clock'}
];
export async function render(root){
  root.innerHTML=`
    <header class="page-heading inventory-heading">
      <div><h1>${e(t('inventory'))}</h1></div>
      <label class="inventory-search">${icon('barcode',19)}<input id="inventory-search" type="search" autocomplete="off" placeholder="${e(t('scanBarcode'))}" aria-label="${e(t('scanBarcode'))}"></label>
    </header>
    <div class="inventory-filters" role="group" aria-label="${e(t('inventory'))}">
      ${FILTERS.map((filter,index)=>`<button class="inventory-chip ${index===0?'active':''}" data-filter="${filter.key}" aria-pressed="${index===0}">${icon(filter.symbol,17)}<span>${e(t(filter.label))}</span><b data-count="${filter.key}"></b></button>`).join('')}
    </div>
    <section class="card inventory-card">
      <div class="table-scroll"><table class="inventory-table">
        <thead><tr><th>${e(t('name'))}</th><th>${e(t('barcode'))}</th><th>${e(t('stock'))}</th><th>${e(t('expiry'))}</th></tr></thead>
        <tbody id="inventory-rows"></tbody>
      </table></div>
      <footer class="inventory-footer"><span id="inventory-count"></span></footer>
    </section>`;

  let rows=[],filter='all',search='',timer;
  const input=root.querySelector('#inventory-search');
  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=rows.filter(row=>{
      if(filter==='low'&&!row.low)return false;
      if(filter==='out'&&!row.out)return false;
      if(filter==='expiring'&&!row.expiring)return false;
      if(!term)return true;
      return [row.name,row.generic_name,row.sku,row.barcode].some(value=>String(value||'').toLowerCase().includes(term));
    });
    root.querySelector('#inventory-rows').innerHTML=visible.length?visible.map(row=>`<tr>
        <td><span class="table-name">${e(row.name)}</span>${row.generic_name?`<small class="table-sub">${e(row.generic_name)}</small>`:''}</td>
        <td class="mono">${row.barcode?e(row.barcode):'<span class="muted">—</span>'}</td>
        <td><span class="badge ${row.out?'muted':row.low?'warn':'good'} stock-badge">${row.stock} ${e(t(row.unit))}</span></td>
        <td class="nowrap">${row.expiry?e(row.expiry):'<span class="muted">—</span>'}</td>
      </tr>`).join(''):`<tr><td colspan="4" class="inventory-empty-cell"><div class="inventory-empty"><div class="inventory-empty-icon">${icon('box',26)}</div><h3>${e(t('noInventoryMatch'))}</h3><p>${e(t('noInventoryMatchHint'))}</p></div></td></tr>`;
    root.querySelector('#inventory-count').textContent=`${t('showingAll')} ${visible.length}`;
  };
  const counts=book=>{
    const map={all:book.totals.medicines,low:book.totals.low,out:book.totals.out,expiring:book.totals.expiring};
    for(const [key,value] of Object.entries(map))root.querySelector(`[data-count="${key}"]`).textContent=value?String(value):'';
  };
  const load=async()=>{
    const book=await api('inventoryBook');
    rows=book.rows||[];
    counts(book);
    paint();
  };
  const selectChip=key=>{
    filter=key;
    root.querySelectorAll('[data-filter]').forEach(chip=>{const active=chip.dataset.filter===key;chip.classList.toggle('active',active);chip.setAttribute('aria-pressed',String(active));});
    paint();
  };
  root.querySelectorAll('[data-filter]').forEach(chip=>chip.onclick=()=>selectChip(chip.dataset.filter));
  input.oninput=()=>{search=input.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  input.onkeydown=event=>{
    if(event.key!=='Enter')return;
    event.preventDefault();
    const term=input.value.trim();
    const exact=rows.find(row=>String(row.barcode||'')===term);
    if(exact){search=term;paint();}
  };
  await run(load);
  return ()=>clearTimeout(timer);
}
