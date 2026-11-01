import {state,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';

// Keep the visible account choices consistent with the selected payment method.
// The main process still validates the account, method, permissions and register.
export function bindPaymentAccount(root,{allowCredit=false}={}){
  const method=root.querySelector('[name="method"]');
  const account=root.querySelector('[name="account_id"]');
  if(!method||!account)return;
  const wrapper=account.closest('.field');
  const accounts=state.options.accounts||[];
  const update=()=>{
    const credit=allowCredit&&method.value==='credit';
    const choices=accounts.filter(a=>method.value==='bank'?a.code!=='1000':a.code==='1000');
    const previous=account.value;
    account.innerHTML=(credit?'':`<option value="">${e(t('none'))}</option>`)+choices.map(a=>`<option value="${e(a.id)}">${e(a.name)}</option>`).join('');
    if(credit){
      account.value='';account.disabled=true;account.required=false;
      if(wrapper)wrapper.hidden=true;
    }else{
      if(wrapper)wrapper.hidden=false;
      account.disabled=false;account.required=true;
      account.value=choices.some(a=>String(a.id)===previous)?previous:String(choices[0]?.id??'');
    }
  };
  method.addEventListener('change',update);
  update();
}
