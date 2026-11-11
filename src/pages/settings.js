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

  // Receipt: a printed layout picker, the paper and copy count, and a live
  // preview that is rebuilt from the same preferences the PDF renderer reads.
  const RECEIPT_TEMPLATES=[
    {key:'classic',label:'templateClassic',hint:'templateClassicHint'},
    {key:'compact',label:'templateCompact',hint:'templateCompactHint'},
    {key:'boxed',label:'templateBoxed',hint:'templateBoxedHint'}
  ];
  const RECEIPT_PAPERS=['80mm','58mm','A4'];
  const receiptConfig=()=>{
    const p=state.preferences;
    return {
      template:RECEIPT_TEMPLATES.some(item=>item.key===p.receipt_template)?p.receipt_template:'classic',
      paper:RECEIPT_PAPERS.includes(p.receipt_paper)?p.receipt_paper:'80mm',
      copies:Math.min(5,Math.max(1,Number(p.receipt_copies)||1))
    };
  };
  const receiptPreview=(config)=>{
    const p=state.preferences;
    const money=value=>Number(value).toFixed(2);
    const items=[{name:'Paracetamol 500mg',quantity:2,price:10},{name:'Amoxicillin 500mg',quantity:1,price:20}];
    const subtotal=items.reduce((sum,item)=>sum+item.quantity*item.price,0);
    const discount=1,total=subtotal-discount;
    const stamp=new Date().toISOString().slice(0,16).replace('T',' ');
    return `<div class="receipt-sheet t-${config.template} p-${config.paper}">
        <header class="receipt-head"><strong>${e(p.pharmacy_name||'Pharmacy Management')}</strong>
          ${p.address?`<small>${e(p.address)}</small>`:''}
          ${p.phone?`<small>${e(p.phone)}</small>`:''}
        </header>
        <div class="receipt-meta"><span>${e(t('invoiceNoShort'))}</span><b>INV-1001</b><span>${e(t('date'))}</span><b>${e(stamp)}</b><span>${e(t('cashier'))}</span><b>${e(state.user.name)}</b></div>
        <div class="receipt-items">
          <div class="receipt-line receipt-line-head"><span>${e(t('item'))}</span><span>${e(t('total'))}</span></div>
          ${items.map(item=>`<div class="receipt-line"><span class="receipt-name">${e(item.name)}<small>${item.quantity} × ${money(item.price)}</small></span><span>${money(item.quantity*item.price)}</span></div>`).join('')}
        </div>
        <div class="receipt-totals">
          <div><span>${e(t('subtotal'))}</span><b>${money(subtotal)}</b></div>
          <div><span>${e(t('discount'))}</span><b>- ${money(discount)}</b></div>
          <div class="receipt-grand"><span>${e(t('total'))}</span><b>${money(total)}</b></div>
        </div>
        <footer class="receipt-foot">${e(p.receipt_footer||'')}</footer>
      </div>`;
  };

  const paintReceipt=()=>{
    const config=receiptConfig();
    return `<div class="settings-grid receipt-grid">
      <div class="settings-stack">
        <section class="card settings-card">
          <header class="settings-card-head">${icon('file',18)}<div><h2>${e(t('receiptTemplate'))}</h2><p>${e(t('receiptTemplateHint'))}</p></div></header>
          <div class="template-row" role="radiogroup" aria-label="${e(t('receiptTemplate'))}">
            ${RECEIPT_TEMPLATES.map(item=>`<button type="button" class="template-card ${item.key===config.template?'active':''}" role="radio" aria-checked="${item.key===config.template}" data-template="${item.key}">
              <span class="template-check">${icon('check',13)}</span>
              <strong>${e(t(item.label))}</strong>
              <small>${e(t(item.hint))}</small>
            </button>`).join('')}
          </div>
        </section>
        <section class="card settings-card">
          <header class="settings-card-head">${icon('printer',18)}<div><h2>${e(t('receiptLayout'))}</h2><p>${e(t('receiptLayoutHint'))}</p></div></header>
          <div class="form-grid receipt-fields">
            <label class="field"><span>${e(t('paperSize'))}</span>
              <select name="receipt_paper" id="receipt-paper">${RECEIPT_PAPERS.map(paper=>`<option value="${paper}" ${paper===config.paper?'selected':''}>${paper}</option>`).join('')}</select>
            </label>
            <label class="field"><span>${e(t('copiesToPrint'))}</span>
              <input name="receipt_copies" id="receipt-copies" type="number" min="1" max="5" step="1" value="${config.copies}">
            </label>
            <label class="field full"><span>${e(t('receiptFooter'))}</span>
              <textarea name="receipt_footer" id="receipt-footer" rows="2" maxlength="400">${e(state.preferences.receipt_footer||'')}</textarea>
              <small>${e(t('receiptFooterHint'))}</small>
            </label>
          </div>
          <p class="settings-note">${icon('lock',15)}<span>${e(t('receiptAutoHint'))}</span></p>
        </section>
      </div>
      <section class="card settings-card settings-preview">
        <header class="settings-card-head"><div><h2>${e(t('livePreview'))}</h2><p>${e(t('livePreviewHint'))}</p></div></header>
        <div class="receipt-preview" id="receipt-preview">${receiptPreview(config)}</div>
        <p class="settings-role">${e(t('receiptCopiesNote'))}: <strong>${config.copies}</strong> · ${e(config.paper)}</p>
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
    if(tab==='receipt'){
      const body=root.querySelector('#settings-body');
      const config=receiptConfig();
      let pending=null;
      const repaint=()=>{
        const next=receiptConfig();
        body.querySelectorAll('[data-template]').forEach(node=>{
          const active=node.dataset.template===next.template;
          node.classList.toggle('active',active);
          node.setAttribute('aria-checked',String(active));
        });
        body.querySelector('#receipt-preview').innerHTML=receiptPreview(next);
        const note=body.querySelector('.settings-preview .settings-role');
        if(note)note.innerHTML=`${e(t('receiptCopiesNote'))}: <strong>${next.copies}</strong> · ${e(next.paper)}`;
      };
      const save=async(patch)=>{
        try{
          await api('settings',patch);
          await refreshPreferences();
          repaint();
          toast(t('recordSaved'));
        }catch(error){toast(error.message);}
      };
      body.querySelectorAll('[data-template]').forEach(node=>node.onclick=()=>save({receipt_template:node.dataset.template}));
      body.querySelector('#receipt-paper').onchange=event=>save({receipt_paper:event.target.value});
      const footer=body.querySelector('#receipt-footer');
      footer.onchange=()=>save({receipt_footer:footer.value});
      const copies=body.querySelector('#receipt-copies');
      copies.onchange=()=>{
        const value=Math.min(5,Math.max(1,Number(copies.value)||config.copies));
        copies.value=String(value);
        save({receipt_copies:value});
      };
      return;
    }
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

  const paint=async()=>{
    if(tab==='receipt')await refreshPreferences();
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
