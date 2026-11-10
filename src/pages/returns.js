import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,button,table,empty,run,dateFilters,bindDates} from '../components/ui.js';
import {showDocument,openReturn} from '../components/documents.js';
/* Sales returns history: every returned sale with the original invoice, the
   negative amount, the refund method and the reason. Returns are created from
   the Sales history page (Return) or from an invoice's detail dialog. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('returns'),t('saleReturn'),button(t('salesHistory'),'file','secondary','data-go="sales"'))+
    `<section class="card"><div class="filter-bar">${dateFilters()}</div><div id="returns-rows"></div><footer class="table-footer"><span id="returns-total"></span><span class="muted">${e(t('saleReturn'))}</span></footer></section>`;
  const range={from:'',to:''};
  let rows=[];
  const load=async()=>{
    rows=await api('documents',{type:'salereturns',...range});
    root.querySelector('#returns-rows').innerHTML=rows.length?table(['returnedOn','invoice','customer','items','total','method','returnReason','actions'],rows,r=>`<tr><td class="nowrap muted">${e(dateTime(r.date))}</td><td class="mono">${e(r.invoice_no)}</td><td>${e(r.customer)}</td><td>${r.items}</td><td class="negative">−${money(r.total)}</td><td>${e(t(r.method))}</td><td class="muted">${e(r.reason)}</td><td><div class="inline"><button class="btn btn-ghost btn-sm" data-open-sale="${r.sale_id}">${e(t('view'))}</button><button class="btn btn-ghost btn-sm" data-again="${r.sale_id}">${e(t('return'))}</button></div></td></tr>`)
      :empty(t('returns'),t('emptyHint'),'transfer');
    root.querySelectorAll('[data-open-sale]').forEach(b=>b.onclick=()=>run(()=>showDocument('sale',Number(b.dataset.openSale))));
    root.querySelectorAll('[data-again]').forEach(b=>b.onclick=()=>run(()=>openReturn('sale',Number(b.dataset.again),load)));
    root.querySelector('#returns-total').innerHTML=`${rows.length} ${e(t('returns'))} · −${money(rows.reduce((sum,r)=>sum+Number(r.total||0),0))}`;
  };
  root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>window.dispatchEvent(new CustomEvent('navigate',{detail:b.dataset.go})));
  bindDates(root,query=>{range.from=query.from;range.to=query.to;return load();});
  await run(load);
  if(params.id)await run(()=>showDocument('sale',Number(params.id)));
}
