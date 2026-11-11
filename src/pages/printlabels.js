import {api,state,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,run,toast} from '../components/ui.js';

/* Print labels: choose medicines, decide how many labels each one needs and
   print them all as one local PDF sheet of CODE128 barcodes. */
const DAY = 86400000;
const EXPIRY_FILTERS=[
  {key:'any',label:'anyExpiry'},
  {key:'soon',label:'expiringFilter'},
  {key:'expired',label:'expired'},
  {key:'none',label:'noExpiry'}
];
const STOCK_FILTERS=[
  {key:'any',label:'anyStock'},
  {key:'in',label:'inStock'},
  {key:'low',label:'lowStockFilter'},
  {key:'out',label:'outOfStock'}
];

export async function render(root){
  const currency=state.preferences.currency||'';
  root.innerHTML=`
    <header class="page-heading labels-heading">
      <div><h1>${e(t('printLabels'))}</h1><p>${e(t('printLabelsHint'))}</p></div>
    </header>
    <section class="card labels-filter">
      <div class="labels-filter-row">
        <label class="labels-search">${icon('search',18)}<input id="labels-search" type="search" autocomplete="off" placeholder="${e(t('searchMedicines'))}" aria-label="${e(t('searchMedicines'))}"></label>
        <span class="labels-select"><select id="labels-category" aria-label="${e(t('category'))}"><option value="">${e(t('allCategories'))}</option></select>${icon('chevron',16)}</span>
        <span class="labels-select"><select id="labels-expiry" aria-label="${e(t('expiry'))}">${EXPIRY_FILTERS.map(item=>`<option value="${item.key}">${e(t(item.label))}</option>`).join('')}</select>${icon('chevron',16)}</span>
        <span class="labels-select"><select id="labels-stock" aria-label="${e(t('stock'))}">${STOCK_FILTERS.map(item=>`<option value="${item.key}">${e(t(item.label))}</option>`).join('')}</select>${icon('chevron',16)}</span>
      </div>
      <div class="labels-filter-row labels-tools">
        <button class="btn btn-secondary btn-sm" type="button" id="select-all-visible">${e(t('selectAllVisible'))}</button>
        <button class="btn btn-secondary btn-sm" type="button" id="copies-stock">${e(t('copiesStock'))}</button>
        <span class="labels-shown" id="labels-shown"></span>
      </div>
    </section>
    <section class="card labels-card">
      <div class="table-scroll"><table class="labels-table">
        <thead><tr>
          <th class="labels-check-col"><span class="labels-check">${icon('check',12)}</span></th>
          <th>${e(t('medicine'))}</th><th>${e(t('barcode'))}</th><th>${e(t('stock'))}</th><th>${e(t('sellingPrice'))}</th><th>${e(t('expiry'))}</th><th class="text-end">${e(t('copies'))}</th>
        </tr></thead>
        <tbody id="labels-rows"></tbody>
      </table></div>
      <footer class="labels-footer"><span id="labels-count"></span></footer>
    </section>
    <div class="labels-printbar">
      <span id="labels-total"></span>
      <button class="btn btn-primary" type="button" id="print-labels">${icon('printer',17)}<span>${e(t('print'))}</span></button>
    </div>`;

  let rows=[],categories=[],days=90,search='',category='',expiry='any',stock='any',timer;
  const chosen=new Map();
  const todayDate=today();

  const daysLeft=value=>Math.round((Date.parse(`${value}T00:00:00Z`)-Date.parse(`${todayDate}T00:00:00Z`))/DAY);
  const passes=row=>{
    if(category&&String(row.category_id)!==category)return false;
    if(expiry==='soon'&&!row.expiring)return false;
    if(expiry==='expired'&&!(row.expiry&&daysLeft(row.expiry)<0))return false;
    if(expiry==='none'&&row.expiry)return false;
    if(stock==='in'&&row.stock<=0)return false;
    if(stock==='low'&&!(row.stock>0&&row.stock<=Number(row.reorder_level||0)))return false;
    if(stock==='out'&&row.stock!==0)return false;
    const term=search.trim().toLowerCase();
    if(!term)return true;
    return [row.name,row.generic_name,row.barcode,row.sku].some(value=>String(value||'').toLowerCase().includes(term));
  };
  const visibleRows=()=>rows.filter(passes);
  const totalLabels=()=>[...chosen.values()].reduce((sum,value)=>sum+value,0);
  const updateTools=()=>{
    root.querySelector('#labels-shown').textContent=`${visibleRows().length} ${t('shown')}`;
    const total=totalLabels();
    root.querySelector('#labels-total').textContent=total===1?t('oneLabel'):`${total} ${t('labels')}`;
    root.querySelector('#print-labels').disabled=total===0;
  };
  const paint=()=>{
    const visible=visibleRows();
    root.querySelector('#labels-rows').innerHTML=visible.length?visible.map(row=>{
      const copies=chosen.get(row.id)||0;
      const tone=daysLeft(row.expiry||'9999-12-31')<0?'muted':row.out?'muted':row.low?'warn':'good';
      return `<tr data-row="${row.id}">
        <td class="labels-check-col"><button class="labels-check ${copies?'checked':''}" type="button" data-toggle="${row.id}" aria-pressed="${copies>0}" aria-label="${e(t('selectAllVisible'))}">${icon('check',12)}</button></td>
        <td><span class="labels-medicine">${icon('pill',16)}<span><span class="table-name">${e(row.name)}</span>${row.generic_name?`<small class="table-sub">${e(row.generic_name)}</small>`:''}</span></span></td>
        <td class="mono">${row.barcode?e(row.barcode):'<span class="muted">—</span>'}</td>
        <td><span class="badge ${tone} stock-badge">${row.stock} ${e(t(row.unit))}</span></td>
        <td class="nowrap">${e(currency)} ${money(row.price)}</td>
        <td class="nowrap">${row.expiry?e(row.expiry):'<span class="muted">—</span>'}</td>
        <td class="text-end"><input class="copies-input" type="number" min="0" max="200" step="1" value="${copies}" data-copies="${row.id}" aria-label="${e(t('copies'))}"></td>
      </tr>`;
    }).join(''):`<tr><td colspan="7" class="labels-empty-cell"><div class="labels-empty"><div class="labels-empty-icon">${icon('barcode',26)}</div><h3>${e(t('noLabelMatch'))}</h3><p>${e(t('noLabelMatchHint'))}</p></div></td></tr>`;
    root.querySelector('#labels-count').textContent=`${t('showingAll')} ${visible.length}`;
    root.querySelectorAll('[data-toggle]').forEach(node=>node.onclick=()=>{
      const id=Number(node.dataset.toggle);
      const copies=chosen.get(id)||0;
      if(copies)chosen.delete(id);else chosen.set(id,1);
      paint();
    });
    root.querySelectorAll('[data-copies]').forEach(input=>{
      input.onchange=()=>{
        const id=Number(input.dataset.copies);
        const copies=Math.max(0,Math.min(200,Math.floor(Number(input.value)||0)));
        input.value=String(copies);
        if(copies)chosen.set(id,copies);else chosen.delete(id);
        node_update(id,copies);
        updateTools();
      };
    });
    updateTools();
  };
  const node_update=(id,copies)=>{
    const row=root.querySelector(`[data-row="${id}"]`);
    if(!row)return;
    const check=row.querySelector('[data-toggle]');
    check.classList.toggle('checked',copies>0);
    check.setAttribute('aria-pressed',String(copies>0));
  };

  const load=async()=>{
    const book=await api('labelBook');
    rows=book.rows||[];
    categories=book.categories||[];
    days=book.warningDays||90;
    const select=root.querySelector('#labels-category');
    select.innerHTML=`<option value="">${e(t('allCategories'))}</option>`+categories.map(item=>`<option value="${item.id}">${e(item.name)}</option>`).join('');
    select.value=category;
    paint();
  };
  root.querySelector('#labels-search').oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  root.querySelector('#labels-category').onchange=ev=>{category=ev.target.value;paint();};
  root.querySelector('#labels-expiry').onchange=ev=>{expiry=ev.target.value;paint();};
  root.querySelector('#labels-stock').onchange=ev=>{stock=ev.target.value;paint();};
  root.querySelector('#select-all-visible').onclick=()=>{
    const visible=visibleRows();
    const allChosen=visible.every(row=>(chosen.get(row.id)||0)>0);
    for(const row of visible){if(allChosen)chosen.delete(row.id);else if(!chosen.get(row.id))chosen.set(row.id,1);}
    paint();
  };
  root.querySelector('#copies-stock').onclick=()=>{
    for(const row of visibleRows()){if(row.stock>0)chosen.set(row.id,Math.min(200,row.stock));else chosen.delete(row.id);}
    paint();
  };
  root.querySelector('#print-labels').onclick=()=>run(async()=>{
    const items=[...chosen.entries()].map(([id,copies])=>({id,copies}));
    if(!items.length){toast(t('chooseLabels'),'error');return;}
    const result=await api('printLabels',{items});
    if(!result.cancelled)toast(result.path);
  });
  await run(load);
  return ()=>clearTimeout(timer);
}
