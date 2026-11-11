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
        <thead><tr><th>${e(t('name'))}</th><th>${e(t('stock'))}</th><th>${e(t('purchasePrice'))}</th><th>${e(t('sellingPrice'))}</th><th class="text-end">${e(t('profitPerUnit'))}</th></tr></thead>
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
        <td class="nowrap price-cell" data-cell="${row.id}">
          <span class="price-value">${price(row.price)}</span>
          <button class="price-edit" type="button" data-edit-price="${row.id}" aria-label="${e(t('editSellingPrice'))}" title="${e(t('editSellingPrice'))}">${icon('pencil',14)}</button>
        </td>
        <td class="text-end nowrap"><strong class="profit ${Number(row.profit)>=0?'':'negative'}">${price(row.profit)}</strong></td>
      </tr>`).join(''):`<tr><td colspan="5" class="price-list-empty-cell"><div class="price-list-empty"><div class="price-list-empty-icon">${icon('printer',26)}</div><h3>${e(t('noPriceList'))}</h3><p>${e(t('noPriceListHint'))}</p></div></td></tr>`;
    root.querySelector('#price-count').textContent=`${t('showingAll')} ${visible.length}`;
    root.querySelectorAll('[data-edit-price]').forEach(node=>node.onclick=()=>startEdit(Number(node.dataset.editPrice)));
  };

  /* Clicking the pencil turns the selling price into an input with a save and a
     cancel button. Enter saves, Escape closes without saving. */
  const startEdit=medicineId=>{
    const row=rows.find(item=>item.id===medicineId);
    const cell=root.querySelector(`[data-cell="${medicineId}"]`);
    if(!row||!cell||cell.classList.contains('is-editing'))return;
    cell.classList.add('is-editing');
    cell.innerHTML=`<span class="price-editor"><input class="price-input" type="number" step="0.01" min="0" value="${Number(row.price)}" aria-label="${e(t('sellingPrice'))}"><button class="price-save" type="button" data-price-save aria-label="${e(t('save'))}">${icon('check',14)}</button><button class="price-cancel" type="button" data-price-cancel aria-label="${e(t('cancel'))}">${icon('close',14)}</button></span>`;
    const input=cell.querySelector('.price-input');
    const close=()=>{cell.classList.remove('is-editing');paint();};
    const save=async()=>{
      const value=Number(input.value);
      if(!(value>0)){input.classList.add('invalid');input.focus();toast(t('invalidPrice'),'error');return;}
      input.disabled=true;
      const done=await run(async()=>{
        await api('updatePrice',{id:medicineId,price:value});
        toast(t('priceSaved'));
        await load();
        return true;
      });
      if(!done)close();
    };
    cell.querySelector('[data-price-save]').onclick=save;
    cell.querySelector('[data-price-cancel]').onclick=close;
    input.onkeydown=event=>{
      if(event.key==='Enter'){event.preventDefault();save();}
      else if(event.key==='Escape'){event.preventDefault();close();}
    };
    input.oninput=()=>input.classList.remove('invalid');
    setTimeout(()=>{input.focus();input.select();},20);
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
