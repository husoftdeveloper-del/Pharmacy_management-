import {api,state,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,modal,toast,run} from './ui.js';

/* The New Medicine form: name, barcode with a side-icon generator, generic name,
   brand, company, category, dosage form, unit, reorder level and quantity, both
   prices, and a collapsible Opening Stock section that creates the first batch.
   Saving goes through the saveMedicine channel so the catalogue entry and its
   opening batch are written together. */
const dosageForms=['tablet','capsule','syrup','suspension','injection','cream','ointment','drops','inhaler','sachet','powder','spray','other'];
const units=['piece','tablet','capsule','bottle','box','strip','sachet','ml','gram','tube','vial','ampoule'];
const barcodeTypes=[{value:'internal',label:'internal'},{value:'manufacturer',label:'manufacturer'}];

const option=(values,current)=>(values||[]).map(item=>{
  const value=item.value??item.id??item;
  const label=item.label??item.name??t(value)??value;
  return `<option value="${e(value)}" ${String(value)===String(current??'')?'selected':''}>${e(label)}</option>`;
}).join('');

const withCurrent=(list,current)=>current&&!list.includes(current)?[current,...list]:list;

function select(name,label,values,current,placeholder=t('select')){return `<label class="mf-field"><span>${e(label)}</span><span class="mf-select">${icon('chevron',15)}<select name="${e(name)}"><option value="">${e(placeholder)}</option>${option(values,current)}</select></span></label>`;}
function input(name,label,value='',type='text',extra=''){return `<label class="mf-field"><span>${e(label)}</span><input name="${e(name)}" type="${type}" value="${e(value)}" ${type==='number'?'step="any" min="0"':''} maxlength="${type==='number'?18:180}" autocomplete="off" ${extra}></label>`;}

export function medicineForm(record={},editing=false){
  const categories=state.options.categories||[];
  const companies=state.options.manufacturers||[];
  return `<form class="medicine-form" novalidate>
    <div class="mf-grid">
      <label class="mf-field mf-full"><span>${e(t('name'))} <b>*</b></span><input name="name" value="${e(record.name??'')}" maxlength="180" autocomplete="off" required></label>
      <label class="mf-field"><span>${e(t('barcode'))}</span><span class="barcode-input-wrap"><input name="barcode" value="${e(record.barcode??'')}" maxlength="64" autocomplete="off" placeholder="${e(t('barcodePlaceholder'))}"><button class="barcode-generate-btn" type="button" data-generate-barcode aria-label="${e(t('generateBarcode'))}" title="${e(t('generateBarcode'))}">${icon('barcode',19)}</button></span></label>
      ${select('barcode_type',t('barcodeType'),barcodeTypes,record.barcode_type||'internal')}
      ${input('generic_name',t('genericName'),record.generic_name??'')}
      ${input('brand',t('brand'),record.brand??'')}
      ${select('manufacturer_id',t('company'),companies,record.manufacturer_id,t('none'))}
      ${select('category_id',t('category'),categories,record.category_id,t('none'))}
      ${select('dosage_form',t('dosageForm'),dosageForms,record.dosage_form||'')}
      ${select('unit',t('unit'),withCurrent(units,record.unit),record.unit||'piece')}
      <label class="mf-field"><span>${e(t('reorderLevel'))}</span><input name="reorder_level" type="number" min="0" step="1" value="${e(record.reorder_level??0)}"><small>${e(t('reorderLevelHint'))}</small></label>
      ${input('reorder_qty',t('reorderQty'),record.reorder_qty??0,'number')}
      ${editing?input('cost',t('purchasePrice'),record.cost??0,'number')+input('price',t('sellingPrice'),record.price??'','number','required'):''}
      ${input('storage',t('storage'),record.storage??'')}
    </div>
    ${editing?'':`<details class="opening-stock" ${record.openingOpen?'open':''}><summary><span class="opening-stock-icon">${icon('box',17)}</span><span>${e(t('openingStock'))}</span>${icon('chevron',16)}</summary>
      <div class="mf-grid opening-grid">
        ${input('opening_quantity',t('quantity'),'','number')}
        <label class="mf-field"><span>${e(t('expiry'))}</span><input name="opening_expiry" type="date" min="${e(today())}" value=""></label>
        ${input('opening_cost',t('purchasePrice'),'','number')}
        ${input('opening_price',t('sellingPrice'),'','number','required')}
      </div></details>`}
    <div class="form-error" role="alert"></div>
    <footer class="medicine-form-footer">
      <button class="btn btn-secondary" type="button" data-cancel>${e(t('cancel'))}</button>
      ${editing?'':`<button class="btn btn-soft" type="button" data-save-new>${e(t('saveAndNew'))}</button>`}
      <button class="btn btn-primary" type="submit">${e(editing?t('save'):t('save'))}</button>
    </footer>
  </form>`;
}

function readForm(form){
  const data=new FormData(form);
  const value=name=>String(data.get(name)??'').trim();
  const numeric=name=>value(name)===''?0:Number(value(name));
  const opening=form.querySelector('[name=opening_quantity]')?{
    quantity:numeric('opening_quantity'),expiry:value('opening_expiry'),
    cost:numeric('opening_cost'),price:numeric('opening_price')
  }:null;
  const record={
    name:value('name'),generic_name:value('generic_name'),brand:value('brand'),barcode:value('barcode'),
    barcode_type:value('barcode_type')||'internal',dosage_form:value('dosage_form'),
    category_id:value('category_id')||null,manufacturer_id:value('manufacturer_id')||null,
    unit:value('unit')||'piece',cost:opening?opening.cost:numeric('cost'),price:opening?opening.price:numeric('price'),
    reorder_level:numeric('reorder_level'),reorder_qty:numeric('reorder_qty'),storage:value('storage')
  };
  if(opening&&opening.quantity>0)record.opening_stock={quantity:opening.quantity,expiry:opening.expiry,cost:opening.cost};
  return record;
}

export function openMedicineForm(record={},done){
  const editing=Boolean(record.id);
  const m=modal(t(editing?'editMedicine':'newMedicine'),medicineForm(record,editing));
  m.root.querySelector('.modal').classList.add('modal-medicine');
  const form=m.root.querySelector('form');
  const error=form.querySelector('.form-error');
  const submit=form.querySelector('[type=submit]');
  let busy=false;

  const clear=()=>{
    for(const field of form.querySelectorAll('input,select'))field.value='';
    form.querySelector('[name=barcode_type]').value='internal';
    form.querySelector('[name=unit]').value='piece';
    form.querySelector('[name=reorder_level]').value='0';
    form.querySelector('[name=reorder_qty]').value='0';
    for(const name of ['opening_quantity','opening_expiry','opening_cost','opening_price'])form.querySelector(`[name=${name}]`).value='';
    form.querySelector('.opening-stock')?.removeAttribute('open');
    form.querySelector('[name=name]').focus();
  };
  const save=async(keepOpen)=>{
    if(busy)return;busy=true;submit.disabled=true;error.textContent='';
    try{
      const record=readForm(form);
      if(!record.name){error.textContent=t('nameRequired');return;}
      if(!editing&&!(record.price>0)){error.textContent=t('priceRequired');form.querySelector('.opening-stock').open=true;form.querySelector('[name=opening_price]').focus();return;}
      if(record.opening_stock&&!record.opening_stock.expiry){form.querySelector('.opening-stock').open=true;error.textContent=t('openingExpiryRequired');return;}
      await api('saveMedicine',{record});
      toast(t('recordSaved'));
      await done?.();
      if(keepOpen){clear();}else{m.close();}
    }catch(failure){error.textContent=failure.message;}finally{busy=false;submit.disabled=false;}
  };
  submit.onclick=ev=>{ev.preventDefault();save(false);};
  form.onsubmit=ev=>{ev.preventDefault();save(false);};
  form.querySelector('[data-save-new]')?.addEventListener('click',()=>save(true));
  form.querySelector('[data-cancel]').onclick=()=>m.close();
  form.querySelector('[data-generate-barcode]').onclick=async ev=>{
    const button=ev.currentTarget;button.disabled=true;
    await run(async()=>{const result=await api('generateBarcode');form.querySelector('[name=barcode]').value=result.value;toast(t('barcodeGenerated'));});
    button.disabled=false;
  };
  setTimeout(()=>form.querySelector('[name=name]')?.focus(),40);
  return m;
}
