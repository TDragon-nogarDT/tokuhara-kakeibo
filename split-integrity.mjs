// 共同費の負担割合は常に税込・円単位で計算する。UIの入力は税込額または比率。
export function grossAmount(row) {
  const raw = Number(row.amt ?? row.price ?? 0);
  if (!Number.isSafeInteger(raw)) throw new Error('品目金額は整数円で入力してください');
  if (row.tax === '8') return Math.round(raw * 1.08);
  if (row.tax === '10') return Math.round(raw * 1.10);
  return raw;
}
const present = value => value !== null && value !== undefined && String(value).trim() !== '';
const invalid = (total, message) => ({valid:false,total,tc:0,sa:0,reason:message});
function validRange(total, tc, sa) {
  if (!Number.isSafeInteger(tc) || !Number.isSafeInteger(sa) || tc + sa !== total)
    return '税込負担額の合計が品目の税込合計と一致しません';
  const lo = Math.min(total,0), hi = Math.max(total,0);
  if (tc < lo || tc > hi || sa < lo || sa > hi) return 'それぞれの負担額を品目合計の範囲内にしてください';
  return '';
}
export function computeShares(row) {
  // Stored figures are authoritative for nonfinancial edits, including historic
  // fractional yen and negative (income) entries represented with positive rawAmt.
  const old=row.legacyShare;
  if(old && String(row.amt)===String(old.amt) && row.tax===old.tax && row.sp===old.sp &&
      Number(row.tc)===Number(old.tc) && Number(row.sa)===Number(old.sa)) {
    const total=Number(old.total),tc=Number(old.tc),sa=Number(old.sa);
    if(!Number.isFinite(total)||!Number.isFinite(tc)||!Number.isFinite(sa)||Math.abs(tc+sa-total)>1e-7)
      return invalid(total,'旧データの負担額に不一致があります。原本を確認してから修正してください');
    return {valid:true,total,tc,sa,reason:'',legacy:true};
  }
  let total;
  try {total = grossAmount(row);} catch(e) {return invalid(0,e.message);}
  let tc,sa;
  if (row.sp === 'tocchan') [tc,sa] = [total,0];
  else if (row.sp === 'sae') [tc,sa] = [0,total];
  else if (row.sp !== 'custom' && row.sp !== 'ratio') {tc=Math.round(total/2);sa=total-tc;}
  else if (row.shareMode === 'percent' || row.sp === 'ratio') {
    if (!present(row.pct)) return invalid(total,'負担割合を入力してください');
    const pct=Number(row.pct);
    if (!Number.isFinite(pct) || pct<0 || pct>100 || !/^\d{1,3}(?:\.\d{1,2})?$/.test(String(row.pct)))
      return invalid(total,'割合は0〜100％、小数第2位までで入力してください');
    tc=Math.round(total*pct/100);sa=total-tc;
  } else {
    const hasTc=present(row.tc), hasSa=present(row.sa);
    if (!hasTc && !hasSa) return invalid(total,'どちらか一方の税込負担額を入力してください');
    if ((hasTc && !/^-?\d+$/.test(String(row.tc))) || (hasSa && !/^-?\d+$/.test(String(row.sa))))
      return invalid(total,'税込負担額は整数円で入力してください');
    tc=hasTc?Number(row.tc):total-Number(row.sa);
    sa=hasSa?Number(row.sa):total-tc;
  }
  const reason=validRange(total,tc,sa);
  return reason?invalid(total,reason):{valid:true,total,tc,sa,reason:''};
}
const fmtPct = n => String(Math.round(n*100)/100);
export function startCustom(row) {
  const s=computeShares(row);
  const total=grossAmount(row),tc=s.valid?s.tc:Math.round(total/2),sa=total-tc;
  const legacy=s.legacy?{...row.legacyShare,sp:'custom'}:undefined;
  return {...row,sp:'custom',shareMode:'yen',shareAnchor:'tc',tc:String(tc),sa:String(sa),
     ...(legacy?{legacyShare:legacy}:{legacyShare:undefined}),shareConvertWarning:''};
}
export function switchShareUnit(row,unit) {
  if (unit !== 'yen' && unit !== 'percent') throw new Error('負担指定方式が不正です');
  const s=computeShares(row);
  if (!s.valid) return {...row,shareConvertWarning:s.reason};
  if(unit==='yen') {
    const legacy=s.legacy?{...row.legacyShare,sp:'custom'}:undefined;
    return {...row,sp:'custom',shareMode:'yen',tc:String(s.tc),sa:String(s.sa),
       legacyShare:legacy,shareConvertWarning:''};
  }
  const pct=s.total===0||(s.tc===Math.round(s.total/2) && s.sa===s.total-s.tc)?50:s.tc/s.total*100;
  const pctText=fmtPct(pct);
  const candidate={...row,sp:'custom',shareMode:'percent',pct:pctText,pctEntry:pctText,shareAnchor:'tc',legacyShare:undefined};
  const calc=computeShares(candidate);
  // Switching units is presentation-only. If percentage has inadequate precision,
  // retain the exact yen values and explain why percentage mode was not entered.
  if(!calc.valid || Math.abs(calc.tc-s.tc)>1e-8 || Math.abs(calc.sa-s.sa)>1e-8)
    return {...row,shareConvertWarning:'現在の負担額は割合（小数第2位まで）で正確に表せません。金額指定のまま維持します。'};
  return {...candidate,tc:String(s.tc),sa:String(s.sa),shareConvertWarning:''};
}
export function changeShareYen(row,side,value) {
  const next={...row,sp:'custom',shareMode:'yen',shareAnchor:side,legacyShare:undefined,shareConvertWarning:''};
  const amount=grossAmount(row);
  if (!present(value) || !/^-?\d+$/.test(String(value))) {
    return {...next,[side]:String(value),[side==='tc'?'sa':'tc']:''};
  }
  const v=Number(value),other=amount-v;
  return {...next,[side]:String(value),[side==='tc'?'sa':'tc']:String(other)};
}
export function changeSharePercent(row,side,value) {
  const raw=String(value),next={...row,sp:'custom',shareMode:'percent',shareAnchor:side,pctEntry:raw,legacyShare:undefined,shareConvertWarning:''};
  if (!present(raw) || !/^\d{1,3}(?:\.\d{0,2})?$/.test(raw) || Number(raw)>100)
    return {...next,pct:'',tc:'',sa:''};
  const pct=side==='tc'?Number(raw):100-Number(raw);
  const calc=computeShares({...next,pct:fmtPct(pct)});
  return {...next,pct:fmtPct(pct),tc:calc.valid?String(calc.tc):'',sa:calc.valid?String(calc.sa):''};
}
export function percentageFields(row) {
  const active=row.shareAnchor==='sa'?'sa':'tc';
  const raw=Object.prototype.hasOwnProperty.call(row,'pctEntry')?String(row.pctEntry):
    (!present(row.pct)?'':(active==='tc'?String(row.pct):fmtPct(100-Number(row.pct))));
  if(raw==='')return {tc:'',sa:''};
  const n=Number(raw);
  if(!Number.isFinite(n)||n<0||n>100||!/^\d{1,3}(?:\.\d{0,2})?$/.test(raw))
    return active==='tc'?{tc:raw,sa:''}:{tc:'',sa:raw};
  return active==='tc'?{tc:raw,sa:fmtPct(100-n)}:{tc:fmtPct(100-n),sa:raw};
}
export function rebalanceRow(row,patch) {
  const next={...row,...patch,legacyShare:undefined,shareConvertWarning:''};
  if(next.sp!=='custom')return next;
  if(next.shareMode==='percent') {
    const x=computeShares(next);
    return {...next,tc:x.valid?String(x.tc):'',sa:x.valid?String(x.sa):''};
  }
  const anchor=next.shareAnchor==='sa'?'sa':'tc';
  return changeShareYen(next,anchor,next[anchor]);
}
// 補正前の実額負担比率で、プラス・マイナス双方のレシート調整を割り振る。
export function allocateAdjustment(rows,delta) {
  if(!Number.isSafeInteger(delta))throw new Error('差額は整数円で入力してください');
  let tc=0,sa=0;
  for(const row of rows||[]){
    const r=computeShares(row);
    if(!r.valid)throw new Error(`負担額が不正です: ${r.reason}`);
    tc+=r.tc;sa+=r.sa;
  }
  const weightTc=Math.max(0,tc),weightSa=Math.max(0,sa),denom=weightTc+weightSa;
  const adjTc=denom>0?Math.sign(delta)*Math.round(Math.abs(delta)*weightTc/denom):Math.sign(delta)*Math.ceil(Math.abs(delta)/2);
  return {valid:true,total:delta,tc:adjTc,sa:delta-adjTc,reason:''};
}
