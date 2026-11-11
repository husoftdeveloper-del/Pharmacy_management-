import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,table,badge,run,dateFilters,bindDates,toast} from '../components/ui.js';
import {showDocument,openReturn} from '../components/documents.js';
/* Sales history: every invoice with its payment state and the amount already
   returned. Returns have their own page in the sidebar; a return is created
   from a sale row here (Return) or from an invoice's detail dialog. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('sales'),t('invoice'))+`<section class="card"><div class="filter-bar">${dateFilters()}</div><div id="sales-rows"></div><footer class="table-footer"><span id="sales-total"></span><span class="muted">${e(t('saleReturn'))} → ${e(t('return'))}</span></footer></section>`;
  const range={from:'',to:''};
  let focus=params.id?Number(params.id):0,scrolled=false;
  const load=async()=>{
    const rows=await api('documents',{type:'sales',...range});
    root.querySelector('#sales-rows').innerHTML=table(['invoice','customer','total','paid','date','status','actions'],rows,r=>`<tr${r.id===focus?' class="row-focus"':''}><td class="mono positive">${e(r.invoice_no)}</td><td>${e(r.customer)}</td><td>${money(r.total)}</td><td>${money(r.paid)}</td><td class="nowrap muted">${e(dateTime(r.date))}</td><td>${badge(r.status)}${r.returns>0?` <span class="badge muted">${e(t('returns'))} ${money(r.returns)}</span>`:''}</td><td><div class="inline"><button class="btn btn-ghost btn-sm" data-view="${r.id}">${e(t('view'))}</button><button class="btn btn-ghost btn-sm" data-return="${r.id}">${e(t('return'))}</button><button class="btn btn-ghost btn-sm" data-pdf="${r.id}">PDF</button></div></td></tr>`);
    root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>run(()=>showDocument('sale',Number(b.dataset.view))));
    root.querySelectorAll('[data-return]').forEach(b=>b.onclick=()=>run(()=>openReturn('sale',Number(b.dataset.return),load)));
    root.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>run(async()=>{const result=await api('receipt',{id:Number(b.dataset.pdf)});if(!result.cancelled)toast(result.path);}));
    root.querySelector('#sales-total').textContent=`${rows.length} ${t('invoice')} · ${money(rows.reduce((sum,r)=>sum+Number(r.total||0),0))}`;
    focusRow();
  };
  const focusRow=()=>{if(!focus||scrolled)return;const el=root.querySelector('#sales-rows .row-focus');if(!el)return;scrolled=true;el.scrollIntoView({block:'center'});};
  bindDates(root,query=>{range.from=query.from;range.to=query.to;return load();});
  await run(load);
  /* Coming from an invoice shortcut (dashboard): open that invoice straight away. */
  if(focus)await run(()=>showDocument('sale',focus));
}
