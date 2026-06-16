// Shared utilities used across modules.

import { format, formatDistanceToNow, parseISO } from 'date-fns';

/**
 * Currency formatter — defaults to USD. Returns "$1,234.56" or "($1,234.56)" for negatives.
 */
export function fmtCurrency(value, { currency = 'USD', signed = false, abbreviate = false } = {}) {
  if (value == null) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';

  if (abbreviate && Math.abs(n) >= 1000) {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    currencySign: signed ? 'accounting' : 'standard',
  });
  return formatter.format(n);
}

/**
 * Percent formatter. fmtPct(0.15) -> "15.0%", fmtPct(15) -> "15.0%" if alreadyScaled=true.
 */
export function fmtPct(value, { decimals = 1, alreadyScaled = false } = {}) {
  if (value == null) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  const scaled = alreadyScaled ? n : n * 100;
  return `${scaled.toFixed(decimals)}%`;
}

/**
 * Date formatter. fmtDate('2026-06-15') -> "Jun 15, 2026"
 */
export function fmtDate(value, dateFormat = 'MMM d, yyyy') {
  if (!value) return '—';
  const d = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(d?.getTime?.())) return '—';
  return format(d, dateFormat);
}

/**
 * Relative time. fmtRelative('2026-06-14') -> "1 day ago"
 */
export function fmtRelative(value) {
  if (!value) return '—';
  const d = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(d?.getTime?.())) return '—';
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Month formatter. fmtMonth('2026-06-01') -> "Jun 2026"
 */
export function fmtMonth(value) {
  return fmtDate(value, 'MMM yyyy');
}

/**
 * Classnames helper — like `clsx` but tiny. cn('a', cond && 'b', 'c') -> 'a c' or 'a b c'.
 */
export function cn(...args) {
  return args.filter(Boolean).join(' ');
}

/**
 * Truncate a string with ellipsis.
 */
export function truncate(s, n = 80) {
  if (s == null) return '';
  if (typeof s !== 'string') s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Health signal -> pill color class lookup.
 */
export function healthPillClass(signal) {
  switch (signal) {
    case 'healthy':     return 'ia-pill-success';
    case 'degraded':    return 'ia-pill-warning';
    case 'unhealthy':   return 'ia-pill-danger';
    case 'has_failures': return 'ia-pill-danger';
    case 'backlog':     return 'ia-pill-warning';
    case 'stale':       return 'ia-pill-warning';
    case 'no_ingest_yet': return 'ia-pill-muted';
    default:            return 'ia-pill-muted';
  }
}

/**
 * Severity -> pill color class lookup.
 */
export function severityPillClass(severity) {
  switch (severity) {
    case 'info':     return 'ia-pill-info';
    case 'warning':  return 'ia-pill-warning';
    case 'error':    return 'ia-pill-danger';
    case 'critical': return 'ia-pill-danger';
    default:         return 'ia-pill-muted';
  }
}
