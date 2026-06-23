import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ListChecks, AlertCircle, Receipt, Workflow, FileText, Search,
  ArrowRight, CheckCircle2, RefreshCw, Calendar,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { supabase } from '../lib/supabase.js';
import { useSupabaseQuery, useUnresolvedAlerts } from '../lib/hooks.js';
import { fmtRelative, fmtDate, cn, severityPillClass, truncate } from '../lib/utils.js';

// ---------------------------------------------------------------------------
// Top of the funnel — what should I look at right now?
// Aggregates from six sources and ranks them in operator-priority order:
//   1. Overdue close items (close cycles still open after period+30d)
//   2. Tax obligations due in next 14 days
//   3. Unresolved error/critical alerts
//   4. Financial review queue (warning-level data_quality alerts) — items
//      Jay needs to walk through and explain during the financials review
//   5. Recipes that are failing more than succeeding
//   6. Documents stuck in 'other' category (categorizer never caught up)
// ---------------------------------------------------------------------------

export default function TasksGoals() {
  // 1. Overdue close items
  const { data: overdueCloses, loading: l1, refetch: r1 } = useSupabaseQuery(
    () => {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      // We want close cycles whose period is older than 30 days but still not complete.
      // Status enum: open | in_progress | blocked | complete
      return supabase
        .from('monthly_close_progress_view')
        .select('id, entity_short_name, legal_name, period, status, items_completed, items_total, completion_pct, opened_at, blocking_issues')
        .in('status', ['open', 'in_progress', 'blocked'])
        .lt('period', cutoff.toISOString().slice(0, 10))
        .order('period', { ascending: true });
    },
    [],
  );

  // 2. Tax obligations due in next 14 days
  const { data: dueTax, loading: l2, refetch: r2 } = useSupabaseQuery(
    () => supabase
      .from('upcoming_tax_obligations_view')
      .select('calendar_id, entity_short_name, jurisdiction, filing_type, period_covered, due_date, days_until_due, status, amount_outstanding_est')
      .gte('days_until_due', 0)
      .lte('days_until_due', 14)
      .order('due_date', { ascending: true }),
    [],
  );

  // 3. Unresolved error/critical alerts
  const { data: criticalAlerts, loading: l3, refetch: r3 } = useSupabaseQuery(
    () => supabase
      .from('system_alerts')
      .select('id, severity, category, message, raised_at')
      .is('resolved_at', null)
      .in('severity', ['error', 'critical'])
      .order('severity', { ascending: false })
      .order('raised_at', { ascending: false })
      .limit(20),
    [],
  );

  // 4. Financial review queue — warning-level data_quality alerts awaiting
  //    owner walkthrough. These are items Claude flagged during the financials
  //    audit that Jay needs to explain (not bookkeeper-facing).
  const { data: reviewQueue, loading: l4, refetch: r4 } = useSupabaseQuery(
    () => supabase
      .from('system_alerts')
      .select('id, severity, category, message, raised_at, entity_id, context')
      .is('resolved_at', null)
      .eq('severity', 'warning')
      .eq('category', 'data_quality')
      .order('raised_at', { ascending: false })
      .limit(50),
    [],
  );

  // 5. Recipes with high failure rates
  const { data: unstableRecipes, loading: l5, refetch: r5 } = useSupabaseQuery(
    () => supabase
      .from('automation_recipes')
      .select('id, recipe_key, name, success_count, failure_count, last_run_at, last_error, category')
      .eq('is_active', true)
      .order('failure_count', { ascending: false })
      .limit(50),
    [],
  );

  // 6. Documents pending categorization (category='other')
  const { data: uncategorizedDocs, loading: l6, refetch: r6 } = useSupabaseQuery(
    () => supabase
      .from('documents')
      .select('id, file_name, drive_url, created_at, entity_id')
      .eq('category', 'other')
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(10),
    [],
  );

  // Filter unstable recipes client-side (need failure_count > success_count check)
  const trulyUnstable = useMemo(() => {
    return (unstableRecipes ?? []).filter((r) => r.failure_count > r.success_count && r.failure_count > 0);
  }, [unstableRecipes]);

  const totalLoading = l1 || l2 || l3 || l4 || l5 || l6;
  const refetchAll = () => { r1(); r2(); r3(); r4(); r5(); r6(); };

  const totals = {
    closes:  overdueCloses?.length ?? 0,
    tax:     dueTax?.length ?? 0,
    alerts:  criticalAlerts?.length ?? 0,
    review:  reviewQueue?.length ?? 0,
    recipes: trulyUnstable.length,
    docs:    uncategorizedDocs?.length ?? 0,
  };
  const grandTotal = totals.closes + totals.tax + totals.alerts + totals.review + totals.recipes + totals.docs;

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Tasks &amp; goals</h1>
          <p className="text-sm text-ia-muted mt-1">
            What needs your attention, pulled from across the BCC. Top of the list = most urgent.
          </p>
        </div>
        <button className="ia-button-ghost" onClick={refetchAll} aria-label="Refresh">
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </header>

      {totalLoading && grandTotal === 0 ? (
        <LoadingState />
      ) : grandTotal === 0 ? (
        <div className="ia-card flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle2 size={48} className="text-emerald-600 mb-4" />
          <h2 className="text-ia-navy">Nothing pressing. Take a breath.</h2>
          <p className="mt-2 max-w-md text-sm text-ia-muted">
            No overdue closes, no upcoming tax deadlines in the next 14 days, no unresolved
            critical alerts, no financial review items, no failing recipes, and no documents
            stuck in categorization. Use the quiet to do something deliberate.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* SECTION 1: Overdue closes */}
          <PrioritySection
            number={1}
            title="Overdue close cycles"
            icon={ListChecks}
            tone="danger"
            count={totals.closes}
            description="Monthly closes still open more than 30 days after period end."
            viewAllLink={{ to: '/dashboard', label: 'View on Dashboard' }}
          >
            {!overdueCloses ? <LoadingState /> :
             overdueCloses.length === 0 ? (
              <ClearedNote message="All close cycles within 30 days of their period." />
            ) : (
              <ul className="divide-y divide-ia-border">
                {overdueCloses.map((c) => (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-ia-navy">
                        {c.entity_short_name} \u00b7 {fmtDate(c.period, 'MMM yyyy')}
                      </div>
                      <div className="text-xs text-ia-muted">
                        opened {fmtRelative(c.opened_at)}
                        \u00b7 {c.items_completed}/{c.items_total} items
                        \u00b7 status {c.status}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 min-w-[6rem]">
                      <div className="flex-1 h-1.5 rounded-full bg-ia-cream-dark overflow-hidden">
                        <div className={cn('h-full',
                          c.completion_pct >= 80 ? 'bg-emerald-500' :
                          c.completion_pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
                        )} style={{ width: `${Math.max(2, Number(c.completion_pct) || 0)}%` }} />
                      </div>
                      <span className="text-xs font-medium text-ia-muted w-10 text-right">{c.completion_pct ?? 0}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PrioritySection>

          {/* SECTION 2: Tax due soon */}
          <PrioritySection
            number={2}
            title="Tax obligations due in next 14 days"
            icon={Receipt}
            tone="warning"
            count={totals.tax}
            description="Federal, state, and local filings approaching their due date."
            viewAllLink={{ to: '/tax', label: 'Open Tax Center' }}
          >
            {!dueTax ? <LoadingState /> :
             dueTax.length === 0 ? (
              <ClearedNote message="No tax deadlines within the next two weeks." />
            ) : (
              <ul className="divide-y divide-ia-border">
                {dueTax.map((t) => (
                  <li key={t.calendar_id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-ia-navy">
                        {t.entity_short_name} \u00b7 {t.filing_type}
                      </div>
                      <div className="text-xs text-ia-muted">
                        {t.jurisdiction} \u00b7 {t.period_covered} \u00b7 due {fmtDate(t.due_date)}
                      </div>
                    </div>
                    <div className="text-right">
                      {t.amount_outstanding_est != null && Number(t.amount_outstanding_est) > 0 && (
                        <div className="text-sm font-medium text-ia-navy">
                          ${Number(t.amount_outstanding_est).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      )}
                      <div className={cn('text-xs font-medium',
                        t.days_until_due <= 3 ? 'text-red-700' :
                        t.days_until_due <= 7 ? 'text-amber-700' : 'text-ia-muted'
                      )}>
                        {t.days_until_due === 0 ? 'today' :
                         t.days_until_due === 1 ? 'tomorrow' :
                         `${t.days_until_due}d`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PrioritySection>

          {/* SECTION 3: Critical alerts */}
          <PrioritySection
            number={3}
            title="Unresolved error / critical alerts"
            icon={AlertCircle}
            tone="danger"
            count={totals.alerts}
            description="System raised these but no one has resolved them yet."
            viewAllLink={{ to: '/alerts', label: 'Open Alerts' }}
          >
            {!criticalAlerts ? <LoadingState /> :
             criticalAlerts.length === 0 ? (
              <ClearedNote message="No unresolved error or critical alerts." />
            ) : (
              <ul className="divide-y divide-ia-border">
                {criticalAlerts.map((a) => (
                  <li key={a.id} className="py-2">
                    <div className="flex items-start gap-2">
                      <span className={severityPillClass(a.severity)}>{a.severity}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ia-navy">{truncate(a.message, 160)}</div>
                        <div className="text-xs text-ia-muted mt-0.5">
                          {a.category} \u00b7 raised {fmtRelative(a.raised_at)}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PrioritySection>

          {/* SECTION 4: Financial review queue (data_quality warnings) */}
          <PrioritySection
            number={4}
            title="Financial review queue"
            icon={Search}
            tone="warning"
            count={totals.review}
            description="Data anomalies flagged during the financials audit. Walk through each with Claude during the next financials review and resolve with a note in Alerts."
            viewAllLink={{ to: '/alerts', label: 'Open Alerts' }}
          >
            {!reviewQueue ? <LoadingState /> :
             reviewQueue.length === 0 ? (
              <ClearedNote message="No open financial review items." />
            ) : (
              <ul className="divide-y divide-ia-border">
                {reviewQueue.map((a) => {
                  const ctx = a.context ?? {};
                  const entity = ctx.entity_short_name ?? null;
                  const period = ctx.period ?? ctx.period_window ?? null;
                  return (
                    <li key={a.id} className="py-2">
                      <div className="flex items-start gap-2">
                        <span className={severityPillClass(a.severity)}>review</span>
                        <div className="flex-1 min-w-0">
                          {(entity || period) && (
                            <div className="text-xs font-medium text-ia-navy mb-0.5">
                              {entity}{entity && period ? ' \u00b7 ' : ''}{period}
                            </div>
                          )}
                          <div className="text-sm text-ia-navy">{truncate(a.message, 280)}</div>
                          <div className="text-xs text-ia-muted mt-0.5">
                            #{a.id} \u00b7 raised {fmtRelative(a.raised_at)}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </PrioritySection>

          {/* SECTION 5: Unstable recipes */}
          <PrioritySection
            number={5}
            title="Recipes with high failure rates"
            icon={Workflow}
            tone="warning"
            count={totals.recipes}
            description="Active recipes failing more often than succeeding. Worth a look."
            viewAllLink={{ to: '/automations', label: 'Open Automations' }}
          >
            {!unstableRecipes ? <LoadingState /> :
             trulyUnstable.length === 0 ? (
              <ClearedNote message="All active recipes are succeeding more than they're failing." />
            ) : (
              <ul className="divide-y divide-ia-border">
                {trulyUnstable.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-ia-navy">{r.name ?? r.recipe_key}</div>
                        <div className="text-xs font-mono text-ia-muted">{r.recipe_key}</div>
                        {r.last_error && (
                          <div className="text-xs text-red-700 mt-1 font-mono">{truncate(r.last_error, 200)}</div>
                        )}
                      </div>
                      <div className="text-right text-xs whitespace-nowrap">
                        <span className="text-emerald-700">{r.success_count} \u2713</span>
                        <span className="text-ia-muted"> / </span>
                        <span className="text-red-700">{r.failure_count} \u2717</span>
                        {r.last_run_at && (
                          <div className="text-ia-muted mt-0.5">last {fmtRelative(r.last_run_at)}</div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PrioritySection>

          {/* SECTION 6: Uncategorized docs */}
          <PrioritySection
            number={6}
            title="Documents pending categorization"
            icon={FileText}
            tone="info"
            count={totals.docs}
            description="Documents in the 'other' category — the categorizer recipe hasn't classified them yet."
            viewAllLink={{ to: '/documents', label: 'Open Documents' }}
          >
            {!uncategorizedDocs ? <LoadingState /> :
             uncategorizedDocs.length === 0 ? (
              <ClearedNote message="All documents have been categorized." />
            ) : (
              <ul className="divide-y divide-ia-border">
                {uncategorizedDocs.map((d) => (
                  <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {d.drive_url ? (
                        <a href={d.drive_url} target="_blank" rel="noreferrer"
                          className="font-medium text-sm text-ia-navy hover:text-ia-teal no-underline">
                          {d.file_name}
                        </a>
                      ) : (
                        <span className="font-medium text-sm text-ia-navy">{d.file_name}</span>
                      )}
                      <div className="text-xs text-ia-muted mt-0.5">added {fmtRelative(d.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PrioritySection>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function PrioritySection({ number, title, icon: Icon, tone, count, description, viewAllLink, children }) {
  const borderClass = {
    danger:  'border-red-200',
    warning: 'border-amber-200',
    info:    'border-ia-border',
    success: 'border-emerald-200',
  }[tone] ?? 'border-ia-border';

  const pillClass = {
    danger:  'ia-pill-danger',
    warning: 'ia-pill-warning',
    info:    'ia-pill-info',
    success: 'ia-pill-success',
  }[tone] ?? 'ia-pill-muted';

  // Hide the whole section when there's nothing in it AND we're done loading
  // (the parent component already shows the "all clear" state).
  if (count === 0) return null;

  return (
    <div className={cn('ia-card', borderClass)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className={cn(
            'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold',
            'bg-ia-navy text-white'
          )}>{number}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon size={16} className="text-ia-muted" />
              <h2 className="!text-base">{title}</h2>
              <span className={pillClass}>{count}</span>
            </div>
            {description && <p className="text-xs text-ia-muted mt-0.5">{description}</p>}
          </div>
        </div>
        {viewAllLink && (
          <Link to={viewAllLink.to} className="ia-button-ghost text-xs whitespace-nowrap">
            <span>{viewAllLink.label}</span>
            <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function ClearedNote({ message }) {
  return (
    <div className="flex items-center gap-2 text-emerald-700 text-sm py-1">
      <CheckCircle2 size={14} />
      <span>{message}</span>
    </div>
  );
}
