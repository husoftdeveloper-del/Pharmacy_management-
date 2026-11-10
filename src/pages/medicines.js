import {api,state,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,run} from '../components/ui.js';
import {openRecord} from '../components/records.js';

/* Medicines: the catalogue itself. One search box, one category filter and a
   single table with name, barcode, category, stock, purchase price, selling
   price, nearest expiry, who recorded it, and the row actions. Quantities in
   depth, batches and stock values stay on the Inventory page. */
const DAY = 86400000;
export async function render(root,params={}){
  root.innerHTML=`
    <header class="page-heading medicines-heading">
      <div><h1>${e(t('medicines'))}</h1></div>
      <div class="heading-actions">${button(t('newMedicine'),'plus','primary','id="add-medicine"')}</div>
    </header>
    <section class="card medicines-filter">
      <label class="medicines-search">${icon('search',18)}<input id="medicine-search" type="search" autocomplete="off" placeholder="${e(t('searchMedicines'))}" aria-label="${e(t('searchMedicines'))}" value="${e(params.search||'')}"></label>
      <label class="medicines-category">
        <select id="category-filter" aria-label="${e(t('category'))}"><option value="">${e(t('allCategories'))}</option></select>
        ${icon('chevron',16)}
      </label>
    </section>
    <section class="card medicines-card">
      <div class="table-scroll"><table class="medicines-table">
        <thead><tr><th>${e(t('name'))}</th><th>${e(t('barcode'))}</th><th>${e(t('category'))}</th><th>${e(t('stock'))}</th><th>${e(t('purchasePrice'))}</th><th>${e(t('sellingPrice'))}</th><th>${e(t('expiry'))}</th><th>${e(t('recordedBy'))}</th><th class="text-end">${e(t('actions'))}</th></tr></thead>
        <tbody id="medicine-rows"></tbody>
      </table></div>
      <footer class="table-footer"><span id="medicine-count"></span><span class="muted">${e(t('stockInBatches'))}</span></footer>
    </section>`;

  let rows=[],search=params.search||'',category='',timer;
  const query=root.querySelector('#medicine-search');
  const select=root.querySelector('#category-filter');

  const expiryTone=value=>{
    if(!value)return 'muted';
    const left=(Date.parse(`${value}T00:00:00Z`)-Date.parse(`${today()}T00:00:00Z`))/DAY;
    return left<0?'muted':left<=30?'warn':left<=90?'warn':'good';
  };
  const emptyRow=colspan=>`<tr><td colspan="${colspan}" class="medicines-empty-cell"><div class="medicines-empty"><div class="medicines-empty-icon">${icon('pill',26)}</div><h3>${e(t(search||category?'noMedicineMatch':'noMedicines'))}</h3><p>${e(t('noMedicineMatchHint'))}</p></div></td></tr>`;

  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=rows.filter(row=>{
      if(category&&String(row.category_id)!==category)return false;
      if(!term)return true;
      return [row.name,row.generic_name,row.sku,row.barcode,row.category].some(value=>String(value||'').toLowerCase().includes(term));
    });
    const body=root.querySelector('#medicine-rows');
    body.innerHTML=visible.length?visible.map(row=>`<tr>
        <td><span class="table-name">${e(row.name)}</span>${row.generic_name?`<small class="table-sub">${e(row.generic_name)}</small>`:''}</td>
        <td class="mono">${row.barcode?e(row.barcode):'<span class="muted">—</span>'}</td>
        <td>${row.category?e(row.category):'<span class="muted">—</span>'}</td>
        <td><span class="badge ${Number(row.stock)<=Number(row.reorder_level)?'warn':'good'}">${row.stock}</span></td>
        <td class="nowrap">${money(row.cost)}</td>
        <td class="nowrap">${money(row.price)} <small class="muted">/ ${e(row.unit)}</small></td>
        <td class="nowrap">${row.expiry?`<span class="badge ${expiryTone(row.expiry)}">${e(row.expiry)}</span>`:'<span class="muted">—</span>'}</td>
        <td>${row.recorded_by?e(row.recorded_by):'<span class="muted">—</span>'}</td>
        <td class="text-end"><button class="btn btn-ghost btn-sm" data-edit="${row.id}">${icon('settings',14)}<span>${e(t('edit'))}</span></button></td>
      </tr>`).join(''):emptyRow(9);
    root.querySelectorAll('[data-edit]').forEach(node=>node.onclick=()=>openRecord('medicines',rows.find(row=>row.id===Number(node.dataset.edit)),load));
    root.querySelector('#medicine-count').textContent=`${visible.length} ${t('medicines')}`;
  };
  const fillCategories=()=>{
    const options=state.options.categories||[];
    select.innerHTML=`<option value="">${e(t('allCategories'))}</option>`+options.map(item=>`<option value="${item.id}">${e(item.name)}</option>`).join('');
    select.value=category;
  };
  async function load(){
    const book=await api('medicineBook');
    rows=book.rows||[];
    fillCategories();
    paint();
  }
  root.querySelector('#add-medicine').onclick=()=>openRecord('medicines',{},load);
  query.oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  select.onchange=ev=>{category=ev.target.value;paint();};
  await run(load);
  return ()=>clearTimeout(timer);
}
