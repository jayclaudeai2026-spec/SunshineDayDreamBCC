import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { BarChart3, Building2, RefreshCw, TrendingUp } from 'lucide-react';

import StatCard from '../components/StatCard.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PrintButton from '../components/PrintButton.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
import { supabase } from '../lib/supabase.js';
import { useEntities, useSupabaseQuery } from '../lib/hooks.js';
import { fmtCurrency, fmtMonth, fmtPct, cn } from '../lib/utils.js';

const MONTHS_TO_SHOW = 12;

export default function Financials() {
  const { data: entities } = useEntities();
  const [selectedEntityId, setSelectedEntityId] = useState('group');

  const entityFilter = selectedEntityId === 'group' ? null : Number(selectedEntityId);

  // P&L last 12 months
  const { data: pl, loading: plLoading, refetch: refetchPl } = useSupabaseQuery(
    () => {
      let q = supabase
        .from('monthly_pl')
        .select('entity_id, period, revenue, other_income, cogs, gross_profit, total_opex, ebitda, net_income')
        .order('period', { ascending: false })
        .limit(entityFilter ? MONTHS_TO_SHOW : MONTHS_TO_SHOW * 12);
      if (entityFilter) q = q.eq('entity_id', entityFilter);
      return q;
    },
    [entityFilter],
  );

  // Latest BS per entity (for cash position)
  const { data: cashPos } = useSupabaseQuery(
    () => {
      let q = supabase.from('cash_position_view').select('*');
      if (entityFilter) q = q.eq('entity_id', entityFilter);
      return q;
    },
    [entityFilter],
  );

  // Group monthly summary (only when looking at group view)
  const { data: groupMonthly } = useSupabaseQuery(
    () => supabase
      .from('group_monthly_summary_view')
      .select('*')
      .order('period', { ascending: false })
      .limit(MONTHS_TO_SHOW),
    [],
  );

  // YoY view (group level, last 3 years)
  const { data: yoy } = useSupabaseQuery(
    () => {
      let q = supabase.from('entity_year_over_year_view').select('*').order('yr', { ascending: false }).limit(50);
      if (entityFilter) q = q.eq('entity_id', entityFilter);
      return q;
    },
    [entityFilter],
  );

  // Aggregate group P&L per month (when no entity selected)
  const monthsData = useMemo(() => {
    if (!pl) return [];
    if (entityFilter) {
      // Defensive filter — even if `pl` is briefly stale (group data left over
      // from a previous fetch), the table must never show rows from other
      // entities while the dropdown reads a specific entity. The .eq() in the
      // query usually handles this, but a render between dropdown change and
      // refetch completion can transiently have stale rows.
      return [...pl]
        .filter((row) => row.entity_id === entityFilter)
        .sort((a, b) => a.period.localeCompare(b.period))
        .slice(-MONTHS_TO_SHOW);
    }
    // Group: aggregate across entities by period
    const byPeriod = new Map();
    for (const row of pl) {
      const e = byPeriod.get(row.period) ?? {
        period: row.period, revenue: 0, other_income: 0, cogs: 0,
        gross_profit: 0, total_opex: 0, ebitda: 0, net_income: 0,
      };
      e.revenue       += Number(row.revenue ?? 0);
      e.other_income  += Number(row.other_income ?? 0);
      e.cogs          += Number(row.cogs ?? 0);
      e.gross_profit  += Number(row.gross_profit ?? 0);
      e.total_opex    += Number(row.total_opex ?? 0);
      e.ebitda        += Number(row.ebitda ?? 0);
      e.net_income    += Number(row.net_income ?? 0);
      byPeriod.set(row.period, e);
    }
    return Array.from(byPeriod.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .slice(-MONTHS_TO_SHOW);
  }, [pl, entityFilter]);

  // Most-recent-month KPIs
  const latest = monthsData[monthsData.length - 1];
  const prior  = monthsData[monthsData.length - 2];

  // Canonical "Revenue" = monthly_pl.revenue (operating revenue). Other-income
  // (interest, rebates, one-offs) is intentionally NOT folded in — that keeps
  // this module consistent with group_monthly_summary_view, the Dashboard, and
  // entity_year_over_year_view, all of which use bare revenue.
  const latestRevenue = Number(latest?.revenue ?? 0);
  const priorRevenue  = Number(prior?.revenue  ?? 0);
  const revenueTrend  = priorRevenue > 0
    ? ((latestRevenue - priorRevenue) / priorRevenue)
    : null;

  const aggCash = (cashPos ?? []).reduce((s, r) => s + Number(r.cash ?? 0), 0);
  const aggAr   = (cashPos ?? []).reduce((s, r) => s + Number(r.ar_balance ?? 0), 0);
  const aggAp   = (cashPos ?? []).reduce((s, r) => s + Number(r.ap_balance ?? 0), 0);

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Financials</h1>
          <p className="text-sm text-ia-muted mt-1">
            P&amp;L, balance sheet snapshot, cash position, and trend across the last 12 months.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end ia-no-print">
          <select
            value={selectedEntityId}
            onChange={(e) => setSelectedEntityId(e.target.value)}
            className="ia-input max-w-[14rem] py-1.5"
          >
            <option value="group">Group (all entities)</option>
            {(entities ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.entity_short_name}</option>
            ))}
          </select>
          <button className="ia-button-ghost" onClick={refetchPl}>
            <RefreshCw size={14} /><span>Refresh</span>
          </button>
          <PrintButton
            title={`BCC Financials — ${selectedEntityId === 'group' ? 'Group' : (entities ?? []).find((e) => String(e.id) === String(selectedEntityId))?.entity_short_name ?? 'entity'}`}
          />
          <AskClaudeButton
            moduleLabel="Financials"
            subject={selectedEntityId === 'group'
              ? 'Group financials, last 12 months'
              : `Entity ${(entities ?? []).find((e) => String(e.id) === String(selectedEntityId))?.entity_short_name ?? selectedEntityId} financials, last 12 months`}
            context={{
              scope: selectedEntityId === 'group' ? 'group' : 'entity',
              entity_id: entityFilter,
              entity_name: selectedEntityId === 'group' ? null : (entities ?? []).find((e) => String(e.id) === String(selectedEntityId))?.entity_short_name,
              latest_period: latest?.period,
              latest_revenue: latestRevenue,
              latest_ebitda: Number(latest?.ebitda ?? 0),
              latest_net_income: Number(latest?.net_income ?? 0),
              latest_gross_profit: Number(latest?.gross_profit ?? 0),
              cash_total: aggCash,
              ar_total: aggAr,
              ap_total: aggAp,
              monthly_pl_rows: (pl ?? []).slice(0, 12),
            }}
            suggestedPrompt={`Walk me through the trend here. What's going right, what's going wrong, and what would you do about it?`}
          />
        </div>
      </header>

      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          hero
          label="Revenue (latest month)"
          value={latest ? fmtCurrency(latestRevenue, { abbreviate: true }) : '—'}
          sublabel={latest ? fmtMonth(latest.period) : 'no data'}
          trendValue={revenueTrend != null ? fmtPct(revenueTrend) : null}
          trend={revenueTrend == null ? 'flat' : revenueTrend > 0 ? 'up' : 'down'}
          icon={TrendingUp}
        />
        <StatCard
          hero
          label="Cash on hand"
          value={cashPos?.length ? fmtCurrency(aggCash, { abbreviate: true }) : '—'}
          sublabel={cashPos?.length ? `as of ${fmtMonth(cashPos[0]?.as_of_date)}` : 'no BS data'}
          icon={Building2}
        />
        <StatCard
          hero
          label="Accounts receivable"
          value={cashPos?.length ? fmtCurrency(aggAr, { abbreviate: true }) : '—'}
          sublabel="outstanding"
          icon={BarChart3}
        />
        <StatCard
          hero
          label="Accounts payable"
          value={cashPos?.length ? fmtCurrency(aggAp, { abbreviate: true }) : '—'}
          sublabel="outstanding"
          icon={BarChart3}
        />
      </div>

      {/* Trend chart */}
      <div className="ia-card">
        <SectionHeader
          title="Revenue & Net Income — 12-month trend"
          description={entityFilter
            ? entities?.find(e => e.id === entityFilter)?.entity_short_name
            : 'Group consolidated'}
        />
        {plLoading ? (
          <LoadingState />
        ) : monthsData.length === 0 ? (
          <EmptyState
            title="No P&L data yet"
            description="Once monthly close packages are ingested and parsed, the trend will appear here."
          />
        ) : (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthsData} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={(v) => fmtMonth(v)}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={(v) => fmtCurrency(v, { abbreviate: true })}
                  width={64}
                />
                <Tooltip
                  formatter={(v) => fmtCurrency(v)}
                  labelFormatter={(l) => fmtMonth(l)}
                  contentStyle={{ fontSize: 12, border: '1px solid #E5E1DA', borderRadius: 6 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="revenue"     stroke="#0E7C7B" strokeWidth={2} dot={false} name="Revenue" />
                <Line type="monotone" dataKey="net_income"  stroke="#1A2744" strokeWidth={2} dot={false} name="Net income" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Monthly P&L table */}
      <div className="ia-card">
        <SectionHeader
          title="Monthly P&L"
          description="Last 12 months"
        />
        {monthsData.length === 0 ? (
          <EmptyState title="No P&L data" description="Ingest a monthly close package to populate this view." />
        ) : (
          <div className="overflow-x-auto">
            <table className="ia-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">COGS</th>
                  <th className="text-right">Gross Profit</th>
                  <th className="text-right">Opex</th>
                  <th className="text-right">EBITDA</th>
                  <th className="text-right">Net Income</th>
                </tr>
              </thead>
              <tbody>
                {[...monthsData].reverse().map((m) => {
                  // Canonical Revenue (no other_income) — see comment above.
                  const rev = Number(m.revenue ?? 0);
                  return (
                    <tr key={m.period}>
                      <td className="font-medium">{fmtMonth(m.period)}</td>
                      <td className="text-right">{fmtCurrency(rev)}</td>
                      <td className="text-right">{fmtCurrency(m.cogs)}</td>
                      <td className="text-right">{fmtCurrency(m.gross_profit)}</td>
                      <td className="text-right">{fmtCurrency(m.total_opex)}</td>
                      <td className="text-right">{fmtCurrency(m.ebitda)}</td>
                      <td className={cn('text-right font-medium',
                        Number(m.net_income) < 0 ? 'text-red-700' : 'text-ia-navy')}>
                        {fmtCurrency(m.net_income)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* YoY summary */}
      {yoy?.length > 0 && (
        <div className="ia-card">
          <SectionHeader
            title="Year-over-year"
            description="Annual rollup with YoY change. Partial years compare against the same month-range of the prior year (YTD-vs-YTD)."
          />
          <div className="overflow-x-auto">
            <table className="ia-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Year</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">YoY %</th>
                  <th className="text-right">EBITDA</th>
                  <th className="text-right">Net Income</th>
                </tr>
              </thead>
              <tbody>
                {yoy.map((y) => (
                  <tr key={`${y.entity_id}-${y.yr}`}>
                    <td className="font-medium">{y.entity_short_name}</td>
                    <td>
                      {y.is_partial_year
                        ? <span title={`Through month ${y.last_month_in_year}; YoY % compares to same ${y.last_month_in_year} months of ${y.yr - 1}.`}>
                            {y.yr} <span className="text-xs text-ia-muted">YTD ({y.last_month_in_year}mo)</span>
                          </span>
                        : y.yr}
                    </td>
                    <td className="text-right">{fmtCurrency(y.revenue, { abbreviate: true })}</td>
                    <td className={cn('text-right font-medium',
                      y.revenue_yoy_pct == null ? 'text-ia-muted'
                        : Number(y.revenue_yoy_pct) >= 0 ? 'text-emerald-700' : 'text-red-700'
                    )}>
                      {y.revenue_yoy_pct != null ? `${y.revenue_yoy_pct}%` : '—'}
                    </td>
                    <td className="text-right">{fmtCurrency(y.ebitda, { abbreviate: true })}</td>
                    <td className="text-right">{fmtCurrency(y.net_income, { abbreviate: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cash position per entity (when group view) */}
      {!entityFilter && cashPos?.length > 0 && (
        <div className="ia-card">
          <SectionHeader title="Cash position by entity" description="Latest balance sheet per entity" />
          <table className="ia-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th className="text-right">Cash</th>
                <th className="text-right">AR</th>
                <th className="text-right">AP</th>
                <th className="text-right">Quick position</th>
                <th className="text-right">Current ratio</th>
              </tr>
            </thead>
            <tbody>
              {cashPos.map((c) => (
                <tr key={c.entity_id}>
                  <td className="font-medium">{c.entity_short_name}</td>
                  <td className="text-right">{fmtCurrency(c.cash, { abbreviate: true })}</td>
                  <td className="text-right">{fmtCurrency(c.ar_balance, { abbreviate: true })}</td>
                  <td className="text-right">{fmtCurrency(c.ap_balance, { abbreviate: true })}</td>
                  <td className="text-right font-medium">{fmtCurrency(c.quick_position, { abbreviate: true })}</td>
                  <td className="text-right">{c.current_ratio ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Group monthly summary (when group view) */}
      {!entityFilter && groupMonthly?.length > 0 && (
        <div className="ia-card">
          <SectionHeader title="Group monthly margins" description="Consolidated margins, last 12 months" />
          <div className="overflow-x-auto">
            <table className="ia-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Entities</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Gross %</th>
                  <th className="text-right">EBITDA %</th>
                  <th className="text-right">Net %</th>
                </tr>
              </thead>
              <tbody>
                {groupMonthly.map((g) => (
                  <tr key={g.period}>
                    <td className="font-medium">{fmtMonth(g.period)}</td>
                    <td>{g.entities_reporting}</td>
                    <td className="text-right">{fmtCurrency(g.group_revenue, { abbreviate: true })}</td>
                    <td className="text-right">{g.gross_margin_pct != null ? `${g.gross_margin_pct}%` : '—'}</td>
                    <td className="text-right">{g.ebitda_margin_pct != null ? `${g.ebitda_margin_pct}%` : '—'}</td>
                    <td className="text-right">{g.net_margin_pct != null ? `${g.net_margin_pct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
