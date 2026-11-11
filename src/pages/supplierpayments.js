import {api,state,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,table,empty,modal,form,field,bindForm,toast,run,refreshOptions} from '../components/ui.js';
import {paymentPayload} from '../scripts/payloads.js';
import {bindPaymentAccount} from '../components/payment-fields.js';

/* Supplier payments: four totals, then either the supplier balances (Balances)
   or every payment sent to a supplier (History). Recording a payment uses the
   same secure IPC path as the Finance page. */
export async function render(root){
  root.innerHTML=`
    <header class="page-heading supplierpay-heading">
      <div><h1>${e(t('supplierPayments'))}</h1><p>${e(t('supplierPaymentsHint'))}</p></div>
      <div class="heading-actions">${button(t('recordPayment'),'plus','primary','id="record-supplier-payment"')}</div>
    </header>
    <div class="stat-grid supplierpay-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalPurchased'))}</span><span class="stat-icon blue">${icon('truck',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalPaid'))}</span><span class="stat-icon">${icon('wallet',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalCredited'))}</span><span class="stat-icon amber">${icon('transfer',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalOwed'))}</span><span class="stat-icon red">${icon('clock',19)}</span></div><div class="stat-value negative"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab active" role="tab" aria-selected="true" data-view="balances">${icon('clipboard',15)}<span>${e(t('supplierBalances'))}</span></button>
      <button class="tab" role="tab" aria-selected="false" data-view="history">${icon('clock',15)}<span>${e(t('history'))}</span></button>
    </div>
    <section class="card">
      <div class="table-toolbar supplierpay-toolbar">
        <label class="search-field">${icon('search',17)}<input id="supplier-search" placeholder="${e(t('searchSupplier'))}" aria-label="${e(t('searchSupplier'))}"></label>
        <label class="dues-toggle"><input type="checkbox" id="only-dues"><span class="toggle-track"><span class="toggle-dot"></span></span><span>${e(t('onlyWithDues'))}</span></label>
      </div>
      <div id="supplierpay-body"></div>
    </section>`;

  let view='balances',search='',onlyDues=false,accounts=null,timer;

  const paintTotals=()=>{
    const totals=accounts?.totals||{purchased:0,paid:0,credited:0,owed:0};
    const values=[totals.purchased,totals.paid,totals.credited,totals.owed];
    root.querySelectorAll('.supplierpay-stats .stat-value span').forEach((node,index)=>{node.textContent=money(values[index]);});
  };

  const payButton=row=>`<button class="btn btn-secondary btn-sm" data-pay="${row.id}">${icon('wallet',14)}<span>${e(t('pay'))}</span></button>`;

  const loadBalances=async()=>{
    accounts=await api('supplierAccounts',{});
    paintTotals();
    const term=search.trim().toLowerCase();
    const rows=(accounts.rows||[]).filter(row=>(!term||row.name.toLowerCase().includes(term)||String(row.phone||'').includes(term))&&(!onlyDues||row.balance>0));
    root.querySelector('#supplierpay-body').innerHTML=rows.length?`<div class="table-scroll"><table class="supplierpay-table">
        <thead><tr><th>${e(t('supplierName'))}</th><th>${e(t('purchased'))}</th><th>${e(t('paid'))}</th><th>${e(t('credited'))}</th><th>${e(t('balance'))}</th><th>${e(t('lastPayment'))}</th><th></th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td><span class="table-name">${e(row.name)}</span>${row.contact?`<small class="table-sub">${e(row.contact)}</small>`:''}</td>
          <td class="nowrap">${money(row.purchased)}</td>
          <td class="nowrap positive">${money(row.paid)}</td>
          <td class="nowrap">${money(row.credited)}</td>
          <td class="nowrap"><span class="balance-pill ${row.balance>0?'due':''}">${money(row.balance)}</span></td>
          <td class="muted nowrap">${row.lastPayment?e(dateTime(row.lastPayment)):'—'}</td>
          <td class="text-end">${payButton(row)}</td>
        </tr>`).join('')}</tbody></table></div>`
      :(accounts.rows||[]).length===0?empty(t('noSupplierBalances'),t('noSupplierBalancesHint'),'truck'):empty(t('noData'),t('onlyWithDues'),'truck');
    root.querySelectorAll('[data-pay]').forEach(node=>node.onclick=()=>openSupplierPayment(Number(node.dataset.pay)));
  };

  const loadHistory=async()=>{
    const history=await api('documents',{type:'supplierpayments'});
    const term=search.trim().toLowerCase();
    const rows=term?history.filter(row=>String(row.supplier||'').toLowerCase().includes(term)):history;
    root.querySelector('#supplierpay-body').innerHTML=rows.length?table(['date','supplier','amount','method','reference','allocated','record'],rows,row=>`<tr><td class="nowrap muted">${e(dateTime(row.date))}</td><td>${e(row.supplier)}</td><td class="positive nowrap">${money(row.amount)}</td><td>${e(t(row.method))}</td><td class="muted">${row.reference?e(row.reference):'—'}</td><td class="nowrap">${money(row.allocated)}</td><td class="muted">${e(row.user||'—')}</td></tr>`)
      :empty(t('noData'),t('supplierPaymentsHint'),'wallet');
  };

  const load=()=>view==='balances'?loadBalances():loadHistory();

  const setView=next=>{
    view=next;
    root.querySelectorAll('[data-view]').forEach(node=>{const active=node.dataset.view===next;node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));});
    root.querySelector('.dues-toggle').classList.toggle('is-hidden',next!=='balances');
    return run(load);
  };
  root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>setView(node.dataset.view));

  root.querySelector('#supplier-search').oninput=event=>{search=event.target.value;clearTimeout(timer);timer=setTimeout(()=>run(load),200);};
  root.querySelector('#only-dues').onchange=event=>{onlyDues=event.target.checked;run(load);};

  function openSupplierPayment(supplierId){
    const suppliers=state.options.suppliers||[];
    const m=modal(t('recordPayment'),form(field('party_id',supplierId||'',{options:suppliers,required:true})+field('amount','',{type:'number',step:'0.01',required:true})+field('method','cash',{options:['cash','bank'].map(value=>({value,label:t(value)})),required:true})+field('account_id','',{options:state.options.accounts,required:true})+field('reference',''),t('payment')));
    bindPaymentAccount(m.root);
    bindForm(m.root,async data=>{
      await api('payment',{...paymentPayload({...data,party_type:'supplier'})});
      toast(t('recordSaved'));
      await load();
    },m.close);
  }
  root.querySelector('#record-supplier-payment').onclick=()=>run(async()=>{await refreshOptions();openSupplierPayment();});
  await run(load);
  return ()=>clearTimeout(timer);
}
