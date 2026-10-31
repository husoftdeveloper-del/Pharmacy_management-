'use strict';
// CODE128-B, including a checksum. No network service or renderer dependency.
const patterns = [
'212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'
];
function escapeXml(value) { return String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
function code128(value) {
  if (!/^[\x20-\x7e]{1,64}$/.test(value)) throw new Error('Invalid CODE128 barcode text.');
  const codes=[104,...Array.from(value,c=>c.charCodeAt(0)-32)];
  const checksum=codes.reduce((a,c,i)=>a+c*(i||1),0)%103;
  const bars=[...codes,checksum,106].map(c=>patterns[c]).join('');
  let x=20,rects='';
  for(let i=0;i<bars.length;i++){const width=Number(bars[i]);if(i%2===0)rects+=`<rect x="${x}" y="10" width="${width}" height="70"/>`;x+=width;}
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x+20}" height="110" viewBox="0 0 ${x+20} 110" role="img" aria-label="${escapeXml(value)}"><rect width="100%" height="100%" fill="white"/><g fill="black">${rects}</g><text x="${(x+20)/2}" y="100" text-anchor="middle" font-family="monospace" font-size="13">${escapeXml(value)}</text></svg>`;
}
module.exports={code128,escapeXml};
