import { useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, Receipt,
  Calendar, Award, AlertTriangle, RefreshCw, Activity,
  Target, CheckCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';

import StatCard from '../components/StatCard.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import PrintButton from '../components/PrintButton.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { supabase } from '../lib/supabase.js';
import { useSupabaseQuery } from '../lib/hooks.js';
import { fmtCurrency, fmtDate, cn } from '../lib/utils.js';

// Range options
const RANGES = [
  { key: '7',   days: 7,    label: 'Last 7 days' },
  { key: '30',  days: 30,   label: 'Last 30 days' },
  { key: '90',  days: 90,   label: 'Last 90 days' },
  { key: 'all', days: null, label: 'All available' },
];

// Color palette for location lines (cycles if more locations)
// Uses theme CSS vars so light/dark mode swap is automatic.
const LINE_COLORS = [
  'var(--ia-orange)',
  'var(--ia-teal)',
  'var(--ia-warning)',
  'var(--ia-navy)',
  'var(--ia-success, #10b981)',
  'var(--ia-danger,  #ef4444)',
  'var(--ia-ink)',
];

export default function DailySalesPulse() {
  const [rangeKey, setRangeKey] = useState('30');
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

  // Pull all daily_location_sales rows ordered desc; filter client-side.
  // Volume is tiny — 90d full coverage is ~600 rows.
  const { data: rowsRaw, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('daily_location_sales_view')
      .select('*')
      .order('sales_date', { ascending: false })
      .limit(5000),
    [],
  );
  const rows = rowsRaw ?? [];

  // MTD vs LY-MTD per-entity for bonus tracking (Migration 056 — true Heartland-vs-Heartland).
  const { data: mtdLyRaw, loading: mtdLyLoading } = useSupabaseQuery(
    () => supabase
      .from('dashboard_mtd_vs_ly_view')
      .select('*')
      .order('mtd_actual', { ascending: false }),
    [],
  );
  const mtdLyRows = mtdLyRaw ?? [];

  // Latest date (already desc sorted)
  const maxDate = rows[0]?.sales_date ?? null;

  // Window cutoff
  const cutoff = useMemo(() => {
    if (!range.days || !maxDate) return null;
    const d = new Date(`${maxDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - range.days + 1);
    return d.toISOString().slice(0, 10);
  }, [range.days, maxDate]);

  const inWindow = useMemo(() => {
    if (!cutoff) return rows;
    return rows.filter((r) => r.sales_date >= cutoff);
  }, [rows, cutoff]);

  // Yesterday KPIs
  const latest = useMemo(() => {
    if (!maxDate) return null;
    const dayRows = rows.filter((r) => r.sales_date === maxDate);
    const sum = dayRows.reduce(
      (acc, r) => ({
        gross: acc.gross + Number(r.gross_sales || 0),
        net:   acc.net   + Number(r.net_sales   || 0),
        txn:   acc.txn   + Number(r.transaction_count || 0),
        units: acc.units + Number(r.units_sold  || 0),
      }),
      { gross: 0, net: 0, txn: 0, units: 0 },
    );
    return {
      ...sum,
      avgTicket: sum.txn > 0 ? sum.net / sum.txn : 0,
      date: maxDate,
      locationCount: dayRows.length,
    };
  }, [rows, maxDate]);

  // Per-location aggregates over selected window
  const perLocation = useMemo(() => {
    const m = new Map();
    for (const r of inWindow) {
      const key = r.heartland_id;
      const cur = m.get(key) ?? {
        heartland_id: r.heartland_id,
        location_name: r.location_name,
        entity_short_name: r.entity_short_name,
        is_channel: r.is_channel,
        gross: 0, net: 0, txn: 0, units: 0, days: 0,
      };
      cur.gross += Number(r.gross_sales || 0);
      cur.net   += Number(r.net_sales   || 0);
      cur.txn   += Number(r.transaction_count || 0);
      cur.units += Number(r.units_sold  || 0);
      cur.days  += 1;
      m.set(key, cur);
    }
    return Array.from(m.values())
      .map((v) => ({
        ...v,
        avgTicket:    v.txn  > 0 ? v.net / v.txn  : 0,
        avgDailyNet:  v.days > 0 ? v.net / v.days : 0,
      }))
      .sort((a, b) => b.net - a.net);
  }, [inWindow]);

  // Aggregate over window
  const aggregate = useMemo(() => {
    const a = perLocation.reduce(
      (acc, l) => ({
        gross: acc.gross + l.gross,
        net:   acc.net   + l.net,
        txn:   acc.txn   + l.txn,
        days:  Math.max(acc.days, l.days),
      }),
      { gross: 0, net: 0, txn: 0, days: 0 },
    );
    return {
      ...a,
      avgDailyNet: a.days > 0 ? a.net / a.days : 0,
      avgTicket:   a.txn  > 0 ? a.net / a.txn  : 0,
    };
  }, [perLocation]);

  // Per-day aggregates (for best/worst day + chart)
  const dayAgg = useMemo(() => {
    const m = new Map();
    for (const r of inWindow) {
      const cur = m.get(r.sales_date) ?? { date: r.sales_date, net: 0, txn: 0 };
      cur.net += Number(r.net_sales || 0);
      cur.txn += Number(r.transaction_count || 0);
      m.set(r.sales_date, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [inWindow]);

  const bestDay = useMemo(() => {
    if (dayAgg.length === 0) return null;
    return [...dayAgg].sort((a, b) => b.net - a.net)[0];
  }, [dayAgg]);
  const worstDay = useMemo(() => {
    if (dayAgg.length === 0) return null;
    return [...dayAgg].sort((a, b) => a.net - b.net)[0];
  }, [dayAgg]);

  // Chart data: pivot to row-per-date, column-per-location
  const chartData = useMemo(() => {
    const dates = Array.from(new Set(inWindow.map((r) => r.sales_date))).sort();
    const locKeys = perLocation.map((l) => l.heartland_id);
    const byKey = new Map();
    for (const r of inWindow) {
      byKey.set(`${r.sales_date}|${r.heartland_id}`, Number(r.net_sales || 0));
    }
    return dates.map((d) => {
      const row = { date: d };
      for (const lk of locKeys) {
        row[`loc_${lk}`] = byKey.get(`${d}|${lk}`) ?? 0;
      }
      return row;
    });
  }, [inWindow, perLocation]);

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load daily sales"
        message={String(error?.message || error)}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No sales rows yet"
        message="The first heartland-sales-pull cron run is scheduled for 08:00 UTC (3am Central). Once it runs, charts and per-location cards will appear here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Daily Sales Pulse"
        description={`Heartland Retail POS — yesterday ${fmtDate(latest?.date)} across ${latest?.locationCount ?? 0} locations`}
        actions={
          <>
            {RANGES.map((r) => (
              <FilterPill
                key={r.key}
                label={r.label}
                active={r.key === rangeKey}
                onClick={() => setRangeKey(r.key)}
              />
            ))}
            <PrintButton title="BCC Daily Sales Pulse" />
            <AskClaudeButton
              moduleLabel="Daily Sales Pulse"
              subject={`Yesterday ${latest?.date ?? ''} · ${rangeKey} window · ${rows.length} sales rows`}
              context={{
                range: rangeKey,
                latest_date: latest?.date,
                latest_location_count: latest?.locationCount,
                latest_gross: latest?.gross,
                latest_net: latest?.net,
                latest_txns: latest?.txns,
                total_rows_in_window: rows.length,
              }}
              suggestedPrompt="What's the read on sales right now? Anything trending up or down that I should pay attention to across the locations?"
            />
            <button
              type="button"
              onClick={refetch}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-ia-cream-dark text-ia-navy hover:bg-ia-teal-light transition-colors"
              title="Refetch from Supabase"
            >
              <RefreshCw size={12} />
              <span>Refresh</span>
            </button>
          </>
        }
      />

      {/* Yesterday KPIs — hero orange on money columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={DollarSign}
          label="Yesterday gross"
          value={fmtCurrency(latest?.gross ?? 0)}
          sublabel={fmtDate(latest?.date)}
          hero
        />
        <StatCard
          icon={DollarSign}
          label="Yesterday net"
          value={fmtCurrency(latest?.net ?? 0)}
          sublabel={`${(latest?.units ?? 0).toLocaleString()} units sold`}
          hero
        />
        <StatCard
          icon={ShoppingCart}
          label="Yesterday transactions"
          value={(latest?.txn ?? 0).toLocaleString()}
        />
        <StatCard
          icon={Receipt}
          label="Yesterday avg ticket"
          value={fmtCurrency(latest?.avgTicket ?? 0)}
        />
      </div>

      {/* MTD-vs-LY-MTD bonus tracker (Migration 056 — true Heartland-vs-Heartland) */}
      <MtdVsLySection rows={mtdLyRows} loading={mtdLyLoading} />

      {/* Window-level summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={TrendingUp}
          label={`Net — ${range.label.toLowerCase()}`}
          value={fmtCurrency(aggregate.net)}
          sublabel={`Across ${aggregate.txn.toLocaleString()} transactions`}
          hero
        />
        <StatCard
          icon={Activity}
          label="Avg net per day"
          value={fmtCurrency(aggregate.avgDailyNet)}
          sublabel={`${aggregate.days} day${aggregate.days === 1 ? '' : 's'} of data`}
        />
        <StatCard
          icon={Award}
          label="Best day"
          value={fmtCurrency(bestDay?.net ?? 0)}
          sublabel={bestDay ? fmtDate(bestDay.date) : '—'}
          tone="positive"
        />
        <StatCard
          icon={TrendingDown}
          label="Slowest day"
          value={fmtCurrency(worstDay?.net ?? 0)}
          sublabel={worstDay ? fmtDate(worstDay.date) : '—'}
        />
      </div>

      {/* Daily-net by location chart */}
      <div className="bg-ia-card border border-ia-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-ia-navy">Daily net sales by location</h3>
          <span className="text-xs text-ia-muted">{chartData.length} days</span>
        </div>
        <div className="h-80">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-ia-muted">
              No data in this window
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ia-border)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--ia-muted)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d) => (d || '').slice(5)}
                  minTickGap={20}
                />
                <YAxis
                  stroke="var(--ia-muted)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--ia-card)',
                    border: '1px solid var(--ia-border)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--ia-ink)',
                  }}
                  labelFormatter={(d) => fmtDate(d)}
                  formatter={(v, name) => [fmtCurrency(v), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {perLocation.map((loc, i) => (
                  <Line
                    key={loc.heartland_id}
                    type="monotone"
                    dataKey={`loc_${loc.heartland_id}`}
                    name={loc.location_name}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Per-location cards */}
      <div>
        <SectionHeader
          title="By location"
          description={`Window: ${range.label.toLowerCase()}`}
        />
        {perLocation.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No data in this window"
            message="Try widening the range filter."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {perLocation.map((loc, i) => (
              <LocationCard
                key={loc.heartland_id}
                loc={loc}
                color={LINE_COLORS[i % LINE_COLORS.length]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent days matrix */}
      <RecentDaysMatrix inWindow={inWindow} perLocation={perLocation} />
    </div>
  );
}

function LocationCard({ loc, color }) {
  return (
    <div className="rounded-lg border border-ia-border bg-ia-card shadow-ia-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: color }}
              aria-hidden="true"
            />
            <h4 className="text-sm font-semibold text-ia-navy truncate">
              {loc.location_name}
            </h4>
          </div>
          {loc.entity_short_name && (
            <div className="text-xs text-ia-muted mt-0.5 truncate">{loc.entity_short_name}</div>
          )}
          {loc.is_channel && (
            <div className="text-xs font-medium mt-0.5" style={{ color: 'var(--ia-warning)' }}>
              Online channel
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="ia-currency-hero text-lg leading-tight">{fmtCurrency(loc.net)}</div>
          <div className="text-[10px] text-ia-muted uppercase tracking-wide">
            net · {loc.days} day{loc.days === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 mt-4 text-xs">
        <div>
          <dt className="text-ia-muted">Gross</dt>
          <dd className="font-medium text-ia-navy">{fmtCurrency(loc.gross)}</dd>
        </div>
        <div>
          <dt className="text-ia-muted">Avg / day</dt>
          <dd className="font-medium text-ia-navy">{fmtCurrency(loc.avgDailyNet)}</dd>
        </div>
        <div>
          <dt className="text-ia-muted">Avg ticket</dt>
          <dd className="font-medium text-ia-navy">{fmtCurrency(loc.avgTicket)}</dd>
        </div>
        <div>
          <dt className="text-ia-muted">Txns</dt>
          <dd className="font-medium text-ia-navy">{loc.txn.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-ia-muted">Units</dt>
          <dd className="font-medium text-ia-navy">{loc.units.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-ia-muted">Active days</dt>
          <dd className="font-medium text-ia-navy">{loc.days}</dd>
        </div>
      </dl>
    </div>
  );
}

function RecentDaysMatrix({ inWindow, perLocation }) {
  const allDates = useMemo(() => {
    const ds = Array.from(new Set(inWindow.map((r) => r.sales_date))).sort().reverse();
    return ds.slice(0, 14);
  }, [inWindow]);

  const cellMap = useMemo(() => {
    const m = new Map();
    const dateSet = new Set(allDates);
    for (const r of inWindow) {
      if (!dateSet.has(r.sales_date)) continue;
      m.set(`${r.sales_date}|${r.heartland_id}`, Number(r.net_sales || 0));
    }
    return m;
  }, [inWindow, allDates]);

  if (allDates.length === 0 || perLocation.length === 0) return null;

  return (
    <div className="rounded-lg border border-ia-border bg-ia-card p-4 overflow-x-auto">
      <h3 className="text-sm font-medium text-ia-navy mb-3">
        Recent days · net sales by location
      </h3>
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-ia-border">
            <th className="text-left py-2 px-2 font-medium text-ia-muted whitespace-nowrap">Date</th>
            {perLocation.map((loc) => (
              <th
                key={loc.heartland_id}
                className="text-right py-2 px-2 font-medium text-ia-navy whitespace-nowrap"
              >
                {loc.location_name}
              </th>
            ))}
            <th className="text-right py-2 px-2 font-medium text-ia-navy whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          {allDates.map((d) => {
            let dayTotal = 0;
            const cells = perLocation.map((loc) => {
              const v = cellMap.get(`${d}|${loc.heartland_id}`);
              if (v != null) dayTotal += v;
              return { id: loc.heartland_id, value: v };
            });
            return (
              <tr key={d} className="border-b border-ia-border last:border-b-0">
                <td className="py-1.5 px-2 text-ia-navy whitespace-nowrap">{fmtDate(d)}</td>
                {cells.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      'py-1.5 px-2 text-right tabular-nums',
                      c.value == null ? 'text-ia-muted' : 'text-ia-navy',
                    )}
                  >
                    {c.value == null ? '—' : fmtCurrency(c.value)}
                  </td>
                ))}
                <td className="py-1.5 px-2 text-right tabular-nums font-medium text-ia-navy">
                  {fmtCurrency(dayTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// MTD-vs-LY-MTD bonus tracker
// Per-entity MTD progress against same-window LY pace (Heartland-vs-Heartland).
// Bonus threshold = LY MTD pace × 1.05.
// ─────────────────────────────────────────────────────────────────────────────
function MtdVsLySection({ rows, loading }) {
  if (loading) {
    return (
      <div className="bg-ia-card border border-ia-border rounded-lg p-4">
        <div className="text-sm text-ia-muted">Loading MTD-vs-LY…</div>
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return null;
  }

  // Group rollup
  const totals = rows.reduce(
    (acc, r) => ({
      mtd_actual:   acc.mtd_actual   + Number(r.mtd_actual   || 0),
      ly_mtd_pace:  acc.ly_mtd_pace  + Number(r.ly_mtd_pace  || 0),
    }),
    { mtd_actual: 0, ly_mtd_pace: 0 },
  );
  const bonusTarget = totals.ly_mtd_pace * 1.05;
  const groupPctVsLy = totals.ly_mtd_pace > 0
    ? ((totals.mtd_actual - totals.ly_mtd_pace) / totals.ly_mtd_pace) * 100
    : 0;
  const groupOnPace = totals.mtd_actual >= bonusTarget;

  // Latest sales date for header (all rows share the same value)
  const latestDate = rows[0]?.latest_sales_date;
  const daysElapsed = rows[0]?.days_elapsed;

  return (
    <div className="bg-ia-card border border-ia-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-ia-orange" />
          <h3 className="text-sm font-medium text-ia-navy">MTD vs LY MTD · bonus pace</h3>
        </div>
        <span className="text-xs text-ia-muted">
          {latestDate ? `Through ${fmtDate(latestDate)} (${daysElapsed} days elapsed)` : ''}
        </span>
      </div>

      {/* Group rollup ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-ia-cream rounded-md border border-ia-border">
        <div>
          <div className="text-xs text-ia-muted">MTD Actual</div>
          <div className="ia-currency-hero text-lg">{fmtCurrency(totals.mtd_actual)}</div>
        </div>
        <div>
          <div className="text-xs text-ia-muted">LY MTD Pace</div>
          <div className="text-lg font-medium text-ia-navy tabular-nums">{fmtCurrency(totals.ly_mtd_pace)}</div>
        </div>
        <div>
          <div className="text-xs text-ia-muted">Group vs LY</div>
          <div className={cn(
            'text-lg font-medium tabular-nums',
            groupPctVsLy >= 5 ? 'text-ia-success' : groupPctVsLy >= 0 ? 'text-ia-navy' : 'text-ia-danger',
          )}>
            {groupPctVsLy >= 0 ? '+' : ''}{groupPctVsLy.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-ia-muted">Bonus Target (LY × 1.05)</div>
          <div className="flex items-center gap-2">
            <div className="text-lg font-medium text-ia-navy tabular-nums">{fmtCurrency(bonusTarget)}</div>
            {groupOnPace && <CheckCircle2 size={18} className="text-ia-success" />}
          </div>
        </div>
      </div>

      {/* Per-store table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-ia-border">
              <th className="text-left py-2 px-2 font-medium text-ia-navy">Store</th>
              <th className="text-left py-2 px-2 font-medium text-ia-navy">Location</th>
              <th className="text-right py-2 px-2 font-medium text-ia-navy">MTD</th>
              <th className="text-right py-2 px-2 font-medium text-ia-navy">LY MTD Pace</th>
              <th className="text-right py-2 px-2 font-medium text-ia-navy">Bonus Target</th>
              <th className="text-right py-2 px-2 font-medium text-ia-navy">vs LY</th>
              <th className="text-center py-2 px-2 font-medium text-ia-navy">Bonus</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const target = Number(r.ly_mtd_pace || 0) * 1.05;
              const pct = Number(r.pct_vs_ly_mtd ?? 0);
              return (
                <tr key={r.entity_id} className="border-b border-ia-border last:border-b-0">
                  <td className="py-1.5 px-2 text-ia-navy whitespace-nowrap font-medium">{r.entity_short_name}</td>
                  <td className="py-1.5 px-2 text-ia-muted whitespace-nowrap">{r.location_names ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-ia-navy">{fmtCurrency(Number(r.mtd_actual || 0))}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-ia-muted">{fmtCurrency(Number(r.ly_mtd_pace || 0))}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-ia-muted">{fmtCurrency(target)}</td>
                  <td className={cn(
                    'py-1.5 px-2 text-right tabular-nums font-medium',
                    pct >= 5 ? 'text-ia-success' : pct >= 0 ? 'text-ia-navy' : 'text-ia-danger',
                  )}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {r.on_pace_for_bonus && <CheckCircle2 size={16} className="text-ia-success inline" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
