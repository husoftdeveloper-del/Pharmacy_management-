import {api,state,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,toast,run,modal,refreshOptions,optionsFor} from '../components/ui.js';
import {playSaleSound} from '../scripts/alerts.js';

/* Point of sale, rebuilt to the approved screen: one search field over a cart
   table on the left, and a single Total card on the right holding the discount,
   the customer, the paid amount and Complete Sale. Extra options (payment
   method, patient, prescription, offer) live in a collapsed "More details" row
   so the everyday screen stays as clean as the design. */
export async function render(root){
  let products=[],cart=[],busy=false,timer=null,offers=[],prescriptions=[],paidTouched=false,lastTotal=0;
  const currency=()=>state.preferences.currency||'AFN';
  const lang=()=>document.documentElement.lang||'en';
  const amount=value=>new Intl.NumberFormat(lang(),{minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value)||0);
  const cashLabel=value=>`${currency()} ${amount(value)}`;
  const optionList=(items,selected,placeholder)=>`<option value="">${e(placeholder)}</option>`+items.map(item=>`<option value="${item.id}" ${String(item.id)===String(selected)?'selected':''}>${e(item.name)}</option>`).join('');

  root.innerHTML=`<header class="page-heading pos-heading">
      <div><h1>${e(t('posTitle'))}</h1></div>
      <div class="heading-actions"><button type="button" class="btn btn-secondary" id="pos-shortcuts">${icon('grid',16)}<span>${e(t('shortcutsTitle'))}</span></button></div>
    </header>
    <div class="pos-layout pos-screen">
      <section class="pos-left">
        <div class="pos-search-wrap">
          <label class="pos-search">${icon('search',19)}<input id="product-search" placeholder="${e(t('scan'))}" autocomplete="off" aria-label="${e(t('scan'))}" aria-controls="pos-results" aria-expanded="false"></label>
          <div class="pos-results" id="pos-results" role="listbox" hidden></div>
        </div>
        <section class="card pos-cart" aria-label="${e(t('cart'))}">
          <header class="pos-cart-head">${icon('cart',18)}<h2>${e(t('cart'))}</h2><span class="pos-count" id="cart-count">0</span></header>
          <div class="pos-table-head"><span>${e(t('item'))}</span><span>${e(t('qty'))}</span><span>${e(t('price'))}</span><span>${e(t('total'))}</span><span></span></div>
          <div class="pos-cart-body" id="cart-items"></div>
        </section>
      </section>
      <aside class="card pos-total" aria-label="${e(t('total'))}">
        <h2>${e(t('total'))}</h2>
        <div class="pos-subtotal"><span>${e(t('subtotal'))}</span><strong id="pos-subtotal">${e(cashLabel(0))}</strong></div>
        <label class="pos-field" for="pos-discount"><span>${e(t('discount'))}</span><input id="pos-discount" type="number" min="0" step="0.01" value="0" inputmode="decimal"></label>
        <label class="pos-field" for="pos-customer"><span>${e(t('customer'))}</span><select id="pos-customer"></select></label>
        <label class="pos-field" for="pos-paid"><span>${e(t('paidAmount'))}</span><input id="pos-paid" type="number" min="0" step="0.01" value="0" inputmode="decimal"></label>
        <p class="pos-hint" id="pos-hint">${e(t('posWalkInHint'))}</p>
        <div class="pos-grand"><span>${e(t('total'))}</span><strong id="pos-total">${e(cashLabel(0))}</strong></div>
        <button type="button" class="btn btn-primary pos-complete" id="checkout" disabled>${e(t('checkout'))}</button>
        <details class="pos-more" id="pos-more">
          <summary>${e(t('moreDetails'))}</summary>
          <div class="pos-more-grid">
            <label class="pos-field" for="pos-method"><span>${e(t('method'))}</span><select id="pos-method"><option value="cash">${e(t('cash'))}</option><option value="bank">${e(t('bank'))}</option><option value="credit">${e(t('credit'))}</option></select></label>
            <label class="pos-field" for="pos-account"><span>${e(t('account'))}</span><select id="pos-account"></select></label>
            <label class="pos-field" for="pos-patient"><span>${e(t('patient'))}</span><select id="pos-patient"></select></label>
            <label class="pos-field" for="pos-prescription"><span>${e(t('prescription'))}</span><select id="pos-prescription"></select></label>
            <label class="pos-field" for="pos-offer"><span>${e(t('offer'))}</span><select id="pos-offer"></select></label>
          </div>
          <p class="pos-rx-note" id="pos-rx-note" hidden>${e(t('posRxNotice'))}</p>
        </details>
      </aside>
    </div>`;

  const $=selector=>root.querySelector(selector);

  const discountValue=()=>Math.max(0,Number($('#pos-discount').value)||0);
  const offerValue=subtotal=>{
    const offer=offers.find(item=>String(item.id)===$('#pos-offer').value);
    if(!offer)return 0;
    return offer.kind==='percent'?subtotal*Number(offer.value)/100:Number(offer.value)||0;
  };
  const totals=()=>{
    const subtotal=cart.reduce((sum,line)=>sum+line.price*line.quantity,0);
    const discount=Math.min(subtotal,Math.max(discountValue(),offerValue(subtotal)));
    const tax=Math.round((subtotal-discount)*(Number(state.preferences.tax_percent)||0))/100;
    return {subtotal,discount,tax,total:Math.max(0,subtotal-discount+tax)};
  };
  const walkIn=()=>!$('#pos-customer').value;

  // The cart table: one line per medicine with the quantity stepper, unit price
  // and the line total, exactly as the design's Item / Qty / Price / Total row.
  const drawCart=()=>{
    const lines=$('#cart-items');
    $('#cart-count').textContent=cart.reduce((sum,line)=>sum+line.quantity,0);
    lines.innerHTML=cart.length?cart.map((line,index)=>`<div class="cart-item">
        <div class="cart-item-name"><strong>${e(line.name)}</strong><small>${e(line.sku||'')}${line.sku?' · ':''}${line.stock} ${e(t('available'))}</small></div>
        <div class="quantity-control"><button type="button" data-minus="${index}" aria-label="${e(t('decrease'))}">−</button><span>${line.quantity}</span><button type="button" data-plus="${index}" aria-label="${e(t('increase'))}" ${line.quantity>=line.stock?'disabled':''}>+</button></div>
        <div class="cart-price">${e(amount(line.price))}</div>
        <div class="cart-line-total">${e(amount(line.price*line.quantity))}</div>
        <button type="button" class="icon-btn cart-remove" data-remove="${index}" aria-label="${e(t('remove'))}" title="${e(t('remove'))}">${icon('close',14)}</button>
      </div>`).join(''):`<div class="pos-empty">${e(t('posCartEmpty'))}</div>`;
    lines.querySelectorAll('[data-remove]').forEach(node=>node.onclick=()=>{cart.splice(Number(node.dataset.remove),1);paidTouched=false;drawCart();});
    lines.querySelectorAll('[data-minus]').forEach(node=>node.onclick=()=>{
      const line=cart[Number(node.dataset.minus)];
      line.quantity-=1;
      if(line.quantity<=0)cart.splice(Number(node.dataset.minus),1);
      paidTouched=false;drawCart();
    });
    lines.querySelectorAll('[data-plus]').forEach(node=>node.onclick=()=>{
      const line=cart[Number(node.dataset.plus)];
      if(line.quantity<line.stock)line.quantity+=1;
      paidTouched=false;drawCart();
    });
    const totalsNow=totals();
    $('#pos-subtotal').textContent=cashLabel(totalsNow.subtotal);
    $('#pos-total').textContent=cashLabel(totalsNow.total);
    const paidInput=$('#pos-paid');
    const creditSale=$('#pos-method').value==='credit';
    if(creditSale){paidTouched=true;paidInput.value='0';}
    else if(!paidTouched||Number(paidInput.value)===lastTotal){paidInput.value=totalsNow.total?String(Number(totalsNow.total.toFixed(2))):'0';}
    lastTotal=totalsNow.total;
    const paid=Math.min(totalsNow.total,Math.max(0,Number(paidInput.value)||0));
    const hint=$('#pos-hint');
    hint.textContent=cart.length&&!walkIn()&&paid<totalsNow.total
      ?`${t('posCreditHint')} ${cashLabel(totalsNow.total-paid)}`
      :t('posWalkInHint');
    $('#checkout').disabled=!cart.length||busy;
    $('#pos-rx-note').hidden=!cart.some(line=>line.rx);
  };

  const add=product=>{
    if(!product)return;
    const line=cart.find(item=>item.medicineId===product.id);
    if((line?.quantity||0)>=product.stock){toast(`${t('error')}: ${t('stock')}`,'error');return;}
    if(line)line.quantity+=1;
    else cart.push({medicineId:product.id,name:product.name,sku:product.sku,price:Number(product.price),stock:Number(product.stock),quantity:1,rx:Number(product.rx_required)===1});
    paidTouched=false;
    drawCart();
  };

  const hideResults=()=>{
    const box=$('#pos-results');
    box.hidden=true;box.innerHTML='';
    $('#product-search').setAttribute('aria-expanded','false');
  };
  const drawResults=()=>{
    const box=$('#pos-results'),query=$('#product-search').value.trim();
    if(!query){hideResults();return;}
    box.hidden=false;
    $('#product-search').setAttribute('aria-expanded','true');
    box.innerHTML=products.length?products.slice(0,8).map(product=>`<button type="button" class="pos-result" role="option" data-product="${product.id}" ${Number(product.stock)<=0?'disabled':''}>
        <span class="pos-result-icon">${icon('pill',16)}</span>
        <span class="pos-result-copy"><strong>${e(product.name)}</strong><small>${e(product.generic_name||product.sku||'')}</small></span>
        <span class="pos-result-meta"><b>${e(amount(product.price))}</b><small>${Number(product.stock)>0?`${product.stock} ${e(t('available'))}`:e(t('outOfStock'))}</small></span>
      </button>`).join(''):`<div class="pos-no-result">${e(t('posNoResults'))}</div>`;
    box.querySelectorAll('[data-product]').forEach(node=>node.onclick=()=>{
      add(products.find(product=>product.id===Number(node.dataset.product)));
      $('#product-search').value='';
      hideResults();
      $('#product-search').focus();
    });
  };

  // Barcode scanners type the code and press Enter, so an exact match is added
  // straight to the cart without a click.
  const search=async({autoAdd=false}={})=>{
    const query=$('#product-search').value.trim();
    products=await api('catalog',{search:query});
    if(autoAdd&&query){
      const exact=products.find(product=>String(product.barcode)===query||String(product.sku)===query);
      if(exact&&Number(exact.stock)>0){add(exact);$('#product-search').value='';hideResults();return;}
      if(products.length===1&&Number(products[0].stock)>0){add(products[0]);$('#product-search').value='';hideResults();return;}
    }
    drawResults();
  };

  const refreshCustomerOptions=()=>{
    const customers=optionsFor('customers');
    const current=$('#pos-customer').value;
    $('#pos-customer').innerHTML=`<option value="">${e(t('walkIn'))}</option>`+customers.map(customer=>`<option value="${customer.id}" ${String(customer.id)===current?'selected':''}>${e(customer.name)}</option>`).join('');
  };
  const refreshAccounts=()=>{
    const method=$('#pos-method').value;
    const accounts=(state.options.accounts||[]).filter(account=>method==='bank'?account.code!=='1000':account.code==='1000');
    const current=$('#pos-account').value;
    $('#pos-account').innerHTML=accounts.map(account=>`<option value="${account.id}" ${String(account.id)===current?'selected':''}>${e(account.name)}</option>`).join('');
    $('#pos-account').disabled=!accounts.length;
  };
  const refreshPatients=()=>{
    const current=$('#pos-patient').value;
    $('#pos-patient').innerHTML=optionList(optionsFor('patients'),current,t('walkIn'));
  };
  const refreshPrescriptions=()=>{
    const patient=$('#pos-patient').value;
    const rows=prescriptions.filter(item=>!patient||String(item.patient_id)===patient);
    const current=$('#pos-prescription').value;
    $('#pos-prescription').innerHTML=optionList(rows.map(item=>({id:item.id,name:`#${item.id} · ${item.patient} · ${item.doctor}`})),current,t('none'));
  };
  const refreshOffers=()=>{
    const today=new Date().toISOString().slice(0,10);
    const rows=offers.filter(offer=>offer.active&&String(offer.starts)<=today&&String(offer.ends)>=today);
    $('#pos-offer').innerHTML=optionList(rows,($('#pos-offer').value||''),t('none'));
  };

  // Wiring -------------------------------------------------------------------
  $('#product-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>run(()=>search()),180);};
  $('#product-search').onkeydown=event=>{
    if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);run(()=>search({autoAdd:true}));}
    if(event.key==='Escape'){hideResults();}
    if(event.key==='ArrowDown'){event.preventDefault();$('#pos-results [data-product]:not(:disabled)')?.focus();}
  };
  $('#pos-discount').oninput=()=>drawCart();
  $('#pos-paid').oninput=()=>{paidTouched=true;drawCart();};
  $('#pos-customer').onchange=()=>{paidTouched=false;drawCart();};
  $('#pos-method').onchange=()=>{
    refreshAccounts();
    const credit=$('#pos-method').value==='credit';
    $('#pos-paid').disabled=credit;
    if(credit){paidTouched=true;$('#pos-paid').value='0';}else{paidTouched=false;}
    drawCart();
  };
  $('#pos-patient').onchange=()=>{refreshPrescriptions();};
  $('#pos-offer').onchange=()=>drawCart();
  $('#pos-shortcuts').onclick=()=>{
    const shortcuts=[['F2',t('scan')],['Enter',t('addToCart')],['F4',t('checkout')],['Esc',t('close')]];
    modal(t('shortcutsTitle'),`<div class="shortcuts-list">${shortcuts.map(([key,label])=>`<div class="shortcut-row"><kbd>${e(key)}</kbd><span>${e(label)}</span></div>`).join('')}</div>`);
  };

  const complete=async()=>{
    if(!cart.length||busy)return;
    const nowTotals=totals();
    const paid=Math.min(nowTotals.total,Math.max(0,Number($('#pos-paid').value)||0));
    const customerId=$('#pos-customer').value||null;
    if(paid<nowTotals.total&&!customerId){toast(t('posWalkInBlocked'),'error');$('#pos-customer').focus();return;}
    if(cart.some(line=>line.rx)&&!$('#pos-prescription').value){
      $('#pos-more').open=true;$('#pos-rx-note').hidden=false;
      toast(t('posRxNotice'),'error');$('#pos-prescription').focus();return;
    }
    const method=$('#pos-method').value;
    // Paying nothing up front is a credit sale; paying part of the total keeps
    // the money on the receipt and puts only the remainder on the account.
    const paymentMethod=paid<=0||method==='credit'?'credit':method;
    busy=true;drawCart();
    try{
      const result=await api('sale',{
        items:cart.map(line=>({medicineId:line.medicineId,quantity:line.quantity})),
        customerId,
        patientId:$('#pos-patient').value||null,
        prescriptionId:$('#pos-prescription').value||null,
        offerId:$('#pos-offer').value||null,
        discount:nowTotals.discount?String(nowTotals.discount):'0',
        paymentMethod,
        accountId:paymentMethod==='credit'?undefined:($('#pos-account').value||undefined),
        paid:String(paymentMethod==='credit'?0:paid)
      });
      cart=[];paidTouched=false;offers=await api('list',{entity:'offers'}).then(response=>response.rows).catch(()=>offers);
      $('#pos-discount').value='0';$('#pos-prescription').value='';$('#pos-offer').value='';
      $('#pos-method').value='cash';$('#pos-paid').disabled=false;refreshAccounts();
      playSaleSound();
      const onAccount=Math.max(0,result.total-Number(result.paid||0));
      toast(`${t('success')} · ${result.invoice} · ${cashLabel(result.total)}${onAccount?` · ${t('posBalanceOnAccount')} ${cashLabel(onAccount)}`:''}`);
      await refreshOptions();
      await search();
      drawCart();
      try{
        const pdf=await api('receipt',{id:result.id});
        if(!pdf.cancelled)toast(pdf.path);
      }catch(error){toast(`${t('saleSavedPdfFailed')}: ${error.message}`,'error');}
    }finally{busy=false;drawCart();}
  };
  $('#checkout').onclick=()=>run(complete);

  const keyHandler=event=>{
    if(event.key==='F2'){event.preventDefault();$('#product-search').focus();}
    if(event.key==='F4'){event.preventDefault();if(!$('#checkout').disabled)run(complete);}
  };
  document.addEventListener('keydown',keyHandler);

  refreshCustomerOptions();
  refreshPatients();
  refreshAccounts();
  refreshOffers();
  [prescriptions,offers]=await Promise.all([
    api('documents',{type:'prescriptions'}),
    api('list',{entity:'offers'}).then(response=>response.rows)
  ]);
  refreshPrescriptions();
  refreshOffers();
  await search();
  drawCart();
  $('#product-search').focus();
  return ()=>{clearTimeout(timer);document.removeEventListener('keydown',keyHandler);};
}
