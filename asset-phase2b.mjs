/**
 * 徳原家 家計管理 — Phase 2B 読み取り専用の財務分析コア（開発用）
 * 基準: GitHub main v2026.10.24.RC4 の資産マスター・月次残高・貯蓄目標スキーマ。
 * Firebase・localStorage・家計精算関数には一切アクセスしない。
 *
 * 想定入力:
 * master={version:1,setupComplete:true,accounts:[{id,name,kind,type,owner,startMonth,endMonth,order}]}
 * snapshots={'YYYY-MM':{month,asOfDate,balances:{[id]: number},updatedAt}}
 * savingsGoals=[{id,name,goal,total,progressSource,linkedAssetAccountIds:[id]}]
 *
 * 重要: 未入力 != 0円。未入力が1件でもあれば合計・差額を確定させない。
 */

export const TYPE_LABELS = Object.freeze({
  deposit:'預金・現金', investment:'投資', otherAsset:'その他資産',
  studentLoan:'奨学金', mortgage:'住宅ローン', autoLoan:'自動車ローン', otherLiability:'その他負債'
});
export const OWNER_LABELS = Object.freeze({tocchan:'とっくん', sae:'さえさん', shared:'共同'});
export const validMonth = m => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const tokyoMonth = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7);
export function previousMonth(month) {
  if (!validMonth(month)) throw Error('対象年月が不正です');
  const [y,m]=month.split('-').map(Number);
  const v=new Date(Date.UTC(y,m-2,1));
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth()+1).padStart(2,'0')}`;
}
export function backMonths(month,count=12) {
  if (!Number.isInteger(count)||count<1||count>240) throw Error('期間指定が不正です');
  const rows=[]; let m=month;
  for(let i=0;i<count;i++){rows.push(m);m=previousMonth(m)}
  return rows.reverse();
}
export const activeAccount = (a,month) =>
  (!a.startMonth||a.startMonth<=month)&&(!a.endMonth||month<a.endMonth);

// 既存アプリと同じく、数値0は入力済みとして扱う。
// 空文字・null・NaNなどは未入力。RC4の tkAssetHasBalance と同じ数値有効性を優先。
export function enteredBalance(balances,id) {
  if(!balances || !Object.prototype.hasOwnProperty.call(balances,id)) return null;
  const raw=balances[id];
  if(raw===null||raw===undefined||raw===''||(typeof raw==='string'&&!raw.trim())) return null;
  const num=Number(raw);
  return Number.isFinite(num)?num:null;
}
function assertMonth(month,todayMonth){
  if(!validMonth(month)||!validMonth(todayMonth))throw Error('対象年月が不正です');
}
function sortAccounts(accounts){
  const ids=new Set();
  return accounts.map(a=>{
    if(!a||typeof a.id!=='string'||!a.id.trim()||!['asset','liability'].includes(a.kind))
      throw Error('資産口座の基本データが不正です');
    if(ids.has(a.id))throw Error('資産口座IDが重複しています');
    ids.add(a.id);
    if((a.startMonth&&!validMonth(a.startMonth))||(a.endMonth&&!validMonth(a.endMonth)))
      throw Error('資産口座の管理期間が不正です');
    return a;
  }).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
}
function groupSummary(items,key){
  const groups=new Map();
  for(const row of items){
    const k=String(row.account[key]||'未設定');
    const g=groups.get(k)||{key:k,kindSet:new Set(),count:0,entered:0,missing:0,partialNet:0,accountIds:[]};
    g.count++;
    g.accountIds.push(row.account.id);
    g.kindSet.add(row.account.kind);
    if(row.value===null)g.missing++;
    else{g.entered++;g.partialNet+=row.account.kind==='liability'?-row.value:row.value}
    groups.set(k,g);
  }
  return [...groups.values()].map(g=>({
    key:g.key,label:key==='type'?(TYPE_LABELS[g.key]||g.key):(OWNER_LABELS[g.key]||g.key),
    count:g.count,entered:g.entered,missing:g.missing,complete:g.missing===0,
    amount:g.missing===0?g.partialNet:null,partialAmount:g.partialNet,
    kinds:[...g.kindSet],accountIds:g.accountIds.sort()
  }));
}

/** 入力済み金額の暫定値は partialXXX のみ。確定でない項目は null を返す。 */
export function monthlyAssetSummary(master,snapshot,month,{todayMonth=tokyoMonth()}={}){
  assertMonth(month,todayMonth);
  const accounts=sortAccounts(Array.isArray(master?.accounts)?master.accounts:[])
    .filter(a=>activeAccount(a,month));
  if(month>todayMonth)return {
    month,status:'future',future:true,accounts:[],accountRows:[],complete:false,
    partialAssets:0,partialLiabilities:0,assetTotal:null,liabilityTotal:null,netWorth:null,
    missingAssetCount:0,missingLiabilityCount:0,enteredCount:0,activeCount:0,byType:[],byOwner:[]
  };
  const snapshotValid=!!snapshot && typeof snapshot==='object' && (!snapshot.month||snapshot.month===month);
  const invalidSnapshot=!!snapshot&&!snapshotValid;
  const balances=snapshotValid&&snapshot.balances&&typeof snapshot.balances==='object'?snapshot.balances:{};
  const accountRows=accounts.map(account=>({account,value:enteredBalance(balances,account.id)}));
  const assets=accountRows.filter(r=>r.account.kind==='asset');
  const liabilities=accountRows.filter(r=>r.account.kind==='liability');
  const entered=accountRows.filter(r=>r.value!==null);
  const partialAssets=assets.reduce((s,r)=>s+(r.value??0),0);
  const partialLiabilities=liabilities.reduce((s,r)=>s+(r.value??0),0);
  const missingAssetCount=assets.filter(r=>r.value===null).length;
  const missingLiabilityCount=liabilities.filter(r=>r.value===null).length;
  const complete=accounts.length>0&&missingAssetCount===0&&missingLiabilityCount===0&&!invalidSnapshot;
  const assetTotal=missingAssetCount===0&&!invalidSnapshot?partialAssets:null;
  const liabilityTotal=missingLiabilityCount===0&&!invalidSnapshot?partialLiabilities:null;
  return {
    month,status:invalidSnapshot?'invalid_snapshot':accounts.length===0?'not_applicable':
      complete?'complete':entered.length?'incomplete':'not_entered',future:false,
    accounts,accountRows,activeCount:accounts.length,enteredCount:entered.length,
    missingAssetCount,missingLiabilityCount,complete,
    assetTotal,liabilityTotal,netWorth:complete?partialAssets-partialLiabilities:null,
    partialAssets,partialLiabilities,
    byType:groupSummary(accountRows,'type'),byOwner:groupSummary(accountRows,'owner')
  };
}

/** 2B-1 月次増減：両月の入力が完了した場合のみ確定増減を出す。 */
export function analyzeAssetChanges(master,snapshots,month,{todayMonth=tokyoMonth(),trendMonths=12}={}){
  assertMonth(month,todayMonth);
  const prevMonth=previousMonth(month);
  const current=monthlyAssetSummary(master,snapshots?.[month],month,{todayMonth});
  const previous=monthlyAssetSummary(master,snapshots?.[prevMonth],prevMonth,{todayMonth});
  const delta=(x,y)=>x===null||y===null?null:x-y;
  const netChange=delta(current.netWorth,previous.netWorth);
  const assetChange=delta(current.assetTotal,previous.assetTotal);
  const liabilityChange=delta(current.liabilityTotal,previous.liabilityTotal);
  const prevMap=new Map(previous.accountRows.map(r=>[r.account.id,r]));
  const accountChanges=current.accountRows.map(row=>{
    const p=prevMap.get(row.account.id);
    const previousStatus=!p?'previous_not_applicable':p.value===null?'previous_missing':'complete';
    const currentStatus=row.value===null?'current_missing':'complete';
    return {
      accountId:row.account.id,name:row.account.name,kind:row.account.kind,
      type:row.account.type,owner:row.account.owner,
      current:row.value,previous:p?.value??null,
      change:p&&row.value!==null&&p.value!==null?row.value-p.value:null,
      status:currentStatus!=='complete'?currentStatus:previousStatus
    };
  });
  // 種類・所有者別の前月比も、両月に同じ口座集合が存在し全件入力済みの場合のみ表示。
  // 新設・廃止により構成が変わった場合は、前月0円を仮定した比較を避ける。
  const compareGroups=(currentGroups,prevGroups)=>{
    const prevGroupsMap=new Map(prevGroups.map(g=>[g.key,g]));
    return currentGroups.map(g=>{
      const p=prevGroupsMap.get(g.key);
      const sameAccounts=!!p && g.accountIds.join('|')===p.accountIds.join('|');
      const comparable=sameAccounts&&g.complete&&p.complete;
      return {...g,prevAmount:p?.amount??null,
        change:comparable?g.amount-p.amount:null,
        comparisonStatus:!p?'previous_not_applicable':!sameAccounts?'scope_changed':
          comparable?'complete':'missing'};
    });
  };
  const byTypeChanges=compareGroups(current.byType,previous.byType);
  const byOwnerChanges=compareGroups(current.byOwner,previous.byOwner);
  const trendEnd=month>todayMonth?todayMonth:month;
  const trend=backMonths(trendEnd,trendMonths).map(m=>{
    const summary=monthlyAssetSummary(master,snapshots?.[m],m,{todayMonth});
    return {month:m,status:summary.status,netWorth:summary.netWorth,
      enteredCount:summary.enteredCount,activeCount:summary.activeCount,
      partialNet:summary.partialAssets-summary.partialLiabilities};
  });
  return {month,prevMonth,current,previous,netChange,assetChange,liabilityChange,
    accountChanges,byType:byTypeChanges,byOwner:byOwnerChanges,trend};
}

/** 2B-2 貯蓄目標：資産連携済みの目標のみ。旧方式の概算は混在させない。 */
export function analyzeLinkedSavingsGoals(goals,master,snapshots,month,{todayMonth=tokyoMonth()}={}){
  assertMonth(month,todayMonth);
  const all=sortAccounts(Array.isArray(master?.accounts)?master.accounts:[]);
  const accounts=new Map(all.map(a=>[a.id,a]));
  const prev=previousMonth(month);
  const currentBalances=(snapshots?.[month]?.month && snapshots[month].month!==month)?{}:(snapshots?.[month]?.balances||{});
  const prevBalances=(snapshots?.[prev]?.month && snapshots[prev].month!==prev)?{}:(snapshots?.[prev]?.balances||{});
  const linked=(Array.isArray(goals)?goals:[]).filter(g=>g?.progressSource==='asset');
  const links=linked.map(g=>Array.isArray(g.linkedAssetAccountIds)?g.linkedAssetAccountIds[0]:null).filter(Boolean);
  const duplicates=new Set(links.filter((id,i)=>links.indexOf(id)!==i));
  const result=linked.map(goal=>{
    const accountId=Array.isArray(goal.linkedAssetAccountIds)?goal.linkedAssetAccountIds[0]||null:null;
    const account=accounts.get(accountId);
    let status='ready';
    if(month>todayMonth)status='future';
    else if(!accountId||!account||account.kind!=='asset')status='invalid_link';
    else if(duplicates.has(accountId))status='duplicate_link';
    else if(!activeAccount(account,month))status='not_applicable';
    let balance=status==='ready'?enteredBalance(currentBalances,accountId):null;
    if(status==='ready'&&balance===null)status='not_entered';
    const goalAmount=Number(goal.goal);
    const validGoal=Number.isSafeInteger(goalAmount)&&goalAmount>0;
    const contribution=Number(goal.total);
    const validContribution=Number.isSafeInteger(contribution)&&contribution>0;
    const remaining=balance!==null&&validGoal?Math.max(0,goalAmount-balance):null;
    const progress=balance!==null&&validGoal?balance/goalAmount*100:null;
    const etaMonths=remaining===null?null:remaining===0?0:validContribution?Math.ceil(remaining/contribution):null;
    const prevBalance=status==='ready'&&activeAccount(account,prev)?enteredBalance(prevBalances,accountId):null;
    return {
      id:goal.id,name:goal.name,accountId,accountName:account?.name??null,status,
      goal:validGoal?goalAmount:null,monthlyContribution:validContribution?contribution:null,
      balance,remaining,progressPercentage:progress,progressBarPercentage:progress===null?null:Math.min(100,progress),
      etaMonths,previousBalance:prevBalance,
      balanceChange:balance!==null&&prevBalance!==null?balance-prevBalance:null,
      projectionNote:etaMonths===null?null:'毎月の積立額が一定で運用損益・出金なしの仮定'
    };
  });
  return {month,goals:result,linkedGoalCount:result.length,completeGoalCount:result.filter(r=>r.progressPercentage!==null).length,
    hasDuplicateLinks:duplicates.size>0};
}
