import {api,state,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,pageHeader,button,table,badge,empty,modal,form,field,bindForm,toast,run,refreshOptions} from '../components/ui.js';
import {paymentPayload} from '../scripts/payloads.js';
import {bindPaymentAccount} from '../components/payment-fields.js';
/* Customer payments: four totals, then either the customer balances
   (Balances) or every recorded payment (History). Recording a payment uses the
   same secure IPC path as the Finance page; the server needs `customers`. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('customerPayments'),t('customerPaymentsHint'),button(t('recordPayment'),'plus','primary','id="record-payment"'))+
    `<div class="stat-grid payment-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalCreditSales'))}</span><span class="stat-icon blue">${icon('file',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalPaid'))}</span><span class="stat-icon">${icon('wallet',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalReturned'))}</span><span class="stat-icon amber">${icon('transfer',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalOwed'))}</span><span class="stat-icon red">${icon('clock',19)}</span></div><div class="stat-value negative"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab active" role="tab" aria-selected="true" data-view="balances">${icon('clipboard',15)}<span>${e(t('customerBalances'))}</span></button>
      <button class="tab" role="tab" aria-selected="false" data-view="history">${icon('clock',15)}<span>${e(t('history'))}</span></button>
    </div>
    <section class="card">
      <div class="table-toolbar payment-toolbar">
        <label class="search-field">${icon('search',17)}<input id="customer-search" placeholder="${e(t('searchCustomer'))}" aria-label="${e(t('searchCustomer'))}"></label>
        <label class="dues-toggle"><input type="checkbox" id="only-dues"><span class="toggle-track"><span class="toggle-dot"></span></span><span>${e(t('onlyWithDues'))}</span></label>
      </div>
      <div id="payment-body"></div>
    </section>`;
  let view='balances',search='',onlyDues=false,accounts=null,history=[];

  const paintTotals=()=>{
    const totals=accounts?.totals||{creditSales:0,paid:0,returned:0,owed:0};
    const values=[totals.creditSales,totals.paid,totals.returned,totals.owed];
    root.querySelectorAll('.payment-stats .stat-value span').forEach((el,index)=>{el.textContent=money(values[index]);});
  };

  const loadBalances=async()=>{
    accounts=await api('customerAccounts',{});
    paintTotals();
    const term=search.trim().toLowerCase();
    const rows=(accounts.rows||[]).filter(row=>(!term||row.name.toLowerCase().includes(term)||String(row.phone||'').includes(term))&&(!onlyDues||row.balance>0));
    root.querySelector('#payment-body').innerHTML=rows.length?table(['name','creditSales','paid','returned','balance','lastPayment'],rows,row=>`<tr><td><span class="table-name">${e(row.name)}</span>${row.phone?`<small class="table-sub">${e(row.phone)}</small>`:''}</td><td class="nowrap">${money(row.creditSales)}</td><td class="nowrap">${money(row.paid)}</td><td class="nowrap">${money(row.returned)}</td><td class="nowrap ${row.balance>0?'negative':'positive'}"><strong>${money(row.balance)}</strong></td><td class="nowrap muted">${row.lastPayment?e(dateTime(row.lastPayment)):'—'}</td></tr>`)
      :(accounts.rows||[]).length===0?empty(t('noCustomerBalances'),t('noCustomerBalancesHint'),'users'):empty(t('noData'),t('onlyWithDues'),'users');
  };

  const loadHistory=async()=>{
    history=await api('documents',{type:'customerpayments'});
    const rows=search.trim()?history.filter(row=>row.customer.toLowerCase().includes(search.trim().toLowerCase())):history;
    root.querySelector('#payment-body').innerHTML=rows.length?table(['date','customer','amount','method','reference','allocated','record'],rows,row=>`<tr><td class="nowrap muted">${e(dateTime(row.date))}</td><td>${e(row.customer)}</td><td class="positive nowrap">${money(row.amount)}</td><td>${e(t(row.method))}</td><td class="muted">${row.reference?e(row.reference):'—'}</td><td class="nowrap">${money(row.allocated)}</td><td class="muted">${e(row.user||'—')}</td></tr>`)
      :empty(t('noData'),t('customerPaymentsHint'),'wallet');
  };

  const load=()=>view==='balances'?loadBalances():loadHistory();

  const setView=next=>{
    view=next;
    root.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===next;el.classList.toggle('active',active);el.setAttribute('aria-selected',String(active));});
    root.querySelector('.dues-toggle').classList.toggle('is-hidden',next!=='balances');
    return run(load);
  };
  root.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>setView(el.dataset.view));

  let timer;
  root.querySelector('#customer-search').oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(()=>run(load),200);};
  root.querySelector('#only-dues').onchange=ev=>{onlyDues=ev.target.checked;run(load);};

  const openPayment=()=>{
    const m=modal(t('recordPayment'),form(field('party_id','',{options:state.options.customers,required:true})+field('amount','',{type:'number',step:'0.01',required:true})+field('method','cash',{options:['cash','bank'].map(v=>({value:v,label:t(v)})),required:true})+field('account_id','',{options:state.options.accounts,required:true})+field('reference',''),t('payment')));
    bindPaymentAccount(m.root);
    bindForm(m.root,async data=>{await api('payment',{...paymentPayload({...data,party_type:'customer'})});toast(t('recordSaved'));await load();},m.close);
  };
  root.querySelector('#record-payment').onclick=()=>run(async()=>{await refreshOptions();openPayment();});
  await run(load);
  return ()=>clearTimeout(timer);
}
