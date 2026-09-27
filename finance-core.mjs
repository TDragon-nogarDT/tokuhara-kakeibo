/**
 * 徳原家 家計管理アプリ — 財務計算コア（v0011互換抽出版）
 *
 * 目的:
 * - v2026.09.27.0011 のビルド済みバンドルに埋め込まれている財務計算を、
 *   UI/Firebaseから独立した純粋関数として読める形にする。
 * - 現行仕様を「改善」せず、まず互換動作を固定する。
 *
 * 注意:
 * - このファイルはまだ本番 index.html から呼ばれていない。
 * - 変更はテストで既存仕様との差分を確認してから行うこと。
 */

export function getActualAmount(row = {}) {
  const amount = Number(row.amt) || 0;
  if (row.tax === "10") return Math.round(amount * 1.1);
  if (row.tax === "8") return Math.round(amount * 1.08);
  return amount; // inc（内税）その他はそのまま
}

/**
 * 品目の分担額を計算する。
 * v0011の getSp と同じ挙動を維持する。
 */
export function splitAmount(row = {}) {
  const total = getActualAmount(row);
  const half = Math.round(total / 2);

  if (row.sp === "half") return { tocchan: half, sae: total - half };
  if (row.sp === "tocchan") return { tocchan: total, sae: 0 };
  if (row.sp === "sae") return { tocchan: 0, sae: total };

  // v0011互換: custom入力が0の場合は || により半々へフォールバックする。
  // 将来ここを変える場合は、既存データ/UIとの互換性を別途検討すること。
  return {
    tocchan: Number(row.tc) || half,
    sae: Number(row.sa) || (total - half),
  };
}

export function inferSplitMode({ tocchan, sae } = {}) {
  if (Number(sae) === 0) return "tocchan";
  if (Number(tocchan) === 0) return "sae";
  if (tocchan === sae) return "half";
  return "custom";
}

/**
 * 既存の共同費1件を編集フォーム用の品目配列へ戻す。
 * rawAmtのない旧形式は、二重課税防止のため tax="inc" に固定する。
 */
export function normalizeSharedExpenseForEdit(item) {
  if (!item) {
    return [{
      id: Date.now(),
      name: "",
      amt: "",
      cat: "other",
      sp: "half",
      tc: "",
      sa: "",
      tax: "inc",
    }];
  }

  if (Array.isArray(item.items) && item.items.length > 0) {
    return item.items.map((subItem, index) => ({
      id: index + 1,
      name: subItem.name || "",
      amt: subItem.rawAmt != null ? String(subItem.rawAmt) : String(subItem.total || ""),
      cat: subItem.category || "other",
      sp: subItem.sp || inferSplitMode(subItem),
      tc: String(subItem.tocchan || ""),
      sa: String(subItem.sae || ""),
      tax: subItem.rawAmt != null ? (subItem.tax || "inc") : "inc",
    }));
  }

  return [{
    id: 1,
    name: item.memo || "",
    amt: item.rawAmt != null ? String(item.rawAmt) : String(item.total || ""),
    cat: item.category || "other",
    sp: inferSplitMode(item),
    tc: String(item.tocchan || ""),
    sa: String(item.sae || ""),
    tax: item.rawAmt != null ? (item.tax || "inc") : "inc",
  }];
}

/**
 * 共同費フォームの入力をFirebase保存用payloadへ変換する。
 * v0011 Ede.doSave の金額ロジックを純粋関数化したもの。
 */
export function buildSharedExpensePayload({
  storeName = "",
  rows = [],
  method = "",
  date = "",
  special = false,
  isIncome = false,
  settled = false,
  existingId,
} = {}) {
  const validRows = rows.filter(
    (row) => row.amt !== "" && row.amt != null && Number(row.amt) !== 0,
  );
  if (!validRows.length) return null;

  const idPart = existingId != null ? { id: existingId } : {};

  if (isIncome) {
    const row = validRows[0];
    const total = Math.abs(getActualAmount(row));
    const { tocchan, sae } = splitAmount(row);

    return {
      name: storeName || row.name || "収入",
      category: row.cat || "gift",
      total: -total,
      rawAmt: String(Math.abs(Number(row.amt) || 0)),
      tocchan: -Math.abs(tocchan),
      sae: -Math.abs(sae),
      method,
      date,
      memo: row.name || "",
      special: false,
      tax: "inc",
      isIncome: true,
      ...idPart,
    };
  }

  if (validRows.length === 1) {
    const row = validRows[0];
    const total = getActualAmount(row);
    const { tocchan, sae } = splitAmount(row);

    return {
      name: storeName || row.name || "支出",
      category: row.cat || "other",
      total,
      rawAmt: row.amt,
      tocchan,
      sae,
      method,
      date,
      memo: row.name || "",
      special,
      tax: row.tax || "inc",
      isIncome: false,
      settled,
      ...idPart,
    };
  }

  const items = validRows.map((row) => {
    const total = getActualAmount(row);
    const { tocchan, sae } = splitAmount(row);
    return {
      name: row.name || "",
      category: row.cat || "other",
      total,
      rawAmt: row.amt,
      tocchan,
      sae,
      tax: row.tax || "inc",
      sp: row.sp,
      tocchanInput: row.tc,
      saeInput: row.sa,
    };
  });

  return {
    name: storeName || "支出",
    category: validRows[0].cat || "other",
    total: items.reduce((sum, item) => sum + item.total, 0),
    tocchan: items.reduce((sum, item) => sum + item.tocchan, 0),
    sae: items.reduce((sum, item) => sum + item.sae, 0),
    method,
    date,
    memo: "",
    special,
    tax: "inc",
    items,
    isIncome: false,
    settled,
    ...idPart,
  };
}

export function sumAmounts(entries = [], mapper = (entry) => entry) {
  return entries.reduce((sum, entry) => {
    const value = mapper(entry) || {};
    return {
      total: sum.total + (value.total || 0),
      tocchan: sum.tocchan + (value.tocchan || 0),
      sae: sum.sae + (value.sae || 0),
    };
  }, { total: 0, tocchan: 0, sae: 0 });
}

export function isPersonalPayment(expense = {}) {
  const method = expense.method;
  const tocchanPersonal = method?.includes("とっくん") && !method?.includes("家族");
  const saePersonal = method?.includes("さえさん") && !method?.includes("家族");
  return Boolean(tocchanPersonal || saePersonal);
}

export function makeSavingsPaymentPredicate(savings = []) {
  const savingsMethods = new Set(
    savings.filter((item) => item.total > 0).map((item) => `${item.name}（貯蓄口座）`),
  );
  return (expense = {}) => savingsMethods.has(expense.method);
}

/**
 * 共同口座精算・個人間立替精算を含む月次集計。
 * v0011 の Dl(master, monthData, forceLive) と同じ計算順序を維持する。
 */
export function calculateHouseholdTotals(master, monthData, forceLive = false) {
  if (!master || !monthData) return null;

  const snapshot = forceLive ? null : monthData._masterSnapshot;
  const fixedExpenses = snapshot?.fixedExpenses || master.fixedExpenses || [];
  const subscriptions = snapshot?.subscriptions || master.subscriptions || [];
  const savings = snapshot?.savings || master.savings || [];
  const advanceTransfer = snapshot?.advanceTransfer ?? master.advanceTransfer;

  const savingsTotal = sumAmounts(savings);
  const fixed = sumAmounts(
    fixedExpenses,
    (item) => monthData.fixedOverrides?.[item.id] || item,
  );
  const subs = sumAmounts(
    subscriptions,
    (item) => monthData.fixedOverrides?.[item.id] || item,
  );

  const variableExpenses = monthData.variableExpenses || [];
  const isSavingsPayment = makeSavingsPaymentPredicate(savings);

  // 貯蓄口座払いは精算対象外。ただし variable / expense / grand の実績集計には含む。
  const nonSavingsVariable = variableExpenses.filter((item) => !isSavingsPayment(item));

  // 個人払いは共同口座精算から除外し、interPersonでのみ精算する。
  const sharedSettlementVariable = nonSavingsVariable.filter((item) => !isPersonalPayment(item));

  const variable = sumAmounts(variableExpenses);
  const sharedVariable = sumAmounts(sharedSettlementVariable);
  const regularVar = sumAmounts(variableExpenses.filter((item) => !item.special));
  const specialVar = sumAmounts(variableExpenses.filter((item) => item.special));

  const expense = {
    total: fixed.total + subs.total + variable.total,
    tocchan: fixed.tocchan + subs.tocchan + variable.tocchan,
    sae: fixed.sae + subs.sae + variable.sae,
  };

  const grand = {
    total: savingsTotal.total + expense.total,
    tocchan: savingsTotal.tocchan + expense.tocchan,
    sae: savingsTotal.sae + expense.sae,
  };

  const tocchanSharedBurden = fixed.tocchan + subs.tocchan + sharedVariable.tocchan;
  const saeSharedBurden = fixed.sae + subs.sae + sharedVariable.sae;

  const tocchanRequired = savingsTotal.tocchan + tocchanSharedBurden;
  const saeRequired = savingsTotal.sae + saeSharedBurden;

  const catTotals = {};
  variableExpenses.forEach((item) => {
    const category = item.category || "other";
    catTotals[category] ||= { total: 0, tocchan: 0, sae: 0 };
    catTotals[category].total += item.total || 0;
    catTotals[category].tocchan += item.tocchan || 0;
    catTotals[category].sae += item.sae || 0;
  });

  const tocchanPaidForSae = nonSavingsVariable
    .filter((item) => !item.settled && item.method?.includes("とっくん") && !item.method?.includes("家族"))
    .reduce((sum, item) => sum + (item.sae || 0), 0);

  const saePaidForTocchan = nonSavingsVariable
    .filter((item) => !item.settled && item.method?.includes("さえさん") && !item.method?.includes("家族"))
    .reduce((sum, item) => sum + (item.tocchan || 0), 0);

  const interPerson = tocchanPaidForSae - saePaidForTocchan;

  return {
    savings: savingsTotal,
    fixed,
    subs,
    variable,
    regularVar,
    specialVar,
    expense,
    grand,
    advance: advanceTransfer,
    tocchanBalance: tocchanRequired - advanceTransfer,
    saeBalance: saeRequired - advanceTransfer,
    interPerson,
    tocchanPaidForSae,
    saePaidForTocchan,
    catTotals,
  };
}

/**
 * 個人費の毎月費用選択。
 * 今月は最新master、過去・未来は保存済みsnapshotを優先する。
 */
export function selectPersonalRecurring({
  month,
  currentMonth,
  person,
  personalData = {},
  master = {},
} = {}) {
  const live = master?.personalRecurring?.[person];
  return (month === currentMonth ? live : (personalData._recurringSnapshot || live)) || [];
}

/**
 * 個人費画面の主要な収支計算を純粋関数化。
 * v0011 Mde の O/H/L/Y/ce/spTotal/regularExp に対応する。
 */
export function calculatePersonalSummary({
  month,
  currentMonth,
  person,
  personalData = {},
  master = {},
  sharedAmount = 230000,
} = {}) {
  const income = Number(personalData.income) || 0;
  const bonus = Number(personalData.bonus) || 0;
  const totalIncome = income + bonus;
  const expenses = personalData.expenses || [];
  const recurring = selectPersonalRecurring({
    month,
    currentMonth,
    person,
    personalData,
    master,
  });

  const recurringTotal = recurring.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const variableTotal = expenses.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalExpenses = variableTotal + recurringTotal;
  const netCash = totalIncome - (Number(sharedAmount) || 0) - totalExpenses;
  const specialTotal = expenses
    .filter((item) => item.special)
    .reduce((sum, item) => sum + Number(item.total || 0), 0);
  const regularExpenses = totalExpenses - specialTotal;

  return {
    income,
    bonus,
    totalIncome,
    recurring,
    recurringTotal,
    variableTotal,
    totalExpenses,
    sharedAmount: Number(sharedAmount) || 0,
    netCash,
    specialTotal,
    regularExpenses,
  };
}
