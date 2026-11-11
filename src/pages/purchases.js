import {api,state,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,table,modal,form,field,bindForm,toast,run,badge,refreshOptions,optionsFor} from '../components/ui.js';
import {openReturn,showDocument} from '../components/documents.js';
import {purchasePayload} from '../scripts/payloads.js';
import {bindPaymentAccount} from '../components/payment-fields.js';

/* Purchases: every received purchase with its supplier, date, total, balance
   due and who recorded it. New Purchase keeps the batch-aware receiving form. */
export async function render(root){
  root.innerHTML=`
    <header class="page-heading purchase-heading">
      <div><h1>${e(t('purchases'))}</h1></div>
      <div class="heading-actions">${button(t('newPurchase'),'plus','primary','id="new-purchase"')}</div>
    </header>
    <section class="card purchase-search-card">
      <label class="purchase-search">${icon('search',18)}<input id="purchase-search" type="search" autocomplete="off" placeholder="${e(t('search'))}" aria-label="${e(t('search'))}"></label>
    </section>
    <section class="card purchase-card">
      <div class="table-scroll"><table class="purchase-table">
        <thead><tr><th>${e(t('invoiceNoShort'))}</th><th>${e(t('supplier'))}</th><th>${e(t('date'))}</th><th>${e(t('total'))}</th><th>${e(t('balanceDue'))}</th><th>${e(t('recordedBy'))}</th><th class="text-end">${e(t('actions'))}</th></tr></thead>
        <tbody id="purchase-rows"></tbody>
      </table></div>
    </section>`;

  let rows=[],search='',timer;
  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=term?rows.filter(row=>[row.invoice_no,row.supplier,row.recorded_by].some(value=>String(value||'').toLowerCase().includes(term))):rows;
    root.querySelector('#purchase-rows').innerHTML=visible.length?visible.map(row=>`<tr>
        <td><span class="mono">${e(row.invoice_no)}</span>${badge(row.status)}</td>
        <td>${row.supplier?e(row.supplier):'<span class="muted">—</span>'}</td>
        <td class="muted nowrap">${e(dateTime(row.date))}</td>
        <td class="nowrap">${money(row.total)}</td>
        <td class="nowrap"><strong class="${row.due>0?'negative':'positive'}">${money(row.due)}</strong></td>
        <td>${row.recorded_by?e(row.recorded_by):'<span class="muted">—</span>'}</td>
        <td class="text-end nowrap"><button class="btn btn-ghost btn-sm" data-view="${row.id}">${e(t('view'))}</button><button class="btn btn-ghost btn-sm" data-return="${row.id}">${e(t('return'))}</button></td>
      </tr>`).join(''):`<tr><td colspan="7" class="purchase-empty-cell"><div class="purchase-empty"><div class="purchase-empty-icon">${icon('clipboard',26)}</div><h3>${e(t(search?'noPurchaseMatch':'noPurchases'))}</h3><p>${e(t('noPurchasesHint'))}</p></div></td></tr>`;
    root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>run(()=>showDocument('purchase',Number(node.dataset.view))));
    root.querySelectorAll('[data-return]').forEach(node=>node.onclick=()=>run(()=>openReturn('purchase',Number(node.dataset.return),load)));
  };
  async function load(){
    const book=await api('purchaseBook');
    rows=book.rows||[];
    paint();
  }
  root.querySelector('#purchase-search').oninput=event=>{search=event.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};

  root.querySelector('#new-purchase').onclick=()=>{
    const m=modal(t('receive'),form(field('supplier_id','',{options:optionsFor('suppliers'),required:true})+field('invoice_no','',{required:true})+`<div class="full"><div class="inline"><h3>${e(t('purchaseItems'))}</h3><span class="spacer"></span><button type="button" class="btn btn-secondary btn-sm" id="add-line">${e(t('addLine'))}</button></div><div class="purchase-lines" id="purchase-lines" style="margin-top:12px"></div></div>`+field('discount',0,{type:'number',step:'0.01'})+field('method','credit',{options:['credit','cash','bank'].map(v=>({value:v,label:t(v)})),required:true})+field('account_id','',{options:state.options.accounts}),t('receive')),true);
    let lineId=0;
    const lines=m.root.querySelector('#purchase-lines');
    const addLine=()=>{
      const div=document.createElement('div');
      div.className='purchase-line';
      div.dataset.line=++lineId;
      div.innerHTML=field('medicine_id','',{options:optionsFor('medicines'),required:true})+field('location_id',1,{options:optionsFor('locations'),required:true})+field('batch_no','',{required:true})+field('expiry','',{type:'date',required:true})+field('quantity',1,{type:'number',required:true})+`<div>${field('cost',0,{type:'number',step:'0.01',required:true})}<button type="button" class="icon-btn" data-remove-line aria-label="${e(t('cancel'))}">${icon('close',15)}</button></div>`;
      lines.append(div);
      div.querySelector('[data-remove-line]').onclick=()=>div.remove();
      div.querySelector('[name="medicine_id"]').onchange=async event=>{
        const medicine=await api('list',{entity:'medicines',search:event.target.selectedOptions[0].textContent});
        const record=medicine.rows.find(row=>row.id===Number(event.target.value));
        if(record)div.querySelector('[name="cost"]').value=record.cost;
      };
    };
    m.root.querySelector('#add-line').onclick=addLine;
    addLine();
    bindPaymentAccount(m.root,{allowCredit:true});
    bindForm(m.root,async data=>{
      const items=[...lines.querySelectorAll('.purchase-line')].map(line=>Object.fromEntries([...line.querySelectorAll('[name]')].map(el=>[el.name,el.value])));
      await api('purchase',purchasePayload(data,items));
      await refreshOptions();
      toast(t('recordSaved'));
      await load();
    },m.close);
  };
  await run(load);
  return ()=>clearTimeout(timer);
}
