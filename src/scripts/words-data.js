/* Shared vocabulary for amountInWords(). Kept separate from words.js so the
   converter stays a small, easy-to-read function. */
export const config={
  ONES:['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'],
  TENS:['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'],
  SCALES:[[1e9,'Billion'],[1e6,'Million'],[1e3,'Thousand']]
};
