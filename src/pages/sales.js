import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,icon,empty,run} from '../components/ui.js';
import {showDocument} from '../components/documents.js';

/* Sales history, rebuilt to the approved screen: a search field and a period
   picker on one row with the sale count and total underneath, then one table of
   Invoice #, Date, Subtotal, Discount, Total, Paid, Balance, Recorded by and
   Actions. The invoice preview stays available from Actions, and Returns keeps
   its own page in the sidebar. */
const PERIODS=[
  {key:'today',days:1,label:'today'},
  {key:'7',days:7,label:'last7Days'},
  {key:'30',days:30,label:'last30Days'},
  {key:'90',days:90,label:'last90Days'},
  {key:'all',days:0,label:'allTime'}
];
const isoDay=date=>date.toISOString().slice(0,10);
const periodRange=key=>{
  const period=PERIODS.find(item=>item.key===key)||PERIODS[2];
  if(!period.days)return {from:'',to:''};
  const end=new Date();
  const start=new Date();
  start.setDate(end.getDate()-(period.days-1));
  return {from:isoDay(start),to:isoDay(end)};
};

export async function render(root,params={}){
  let period='30',search='',rows=[],focus=params.id?Number(params.id):0,scrolled=false;
  root.innerHTML=pageHeader(t('sales'))+`<div class="sales-history">
      <section class="card sales-toolbar">
        <div class="sales-filters">
          <label class="sales-search">${icon('search',18)}<input id="sales-search" type="search" placeholder="${e(t('searchInvoice'))}" autocomplete="off" aria-label="${e(t('searchInvoice'))}"></label>
          <select id="sales-period" class="sales-period" aria-label="${e(t('period'))}">
            ${PERIODS.map(item=>`<option value="${item.key}" ${item.key===period?'selected':''}>${e(t(item.label))}</option>`).join('')}
          </select>
        </div>
        <p class="sales-summary"><span>${e(t('salesCount'))}: <strong id="sales-count">0</strong></span><span>${e(t('total'))}: <strong id="sales-sum">0.00</strong></span></p>
      </section>
      <section class="card sales-table-card">
        <div class="sales-table-scroll">
          <table class="sales-table">
            <thead><tr>
              <th>${e(t('invoiceNoShort'))}</th>
              <th>${e(t('date'))}</th>
              <th class="num">${e(t('subtotal'))}</th>
              <th class="num">${e(t('discount'))}</th>
              <th class="num">${e(t('total'))}</th>
              <th class="num">${e(t('paid'))}</th>
              <th class="num">${e(t('balance'))}</th>
              <th>${e(t('recordedBy'))}</th>
              <th class="num">${e(t('actions'))}</th>
            </tr></thead>
            <tbody id="sales-rows"></tbody>
          </table>
        </div>
        <div id="sales-empty" hidden></div>
      </section>
    </div>`;

  const $=selector=>root.querySelector(selector);
  const matches=row=>{
    const query=search.trim().toLowerCase();
    if(!query)return true;
    return [row.invoice_no,row.customer,row.user].filter(Boolean).some(value=>String(value).toLowerCase().includes(query));
  };

  const draw=()=>{
    const visible=rows.filter(matches);
    $('#sales-count').textContent=visible.length;
    $('#sales-sum').textContent=money(visible.reduce((sum,row)=>sum+Number(row.total||0),0));
    $('#sales-rows').innerHTML=visible.map(row=>{
      const balance=Math.max(0,Number(row.total||0)-Number(row.paid||0)-Number(row.returns||0));
      return `<tr data-sale="${row.id}"${row.id===focus?' class="row-focus"':''}>
        <td class="mono positive">${e(row.invoice_no)}</td>
        <td class="nowrap">${e(dateTime(row.date))}</td>
        <td class="num">${money(row.subtotal)}</td>
        <td class="num">${money(row.discount)}</td>
        <td class="num strong">${money(row.total)}</td>
        <td class="num">${money(row.paid)}</td>
        <td class="num">${balance>0.005?money(balance):`<span class="muted">${e(t('settled'))}</span>`}</td>
        <td class="nowrap">${e(row.user||'—')}</td>
        <td class="num">${icon('chevron',15)}</td>
      </tr>`;
    }).join('');
    $('#sales-empty').hidden=visible.length>0;
    $('#sales-empty').innerHTML=visible.length?'':empty(search?t('posNoResults'):t('noSalesYet'),search?t('emptyHint'):t('completedSalesHere'),'file');
    // A whole row opens the invoice; returns and the PDF are buttons inside the
    // invoice dialog, so the table keeps the nine columns of the design.
    root.querySelectorAll('#sales-rows tr[data-sale]').forEach(node=>{
      node.onclick=()=>run(()=>showDocument('sale',Number(node.dataset.sale)));
    });
    if(focus&&!scrolled){
      const target=root.querySelector('#sales-rows .row-focus');
      if(target){scrolled=true;target.scrollIntoView({block:'center'});}
    }
  };

  const load=async(first=false)=>{
    const range=periodRange(period);
    rows=await api('documents',{type:'sales',...range});
    draw();
    if(first&&focus)await run(()=>showDocument('sale',focus));
  };

  let timer=null;
  $('#sales-search').oninput=()=>{search=$('#sales-search').value;clearTimeout(timer);timer=setTimeout(draw,120);};
  $('#sales-period').onchange=()=>{period=$('#sales-period').value;run(()=>load());};
  await run(()=>load(true));
  return ()=>clearTimeout(timer);
}

