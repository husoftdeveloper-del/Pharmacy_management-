import {api,state,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,button,table,toast,run,csv,downloadData} from '../components/ui.js';

/* Reports: an Overview of the headline numbers and the daily trend, plus one tab
   per detailed report (sales, profit, inventory, expiry, purchases, expenses,
   customers, suppliers) that keeps the table and CSV/PDF exports. */
const TABS=[
  {key:'overview',label:'overview',symbol:'grid'},
  {key:'sales',label:'sales',symbol:'file'},
  {key:'profit',label:'profit',symbol:'chart'},
  {key:'inventory',label:'inventory',symbol:'box'},
  {key:'expiry',label:'expiry',symbol:'clock'},
  {key:'purchases',label:'purchases',symbol:'truck'},
  {key:'expenses',label:'expenses',symbol:'wallet'},
  {key:'customers',label:'customers',symbol:'users'},
  {key:'suppliers',label:'suppliers',symbol:'truck'}
];
const PERIODS=[{key:'7',label:'last7'},{key:'30',label:'last30'},{key:'90',label:'last90'},{key:'month',label:'thisMonth'}];
const tableReports={sales:'sales',profit:'profit',inventory:'inventory',expiry:'expiry',purchases:'purchases',expenses:'expenses',customers:'receivables',suppliers:'payables'};

const shift=days=>{const date=new Date();date.setUTCDate(date.getUTCDate()-days);return date.toISOString().slice(0,10);};
const rangeFor=period=>period==='month'?{from:`${today().slice(0,8)}01`,to:today()}:{from:shift(Number(period)-1),to:today()};

export async function render(root){
  const initial=rangeFor('30');
  root.innerHTML=`
    <header class="page-heading reports-heading">
      <div><h1>${e(t('reports'))}</h1><p>${e(t('reportsHint'))}</p></div>
    </header>
    <div class="report-tabs" role="tablist">
      ${TABS.map((tab,index)=>`<button class="report-tab ${index===0?'active':''}" role="tab" aria-selected="${index===0}" data-tab="${tab.key}">${icon(tab.symbol,15)}<span>${e(t(tab.label))}</span></button>`).join('')}
    </div>
    <section class="card reports-range">
      <span class="reports-select"><select id="report-period" aria-label="${e(t('period'))}">${PERIODS.map(period=>`<option value="${period.key}" ${period.key==='30'?'selected':''}>${e(t(period.label))}</option>`).join('')}</select>${icon('chevron',16)}</span>
      <label class="reports-date"><input id="report-from" type="date" value="${initial.from}" aria-label="${e(t('from'))}">${icon('file',15)}</label>
      <label class="reports-date"><input id="report-to" type="date" value="${initial.to}" aria-label="${e(t('to'))}">${icon('file',15)}</label>
      <span class="spacer"></span>
      <button class="btn btn-secondary btn-sm" type="button" id="report-csv">${icon('download',15)}<span>${e(t('csv'))}</span></button>
      <button class="btn btn-secondary btn-sm" type="button" id="report-pdf">${icon('printer',15)}<span>${e(t('pdf'))}</span></button>
    </section>
    <div id="report-body"></div>`;

  let tab='overview',overview=null,detail=null;

  const kpi=(label,value,suffix,footnote,tone,symbol)=>`<article class="card kpi-card ${tone||''}"><div class="kpi-top"><span class="kpi-label">${e(label)}</span><span class="kpi-icon">${icon(symbol,16)}</span></div><div class="kpi-value">${value}</div>${footnote?`<div class="kpi-foot">${e(footnote)}</div>`:''}${suffix?`<div class="kpi-foot">${e(suffix)}</div>`:''}</article>`;

  const trendChart=rows=>{
    if(!rows.length)return '';
    const width=900,height=260,left=58,right=20,top=18,bottom=34;
    const max=Math.max(1,...rows.map(row=>Math.max(row.revenue,row.profit)));
    const step=rows.length>1?(width-left-right)/(rows.length-1):0;
    const point=(row,index,key)=>[left+index*step,top+(1-Math.max(0,row[key])/max)*(height-top-bottom)];
    const line=(key,color)=>rows.map((row,index)=>`${index?'L':'M'}${point(row,index,key).join(',')}`).join(' ');
    const area=`${line('revenue','')} L${left+(rows.length-1)*step},${height-bottom} L${left},${height-bottom} Z`;
    const labels=[0,1,2,3].map(i=>{
      const y=top+i*(height-top-bottom)/3;
      return `<line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-dasharray="4 5"/><text x="${left-10}" y="${y+4}" text-anchor="end" fill="var(--muted)" font-size="10">${e(new Intl.NumberFormat('en',{notation:'compact'}).format(max*(1-i/3)))}</text>`;
    }).join('');
    const ticks=rows.map((row,index)=>rows.length>14&&index%Math.ceil(rows.length/8)?'':`<text x="${point(row,index,'revenue')[0]}" y="${height-10}" text-anchor="middle" fill="var(--muted)" font-size="9">${e(row.day.slice(5))}</text>`).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(t('revenueProfitTrend'))}"><defs><linearGradient id="report-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#16a08e" stop-opacity=".18"/><stop offset="100%" stop-color="#16a08e" stop-opacity="0"/></linearGradient></defs>${labels}<path d="${area}" fill="url(#report-fill)"/><path d="${line('revenue')}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round"/><path d="${line('profit')}" fill="none" stroke="var(--blue)" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>${rows.map((row,index)=>{const p=point(row,index,'revenue');return `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--surface)" stroke="var(--primary)" stroke-width="2"><title>${e(row.day)}: ${money(row.revenue)}</title></circle>`;}).join('')}${ticks}</svg>`;
  };

  const paintOverview=()=>{
    const totals=overview.totals;
    const currency=overview.currency||'';
    root.querySelector('#report-body').innerHTML=`
      <div class="kpi-grid">
        ${kpi(t('revenue'),`${money(totals.revenue)} <small>${e(currency)}</small>`,null,`${totals.orders} ${t('ordersLabel')}`,'blue','wallet')}
        ${kpi(t('grossProfit'),`${money(totals.grossProfit)} <small>${e(currency)}</small>`,null,`${totals.margin.toFixed(1)}% ${t('marginLabel')}`,'mint','chart')}
        ${kpi(t('expenses'),`${money(totals.expenses)} <small>${e(currency)}</small>`,null,`${totals.expenseEntries} ${t('entries')}`,'amber','wallet')}
        ${kpi(t('netProfit'),`${money(totals.netProfit)} <small>${e(currency)}</small>`,null,null,'mint','chart')}
        ${kpi(t('orders'),String(totals.orders),null,null,'blue','clipboard')}
        ${kpi(t('itemsSold'),String(totals.itemsSold),null,null,'blue','cart')}
        ${kpi(t('cogs'),`${money(totals.cogs)} <small>${e(currency)}</small>`,null,null,'blue','box')}
        ${kpi(t('avgOrderValue'),`${money(totals.averageOrder)} <small>${e(currency)}</small>`,null,null,'blue','tag')}
      </div>
      <section class="card report-trend">
        <header class="card-header"><div><h2>${e(t('revenueProfitTrend'))}</h2><p>${e(overview.from)} — ${e(overview.to)}</p></div>
          <span class="report-legend"><i class="revenue"></i>${e(t('revenue'))}<i class="profit"></i>${e(t('profit'))}</span></header>
        <div class="report-chart">${trendChart(overview.trend||[])}</div>
      </section>`;
  };

  const paintDetail=async()=>{
    const kind=tableReports[tab];
    detail=await api('report',{kind,from:root.querySelector('#report-from').value,to:root.querySelector('#report-to').value});
    const numeric=['total','paid','amount','balance','value','cost','price','credit','returned'];
    root.querySelector('#report-body').innerHTML=`<section class="card report-table-card">
      <header class="card-header"><div><h2>${e(t(tab))}</h2><p>${e(detail.from)} — ${e(detail.to)}</p></div><span class="pill">${icon('file',14)} ${detail.rows.length} ${e(t('record'))}</span></header>
      <div id="report-rows">${detail.rows.length?table(detail.columns,detail.rows,row=>`<tr>${detail.columns.map(column=>`<td class="${numeric.includes(column)?'nowrap':''}">${e(numeric.includes(column)?money(row[column]):row[column]??'—')}</td>`).join('')}</tr>`):''}</div>
      ${detail.rows.length?'':`<div class="report-empty"><div class="report-empty-icon">${icon('chart',24)}</div><h3>${e(t('noData'))}</h3><p>${e(t('reportsHint'))}</p></div>`}
    </section>`;
  };

  const paint=async()=>tab==='overview'?paintOverview():paintDetail();
  const load=async()=>{
    const query={from:root.querySelector('#report-from').value,to:root.querySelector('#report-to').value};
    if(tab==='overview')overview=await api('reportOverview',query);
    await paint();
  };
  const setTab=next=>{
    tab=next;
    root.querySelectorAll('[data-tab]').forEach(node=>{const active=node.dataset.tab===next;node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));});
    return run(load);
  };
  root.querySelectorAll('[data-tab]').forEach(node=>node.onclick=()=>setTab(node.dataset.tab));
  root.querySelector('#report-period').onchange=event=>{
    const range=rangeFor(event.target.value);
    root.querySelector('#report-from').value=range.from;
    root.querySelector('#report-to').value=range.to;
    run(load);
  };
  root.querySelector('#report-from').onchange=()=>{root.querySelector('#report-period').value='';run(load);};
  root.querySelector('#report-to').onchange=()=>{root.querySelector('#report-period').value='';run(load);};
  root.querySelector('#report-csv').onclick=()=>{
    if(tab==='overview'&&overview){
      const rows=Object.entries(overview.totals).map(([key,value])=>`"${key}",${value}`).join('\r\n');
      downloadData(`pharmacy-overview-${overview.from}.csv`,`"Metric","${overview.currency}"\r\n${rows}`);
      toast(t('recordSaved'));
      return;
    }
    if(detail)downloadData(`pharmacy-${detail.kind||tableReports[tab]}-${today()}.csv`,csv(detail.columns,detail.rows));
  };
  root.querySelector('#report-pdf').onclick=()=>run(async()=>{
    const result=await api('pdf',{kind:tab==='overview'?'sales':tableReports[tab],from:root.querySelector('#report-from').value,to:root.querySelector('#report-to').value});
    if(!result.cancelled)toast(result.path);
  });
  await run(load);
}
