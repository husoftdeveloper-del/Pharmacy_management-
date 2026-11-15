import {api,money,escapeHTML as e,dateTime} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,icon,empty,run,modal,table} from '../components/ui.js';
import {showDocument,openReturn} from '../components/documents.js';

/* Returns & Refunds, rebuilt to the approved screen: a heading with the hint
   "Process customer and supplier returns with automatic stock adjustment.",
   two type buttons, one row of search + From + To + New return, and a table of
   Return #, Invoice, Date, Subtotal, Refund, Reason, Recorded by and Actions.
   A return is always created from its invoice, so "New Sale Return" first asks
   which invoice the goods came back from. */
const COLUMNS=['returnNo','invoice','date','subtotal','refund','reason','recordedBy','actions'];

export async function render(root,params={}){
  let kind='sale',rows=[],search='',from='',to='';
  const docType=()=>kind==='sale'?'sale':'purchase';
  const partyKey=()=>kind==='sale'?'customer':'supplier';
  const docIdKey=()=>kind==='sale'?'sale_id':'purchase_id';
  const listType=()=>kind==='sale'?'salereturns':'purchasereturns';
  const returnNumber=row=>`RET-${String(row.id).padStart(4,'0')}`;
  const refundOf=row=>Math.max(0,Number(row.total||0)-Number(row.credit_amount||0));

  root.innerHTML=pageHeader(t('returnsRefunds'),t('returnsHint'))+`<div class="returns-page">
      <div class="tabs returns-types" role="tablist">
        <button class="tab active" role="tab" aria-selected="true" data-kind="sale">${e(t('saleReturn'))}</button>
        <button class="tab" role="tab" aria-selected="false" data-kind="purchase">${e(t('purchaseReturn'))}</button>
      </div>
      <section class="card returns-toolbar">
        <div class="returns-filters">
          <label class="returns-search">${icon('search',18)}<input id="returns-search" type="search" placeholder="${e(t('searchReturnOrInvoice'))}" autocomplete="off" aria-label="${e(t('searchReturnOrInvoice'))}"></label>
          <label class="returns-date"><span>${e(t('from'))}</span><input id="returns-from" type="date" aria-label="${e(t('from'))}"></label>
          <label class="returns-date"><span>${e(t('to'))}</span><input id="returns-to" type="date" aria-label="${e(t('to'))}"></label>
          <button type="button" class="btn btn-primary returns-new" id="new-return">${icon('transfer',16)}<span id="new-return-label">${e(t('newSaleReturn'))}</span></button>
        </div>
      </section>
      <section class="card returns-table-card">
        <div class="returns-table-scroll">
          <table class="returns-table">
            <thead><tr id="returns-head"></tr></thead>
            <tbody id="returns-rows"></tbody>
          </table>
        </div>
        <div id="returns-empty" hidden></div>
      </section>
    </div>`;

  const $=selector=>root.querySelector(selector);

  const matches=row=>{
    const query=search.trim().toLowerCase();
    if(!query)return true;
    return [returnNumber(row),row.invoice_no,row.reason,row.user,row[partyKey()]]
      .filter(Boolean).some(value=>String(value).toLowerCase().includes(query));
  };

  const labels={returnNo:t('returnNo'),invoice:t('invoice'),date:t('date'),subtotal:t('subtotal'),refund:t('refund'),reason:t('reason'),recordedBy:t('recordedBy'),actions:t('actions')};
  const drawHead=()=>{
    $('#returns-head').innerHTML=COLUMNS.map(key=>`<th class="${key==='subtotal'||key==='refund'||key==='actions'?'num':''}">${e(labels[key])}</th>`).join('');
  };

  const draw=()=>{
    const visible=rows.filter(matches);
    $('#returns-rows').innerHTML=visible.map(row=>`<tr data-return="${row.id}">
        <td class="mono positive">${e(returnNumber(row))}</td>
        <td class="mono">${e(row.invoice_no||'')}</td>
        <td class="nowrap">${e(dateTime(row.date))}</td>
        <td class="num">${money(row.total)}</td>
        <td class="num negative">− ${money(refundOf(row))}</td>
        <td class="muted reason-cell">${e(row.reason||'')}</td>
        <td class="nowrap">${e(row.user||'—')}</td>
        <td class="num">${icon('chevron',15)}</td>
      </tr>`).join('');
    const filtered=Boolean(search||from||to);
    $('#returns-empty').hidden=visible.length>0;
    if(!visible.length){
      $('#returns-empty').innerHTML=empty(
        kind==='sale'?t('noSaleReturns'):t('noPurchaseReturns'),
        filtered?t('clearFiltersHint'):t('processReturnHint'),
        'transfer'
      );
    }
    root.querySelectorAll('#returns-rows tr[data-return]').forEach(node=>{
      const row=rows.find(item=>String(item.id)===node.dataset.return);
      node.onclick=()=>run(()=>openRow(row));
    });
  };

  // The dialog shows the original invoice, what came back, and what was refunded.
  const openRow=async row=>{
    const document=await api('document',{type:docType(),id:Number(row[docIdKey()])});
    const sheet=modal(`${returnNumber(row)} · ${document.invoice_no}`,
      `<div class="summary-strip">
         <div><small>${e(t('invoice'))}</small><strong>${e(document.invoice_no)}</strong></div>
         <div><small>${e(t(partyKey()))}</small><strong>${e(document.party?.name||t('walkIn'))}</strong></div>
         <div><small>${e(t('date'))}</small><strong>${e(dateTime(row.date))}</strong></div>
         <div><small>${e(t('subtotal'))}</small><strong>${money(row.total)}</strong></div>
         <div><small>${e(t('refund'))}</small><strong>− ${money(refundOf(row))}</strong></div>
       </div>
       <p class="return-reason"><strong>${e(t('reason'))}:</strong> ${e(row.reason||'')}</p>
       <div class="document-table">${table(['name','quantity','price'],document.items,item=>`<tr><td>${e(item.name)}</td><td>${item.quantity}</td><td>${money(kind==='sale'?item.price:item.cost)}</td></tr>`)}</div>
       <div class="form-footer">
         <button type="button" class="btn btn-secondary" id="return-again"><span>${e(t('return'))}</span></button>
         <button type="button" class="btn btn-primary" data-close><span>${e(t('close'))}</span></button>
       </div>`);
    sheet.root.querySelector('#return-again').onclick=()=>{sheet.close();run(()=>openReturn(docType(),Number(row[docIdKey()]),load));};
  };

  const load=async()=>{
    rows=await api('documents',{type:listType(),from,to});
    $('#new-return-label').textContent=kind==='sale'?t('newSaleReturn'):t('newPurchaseReturn');
    drawHead();
    draw();
  };

  // New return: pick the invoice the goods came from, then the usual return form.
  const pickInvoice=async()=>{
    const invoices=await api('documents',{type:kind==='sale'?'sales':'purchases',limit:200});
    const options=invoices.filter(invoice=>invoice.status!=='cancelled');
    const sheet=modal(kind==='sale'?t('newSaleReturn'):t('newPurchaseReturn'),
      `<label class="field"><span>${e(t('invoice'))}</span><input id="return-invoice-search" type="search" placeholder="${e(t('searchInvoice'))}" autocomplete="off"></label>
       <div class="return-invoice-list" id="return-invoice-list"></div>
       <div class="form-footer"><button type="button" class="btn btn-secondary" data-close><span>${e(t('cancel'))}</span></button></div>`);
    const list=sheet.root.querySelector('#return-invoice-list');
    const paint=query=>{
      const matched=options.filter(invoice=>!query
        ||String(invoice.invoice_no).toLowerCase().includes(query.toLowerCase())
        ||String(invoice.customer||invoice.supplier||'').toLowerCase().includes(query.toLowerCase()));
      list.innerHTML=matched.length?matched.slice(0,60).map(invoice=>`<button type="button" class="return-invoice" data-invoice="${invoice.id}">
          <span class="mono">${e(invoice.invoice_no)}</span>
          <span>${e(invoice.customer||invoice.supplier||t('walkIn'))}</span>
          <span class="nowrap muted">${e(dateTime(invoice.date))}</span>
          <strong>${money(invoice.total)}</strong>
        </button>`).join(''):`<p class="muted return-invoice-empty">${e(t('noInvoicesToReturn'))}</p>`;
      list.querySelectorAll('[data-invoice]').forEach(node=>node.onclick=()=>{
        sheet.close();
        run(()=>openReturn(docType(),Number(node.dataset.invoice),load));
      });
    };
    paint('');
    sheet.root.querySelector('#return-invoice-search').oninput=event=>paint(event.target.value.trim());
  };

  // Wiring -------------------------------------------------------------------
  root.querySelectorAll('[data-kind]').forEach(button=>button.onclick=()=>{
    if(button.dataset.kind===kind)return;
    kind=button.dataset.kind;
    root.querySelectorAll('[data-kind]').forEach(node=>{const active=node===button;node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));});
    return run(load);
  });
  let timer=null;
  $('#returns-search').oninput=()=>{search=$('#returns-search').value;clearTimeout(timer);timer=setTimeout(draw,120);};
  $('#returns-from').onchange=()=>{from=$('#returns-from').value;run(load);};
  $('#returns-to').onchange=()=>{to=$('#returns-to').value;run(load);};
  $('#new-return').onclick=()=>run(pickInvoice);

  await run(load);
  if(params.id)await run(()=>showDocument('sale',Number(params.id)));
  return ()=>clearTimeout(timer);
}
