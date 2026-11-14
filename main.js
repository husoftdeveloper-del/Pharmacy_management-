'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { openDatabase, transaction, audit, backupDatabase, validateBackup } = require('./database/database');
const { PharmacyService } = require('./database/service');
const autoBackup = require('./database/autobackup');
const { escapeXml } = require('./database/barcode');
const { renderPDF } = require('./database/pdf');
const rendererTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
function rendererType(filename){return rendererTypes[path.extname(filename).toLowerCase()]||'application/octet-stream';}
let db, service, mainWindow;
const sessions = new Map();
const attempts = new Map();
const lockSeconds = 15 * 60;
const isDev = !app.isPackaged && process.argv.includes('--dev');
const devWatchers = [];
let devReloadTimer = null;
let devRestartTimer = null;
let devRestarting = false;
const devSignatures = new Map();
const devWatchExt = /\.(html|css|js|mjs|json|svg|png|ico|woff2?)$/i;
const devRestartExt = /\.(js|mjs|json|sql)$/i;

/* ---- Silent automatic backups -------------------------------------------
   The reader only needs the settings table, so these helpers read it directly
   instead of going through a signed-in session: backups also run before anyone
   has signed in, and while the app is closing. */
const backupDefaults = { auto_backup: '1', backup_on_close: '1', backup_copies: String(autoBackup.DEFAULT_COPIES) };
function backupSetting(key) {
  if (!db) return '';
  try { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? String(row.value) : ''; } catch { return ''; }
}
function backupFolder() {
  const stored = backupSetting('backup_folder');
  if (stored) return stored;
  const documents = (() => { try { return app.getPath('documents'); } catch { return app.getPath('userData'); } })();
  return autoBackup.defaultFolder(documents);
}
function backupConfig() {
  const read = key => { const value = backupSetting(key); return value === '' ? backupDefaults[key] ?? '' : value; };
  return {
    auto: read('auto_backup') === '1',
    onClose: read('backup_on_close') === '1',
    folder: backupFolder(),
    copies: Math.max(1, Math.min(365, Number(read('backup_copies')) || autoBackup.DEFAULT_COPIES))
  };
}
function rememberBackup(kind, file) {
  const now = new Date().toISOString();
  try {
    const save = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    save('last_backup_at', now);
    save('last_backup_kind', kind);
    save('last_backup_path', file);
  } catch {}
}
function backupStatus() {
  const config = backupConfig();
  const all = autoBackup.copies(config.folder);
  const last = all[0];
  return {
    auto: config.auto,
    onClose: config.onClose,
    folder: config.folder,
    copies: config.copies,
    count: all.length,
    last: last ? { path: last.path, name: last.name, bytes: last.bytes, at: new Date(last.at).toISOString() } : null,
    lastKind: backupSetting('last_backup_kind') || (last && last.name.includes('-close-') ? 'close' : last ? 'daily' : '')
  };
}
// Runs a copy and records the result. Never throws: a failed silent backup must
// not interrupt the user's work, so the error is logged and reported instead.
async function runAutoBackup(kind, time = new Date()) {
  if (!db) return { skipped: true, reason: 'no-database' };
  const config = backupConfig();
  try {
    const result = await autoBackup.run(db, config.folder, kind, config.copies, time);
    if (!result.skipped) rememberBackup(kind, result.path);
    return result;
  } catch (error) {
    console.error('[backup]', kind, error.message);
    return { skipped: true, failed: true, error: error.message };
  }
}
let dailyBackupTimer = null;
function scheduleDailyBackup() {
  if (dailyBackupTimer) return;
  const ready = () => { try { return db && db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0; } catch { return false; } };
  const tick = () => { const config = backupConfig(); if (config.auto && ready()) runAutoBackup('daily'); };
  setTimeout(tick, 4000);
  dailyBackupTimer = setInterval(tick, 60 * 60 * 1000);
  dailyBackupTimer.unref?.();
}
protocol.registerSchemesAsPrivileged([{ scheme: 'pharmacy', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Pharmacy Management');
if (isDev) {
  // Keep live-reload experiments away from the installed production database.
  app.setPath('userData', path.join(app.getPath('appData'), 'Pharmacy Management Dev'));
}
if (!app.requestSingleInstanceLock()) app.quit();
app.enableSandbox();
Menu.setApplicationMenu(null);

function closeDevWatchers() {
  while (devWatchers.length) {
    try { devWatchers.pop().close(); } catch {}
  }
}
function restartDevApp(reason) {
  if (!isDev || devRestarting) return;
  devRestarting = true;
  console.log(`[dev] restarting: ${reason}`);
  closeDevWatchers();
  try { if (db) { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); db = null; } } catch {}
  app.relaunch();
  app.exit(0);
}
function reloadDevRenderer(reason) {
  if (!isDev || devRestarting || !mainWindow || mainWindow.isDestroyed()) return;
  console.log(`[dev] reload: ${reason}`);
  mainWindow.webContents.reloadIgnoringCache();
}
function devSignature(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}
function seedDevSignatures(target, recursive, filter) {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      if (filter(path.basename(target))) devSignatures.set(target, devSignature(target));
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) {
        if (recursive) seedDevSignatures(full, true, filter);
      } else if (filter(entry.name)) {
        devSignatures.set(full, devSignature(full));
      }
    }
  } catch {}
}
function devFileChanged(file, filter) {
  if (!filter(path.basename(file))) return false;
  const next = devSignature(file);
  const previous = devSignatures.get(file) || null;
  if (next === previous) return false;
  if (next === null) devSignatures.delete(file);
  else devSignatures.set(file, next);
  return true;
}
function watchDevPath(target, onChange, recursive = false) {
  try {
    const watcher = fs.watch(target, { recursive }, (event, filename) => onChange(event, filename || ''));
    watcher.on('error', error => console.warn(`[dev] watcher error: ${error.message}`));
    devWatchers.push(watcher);
  } catch (error) {
    console.warn(`[dev] cannot watch ${target}: ${error.message}`);
  }
}
function startDevLiveReload() {
  if (!isDev) return;
  const srcRoot = path.join(__dirname, 'src');
  const srcFilter = name => devWatchExt.test(name) && !/pharmacy-setup\.exe$/i.test(name);
  seedDevSignatures(srcRoot, true, srcFilter);
  watchDevPath(srcRoot, (event, filename) => {
    const name = filename || '';
    if (!srcFilter(path.basename(name))) return;
    const full = path.join(srcRoot, name);
    // Windows can emit watch events for file reads/access. Only reload when the
    // file signature actually changes, otherwise opening pages logs the user out.
    if (!devFileChanged(full, srcFilter)) return;
    clearTimeout(devReloadTimer);
    devReloadTimer = setTimeout(() => reloadDevRenderer(name || event), 180);
  }, true);
  const restartFilter = name => devRestartExt.test(name);
  const restart = (target, filename) => {
    const full = path.isAbsolute(filename) ? filename : path.join(target, filename || path.basename(target));
    if (!devFileChanged(full, restartFilter)) return;
    clearTimeout(devRestartTimer);
    devRestartTimer = setTimeout(() => restartDevApp(filename), 250);
  };
  for (const file of ['main.js', 'preload.js', 'package.json']) {
    const full = path.join(__dirname, file);
    seedDevSignatures(full, false, restartFilter);
    watchDevPath(full, (event, filename) => restart(full, filename || file));
  }
  const dbRoot = path.join(__dirname, 'database');
  seedDevSignatures(dbRoot, true, restartFilter);
  watchDevPath(dbRoot, (event, filename) => restart(dbRoot, filename || ''), true);
  console.log('[dev] live reload enabled. Edit src/ to refresh; main/preload/database changes restart the app.');
}

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
  if(c==='customerAccounts')return service.customerAccounts(user,p);
  if(c==='customerBook')return service.customerBook(user);
  if(c==='medicineBook')return service.medicineBook(user);
  if(c==='inventoryBook')return service.inventoryBook(user);
  if(c==='saveMedicine')return service.saveMedicine(user,p.record||p);
  if(c==='priceList')return service.priceList(user);
  if(c==='updatePrice')return service.updateMedicinePrice(user,p);
  if(c==='labelBook')return service.labelBook(user);
  if(c==='purchaseBook')return service.purchaseBook(user);
  if(c==='supplierBook')return service.supplierBook(user);
  if(c==='supplierAccounts')return service.supplierAccounts(user,p);
  if(c==='expenseBook')return service.expenseBook(user);
  if(c==='ledgerBook')return service.ledgerBook(user,p);
  if(c==='reportOverview')return service.reportOverview(user,p);
  if(c==='reportBook')return service.reportBook(user,p);
  if(c==='employeeBook')return service.employeeBook(user);
  if(c==='salaryBook')return service.salaryBook(user,p);
  if(c==='advanceBook')return service.advanceBook(user,p);
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
  if(c==='profile')return service.profile(user,p);
  if(c==='changePassword')return service.changePassword(user,p);
  if(c==='report')return service.report(user,p);
  if(c==='generateBarcode')return service.generateBarcode(user);
  if(c==='barcode')return service.barcode(user,p);
  if(c==='pdf'||c==='receipt'||c==='printBarcode'||c==='printLabels'){
    const isPriceList=c==='pdf'&&p.kind==='pricelist';
    service.require(user,c==='printLabels'?'printlabels':isPriceList?'pricelist':c==='receipt'?'sales':c==='printBarcode'?'barcodes':'reports');
    let data;
    if(c==='receipt')data=service.document(user,'sale',p.id);
    else if(c==='printBarcode')data=service.barcode(user,p);
    else if(c==='printLabels')data=service.printLabels(user,p);
    else if(isPriceList)data=service.priceListDocument(user);
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
  // Desktop notifications are raised by the main process: the renderer session
  // denies every browser permission, so the page cannot use the Notification
  // API itself. The preference is checked by the page before calling this.
  if(c==='notify'){
    if(!Notification.isSupported())return {supported:false,shown:false};
    const title=String(p.title||'Pharmacy Management').slice(0,120);
    const body=String(p.body||'').slice(0,400);
    const notification=new Notification({title,body,silent:Boolean(p.silent)});
    notification.on('click',()=>{if(mainWindow&&!mainWindow.isDestroyed()){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
    notification.show();
    transaction(db,()=>audit(db,user,'notify_desktop','settings','',title));
    return {supported:true,shown:true};
  }
  if(c==='notificationSupport')return {supported:Notification.isSupported()};
  if(c==='backupStatus'){service.require(user,'backup');return backupStatus();}
  if(c==='backupNow'){
    service.require(user,'backup');
    const config=backupConfig();
    const result=await autoBackup.run(db,config.folder,'manual',config.copies);
    rememberBackup('manual',result.path);transaction(db,()=>audit(db,user,'backup','database',result.path));
    return {path:result.path};
  }
  if(c==='backupChooseFolder'){
    service.require(user,'settings');
    const win=senderWindow(event);
    const picked=await dialog.showOpenDialog(win,{title:'Choose the folder for automatic backups',defaultPath:backupFolder(),properties:['openDirectory','createDirectory']});
    if(picked.canceled||!picked.filePaths[0])return {cancelled:true};
    const folder=picked.filePaths[0];
    service.settings(user,{backup_folder:folder});
    return {folder};
  }
  if(c==='backupOpenFolder'){
    service.require(user,'backup');
    const folder=backupFolder();
    fs.mkdirSync(folder,{recursive:true});
    const failure=await shell.openPath(folder);
    if(failure)throw new Error('The backup folder could not be opened.');
    return {folder};
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
  mainWindow=new BrowserWindow({width:1440,height:960,minWidth:1024,minHeight:700,backgroundColor:'#f4f7fb',title:isDev?'Pharmacy Management · DEV':'Pharmacy Management',icon:path.join(__dirname,'build','icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),additionalArguments:isDev?['--pharmacy-dev']:[],contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',event=>event.preventDefault());
  mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(()=>false);
  mainWindow.webContents.on('destroyed',()=>sessions.delete(mainWindow?.webContents.id));
  /* A packaged update replaces the app files, so start every launch from a clean cache. */
  mainWindow.webContents.session.clearCache().catch(()=>{}).finally(()=>{
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL('pharmacy://app/pages/index.html');
  });
  mainWindow.on('closed',()=>{sessions.clear();mainWindow=null;});
  if (isDev) {
    mainWindow.webContents.on('before-input-event',(event,input)=>{
      if (input.type==='keyDown' && (input.key==='F5' || (input.control && input.key.toLowerCase()==='r'))) {
        event.preventDefault();
        reloadDevRenderer('manual shortcut');
      }
      if (input.type==='keyDown' && input.key==='F12') mainWindow.webContents.toggleDevTools();
    });
  }
}
app.whenReady().then(()=>{
  protocol.handle('pharmacy', request => {
    const url = new URL(request.url);
    const root = path.join(__dirname, 'src');
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'app' || !filename.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
    /* Serve from disk every time: Chromium must never reuse an older build of a
       renderer file after an update. */
    return fs.promises.readFile(filename)
      .then(data => new Response(data, { headers: { 'content-type': rendererType(filename), 'cache-control': 'no-store, no-cache, max-age=0' } }))
      .catch(() => new Response('Not found', { status: 404 }));
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
  ipcMain.handle('pharmacy:dev-resume',async(event)=>{
    if(!isDev)return {ok:false};
    try{
      senderWindow(event);
      const session=sessions.get(event.sender.id);
      if(!session||Date.now()>session.expires)return {ok:false};
      const user=service.get('SELECT * FROM users WHERE id=? AND active=1',session.userId);
      if(!user)return {ok:false};
      return {ok:true,data:{token:session.token}};
    }catch{return {ok:false};}
  });
  scheduleDailyBackup();
  createWindow();
  startDevLiveReload();
}).catch(error=>{dialog.showErrorBox('Pharmacy cannot start',error.message);app.quit();});
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();}});
app.on('window-all-closed',()=>app.quit());
let closingBackup = null;
let closingBackupDone = false;
let shutdownDone = false;
function shutdown() {
  if (shutdownDone) return;
  shutdownDone = true;
  closeDevWatchers();
  if (db) { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {} db = null; }
}
app.on('before-quit',event=>{
  // One last copy as the app exits, then really quit. The database stays open
  // until the copy is finished, so the backup is never a half-written file.
  if (closingBackupDone || !db) { shutdown(); return; }
  const config = backupConfig();
  if (!config.auto || !config.onClose || closingBackup) { closingBackupDone = true; if (!closingBackup) shutdown(); return; }
  event.preventDefault();
  closingBackup = runAutoBackup('close').finally(() => { closingBackup = null; closingBackupDone = true; shutdown(); app.quit(); });
});
process.on('uncaughtException',error=>{console.error(error);if(app.isReady())dialog.showErrorBox('Application error',error.message);});
