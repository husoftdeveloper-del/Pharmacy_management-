import {api,state,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,modal,form,field,bindForm,toast,run,refreshOptions} from '../components/ui.js';
import {staffPaymentPayload} from '../scripts/payloads.js';
import {bindPaymentAccount} from '../components/payment-fields.js';

/* Monthly Salaries: two totals above a year/month/status filter and the payroll
   table. Issuing a salary pays the net amount, recovers the advances first and
   keeps a balanced journal entry. */
const thisMonth=()=>today().slice(0,7);

export async function render(root){
  root.innerHTML=`
    <header class="page-heading salaries-heading">
      <div><h1>${e(t('monthlySalaries'))}</h1></div>
      <div class="heading-actions">
        <button class="btn btn-secondary" type="button" id="salary-pdf">${icon('printer',16)}<span>${e(t('exportPdf'))}</span></button>
        ${button(t('issueSalary'),'plus','primary','id="issue-salary"')}
      </div>
    </header>
    <div class="stat-grid salaries-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('monthlyPayroll'))}</span><span class="stat-icon blue">${icon('wallet',18)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('pendingSalaries'))}</span><span class="stat-icon amber">${icon('clock',18)}</span></div><div class="stat-value"><span>0</span></div></article>
    </div>
    <section class="card salaries-filter">
      <span class="salaries-select"><select id="salary-year" aria-label="${e(t('year'))}"><option value="">${e(t('allYears'))}</option></select>${icon('chevron',16)}</span>
      <label class="salaries-month"><input id="salary-month" type="month" value="${thisMonth()}" aria-label="${e(t('month'))}"></label>
      <span class="salaries-select"><select id="salary-status" aria-label="${e(t('status'))}"><option value="">${e(t('all'))}</option><option value="paid">${e(t('paid'))}</option><option value="pending">${e(t('pending'))}</option></select>${icon('chevron',16)}</span>
    </section>
    <section class="card salaries-card">
      <div class="table-scroll"><table class="salaries-table">
        <thead><tr><th>${e(t('month'))}</th><th>${e(t('employee'))}</th><th class="text-end">${e(t('baseSalary'))}</th><th class="text-end">${e(t('additions'))}</th><th class="text-end">${e(t('deductions'))}</th><th class="text-end">${e(t('advanceDeduction'))}</th><th class="text-end">${e(t('netPay'))}</th><th>${e(t('status'))}</th><th>${e(t('paidDate'))}</th><th class="text-end">${e(t('actions'))}</th></tr></thead>
        <tbody id="salary-rows"></tbody>
      </table></div>
    </section>`;

  let rows=[],book=null;
  const paint=()=>{
    root.querySelector('#salary-rows').innerHTML=rows.length?rows.map(row=>`<tr>
        <td class="nowrap muted">${e(row.month)}</td>
        <td><strong>${e(row.staff)}</strong>${row.position?`<div class="muted sub">${e(row.position)}</div>`:''}</td>
        <td class="text-end nowrap">${money(row.base)}</td>
        <td class="text-end nowrap">${money(row.additions)}</td>
        <td class="text-end nowrap">${money(row.deductions)}</td>
        <td class="text-end nowrap">${money(row.advance_deduction)}</td>
        <td class="text-end nowrap"><strong>${row.status==='paid'?money(row.net):'—'}</strong></td>
        <td><span class="badge ${row.status==='paid'?'good':'warn'}"><i></i>${e(t(row.status))}</span></td>
        <td class="nowrap muted">${row.paid_date?e(String(row.paid_date).slice(0,10)):'—'}</td>
        <td class="text-end nowrap">${row.status==='paid'?`<button class="btn btn-ghost btn-sm" data-view="${row.id}">${e(t('view'))}</button>`:`<button class="btn btn-ghost btn-sm" data-pay="${row.staff_id}">${e(t('pay'))}</button>`}</td>
      </tr>`).join(''):`<tr><td colspan="10" class="salaries-empty-cell"><div class="salaries-empty"><div class="salaries-empty-icon">${icon('wallet',26)}</div><h3>${e(t('noSalaryRecords'))}</h3><p>${e(t('noSalaryFilterHint'))}</p></div></td></tr>`;
    root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>{
      const row=rows.find(item=>item.id===Number(node.dataset.view));
      modal(t('salary'),`<div class="salaries-detail">
        <div><span>${e(t('employee'))}</span><strong>${e(row.staff)}</strong></div>
        <div><span>${e(t('month'))}</span><strong>${e(row.month)}</strong></div>
        <div><span>${e(t('baseSalary'))}</span><strong>${money(row.base)}</strong></div>
        <div><span>${e(t('additions'))}</span><strong>${money(row.additions)}</strong></div>
        <div><span>${e(t('deductions'))}</span><strong>${money(row.deductions)}</strong></div>
        <div><span>${e(t('advanceDeduction'))}</span><strong>${money(row.advance_deduction)}</strong></div>
        <div><span>${e(t('netPay'))}</span><strong>${money(row.net)} ${e(state.preferences.currency)}</strong></div>
        <div><span>${e(t('paidDate'))}</span><strong>${e(String(row.paid_date).slice(0,10))}</strong></div>
        <div><span>${e(t('account'))}</span><strong>${e(row.account||'—')}</strong></div>
        <div><span>${e(t('recordedBy'))}</span><strong>${e(row.recorded_by||'—')}</strong></div>
      </div>`);
    });
    root.querySelectorAll('[data-pay]').forEach(node=>node.onclick=()=>openSalary(Number(node.dataset.pay)));
  };

  async function load(){
    book=await api('salaryBook',{year:root.querySelector('#salary-year').value,month:root.querySelector('#salary-month').value,status:root.querySelector('#salary-status').value});
    rows=book.rows||[];
    const years=root.querySelector('#salary-year');
    const current=years.value;
    const options=[...new Set([...(book.years||[]),...rows.map(row=>String(row.month).slice(0,4))])].filter(Boolean).sort().reverse();
    years.innerHTML=`<option value="">${e(t('allYears'))}</option>`+options.map(year=>`<option value="${e(year)}">${e(year)}</option>`).join('');
    years.value=current;
    const cells=root.querySelectorAll('.salaries-stats .stat-value span');
    cells[0].textContent=money(book.totals.payroll);
    cells[1].textContent=String(book.totals.pending);
    paint();
  }

  const openSalary=staffId=>run(async()=>{
    await refreshOptions();
    const staffOptions=state.options.staff||[];
    const m=modal(t('issueSalary'),form(
      field('staff_id',staffId?String(staffId):'',{options:staffOptions,required:true})+
      field('month',root.querySelector('#salary-month').value||thisMonth(),{type:'month',required:true})+
      field('gross','',{type:'number',step:'0.01',required:true,hint:t('baseSalaryHint')})+
      field('additions','',{type:'number',step:'0.01'})+
      field('deductions','',{type:'number',step:'0.01'})+
      field('method','cash',{options:['cash','bank'].map(value=>({value,label:t(value)})),required:true})+
      field('account_id','',{options:state.options.accounts,required:true}),t('issueSalary')));
    bindPaymentAccount(m.root);
    const select=m.root.querySelector('[name=staff_id]');
    const gross=m.root.querySelector('[name=gross]');
    const employee=rows.find(row=>Number(row.staff_id)===Number(select.value));
    if(employee&&!gross.value)gross.value=employee.base;
    select.onchange=()=>{
      const match=rows.find(row=>Number(row.staff_id)===Number(select.value));
      if(match)gross.value=match.base;
    };
    bindForm(m.root,async data=>{
      const result=await api('salary',staffPaymentPayload('salary',data));
      toast(`${t('recordSaved')} · ${t('netPay')} ${money(result.net)}`);
      await load();
    },m.close);
  });

  root.querySelector('#issue-salary').onclick=()=>openSalary(0);
  root.querySelector('#salary-year').onchange=()=>run(load);
  root.querySelector('#salary-month').onchange=()=>run(load);
  root.querySelector('#salary-status').onchange=()=>run(load);
  root.querySelector('#salary-pdf').onclick=()=>run(async()=>{
    const result=await api('pdf',{kind:'profit',from:`${root.querySelector('#salary-month').value}-01`,to:today()});
    if(!result.cancelled)toast(result.path);
  });
  await run(load);
}
