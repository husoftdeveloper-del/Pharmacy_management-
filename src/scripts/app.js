import {api,state,money,escapeHTML as e,today} from './api.js';
import {t,setLanguage,translatePage,getLanguage} from './i18n.js';
import {icon,toast,run,refreshOptions} from '../components/ui.js';
import {navigation,pageDescriptions} from './navigation.js';
import {APP_BUILD,APP_LABEL} from './version.js';
const app=document.querySelector('#app');
let currentPageCleanup=null,navigateTimer=null;
function brand(){return `<div class="brand"><div class="brand-mark">${icon('plus',28)}</div><div class="brand-name">Pharmaca<small>MANAGEMENT SYSTEM</small></div></div>`;}
function languageButtons(){return `<div class="auth-language">${[['en','English'],['ps','پښتو'],['fa-AF','دری']].map(([value,label])=>`<button data-lang="${value}" class="${getLanguage()===value?'active':''}">${label}</button>`).join('')}</div>`;}
async function authScreen(setup=false){
  state.user=null;state.permissions=[];
  app.innerHTML=`<main class="auth-screen"><section class="auth-art">${brand()}<div class="auth-art-copy"><div class="eyebrow" data-i18n="${setup?'firstRun':'secure'}"></div><h1 data-i18n="${setup?'setupTitle':'loginTitle'}"></h1><p data-i18n="${setup?'setupSubtitle':'loginSubtitle'}"></p><div class="auth-illustration"><div class="auth-cross">${icon('plus',65)}</div></div></div><div class="auth-art-bottom"><span>${icon('shield',16)}<span data-i18n="offline"></span></span><span>${icon('lock',16)}<span data-i18n="localData"></span></span></div></section><section class="auth-panel"><div class="auth-form-wrap"><div class="eyebrow" data-i18n="${setup?'firstRun':'welcome'}"></div><h2 data-i18n="${setup?'setup':'loginTitle'}"></h2><p data-i18n="${setup?'setupSubtitle':'loginSubtitle'}"></p><form id="auth-form"><div class="form-grid">${setup?`<label class="field"><span data-i18n="pharmacyName"></span><input name="pharmacyName" required maxlength="120"></label><label class="field"><span data-i18n="name"></span><input name="name" required maxlength="100" autocomplete="name"></label>`:''}<label class="field"><span data-i18n="username"></span><input name="username" required minlength="3" maxlength="40" autocomplete="username" pattern="[A-Za-z0-9._\\-]+"></label><label class="field"><span data-i18n="password"></span><input name="password" type="password" required minlength="${setup?10:1}" maxlength="128" autocomplete="${setup?'new-password':'current-password'}">${setup?'<small>At least 10 characters. There is no default password.</small>':''}</label></div><div class="form-error" role="alert"></div><div class="form-footer"><button class="btn btn-primary" type="submit"><span data-i18n="${setup?'setup':'login'}"></span>${icon('arrow',18)}</button></div></form>${languageButtons()}<div class="auth-privacy">${icon('shield')}<span data-i18n="privacy"></span><small class="app-build">${APP_BUILD}</small></div></div></section></main>`;
  translatePage(app);
  app.querySelectorAll('[data-lang]').forEach(b=>b.onclick=()=>{setLanguage(b.dataset.lang);authScreen(setup);});
  app.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const form=ev.currentTarget,button=form.querySelector('button');button.disabled=true;try{const data=Object.fromEntries(new FormData(form));const result=await api(setup?'setup':'login',data);await startSession(result);}catch(error){form.querySelector('.form-error').textContent=error.message;button.disabled=false;}};
}
async function startSession(result){
  state.user=result.user;state.permissions=result.permissions;state.preferences=await api('preferences');setLanguage(state.preferences.language);document.documentElement.dataset.theme=state.preferences.theme;
  await refreshOptions();renderShell();await navigate(state.permissions.includes('dashboard')?'dashboard':state.permissions[0]||'settings');
}
function renderShell(){
 app.innerHTML=`<div class="app-shell"><aside class="sidebar">${brand()}<nav class="sidebar-scroll" aria-label="Main navigation">${navigation.map(group=>{const items=group.items.filter(([key])=>state.permissions.includes(key));return items.length?`<div class="nav-group" data-i18n="${group.group}"></div>${items.map(([key,symbol])=>`<button class="nav-item" data-page="${key}">${icon(symbol)}<span data-i18n="${key}"></span>${key==='pos'?'<i class="nav-dot"></i>':''}</button>`).join('')}`:'';}).join('')}</nav><div class="sidebar-bottom"><i class="status-dot"></i><div><strong data-i18n="offline"></strong><small data-i18n="localData"></small><small class="app-build" title="${APP_LABEL}">${APP_BUILD}</small></div></div></aside><div class="workspace"><header class="topbar"><button class="icon-btn mobile-menu" id="mobile-menu" aria-label="Menu">${icon('menu')}</button><div class="breadcrumb"><span data-i18n="overview"></span>${icon('chevron',12)}<strong id="breadcrumb-page"></strong></div><label class="topbar-search">${icon('search',16)}<input id="global-search" data-i18n-placeholder="search" aria-label="Search"><kbd>Ctrl K</kbd></label><div class="topbar-tools"><select id="language-select" aria-label="Language" class="language-select"><option value="en">EN</option><option value="ps">پښتو</option><option value="fa-AF">دری</option></select><button class="icon-btn" id="theme-toggle" aria-label="Toggle theme">${icon(state.preferences.theme==='dark'?'sun':'moon',19)}</button><div class="profile"><div class="avatar">${e(state.user.name.split(' ').map(x=>x[0]).slice(0,2).join(''))}</div><div><strong>${e(state.user.name)}</strong><small>${e(t(state.user.role))}</small></div><button class="icon-btn" id="logout" aria-label="${e(t('logout'))}">${icon('logout',17)}</button></div></div></header><main class="content" id="page-content"></main></div></div>`;
 const style=document.createElement('style');style.textContent='.language-select{border:0;background:transparent;color:var(--muted);font-size:11px;max-width:65px;padding:5px;cursor:pointer}';document.head.append(style);
 translatePage(app);app.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
 app.querySelector('#language-select').value=getLanguage();
 app.querySelector('#language-select').onchange=async ev=>{await run(async()=>{await api('preference',{language:ev.target.value});state.preferences.language=ev.target.value;setLanguage(ev.target.value);renderShell();await navigate(state.page);});};
 app.querySelector('#theme-toggle').onclick=()=>run(async()=>{const theme=state.preferences.theme==='dark'?'light':'dark';await api('preference',{theme});state.preferences.theme=theme;document.documentElement.dataset.theme=theme;app.querySelector('#theme-toggle').innerHTML=icon(theme==='dark'?'sun':'moon',19);});
 app.querySelector('#logout').onclick=()=>run(async()=>{await api('logout');await authScreen(!((await api('bootstrap')).initialized));});
 app.querySelector('#mobile-menu').onclick=()=>app.querySelector('.sidebar').classList.toggle('open');
 app.querySelector('#global-search').onkeydown=ev=>{if(ev.key==='Enter'){const query=ev.target.value;navigate(state.permissions.includes('inventory')?'inventory':'pos',{search:query});}};
}
export async function navigate(page,params={}){
 if(!state.permissions.includes(page)){toast(t('noAccess'),'error');return;}
 clearTimeout(navigateTimer);currentPageCleanup?.();currentPageCleanup=null;state.page=page;
 app.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));app.querySelector('.sidebar').classList.remove('open');
 const breadcrumb=app.querySelector('#breadcrumb-page');if(breadcrumb)breadcrumb.textContent=t(page);
 const content=app.querySelector('#page-content');content.innerHTML=`<div class="loading-state"><div class="spinner"></div>${e(t('loading'))}</div>`;
 const requested=page;
 try{
  let html='';try{const response=await fetch(`./${page}.html`);if(response.ok)html=await response.text();}catch{}
  if(state.page!==requested)return;
  content.innerHTML=`<div class="page-enter">${html||'<div data-page-root></div>'}</div>`;translatePage(content);
  const module=await import(`../pages/${page}.js`);if(state.page!==requested)return;
  const root=content.querySelector('[data-page-root]')||content.firstElementChild;
  currentPageCleanup=await module.render(root,params)||null;
 }catch(error){content.innerHTML=`<div class="card"><div class="empty-state"><h3>${e(t('error'))}</h3><p>${e(error.message)}</p></div></div>`;if(error.code==='SESSION_EXPIRED')authScreen(false);}
}
window.addEventListener('session-expired',()=>authScreen(false));
document.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='k'){ev.preventDefault();app.querySelector('#global-search')?.focus();}if(ev.key==='F2'&&state.user)navigate('pos');});
async function boot(){try{const info=await api('bootstrap');if(!info.initialized)await authScreen(true);else await authScreen(false);}catch(error){app.innerHTML=`<main class="auth-panel"><div class="auth-form-wrap"><h2>Pharmacy Management</h2><p>${e(error.message)}</p><p>Install dependencies with npm install, then launch with npm start.</p></div></main>`;}}
boot();
window.addEventListener('navigate',event=>navigate(event.detail));
