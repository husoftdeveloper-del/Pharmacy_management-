import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,table,badge,empty,run,dateFilters,bindDates,toast} from '../components/ui.js';
import {showDocument,openReturn} from '../components/documents.js';
const iconText=(count,label)=>`${count} ${t(label)}`;
/* Sales & returns page: the sales history on top and the returns list directly
   below it, so both are visible without switching tabs. A return is always
   created from its sale (the Return button on a sale row). */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('sales'),t('invoice'))+
    `<section class="card sales-panel" aria-labelledby="sales-history-title">
      <header class="card-header"><div><h2 id="sales-history-title">${e(t('salesHistory'))}</h2><p>${e(t('invoice'))}</p></div><span class="muted" id="sales-total"></span></header>
      <div class="filter-bar">${dateFilters()}</div>
      <div id="sales-rows"></div>
      <footer class="table-footer"><span class="muted">${e(t('saleReturn'))} → ${e(t('return'))}</span><span class="muted" id="sales-hint"></span></footer>
    </section>
    <section class="card sales-panel" aria-labelledby="returns-title">
      <header class="card-header"><div><h2 id="returns-title">${e(t('returns'))}</h2><p>${e(t('saleReturn'))}</p></div><span class="badge muted" id="returns-count"></span></header>
      <div id="returns-rows"></div>
      <footer class="table-footer"><span class="muted" id="returns-total"></span><span class="muted">—</span></footer>
    </section>`;
  const range={from:'',to:''};
  let focus=params.id?Number(params.id):0,scrolled=false;

  const loadSales=async()=>{
    const rows=await api('documents',{type:'sales',...range});
    root.querySelector('#sales-rows').innerHTML=table(['invoice','customer','total','paid','date','status','actions'],rows,r=>`<tr${r.id===focus?' class="row-focus"':''}><td class="mono positive">${e(r.invoice_no)}</td><td>${e(r.customer)}</td><td>${money(r.total)}</td><td>${money(r.paid)}</td><td class="nowrap muted">${e(dateTime(r.date))}</td><td>${badge(r.status)}${r.returns>0?` <span class="badge muted">${e(t('returns'))} ${money(r.returns)}</span>`:''}</td><td><div class="inline"><button class="btn btn-ghost btn-sm" data-view="${r.id}">${e(t('view'))}</button><button class="btn btn-ghost btn-sm" data-return="${r.id}">${e(t('return'))}</button><button class="btn btn-ghost btn-sm" data-pdf="${r.id}">PDF</button></div></td></tr>`);
    root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>run(()=>showDocument('sale',Number(b.dataset.view))));
    root.querySelectorAll('[data-return]').forEach(b=>b.onclick=()=>run(()=>openReturn('sale',Number(b.dataset.return),()=>reload())));
    root.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>run(async()=>{const result=await api('receipt',{id:Number(b.dataset.pdf)});if(!result.cancelled)toast(result.path);}));
    root.querySelector('#sales-total').textContent=`${iconText(rows.length,t('invoice'))} · ${money(rows.reduce((sum,r)=>sum+Number(r.total||0),0))}`;
    root.querySelector('#sales-hint').textContent=rows.find(r=>r.id===focus)?.invoice_no||'';
    focusRow();
  };
  const loadReturns=async()=>{
    const rows=await api('documents',{type:'salereturns',...range});
    root.querySelector('#returns-count').textContent=String(rows.length);
    root.querySelector('#returns-rows').innerHTML=rows.length?table(['returnedOn','invoice','customer','items','total','method','returnReason','actions'],rows,r=>`<tr><td class="nowrap muted">${e(dateTime(r.date))}</td><td class="mono">${e(r.invoice_no)}</td><td>${e(r.customer)}</td><td>${r.items}</td><td class="negative">−${money(r.total)}</td><td>${e(t(r.method))}</td><td class="muted">${e(r.reason)}</td><td><button class="btn btn-ghost btn-sm" data-open-sale="${r.sale_id}">${e(t('view'))}</button></td></tr>`)
      :empty(t('returns'),t('emptyHint'),'transfer');
    root.querySelectorAll('[data-open-sale]').forEach(b=>b.onclick=()=>run(()=>showDocument('sale',Number(b.dataset.openSale))));
    root.querySelector('#returns-total').textContent=rows.length?`${iconText(rows.length,t('returns'))} · −${money(rows.reduce((sum,r)=>sum+Number(r.total||0),0))}`:t('noData');
  };
  const focusRow=()=>{if(!focus||scrolled)return;const el=root.querySelector('#sales-rows .row-focus');if(!el)return;scrolled=true;el.scrollIntoView({block:'center'});};
  const reload=async()=>{await Promise.all([run(loadSales),run(loadReturns)]);};
  bindDates(root,query=>{range.from=query.from;range.to=query.to;return reload();});
  await reload();
  /* Coming from an invoice shortcut: open that invoice's details straight away. */
  if(focus)await run(()=>showDocument('sale',focus));
}
