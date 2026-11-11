import {api,state,money,escapeHTML as e,dateTime,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,modal,form,field,bindForm,toast,run,refreshOptions} from '../components/ui.js';
import {expensePayload} from '../scripts/payloads.js';
import {bindPaymentAccount} from '../components/payment-fields.js';

/* Expenses: three totals above a filter row (search, category, date range) and
   a table of every cost entry with who recorded it. */
export async function render(root){
  root.innerHTML=`
    <header class="page-heading expense-heading">
      <div><h1>${e(t('expenses'))}</h1></div>
      <div class="heading-actions">${button(t('newExpense'),'plus','primary','id="new-expense"')}</div>
    </header>
    <div class="stat-grid expense-stats">
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('thisMonth'))}</span><span class="stat-icon blue">${icon('file',18)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('total'))}</span><span class="stat-icon">${icon('wallet',18)}</span></div><div class="stat-value"><span>${money(0)}</span><small>${e(state.preferences.currency)}</small></div></article>
      <article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t('entries'))}</span><span class="stat-icon amber">${icon('clipboard',18)}</span></div><div class="stat-value"><span>0</span></div></article>
    </div>
    <section class="card expense-filter">
      <label class="expense-search">${icon('search',18)}<input id="expense-search" type="search" autocomplete="off" placeholder="${e(t('search'))}" aria-label="${e(t('search'))}"></label>
      <span class="expense-select"><select id="expense-category" aria-label="${e(t('category'))}"><option value="">${e(t('allCategories'))}</option></select>${icon('chevron',16)}</span>
      <label class="expense-date"><input id="expense-from" type="date" value="" aria-label="${e(t('from'))}"><span class="date-icon">${icon('file',15)}</span></label>
      <label class="expense-date"><input id="expense-to" type="date" value="" aria-label="${e(t('to'))}"><span class="date-icon">${icon('file',15)}</span></label>
    </section>
    <section class="card expense-card">
      <div class="table-scroll"><table class="expense-table">
        <thead><tr><th>${e(t('date'))}</th><th>${e(t('category'))}</th><th>${e(t('description'))}</th><th>${e(t('amount'))}</th><th>${e(t('recordedBy'))}</th><th class="text-end">${e(t('actions'))}</th></tr></thead>
        <tbody id="expense-rows"></tbody>
      </table></div>
    </section>`;

  let rows=[],search='',category='',from='',to='',timer;
  const paint=()=>{
    const term=search.trim().toLowerCase();
    const visible=rows.filter(row=>{
      if(category&&row.category!==category)return false;
      if(from&&String(row.date).slice(0,10)<from)return false;
      if(to&&String(row.date).slice(0,10)>to)return false;
      if(!term)return true;
      return [row.category,row.description,row.recorded_by,row.account].some(value=>String(value||'').toLowerCase().includes(term));
    });
    root.querySelector('#expense-rows').innerHTML=visible.length?visible.map(row=>`<tr>
        <td class="nowrap muted">${e(row.date)}</td>
        <td><span class="badge muted">${e(row.category)}</span></td>
        <td>${e(row.description)}</td>
        <td class="nowrap"><strong>${money(row.amount)}</strong></td>
        <td>${row.recorded_by?e(row.recorded_by):'<span class="muted">—</span>'}</td>
        <td class="text-end"><button class="btn btn-ghost btn-sm" data-view="${row.id}">${e(t('view'))}</button></td>
      </tr>`).join(''):`<tr><td colspan="6" class="expense-empty-cell"><div class="expense-empty"><div class="expense-empty-icon">${icon('wallet',26)}</div><h3>${e(t(rows.length?'noExpenseMatch':'noExpenses'))}</h3><p>${e(t('noExpensesHint'))}</p></div></td></tr>`;
    root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>{
      const row=rows.find(item=>item.id===Number(node.dataset.view));
      modal(t('expense'),`<div class="expense-detail">
        <div><span>${e(t('date'))}</span><strong>${e(row.date)}</strong></div>
        <div><span>${e(t('category'))}</span><strong>${e(row.category)}</strong></div>
        <div><span>${e(t('amount'))}</span><strong>${money(row.amount)} ${e(state.preferences.currency)}</strong></div>
        <div><span>${e(t('account'))}</span><strong>${e(row.account||'—')}</strong></div>
        <div><span>${e(t('recordedBy'))}</span><strong>${e(row.recorded_by||'—')}</strong></div>
        <p>${e(row.description)}</p></div>`);
    });
  };
  async function load(){
    const book=await api('expenseBook');
    rows=book.rows||[];
    const values=[book.totals.thisMonth,book.totals.total,book.totals.entries];
    const cells=root.querySelectorAll('.expense-stats .stat-value span');
    cells[0].textContent=money(values[0]);
    cells[1].textContent=money(values[1]);
    cells[2].textContent=String(values[2]);
    const select=root.querySelector('#expense-category');
    select.innerHTML=`<option value="">${e(t('allCategories'))}</option>`+(book.categories||[]).map(name=>`<option value="${e(name)}">${e(name)}</option>`).join('');
    select.value=category;
    paint();
  }
  root.querySelector('#expense-search').oninput=event=>{search=event.target.value;clearTimeout(timer);timer=setTimeout(paint,160);};
  root.querySelector('#expense-category').onchange=event=>{category=event.target.value;paint();};
  root.querySelector('#expense-from').onchange=event=>{from=event.target.value;paint();};
  root.querySelector('#expense-to').onchange=event=>{to=event.target.value;paint();};
  root.querySelector('#new-expense').onclick=()=>run(async()=>{
    await refreshOptions();
    const m=modal(t('newExpense'),form(field('category','',{required:true})+field('description','',{type:'textarea',required:true})+field('amount','',{type:'number',step:'0.01',required:true})+field('method','cash',{options:['cash','bank'].map(value=>({value,label:t(value)})),required:true})+field('account_id','',{options:state.options.accounts,required:true}),t('save')));
    bindPaymentAccount(m.root);
    bindForm(m.root,async data=>{
      await api('expense',expensePayload(data));
      toast(t('recordSaved'));
      await load();
    },m.close);
  });
  await run(load);
  return ()=>clearTimeout(timer);
}
