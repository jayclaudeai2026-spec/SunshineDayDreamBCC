import { useMemo, useState } from 'react';
import {
  Calendar, AlertTriangle, AlertCircle, CheckCircle2, Clock,
  ChevronDown, ChevronRight, RefreshCw, FileText, MapPin, User, Building2, ExternalLink,
  TrendingUp, TrendingDown, Minus, Target,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { useSupabaseQuery } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';
import { fmtCurrency, fmtDate, fmtRelative, cn, truncate } from '../lib/utils.js';

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'pastdue',  label: 'Past due' },
  { key: 'history',  label: 'Filed & paid' },
  { key: 'position', label: 'Position' },
  { key: 'profiles', label: 'Profiles' },
];

const FILER_TYPE_LABEL = {
  '1120':            'C-Corp (1120)',
  '1120S':           'S-Corp (1120S)',
  '1065':            'Partnership/LLC (1065)',
  '1040_schedule_c': 'Sole Prop (Sch C)',
  '990':             'Non-profit (990)',
  none:              'Not yet set',
};

const STATUS_PILL = {
  upcoming:        'ia-pill-muted',
  due_soon:        'ia-pill-warning',
  overdue:         'ia-pill-danger',
  filed:           'ia-pill-success',
  paid:            'ia-pill-success',
  extension_filed: 'ia-pill-warning',
  amended:         'ia-pill-warning',
  n_a:             'ia-pill-muted',
};

const TAX_HEALTH_LABEL = {
  on_track:         { pill: 'ia-pill-success', label: 'On track' },
  under_paying:     { pill: 'ia-pill-warning', label: 'Under paying' },
  no_payments_made: { pill: 'ia-pill-warning', label: 'No payments made' },
  loss_year:        { pill: 'ia-pill-muted',   label: 'Loss year' },
  no_data:          { pill: 'ia-pill-muted',   label: 'No data' },
  closed:           { pill: 'ia-pill-muted',   label: 'Closed' },
};

const PAYMENT_TYPE_LABEL = {
  estimated_q1:        'Est. Q1',
  estimated_q2:        'Est. Q2',
  estimated_q3:        'Est. Q3',
  estimated_q4:        'Est. Q4',
  extension:           'Extension',
  balance_due:         'Balance due',
  amended_payment:     'Amended',
  penalty:             'Penalty',
  interest:            'Interest',
  sales_tax_remittance:'Sales tax',
  payroll_tax_deposit: 'Payroll tax',
  refund_received:     'Refund',
};

function daysUntilLabel(days) {
  if (days == null) return null;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 14) return `${days}d`;
  if (days <= 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

function urgencyClass(days) {
  if (days == null) return 'text-ia-muted';
  if (days < 0) return 'text-red-700 font-medium';
  if (days <= 7) return 'text-red-700 font-medium';
  if (days <= 14) return 'text-amber-700 font-medium';
  if (days <= 30) return 'text-ia-navy';
  return 'text-ia-muted';
}

function fmtPct(p) {
  if (p == null) return '—';
  const v = Number(p);
  if (Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function yoyColor(p) {
  if (p == null) return 'text-ia-muted';
  const v = Number(p);
  if (Number.isNaN(v)) return 'text-ia-muted';
  if (v > 5) return 'text-emerald-700';
  if (v < -5) return 'text-red-700';
  return 'text-ia-muted';
}

export default function TaxCenter() {
  const [activeTab, setActiveTab] = useState('upcoming');
  const [activeJurisdiction, setActiveJurisdiction] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const upcomingQ = useSupabaseQuery(
    () => supabase
      .from('upcoming_tax_obligations_view')
      .select('*')
      .order('due_date', { ascending: true })
      .limit(200),
    [],
  );

  const calendarQ = useSupabaseQuery(
    () => supabase
      .from('tax_calendar')
      .select('*, entities(entity_short_name, legal_name)')
      .in('status', ['filed', 'paid', 'amended'])
      .order('filed_date', { ascending: false, nullsFirst: false })
      .order('due_date', { ascending: false })
      .limit(150),
    [],
  );

  const paymentsQ = useSupabaseQuery(
    () => supabase
      .from('tax_payments')
      .select('*, entities(entity_short_name)')
      .order('payment_date', { ascending: false })
      .limit(100),
    [],
  );

  const profilesQ = useSupabaseQuery(
    () => supabase
      .from('tax_entity_profiles')
      .select('*, entities(entity_short_name, legal_name, is_active)')
      .order('entity_id', { ascending: true }),
    [],
  );

  // Position tab: per-entity per-year forecast
  const forecastQ = useSupabaseQuery(
    () => supabase
      .from('tax_position_forecast_view')
      .select('*')
      .order('entity_short_name', { ascending: true })
      .order('tax_year', { ascending: false }),
    [],
  );

  // Filed Returns sub-panel: tax_documents joined with entities
  const taxDocsQ = useSupabaseQuery(
    () => supabase
      .from('tax_documents')
      .select('*, entities(entity_short_name, legal_name)')
      .order('tax_year', { ascending: false })
      .order('entity_id', { ascending: true })
      .limit(100),
    [],
  );

  const upcoming = upcomingQ.data ?? [];
  const filed = calendarQ.data ?? [];
  const payments = paymentsQ.data ?? [];
  const profiles = profilesQ.data ?? [];
  const forecast = forecastQ.data ?? [];
  const taxDocs = taxDocsQ.data ?? [];

  const loading = upcomingQ.loading || calendarQ.loading || profilesQ.loading || forecastQ.loading;

  const refetchAll = () => {
    upcomingQ.refetch();
    calendarQ.refetch();
    paymentsQ.refetch();
    profilesQ.refetch();
    forecastQ.refetch();
    taxDocsQ.refetch();
  };

  // Split upcoming into not-yet-due and past-due based on days_until_due
  const futureObligations = useMemo(() => upcoming.filter((o) => o.days_until_due >= 0 && o.status !== 'overdue'), [upcoming]);
  const pastDue = useMemo(() => upcoming.filter((o) => o.days_until_due < 0 || o.status === 'overdue'), [upcoming]);

  // Jurisdictions present in current data set
  const jurisdictions = useMemo(() => {
    const source = activeTab === 'pastdue' ? pastDue
                 : activeTab === 'history' ? filed
                 : futureObligations;
    const set = new Set(source.map((o) => o.jurisdiction).filter(Boolean));
    return Array.from(set).sort();
  }, [activeTab, futureObligations, pastDue, filed]);

  const jurisdictionCounts = useMemo(() => {
    const source = activeTab === 'pastdue' ? pastDue
                 : activeTab === 'history' ? filed
                 : futureObligations;
    const c = {};
    for (const o of source) {
      if (o.jurisdiction) c[o.jurisdiction] = (c[o.jurisdiction] ?? 0) + 1;
    }
    return c;
  }, [activeTab, futureObligations, pastDue, filed]);

  // Map calendar_id -> [payments]
  const paymentsByCalendar = useMemo(() => {
    const m = new Map();
    for (const p of payments) {
      if (!p.tax_calendar_id) continue;
      if (!m.has(p.tax_calendar_id)) m.set(p.tax_calendar_id, []);
      m.get(p.tax_calendar_id).push(p);
    }
    return m;
  }, [payments]);

  // Map tax_documents by entity_id for History tab cross-reference
  const docsByEntityYear = useMemo(() => {
    const m = new Map();
    for (const d of taxDocs) {
      const key = `${d.entity_id}-${d.tax_year}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(d);
    }
    return m;
  }, [taxDocs]);

  // Forecast: group by entity for the Position tab. Each entity has up to 3 year-rows.
  const forecastByEntity = useMemo(() => {
    const m = new Map();
    for (const f of forecast) {
      if (!m.has(f.entity_id)) m.set(f.entity_id, []);
      m.get(f.entity_id).push(f);
    }
    return m;
  }, [forecast]);

  // Pull current-year rows for the aggregate summary
  const currentYearRows = useMemo(() => forecast.filter((f) => f.is_current_year), [forecast]);

  const aggregatePosition = useMemo(() => {
    const rev = currentYearRows.reduce((s, r) => s + Number(r.ytd_revenue ?? 0), 0);
    const ni = currentYearRows.reduce((s, r) => s + Number(r.ytd_net_income ?? 0), 0);
    const projNi = currentYearRows.reduce((s, r) => s + Number(r.projected_annual_net_income ?? 0), 0);
    const projRev = currentYearRows.reduce((s, r) => s + Number(r.projected_annual_revenue ?? 0), 0);
    const projLiab = currentYearRows.reduce((s, r) => s + Number(r.est_federal_tax_liability_projected ?? 0), 0);
    const payments = currentYearRows.reduce((s, r) => s + Number(r.payments_made ?? 0), 0);
    const pySamePeriodNi = currentYearRows.reduce((s, r) => s + Number(r.py_same_period_net_income ?? 0), 0);
    const months = currentYearRows.length > 0
      ? Math.max(...currentYearRows.map((r) => Number(r.months_recorded ?? 0)))
      : 0;
    const onTrackCount = currentYearRows.filter((r) => r.tax_health === 'on_track').length;
    const lossYearCount = currentYearRows.filter((r) => r.tax_health === 'loss_year').length;
    const yoy = pySamePeriodNi !== 0 ? ((ni - pySamePeriodNi) / Math.abs(pySamePeriodNi)) * 100 : null;
    return {
      ytd_revenue: rev,
      ytd_net_income: ni,
      projected_annual_net_income: projNi,
      projected_annual_revenue: projRev,
      est_federal_tax_liability_projected: projLiab,
      payments_made: payments,
      gap: Math.max(0, projLiab - payments),
      py_same_period_net_income: pySamePeriodNi,
      yoy_net_income_pct: yoy,
      months_recorded: months,
      entity_count: currentYearRows.length,
      on_track_count: onTrackCount,
      loss_year_count: lossYearCount,
      as_of_date: currentYearRows[0]?.as_of_date,
    };
  }, [currentYearRows]);

  function applyJurisdictionFilter(items) {
    if (!activeJurisdiction) return items;
    return items.filter((o) => o.jurisdiction === activeJurisdiction);
  }

  const totalOutstanding = useMemo(() => {
    return futureObligations.reduce((sum, o) => sum + Number(o.amount_outstanding_est ?? 0), 0);
  }, [futureObligations]);

  const totalOverdueEst = useMemo(() => {
    return pastDue.reduce((sum, o) => sum + Number(o.amount_outstanding_est ?? 0), 0);
  }, [pastDue]);

  const counts = {
    upcoming: futureObligations.length,
    pastdue:  pastDue.length,
    history:  filed.length,
    position: currentYearRows.length,
    profiles: profiles.length,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Tax center</h1>
          <p className="text-sm text-ia-muted mt-1">
            Tracker, not a filer. Upcoming obligations, past-due, filed-and-paid, per-entity
            forecast position, and entity tax profiles. Filings happen with your CPA or portal.
          </p>
        </div>
        <button className="ia-button-ghost" onClick={refetchAll} aria-label="Refresh">
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </header>

      {/* Past-due banner */}
      {pastDue.length > 0 && activeTab !== 'pastdue' && (
        <div className="ia-card border-red-200 bg-red-50/50 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle size={16} />
            <span>{pastDue.length} obligation{pastDue.length === 1 ? '' : 's'} past due {totalOverdueEst > 0 && <span>· ~{fmtCurrency(totalOverdueEst)} estimated outstanding</span>}</span>
          </div>
          <button onClick={() => { setActiveTab('pastdue'); setActiveJurisdiction(null); }} className="ia-button-ghost text-xs">View</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-ia-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setActiveJurisdiction(null); setExpandedId(null); }}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
              activeTab === t.key
                ? 'border-ia-teal text-ia-teal font-medium'
                : 'border-transparent text-ia-muted hover:text-ia-navy'
            )}
          >
            <span>{t.label}</span>
            <span className={cn(
              'inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full text-[10px] font-semibold',
              activeTab === t.key ? 'bg-ia-teal text-white' : 'bg-ia-cream-dark text-ia-muted'
            )}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading && <LoadingState label="Loading tax data..." />}

      {/* Jurisdiction filter (not on Position or Profiles tabs) */}
      {activeTab !== 'profiles' && activeTab !== 'position' && jurisdictions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ia-muted uppercase mr-1">Jurisdiction</span>
          <FilterPill label="All" active={!activeJurisdiction} onClick={() => setActiveJurisdiction(null)} count={jurisdictionCounts && Object.values(jurisdictionCounts).reduce((s, n) => s + n, 0)} />
          {jurisdictions.map((j) => (
            <FilterPill
              key={j}
              label={j}
              active={activeJurisdiction === j}
              onClick={() => setActiveJurisdiction(j)}
              count={jurisdictionCounts[j]}
            />
          ))}
        </div>
      )}

      {/* UPCOMING TAB */}
      {activeTab === 'upcoming' && !loading && (
        <>
          {futureObligations.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="ia-card">
                <div className="text-[10px] uppercase font-medium text-ia-muted">Obligations</div>
                <div className="text-2xl font-semibold text-ia-navy mt-1">{futureObligations.length}</div>
                <div className="text-xs text-ia-muted mt-1">in next 90 days</div>
              </div>
              <div className="ia-card">
                <div className="text-[10px] uppercase font-medium text-ia-muted">Est. outstanding</div>
                <div className="text-2xl font-semibold text-ia-navy mt-1">{fmtCurrency(totalOutstanding)}</div>
                <div className="text-xs text-ia-muted mt-1">based on amount_due_est</div>
              </div>
              <div className="ia-card">
                <div className="text-[10px] uppercase font-medium text-ia-muted">Next due</div>
                <div className="text-2xl font-semibold text-ia-navy mt-1">
                  {futureObligations[0]?.due_date ? fmtDate(futureObligations[0].due_date) : '—'}
                </div>
                <div className={cn('text-xs mt-1', urgencyClass(futureObligations[0]?.days_until_due))}>
                  {daysUntilLabel(futureObligations[0]?.days_until_due) ?? 'nothing pending'}
                </div>
              </div>
            </div>
          )}

          {applyJurisdictionFilter(futureObligations).length === 0 ? (
            <EmptyState
              title="Nothing in the next 90 days"
              description="Tax calendar entries with status upcoming or due_soon will show up here. Past 90 days is hidden."
            />
          ) : (
            <div className="space-y-2">
              {applyJurisdictionFilter(futureObligations).map((o) => (
                <ObligationRow
                  key={o.calendar_id}
                  obl={o}
                  expanded={expandedId === o.calendar_id}
                  onToggle={() => setExpandedId(expandedId === o.calendar_id ? null : o.calendar_id)}
                  payments={paymentsByCalendar.get(o.calendar_id) ?? []}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* PAST DUE TAB */}
      {activeTab === 'pastdue' && !loading && (
        applyJurisdictionFilter(pastDue).length === 0 ? (
          <EmptyState
            title="Nothing past due"
            description="When a tax_calendar entry's due_date passes without a filed_date or status=paid, it lands here."
          />
        ) : (
          <div className="space-y-2">
            {applyJurisdictionFilter(pastDue).map((o) => (
              <ObligationRow
                key={o.calendar_id}
                obl={o}
                expanded={expandedId === o.calendar_id}
                onToggle={() => setExpandedId(expandedId === o.calendar_id ? null : o.calendar_id)}
                payments={paymentsByCalendar.get(o.calendar_id) ?? []}
                pastDue
              />
            ))}
          </div>
        )
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && !loading && (
        <div className="space-y-6">
          {applyJurisdictionFilter(filed).length === 0 ? (
            <EmptyState
              title="No filed records yet"
              description="Once a tax_calendar entry hits status filed/paid/amended, it shows up here with linked payments."
            />
          ) : (
            <div className="ia-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-ia-muted border-b border-ia-border">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Filed</th>
                    <th className="pb-2 pr-3 font-medium">Entity</th>
                    <th className="pb-2 pr-3 font-medium">Jurisdiction</th>
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Period</th>
                    <th className="pb-2 pr-3 font-medium text-right">Paid</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium">Doc</th>
                  </tr>
                </thead>
                <tbody>
                  {applyJurisdictionFilter(filed).map((c) => {
                    const ty = c.period_covered?.startsWith('TY ') ? Number(c.period_covered.slice(3)) : null;
                    const docs = ty ? (docsByEntityYear.get(`${c.entity_id}-${ty}`) ?? []) : [];
                    return (
                      <tr key={c.id} className="border-b border-ia-border last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap">{c.filed_date ? fmtDate(c.filed_date) : '—'}</td>
                        <td className="py-2 pr-3 text-xs">{c.entities?.entity_short_name ?? `#${c.entity_id}`}</td>
                        <td className="py-2 pr-3 text-xs">{c.jurisdiction}</td>
                        <td className="py-2 pr-3 text-xs">{c.filing_type}</td>
                        <td className="py-2 pr-3 text-xs text-ia-muted">{c.period_covered}</td>
                        <td className="py-2 pr-3 text-right">{fmtCurrency(c.amount_paid)}</td>
                        <td className="py-2 pr-3">
                          <span className={cn(STATUS_PILL[c.status] ?? 'ia-pill-muted', 'text-[10px]')}>
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2">
                          {docs.length > 0 && docs[0].drive_url ? (
                            <a
                              href={docs[0].drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-ia-teal hover:underline"
                            >
                              <ExternalLink size={10} /> PDF
                            </a>
                          ) : (
                            <span className="text-xs text-ia-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Filed Returns archive - separate from tax_calendar, sourced from tax_documents */}
          {taxDocs.length > 0 && (
            <div>
              <SectionHeader title="Tax document archive" subtitle={`${taxDocs.length} filed return${taxDocs.length === 1 ? '' : 's'} archived to Drive`} />
              <div className="ia-card overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-ia-muted border-b border-ia-border">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Tax year</th>
                      <th className="pb-2 pr-3 font-medium">Entity</th>
                      <th className="pb-2 pr-3 font-medium">Type</th>
                      <th className="pb-2 pr-3 font-medium">Jurisdiction</th>
                      <th className="pb-2 pr-3 font-medium">Status</th>
                      <th className="pb-2 pr-3 font-medium">Preparer</th>
                      <th className="pb-2 font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxDocs.map((d) => (
                      <tr key={d.id} className="border-b border-ia-border last:border-0">
                        <td className="py-2 pr-3 font-medium">{d.tax_year}</td>
                        <td className="py-2 pr-3 text-xs">{d.entities?.entity_short_name ?? `#${d.entity_id}`}</td>
                        <td className="py-2 pr-3 text-xs">{d.document_type}</td>
                        <td className="py-2 pr-3 text-xs">{d.jurisdiction}</td>
                        <td className="py-2 pr-3">
                          <span className="ia-pill-success text-[10px]">{d.document_status}</span>
                        </td>
                        <td className="py-2 pr-3 text-xs text-ia-muted">{d.preparer ?? '—'}</td>
                        <td className="py-2">
                          {d.drive_url ? (
                            <a
                              href={d.drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-ia-teal hover:underline"
                            >
                              <ExternalLink size={10} /> Open
                            </a>
                          ) : (
                            <span className="text-xs text-ia-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* POSITION TAB - per-entity per-year tax position forecast */}
      {activeTab === 'position' && !loading && (
        currentYearRows.length === 0 ? (
          <EmptyState
            title="No forecast data"
            description="The tax_position_forecast_view needs monthly_pl rows for the current year and tax_entity_profiles rows for each active entity."
          />
        ) : (
          <div className="space-y-6">
            {/* Aggregate summary across all entities */}
            <div>
              <SectionHeader
                title="All entities — current year position"
                subtitle={`${aggregatePosition.months_recorded} months recorded · ${aggregatePosition.entity_count} entities (${aggregatePosition.on_track_count} on track, ${aggregatePosition.loss_year_count} loss year)`}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <div className="ia-card">
                  <div className="text-[10px] uppercase font-medium text-ia-muted">YTD revenue</div>
                  <div className="text-xl font-semibold text-ia-navy mt-1">{fmtCurrency(aggregatePosition.ytd_revenue)}</div>
                  <div className="text-xs text-ia-muted mt-1">Projects ~{fmtCurrency(aggregatePosition.projected_annual_revenue)} full year</div>
                </div>
                <div className="ia-card">
                  <div className="text-[10px] uppercase font-medium text-ia-muted">YTD net income</div>
                  <div className={cn('text-xl font-semibold mt-1', aggregatePosition.ytd_net_income < 0 ? 'text-red-700' : 'text-ia-navy')}>
                    {fmtCurrency(aggregatePosition.ytd_net_income)}
                  </div>
                  <div className={cn('text-xs mt-1', yoyColor(aggregatePosition.yoy_net_income_pct))}>
                    {fmtPct(aggregatePosition.yoy_net_income_pct)} vs same period last year
                  </div>
                </div>
                <div className="ia-card">
                  <div className="text-[10px] uppercase font-medium text-ia-muted">Projected annual NI</div>
                  <div className={cn('text-xl font-semibold mt-1', aggregatePosition.projected_annual_net_income < 0 ? 'text-red-700' : 'text-ia-navy')}>
                    {fmtCurrency(aggregatePosition.projected_annual_net_income)}
                  </div>
                  <div className="text-xs text-ia-muted mt-1">linear extrapolation from YTD</div>
                </div>
                <div className="ia-card">
                  <div className="text-[10px] uppercase font-medium text-ia-muted">Est. federal liability</div>
                  <div className="text-xl font-semibold text-ia-navy mt-1">{fmtCurrency(aggregatePosition.est_federal_tax_liability_projected)}</div>
                  <div className="text-xs text-ia-muted mt-1">
                    {aggregatePosition.payments_made > 0
                      ? `${fmtCurrency(aggregatePosition.payments_made)} paid · gap ${fmtCurrency(aggregatePosition.gap)}`
                      : 'no payments tracked yet'}
                  </div>
                </div>
              </div>
              <div className="text-xs text-ia-muted italic mt-2">
                Pass-through entities (1120S/1065) use a 32% placeholder bracket. Tune via tax_entity_profiles.notes.
              </div>
            </div>

            {/* Per-entity position cards */}
            <div>
              <SectionHeader title="Per-entity position" subtitle="Each entity's current year vs prior year for forecasting" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
                {Array.from(forecastByEntity.values())
                  .map((rows) => rows.find((r) => r.is_current_year))
                  .filter(Boolean)
                  .sort((a, b) => (a.entity_short_name ?? '').localeCompare(b.entity_short_name ?? ''))
                  .map((cur) => {
                    const rows = forecastByEntity.get(cur.entity_id) ?? [];
                    const prior = rows.find((r) => r.tax_year === cur.tax_year - 1);
                    const twoBack = rows.find((r) => r.tax_year === cur.tax_year - 2);
                    const health = TAX_HEALTH_LABEL[cur.tax_health] ?? TAX_HEALTH_LABEL.no_data;
                    const niPositive = Number(cur.ytd_net_income ?? 0) >= 0;
                    const projPositive = Number(cur.projected_annual_net_income ?? 0) >= 0;
                    const gap = Math.max(0, Number(cur.est_federal_tax_liability_projected ?? 0) - Number(cur.payments_made ?? 0));
                    return (
                      <div key={cur.entity_id} className="ia-card">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-start gap-2 min-w-0">
                            <Building2 size={14} className="text-ia-teal mt-0.5" />
                            <div className="min-w-0">
                              <div className="font-medium text-ia-navy truncate">{cur.entity_short_name}</div>
                              <div className="text-xs text-ia-muted">
                                {FILER_TYPE_LABEL[cur.federal_filing_type] ?? cur.federal_filing_type} · {cur.primary_state ?? cur.state}
                              </div>
                            </div>
                          </div>
                          <span className={cn(health.pill, 'text-[10px] whitespace-nowrap')}>{health.label}</span>
                        </div>

                        {/* Current year vs prior year side-by-side */}
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <div className="text-[10px] uppercase font-medium text-ia-muted">YTD {cur.tax_year}</div>
                            <div className="text-ia-navy font-medium mt-1">Rev {fmtCurrency(cur.ytd_revenue)}</div>
                            <div className={cn('font-medium', niPositive ? 'text-ia-navy' : 'text-red-700')}>
                              NI {fmtCurrency(cur.ytd_net_income)}
                            </div>
                            <div className="text-ia-muted mt-0.5">{cur.months_recorded} months in</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-medium text-ia-muted">Same period {cur.tax_year - 1}</div>
                            <div className="text-ia-navy mt-1">Rev {fmtCurrency(cur.py_same_period_revenue)}</div>
                            <div className={Number(cur.py_same_period_net_income ?? 0) < 0 ? 'text-red-700' : 'text-ia-navy'}>
                              NI {fmtCurrency(cur.py_same_period_net_income)}
                            </div>
                            <div className={cn('mt-0.5', yoyColor(cur.yoy_net_income_pct))}>
                              {cur.yoy_net_income_pct != null ? (
                                <>
                                  {Number(cur.yoy_net_income_pct) > 0 ? <TrendingUp size={10} className="inline mr-0.5" /> :
                                   Number(cur.yoy_net_income_pct) < 0 ? <TrendingDown size={10} className="inline mr-0.5" /> :
                                   <Minus size={10} className="inline mr-0.5" />}
                                  NI {fmtPct(cur.yoy_net_income_pct)}
                                </>
                              ) : '—'}
                            </div>
                          </div>
                        </div>

                        {/* Full year projection */}
                        <div className="mt-3 pt-3 border-t border-ia-border">
                          <div className="text-[10px] uppercase font-medium text-ia-muted flex items-center gap-1">
                            <Target size={10} /> Full year projection
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs mt-1">
                            <div>
                              <div className="text-ia-muted">Projected rev</div>
                              <div className="text-ia-navy font-medium">{fmtCurrency(cur.projected_annual_revenue)}</div>
                            </div>
                            <div>
                              <div className="text-ia-muted">Projected NI</div>
                              <div className={cn('font-medium', projPositive ? 'text-ia-navy' : 'text-red-700')}>
                                {fmtCurrency(cur.projected_annual_net_income)}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Federal tax liability */}
                        <div className="mt-3 pt-3 border-t border-ia-border">
                          <div className="text-[10px] uppercase font-medium text-ia-muted">Federal tax position</div>
                          <dl className="text-xs grid grid-cols-2 gap-x-3 gap-y-1 mt-1">
                            <dt className="text-ia-muted">Est. liability (projected)</dt>
                            <dd className="text-right text-ia-navy font-medium">{fmtCurrency(cur.est_federal_tax_liability_projected)}</dd>
                            <dt className="text-ia-muted">Payments YTD</dt>
                            <dd className="text-right">{fmtCurrency(cur.payments_made)}</dd>
                            <dt className="text-ia-muted font-medium">Gap</dt>
                            <dd className={cn('text-right font-medium', gap > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                              {fmtCurrency(gap)}
                            </dd>
                          </dl>
                        </div>

                        {/* Prior-year trend */}
                        {(prior || twoBack) && (
                          <div className="mt-3 pt-3 border-t border-ia-border">
                            <div className="text-[10px] uppercase font-medium text-ia-muted">Trend (full-year actuals)</div>
                            <div className="grid grid-cols-2 gap-3 text-xs mt-1">
                              {twoBack && (
                                <div>
                                  <div className="text-ia-muted">{twoBack.tax_year}</div>
                                  <div className={Number(twoBack.ytd_net_income ?? 0) < 0 ? 'text-red-700' : 'text-ia-navy'}>
                                    {fmtCurrency(twoBack.ytd_net_income)}
                                  </div>
                                </div>
                              )}
                              {prior && (
                                <div>
                                  <div className="text-ia-muted">{prior.tax_year}</div>
                                  <div className={Number(prior.ytd_net_income ?? 0) < 0 ? 'text-red-700' : 'text-ia-navy'}>
                                    {fmtCurrency(prior.ytd_net_income)}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Filing status */}
                        {cur.filing_status && (
                          <div className="mt-3 pt-3 border-t border-ia-border flex items-center justify-between text-xs">
                            <span className="text-ia-muted">Annual return ({cur.tax_year})</span>
                            <span className={cn(STATUS_PILL[cur.filing_status] ?? 'ia-pill-muted', 'text-[10px]')}>
                              {cur.filing_status}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )
      )}

      {/* PROFILES TAB */}
      {activeTab === 'profiles' && !loading && (
        profiles.length === 0 ? (
          <EmptyState
            title="No tax profiles set up"
            description="Each entity needs a row in public.tax_entity_profiles. The federal_filing_type drives what the Tax Center shows."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {profiles.map((p) => (
              <div key={p.id} className="ia-card">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-start gap-2">
                    <Building2 size={14} className="text-ia-teal mt-0.5" />
                    <div>
                      <div className="font-medium text-ia-navy">
                        {p.entities?.entity_short_name ?? `Entity #${p.entity_id}`}
                      </div>
                      <div className="text-xs text-ia-muted">
                        {p.entities?.legal_name ?? '—'}
                      </div>
                    </div>
                  </div>
                  <span className="ia-pill-muted text-[10px]">
                    {FILER_TYPE_LABEL[p.federal_filing_type] ?? p.federal_filing_type}
                  </span>
                </div>

                <dl className="text-xs space-y-1.5">
                  {p.state_filing_type && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ia-muted">State filing</dt>
                      <dd className="text-ia-navy text-right">{p.state_filing_type}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt className="text-ia-muted">Fiscal year-end</dt>
                    <dd className="text-ia-navy text-right">Month {p.fiscal_year_end_month}</dd>
                  </div>
                  {p.ein_last4 && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ia-muted">EIN</dt>
                      <dd className="text-ia-navy text-right">••-•••{p.ein_last4}</dd>
                    </div>
                  )}
                  {p.primary_state && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ia-muted">Primary state</dt>
                      <dd className="text-ia-navy text-right inline-flex items-center gap-1">
                        <MapPin size={10} /> {p.primary_state}
                      </dd>
                    </div>
                  )}
                  {p.additional_nexus_states && p.additional_nexus_states.length > 0 && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ia-muted">Nexus states</dt>
                      <dd className="text-ia-navy text-right">{p.additional_nexus_states.join(', ')}</dd>
                    </div>
                  )}
                  {p.sales_tax_collected_states && p.sales_tax_collected_states.length > 0 && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ia-muted">Sales tax states</dt>
                      <dd className="text-ia-navy text-right">{p.sales_tax_collected_states.join(', ')}</dd>
                    </div>
                  )}
                  {p.tax_year_in_progress && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ia-muted">Tax year</dt>
                      <dd className="text-ia-navy text-right">{p.tax_year_in_progress}</dd>
                    </div>
                  )}
                  {p.estimated_payments_required && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ia-muted">Estimated payments</dt>
                      <dd className="text-amber-700 text-right">Required ({p.estimated_payment_basis ?? '—'})</dd>
                    </div>
                  )}
                </dl>

                {(p.preparer_name || p.preparer_firm) && (
                  <div className="mt-3 pt-3 border-t border-ia-border">
                    <div className="text-[10px] uppercase font-medium text-ia-muted mb-1">Preparer</div>
                    <div className="text-xs text-ia-navy inline-flex items-center gap-1">
                      <User size={11} className="text-ia-muted" />
                      {p.preparer_name ?? '—'}
                      {p.preparer_firm && <span className="text-ia-muted"> · {p.preparer_firm}</span>}
                    </div>
                    {p.preparer_email && (
                      <a href={`mailto:${p.preparer_email}`} className="text-xs text-ia-teal hover:underline block mt-0.5">
                        {p.preparer_email}
                      </a>
                    )}
                  </div>
                )}

                {p.notes && (
                  <div className="text-xs italic text-ia-muted bg-ia-cream/50 rounded p-2 mt-3">
                    {truncate(p.notes, 200)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

function ObligationRow({ obl, expanded, onToggle, payments, pastDue }) {
  return (
    <div className="ia-card">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="mt-0.5">
              {expanded ? <ChevronDown size={14} className="text-ia-muted" /> : <ChevronRight size={14} className="text-ia-muted" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-ia-navy">{obl.filing_type}</span>
                <span className="text-xs text-ia-muted">{obl.jurisdiction}</span>
                <span className={cn(STATUS_PILL[obl.status] ?? 'ia-pill-muted', 'text-[10px]')}>
                  {obl.status}
                </span>
                {obl.extension_filed && <span className="ia-pill-warning text-[10px]">extension</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-ia-muted">
                <span className="inline-flex items-center gap-1">
                  <Building2 size={11} /> {obl.entity_short_name ?? `entity #${obl.entity_id}`}
                </span>
                <span>{obl.period_covered}</span>
              </div>
            </div>
          </div>
          <div className="text-right whitespace-nowrap">
            <div className={cn('text-sm', urgencyClass(obl.days_until_due))}>
              {fmtDate(obl.due_date)}
            </div>
            <div className={cn('text-xs', urgencyClass(obl.days_until_due))}>
              {daysUntilLabel(obl.days_until_due)}
            </div>
            {obl.amount_outstanding_est > 0 && (
              <div className="text-xs text-ia-navy font-medium mt-0.5">
                {fmtCurrency(obl.amount_outstanding_est)}
              </div>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-ia-border space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div className="text-ia-muted">Est. due</div>
            <div className="text-right">{fmtCurrency(obl.amount_due_est ?? 0)}</div>
            <div className="text-ia-muted">Paid</div>
            <div className="text-right">{fmtCurrency(obl.amount_paid ?? 0)}</div>
            <div className="text-ia-muted font-medium">Outstanding</div>
            <div className="text-right font-medium">{fmtCurrency(obl.amount_outstanding_est ?? 0)}</div>
            {obl.extension_until && (
              <>
                <div className="text-ia-muted">Extended until</div>
                <div className="text-right">{fmtDate(obl.extension_until)}</div>
              </>
            )}
            {obl.preparer_name && (
              <>
                <div className="text-ia-muted">Preparer</div>
                <div className="text-right">{obl.preparer_name}</div>
              </>
            )}
          </div>

          {payments.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase font-medium text-ia-muted mb-1">Linked payments</div>
              <div className="space-y-1">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs border-b border-ia-border last:border-0 pb-1 last:pb-0">
                    <span className="inline-flex items-center gap-2">
                      <Clock size={10} className="text-ia-muted" />
                      {fmtDate(p.payment_date)}
                      <span className="ia-pill-muted text-[10px]">{PAYMENT_TYPE_LABEL[p.payment_type] ?? p.payment_type}</span>
                      {p.payment_method && <span className="text-ia-muted">{p.payment_method}</span>}
                    </span>
                    <span className="font-medium text-ia-navy">{fmtCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pastDue && (
            <div className="text-xs text-red-700 bg-red-50 rounded p-2 inline-flex items-start gap-1">
              <AlertTriangle size={11} className="mt-0.5" />
              <span>Past due. Contact your preparer or jurisdiction portal.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
