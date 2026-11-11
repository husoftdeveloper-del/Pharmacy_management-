import {api,state,money,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,modal,form,field,bindForm,toast,run,refreshOptions} from '../components/ui.js';
import {bindPaymentAccount} from '../components/payment-fields.js';

/* Employees: two totals, a search with an active/all switch and the team table.
   Adding or editing a team member uses the shared staff record form. */
export async function render(root){
  root.innerHTML=`
    <header class="page-heading employees-heading">
      <div><h1>${e(t('employees'))}</h1></div>
      <div class="heading-actions">${button(t('newEmployee'),'plus','primary','id="new-employee"')}</div>
    </header>
    <div class="stat-grid employees-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('activeEmployees'))}</span><span class="stat-icon blue">${icon('users',18)}</span></div><div class="stat-value"><span>0</span></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('monthlyPayroll'))}</span><span class="stat-icon">${icon('wallet',18)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
    </div>
    <section class="card employees-filter">
      <label class="employees-search">${icon('search',18)}<input id="employee-search" type="search" autocomplete="off" placeholder="${e(t('search'))}" aria-label="${e(t('search'))}"></label>
      <span class="employees-select"><select id="employee-filter" aria-label="${e(t('status'))}"><option value="active">${e(t('activeOnly'))}</option><option value="">${e(t('allEmployees'))}</option></select>${icon('chevron',16)}</span>
    </section>
    <section class="card employees-card">
      <div class="table-scroll"><table class="employees-table">
        <thead><tr><th>${e(t('name'))}</th><th>${e(t('position'))}</th><th>${e(t('phone'))}</th><th class="text-end">${e(t('monthlySalary'))}</th><th>${e(t('joinDate'))}</th><th>${e(t('status'))}</th><th class="text-end">${e(t('actions'))}</th></tr></thead>
        <tbody id="employee-rows"></tbody>
      </table></div>
    </section>`;

  let rows=[],search='',filter='active',timer;
  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=rows.filter(row=>{
      if(filter==='active'&&Number(row.active)!==1)return false;
      if(!term)return true;
      return [row.name,row.position,row.phone].some(value=>String(value||'').toLowerCase().includes(term));
    });
    root.querySelector('#employee-rows').innerHTML=visible.length?visible.map(row=>`<tr>
        <td><strong>${e(row.name)}</strong></td>
        <td class="muted">${row.position?e(row.position):'—'}</td>
        <td class="nowrap muted">${row.phone?e(row.phone):'—'}</td>
        <td class="text-end nowrap">${money(row.salary)}</td>
        <td class="nowrap muted">${row.hired_on?e(row.hired_on):'—'}</td>
        <td><span class="badge ${Number(row.active)===1?'good':'muted'}"><i></i>${e(t(Number(row.active)===1?'active':'inactive'))}</span></td>
        <td class="text-end nowrap"><button class="btn btn-ghost btn-sm" data-advance="${row.id}">${e(t('advance'))}</button><button class="btn btn-ghost btn-sm" data-edit="${row.id}">${e(t('edit'))}</button></td>
      </tr>`).join(''):`<tr><td colspan="7" class="employees-empty-cell"><div class="employees-empty"><div class="employees-empty-icon">${icon('users',26)}</div><h3>${e(t(rows.length?'noEmployeeMatch':'noEmployees'))}</h3><p>${e(t(rows.length?'noEmployeeMatchHint':'noEmployeesHint'))}</p></div></td></tr>`;
    root.querySelectorAll('[data-edit]').forEach(node=>node.onclick=()=>openEmployee(rows.find(row=>row.id===Number(node.dataset.edit))));
    root.querySelectorAll('[data-advance]').forEach(node=>node.onclick=()=>openAdvance(rows.find(row=>row.id===Number(node.dataset.advance))));
  };

  async function load(){
    const book=await api('employeeBook');
    rows=book.rows||[];
    const cells=root.querySelectorAll('.employees-stats .stat-value span');
    cells[0].textContent=String(book.totals.active);
    cells[1].textContent=money(book.totals.payroll);
    paint();
  }

  const openEmployee=record=>run(async()=>{
    await refreshOptions();
    const m=modal(record?t('editEmployee'):t('newEmployee'),form(
      field('name',record?.name||'',{required:true})+
      field('position',record?.position||'')+
      field('phone',record?.phone||'')+
      field('salary',record?.salary??'',{type:'number',step:'0.01',required:true,hint:t('monthlySalaryHint')})+
      field('hired_on',record?.hired_on||'',{type:'date'})+
      field('active',record?Number(record.active):1,{type:'checkbox'})
    ));
    bindForm(m.root,async data=>{
      await api('save',{entity:'staff',id:record?.id,record:{...data,salary:Number(data.salary)}});
      toast(t('recordSaved'));
      await load();
    },m.close);
  });

  const openAdvance=record=>run(async()=>{
    await refreshOptions();
    const m=modal(t('newAdvance'),form(
      field('staff_id',String(record.id),{options:state.options.staff,required:true,disabled:true})+
      field('amount','',{type:'number',step:'0.01',required:true})+
      field('note','',{type:'textarea'})+
      field('method','cash',{options:['cash','bank'].map(value=>({value,label:t(value)})),required:true})+
      field('account_id','',{options:state.options.accounts,required:true}),t('record')));
    bindPaymentAccount(m.root);
    bindForm(m.root,async data=>{
      await api('advance',{staffId:record.id,amount:data.amount,note:data.note,method:data.method,accountId:data.account_id});
      toast(t('recordSaved'));
      await load();
    },m.close);
  });

  root.querySelector('#employee-search').oninput=event=>{search=event.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  root.querySelector('#employee-filter').onchange=event=>{filter=event.target.value;paint();};
  root.querySelector('#new-employee').onclick=()=>openEmployee(null);
  await run(load);
  return ()=>clearTimeout(timer);
}
