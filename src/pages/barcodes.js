import {api,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {pageHeader,field,icon,toast,run,optionsFor} from '../components/ui.js';

export async function render(root){
  root.innerHTML=pageHeader(t('barcodes'),'CODE128-B · Local generation, no external service')+`
    <div class="settings-grid">
      <section class="card">
        <div class="card-header"><h2>${e(t('barcode'))}</h2></div>
        <div class="card-body">
          <form id="barcode-form">
            <div class="form-grid">
              ${field('medicine','',{options:optionsFor('medicines')})}
              <label class="field barcode-field">
                <span>${e(t('barcode'))} <b>*</b></span>
                <span class="barcode-input-wrap">
                  <input name="barcode" type="text" required maxlength="64" autocomplete="off" aria-describedby="barcode-hint">
                  <button class="barcode-generate-btn" type="button" id="generate-barcode" aria-label="${e(t('generateBarcode'))}" title="${e(t('generateBarcode'))}">
                    ${icon('barcode',20)}
                  </button>
                </span>
                <small id="barcode-hint">${e(t('barcodeAutoHint'))}</small>
              </label>
            </div>
            <div class="form-error" role="alert"></div>
            <footer class="form-footer">
              <button class="btn btn-primary" type="submit">${icon('check',17)}<span>${e(t('save'))}</span></button>
              <button class="btn btn-secondary" type="button" id="print" disabled>${icon('download',17)}<span>${e(t('print'))}</span></button>
            </footer>
          </form>
          <div class="barcode-preview" id="barcode-preview"><span class="muted">${e(t('empty'))}</span></div>
        </div>
      </section>
      <aside class="card settings-aside">
        <span class="badge good">Scannable labels</span>
        <h3>CODE128-B</h3>
        <p>${e(t('barcodeAutoHint'))}</p>
        <p>Use a USB barcode scanner in keyboard mode. Scan into the POS search field and press Enter. Test printed labels with your scanner before using them in sales.</p>
      </aside>
    </div>`;

  const input=root.querySelector('[name="barcode"]');
  const medicine=root.querySelector('[name="medicine"]');
  const preview=root.querySelector('#barcode-preview');
  const generateButton=root.querySelector('#generate-barcode');
  const printButton=root.querySelector('#print');
  const error=root.querySelector('.form-error');
  let current=null;

  const read=()=>({value:input.value.trim(),medicineId:medicine.value||undefined});
  const show=result=>{
    current=result;
    input.value=result.value;
    preview.innerHTML=result.svg;
    printButton.disabled=false;
    error.textContent='';
  };
  const clearPreview=()=>{
    current=null;
    preview.innerHTML=`<span class="muted">${e(t('empty'))}</span>`;
    printButton.disabled=true;
  };

  generateButton.onclick=()=>run(async()=>{
    generateButton.disabled=true;
    try{
      show(await api('generateBarcode'));
      toast(t('barcodeGenerated'));
      input.focus();
    }finally{
      generateButton.disabled=false;
    }
  });

  input.addEventListener('input',clearPreview);

  root.querySelector('#barcode-form').onsubmit=ev=>{
    ev.preventDefault();
    run(async()=>{
      if(!medicine.value)throw new Error(t('selectMedicineFirst'));
      const result=await api('barcode',{...read(),medicineId:medicine.value});
      show(result);
      toast(t('recordSaved'));
    });
  };

  printButton.onclick=()=>run(async()=>{
    if(!current)throw new Error(t('generateBarcode'));
    const result=await api('printBarcode',read());
    if(!result.cancelled)toast(result.path);
  });

  medicine.onchange=()=>run(async()=>{
    clearPreview();
    if(!medicine.value)return;
    const result=await api('list',{entity:'medicines',limit:200});
    const record=result.rows.find(r=>r.id===Number(medicine.value));
    if(record?.barcode){
      show(await api('barcode',{value:record.barcode}));
    }else if(record?.sku){
      input.value=record.sku;
    }
  });
}
