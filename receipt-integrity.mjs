import { allocateAdjustment } from "./split-integrity.mjs";
// 家計管理: レシートに印字された税込請求額と明細の整合性を保つ。
// 合計の差を黙って商品単価に混ぜず、「差額調整」の独立行として明示する。
export const RECEIPT_ADJUSTMENT_NAME = "レシート合計の端数調整";
export const AUTO_ADJUST_LIMIT_YEN = 10;

export function parseReceiptTotal(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.replace(/[￥¥,，\s円]/g, "") : value;
  const result = Number(normalized);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

export function receiptRowAmount(row) {
  const raw = Number(row.amt ?? row.price ?? 0);
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) throw new Error("商品金額は整数円で入力してください");
  if (row.tax === "8") return Math.round(raw * 1.08);
  if (row.tax === "10") return Math.round(raw * 1.10);
  return raw;
}

export function receiptRowsSum(rows) {
  return (rows || []).reduce((sum, row) => sum + receiptRowAmount(row), 0);
}

export function receiptDelta(rows, target) {
  const parsed = parseReceiptTotal(target);
  if (parsed === null) return null;
  return parsed - receiptRowsSum(rows);
}

export function reconcileReceiptRows(rows, target, { autoLimit = AUTO_ADJUST_LIMIT_YEN, force = false, proportional = false, idFactory = () => Date.now() } = {}) {
  const copy = (rows || []).filter(row => row.name !== RECEIPT_ADJUSTMENT_NAME).map(row => ({ ...row }));
  const parsed = parseReceiptTotal(target);
  if (parsed === null) return { rows: copy, state: "no-total", delta: null };
  const delta = parsed - receiptRowsSum(copy);
  if (delta === 0) return { rows: copy, state: "matched", delta: 0 };
  if (Math.abs(delta) > autoLimit && !force) return { rows: copy, state: "review", delta };
  const cat = copy.find(row => row.cat)?.cat || "other";
  const split = proportional ? allocateAdjustment(copy, delta) : null;
  copy.push({ id: idFactory(), name: RECEIPT_ADJUSTMENT_NAME, amt: String(delta), cat, tax: "inc", sp: split ? "custom" : "half", tc: split ? String(split.tc) : "", sa: split ? String(split.sa) : "", ...(split ? {shareMode:"yen", shareAnchor:"tc", autoSplit:"proportional"} : {}) });
  if (receiptRowsSum(copy) !== parsed) throw new Error("合計の整合性を保てませんでした");
  return { rows: copy, state: Math.abs(delta) <= autoLimit ? "adjusted" : "confirmed-adjustment", delta };
}

export function dateMatchesMonth(month, date) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)) || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(String(date))) return false;
  const d = new Date(date + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date && date.slice(0, 7) === month;
}
