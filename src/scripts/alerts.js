import {api,state,money} from './api.js';
import {t} from './i18n.js';
import {toast} from '../components/ui.js';

/* Alert switches live in Settings → Notifications. This module is the single
   place that reads them, so every screen agrees on what "on" means and the
   switches work even for databases created before the option existed. */
const defaults={
  notify_low_stock:true,
  notify_out_of_stock:true,
  notify_expiry:true,
  notify_daily_summary:false,
  notify_sound:false,
  notify_desktop:false
};
export const alertKeys=Object.keys(defaults);
export const alertDefaults=defaults;

export function alertEnabled(key){
  const value=state.preferences?.[key];
  if(value===undefined||value===null||value==='')return Boolean(defaults[key]);
  return value===true||value===1||value==='1'||value==='true';
}

/* A short two-note chime, generated in the page: no audio file to ship, and it
   stays silent when the switch is off or the machine has no audio device. */
export function playSaleSound(){
  if(!alertEnabled('notify_sound'))return false;
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return false;
    const context=new Audio();
    const now=context.currentTime;
    [660,880].forEach((frequency,index)=>{
      const oscillator=context.createOscillator();
      const gain=context.createGain();
      oscillator.type='sine';
      oscillator.frequency.value=frequency;
      const start=now+index*0.12;
      gain.gain.setValueAtTime(0.0001,start);
      gain.gain.exponentialRampToValueAtTime(0.16,start+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001,start+0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start+0.2);
    });
    setTimeout(()=>context.close?.().catch?.(()=>{}),900);
    return true;
  }catch{return false;}
}

/* Desktop notifications run in the Electron main process, because this window
   denies every browser permission on purpose. The page therefore reports
   "granted" whenever the secure bridge is present and falls back to the
   browser API only in a plain browser preview. */
function bridge(){return typeof window!=='undefined'&&window.pharmacy&&typeof window.pharmacy.invoke==='function'?window.pharmacy:null;}

export function desktopPermission(){
  if(bridge())return 'granted';
  if(typeof Notification==='undefined')return 'unsupported';
  return Notification.permission;
}

export async function requestDesktopPermission(){
  if(bridge())return 'granted';
  if(typeof Notification==='undefined')return 'unsupported';
  if(Notification.permission==='granted')return 'granted';
  try{return await Notification.requestPermission();}catch{return Notification.permission;}
}

export async function notifyDesktop(title,body){
  if(!alertEnabled('notify_desktop'))return false;
  const secure=bridge();
  if(secure){
    try{const result=await secure.invoke('notify',{title,body});return Boolean(result?.shown);}catch{return false;}
  }
  if(typeof Notification==='undefined'||Notification.permission!=='granted')return false;
  try{new Notification(title,{body});return true;}catch{return false;}
}

/* Low stock and expiry counts for the dashboard boxes, honouring the switches:
   an out-of-stock medicine belongs to the out-of-stock switch, everything else
   below its reorder level to the low-stock switch. */
export function stockAlertSplits(rows=[]){
  const low=alertEnabled('notify_low_stock');
  const out=alertEnabled('notify_out_of_stock');
  const visible=rows.filter(row=>Number(row.stock)<=0?out:low);
  return {low,out,visible};
}

let summaryShown=false;
/* One toast after sign-in when the daily summary switch is on: yesterday's
   takings, read from the same 7-day trend the dashboard chart uses. */
export async function dailySummary(){
  if(summaryShown||!alertEnabled('notify_daily_summary'))return null;
  summaryShown=true;
  try{
    const data=await api('dashboard');
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    const row=(data.trend||[]).find(entry=>String(entry.day).slice(0,10)===yesterday);
    if(!row)return null;
    const message=`${t('yesterdaySales')}: ${Number(row.orders)||0} ${t('invoice')} · ${money(row.total||0)} ${state.preferences?.currency||''}`.trim();
    toast(message);
    await notifyDesktop(t('dailySalesSummary'),message);
    return message;
  }catch{return null;}
}
