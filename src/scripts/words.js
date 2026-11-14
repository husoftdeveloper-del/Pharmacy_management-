import {config} from './words-data.js';

/* The on-screen bill prints the total in words too, so the preview and the
   printed PDF say the same thing. */
const {ONES,TENS,SCALES}=config;
function underHundred(n){return n<20?ONES[n]:`${TENS[Math.floor(n/10)]}${n%10?`-${ONES[n%10]}`:''}`;}
function underThousand(n){return `${n>=100?`${ONES[Math.floor(n/100)]} Hundred${n%100?' ':''}`:''}${n%100?underHundred(n%100):''}`.trim();}
export function amountInWords(value){
  let number=Math.round(Number(value)||0);
  if(!Number.isFinite(number))number=0;
  const negative=number<0;
  number=Math.abs(number);
  if(number===0)return 'Zero';
  const parts=[];
  for(const [size,name] of SCALES){
    if(number>=size){parts.push(`${underThousand(Math.floor(number/size))} ${name}`);number%=size;}
  }
  if(number)parts.push(underThousand(number));
  return `${negative?'Minus ':''}${parts.join(' ')}`.trim();
}
