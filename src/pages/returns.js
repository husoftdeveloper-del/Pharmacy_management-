import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,table,empty,run,dateFilters,bindDates} from '../components/ui.js';
import {showDocument,openReturn} from '../components/documents.js';
/* Returns: two lists behind two buttons — sales returns and purchase returns.
   Both are created from their document (Sales history / Purchases) and show the
   original invoice, the negative amount, the refund method and the reason. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('returns'),`${t('saleReturn')} · ${t('purchaseReturn')}`)+
    `<div class="tabs returns-tabs" role="tablist">
      <button class="tab active" role="tab" aria-selected="true" data-kind="sale">${e(t('saleReturn'))}</button>
      <button class="tab" role="tab" aria-selected="false" data-kind="purchase">${e(t('purchaseReturn'))}</button>
    </div>
    <section class="card"><div class="filter-bar">${dateFilters()}</div><div id="returns-rows"></div><footer class="table-footer"><span id="returns-total"></span><span class="muted" id="returns-note">${e(t('saleReturn'))}</span></footer></section>`;
  const range={from:'',to:''};
  let kind='sale',rows=[];
  const load=async()=>{
    rows=await api('documents',{type:kind==='sale'?'salereturns':'purchasereturns',...range});
    const party=kind==='sale'?'customer':'supplier',docType=kind==='sale'?'sale':'purchase',docId=kind==='sale'?'sale_id':'purchase_id';
    root.querySelector('#returns-rows').innerHTML=rows.length?table(['returnedOn','invoice',party,'items','total','method','returnReason','actions'],rows,r=>`<tr><td class="nowrap muted">${e(dateTime(r.date))}</td><td class="mono">${e(r.invoice_no)}</td><td>${e(r[party])}</td><td>${r.items}</td><td class="negative">−${money(r.total)}</td><td>${e(t(r.method))}</td><td class="muted">${e(r.reason)}</td><td><div class="inline"><button class="btn btn-ghost btn-sm" data-open="${r[docId]}">${e(t('view'))}</button><button class="btn btn-ghost btn-sm" data-again="${r[docId]}">${e(t('return'))}</button></div></td></tr>`)
      :empty(kind==='sale'?t('returns'):t('purchaseReturn'),t('emptyHint'),'transfer');
    root.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>run(()=>showDocument(docType,Number(b.dataset.open))));
    root.querySelectorAll('[data-again]').forEach(b=>b.onclick=()=>run(()=>openReturn(docType,Number(b.dataset.again),load)));
    root.querySelector('#returns-total').innerHTML=`${rows.length} ${e(kind==='sale'?t('returns'):t('purchaseReturn'))} · −${money(rows.reduce((sum,r)=>sum+Number(r.total||0),0))}`;
    root.querySelector('#returns-note').textContent=kind==='sale'?t('saleReturn'):t('purchaseReturn');
  };
  root.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{
    if(b.dataset.kind===kind)return;
    kind=b.dataset.kind;
    root.querySelectorAll('[data-kind]').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active));});
    return run(load);
  });
    bindDates(root,query=>{range.from=query.from;range.to=query.to;return load();});
  await run(load);
  if(params.id)await run(()=>showDocument('sale',Number(params.id)));
}
