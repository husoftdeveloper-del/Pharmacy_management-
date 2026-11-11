export async function api(channel,payload={}) {
  if (!window.pharmacy) throw new Error('Open this application in Electron. Browser-only mode cannot access your database.');
  return window.pharmacy.invoke(channel,payload);
}
export const state={user:null,permissions:[],preferences:{},options:{},page:'dashboard'};
export function money(value){return new Intl.NumberFormat(document.documentElement.lang||'en',{style:'decimal',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);}
export function dateTime(value){if(!value)return '—';return new Intl.DateTimeFormat(document.documentElement.lang||'en',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value.includes('T')?value:value.replace(' ','T')+(value.length===10?'T00:00:00':'Z')));}
export function today(){return new Date().toISOString().slice(0,10);}
export function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
