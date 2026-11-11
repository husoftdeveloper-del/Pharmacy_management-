import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,toast,run,badge,modal,form,field,bindForm,refreshOptions} from '../components/ui.js';
import {openRecord} from '../components/records.js';
import {openPayment} from '../components/documents.js';

/* Suppliers: contact person, phone, how many purchases were received, what was
   spent, the last purchase date and whether the supplier is active. Payments to
   a supplier open the same secure payment dialog as the Finance page. */
export async function render(root){
  root.innerHTML=`
    <header class="page-heading supplier-heading">
      <div><h1>${e(t('suppliers'))}</h1></div>
      <div class="heading-actions">${button(t('newSupplier'),'plus','primary','id="new-supplier"')}</div>
    </header>
    <section class="card supplier-search-card">
      <label class="supplier-search">${icon('search',18)}<input id="supplier-search" type="search" autocomplete="off" placeholder="${e(t('search'))}" aria-label="${e(t('search'))}"></label>
    </section>
    <section class="card supplier-card">
      <div class="table-scroll"><table class="supplier-table">
        <thead><tr><th>${e(t('supplierName'))}</th><th>${e(t('contactPerson'))}</th><th>${e(t('phone'))}</th><th>${e(t('purchasesCount'))}</th><th>${e(t('totalSpent'))}</th><th>${e(t('lastPurchase'))}</th><th>${e(t('status'))}</th><th class="text-end">${e(t('actions'))}</th></tr></thead>
        <tbody id="supplier-rows"></tbody>
      </table></div>
    </section>`;

  let rows=[],search='',timer;
  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=term?rows.filter(row=>[row.name,row.contact_person,row.phone].some(value=>String(value||'').toLowerCase().includes(term))):rows;
    root.querySelector('#supplier-rows').innerHTML=visible.length?visible.map(row=>`<tr>
        <td><span class="table-name">${e(row.name)}</span></td>
        <td>${row.contact_person?e(row.contact_person):'<span class="muted">—</span>'}</td>
        <td class="nowrap">${row.phone?e(row.phone):'<span class="muted">—</span>'}</td>
        <td>${row.purchases}</td>
        <td class="nowrap">${money(row.spent)}</td>
        <td class="muted nowrap">${row.last_purchase?e(dateTime(row.last_purchase)):'—'}</td>
        <td>${badge(Number(row.active)?'active':'inactive')}</td>
        <td class="text-end nowrap"><button class="btn btn-ghost btn-sm" data-payment="${row.id}">${icon('wallet',14)}<span>${e(t('payment'))}</span></button><button class="btn btn-ghost btn-sm" data-edit="${row.id}">${icon('settings',14)}<span>${e(t('edit'))}</span></button></td>
      </tr>`).join(''):`<tr><td colspan="8" class="supplier-empty-cell"><div class="supplier-empty"><div class="supplier-empty-icon">${icon('truck',26)}</div><h3>${e(t(search?'noSupplierMatch':'noSuppliers'))}</h3><p>${e(t('noSuppliersHint'))}</p></div></td></tr>`;
    root.querySelectorAll('[data-edit]').forEach(node=>node.onclick=()=>openRecord('suppliers',rows.find(row=>row.id===Number(node.dataset.edit)),load));
    root.querySelectorAll('[data-payment]').forEach(node=>node.onclick=()=>run(async()=>{
      const data=await api('list',{entity:'suppliers',limit:200});
      const supplier=data.rows.find(row=>row.id===Number(node.dataset.payment));
      openPayment('supplier',supplier,()=>run(load));
    }));
  };
  async function load(){
    const book=await api('supplierBook');
    rows=book.rows||[];
    paint();
  }
  root.querySelector('#supplier-search').oninput=event=>{search=event.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  root.querySelector('#new-supplier').onclick=()=>{
    const m=modal(t('newSupplier'),form(field('name','',{required:true})+field('contact_person','')+field('phone','')+field('address','',{type:'textarea'})+field('opening_balance',0,{type:'number',step:'0.01'})+field('active',1,{type:'checkbox'}),t('save')));
    bindForm(m.root,async data=>{
      await api('save',{entity:'suppliers',record:{...data,opening_balance:Number(data.opening_balance)||0,active:Number(data.active)||0}});
      await refreshOptions();
      toast(t('recordSaved'));
      await load();
    },m.close);
  };
  await run(load);
  return ()=>clearTimeout(timer);
}
