import {api,state,money,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,pageHeader,button,table,badge,empty,run,toast} from '../components/ui.js';
import {openRecord} from '../components/records.js';
import {openPayment} from '../components/documents.js';
/* Customers: two totals, a wide search box and one table of every customer with
   their phone, email, ledger balance and status. New Customer / Edit reuse the
   shared record form; Payment records money received against that customer. */
export async function render(root,params={}){
  root.innerHTML=pageHeader(t('customers'),'',button(t('newCustomer'),'plus','primary','id="new-customer"'))+
    `<div class="stat-grid customer-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('totalCustomers'))}</span><span class="stat-icon blue">${icon('users',19)}</span></div><div class="stat-value"><span>0</span></div><div class="stat-footer">${icon('users',12)}<span id="active-count"></span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('outstandingCredit'))}</span><span class="stat-icon amber">${icon('wallet',19)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div><div class="stat-footer">${icon('clock',12)}<span>${e(t('creditBalance'))}</span></div></article>
    </div>
    <section class="card">
      <div class="customer-search-bar"><label class="search-field">${icon('search',17)}<input id="customer-search" placeholder="${e(t('searchCustomers'))}" aria-label="${e(t('searchCustomers'))}"></label></div>
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
        <td><div class="inline">
          <button class="btn btn-ghost btn-sm" data-edit="${row.id}">${e(t('edit'))}</button>
          <button class="btn btn-ghost btn-sm" data-payment="${row.id}">${e(t('payment'))}</button>
        </div></td></tr>`)
      :empty(rows.length?t('noData'):t('noCustomers'),rows.length?t('searchCustomers'):t('noCustomersHint'),'users');
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openRecord('customers',rows.find(row=>row.id===Number(b.dataset.edit)),load));
    root.querySelectorAll('[data-payment]').forEach(b=>b.onclick=()=>run(()=>openPayment('customer',rows.find(row=>row.id===Number(b.dataset.payment)),()=>{toast(t('recordSaved'));return load();})));
  };
  const load=async()=>{
    const book=await api('customerBook');
    rows=book.rows||[];
    root.querySelector('.customer-stats .stat-value span').textContent=String(book.totals.customers);
    root.querySelector('#active-count').textContent=`${book.totals.active} ${t('active')}`;
    root.querySelectorAll('.customer-stats .stat-value span')[1].textContent=money(book.totals.outstanding);
    paint();
  };
  root.querySelector('#new-customer').onclick=()=>openRecord('customers',{},load);
  root.querySelector('#customer-search').oninput=ev=>{search=ev.target.value;clearTimeout(timer);timer=setTimeout(paint,180);};
  await run(load);
  return ()=>clearTimeout(timer);
}
