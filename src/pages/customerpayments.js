import {api,state,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,button,table,empty,modal,form,field,bindForm,toast,run,dateFilters,bindDates} from '../components/ui.js';
import {paymentPayload} from '../scripts/payloads.js';
import {bindPaymentAccount} from '../components/payment-fields.js';
/* Customer payments: money received from customers, newest first, with the
   invoices the money was allocated to and who recorded it. Recording a payment
   uses the same secure IPC path as the Finance page (permission `customers`). */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('customerPayments'),t('payment'),button(t('payment'),'wallet','primary','id="record-payment"'))+
    `<section class="card"><div class="filter-bar">${dateFilters()}</div><div id="payment-rows"></div><footer class="table-footer"><span id="payment-total"></span><span class="muted" id="payment-count"></span></footer></section>`;
  const range={from:'',to:''};

  const load=async()=>{
    const rows=await api('documents',{type:'customerpayments',...range});
    root.querySelector('#payment-rows').innerHTML=rows.length?table(['date','customer','amount','method','reference','allocated','record'],rows,r=>`<tr><td class="nowrap muted">${e(dateTime(r.date))}</td><td>${e(r.customer)}</td><td class="positive nowrap">${money(r.amount)}</td><td>${e(t(r.method))}</td><td class="muted">${e(r.reference||'—')}</td><td class="nowrap">${money(r.allocated)}</td><td class="muted">${e(r.user||'—')}</td></tr>`)
      :empty(t('customerPayments'),t('emptyHint'),'wallet');
    const total=rows.reduce((sum,r)=>sum+Number(r.amount||0),0);
    const allocated=rows.reduce((sum,r)=>sum+Number(r.allocated||0),0);
    root.querySelector('#payment-total').innerHTML=`${money(total)} ${e(state.preferences.currency)} ${e(t('paid'))}`;
    root.querySelector('#payment-count').textContent=rows.length?`${rows.length} ${t('payment')} · ${money(allocated)} ${t('invoice')}`:t('noData');
  };

  const openPayment=()=>{
    const m=modal(t('payment'),form(field('party_id','',{options:state.options.customers,required:true})+field('amount','',{type:'number',step:'0.01',required:true})+field('method','cash',{options:['cash','bank'].map(v=>({value:v,label:t(v)})),required:true})+field('account_id','',{options:state.options.accounts,required:true})+field('reference',''),t('payment')));
    bindPaymentAccount(m.root);
    bindForm(m.root,async data=>{await api('payment',{...paymentPayload({...data,party_type:'customer'})});toast(t('recordSaved'));await load();},m.close);
  };
  root.querySelector('#record-payment').onclick=openPayment;
  bindDates(root,query=>{range.from=query.from;range.to=query.to;return load();});
  await run(load);
}
