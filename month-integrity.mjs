/**
 * 家計管理｜共同費の誤月保存・大量消去防止／復元可能な変更履歴。
 * Pure module: network/auth, UI and credentials live in index.html, not here.
 * 履歴は月次データと同一のFirebaseキーにCASで原子的に保存する。
 */
export const HISTORY_FIELD = '__tkMonthHistoryV1';
export const HISTORY_SCHEMA_VERSION = 1;
export const MAX_HISTORY_ENTRIES = 120;
export const MAX_HISTORY_BYTES = 3000000;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

function parseMonth(month,raw) {
  if (!YM.test(month)) throw new Error('保存対象月の形式が不正です');
  if (raw === null || raw === undefined) return {variableExpenses: [],fixedOverrides:{}};
  if (typeof raw !== 'string') throw new Error('現在の月次データの型が不正です');
  const obj=JSON.parse(raw);
  if (!obj || Array.isArray(obj) || typeof obj!=='object' || !Array.isArray(obj.variableExpenses)) {
    throw new Error('月次データの構造が不正です');
  }
  return obj;
}
function withoutHistory(obj) {
  const copy={...obj};delete copy[HISTORY_FIELD];return copy;
}
function restOf(obj) {
  const copy=withoutHistory(obj);
  delete copy.variableExpenses;delete copy.fixedOverrides;
  return copy;
}
function indexRows(rows) {
  const m=new Map();
  for(const row of rows) {
    const id=String(row?.id ?? '');
    if(!id||m.has(id)) throw new Error('取引IDの欠損・重複を検出しました');
    m.set(id,row);
  }
  return m;
}

/** 本番データの大量置換を阻止。既存の異年日付は無変更なら通す。 */
export function validateJointMonthChange(month,currentRaw,next) {
  const previous=parseMonth(month,currentRaw);
  if (!next || Array.isArray(next) || !Array.isArray(next.variableExpenses)) throw new Error('保存する共同費の形式が不正です');
  if(next.fixedOverrides!==undefined&&(!next.fixedOverrides||typeof next.fixedOverrides!=='object'||Array.isArray(next.fixedOverrides)))throw new Error('月別固定費の形式が不正です');
  const prev=indexRows(previous.variableExpenses),after=indexRows(next.variableExpenses);
  const removed=[...prev.keys()].filter(id=>!after.has(id));
  if(removed.length>1)throw new Error(`既存明細が${removed.length}件同時に消える操作を検知しました。保存を中止しました`);
  for(const [id,row] of after) {
    const old=prev.get(id);
    if(row.date && String(row.date).slice(0,7)!==month && (!old || old.date!==row.date)) {
      throw new Error('新規・変更した取引日が対象月と異なります。保存を中止しました');
    }
  }
  if(previous[HISTORY_FIELD]!==undefined&&!Array.isArray(previous[HISTORY_FIELD]))throw new Error('変更履歴が破損しているため保存を中止しました');
  return {previousCount:prev.size,nextCount:after.size,removedCount:removed.length};
}

// 差分履歴は連続した鎖でなければ復元できないため、古い先頭からのみ削除する。
function pruneHistory(entries) {
  return entries.slice(-MAX_HISTORY_ENTRIES);
}
function capSize(entries) {
  let h=entries.slice();
  while(h.length>1 && JSON.stringify(h).length>MAX_HISTORY_BYTES)h.shift();
  if(JSON.stringify(h).length>MAX_HISTORY_BYTES)throw new Error('共同費の変更履歴が保存容量の上限を超えました');
  return h;
}

/** 既存Firebase月次レコード + 新レコード -> 原子的に保存する履歴付きレコード。 */
export function createVersionedMonth(month,currentRaw,next,at=new Date().toISOString()) {
  validateJointMonthChange(month,currentRaw,next);
  const previous=parseMonth(month,currentRaw);
  const before=withoutHistory(previous),after=withoutHistory(next);
  const prevRows=indexRows(before.variableExpenses),nextRows=indexRows(after.variableExpenses);
  const prevOrder=[...prevRows.keys()],added=[],changed={};
  for(const [id,row] of nextRows) if(!prevRows.has(id))added.push(id);
  for(const [id,row] of prevRows)if(!nextRows.has(id)||!same(row,nextRows.get(id)))changed[id]=row;
  const beforeRest=restOf(before),afterRest=restOf(after);
  const record={
    schema:HISTORY_SCHEMA_VERSION,month,at,
    beforeWasNull:currentRaw===null,
    prevOrder, addedIds:added, priorRows:changed,
    beforeCount:prevOrder.length,afterCount:nextRows.size,
    beforeVariableTotal:before.variableExpenses.reduce((s,r)=>s+(Number(r.total)||0),0),
    afterVariableTotal:after.variableExpenses.reduce((s,r)=>s+(Number(r.total)||0),0)
  };
  if(!same(before.fixedOverrides,after.fixedOverrides)) record.beforeFixedOverrides=before.fixedOverrides;
  if(!same(beforeRest,afterRest)) record.beforeOtherFields=beforeRest;
  const history=previous[HISTORY_FIELD]||[];
  if(history.some(r=>!r||typeof r.at!=='string'||typeof r.month!=='string'||r.month!==month||!Array.isArray(r.prevOrder)))throw new Error('変更履歴が破損しているため保存を中止しました');
  return {...after,[HISTORY_FIELD]:capSize(pruneHistory([...history,record]))};
}

/** 履歴から1世代前のデータを再構成。これは読み取り専用で、DBへの書き込みはしない。 */
export function reconstructPriorMonth(after,record) {
  if(!record||!Array.isArray(record.prevOrder)||!Array.isArray(record.addedIds)||!record.priorRows)throw new Error('履歴の形式が不正です');
  if(record.beforeWasNull)return null;
  if(!after||!Array.isArray(after.variableExpenses))throw new Error('現在の月次データが不正です');
  const afterMap=indexRows(after.variableExpenses),before=[];
  for(const id of record.prevOrder) {
    const row=own(record.priorRows,id)?record.priorRows[id]:afterMap.get(id);
    if(!row)throw new Error('必要な過去明細を再構成できません');
    before.push(row);
  }
  const restored={...withoutHistory(after),variableExpenses:before};
  if(own(record,'beforeFixedOverrides'))restored.fixedOverrides=record.beforeFixedOverrides;
  if(own(record,'beforeOtherFields')) {
    for(const key of Object.keys(restOf(restored)))delete restored[key];
    Object.assign(restored,record.beforeOtherFields);
  }
  return restored;
}

/** 現行月から過去へ、最新から順にひとつずつ読み取り専用で復元可能。 */
export function listHistoricalMonthStates(current) {
  if(!current||!Array.isArray(current.variableExpenses))throw new Error('月次データが不正です');
  const history=current[HISTORY_FIELD]||[];
  if(!Array.isArray(history))throw new Error('変更履歴が不正です');
  const states=[];let state=withoutHistory(current);
  for(let i=history.length-1;i>=0;i--) {
    const entry=history[i];
    state=reconstructPriorMonth(state,entry);
    states.push({at:entry.at,beforeCount:entry.beforeCount,beforeVariableTotal:entry.beforeVariableTotal,state});
    if(state===null)break;
  }
  return states;
}
