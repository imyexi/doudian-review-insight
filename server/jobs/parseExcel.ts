import xlsx from "xlsx";
import { parseChineseDateToUnix } from "../utils/time";

const REQUIRED_HEADERS = [
  "评价日期",
  "订单ID",
  "商品ID",
  "商品名称",
  "商品规格",
  "商品评价得分",
  "评价内容",
] as const;

export class ParseExcelError extends Error {}

export interface ParsedReviewRow {
  userNick: string | null;
  reviewTime: number;
  orderId: string | null;
  productId: string;
  productName: string | null;
  productSpec: string | null;
  rating: number | null;
  level: string | null;
  content: string | null;
  appendContent: string | null;
  appendTime: number | null;
  merchantReplied: boolean;
  replyContent: string | null;
  shopExternalId: string | null;
  shopName: string | null;
}

function getCellString(record: Record<string, unknown>, header: string): string | null {
  const value = record[header];
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function parseRating(record: Record<string, unknown>): number | null {
  const raw = getCellString(record, "商品评价得分");
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(1, Math.min(5, Math.round(numeric)));
}

export function parseExcel(filePath: string): ParsedReviewRow[] {
  const workbook = xlsx.readFile(filePath, { raw: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new ParseExcelError("Excel 中没有可读取的工作表");
  }

  const sheet = workbook.Sheets[firstSheet];
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (!rows.length) {
    throw new ParseExcelError("Excel 中没有评论数据");
  }

  const headers = Object.keys(rows[0] ?? {});
  const missingHeaders = REQUIRED_HEADERS.filter(header => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new ParseExcelError(`缺少必要列: ${missingHeaders.join(", ")}`);
  }

  return rows.map((row, index) => {
    const reviewTime = parseChineseDateToUnix(getCellString(row, "评价日期"));
    if (!reviewTime) {
      throw new ParseExcelError(`第 ${index + 2} 行评价日期无效`);
    }

    const productId = getCellString(row, "商品ID");
    if (!productId) {
      throw new ParseExcelError(`第 ${index + 2} 行商品ID为空`);
    }

    return {
      userNick: getCellString(row, "用户昵称"),
      reviewTime,
      orderId: getCellString(row, "订单ID"),
      productId,
      productName: getCellString(row, "商品名称"),
      productSpec: getCellString(row, "商品规格"),
      rating: parseRating(row),
      level: getCellString(row, "评价等级"),
      content: getCellString(row, "评价内容"),
      appendContent: getCellString(row, "追评内容"),
      appendTime: parseChineseDateToUnix(getCellString(row, "追评时间")),
      merchantReplied: getCellString(row, "商家是否回复") === "已回复",
      replyContent: getCellString(row, "回复内容"),
      shopExternalId: getCellString(row, "门店ID"),
      shopName: getCellString(row, "门店名称"),
    };
  });
}
