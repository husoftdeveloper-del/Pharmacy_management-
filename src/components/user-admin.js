import {api,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {button,modal,form,field,bindForm,toast,table,badge,run} from './ui.js';

/* The team account list, shared by the Settings → Users tab and the Users page.
   Administrators always keep every module, so their boxes are ticked and locked. */
export const modules=['dashboard','pos','sales','returns','customers','customerpayments','medicines','pricelist','printlabels','inventory','barcodes','purchases','suppliers','supplierpayments','expenses','ledger','finance','staff','employees','salaries','advances','register','prescriptions','categories','patients','manufacturers','locations','transfers','adjustments','banking','offers','stockcount','reports','users','audit','settings','backup'];
const defaults={admin:modules,pharmacist:['dashboard','pos','sales','returns','customers','customerpayments','medicines','inventory','pricelist','barcodes','purchases','suppliers','supplierpayments','expenses','ledger','employees','salaries','advances','prescriptions','categories','patients','manufacturers','transfers','adjustments','offers','stockcount','reports'],cashier:['dashboard','pos','sales','returns','customers','customerpayments','patients','prescriptions','register','barcodes'],accountant:['dashboard','sales','returns','customers','customerpayments','suppliers','purchases','expenses','ledger','finance','staff','employees','salaries','advances','register','banking','reports','backup']};

export async function renderUsers(container,{onSaved}={}){
  container.innerHTML=`<div class="user-admin-head"><p>${e(t('usersHint'))}</p>${button(t('add'),'plus','primary','id="add-user"')}</div><div id="user-rows"></div>`;
  const load=async()=>{
    const result=await api('list',{entity:'users',limit:200});
    container.querySelector('#user-rows').innerHTML=table(['name','username','role','active','actions'],result.rows,row=>`<tr>
        <td><strong>${e(row.name)}</strong></td>
        <td class="mono">${e(row.username)}</td>
        <td>${e(t(row.role))}</td>
        <td>${badge(row.active?'active':'inactive')}</td>
        <td class="text-end"><button class="btn btn-ghost btn-sm" data-user="${row.id}">${e(t('edit'))}</button></td>
      </tr>`);
    container.querySelectorAll('[data-user]').forEach(node=>node.onclick=()=>open(result.rows.find(row=>row.id===Number(node.dataset.user))));
  };
  const open=(user={})=>{
    let overrides={};
    try{overrides=JSON.parse(user.permissions||'{}')||{};}catch{overrides={};}
    const admin=(user.role||'cashier')==='admin';
    const m=modal(t('users'),form(
      field('name',user.name||'',{required:true})+
      field('username',user.username||'',{required:true})+
      field('role',user.role||'cashier',{options:['admin','pharmacist','cashier','accountant'].map(value=>({value,label:t(value)})),required:true,blank:false})+
      field('password','',{type:'password',required:!user.id,label:'password',hint:t('passwordHint')})+
      `<div class="full"><h3>${e(t('permissions'))}</h3><div class="permissions-grid">${modules.map(key=>`<label><input type="checkbox" name="permission_${key}" ${admin||(overrides[key]??defaults[user.role||'cashier'].includes(key))?1:0} ${admin?'disabled checked':''}>${e(t(key))}</label>`).join('')}</div><p class="permission-note">${e(t('permissionNote'))}</p></div>`+
      field('active',user.active??1,{type:'checkbox'})
    ),user.id?t('save'):t('create'));
    m.root.querySelector('[name=role]').onchange=event=>{
      const role=event.target.value;
      m.root.querySelectorAll('[name^=permission_]').forEach(el=>{
        const key=el.name.slice(11);
        el.checked=role==='admin'?true:defaults[role].includes(key);
        el.disabled=role==='admin';
      });
    };
    bindForm(m.root,async data=>{
      const permissions={};
      for(const key of modules)permissions[key]=data[`permission_${key}`]===1;
      await api('saveUser',{...data,id:user.id,permissions});
      toast(t('recordSaved'));
      await load();
      onSaved?.();
    },m.close);
  };
  container.querySelector('#add-user').onclick=()=>run(()=>open({}));
  await run(load);
}
