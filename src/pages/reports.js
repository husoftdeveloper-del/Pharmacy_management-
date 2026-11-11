import {api,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {icon,toast,run,downloadData} from '../components/ui.js';

/* Reports: an Overview of the headline numbers and the daily trend, plus one tab
   per detailed report. Every tab owns its filter row, its KPI cards and its
   table, all served by the permission-checked reportBook call. */
const TABS=[
  {key:'overview',label:'overview',symbol:'grid'},
  {key:'sales',label:'tabSales',symbol:'file'},
  {key:'profit',label:'tabProfit',symbol:'chart'},
  {key:'inventory',label:'tabInventory',symbol:'box'},
  {key:'expiry',label:'tabExpiry',symbol:'clock'},
  {key:'purchases',label:'tabPurchases',symbol:'truck'},
  {key:'expenses',label:'tabExpenses',symbol:'wallet'},
  {key:'customers',label:'tabCustomers',symbol:'users'},
  {key:'suppliers',label:'tabSuppliers',symbol:'truck'}
];
const PERIODS=[{key:'7',label:'last7'},{key:'30',label:'last30'},{key:'90',label:'last90'},{key:'month',label:'thisMonth'}];
const COLUMNS={invoice_no:'invoiceNoShort',date:'date',customer:'customer',cashier:'cashier',total:'total',discount:'discount',returned:'returned',status:'status',name:'name',quantity:'quantity',revenue:'revenue',cogs:'cogsShort',profit:'profitAmount',margin:'margin',returned_value:'returnedValue',batch_no:'batchShort',expiry:'expiry',location:'location',cost:'cost',value:'value',days_left:'daysLeftTitle',supplier:'supplier',recorded_by:'recordedBy',paid:'paid',due:'balanceDue',description:'description',amount:'amount',account:'account',phone:'phone',orders:'orders',credit:'credit',purchased:'purchased',balance:'balance'};
const MONEY=new Set(['total','discount','returned','revenue','cogs','profit','returned_value','cost','value','paid','due','amount','credit','purchased','balance']);
const PERCENT=new Set(['margin']);
const PLAIN=new Set(['status','expiry','date','invoice_no','name','customer','cashier','supplier','recorded_by','account','phone','description','batch_no','location']);
const PDF_KIND={sales:'sales',profit:'profit',inventory:'inventory',expiry:'expiry',purchases:'purchases',expenses:'expenses',customers:'receivables',suppliers:'payables'};
const ENUMS=new Set(['status','expiry']);

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
      <div class="report-export">
        <button class="btn btn-secondary btn-sm" type="button" id="report-export">${icon('download',15)}<span>${e(t('exportLabel'))}</span>${icon('chevron',14)}</button>
        <div class="report-export-menu" id="report-export-menu" hidden>
          <button type="button" data-export="csv">${icon('download',14)}<span>${e(t('csv'))}</span></button>
          <button type="button" data-export="pdf">${icon('printer',14)}<span>${e(t('pdf'))}</span></button>
        </div>
      </div>
    </section>
    <div id="report-body"></div>`;

  let tab='overview',overview=null,book=null;
  const filters={search:'',cashier:'',customer:'',supplier:'',status:'',category:'',expiry:''};

  const kpi=(label,value)=>`<article class="card kpi-card plain"><span class="kpi-label">${e(label)}</span><div class="kpi-value">${value}</div></article>`;
  const formatValue=(value,format)=>{
    if(format==='number')return String(Number(value)||0);
    if(format==='percent')return `${(Number(value)||0).toFixed(1)}%`;
    return `${money(value)} <small>${e(overview?.currency||book?.currency||'')}</small>`;
  };
  const cellValue=(column,row)=>{
    const value=row[column];
    if(value===null||value===undefined||value==='')return '—';
    if(MONEY.has(column))return money(value);
    if(PERCENT.has(column))return `${Number(value).toFixed(1)}%`;
    if(column==='status')return `<span class="badge muted">${e(t(value))}</span>`;
    return e(value);
  };

  const trendChart=rows=>{
    if(!rows.length)return '';
    const width=900,height=260,left=58,right=20,top=18,bottom=34;
    const max=Math.max(1,...rows.map(row=>Math.max(row.revenue,row.profit)));
    const step=rows.length>1?(width-left-right)/(rows.length-1):0;
    const point=(row,index,key)=>[left+index*step,top+(1-Math.max(0,row[key])/max)*(height-top-bottom)];
    const line=key=>rows.map((row,index)=>`${index?'L':'M'}${point(row,index,key).join(',')}`).join(' ');
    const area=`${line('revenue')} L${left+(rows.length-1)*step},${height-bottom} L${left},${height-bottom} Z`;
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
    const value=(amount)=>`${money(amount)} <small>${e(currency)}</small>`;
    root.querySelector('#report-body').innerHTML=`
      <div class="kpi-grid">
        <article class="card kpi-card"><span class="kpi-label">${e(t('revenue'))}</span><div class="kpi-top"><div class="kpi-value">${value(totals.revenue)}</div><span class="kpi-icon">${icon('wallet',16)}</span></div><div class="kpi-foot">${totals.orders} ${e(t('ordersLabel'))}</div></article>
        <article class="card kpi-card mint"><span class="kpi-label">${e(t('grossProfit'))}</span><div class="kpi-top"><div class="kpi-value">${value(totals.grossProfit)}</div><span class="kpi-icon">${icon('chart',16)}</span></div><div class="kpi-foot">${Number(totals.margin).toFixed(1)}% ${e(t('marginLabel'))}</div></article>
        <article class="card kpi-card amber"><span class="kpi-label">${e(t('expenses'))}</span><div class="kpi-top"><div class="kpi-value">${value(totals.expenses)}</div><span class="kpi-icon">${icon('wallet',16)}</span></div><div class="kpi-foot">${totals.expenseEntries} ${e(t('entries'))}</div></article>
        <article class="card kpi-card"><span class="kpi-label">${e(t('netProfit'))}</span><div class="kpi-top"><div class="kpi-value">${value(totals.netProfit)}</div><span class="kpi-icon">${icon('chart',16)}</span></div></article>
        <article class="card kpi-card blue"><span class="kpi-label">${e(t('orders'))}</span><div class="kpi-top"><div class="kpi-value">${totals.orders}</div><span class="kpi-icon">${icon('clipboard',16)}</span></div></article>
        <article class="card kpi-card blue"><span class="kpi-label">${e(t('itemsSold'))}</span><div class="kpi-top"><div class="kpi-value">${totals.itemsSold}</div><span class="kpi-icon">${icon('cart',16)}</span></div></article>
        <article class="card kpi-card blue"><span class="kpi-label">${e(t('cogs'))}</span><div class="kpi-top"><div class="kpi-value">${value(totals.cogs)}</div><span class="kpi-icon">${icon('box',16)}</span></div></article>
        <article class="card kpi-card blue"><span class="kpi-label">${e(t('avgOrderValue'))}</span><div class="kpi-top"><div class="kpi-value">${value(totals.averageOrder)}</div><span class="kpi-icon">${icon('tag',16)}</span></div></article>
      </div>
      <section class="card report-trend">
        <header class="card-header"><div><h2>${e(t('revenueProfitTrend'))}</h2><p>${e(overview.from)} — ${e(overview.to)}</p></div>
          <span class="report-legend"><i class="revenue"></i>${e(t('revenue'))}<i class="profit"></i>${e(t('profitAmount'))}</span></header>
        <div class="report-chart">${trendChart(overview.trend||[])}</div>
      </section>`;
  };

  const paintBook=()=>{
    if(!book)return;
    const body=root.querySelector('#report-body');
    const optionLabel=(filter,option)=>ENUMS.has(filter.key)?t(option.label):option.label;
    body.innerHTML=`
      <section class="card report-filter">
        <label class="report-search">${icon('search',17)}<input id="report-search" type="search" autocomplete="off" value="${e(filters.search)}" placeholder="${e(t(book.searchLabel))}" aria-label="${e(t(book.searchLabel))}"></label>
        ${book.filters.map(filter=>`<span class="report-select"><select data-filter="${filter.key}" aria-label="${e(t(filter.all))}"><option value="">${e(t(filter.all))}</option>${filter.options.map(option=>`<option value="${e(option.value)}" ${String(filters[filter.key])===String(option.value)?'selected':''}>${e(optionLabel(filter,option))}</option>`).join('')}</select>${icon('chevron',16)}</span>`).join('')}
      </section>
      <div class="kpi-grid ${book.kpis.length>4?'five':''}">
        ${book.kpis.map(item=>kpi(t(item.key),formatValue(item.value,item.format))).join('')}
      </div>
      <section class="card report-table-card">
        ${book.rows.length?`<div class="table-scroll"><table class="report-table"><thead><tr>${book.columns.map(column=>`<th class="${PLAIN.has(column)?'':'text-end'}">${e(t(COLUMNS[column]||column))}</th>`).join('')}</tr></thead><tbody>${book.rows.map(row=>`<tr>${book.columns.map(column=>`<td class="${PLAIN.has(column)?'':'text-end nowrap'}">${cellValue(column,row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        :`<div class="report-empty"><div class="report-empty-icon">${icon('box',24)}</div><p>${e(t('noFilterData'))}</p></div>`}
      </section>`;

    const search=body.querySelector('#report-search');
    let timer;
    search.oninput=event=>{
      filters.search=event.target.value;
      clearTimeout(timer);
      timer=setTimeout(()=>run(load),240);
      cleanup=()=>clearTimeout(timer);
    };
    body.querySelectorAll('[data-filter]').forEach(select=>select.onchange=event=>{
      filters[select.dataset.filter]=event.target.value;
      run(load);
    });
  };

  const load=async()=>{
    const query={from:root.querySelector('#report-from').value,to:root.querySelector('#report-to').value};
    if(tab==='overview'){
      overview=await api('reportOverview',query);
      paintOverview();
      return;
    }
    book=await api('reportBook',{...query,kind:tab,...filters});
    paintBook();
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

  const menu=root.querySelector('#report-export-menu');
  root.querySelector('#report-export').onclick=()=>{menu.hidden=!menu.hidden;};
  const outside=event=>{if(!event.target.closest('.report-export'))menu.hidden=true;};
  document.addEventListener('click',outside);

  root.querySelector('[data-export=csv]').onclick=()=>{
    menu.hidden=true;
    if(tab==='overview'&&overview){
      const rows=Object.entries(overview.totals).map(([key,value])=>`"${key}","${value}"`).join('\r\n');
      downloadData(`pharmacy-overview-${overview.from}-${overview.to}.csv`,`"Metric","${overview.currency}"\r\n${rows}`);
      toast(t('download'));
      return;
    }
    if(!book)return;
    const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
    const lines=[book.columns.map(column=>quote(t(COLUMNS[column]||column))).join(','),...book.rows.map(row=>book.columns.map(column=>quote(row[column])).join(','))];
    downloadData(`pharmacy-${book.kind}-${book.from}-${book.to}.csv`,'\uFEFF'+lines.join('\r\n'));
    toast(t('download'));
  };
  root.querySelector('[data-export=pdf]').onclick=()=>{
    menu.hidden=true;
    run(async()=>{
      const result=await api('pdf',{kind:tab==='overview'?'sales':PDF_KIND[tab],from:root.querySelector('#report-from').value,to:root.querySelector('#report-to').value});
      if(!result.cancelled)toast(result.path);
    });
  };

  let cleanup=null;
  await run(load);
  return ()=>{menu.hidden=true;document.removeEventListener('click',outside);cleanup?.();};
}
