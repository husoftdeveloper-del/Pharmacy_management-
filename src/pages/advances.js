import {api,state,money,escapeHTML as e} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,modal,form,field,bindForm,toast,run,refreshOptions} from '../components/ui.js';
import {bindPaymentAccount} from '../components/payment-fields.js';

/* Salary Advances: what is still owed back and what has been recovered, with a
   status filter and a detail dialog per advance. */
export async function render(root){
  root.innerHTML=`
    <header class="page-heading advances-heading">
      <div><h1>${e(t('salaryAdvances'))}</h1></div>
      <div class="heading-actions">${button(t('newAdvance'),'plus','primary','id="new-advance"')}</div>
    </header>
    <div class="stat-grid advances-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('outstandingAdvances'))}</span><span class="stat-icon amber">${icon('wallet',18)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('activeEmployees'))}</span><span class="stat-icon blue">${icon('users',18)}</span></div><div class="stat-value"><span>0</span></div></article>
    </div>
    <section class="card advances-filter">
      <span class="advances-select"><select id="advance-status" aria-label="${e(t('status'))}"><option value="active">${e(t('active'))}</option><option value="settled">${e(t('settled'))}</option><option value="">${e(t('all'))}</option></select>${icon('chevron',16)}</span>
    </section>
    <section class="card advances-card">
      <div class="table-scroll"><table class="advances-table">
        <thead><tr><th>${e(t('date'))}</th><th>${e(t('employee'))}</th><th class="text-end">${e(t('amount'))}</th><th class="text-end">${e(t('remaining'))}</th><th>${e(t('reason'))}</th><th>${e(t('status'))}</th><th class="text-end">${e(t('actions'))}</th></tr></thead>
        <tbody id="advance-rows"></tbody>
      </table></div>
    </section>`;

  let rows=[];
  const paint=()=>{
    root.querySelector('#advance-rows').innerHTML=rows.length?rows.map(row=>`<tr>
        <td class="nowrap muted">${e(String(row.date).slice(0,10))}</td>
        <td><strong>${e(row.staff)}</strong>${row.position?`<div class="muted sub">${e(row.position)}</div>`:''}</td>
        <td class="text-end nowrap">${money(row.amount)}</td>
        <td class="text-end nowrap">${money(row.remaining)}</td>
        <td class="muted">${row.note?e(row.note):'—'}</td>
        <td><span class="badge ${row.status==='active'?'warn':'good'}"><i></i>${e(t(row.status))}</span></td>
        <td class="text-end"><button class="btn btn-ghost btn-sm" data-view="${row.id}">${e(t('view'))}</button></td>
      </tr>`).join(''):`<tr><td colspan="7" class="advances-empty-cell"><div class="advances-empty"><div class="advances-empty-icon">${icon('wallet',26)}</div><h3>${e(t('noAdvances'))}</h3><p>${e(t('noAdvancesHint'))}</p></div></td></tr>`;
    root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>{
      const row=rows.find(item=>item.id===Number(node.dataset.view));
      modal(t('advance'),`<div class="advances-detail">
        <div><span>${e(t('employee'))}</span><strong>${e(row.staff)}</strong></div>
        <div><span>${e(t('date'))}</span><strong>${e(String(row.date).slice(0,10))}</strong></div>
        <div><span>${e(t('amount'))}</span><strong>${money(row.amount)} ${e(state.preferences.currency)}</strong></div>
        <div><span>${e(t('recovered'))}</span><strong>${money(row.repaid)}</strong></div>
        <div><span>${e(t('remaining'))}</span><strong>${money(row.remaining)}</strong></div>
        <div><span>${e(t('account'))}</span><strong>${e(row.account||'—')}</strong></div>
        <div><span>${e(t('recordedBy'))}</span><strong>${e(row.recorded_by||'—')}</strong></div>
        <p>${e(row.note||'—')}</p>
      </div>`);
    });
  };

  async function load(){
    const book=await api('advanceBook',{status:root.querySelector('#advance-status').value});
    rows=book.rows||[];
    const cells=root.querySelectorAll('.advances-stats .stat-value span');
    cells[0].textContent=money(book.totals.outstanding);
    cells[1].textContent=String(book.totals.activeEmployees);
    paint();
  }

  root.querySelector('#new-advance').onclick=()=>run(async()=>{
    await refreshOptions();
    const m=modal(t('newAdvance'),form(
      field('staff_id','',{options:state.options.staff,required:true})+
      field('amount','',{type:'number',step:'0.01',required:true})+
      field('note','',{type:'textarea'})+
      field('method','cash',{options:['cash','bank'].map(value=>({value,label:t(value)})),required:true})+
      field('account_id','',{options:state.options.accounts,required:true}),t('record')));
    bindPaymentAccount(m.root);
    bindForm(m.root,async data=>{
      await api('advance',{staffId:data.staff_id,amount:data.amount,note:data.note,method:data.method,accountId:data.account_id});
      toast(t('recordSaved'));
      await load();
    },m.close);
  });
  root.querySelector('#advance-status').onchange=()=>run(load);
  await run(load);
}
