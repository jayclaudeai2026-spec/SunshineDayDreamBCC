// CSV parsing helpers tuned for QuickBooks Desktop export quirks.

import { parse as parseCsv } from "https://deno.land/std@0.224.0/csv/parse.ts";

export function parseCsvText(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const rows = parseCsv(cleaned, {
    skipFirstRow: false,
    separator: ",",
    trimLeadingSpace: false,
  }) as string[][];
  return rows;
}

export function isBlankRow(row: string[]): boolean {
  return row.every((c) => (c ?? "").trim() === "");
}

export function parseNumber(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const trimmed = String(raw).trim();
  if (trimmed === "" || trimmed === "-" || /^n\/?a$/i.test(trimmed)) return 0;

  const negParens = /^\((.*)\)$/.test(trimmed);
  let inner = trimmed.replace(/^\((.*)\)$/, "$1");
  inner = inner.replace(/[$,\s]/g, "");
  if (inner === "") return 0;

  const n = Number(inner);
  if (!Number.isFinite(n)) return 0;
  return negParens ? -n : n;
}

export function parseNumberStrict(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "" || trimmed === "-" || /^n\/?a$/i.test(trimmed)) return 0;

  const negParens = /^\((.*)\)$/.test(trimmed);
  let inner = trimmed.replace(/^\((.*)\)$/, "$1");
  inner = inner.replace(/[$,\s]/g, "");
  if (inner === "") return null;

  const n = Number(inner);
  if (!Number.isFinite(n)) return null;
  return negParens ? -n : n;
}

export function leadingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === " ") n++;
  return n;
}

export function isTotalRow(label: string): boolean {
  const t = label.trim().toLowerCase();
  return /^total\b/i.test(t) || /^net\s+income$/i.test(t) ||
    /^gross\s+profit$/i.test(t) || /^net\s+ordinary\s+income$/i.test(t);
}

export function normalizeHeader(s: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface MonthColumn {
  index: number;
  period: string;
  raw: string;
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

export function detectMonthColumns(headerRow: string[]): MonthColumn[] {
  const out: MonthColumn[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const cell = (headerRow[i] ?? "").trim();
    if (!cell) continue;

    const m1 = cell.match(
      /^([a-z]+)[\s\-_/]+(20\d{2}|\d{2})$/i,
    );
    if (m1) {
      const monthKey = m1[1].toLowerCase().replace(/\.$/, "");
      const mm = MONTH_MAP[monthKey];
      if (mm) {
        let yyyy = m1[2];
        if (yyyy.length === 2) yyyy = `20${yyyy}`;
        out.push({ index: i, period: `${yyyy}-${mm}-01`, raw: cell });
        continue;
      }
    }

    const m2 = cell.match(/^(\d{1,2})\/(\d{4})$/);
    if (m2) {
      const mm = m2[1].padStart(2, "0");
      if (mm >= "01" && mm <= "12") {
        out.push({ index: i, period: `${m2[2]}-${mm}-01`, raw: cell });
        continue;
      }
    }

    const m3 = cell.match(/^(20\d{2})[\-_\/](\d{1,2})$/);
    if (m3) {
      const mm = m3[2].padStart(2, "0");
      if (mm >= "01" && mm <= "12") {
        out.push({ index: i, period: `${m3[1]}-${mm}-01`, raw: cell });
        continue;
      }
    }
  }
  return out;
}

export function detectDateCell(s: string): string | null {
  const cell = (s ?? "").trim();
  if (!cell) return null;

  const m1 = cell.match(/(20\d{2})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (m1) {
    const yyyy = m1[1];
    const mm = m1[2].padStart(2, "0");
    const dd = m1[3].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const m2 = cell.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](20\d{2}|\d{2})/);
  if (m2) {
    const mm = m2[1].padStart(2, "0");
    const dd = m2[2].padStart(2, "0");
    let yyyy = m2[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  const m3 = cell.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2}|\d{2})/i);
  if (m3) {
    const mm = MONTH_MAP[m3[1].toLowerCase()];
    if (mm) {
      const dd = m3[2].padStart(2, "0");
      let yyyy = m3[3];
      if (yyyy.length === 2) yyyy = `20${yyyy}`;
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  return null;
}
