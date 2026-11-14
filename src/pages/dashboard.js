import {api,state,money,escapeHTML as e,today} from '../scripts/api.js';
import {t} from '../scripts/i18n.js';
import {alertEnabled,stockAlertSplits} from '../scripts/alerts.js';
import {icon,pageHeader,button} from '../components/ui.js';

function chart(days){const values=[];for(let i=6;i>=0;i--){const date=new Date();date.setUTCDate(date.getUTCDate()-i);const key=date.toISOString().slice(0,10);values.push({day:key,total:days.find(d=>d.day===key)?.total||0});}const max=Math.max(...values.map(v=>v.total),100);const width=620,height=205,left=52,right=18,top=20,bottom=35;const points=values.map((v,i)=>[left+i*(width-left-right)/6,top+(1-v.total/max)*(height-top-bottom)]);const path=points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');const area=`${path} L${points.at(-1)[0]},${height-bottom} L${left},${height-bottom} Z`;return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Sales over the last seven days"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#16a08e" stop-opacity=".19"/><stop offset="100%" stop-color="#16a08e" stop-opacity="0"/></linearGradient></defs>${[0,1,2,3].map(i=>{const y=top+i*(height-top-bottom)/3;return `<line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-dasharray="4 5"/><text x="${left-10}" y="${y+4}" text-anchor="end" fill="var(--muted)" font-size="9">${e(new Intl.NumberFormat('en',{notation:'compact'}).format(max*(1-i/3)))}</text>`;}).join('')}<path d="${area}" fill="url(#chart-fill)"/><path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round"/>${points.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--surface)" stroke="var(--primary)" stroke-width="2"><title>${e(values[i].day)}: ${money(values[i].total)}</title></circle><text x="${p[0]}" y="${height-10}" text-anchor="middle" fill="var(--muted)" font-size="9">${new Date(values[i].day+'T12:00:00').toLocaleDateString(document.documentElement.lang,{weekday:'short'})}</text>`).join('')}</svg>`;}

function stat(label,value,symbol,color,foot,currency=true){return `<article class="card stat-card"><div class="stat-top"><span class="stat-label">${e(t(label))}</span><span class="stat-icon ${color}">${icon(symbol,19)}</span></div><div class="stat-value">${money(value)}${currency?`<small>${e(state.preferences.currency)}</small>`:''}</div><div class="stat-footer">${icon('clock',12)}${e(foot)}</div></article>`;}

const number=value=>new Intl.NumberFormat(document.documentElement.lang||'en').format(Number(value)||0);

/* One dashboard box: a headline figure and a way into the page that holds the
   records. The detail rows deliberately stay off the dashboard — the whole
   card is one click target and opens its module. */
function insightCard({go,params,color,symbol,label,hint,chip,value,unit=false,meta=''}){
  return `<article class="card insight-card" data-go="${e(go)}"${params?` data-params="${e(JSON.stringify(params))}"`:''} tabindex="0" role="button" aria-label="${e(`${t(label)} — ${t('view')}`)}">
    <header class="insight-head"><span class="insight-icon ${color}">${icon(symbol,18)}</span><div class="insight-title"><strong>${e(t(label))}</strong><small>${e(hint)}</small></div>${chip!==''?`<span class="insight-chip">${e(String(chip))}</span>`:''}</header>
    <div class="insight-value"><span>${e(value)}</span>${unit?`<small>${e(state.preferences.currency)}</small>`:''}</div>
    ${meta?`<p class="insight-meta">${meta}</p>`:''}
    <footer class="insight-foot"><span>${e(t('view'))}</span>${icon('arrow',14)}</footer>
  </article>`;
}

function expensesCard(d){
  const ex=d.expenses||{month:{total:0,count:0},today:0};
  return insightCard({go:'finance',color:'amber',symbol:'wallet',label:'expenses',hint:t('thisMonth'),chip:ex.month?.count||0,value:money(ex.month?.total||0),unit:true,meta:`${icon('clock',11)}<span>${e(t('today'))} · ${money(ex.today||0)} ${e(state.preferences.currency)}</span>`});
}

function lowStockCard(d,count){
  count=number(count??d.lowCount??(d.low||[]).length);
  return insightCard({go:'inventory',color:'red',symbol:'box',label:'lowStock',hint:t('inventory'),chip:count,value:count,meta:`${icon('warning',11)}<span>${e(t('reorderLevel'))}</span>`});
}

function expiringCard(d){
  const count=number(d.expiringCount??(d.expiring||[]).length);
  return insightCard({go:'reports',params:{kind:'expiryReport'},color:'blue',symbol:'clock',label:'expiringSoon',hint:`${number(state.preferences.low_stock_days||0)} ${t('expiryDays')}`,chip:count,value:count,meta:`${icon('clock',11)}<span>${e(t('expiryReport'))}</span>`});
}

function recentSaleCard(d){
  const recent=d.recent||[];
  const known=d.today!==undefined;
  return insightCard({go:'sales',color:'teal',symbol:'cart',label:'recentSale',hint:t('today'),chip:known?number(d.today.orders):recent.length,value:known?money(d.today.sales):number(recent.length),unit:known,meta:`${icon('clock',11)}<span>${known?`${number(d.today.orders)} ${e(t('invoice'))}`:e(t('recentSales'))}</span>`});
}

export async function render(root){
  const d=await api('dashboard');
  const canFinance=d.today!==undefined;
  const canInventory=d.low!==undefined;
  const canSales=d.recent!==undefined;
  // Settings → Notifications decides which warnings the dashboard shows.
  const stock=stockAlertSplits(d.low||[]);
  const stockCount=stock.low&&stock.out?number(d.lowCount??(d.low||[]).length):stock.visible.length;
  const cards=[
    d.expenses!==undefined?expensesCard(d):'',
    canInventory&&(stock.low||stock.out)?lowStockCard(d,stockCount):'',
    canInventory&&alertEnabled('notify_expiry')?expiringCard(d):'',
    canSales?recentSaleCard(d):''
  ].filter(Boolean);

  root.innerHTML=pageHeader(t('dashboard'),`${t('welcome')}, ${state.user.name}. ${new Date().toLocaleDateString(document.documentElement.lang,{weekday:'long',month:'long',day:'numeric'})}`,button(t('pos'),'cart','primary','data-go="pos"'))+
  `<div class="welcome-strip"><div><strong>${e(d.pharmacyName)}</strong><p>${e(t('localData'))}</p></div><span class="inline">${icon('shield',16)}${e(t('secure'))}</span></div>`+
  (canFinance?`<div class="stat-grid">${stat('todaySales',d.today.sales,'wallet','',`${d.today.orders} ${t('invoice')}`)}${stat('monthSales',d.month,'chart','blue',t('monthSales'))}${d.stockValue!==undefined?stat('stockValue',d.stockValue,'box','amber',`${d.medicines} ${t('inventory')}`):''}${d.receivable!==undefined?stat('receivables',d.receivable,'users','',t('customers')):''}</div>`:'')+
  (cards.length?`<div class="insight-grid">${cards.join('')}</div>`:'')+
  (canFinance?`<section class="card trend-card"><header class="card-header"><div><h2>${e(t('salesTrend'))}</h2><p>${e(t('lastSeven'))}</p></div><span class="chart-legend"><i></i>${e(t('salesReport'))}</span></header><div class="chart-wrap">${chart(d.trend)}</div></section>`:'')+
  `<footer class="app-footer"><span>${icon('shield',12)}${e(t('localData'))}</span><span>Pharmaca · ${e(t('version'))}</span></footer>`;

  /* Every box opens its page; the records themselves are listed there. */
  const open=el=>{
    let params={};
    try{params=el.dataset.params?JSON.parse(el.dataset.params):{};}catch{params={};}
    window.dispatchEvent(new CustomEvent('navigate',{detail:{page:el.dataset.go,params}}));
  };
  root.querySelectorAll('[data-go]').forEach(el=>{
    el.onclick=()=>open(el);
    if(el.classList.contains('insight-card'))el.onkeydown=ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();open(el);}};
  });
}
