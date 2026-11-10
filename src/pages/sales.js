import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,table,badge,empty,run,dateFilters,bindDates,toast} from '../components/ui.js';
import {showDocument,openReturn} from '../components/documents.js';
const iconText=(count,label)=>`${count} ${t(label)}`;
/* Sales & returns is split in two: the sales history and the returns history.
   A return is always created from its sale (the Return button on a sale row). */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('sales'),t('invoice'))+
    `<div class="tabs" role="tablist"><button class="tab active" role="tab" aria-selected="true" data-tab="sales">${e(t('salesHistory'))}</button><button class="tab" role="tab" aria-selected="false" data-tab="returns">${e(t('returns'))}</button></div>`+
    `<section class="card"><div class="filter-bar">${dateFilters()}</div><div class="inline sale-tab-tools" id="sales-tools"></div><div id="sales-rows"></div><footer class="table-footer"><span id="sales-total"></span><span id="returns-total"></span></footer></section>`;
  let tab='sales',range={},focus=params.id?Number(params.id):0,scrolled=false;

  const loadSales=async()=>{
    const rows=await api('documents',{type:'sales',...range});
    root.querySelector('#sales-rows').innerHTML=table(['invoice','customer','total','paid','date','status','actions'],rows,r=>`<tr${r.id===focus?' class="row-focus"':''}><td class="mono positive">${e(r.invoice_no)}</td><td>${e(r.customer)}</td><td>${money(r.total)}</td><td>${money(r.paid)}</td><td class="nowrap muted">${e(dateTime(r.date))}</td><td>${badge(r.status)}${r.returns>0?` <span class="badge muted">${e(t('returns'))} ${money(r.returns)}</span>`:''}</td><td><div class="inline"><button class="btn btn-ghost btn-sm" data-view="${r.id}">${e(t('view'))}</button><button class="btn btn-ghost btn-sm" data-return="${r.id}">${e(t('return'))}</button><button class="btn btn-ghost btn-sm" data-pdf="${r.id}">PDF</button></div></td></tr>`);
    root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>run(()=>showDocument('sale',Number(b.dataset.view))));
    root.querySelectorAll('[data-return]').forEach(b=>b.onclick=()=>run(()=>openReturn('sale',Number(b.dataset.return),()=>load())));
    root.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>run(async()=>{const result=await api('receipt',{id:Number(b.dataset.pdf)});if(!result.cancelled)toast(result.path);}));
    const total=rows.reduce((sum,r)=>sum+Number(r.total||0),0);
    root.querySelector('#sales-total').innerHTML=`${iconText(rows.length,t('invoice'))} · ${money(total)}`;
    root.querySelector('#returns-total').textContent='';
  };
  const loadReturns=async()=>{
    const rows=await api('documents',{type:'salereturns',...range});
    root.querySelector('#sales-rows').innerHTML=rows.length?table(['returnedOn','invoice','customer','items','total','method','returnReason','actions'],rows,r=>`<tr><td class="nowrap muted">${e(dateTime(r.date))}</td><td class="mono">${e(r.invoice_no)}</td><td>${e(r.customer)}</td><td>${r.items}</td><td class="negative">−${money(r.total)}</td><td>${e(t(r.method))}</td><td class="muted">${e(r.reason)}</td><td><button class="btn btn-ghost btn-sm" data-open-sale="${r.sale_id}">${e(t('view'))}</button></td></tr>`)
      :empty(t('returns'),t('emptyHint'),'transfer');
    root.querySelectorAll('[data-open-sale]').forEach(b=>b.onclick=()=>run(()=>showDocument('sale',Number(b.dataset.openSale))));
    const total=rows.reduce((sum,r)=>sum+Number(r.total||0),0);
    root.querySelector('#sales-total').textContent='';
    root.querySelector('#returns-total').innerHTML=`${iconText(rows.length,t('returns'))} · −${money(total)}`;
  };
  const load=async()=>{focusRow();return tab==='sales'?loadSales():loadReturns();};
  const focusRow=()=>{if(!focus||scrolled||tab!=='sales')return;const el=root.querySelector('#sales-rows .row-focus');if(!el)return;scrolled=true;el.scrollIntoView({block:'center'});};

  const setTab=next=>{
    tab=next;
    root.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===next;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
    root.querySelector('#sales-tools').innerHTML=next==='sales'?'':`<span class="muted">${e(t('saleReturn'))}: ${e(t('invoice'))} → ${e(t('return'))}</span>`;
    return run(load);
  };
  root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  bindDates(root,query=>{range=query;return load();});
  await load();
  /* Coming from an invoice shortcut: open that invoice's details straight away. */
  if(focus)await run(()=>showDocument('sale',focus));
}
