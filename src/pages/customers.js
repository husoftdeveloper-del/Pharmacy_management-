import {api,state,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,pageHeader,button,table,badge,empty,run,toast,modal} from '../components/ui.js';
import {openRecord} from '../components/records.js';
import {openPayment} from '../components/documents.js';
/* Customers: the four money totals every shopkeeper asks for — Total Paid,
   Total Credit Sales, Total Returned and Total Owed — then a wide search box and
   one table of every customer with their phone, email and ledger balance.
   New Customer / Edit reuse the shared record form, the eye opens the customer's
   statement (invoice by invoice with a running balance) and Payment records
   money received against that customer.
   All four totals and every balance come from the server's single customer
   ledger (database/service.js: customerLedger), so a half-paid invoice is counted
   once and opening + credit sales - returned - payments always equals the balance. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('customers'),'',button(t('newCustomer'),'plus','primary','id="new-customer"'))+
    `<div class="stat-grid customer-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalPaid'))}</span><span class="stat-icon">${icon('wallet',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div><div class="stat-footer">${icon('check',12)}<span>${e(t('cashAndBank'))}</span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalCreditSales'))}</span><span class="stat-icon blue">${icon('file',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div><div class="stat-footer">${icon('clock',12)}<span>${e(t('onAccount'))}</span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalReturned'))}</span><span class="stat-icon amber">${icon('transfer',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div><div class="stat-footer">${icon('transfer',12)}<span id="returned-note"></span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalOwed'))}</span><span class="stat-icon red">${icon('clock',19)}</span></div><div class="stat-value negative"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div><div class="stat-footer">${icon('users',12)}<span id="dues-note"></span></div></article>
    </div>
    <section class="card">
      <div class="customer-search-bar"><label class="search-field">${icon('search',17)}<input id="customer-search" placeholder="${e(t('searchCustomers'))}" aria-label="${e(t('searchCustomers'))}"></label><span class="customer-count" id="customer-count"></span></div>
      <div id="customer-rows"></div>
    </section>`;
  let rows=[],search=params.search||'',timer;

  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=term?rows.filter(row=>row.name.toLowerCase().includes(term)||String(row.phone||'').toLowerCase().includes(term)||String(row.email||'').toLowerCase().includes(term)):rows;
    root.querySelector('#customer-rows').innerHTML=visible.length?table(['name','phone','email','creditBalance','status','actions'],visible,row=>`<tr>
        <td><span class="table-name">${e(row.name)}</span>${row.address?`<small class="table-sub">${e(row.address)}</small>`:''}</td>
        <td class="nowrap">${row.phone?e(row.phone):'<span class="muted">—</span>'}</td>
        <td class="muted">${row.email?e(row.email):'—'}</td>
        <td class="nowrap ${row.balance>0?'negative':'positive'}"><strong>${money(row.balance)}</strong></td>
        <td>${badge(row.active?'active':'inactive')}</td>
        <td><div class="row-actions">
          <button class="row-icon" data-statement="${row.id}" title="${e(t('statement'))}" aria-label="${e(t('statement'))} ${e(row.name)}">${icon('file',16)}</button>
          <button class="row-icon" data-edit="${row.id}" title="${e(t('edit'))}" aria-label="${e(t('edit'))} ${e(row.name)}">${icon('pencil',16)}</button>
          <button class="btn btn-ghost btn-sm" data-payment="${row.id}">${e(t('payment'))}</button>
        </div></td></tr>`)
      :empty(rows.length?t('noData'):t('noCustomers'),rows.length?t('searchCustomers'):t('noCustomersHint'),'users');
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openRecord('customers',rows.find(row=>row.id===Number(b.dataset.edit)),load));
    root.querySelectorAll('[data-statement]').forEach(b=>b.onclick=()=>run(()=>openStatement(rows.find(row=>row.id===Number(b.dataset.statement)))));
    root.querySelectorAll('[data-payment]').forEach(b=>b.onclick=()=>run(()=>openPayment('customer',rows.find(row=>row.id===Number(b.dataset.payment)),()=>{toast(t('recordSaved'));return load();})));
  };

  const settleLabel=kind=>kind==='opening'?t('openingBalance'):kind==='sale'?t('invoice'):kind==='return'?t('saleReturn'):t('payment');

  /* The statement: the same four totals for one customer, then every invoice,
     return and payment with the balance after each line. */
  const openStatement=async row=>{
    const statement=await api('customerStatement',{customerId:row.id});
    const totals=statement.totals;
    const card=(label,value,kind,note)=>`<article class="card stat-card statement-card ${kind||''}"><div class="stat-top"><span class="stat-label">${e(label)}</span></div><div class="stat-value"><span>${money(value)}</span><small>${e(state.preferences.currency)}</small></div>${note?`<div class="stat-footer">${e(note)}</div>`:''}</article>`;
    const body=`<div class="statement-head">
        <div><strong>${e(statement.customer.name)}</strong><small>${statement.customer.phone?e(statement.customer.phone):'—'}${statement.customer.email?` · ${e(statement.customer.email)}`:''}</small></div>
        <div class="statement-head-right">${badge(statement.customer.active?'active':'inactive')}${statement.customer.credit_limit>0?`<span class="pill">${e(t('creditLimit'))}: ${money(statement.customer.credit_limit)}</span>`:''}</div>
      </div>
      <div class="stat-grid statement-stats">
        ${card(t('totalPaid'),totals.paid)}
        ${card(t('totalCreditSales'),totals.creditSales)}
        ${card(t('totalReturned'),totals.returned,'',totals.refunded>0?`${t('refund')}: ${money(totals.refunded)}`:'')}
        ${card(t('totalOwed'),totals.owed,'statement-owed')}
      </div>
      <div class="document-table statement-table">${statement.movements.length?table(['date','type','reference','credit','paid','runningBalance'],statement.movements,line=>`<tr>
        <td class="nowrap muted">${line.date?e(dateTime(line.date)):'—'}</td>
        <td class="nowrap">${e(settleLabel(line.kind))}</td>
        <td>${line.reference?e(line.reference):'—'}${line.refund>0?`<small class="table-sub">${e(t('refund'))}: ${money(line.refund)}</small>`:''}${line.note&&line.kind!=='sale'?`<small class="table-sub">${e(line.note)}</small>`:''}</td>
        <td class="nowrap ${line.credit>0?'negative':''}">${line.credit>0?money(line.credit):'—'}</td>
        <td class="nowrap ${line.paid>0?'positive':''}">${line.paid>0?money(line.paid):'—'}</td>
        <td class="nowrap"><strong>${money(line.balance)}</strong></td>
      </tr>`):empty(t('noStatement'),t('noStatementHint'),'file')}</div>
      <div class="summary-strip statement-summary">
        <div><small>${e(t('openingBalance'))}</small><strong>${money(totals.opening)}</strong></div>
        <div><small>${e(t('totalCreditSales'))}</small><strong>${money(totals.creditSales)}</strong></div>
        <div><small>${e(t('totalPaid'))}</small><strong>${money(totals.paid)}</strong></div>
        <div><small>${e(t('totalReturned'))}</small><strong>${money(totals.returned)}</strong></div>
        <div><small>${e(t('balance'))}</small><strong class="${statement.closing>0?'negative':'positive'}">${money(statement.closing)}</strong></div>
      </div>`;
    const m=modal(`${t('statement')} · ${statement.customer.name}`,body,true);
    // One click from the statement straight into a payment for this customer.
    const footer=document.createElement('div');
    footer.className='form-footer statement-footer';
    footer.innerHTML=button(t('payment'),'wallet','primary','id="statement-payment"');
    m.root.querySelector('.modal-body').append(footer);
    footer.querySelector('#statement-payment').onclick=()=>{m.close();run(()=>openPayment('customer',{...row,balance:statement.closing},()=>{toast(t('recordSaved'));return load();}));};
    return m;
  };

  const load=async()=>{
    const book=await api('customerBook');
    rows=book.rows||[];
    const totals=book.totals||{};
    const values=[totals.paid||0,totals.creditSales||0,totals.returned||0,totals.owed||0];
    root.querySelectorAll('.customer-stats .stat-value span').forEach((el,index)=>{el.textContent=money(values[index]);});
    // The two footers keep the boxes honest: what was refunded in cash and how
    // many customers still owe something.
    root.querySelector('#returned-note').textContent=totals.refunded>0?`${t('refund')}: ${money(totals.refunded)}`:`${t('creditNote')}`;
    root.querySelector('#dues-note').textContent=`${totals.withDues||0} ${t('customers')}`;
    root.querySelector('#customer-count').textContent=`${totals.customers||0} ${t('customers')} · ${totals.active||0} ${t('active')}`;
    paint();
  };
  root.querySelector('#new-customer').onclick=()=>openRecord('customers',{},load);
  root.querySelector('#customer-search').oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,180);};
  await run(load);
  return ()=>clearTimeout(timer);
}
