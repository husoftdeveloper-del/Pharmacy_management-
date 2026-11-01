'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pharmacy-electron-'));
app.setPath('userData',directory);
app.setPath('sessionData',path.join(directory,'session'));
const artifacts=path.join(__dirname,'..','artifacts');fs.mkdirSync(artifacts,{recursive:true});
require('../main');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){let last;for(let i=0;i<100;i++){try{if(await fn())return;}catch(error){last=error.message;}await pause(100);}let body='';try{body=await BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript('document.body.innerText')}catch{}throw new Error('Timed out: '+label+'; '+last+'; '+body);}
app.whenReady().then(async()=>{
  let win;await until(async()=>{win=BrowserWindow.getAllWindows()[0];return win&&await win.webContents.executeJavaScript('!!window.pharmacy');},'preload');
  const run=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const errors=[];win.webContents.on('did-fail-load',(event,code,description,url)=>errors.push(url+' '+code+' '+description));win.webContents.on('console-message',event=>{const message=event.message||'';if(/TypeError|ReferenceError|SyntaxError|Failed to load module/.test(message))errors.push(message);});
  await until(()=>win.webContents.executeJavaScript("!!document.querySelector('#auth-form')"),'setup form');
  assert.equal(await run('return typeof window.require'), 'undefined');
  await run("document.querySelector('[name=pharmacyName]').value='Kabul Care Pharmacy';document.querySelector('[name=name]').value='Test Administrator';document.querySelector('[name=username]').value='admin';document.querySelector('[name=password]').value='SmokeTestPassword123!';document.querySelector('#auth-form').requestSubmit();return true;");
  await until(()=>win.webContents.executeJavaScript("!!document.querySelector('.app-shell')"),'shell');
  await run("const api=window.pharmacy.invoke;await api('save',{entity:'categories',record:{name:'Analgesics',active:1}});const m=await api('save',{entity:'medicines',record:{name:'Paracetamol 500mg',generic_name:'Acetaminophen',sku:'PAR-500',barcode:'PAR50001',unit:'tablet',price:10,cost:6,reorder_level:5,active:1}});const s=await api('save',{entity:'suppliers',record:{name:'Kabul Health Supplies',active:1}});await api('register',{action:'open',opening:1000});await api('purchase',{supplierId:s.id,invoiceNo:'PUR-1001',paymentMethod:'credit',items:[{medicineId:m.id,batchNo:'B-1001',expiry:'2030-12-31',quantity:100,cost:6,locationId:1}]});return true;");
  const pages=await run("return [...document.querySelectorAll('[data-page]')].map(x=>x.dataset.page)");
  for(const page of pages){
    await run(`document.querySelector('[data-page="${page}"]').click();return true;`);await pause(180);
    await until(()=>run("return !document.querySelector('.loading-state')"),'page '+page);
    const text=await run("return document.querySelector('#page-content').innerText");
    assert.ok(!text.includes('Something went wrong'),page+': '+text);
    if(['dashboard','pos','inventory','reports'].includes(page)){const image=await win.webContents.capturePage();fs.writeFileSync(path.join(artifacts,`electron-${page}.png`),image.toPNG());}
  }
  await run("document.querySelector('[data-page=barcodes]').click();return true;");
  await until(()=>run("return !!document.querySelector('#generate-barcode')"),'barcode generator icon');
  await run("document.querySelector('#generate-barcode').click();return true;");
  await until(()=>run("return /^MED-/.test(document.querySelector('[name=barcode]').value) && !!document.querySelector('#barcode-preview svg') && !document.querySelector('#print').disabled"),'automatic barcode preview');
  const barcodeShot=await win.webContents.capturePage();fs.writeFileSync(path.join(artifacts,'electron-barcode-generator.png'),barcodeShot.toPNG());
  await run("document.querySelector('[data-page=pos]').click();return true;");await until(()=>run("return !!document.querySelector('[data-product]')"),'POS products');
  await run("document.querySelector('[data-product]').click();return true;");
  assert.equal(await run("return document.querySelectorAll('.cart-item').length"),1);
  await run("await window.pharmacy.invoke('sale',{items:[{medicineId:1,quantity:2}],paymentMethod:'cash',accountId:1});return true;");
  const {renderPDF}=require('../database/pdf');
  const pdf=await renderPDF('printBarcode',{value:'PAR50001',svg:require('../database/barcode').code128('PAR50001')},{pharmacy_name:'Kabul Care Pharmacy'});
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(path.join(artifacts,'electron-barcode.pdf'),pdf);
  await run("await window.pharmacy.invoke('preference',{language:'ps',theme:'dark'});return true;");
  await run("document.querySelector('#logout').click();return true;");
  await until(()=>run("return !!document.querySelector('#auth-form')"),'reload login');
  await run("document.querySelector('[name=username]').value='admin';document.querySelector('[name=password]').value='SmokeTestPassword123!';document.querySelector('#auth-form').requestSubmit();return true;");
  await until(()=>run("return !!document.querySelector('.app-shell')"),'login after reload');
  assert.equal(await run('return document.documentElement.dir'),'rtl');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(artifacts,'electron-smoke-result.json'),JSON.stringify({status:'passed',pages:pages.length,database:directory,pdfBytes:pdf.length,rendererNodeAccess:false,rtl:true,oneClickBarcode:true},null,2));
  console.log('ELECTRON_SMOKE_PASSED',pages.length,'pages; PDF bytes',pdf.length);
  app.exit(0);
}).catch(error=>{console.error('ELECTRON_SMOKE_FAILED',error);fs.writeFileSync(path.join(artifacts,'electron-smoke-error.txt'),error.stack);app.exit(1);});
setTimeout(()=>{console.error('Electron smoke timeout');app.exit(1);},90000).unref();
