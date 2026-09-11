/* Tratamento de placas brasileiras para OCR: padrão antigo e Mercosul. */
(function(){
  const OLD={O:"0",Q:"0",D:"0",I:"1",L:"1",Z:"2",S:"5",G:"6",T:"7",B:"8"};
  const LETTER={0:"O",1:"I",2:"Z",5:"S",6:"G",7:"T",8:"B"};
  const clean=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  function repair(raw,kind){
    const s=clean(raw).slice(0,7).split("");
    const letterPos=kind==="mercosul"?[0,1,2,4]:[0,1,2];
    const numberPos=kind==="mercosul"?[3,5,6]:[3,4,5,6];
    letterPos.forEach(i=>{if(s[i]&&/^[0-9]$/.test(s[i]))s[i]=LETTER[s[i]]||s[i]});
    numberPos.forEach(i=>{if(s[i]&&/^[A-Z]$/.test(s[i]))s[i]=OLD[s[i]]||s[i]});
    return s.join("");
  }
  function validOld(s){return /^[A-Z]{3}[0-9]{4}$/.test(s)}
  function validMercosul(s){return /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(s)}
  function candidates(text){
    const raw=String(text||"").toUpperCase();
    const chunks=raw.match(/[A-Z0-9][A-Z0-9 ._-]{5,10}[A-Z0-9]/g)||[];
    const pool=chunks.concat(raw.split(/\r?\n/));
    const out=[];
    for(const item of pool){
      const compact=clean(item);
      for(let i=0;i<=Math.max(0,compact.length-7);i++){
        const seven=compact.slice(i,i+7);
        if(seven.length!==7)continue;
        const merc=repair(seven,"mercosul");
        const old=repair(seven,"old");
        if(validMercosul(merc))out.push({value:merc,type:"Mercosul",score:3});
        if(validOld(old))out.push({value:old,type:"Antiga",score:3});
        if(/^[A-Z0-9]{7}$/.test(seven)){
          if(validMercosul(seven))out.push({value:seven,type:"Mercosul",score:2});
          if(validOld(seven))out.push({value:seven,type:"Antiga",score:2});
        }
      }
    }
    const unique=[];const seen=new Set();
    for(const c of out.sort((a,b)=>b.score-a.score)){if(!seen.has(c.value)){seen.add(c.value);unique.push(c.value)}}
    return unique;
  }
  window.plateCandidates=candidates;
  window.normalizeBrazilPlate=function(value){
    const s=clean(value);
    if(validMercosul(s))return s;
    if(validOld(s))return s;
    const c=candidates(s);return c[0]||s;
  };
})();
