import {api,state,money,escapeHTML as e,dateTime,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,run,toast,downloadData} from '../components/ui.js';

/* Ledger & P&L: the profit and loss statement for a date range beside the cash
   movement cards, with a Transactions tab listing every journal entry. */
const firstOfMonth=()=>`${today().slice(0,8)}01`;

export async function render(root){
  root.innerHTML=`
    <header class="page-heading ledger-heading">
      <div><h1>${e(t('ledgerTitle'))}</h1><p>${e(t('ledgerHint'))}</p></div>
      <div class="heading-actions ledger-export">
        <button class="btn btn-secondary" type="button" id="ledger-export">${icon('download',16)}<span>${e(t('export'))}</span>${icon('chevron',14)}</button>
        <div class="ledger-menu" id="ledger-menu" hidden>
          <button type="button" data-export="csv">${e(t('csv'))}</button>
          <button type="button" data-export="pdf">${e(t('pdf'))}</button>
        </div>
      </div>
    </header>
    <section class="card ledger-range">
      <label class="ledger-date"><span>${e(t('from'))}</span><span class="ledger-date-box"><input id="ledger-from" type="date" value="${firstOfMonth()}">${icon('file',15)}</span></label>
      <label class="ledger-date"><span>${e(t('to'))}</span><span class="ledger-date-box"><input id="ledger-to" type="date" value="${today()}">${icon('file',15)}</span></label>
    </section>
    <div class="tabs ledger-tabs" role="tablist">
      <button class="tab active" role="tab" aria-selected="true" data-view="statement">${e(t('plStatement'))}</button>
      <button class="tab" role="tab" aria-selected="false" data-view="transactions">${e(t('transactions'))}</button>
    </div>
    <div class="ledger-layout">
      <section class="card ledger-panel" id="ledger-panel"></section>
      <aside class="ledger-side">
        <article class="card ledger-card"><div class="ledger-card-label">${icon('wallet',15)}<span>${e(t('cashIn'))}</span></div><strong class="positive">${money(0)}</strong></article>
        <article class="card ledger-card"><div class="ledger-card-label">${icon('transfer',15)}<span>${e(t('cashOut'))}</span></div><strong class="negative">${money(0)}</strong></article>
        <article class="card ledger-card"><div class="ledger-card-label">${icon('chart',15)}<span>${e(t('netCashFlow'))}</span></div><strong>${money(0)}</strong></article>
        <article class="card ledger-card"><div class="ledger-card-label">${icon('truck',15)}<span>${e(t('totalPurchases'))}</span></div><strong>${money(0)}</strong></article>
      </aside>
    </div>`;

  let view='statement',data=null;
  const paintStatement=()=>{
    const line=(label,value,kind='')=>`<div class="ledger-line ${kind}"><span>${e(label)}</span><span>${kind==='minus'?'– ':''}${money(Math.abs(value))}</span></div>`;
    const s=data.statement;
    root.querySelector('#ledger-panel').innerHTML=`
      <div class="ledger-panel-head"><h2>${e(t('plStatement'))}</h2><span>${e(data.from)} — ${e(data.to)}</span></div>
      <div class="ledger-block">
        ${line(t('salesRevenue'),s.salesRevenue)}
        ${line(t('lessSaleReturns'),s.saleReturns,'minus')}
        <div class="ledger-line ledger-strong"><span>${e(t('netRevenue'))}</span><span>${money(s.netRevenue)}</span></div>
      </div>
      <div class="ledger-block">
        ${line(t('cogs'),s.cogs,'minus')}
        ${line(t('addCogsReturned'),s.cogsReturned,'plus')}
        <div class="ledger-line ledger-strong"><span>${e(t('netCogs'))}</span><span>– ${money(Math.abs(s.netCogs))}</span></div>
      </div>
      <div class="ledger-block">
        ${line(t('operatingExpenses'),s.expenses,'minus')}
        <div class="ledger-line ledger-total"><span>${e(t('netProfit'))}</span><span>${money(s.netProfit)}</span></div>
      </div>`;
  };
  const paintCash=()=>{
    const c=data.cash;
    const cards=root.querySelectorAll('.ledger-card strong');
    cards[0].textContent=money(c.cashIn);
    cards[1].textContent=money(c.cashOut);
    cards[2].textContent=`${c.netCashFlow<0?'-':''}${money(Math.abs(c.netCashFlow))}`;
    cards[2].className=c.netCashFlow<0?'negative':'';
    cards[3].textContent=money(c.totalPurchases);
  };
  const paintTransactions=()=>{
    const rows=data.transactions;
    root.querySelector('#ledger-panel').innerHTML=`
      <div class="ledger-panel-head"><h2>${e(t('transactions'))}</h2><span>${rows.length} ${t('entries')}</span></div>
      ${rows.length?`<div class="table-scroll"><table class="ledger-table"><thead><tr><th>${e(t('date'))}</th><th>${e(t('description'))}</th><th>${e(t('reference'))}</th><th>${e(t('recordedBy'))}</th><th class="text-end">${e(t('amount'))}</th></tr></thead><tbody>${rows.map(row=>`<tr><td class="nowrap muted">${e(dateTime(row.date))}</td><td>${e(row.description)}</td><td class="mono">${e(row.reference||'—')}</td><td class="muted">${e(row.user||'—')}</td><td class="text-end nowrap">${money(row.amount)}</td></tr>`).join('')}</tbody></table></div>`
      :`<div class="ledger-empty"><div class="ledger-empty-icon">${icon('clipboard',24)}</div><h3>${e(t('noTransactions'))}</h3><p>${e(t('noTransactionsHint'))}</p></div>`}`;
  };
  const paint=()=>{paintCash();view==='statement'?paintStatement():paintTransactions();};

  const load=async()=>{
    data=await api('ledgerBook',{from:root.querySelector('#ledger-from').value,to:root.querySelector('#ledger-to').value});
    paint();
  };
  const setView=next=>{
    view=next;
    root.querySelectorAll('[data-view]').forEach(node=>{const active=node.dataset.view===next;node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));});
    paint();
  };
  root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>setView(node.dataset.view));
  root.querySelector('#ledger-from').onchange=()=>run(load);
  root.querySelector('#ledger-to').onchange=()=>run(load);

  const menu=root.querySelector('#ledger-menu');
  root.querySelector('#ledger-export').onclick=()=>{menu.hidden=!menu.hidden;};
  root.querySelector('[data-export=csv]').onclick=()=>{
    menu.hidden=true;
    if(!data)return;
    const rows=[[t('from'),data.from],[t('to'),data.to],[t('salesRevenue'),data.statement.salesRevenue],[t('lessSaleReturns'),data.statement.saleReturns],[t('netRevenue'),data.statement.netRevenue],[t('cogs'),data.statement.cogs],[t('netCogs'),data.statement.netCogs],[t('operatingExpenses'),data.statement.expenses],[t('netProfit'),data.statement.netProfit],[t('cashIn'),data.cash.cashIn],[t('cashOut'),data.cash.cashOut],[t('netCashFlow'),data.cash.netCashFlow],[t('totalPurchases'),data.cash.totalPurchases]];
    downloadData(`pharmacy-ledger-${data.from}-${data.to}.csv`,[`"Item","${data.currency}"`,...rows.map(([label,value])=>`"${String(label).replaceAll('"','""')}",${value}`)].join('\r\n'));
    toast(t('download'));
  };
  root.querySelector('[data-export=pdf]').onclick=()=>{
    menu.hidden=true;
    run(async()=>{
      const result=await api('pdf',{kind:'profit',from:root.querySelector('#ledger-from').value,to:root.querySelector('#ledger-to').value});
      if(!result.cancelled)toast(result.path);
    });
  };
  const outside=event=>{if(!event.target.closest('.ledger-export'))menu.hidden=true;};
  document.addEventListener('click',outside);
  await run(load);
  return ()=>{menu.hidden=true;document.removeEventListener('click',outside);};
}
