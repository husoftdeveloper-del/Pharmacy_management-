'use strict';
/* Amount in words for the printed bill ("Two Hundred Seventy Only").
   Shared shape with src/scripts/words.js, which the on-screen preview uses. */
const ONES=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
const SCALES=[[1e9,'Billion'],[1e6,'Million'],[1e3,'Thousand']];
function underHundred(n){return n<20?ONES[n]:`${TENS[Math.floor(n/10)]}${n%10?`-${ONES[n%10]}`:''}`;}
function underThousand(n){return `${n>=100?`${ONES[Math.floor(n/100)]} Hundred${n%100?' ':''}`:''}${n%100?underHundred(n%100):''}`.trim();}
function amountInWords(value){
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
module.exports={amountInWords};
