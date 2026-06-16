// Mustache substitution and reporting-period parsing.

/** Substitute {{VAR}} placeholders. Unknown vars left as-is for visibility. */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key)
      ? vars[key]
      : match;
  });
}

/** Returns YYYY-MM-01 from subject/filename strings, or null if not detected. */
export function parseReportingPeriod(candidates: string[]): string | null {
  const haystack = candidates.filter(Boolean).join(" ");

  // YYYY-MM, YYYY/MM, YYYY_MM
  const m1 = haystack.match(/\b(20\d{2})[\-_\/](0[1-9]|1[0-2])\b/);
  if (m1) return `${m1[1]}-${m1[2]}-01`;

  // MM-YYYY, MM/YYYY
  const m2 = haystack.match(/\b(0[1-9]|1[0-2])[\-_\/](20\d{2})\b/);
  if (m2) return `${m2[2]}-${m2[1]}-01`;

  // "May 2026", "September 2025", "Sept 2025"
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04",
    jun: "06", jul: "07", aug: "08",
    sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
  };
  const m3 = haystack.toLowerCase().match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(20\d{2})\b/,
  );
  if (m3) {
    const mm = months[m3[1]];
    if (mm) return `${m3[2]}-${mm}-01`;
  }

  return null;
}

/** "2026-05-01" → "May 2026". Defensive on bad input. */
export function periodLabel(reportingPeriod: string | null): string {
  if (!reportingPeriod) return "(period not detected)";
  const parts = reportingPeriod.split("-");
  if (parts.length < 2) return reportingPeriod;
  const [y, m] = parts;
  const names = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const mm = parseInt(m, 10);
  if (mm < 1 || mm > 12) return reportingPeriod;
  return `${names[mm]} ${y}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
