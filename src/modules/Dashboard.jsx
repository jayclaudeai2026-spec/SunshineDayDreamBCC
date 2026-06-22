import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, DollarSign, TrendingUp, TrendingDown,
  Receipt, RefreshCw, Workflow, Wallet, ListChecks, Bell,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, CartesianGrid,
  ReferenceLine,
} from 'recharts';

import StatCard from '../components/StatCard.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { supabase } from '../lib/supabase.js';
import {
  useSystemStatus, useUnresolvedAlerts, useSupabaseQuery,
} from '../lib/hooks.js';
import {
  fmtRelative, fmtDate, fmtCurrency, fmtPct, fmtMonth, cn,
  healthPillClass, severityPillClass, truncate,
} from '../lib/utils.js';

export default function Dashboard() {
  // -------------------------------------------------------------------------
  // BUSINESS KPIs (top of fold — what the owner cares about)
  // -------------------------------------------------------------------------
  const { data: kpiRow, loading: kpiLoading } = useSupabaseQuery(
    () => supabase.from('dashboard_business_kpis_view').select('*').maybeSingle(),
    [],
  );
  const kpi = kpiRow ?? null;

  // 12-month trailing chart — only include months with >=8 entities reporting
  // so partial-coverage months don't drag the line to zero.
  const { data: monthlyRows } = useSupabaseQuery(
    () => supabase
      .from('group_monthly_summary_view')
      .select('period, group_revenue, group_net_income, entities_reporting')
      .gte('entities_reporting', 8)
      .order('period', { ascending: false })
      .limit(12),
    [],
  );

  const chartData = useMemo(() => {
    if (!monthlyRows) return [];
    return [...monthlyRows]
      .reverse()
      .map((r) => ({
        period: fmtMonth(r.period),
        revenue: Number(r.group_revenue ?? 0),
        net_income: Number(r.group_net_income ?? 0),
      }));
  }, [monthlyRows]);

  // Revenue MoM delta
  const revenueMomPct = useMemo(() => {
    if (!kpi?.latest_revenue || !kpi?.prev_revenue) return null;
    const prev = Number(kpi.prev_revenue);
    if (prev === 0) return null;
    return ((Number(kpi.latest_revenue) - prev) / Math.abs(prev)) * 100;
  }, [kpi]);

  // -------------------------------------------------------------------------
  // Operational data (lower priority — system health, alerts, etc.)
  // -------------------------------------------------------------------------
  const { data: status, refetch: refetchStatus } = useSystemStatus();
  const { data: alerts } = useUnresolvedAlerts({ limit: 5 });

  const { data: recentRuns } = useSupabaseQuery(
    () => supabase
      .from('automation_runs')
      .select('id, recipe_key, status, started_at, duration_ms, error_message')
      .order('started_at', { ascending: false })
      .limit(10),
    [],
  );

  const { data: pipelineHealth } = useSupabaseQuery(
    () => supabase
      .from('ingest_pipeline_health_view')
      .select('*')
      .order('health_signal', { ascending: false }),
    [],
  );

  const { data: upcomingTax } = useSupabaseQuery(
    () => supabase
      .from('upcoming_tax_obligations_view')
      .select('calendar_id, entity_short_name, jurisdiction, filing_type, period_covered, due_date, days_until_due, status, amount_outstanding_est')
      .order('due_date', { ascending: true })
      .limit(5),
    [],
  );

  const { data: openCloses } = useSupabaseQuery(
    () => supabase
      .from('monthly_close_progress_view')
      .select('id, entity_short_name, period, status, completion_pct, items_completed, items_total')
      .in('status', ['open', 'in_progress', 'blocked'])
      .order('period', { ascending: false }),
    [],
  );

  // Pipeline health signal counts
  const pipelineCounts = useMemo(() => {
    const counts = { healthy: 0, attention: 0 };
    (pipelineHealth ?? []).forEach((r) => {
      if (r.health_signal === 'healthy') counts.healthy++;
      else counts.attention++;
    });
    return counts;
  }, [pipelineHealth]);

  // Alert severity breakdown
  const alertBreakdown = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    (alerts ?? []).forEach((a) => {
      if (counts[a.severity] != null) counts[a.severity]++;
    });
    return counts;
  }, [alerts]);

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1>Dashboard</h1>
          <p className="text-sm text-ia-muted mt-1">
            {kpi?.latest_full_period
              ? `Group performance through ${fmtMonth(kpi.latest_full_period)} · ${kpi.latest_entities_reporting ?? '—'} of 12 entities reporting`
              : 'Group performance and operational health'}
          </p>
        </div>
        <button
          className="ia-button-ghost"
          onClick={refetchStatus}
          aria-label="Refresh"
        >
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* BUSINESS KPI STRIP                                                */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={`Revenue · ${kpi?.latest_full_period ? fmtMonth(kpi.latest_full_period) : '—'}`}
          value={fmtCurrency(kpi?.latest_revenue, { abbreviate: true })}
          sublabel={
            revenueMomPct != null
              ? `${revenueMomPct >= 0 ? '↑' : '↓'} ${Math.abs(revenueMomPct).toFixed(1)}% vs ${kpi?.prev_full_period ? fmtMonth(kpi.prev_full_period) : 'prior'}`
              : `TTM ${fmtCurrency(kpi?.ttm_revenue, { abbreviate: true })}`
          }
          tone={revenueMomPct != null && revenueMomPct >= 0 ? 'positive' : 'neutral'}
          icon={revenueMomPct != null && revenueMomPct >= 0 ? TrendingUp : TrendingDown}
          loading={kpiLoading}
        />
        <StatCard
          label="Cash on hand"
          value={fmtCurrency(kpi?.total_cash, { abbreviate: true })}
          sublabel={`AR ${fmtCurrency(kpi?.total_ar, { abbreviate: true })} · AP ${fmtCurrency(kpi?.total_ap, { abbreviate: true })}`}
          icon={Wallet}
          loading={kpiLoading}
        />
        <StatCard
          label={`Net income · ${kpi?.latest_full_period ? fmtMonth(kpi.latest_full_period) : '—'}`}
          value={fmtCurrency(kpi?.latest_net_income, { abbreviate: true })}
          sublabel={
            kpi?.latest_net_margin_pct != null
              ? `${kpi.latest_net_margin_pct >= 0 ? '+' : ''}${Number(kpi.latest_net_margin_pct).toFixed(1)}% margin · TTM ${fmtCurrency(kpi?.ttm_net_income, { abbreviate: true })}`
              : '—'
          }
          tone={Number(kpi?.latest_net_income ?? 0) >= 0 ? 'positive' : 'danger'}
          icon={DollarSign}
          loading={kpiLoading}
        />
        <StatCard
          label="Working capital"
          value={fmtCurrency(kpi?.total_working_capital, { abbreviate: true })}
          sublabel={`Inventory ${fmtCurrency(kpi?.total_inventory, { abbreviate: true })}`}
          tone={Number(kpi?.total_working_capital ?? 0) >= 0 ? 'neutral' : 'danger'}
          icon={Activity}
          loading={kpiLoading}
        />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* TRAILING 12-MONTH PERFORMANCE CHART                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="ia-card">
        <SectionHeader
          title="Group monthly performance"
          description={
            kpi?.last_data_received_at
              ? `Trailing ${chartData.length} months · last data received ${fmtRelative(kpi.last_data_received_at)}`
              : `Trailing ${chartData.length} months`
          }
          actions={
            <Link to="/financials" className="ia-button-ghost text-xs">
              <DollarSign size={12} /><span>Financials</span>
            </Link>
          }
        />
        {chartData.length === 0 ? (
          <LoadingState />
        ) : (
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmtCurrency(v, { abbreviate: true })}
                  width={60}
                />
                <Tooltip
                  formatter={(value) => fmtCurrency(value)}
                  labelStyle={{ fontSize: 12, fontWeight: 600 }}
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                />
                <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="2 2" />
                <Line
                  type="monotone" dataKey="revenue" name="Revenue"
                  stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone" dataKey="net_income" name="Net income"
                  stroke="#1e3a5f" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* OPERATIONS STRIP (compact — system health + small counts)         */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="System health"
          value={
            <span className={cn('ia-pill', healthPillClass(status?.overall_health))}>
              {status?.overall_health ?? 'unknown'}
            </span>
          }
          sublabel={status?.last_health_check_at
            ? `checked ${fmtRelative(status.last_health_check_at)}`
            : '—'}
          icon={Activity}
        />
        <StatCard
          label="Unresolved alerts"
          value={alerts?.length ?? 0}
          sublabel={
            alerts?.length
              ? [
                  alertBreakdown.critical && `${alertBreakdown.critical} critical`,
                  alertBreakdown.warning && `${alertBreakdown.warning} warning`,
                  alertBreakdown.info && `${alertBreakdown.info} info`,
                ].filter(Boolean).join(' · ') || 'all clear'
              : 'all clear'
          }
          tone={alertBreakdown.critical > 0 ? 'danger' : alertBreakdown.warning > 0 ? 'warning' : 'neutral'}
          icon={Bell}
        />
        <StatCard
          label="Open closes"
          value={openCloses?.length ?? 0}
          sublabel={
            openCloses?.length
              ? `${openCloses.filter((c) => c.status === 'blocked').length} blocked · ${openCloses.filter((c) => c.status === 'in_progress').length} in progress`
              : 'none open'
          }
          tone={openCloses?.length ? 'warning' : 'neutral'}
          icon={ListChecks}
        />
        <StatCard
          label="Automation health"
          value={status?.automation_failed_24h ?? 0}
          sublabel={`failures in last 24h · last run ${status?.last_automation_run_at ? fmtRelative(status.last_automation_run_at) : '—'}`}
          tone={(status?.automation_failed_24h ?? 0) > 0 ? 'danger' : 'neutral'}
          icon={Workflow}
        />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* TWO-COLUMN BODY: alerts + open closes, pipeline + tax            */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Unresolved alerts */}
        <div className="ia-card">
          <SectionHeader
            title="Unresolved alerts"
            description={alerts?.length ? `${alerts.length} item${alerts.length === 1 ? '' : 's'}` : 'all clear'}
            actions={
              <Link to="/alerts" className="ia-button-ghost text-xs">View all</Link>
            }
          />
          {!alerts ? (
            <LoadingState />
          ) : alerts.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-emerald-700 gap-2 text-sm">
              <CheckCircle2 size={18} /><span>No unresolved alerts</span>
            </div>
          ) : (
            <ul className="divide-y divide-ia-border">
              {alerts.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex items-start gap-2">
                    <span className={severityPillClass(a.severity)}>{a.severity}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ia-navy">{truncate(a.message, 120)}</div>
                      <div className="text-xs text-ia-muted mt-0.5">
                        {a.category} · raised {fmtRelative(a.raised_at)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Open close cycles */}
        <div className="ia-card">
          <SectionHeader
            title="Open close cycles"
            description={openCloses?.length ? `${openCloses.length} in progress` : 'none open'}
          />
          {!openCloses ? (
            <LoadingState />
          ) : openCloses.length === 0 ? (
            <EmptyState
              title="No open close cycles"
              description="Close cycles open on the 1st of each month via the monthly_close_kickoff recipe."
            />
          ) : (
            <ul className="divide-y divide-ia-border max-h-72 overflow-y-auto">
              {openCloses.map((c) => (
                <li key={c.id} className="py-2 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-ia-navy truncate">
                      {c.entity_short_name} · {fmtDate(c.period, 'MMM yyyy')}
                    </div>
                    <div className="text-xs text-ia-muted">
                      {c.items_completed}/{c.items_total} items · {c.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-[6rem]">
                    <div className="flex-1 h-1.5 rounded-full bg-ia-cream-dark overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all',
                          c.completion_pct >= 80 ? 'bg-emerald-500'
                            : c.completion_pct >= 40 ? 'bg-amber-500'
                            : 'bg-ia-teal'
                        )}
                        style={{ width: `${Math.max(2, Number(c.completion_pct) || 0)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-ia-muted w-10 text-right">
                      {c.completion_pct ?? 0}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Ingest pipeline */}
        <div className="ia-card">
          <SectionHeader
            title="Ingest pipeline"
            description={`${pipelineCounts.healthy} healthy, ${pipelineCounts.attention} need attention`}
            actions={
              <Link to="/automations" className="ia-button-ghost text-xs">
                <Workflow size={12} /><span>Manage</span>
              </Link>
            }
          />
          {!pipelineHealth ? (
            <LoadingState />
          ) : pipelineHealth.length === 0 ? (
            <EmptyState title="No entities yet" description="Add an entity in Settings to begin ingesting financial data." />
          ) : (
            <ul className="divide-y divide-ia-border max-h-72 overflow-y-auto">
              {pipelineHealth.map((row) => (
                <li key={row.entity_id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm text-ia-navy">{row.entity_short_name}</div>
                    <div className="text-xs text-ia-muted">
                      {row.last_ingest_received_at
                        ? `last ingest ${fmtRelative(row.last_ingest_received_at)}`
                        : 'no ingest yet'}
                      {row.pending_count > 0 && ` · ${row.pending_count} pending`}
                      {row.failed_count > 0 && ` · ${row.failed_count} failed`}
                    </div>
                  </div>
                  <span className={healthPillClass(row.health_signal)}>{row.health_signal}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming tax obligations */}
        <div className="ia-card">
          <SectionHeader
            title="Upcoming tax obligations"
            description="Next 90 days"
            actions={
              <Link to="/tax" className="ia-button-ghost text-xs">
                <Receipt size={12} /><span>View all</span>
              </Link>
            }
          />
          {!upcomingTax ? (
            <LoadingState />
          ) : upcomingTax.length === 0 ? (
            <EmptyState
              title="Nothing due in the next 90 days"
              description="Tax calendar is up to date. Add new obligations from the Tax Center."
            />
          ) : (
            <ul className="divide-y divide-ia-border">
              {upcomingTax.map((t) => (
                <li key={t.calendar_id} className="py-2 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-ia-navy truncate">
                      {t.entity_short_name} · {t.filing_type}
                    </div>
                    <div className="text-xs text-ia-muted">
                      {t.jurisdiction} · {t.period_covered} · due {fmtDate(t.due_date)}
                    </div>
                  </div>
                  <div className="text-right">
                    {t.amount_outstanding_est != null && (
                      <div className="text-sm font-medium text-ia-navy">
                        {fmtCurrency(t.amount_outstanding_est, { abbreviate: true })}
                      </div>
                    )}
                    <div className={cn(
                      'text-xs',
                      t.days_until_due < 0 ? 'text-red-700' :
                      t.days_until_due < 14 ? 'text-amber-700' : 'text-ia-muted'
                    )}>
                      {t.days_until_due < 0 ? `${Math.abs(t.days_until_due)}d overdue`
                        : `${t.days_until_due}d`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent automation runs */}
      <div className="ia-card">
        <SectionHeader
          title="Recent automation runs"
          description="Last 10 across all recipes"
          actions={
            <Link to="/automations" className="ia-button-ghost text-xs">
              <Workflow size={12} /><span>Automations</span>
            </Link>
          }
        />
        {!recentRuns ? (
          <LoadingState />
        ) : recentRuns.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="When pg_cron fires the first scheduled recipe, runs will appear here."
          />
        ) : (
          <table className="ia-table">
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.recipe_key}</td>
                  <td>
                    <span className={
                      r.status === 'success' ? 'ia-pill-success' :
                      r.status === 'failed' ? 'ia-pill-danger' :
                      r.status === 'running' ? 'ia-pill-info' : 'ia-pill-muted'
                    }>{r.status}</span>
                  </td>
                  <td className="text-xs text-ia-muted">{fmtRelative(r.started_at)}</td>
                  <td className="text-xs text-ia-muted">
                    {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="text-xs text-ia-muted">{truncate(r.error_message, 80) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
