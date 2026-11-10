import {api,state,money,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,run,toast} from '../components/ui.js';

/* Price list: one printable page with the shelf quantity, purchase price,
   selling price and the profit on each medicine. Export PDF asks the main
   process for a local PDF file; nothing leaves the computer. */
export async function render(root){
  const currency=state.preferences.currency||'';
  root.innerHTML=`
    <header class="page-heading price-list-heading">
      <div><h1>${e(t('priceList'))}</h1></div>
      <div class="heading-actions">${button(t('exportPdf'),'printer','secondary','id="export-price-list"')}</div>
    </header>
    <section class="card price-list-search-card">
      <label class="price-list-search">${icon('search',18)}<input id="price-search" type="search" autocomplete="off" placeholder="${e(t('searchMedicine'))}" aria-label="${e(t('searchMedicine'))}"></label>
    </section>
    <section class="card price-list-card">
      <div class="table-scroll"><table class="price-list-table">
        <thead><tr><th>${e(t('name'))}</th><th>${e(t('stock'))}</th><th>${e(t('purchasePrice'))}</th><th>${e(t('sellingPrice'))}</th><th class="text-end">${e(t('profit'))}</th></tr></thead>
        <tbody id="price-rows"></tbody>
      </table></div>
      <footer class="price-list-footer"><span id="price-count"></span></footer>
    </section>`;

  let rows=[],search='',timer;
  const price=value=>`${e(currency)} ${money(value)}`;
  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=term?rows.filter(row=>String(row.name||'').toLowerCase().includes(term)||String(row.generic_name||'').toLowerCase().includes(term)):rows;
    root.querySelector('#price-rows').innerHTML=visible.length?visible.map(row=>`<tr>
        <td><span class="table-name">${e(row.name)}</span>${row.generic_name?`<small class="table-sub">${e(row.generic_name)}</small>`:''}</td>
        <td><span class="badge warn stock-pill">${row.stock} ${e(t(row.unit))}</span></td>
        <td class="nowrap">${price(row.cost)}</td>
        <td class="nowrap">${price(row.price)}</td>
        <td class="text-end nowrap"><strong class="profit ${Number(row.profit)>=0?'':'negative'}">${price(row.profit)}</strong></td>
      </tr>`).join(''):`<tr><td colspan="5" class="price-list-empty-cell"><div class="price-list-empty"><div class="price-list-empty-icon">${icon('printer',26)}</div><h3>${e(t('noPriceList'))}</h3><p>${e(t('noPriceListHint'))}</p></div></td></tr>`;
    root.querySelector('#price-count').textContent=`${t('showingAll')} ${visible.length}`;
  };
  const load=async()=>{
    const book=await api('priceList');
    rows=book.rows||[];
    paint();
  };
  root.querySelector('#price-search').oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  root.querySelector('#export-price-list').onclick=()=>run(async()=>{
    const result=await api('pdf',{kind:'pricelist'});
    if(!result.cancelled)toast(result.path);
  });
  await run(load);
  return ()=>clearTimeout(timer);
}
