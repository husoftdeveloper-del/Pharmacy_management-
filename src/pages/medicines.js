import {api,state,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,run,toast,confirmAction} from '../components/ui.js';
import {openMedicineForm} from '../components/medicine-form.js';

/* Medicines: the catalogue itself. One search box, one category filter and a
   single table with name, barcode, category, stock, purchase price, selling
   price, nearest expiry, who recorded it, and three row actions: print a label,
   edit, and remove from the list. A medicine that was never received yet shows
   em dashes for its prices, exactly like the approved screen. Quantities in
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
      <footer class="table-footer medicines-footer"><span id="medicine-count"></span></footer>
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
    // Removed medicines stay in the database for their history but leave this
    // catalogue, the point of sale and the label list.
    const catalogue=rows.filter(row=>Number(row.active)!==0);
    const visible=catalogue.filter(row=>{
      if(category&&String(row.category_id)!==category)return false;
      if(!term)return true;
      return [row.name,row.generic_name,row.sku,row.barcode,row.category].some(value=>String(value||'').toLowerCase().includes(term));
    });
    const body=root.querySelector('#medicine-rows');
    body.innerHTML=visible.length?visible.map(row=>{
      const unit=row.unit?String(row.unit):'';
      const cost=Number(row.cost)||0,price=Number(row.price)||0;
      return `<tr${Number(row.active)===0?' class="medicine-archived"':''}>
        <td><div class="medicine-name"><span class="medicine-mark">${icon('pill',15)}</span><div><span class="table-name">${e(row.name)}</span>${row.generic_name?`<small class="table-sub">${e(row.generic_name)}</small>`:''}</div></div></td>
        <td class="mono">${row.barcode?e(row.barcode):'<span class="muted">—</span>'}</td>
        <td>${row.category?e(row.category):'<span class="muted">—</span>'}</td>
        <td><div class="medicine-stock"><span class="badge ${Number(row.stock)<=Number(row.reorder_level)?'warn':'good'}">${row.stock}</span>${unit?`<span class="unit-pill">${e(t(unit))}</span>`:''}</div></td>
        <td class="nowrap">${cost?money(cost):'<span class="muted">—</span>'}</td>
        <td class="nowrap">${price?money(price):'<span class="muted">—</span>'}</td>
        <td class="nowrap">${row.expiry?`<span class="badge ${expiryTone(row.expiry)}">${e(row.expiry)}</span>`:'<span class="muted">—</span>'}</td>
        <td>${row.recorded_by?e(row.recorded_by):'<span class="muted">—</span>'}</td>
        <td class="text-end"><div class="medicine-actions">
          <button type="button" class="row-icon" data-label="${row.id}" title="${e(t('printLabel'))}" aria-label="${e(t('printLabel'))}">${icon('tag',16)}</button>
          <button type="button" class="row-icon" data-edit="${row.id}" title="${e(t('edit'))}" aria-label="${e(t('edit'))}">${icon('pencil',16)}</button>
          <button type="button" class="row-icon danger" data-archive="${row.id}" title="${e(t('removeMedicine'))}" aria-label="${e(t('removeMedicine'))}">${icon('trash',16)}</button>
        </div></td>
      </tr>`;
    }).join(''):emptyRow(9);
    root.querySelectorAll('[data-edit]').forEach(node=>node.onclick=()=>openMedicineForm(rows.find(row=>row.id===Number(node.dataset.edit)),load));
    // A label prints through the same Print Labels module as its own page.
    root.querySelectorAll('[data-label]').forEach(node=>node.onclick=()=>run(async()=>{
      const result=await api('printLabels',{items:[{id:Number(node.dataset.label),copies:1}]});
      if(!result.cancelled)toast(result.path);
    }));
    root.querySelectorAll('[data-archive]').forEach(node=>node.onclick=()=>run(async()=>{
      const row=rows.find(item=>item.id===Number(node.dataset.archive));
      if(!await confirmAction(t('removeMedicine'),`${t('removeMedicineConfirm')} ${row?.name||''}`))return;
      await api('save',{entity:'medicines',record:{...row,active:0,category_id:row.category_id||null,manufacturer_id:row.manufacturer_id||null}});
      toast(t('success'));
      await load();
    }));
    const filtered=Boolean(term||category);
    root.querySelector('#medicine-count').textContent=filtered
      ?`${t('showing')} ${visible.length} ${t('of')} ${catalogue.length}`
      :`${t('showingAll')} ${catalogue.length}`;
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
  root.querySelector('#add-medicine').onclick=()=>openMedicineForm({},load);
  query.oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  select.onchange=ev=>{category=ev.target.value;paint();};
  await run(load);
  return ()=>clearTimeout(timer);
}
