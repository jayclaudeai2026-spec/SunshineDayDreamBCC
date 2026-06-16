import { useMemo, useState } from 'react';
import {
  Calendar, AlertTriangle, AlertCircle, CheckCircle2, Clock,
  ChevronDown, ChevronRight, RefreshCw, FileText, MapPin, User, Building2, ExternalLink,
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

  const upcoming = upcomingQ.data ?? [];
  const filed = calendarQ.data ?? [];
  const payments = paymentsQ.data ?? [];
  const profiles = profilesQ.data ?? [];

  const loading = upcomingQ.loading || calendarQ.loading || profilesQ.loading;

  const refetchAll = () => {
    upcomingQ.refetch();
    calendarQ.refetch();
    paymentsQ.refetch();
    profilesQ.refetch();
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
    profiles: profiles.length,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Tax center</h1>
          <p className="text-sm text-ia-muted mt-1">
            Tracker — not a filer. Upcoming obligations, what's past due, what's been filed
            and paid, and per-entity profiles. Filings happen with your CPA or portal.
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

      {/* Jurisdiction filter (not on Profiles tab) */}
      {activeTab !== 'profiles' && jurisdictions.length > 1 && (
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
        applyJurisdictionFilter(filed).length === 0 ? (
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
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {applyJurisdictionFilter(filed).map((c) => (
                  <tr key={c.id} className="border-b border-ia-border last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{c.filed_date ? fmtDate(c.filed_date) : '—'}</td>
                    <td className="py-2 pr-3 text-xs">{c.entities?.entity_short_name ?? `#${c.entity_id}`}</td>
                    <td className="py-2 pr-3 text-xs">{c.jurisdiction}</td>
                    <td className="py-2 pr-3 text-xs">{c.filing_type}</td>
                    <td className="py-2 pr-3 text-xs text-ia-muted">{c.period_covered}</td>
                    <td className="py-2 pr-3 text-right">{fmtCurrency(c.amount_paid)}</td>
                    <td className="py-2">
                      <span className={cn(STATUS_PILL[c.status] ?? 'ia-pill-muted', 'text-[10px]')}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
