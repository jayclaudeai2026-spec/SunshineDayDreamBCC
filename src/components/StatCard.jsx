import { cn } from '../lib/utils.js';

// Single-stat card. Renders a label, big value, and optional sublabel + trend.
// Drop into any module's stat-strip layout.
export default function StatCard({
  label,
  value,
  sublabel,
  trend,            // 'up' | 'down' | 'flat' | null
  trendValue,       // string like "+12.4%" — already formatted
  icon: Icon,
  tone = 'neutral', // 'neutral' | 'positive' | 'warning' | 'danger'
  hero = false,     // when true, value renders in sunset-orange .ia-currency-hero
  loading = false,
}) {
  const toneClass = {
    neutral:  'border-ia-border',
    positive: 'border-emerald-200 bg-emerald-50/30',
    warning:  'border-amber-200 bg-amber-50/30',
    danger:   'border-red-200 bg-red-50/30',
  }[tone] ?? 'border-ia-border';

  return (
    <div className={cn('rounded-lg border bg-ia-card shadow-ia-card p-4', toneClass)}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-ia-muted uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={16} className="text-ia-muted" />}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold', hero ? 'ia-currency-hero' : 'text-ia-navy')}>
        {loading ? <span className="text-ia-muted text-base">…</span> : (value ?? '—')}
      </div>
      {(sublabel || trendValue) && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          {trendValue && (
            <span className={cn(
              'font-medium',
              trend === 'up' && 'text-emerald-700',
              trend === 'down' && 'text-red-700',
              (trend === 'flat' || !trend) && 'text-ia-muted',
            )}>{trendValue}</span>
          )}
          {sublabel && <span className="text-ia-muted">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}
