'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { openDatabase, transaction, audit, backupDatabase, validateBackup } = require('./database/database');
const { PharmacyService } = require('./database/service');
const { escapeXml } = require('./database/barcode');
const { renderPDF } = require('./database/pdf');
let db, service, mainWindow;
const sessions = new Map();
const attempts = new Map();
const lockSeconds = 15 * 60;
protocol.registerSchemesAsPrivileged([{ scheme: 'pharmacy', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
app.setName('Pharmacy Management');
app.enableSandbox();
Menu.setApplicationMenu(null);

function senderWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== mainWindow || win.isDestroyed()) throw new Error('Untrusted application sender.');
  const url = new URL(event.senderFrame.url);
  if (url.protocol !== 'pharmacy:' || url.host !== 'app' || url.pathname !== '/pages/index.html') throw new Error('Untrusted application page.');
  return win;
}
function currentUser(event, token) {
  const session = sessions.get(event.sender.id);
  if (!session || !token || token.length !== 64 || !crypto.timingSafeEqual(Buffer.from(session.token,'hex'),Buffer.from(token,'hex'))) { const e = new Error('Your session has expired. Please sign in again.'); e.code='SESSION_EXPIRED'; throw e; }
  if (Date.now() > session.expires) { sessions.delete(event.sender.id); const e=new Error('Session expired after inactivity.');e.code='SESSION_EXPIRED';throw e; }
  const user = service.get('SELECT * FROM users WHERE id=? AND active=1',session.userId);
  if (!user) { sessions.delete(event.sender.id); const e=new Error('Account is no longer active.');e.code='SESSION_EXPIRED';throw e; }
  session.expires=Date.now()+lockSeconds*1000;
  return user;
}
function createSession(event,user) {
  const token=crypto.randomBytes(32).toString('hex');
  sessions.set(event.sender.id,{token,userId:user.id,expires:Date.now()+lockSeconds*1000});
  return token;
}
async function dispatch(event, request) {
  if (!request || typeof request.channel !== 'string' || !/^[a-zA-Z]{1,30}$/.test(request.channel)) throw new Error('Invalid request.');
  const c=request.channel,p=request.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid request payload.');
  if (c==='bootstrap') return service.bootstrap();
  if (c==='setup') { const result=service.setup(p);return {...result,token:createSession(event,result.user)}; }
  if (c==='login') {
    const key=String(p.username||'').toLowerCase().slice(0,40),now=Date.now(),attempt=attempts.get(key)||{count:0,until:0};
    if(attempt.until>now)throw new Error('Too many sign-in attempts. Try again in one minute.');
    try { const result=service.login(p);attempts.delete(key);return {...result,token:createSession(event,result.user)}; }
    catch(error){attempt.count++;if(attempt.count>=5){attempt.until=now+60000;attempt.count=0;}attempts.set(key,attempt);throw error;}
  }
  const user=currentUser(event,request.token);
  if(c==='session')return {user:service.publicUser(user),permissions:service.permissions(user)};
  if(c==='logout'){sessions.delete(event.sender.id);transaction(db,()=>audit(db,user,'logout','users',user.id));return {ok:true};}
  if(c==='preference')return service.preference(user,p);
  if(c==='preferences')return service.preferences(user);
  if(c==='dashboard')return service.dashboard(user);
  if(c==='options')return service.options(user);
  if(c==='list')return service.list(user,p.entity,p);
  if(c==='save')return service.saveEntity(user,p.entity,p.record);
  if(c==='catalog')return service.catalog(user,p.search);
  if(c==='sale')return service.sale(user,p);
  if(c==='purchase')return service.receivePurchase(user,p);
  if(c==='documents')return service.documents(user,p.type,p);
  if(c==='document')return service.document(user,p.type,p.id);
  if(c==='return')return service.returnDocument(user,p.type,p);
  if(c==='payment')return service.partyPayment(user,p);
  if(c==='expense')return service.expense(user,p);
  if(c==='advance')return service.advance(user,p);
  if(c==='salary')return service.salary(user,p);
  if(c==='register')return service.register(user,p.action,p);
  if(c==='inventory')return service.inventoryOperation(user,p.kind,p);
  if(c==='stockCount')return service.stockCount(user,p.action,p);
  if(c==='savePrescription')return service.savePrescription(user,p);
  if(c==='prescriptionFile')return service.prescriptionFile(user,p.id);
  if(c==='cancelPrescription')return service.cancelPrescription(user,p.id);
  if(c==='saveUser')return service.saveUser(user,p);
  if(c==='settings')return service.settings(user,p);
  if(c==='report')return service.report(user,p);
  if(c==='generateBarcode')return service.generateBarcode(user);
  if(c==='barcode')return service.barcode(user,p);
  if(c==='pdf'||c==='receipt'||c==='printBarcode'){
    service.require(user,c==='receipt'?'sales':c==='printBarcode'?'barcodes':'reports');
    let data;
    if(c==='receipt')data=service.document(user,'sale',p.id);
    else if(c==='printBarcode')data=service.barcode(user,p);
    else { service.require(user,['profit','balances'].includes(p.kind)?'finance':'reports');data=service.report(user,p); }
    const win=senderWindow(event);
    const result=await dialog.showSaveDialog(win,{title:'Save PDF',defaultPath:`pharmacy-${c}-${Date.now()}.pdf`,filters:[{name:'PDF document',extensions:['pdf']}]});
    if(result.canceled)return {cancelled:true};
    let filename=result.filePath;if(!filename.toLowerCase().endsWith('.pdf'))filename+='.pdf';
    const bytes=await renderPDF(c,data,service.preferences(user));
    fs.writeFileSync(filename,bytes,{flag:'wx'});
    transaction(db,()=>audit(db,user,'export_pdf',c,p.id||p.kind||''));
    return {path:filename};
  }
  if(c==='backup'){
    service.require(user,'backup',true);const win=senderWindow(event);
    const result=await dialog.showSaveDialog(win,{title:'Save encrypted-at-rest storage is your responsibility',defaultPath:`pharmacy-backup-${new Date().toISOString().slice(0,10)}.sqlite`,filters:[{name:'SQLite backup',extensions:['sqlite']}]});
    if(result.canceled)return {cancelled:true};
    await backupDatabase(db,result.filePath);transaction(db,()=>audit(db,user,'backup','database'));return {path:result.filePath};
  }
  if(c==='restore'){
    service.require(user,'backup',true);if(user.role!=='admin')throw new Error('Only an administrator may restore a database.');
    const win=senderWindow(event);const result=await dialog.showOpenDialog(win,{title:'Restore backup — current data will be replaced',properties:['openFile'],filters:[{name:'SQLite backup',extensions:['sqlite']}]});
    if(result.canceled)return {cancelled:true};
    const filename=result.filePaths[0];validateBackup(filename);
    const confirm=await dialog.showMessageBox(win,{type:'warning',buttons:['Cancel','Replace and restart'],defaultId:0,cancelId:0,title:'Replace all current data?',message:'This replaces the current database with the selected backup.',detail:'A safety copy of the current database is kept beside it. All users must sign in again.'});
    if(confirm.response!==1)return {cancelled:true};
    const current=path.join(app.getPath('userData'),'pharmacy.sqlite');
    const safety=current+'.before-restore-'+Date.now();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();
    try{fs.copyFileSync(current,safety);fs.copyFileSync(filename,current);for(const suffix of ['-wal','-shm'])fs.rmSync(current+suffix,{force:true});}
    catch(error){fs.copyFileSync(safety,current);for(const suffix of ['-wal','-shm'])fs.rmSync(current+suffix,{force:true});db=openDatabase(app.getPath('userData'));service=new PharmacyService(db);throw error;}
    app.relaunch();app.exit(0);return {ok:true};
  }
  throw new Error('Unknown operation.');
}
function createWindow() {
  mainWindow=new BrowserWindow({width:1440,height:960,minWidth:1024,minHeight:700,backgroundColor:'#f4f7fb',title:'Pharmacy Management',icon:path.join(__dirname,'build','icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',event=>event.preventDefault());
  mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(()=>false);
  mainWindow.webContents.on('destroyed',()=>sessions.delete(mainWindow?.webContents.id));
  mainWindow.loadURL('pharmacy://app/pages/index.html');
  mainWindow.on('closed',()=>{sessions.clear();mainWindow=null;});
}
app.whenReady().then(()=>{
  protocol.handle('pharmacy', request => {
    const url = new URL(request.url);
    const root = path.join(__dirname, 'src');
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'app' || !filename.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filename).toString());
  });
  db=openDatabase(app.getPath('userData'));service=new PharmacyService(db);
  ipcMain.handle('pharmacy:request',async(event,request)=>{
    try{senderWindow(event);const data=await dispatch(event,request);return {ok:true,data};}
    catch(error){
      const safe=error.code==='SESSION_EXPIRED'?error.message:(/ UNIQUE constraint/.test(error.message)?'That value already exists. Use a unique SKU, barcode, username or record name.':/ FOREIGN KEY constraint/.test(error.message)?'This record is linked to other records and cannot be changed that way.':error.message?.slice(0,250)||'The operation could not be completed.');
      console.error('[application]',error.message);
      return {ok:false,error:safe,code:error.code||'OPERATION_FAILED'};
    }
  });
  createWindow();
}).catch(error=>{dialog.showErrorBox('Pharmacy cannot start',error.message);app.quit();});
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(db){db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();db=null;}});
process.on('uncaughtException',error=>{console.error(error);if(app.isReady())dialog.showErrorBox('Application error',error.message);});
