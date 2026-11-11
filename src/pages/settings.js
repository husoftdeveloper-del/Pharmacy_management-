import {api,state,escapeHTML as e} from '../scripts/api.js';
import {t,setLanguage,translatePage} from '../scripts/i18n.js';
import {icon,button,form,field,bindForm,toast,run,confirmAction} from '../components/ui.js';
import {renderUsers} from '../components/user-admin.js';
import {APP_LABEL,APP_BUILD,APP_VERSION} from '../scripts/version.js';

/* Settings: eight tabs in one page — Profile, Pharmacy, Receipt, Notifications,
   Appearance, Users, Data and License. Each tab owns its card and its own save
   action, so nothing is saved by accident from another tab. */
const TABS=[
  {key:'profile',label:'tabProfile',symbol:'users'},
  {key:'pharmacy',label:'tabPharmacy',symbol:'box'},
  {key:'receipt',label:'tabReceipt',symbol:'file'},
  {key:'notifications',label:'tabNotifications',symbol:'bell'},
  {key:'appearance',label:'tabAppearance',symbol:'sun'},
  {key:'users',label:'tabUsers',symbol:'shield'},
  {key:'data',label:'tabData',symbol:'download'},
  {key:'license',label:'tabLicense',symbol:'lock'}
];

export async function render(root,params={}){
  root.innerHTML=`
    <header class="page-heading settings-heading">
      <div><h1>${e(t('settings'))}</h1><p>${e(t('settingsHint'))}</p></div>
    </header>
    <div class="settings-tabs" role="tablist">
      ${TABS.map(tab=>`<button class="settings-tab" role="tab" aria-selected="false" data-tab="${tab.key}">${icon(tab.symbol,15)}<span>${e(t(tab.label))}</span></button>`).join('')}
    </div>
    <div id="settings-body"></div>`;

  let tab=TABS.some(item=>item.key===params.tab)?params.tab:'profile';

  const refreshPreferences=async()=>{
    state.preferences=await api('preferences');
    setLanguage(state.preferences.language);translatePage(document);const crumb=document.querySelector('#breadcrumb-page');if(crumb)crumb.textContent=t(state.page);
    document.documentElement.dataset.theme=state.preferences.theme;
    const select=document.querySelector('#language-select');if(select)select.value=state.preferences.language;
  };

  const saveSettings=async payload=>{
    await api('settings',payload);
    await refreshPreferences();
    toast(t('recordSaved'));
  };

  const paintProfile=()=>{
    const p=state.preferences;
    return `<div class="settings-grid">
      <section class="card settings-card">
        <header class="settings-card-head">${icon('users',18)}<div><h2>${e(t('yourProfile'))}</h2><p>${e(t('yourProfileHint'))}</p></div></header>
        <form class="record-form" id="profile-form">
          <div class="form-grid">
            ${field('name',state.user.name,{required:true,label:'fullName'})}
            ${field('username',state.user.username,{required:true,label:'username'})}
          </div>
          <p class="settings-role">${e(t('role'))}: <strong>${e(t(state.user.role))}</strong></p>
          <div class="form-error" role="alert"></div>
          <footer class="form-footer"><button class="btn btn-primary" type="submit"><span>${e(t('save'))}</span></button></footer>
        </form>
      </section>
      <section class="card settings-card">
        <header class="settings-card-head">${icon('lock',18)}<div><h2>${e(t('changePassword'))}</h2><p>${e(t('changePasswordHint'))}</p></div></header>
        <form class="record-form" id="password-form">
          <div class="form-grid">
            ${field('currentPassword','',{type:'password',required:true,label:'currentPassword'})}
            ${field('newPassword','',{type:'password',required:true,label:'newPassword'})}
            ${field('confirmPassword','',{type:'password',required:true,label:'confirmPassword'})}
          </div>
          <div class="form-error" role="alert"></div>
          <footer class="form-footer"><button class="btn btn-primary" type="submit"><span>${e(t('updatePassword'))}</span></button></footer>
        </form>
      </section>
    </div>`;
  };

  const paintPharmacy=()=>{
    const p=state.preferences;
    return `<section class="card settings-card">
      <header class="settings-card-head">${icon('box',18)}<div><h2>${e(t('pharmacyDetails'))}</h2><p>${e(t('pharmacyDetailsHint'))}</p></div></header>
      <form class="record-form" id="pharmacy-form">
        <div class="form-grid">
          ${field('pharmacy_name',p.pharmacy_name,{required:true,label:'pharmacyName'})}
          ${field('phone',p.phone,{label:'phone'})}
          ${field('currency',p.currency,{required:true,label:'currency',hint:t('currencyHint')})}
          ${field('tax_percent',p.tax_percent,{type:'number',step:'0.01',label:'taxPercent'})}
          ${field('address',p.address,{type:'textarea',label:'address'})}
        </div>
        <div class="form-error" role="alert"></div>
        <footer class="form-footer"><button class="btn btn-primary" type="submit"><span>${e(t('save'))}</span></button></footer>
      </form>
    </section>`;
  };

  const paintReceipt=()=>{
    const p=state.preferences;
    return `<div class="settings-grid">
      <section class="card settings-card">
        <header class="settings-card-head">${icon('file',18)}<div><h2>${e(t('receipt'))}</h2><p>${e(t('receiptHint'))}</p></div></header>
        <form class="record-form" id="receipt-form">
          <div class="form-grid">
            ${field('receipt_footer',p.receipt_footer,{type:'textarea',label:'receiptFooter',hint:t('receiptFooterHint')})}
          </div>
          <div class="form-error" role="alert"></div>
          <footer class="form-footer"><button class="btn btn-primary" type="submit"><span>${e(t('save'))}</span></button></footer>
        </form>
      </section>
      <section class="card settings-card settings-preview">
        <header class="settings-card-head">${icon('printer',18)}<div><h2>${e(t('receiptPreview'))}</h2><p>${e(t('receiptPreviewHint'))}</p></div></header>
        <div class="receipt-preview">
          <strong>${e(p.pharmacy_name||'')}</strong>
          <span class="muted">${e(p.address||'')} ${e(p.phone||'')}</span>
          <div class="receipt-rule"></div>
          <span class="muted">${e(t('invoiceNoShort'))} 0001 · ${e(t('total'))} ${e(p.currency||'')} 0.00</span>
          <div class="receipt-rule"></div>
          <span>${e(p.receipt_footer||'')}</span>
        </div>
      </section>
    </div>`;
  };

  const paintNotifications=()=>{
    const p=state.preferences;
    const enabled=key=>p[key]==='1'||p[key]===1;
    return `<section class="card settings-card">
      <header class="settings-card-head">${icon('bell',18)}<div><h2>${e(t('notifications'))}</h2><p>${e(t('notificationsHint'))}</p></div></header>
      <form class="record-form" id="notifications-form">
        <div class="form-grid">
          ${field('low_stock_days',p.low_stock_days,{type:'number',label:'expiryDays',hint:t('expiryDaysHint')})}
          <div class="full settings-switches">
            <label class="switch-row"><input type="checkbox" name="notify_low_stock" ${enabled('notify_low_stock')?'checked':''}><span><strong>${e(t('notifyLowStock'))}</strong><small>${e(t('notifyLowStockHint'))}</small></span></label>
            <label class="switch-row"><input type="checkbox" name="notify_expiry" ${enabled('notify_expiry')?'checked':''}><span><strong>${e(t('notifyExpiry'))}</strong><small>${e(t('notifyExpiryHint'))}</small></span></label>
            <label class="switch-row"><input type="checkbox" name="notify_register" ${enabled('notify_register')?'checked':''}><span><strong>${e(t('notifyRegister'))}</strong><small>${e(t('notifyRegisterHint'))}</small></span></label>
          </div>
        </div>
        <div class="form-error" role="alert"></div>
        <footer class="form-footer"><button class="btn btn-primary" type="submit"><span>${e(t('save'))}</span></button></footer>
      </form>
    </section>`;
  };

  const paintAppearance=()=>{
    const p=state.preferences;
    return `<section class="card settings-card">
      <header class="settings-card-head">${icon('sun',18)}<div><h2>${e(t('appearance'))}</h2><p>${e(t('appearanceHint'))}</p></div></header>
      <form class="record-form" id="appearance-form">
        <div class="settings-choice-row">
          <button type="button" class="theme-choice ${p.theme!=='dark'?'active':''}" data-theme-choice="light">${icon('sun',18)}<span>${e(t('light'))}</span></button>
          <button type="button" class="theme-choice ${p.theme==='dark'?'active':''}" data-theme-choice="dark">${icon('moon',18)}<span>${e(t('dark'))}</span></button>
        </div>
        <div class="form-grid">
          ${field('language',p.language,{label:'language',blank:false,options:[{value:'en',label:'English'},{value:'ps',label:'پښتو'},{value:'fa-AF',label:'دری'}]})}
        </div>
        <div class="form-error" role="alert"></div>
        <footer class="form-footer"><button class="btn btn-primary" type="submit"><span>${e(t('save'))}</span></button></footer>
      </form>
    </section>`;
  };

  const paintData=()=>{
    const admin=state.user.role==='admin';
    return `<section class="card settings-card settings-data">
      <header class="settings-card-head">${icon('download',18)}<div><h2>${e(t('data'))}</h2><p>${e(t('backupHint'))}</p></div></header>
      <div class="settings-action-row">
        <div><strong>${e(t('backupNow'))}</strong><p>${e(t('backupDataHint'))}</p></div>
        ${button(t('backupNow'),'download','primary','id="backup-now"')}
      </div>
      <div class="settings-action-row">
        <div><strong>${e(t('restore'))}</strong><p>${e(t('restoreDataHint'))}</p></div>
        ${admin?button(t('restore'),'shield','secondary','id="restore-now"'):`<span class="badge muted">${e(t('adminOnly'))}</span>`}
      </div>
      <p class="settings-note">${icon('lock',15)}<span>${e(t('backupWarning'))}</span></p>
    </section>`;
  };

  const paintLicense=()=>`<section class="card settings-card settings-license">
      <header class="settings-card-head">${icon('lock',18)}<div><h2>${e(t('license'))}</h2><p>${e(t('licenseHint'))}</p></div></header>
      <div class="license-grid">
        <div><span>${e(t('application'))}</span><strong>Pharmacy Management</strong></div>
        <div><span>${e(t('version'))}</span><strong>${e(APP_VERSION)}</strong></div>
        <div><span>${e(t('build'))}</span><strong class="mono">${e(APP_BUILD)}</strong></div>
        <div><span>${e(t('registeredTo'))}</span><strong>${e(state.preferences.pharmacy_name||'')}</strong></div>
        <div><span>${e(t('licenseStatus'))}</span><strong>${e(t('singleInstallation'))}</strong></div>
        <div><span>${e(t('signInAs'))}</span><strong>${e(state.user.name)}</strong></div>
      </div>
      <p class="settings-note">${e(t('licenseNote'))}</p>
      <p class="app-build-info">${e(APP_LABEL)}</p>
    </section>`;

  const bind=()=>{
    const body=root.querySelector('#settings-body');
    if(tab==='profile'){
      body.querySelector('#profile-form').onsubmit=async event=>{
        event.preventDefault();
        const formEl=event.currentTarget;
        const data=Object.fromEntries(new FormData(formEl));
        try{
          const updated=await api('profile',{name:data.name,username:data.username});
          state.user={...state.user,...updated};
          formEl.querySelector('.form-error').textContent='';
          toast(t('recordSaved'));
          const chip=document.querySelector('.profile strong');if(chip)chip.textContent=state.user.name;
          const avatar=document.querySelector('.profile .avatar');if(avatar)avatar.textContent=state.user.name.split(' ').filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase();
        }catch(error){formEl.querySelector('.form-error').textContent=error.message;}
      };
      body.querySelector('#password-form').onsubmit=async event=>{
        event.preventDefault();
        const formEl=event.currentTarget;
        const data=Object.fromEntries(new FormData(formEl));
        try{
          if(data.newPassword!==data.confirmPassword)throw new Error(t('passwordMismatch'));
          await api('changePassword',{currentPassword:data.currentPassword,newPassword:data.newPassword});
          formEl.reset();
          formEl.querySelector('.form-error').textContent='';
          toast(t('passwordChanged'));
        }catch(error){formEl.querySelector('.form-error').textContent=error.message;}
      };
      return;
    }
    if(tab==='pharmacy')bindSettingsForm('#pharmacy-form');
    if(tab==='receipt')bindSettingsForm('#receipt-form',()=>{refreshLanding();});
    if(tab==='appearance'){
      let theme=state.preferences.theme;
      body.querySelectorAll('[data-theme-choice]').forEach(node=>node.onclick=()=>{
        theme=node.dataset.themeChoice;
        body.querySelectorAll('[data-theme-choice]').forEach(other=>other.classList.toggle('active',other===node));
        document.documentElement.dataset.theme=theme;
      });
      body.querySelector('#appearance-form').onsubmit=async event=>{
        event.preventDefault();
        const data=Object.fromEntries(new FormData(event.currentTarget));
        await run(async()=>{
          await api('preference',{theme});
          await api('preference',{language:data.language});
          await refreshPreferences();
          await paint();
          toast(t('recordSaved'));
        });
      };
      return;
    }
    if(tab==='notifications'){
      body.querySelector('#notifications-form').onsubmit=async event=>{
        event.preventDefault();
        const formEl=event.currentTarget;
        const data=new FormData(formEl);
        await run(async()=>{
          try{
            await saveSettings({
              low_stock_days:data.get('low_stock_days'),
              notify_low_stock:data.get('notify_low_stock')?1:0,
              notify_expiry:data.get('notify_expiry')?1:0,
              notify_register:data.get('notify_register')?1:0
            });
            formEl.querySelector('.form-error').textContent='';
          }catch(error){formEl.querySelector('.form-error').textContent=error.message;}
        });
      };
      return;
    }
    if(tab==='users'){
      renderUsers(body.querySelector('#settings-users'));
      return;
    }
    if(tab==='data'){
      body.querySelector('#backup-now').onclick=()=>run(async()=>{
        const result=await api('backup');
        if(!result.cancelled)toast(result.path);
      });
      body.querySelector('#restore-now')?.addEventListener('click',()=>run(async()=>{
        if(await confirmAction(t('restore'),t('restoreConfirm'))){const result=await api('restore');if(!result.cancelled)toast(t('success'));}
      }));
    }
  };

  const bindSettingsForm=(selector,after)=>{
    const formEl=root.querySelector(selector);
    formEl.onsubmit=async event=>{
      event.preventDefault();
      const data=Object.fromEntries(new FormData(formEl));
      try{
        await saveSettings(data);
        formEl.querySelector('.form-error').textContent='';
        after?.();
      }catch(error){formEl.querySelector('.form-error').textContent=error.message;}
    };
  };

  const refreshLanding=()=>{ if(tab==='receipt')paint(); };

  const paint=async()=>{
    root.querySelectorAll('[data-tab]').forEach(node=>{const active=node.dataset.tab===tab;node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));});
    const body=root.querySelector('#settings-body');
    if(tab==='users'){
      body.innerHTML=`<section class="card settings-card">
        <header class="settings-card-head">${icon('users',18)}<div><h2>${e(t('users'))}</h2><p>${e(t('usersHint'))}</p></div></header>
        <div id="settings-users"></div>
      </section>`;
    }else if(tab==='data'){
      body.innerHTML=paintData();
    }else if(tab==='license'){
      body.innerHTML=paintLicense();
    }else if(tab==='profile'){
      body.innerHTML=paintProfile();
    }else if(tab==='pharmacy'){
      body.innerHTML=paintPharmacy();
    }else if(tab==='receipt'){
      body.innerHTML=paintReceipt();
    }else if(tab==='notifications'){
      body.innerHTML=paintNotifications();
    }else{
      body.innerHTML=paintAppearance();
    }
    bind();
  };

  root.querySelectorAll('[data-tab]').forEach(node=>node.onclick=()=>{tab=node.dataset.tab;run(paint);});
  await run(paint);
}
