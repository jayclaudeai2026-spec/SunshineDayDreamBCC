import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, DollarSign, TrendingUp, TrendingDown,
  Receipt, RefreshCw, Workflow, Wallet, ListChecks, Bell, Sunrise, Package, MessageSquare, BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, CartesianGrid,
  ReferenceLine,
} from 'recharts';

import StatCard from '../components/StatCard.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import PrintButton from '../components/PrintButton.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
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

  // Morning briefing context — single RPC call into get_daily_briefing_context().
  // Same payload that drives the daily_briefing_email recipe, surfaced inline.
  const { data: briefing, loading: briefingLoading, refetch: refetchBriefing } = useSupabaseQuery(
    async () => {
      const { data, error } = await supabase.rpc('get_daily_briefing_context');
      return { data: data ?? null, error };
    },
    [],
  );

  // Sales pulse — single-row aggregate from dashboard_sales_pulse_view.
  const { data: pulse, loading: pulseLoading, refetch: refetchPulse } = useSupabaseQuery(
    () => supabase.from('dashboard_sales_pulse_view').select('*').maybeSingle(),
    [],
  );

  // MTD vs LY-MTD per-entity for bonus tracking (Migration 056 — true Heartland-vs-Heartland).
  const { data: mtdLyRows } = useSupabaseQuery(
    () => supabase.from('dashboard_mtd_vs_ly_view').select('*').order('mtd_actual', { ascending: false }),
    [],
  );

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
        <div className="flex items-center gap-2 flex-wrap justify-end ia-no-print">
          <button
            className="ia-button-ghost"
            onClick={refetchStatus}
            aria-label="Refresh"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <PrintButton title="BCC Dashboard — executive snapshot" />
          <AskClaudeButton
            moduleLabel="Dashboard"
            subject={kpi?.latest_full_period ? `Group performance through ${kpi.latest_full_period}` : 'Group performance snapshot'}
            context={{
              latest_full_period: kpi?.latest_full_period,
              latest_revenue: kpi?.latest_revenue,
              prev_revenue: kpi?.prev_revenue,
              latest_net_income: kpi?.latest_net_income,
              latest_net_margin_pct: kpi?.latest_net_margin_pct,
              ttm_revenue: kpi?.ttm_revenue,
              ttm_net_income: kpi?.ttm_net_income,
              latest_entities_reporting: kpi?.latest_entities_reporting,
              last_data_received_at: kpi?.last_data_received_at,
            }}
            suggestedPrompt="Walk me through where the group stands. What's trending well, what's worrying, what should I do this week?"
          />
        </div>
      </header>

      {/* ----------------------------------------------------------------- */}
      {/* MORNING BRIEFING CARD — what to look at right now                   */}
      {/* ----------------------------------------------------------------- */}
      <MorningBriefingCard
        briefing={briefing}
        loading={briefingLoading}
        onRefresh={refetchBriefing}
      />

      {/* ----------------------------------------------------------------- */}
      {/* SALES PULSE CARD — trailing 14d + same-day-last-week comparison    */}
      {/* ----------------------------------------------------------------- */}
      <SalesPulseCard
        pulse={pulse}
        loading={pulseLoading}
        onRefresh={refetchPulse}
        mtdLyRows={mtdLyRows}
      />

      {/* ---------------------------------------------------------------- */}
      {/* BUSINESS KPI STRIP                                                */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          hero
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
          hero
          label="Cash on hand"
          value={fmtCurrency(kpi?.total_cash, { abbreviate: true })}
          sublabel={`AR ${fmtCurrency(kpi?.total_ar, { abbreviate: true })} · AP ${fmtCurrency(kpi?.total_ap, { abbreviate: true })}`}
          icon={Wallet}
          loading={kpiLoading}
        />
        <StatCard
          hero
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
          hero
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

// ---------------------------------------------------------------------------
// Morning briefing card — at-a-glance "what to look at right now" panel.
// Driven by public.get_daily_briefing_context() RPC. Same payload feeds the
// daily briefing email; here it's surfaced inline on the dashboard.
// ---------------------------------------------------------------------------

function MorningBriefingCard({ briefing, loading, onRefresh }) {
  if (loading && !briefing) {
    return (
      <div className="ia-card">
        <SectionHeader title="Morning briefing" description="Loading..." />
        <LoadingState />
      </div>
    );
  }

  if (!briefing) return null;

  const {
    date,
    day_of_week,
    system_health,
    ingest_24h = {},
    parser_24h = {},
    automation_24h = {},
    ar_aging = {},
    open_alerts = {},
    heartland = {},
    taxes_due_30d = [],
    active_entities,
  } = briefing;

  const parserHasFailures = Number(parser_24h.failed ?? 0) > 0;
  const automationHasFailures = Number(automation_24h.failed ?? 0) > 0;
  const arHasOverdue = Number(ar_aging.overdue_60plus_total ?? 0) > 0;
  const hasOpenAlerts = Number(open_alerts.total ?? 0) > 0;
  const criticalAlerts = Number(open_alerts.critical ?? 0) + Number(open_alerts.error ?? 0);

  const today = new Date();
  const heartlandSalesDate = heartland.latest_sales_date ? new Date(heartland.latest_sales_date + 'T00:00:00') : null;
  const heartlandDaysStale = heartlandSalesDate
    ? Math.floor((today - heartlandSalesDate) / (1000 * 60 * 60 * 24))
    : null;

  // Distill top tax obligations to 3 (already date-ordered by RPC)
  const topTaxes = (taxes_due_30d ?? []).slice(0, 3);

  // What needs attention — short narrative summary
  const attentionItems = [];
  if (criticalAlerts > 0) attentionItems.push(`${criticalAlerts} critical/error alert${criticalAlerts === 1 ? '' : 's'} open`);
  if (parserHasFailures) attentionItems.push(`${parser_24h.failed} parser failure${parser_24h.failed === 1 ? '' : 's'} in 24h`);
  if (automationHasFailures) attentionItems.push(`${automation_24h.failed} automation failure${automation_24h.failed === 1 ? '' : 's'} in 24h`);
  if (Number(ingest_24h.queue_pending ?? 0) > 5) attentionItems.push(`${ingest_24h.queue_pending} ingests pending parse`);
  if (arHasOverdue) attentionItems.push(`${fmtCurrency(ar_aging.overdue_60plus_total, { abbreviate: true })} AR 60+ days overdue across ${ar_aging.entities_with_overdue} entit${ar_aging.entities_with_overdue === 1 ? 'y' : 'ies'}`);
  if (heartlandDaysStale != null && heartlandDaysStale > 2) attentionItems.push(`Heartland sales last refreshed ${heartlandDaysStale}d ago`);

  const allClear = attentionItems.length === 0;

  return (
    <div className="ia-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ia-sunset/15 text-ia-sunset flex items-center justify-center">
            <Sunrise size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ia-navy">Morning briefing</h2>
            <p className="text-xs text-ia-muted mt-0.5">
              {day_of_week} {fmtDate(date, 'PPP')} · {active_entities ?? '—'} active entit{active_entities === 1 ? 'y' : 'ies'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn('ia-pill', healthPillClass(system_health))}>{system_health ?? 'unknown'}</span>
          <button onClick={onRefresh} className="ia-button-ghost text-xs" title="Refresh briefing">
            <RefreshCw size={12} />
          </button>
          <AskClaudeButton
            moduleLabel="Morning briefing"
            subject={`Morning briefing for ${day_of_week} ${date}`}
            context={briefing}
            suggestedPrompt="Walk me through this morning briefing. What needs my attention right now, and what should I do in the next hour?"
          />
        </div>
      </div>

      {/* Attention strip - what to look at right now */}
      {allClear ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 mb-3">
          <CheckCircle2 size={16} />
          <span>All clear — nothing requires attention this morning.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-sm text-amber-800 mb-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0">{attentionItems.join(' · ')}</span>
        </div>
      )}

      {/* Compact 5-column signal grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <Link to="/alerts" className="rounded border border-ia-border p-2 hover:bg-ia-cream-dark/50 transition-colors">
          <div className="flex items-center gap-1.5 text-ia-muted mb-1">
            <Bell size={12} />
            <span className="font-medium uppercase tracking-wide">Alerts</span>
          </div>
          <div className="font-semibold text-ia-navy text-base">{open_alerts.total ?? 0}</div>
          <div className="text-[10px] text-ia-muted">
            {hasOpenAlerts
              ? [
                  criticalAlerts > 0 && `${criticalAlerts} crit/err`,
                  Number(open_alerts.warning) > 0 && `${open_alerts.warning} warn`,
                  Number(open_alerts.info) > 0 && `${open_alerts.info} info`,
                ].filter(Boolean).join(' · ')
              : 'all clear'}
          </div>
        </Link>
        <Link to="/documents" className="rounded border border-ia-border p-2 hover:bg-ia-cream-dark/50 transition-colors">
          <div className="flex items-center gap-1.5 text-ia-muted mb-1">
            <MessageSquare size={12} />
            <span className="font-medium uppercase tracking-wide">Ingest 24h</span>
          </div>
          <div className="font-semibold text-ia-navy text-base">{ingest_24h.emails ?? 0}</div>
          <div className="text-[10px] text-ia-muted">
            {parser_24h.ok ?? 0} parsed
            {parserHasFailures && <span className="text-red-700 font-medium"> · {parser_24h.failed} failed</span>}
            {Number(ingest_24h.queue_pending) > 0 && <span> · {ingest_24h.queue_pending} queued</span>}
          </div>
        </Link>
        <Link to="/automations" className="rounded border border-ia-border p-2 hover:bg-ia-cream-dark/50 transition-colors">
          <div className="flex items-center gap-1.5 text-ia-muted mb-1">
            <Workflow size={12} />
            <span className="font-medium uppercase tracking-wide">Autos 24h</span>
          </div>
          <div className="font-semibold text-ia-navy text-base">{automation_24h.ok ?? 0}</div>
          <div className="text-[10px] text-ia-muted">
            {automationHasFailures
              ? <span className="text-red-700 font-medium">{automation_24h.failed} failed</span>
              : 'all ok'}
          </div>
        </Link>
        <Link to="/daily-sales" className="rounded border border-ia-border p-2 hover:bg-ia-cream-dark/50 transition-colors">
          <div className="flex items-center gap-1.5 text-ia-muted mb-1">
            <Package size={12} />
            <span className="font-medium uppercase tracking-wide">Heartland</span>
          </div>
          <div className="font-semibold text-ia-navy text-base">
            {heartlandSalesDate ? fmtDate(heartland.latest_sales_date, 'MMM d') : '—'}
          </div>
          <div className="text-[10px] text-ia-muted">
            {heartlandDaysStale != null
              ? heartlandDaysStale === 0
                ? 'today'
                : heartlandDaysStale === 1
                  ? 'yesterday'
                  : `${heartlandDaysStale}d ago`
              : 'no data'}
          </div>
        </Link>
        <Link to="/tax" className="rounded border border-ia-border p-2 hover:bg-ia-cream-dark/50 transition-colors">
          <div className="flex items-center gap-1.5 text-ia-muted mb-1">
            <Receipt size={12} />
            <span className="font-medium uppercase tracking-wide">Tax 30d</span>
          </div>
          <div className="font-semibold text-ia-navy text-base">{taxes_due_30d.length}</div>
          <div className="text-[10px] text-ia-muted">
            {topTaxes.length > 0
              ? `next: ${topTaxes[0].filing_type} in ${topTaxes[0].days_until}d`
              : 'nothing due'}
          </div>
        </Link>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Sales pulse card — compact daily-sales surface for the Dashboard.
// Backed by public.dashboard_sales_pulse_view (migration 055).
// Single hero number with sparkline + same-day-last-week comparison.
// ---------------------------------------------------------------------------

function SalesPulseCard({ pulse, loading, onRefresh, mtdLyRows }) {
  if (loading && !pulse) {
    return (
      <div className="ia-card">
        <SectionHeader title="Sales pulse" description="Loading..." />
        <LoadingState />
      </div>
    );
  }

  if (!pulse || !pulse.latest_sales_date) {
    return (
      <div className="ia-card">
        <div className="flex items-center gap-3">
          <BarChart3 size={18} className="text-ia-muted" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ia-navy">Sales pulse</h2>
            <p className="text-xs text-ia-muted mt-0.5">No Heartland data yet — check edge function heartland-sales-pull.</p>
          </div>
        </div>
      </div>
    );
  }

  const {
    latest_sales_date,
    latest_net_sales,
    latest_txn_count,
    prev_sdw_net_sales,
    prev_sdw_txn_count,
    t7_net_sales,
    t7_txn_count,
    sparkline = [],
    anomalies = [],
  } = pulse;

  const latestNum = Number(latest_net_sales ?? 0);
  const prevNum = Number(prev_sdw_net_sales ?? 0);
  const t7Num = Number(t7_net_sales ?? 0);
  const t7Txn = Number(t7_txn_count ?? 0);
  const latestTxn = Number(latest_txn_count ?? 0);

  const sdwDelta = prevNum > 0 ? (latestNum - prevNum) / prevNum : null;
  const sdwTrend = sdwDelta == null ? 'flat' : sdwDelta > 0.005 ? 'up' : sdwDelta < -0.005 ? 'down' : 'flat';

  const avgTxnValue = latestTxn > 0 ? latestNum / latestTxn : null;
  const t7AvgDaily = t7Num / 7;

  // Sparkline geometry — 14 days, width 220 height 38, padded
  const W = 220, H = 38, PADX = 4, PADY = 4;
  const points = Array.isArray(sparkline) ? sparkline : [];
  let pathD = '';
  let lastX = 0, lastY = 0;
  if (points.length >= 2) {
    const vals = points.map((p) => Number(p.v ?? 0));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const stepX = (W - 2 * PADX) / (points.length - 1);
    pathD = points
      .map((p, i) => {
        const x = PADX + i * stepX;
        const y = H - PADY - ((Number(p.v ?? 0) - min) / range) * (H - 2 * PADY);
        if (i === points.length - 1) { lastX = x; lastY = y; }
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <div className="ia-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ia-teal/15 text-ia-teal flex items-center justify-center">
            <BarChart3 size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ia-navy">Sales pulse</h2>
            <p className="text-xs text-ia-muted mt-0.5">
              Yesterday {fmtDate(latest_sales_date, 'PPP')} · all locations + channels
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onRefresh} className="ia-button-ghost text-xs" title="Refresh">
            <RefreshCw size={12} />
          </button>
          <Link to="/daily-sales" className="text-xs text-ia-teal hover:underline whitespace-nowrap">
            Open full →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        {/* Hero */}
        <div className="md:col-span-3">
          <div className="text-[10px] uppercase tracking-wide text-ia-muted">Net sales · yesterday</div>
          <div className="ia-currency-hero text-3xl mt-0.5">{fmtCurrency(latestNum, { abbreviate: false })}</div>
          {sdwDelta != null && (
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              {sdwTrend === 'up' && <TrendingUp size={12} className="text-emerald-700" />}
              {sdwTrend === 'down' && <TrendingDown size={12} className="text-red-700" />}
              <span className={cn(
                'font-medium',
                sdwTrend === 'up' && 'text-emerald-700',
                sdwTrend === 'down' && 'text-red-700',
                sdwTrend === 'flat' && 'text-ia-muted',
              )}>
                {sdwDelta >= 0 ? '+' : ''}{(sdwDelta * 100).toFixed(1)}%
              </span>
              <span className="text-ia-muted">vs same day last week</span>
            </div>
          )}
        </div>

        {/* Sparkline */}
        <div className="md:col-span-5 px-2">
          <div className="text-[10px] uppercase tracking-wide text-ia-muted mb-1">Trailing 14 days</div>
          {points.length >= 2 ? (
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="text-ia-teal" preserveAspectRatio="none">
              <path d={pathD} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              {lastX > 0 && <circle cx={lastX} cy={lastY} r="2.5" fill="currentColor" />}
            </svg>
          ) : (
            <div className="text-xs text-ia-muted italic py-2">Not enough data for a trend yet.</div>
          )}
        </div>

        {/* Stats */}
        <div className="md:col-span-4 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-ia-border p-2">
            <div className="text-[10px] uppercase tracking-wide text-ia-muted">Trail 7d</div>
            <div className="font-semibold text-ia-navy mt-0.5">{fmtCurrency(t7Num, { abbreviate: true })}</div>
            <div className="text-[10px] text-ia-muted">{fmtCurrency(t7AvgDaily, { abbreviate: true })}/day</div>
          </div>
          <div className="rounded border border-ia-border p-2">
            <div className="text-[10px] uppercase tracking-wide text-ia-muted">Txns today</div>
            <div className="font-semibold text-ia-navy mt-0.5">{latestTxn.toLocaleString()}</div>
            <div className="text-[10px] text-ia-muted">{t7Txn.toLocaleString()} · 7d</div>
          </div>
          <div className="rounded border border-ia-border p-2">
            <div className="text-[10px] uppercase tracking-wide text-ia-muted">$/txn</div>
            <div className="font-semibold text-ia-navy mt-0.5">{avgTxnValue ? fmtCurrency(avgTxnValue, { abbreviate: false }) : '—'}</div>
            <div className="text-[10px] text-ia-muted">today</div>
          </div>
        </div>
      </div>

      {Array.isArray(mtdLyRows) && mtdLyRows.length > 0 && (() => {
        const totals = mtdLyRows.reduce(
          (acc, r) => ({
            mtd_actual:  acc.mtd_actual  + Number(r.mtd_actual  || 0),
            ly_mtd_pace: acc.ly_mtd_pace + Number(r.ly_mtd_pace || 0),
          }),
          { mtd_actual: 0, ly_mtd_pace: 0 },
        );
        const target = totals.ly_mtd_pace * 1.05;
        const pct = totals.ly_mtd_pace > 0
          ? ((totals.mtd_actual - totals.ly_mtd_pace) / totals.ly_mtd_pace) * 100
          : 0;
        const onPace = totals.mtd_actual >= target;
        const storesOnPace = mtdLyRows.filter((r) => r.on_pace_for_bonus).length;
        return (
          <div className="mt-3 border-t border-ia-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wide text-ia-muted">Month-to-date vs LY MTD pace</div>
              <div className="text-[10px] text-ia-muted">{storesOnPace}/{mtdLyRows.length} stores on bonus pace</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ia-muted">MTD Actual</div>
                <div className="ia-currency-hero text-lg">{fmtCurrency(totals.mtd_actual, { abbreviate: false })}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ia-muted">LY MTD Pace</div>
                <div className="text-lg font-semibold text-ia-navy tabular-nums">{fmtCurrency(totals.ly_mtd_pace, { abbreviate: false })}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ia-muted">vs LY</div>
                <div className={cn(
                  'text-lg font-semibold tabular-nums',
                  pct >= 5 ? 'text-emerald-700' : pct >= 0 ? 'text-ia-navy' : 'text-red-700',
                )}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ia-muted">Bonus Target</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-semibold text-ia-navy tabular-nums">{fmtCurrency(target, { abbreviate: false })}</span>
                  {onPace && <CheckCircle2 size={16} className="text-emerald-700" />}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {Array.isArray(anomalies) && anomalies.length > 0 && (
        <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 border-t border-ia-border pt-2">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <span className="font-medium">No 7d sales at:</span>{' '}
            {anomalies.map((a, i) => (
              <span key={a.location}>{i > 0 && ', '}{a.location}{a.is_channel ? ' (channel)' : ''}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
