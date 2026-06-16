import { useMemo, useState } from 'react';
import {
  Users, Briefcase, Calendar, FileText, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, RefreshCw, AlertCircle, CheckCircle2, Mail, Phone,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { useSupabaseQuery } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';
import { fmtCurrency, fmtRelative, fmtDate, cn, truncate } from '../lib/utils.js';

const TABS = [
  { key: 'roster',  label: 'Roster' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'timeoff', label: 'Time off' },
  { key: 'notes',   label: 'Notes' },
];

const EMPLOYEE_TYPE_LABEL = {
  w2_employee:     'W-2',
  contractor_1099: '1099',
  owner:           'Owner',
  family_member:   'Family',
};

const STATUS_PILL = {
  active:     'ia-pill-success',
  on_leave:   'ia-pill-warning',
  terminated: 'ia-pill-muted',
  rehired:    'ia-pill-success',
};

const TIME_OFF_LABEL = {
  pto:         'PTO',
  sick:        'Sick',
  holiday:     'Holiday',
  unpaid:      'Unpaid',
  bereavement: 'Bereavement',
  jury_duty:   'Jury duty',
  fmla:        'FMLA',
};

const NOTE_CATEGORY_STYLE = {
  positive:   { pill: 'ia-pill-success', icon: CheckCircle2 },
  concern:    { pill: 'ia-pill-warning',    icon: AlertCircle },
  review:     { pill: 'ia-pill-muted', icon: FileText },
  corrective: { pill: 'ia-pill-danger',  icon: AlertCircle },
  milestone:  { pill: 'ia-pill-success',  icon: TrendingUp },
  training:   { pill: 'ia-pill-muted', icon: Briefcase },
};

function fullName(emp) {
  const first = emp.preferred_name || emp.first_name || '';
  const last = emp.last_name || '';
  return `${first} ${last}`.trim() || `Employee #${emp.id}`;
}

export default function HRPeople() {
  const [activeTab, setActiveTab] = useState('roster');
  const [activeStatus, setActiveStatus] = useState('active');
  const [expandedEmpId, setExpandedEmpId] = useState(null);

  const employeesQ = useSupabaseQuery(
    () => supabase
      .from('employees')
      .select('*')
      .order('status', { ascending: true })
      .order('last_name', { ascending: true }),
    [],
  );

  const assignmentsQ = useSupabaseQuery(
    () => supabase
      .from('employee_entity_assignments')
      .select('*, entities(entity_short_name, legal_name)')
      .is('end_date', null),
    [],
  );

  const payrollQ = useSupabaseQuery(
    () => supabase
      .from('payroll_history')
      .select('*, employees(first_name, last_name, preferred_name), entities(entity_short_name)')
      .order('pay_date', { ascending: false })
      .limit(150),
    [],
  );

  const timeOffQ = useSupabaseQuery(
    () => supabase
      .from('time_off_balances')
      .select('*, employees(first_name, last_name, preferred_name, status)')
      .order('employee_id', { ascending: true })
      .order('accrual_type', { ascending: true }),
    [],
  );

  const notesQ = useSupabaseQuery(
    () => supabase
      .from('performance_notes')
      .select('*, employees(first_name, last_name, preferred_name)')
      .order('note_date', { ascending: false })
      .limit(100),
    [],
  );

  const employees = employeesQ.data ?? [];
  const assignments = assignmentsQ.data ?? [];
  const payroll = payrollQ.data ?? [];
  const timeOff = timeOffQ.data ?? [];
  const notes = notesQ.data ?? [];

  const loading = employeesQ.loading || assignmentsQ.loading || payrollQ.loading;

  const refetchAll = () => {
    employeesQ.refetch();
    assignmentsQ.refetch();
    payrollQ.refetch();
    timeOffQ.refetch();
    notesQ.refetch();
  };

  // Map employee_id -> [assignments]
  const assignmentsByEmp = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!m.has(a.employee_id)) m.set(a.employee_id, []);
      m.get(a.employee_id).push(a);
    }
    return m;
  }, [assignments]);

  // Map employee_id -> [time_off_balances]
  const timeOffByEmp = useMemo(() => {
    const m = new Map();
    for (const t of timeOff) {
      if (!m.has(t.employee_id)) m.set(t.employee_id, []);
      m.get(t.employee_id).push(t);
    }
    return m;
  }, [timeOff]);

  // Status filter
  const statuses = useMemo(() => {
    const set = new Set(employees.map((e) => e.status));
    return Array.from(set);
  }, [employees]);

  const statusCounts = useMemo(() => {
    const c = {};
    for (const e of employees) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!activeStatus) return employees;
    return employees.filter((e) => e.status === activeStatus);
  }, [employees, activeStatus]);

  // Solo-operator detection: zero employees OR only owners/family with no W-2/1099 reports
  const isSoloOperator = useMemo(() => {
    if (employees.length === 0) return true;
    const realStaff = employees.filter((e) =>
      e.status === 'active' && (e.employee_type === 'w2_employee' || e.employee_type === 'contractor_1099')
    );
    return realStaff.length === 0;
  }, [employees]);

  // Payroll totals (last 90 days)
  const payrollTotals = useMemo(() => {
    const total = payroll.reduce((sum, p) => sum + Number(p.gross_pay ?? 0), 0);
    const netTotal = payroll.reduce((sum, p) => sum + Number(p.net_pay ?? 0), 0);
    return { gross: total, net: netTotal, count: payroll.length };
  }, [payroll]);

  const counts = {
    roster:  filteredEmployees.length,
    payroll: payroll.length,
    timeoff: timeOff.length,
    notes:   notes.length,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>People &amp; HR</h1>
          <p className="text-sm text-ia-muted mt-1">
            Roster, payroll history, time-off balances, and performance notes. SSN stored as
            last-4 only; full SSN stays in your payroll provider.
          </p>
        </div>
        <button className="ia-button-ghost" onClick={refetchAll} aria-label="Refresh">
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-ia-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setExpandedEmpId(null); }}
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

      {loading && <LoadingState label="Loading people data..." />}

      {/* Solo-operator empty state on Roster */}
      {activeTab === 'roster' && !loading && isSoloOperator && employees.length === 0 && (
        <EmptyState
          title="Just you for now"
          description="Add team members in Supabase Studio (public.employees) when you hire. Owners and family members can be tracked here too."
        />
      )}

      {/* ROSTER TAB */}
      {activeTab === 'roster' && !loading && employees.length > 0 && (
        <>
          {/* Status filter pills */}
          {statuses.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ia-muted uppercase mr-1">Status</span>
              <FilterPill label="All" active={!activeStatus} onClick={() => setActiveStatus(null)} count={employees.length} />
              {statuses.map((s) => (
                <FilterPill
                  key={s}
                  label={s.replace('_', ' ')}
                  active={activeStatus === s}
                  onClick={() => setActiveStatus(s)}
                  count={statusCounts[s]}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredEmployees.map((emp) => {
              const empAssignments = assignmentsByEmp.get(emp.id) ?? [];
              const empTimeOff = timeOffByEmp.get(emp.id) ?? [];
              const expanded = expandedEmpId === emp.id;
              return (
                <div key={emp.id} className="ia-card">
                  <button
                    onClick={() => setExpandedEmpId(expanded ? null : emp.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5">
                          {expanded ? <ChevronDown size={14} className="text-ia-muted" /> : <ChevronRight size={14} className="text-ia-muted" />}
                        </div>
                        <div>
                          <div className="font-medium text-ia-navy">{fullName(emp)}</div>
                          <div className="text-xs text-ia-muted">
                            {emp.role_title ?? <span className="italic">no title</span>}
                            {emp.hire_date && <span> · hired {fmtDate(emp.hire_date)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn(STATUS_PILL[emp.status] ?? 'ia-pill-muted', 'text-[10px]')}>
                          {emp.status.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-ia-muted">{EMPLOYEE_TYPE_LABEL[emp.employee_type] ?? emp.employee_type}</span>
                      </div>
                    </div>
                    {empAssignments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {empAssignments.map((a) => (
                          <span key={a.id} className="text-[10px] bg-ia-cream-dark text-ia-navy px-1.5 py-0.5 rounded">
                            {a.entities?.entity_short_name ?? `entity#${a.entity_id}`}
                            {Number(a.allocation_pct) < 100 && ` ${a.allocation_pct}%`}
                            {a.is_primary && ' ★'}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>

                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-ia-border space-y-2 text-sm">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {emp.email && (
                          <div className="inline-flex items-center gap-1 text-ia-muted">
                            <Mail size={11} /> <a href={`mailto:${emp.email}`} className="hover:text-ia-teal">{emp.email}</a>
                          </div>
                        )}
                        {emp.phone && (
                          <div className="inline-flex items-center gap-1 text-ia-muted">
                            <Phone size={11} /> {emp.phone}
                          </div>
                        )}
                        {emp.date_of_birth && (
                          <div className="text-ia-muted">DOB: {fmtDate(emp.date_of_birth)}</div>
                        )}
                        {emp.ssn_last4 && (
                          <div className="text-ia-muted">SSN: •••-••-{emp.ssn_last4}</div>
                        )}
                        {emp.termination_date && (
                          <div className="text-ia-muted col-span-2">Terminated {fmtDate(emp.termination_date)}</div>
                        )}
                      </div>

                      {empTimeOff.length > 0 && (
                        <div className="mt-2">
                          <div className="text-[10px] uppercase font-medium text-ia-muted mb-1">Time off balances</div>
                          <div className="flex flex-wrap gap-2">
                            {empTimeOff.map((t) => (
                              <span key={t.id} className="text-xs bg-ia-cream-dark text-ia-navy px-2 py-0.5 rounded">
                                {TIME_OFF_LABEL[t.accrual_type] ?? t.accrual_type}: <span className="font-medium">{Number(t.available_hours ?? 0).toFixed(1)}h</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {emp.notes && (
                        <div className="text-xs italic text-ia-muted bg-ia-cream/50 rounded p-2">
                          {emp.notes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* PAYROLL TAB */}
      {activeTab === 'payroll' && !loading && (
        payroll.length === 0 ? (
          <EmptyState
            title="No payroll history yet"
            description="Payroll runs flow in from your provider (Gusto, ADP, Paychex, QBO Payroll) via the Payroll Ingest recipe."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="ia-card">
                <div className="text-[10px] uppercase font-medium text-ia-muted">Gross (recent)</div>
                <div className="text-2xl font-semibold text-ia-navy mt-1">{fmtCurrency(payrollTotals.gross)}</div>
                <div className="text-xs text-ia-muted mt-1">across {payrollTotals.count} pay records</div>
              </div>
              <div className="ia-card">
                <div className="text-[10px] uppercase font-medium text-ia-muted">Net (recent)</div>
                <div className="text-2xl font-semibold text-ia-navy mt-1">{fmtCurrency(payrollTotals.net)}</div>
              </div>
              <div className="ia-card">
                <div className="text-[10px] uppercase font-medium text-ia-muted">Withholdings</div>
                <div className="text-2xl font-semibold text-ia-navy mt-1">{fmtCurrency(payrollTotals.gross - payrollTotals.net)}</div>
                <div className="text-xs text-ia-muted mt-1">fed + state + FICA + benefits</div>
              </div>
            </div>

            <div className="ia-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-ia-muted border-b border-ia-border">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Pay date</th>
                    <th className="pb-2 pr-3 font-medium">Employee</th>
                    <th className="pb-2 pr-3 font-medium">Entity</th>
                    <th className="pb-2 pr-3 font-medium">Period</th>
                    <th className="pb-2 pr-3 font-medium text-right">Gross</th>
                    <th className="pb-2 font-medium text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.map((p) => {
                    const emp = p.employees ?? {};
                    return (
                      <tr key={p.id} className="border-b border-ia-border last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(p.pay_date)}</td>
                        <td className="py-2 pr-3">{`${emp.preferred_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() || `#${p.employee_id}`}</td>
                        <td className="py-2 pr-3 text-ia-muted text-xs">{p.entities?.entity_short_name ?? `#${p.entity_id}`}</td>
                        <td className="py-2 pr-3 text-ia-muted text-xs whitespace-nowrap">
                          {fmtDate(p.pay_period_start)}–{fmtDate(p.pay_period_end)}
                        </td>
                        <td className="py-2 pr-3 text-right font-medium">{fmtCurrency(p.gross_pay)}</td>
                        <td className="py-2 text-right">{fmtCurrency(p.net_pay)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* TIME OFF TAB */}
      {activeTab === 'timeoff' && !loading && (
        timeOff.length === 0 ? (
          <EmptyState
            title="No time-off balances tracked"
            description="Add rows in public.time_off_balances per employee + accrual type (PTO, sick, etc)."
          />
        ) : (
          <div className="ia-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ia-muted border-b border-ia-border">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Employee</th>
                  <th className="pb-2 pr-3 font-medium">Type</th>
                  <th className="pb-2 pr-3 font-medium text-right">Accrued</th>
                  <th className="pb-2 pr-3 font-medium text-right">Used</th>
                  <th className="pb-2 pr-3 font-medium text-right">Available</th>
                  <th className="pb-2 font-medium">As of</th>
                </tr>
              </thead>
              <tbody>
                {timeOff.map((t) => {
                  const emp = t.employees ?? {};
                  const available = Number(t.available_hours ?? 0);
                  return (
                    <tr key={t.id} className="border-b border-ia-border last:border-0">
                      <td className="py-2 pr-3">{`${emp.preferred_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() || `#${t.employee_id}`}</td>
                      <td className="py-2 pr-3 text-xs">{TIME_OFF_LABEL[t.accrual_type] ?? t.accrual_type}</td>
                      <td className="py-2 pr-3 text-right">{Number(t.accrued_hours ?? 0).toFixed(1)}h</td>
                      <td className="py-2 pr-3 text-right text-ia-muted">{Number(t.used_hours ?? 0).toFixed(1)}h</td>
                      <td className={cn('py-2 pr-3 text-right font-medium',
                        available <= 0 ? 'text-red-700' : available < 8 ? 'text-amber-700' : 'text-ia-navy'
                      )}>
                        {available.toFixed(1)}h
                      </td>
                      <td className="py-2 text-xs text-ia-muted">{fmtDate(t.as_of_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* NOTES TAB */}
      {activeTab === 'notes' && !loading && (
        notes.length === 0 ? (
          <EmptyState
            title="No performance notes yet"
            description="Add notes in public.performance_notes — positive, concern, review, corrective, milestone, training."
          />
        ) : (
          <div className="space-y-3">
            {notes.map((n) => {
              const style = NOTE_CATEGORY_STYLE[n.category] ?? { pill: 'ia-pill-muted', icon: FileText };
              const Icon = style.icon;
              const emp = n.employees ?? {};
              return (
                <div key={n.id} className="ia-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <Icon size={14} className="text-ia-muted mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-ia-navy">
                            {`${emp.preferred_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() || `#${n.employee_id}`}
                          </span>
                          {n.category && (
                            <span className={cn(style.pill, 'text-[10px]')}>{n.category}</span>
                          )}
                          {n.visibility === 'private' && <span className="text-[10px] text-ia-muted">private</span>}
                          {n.visibility === 'shared_with_employee' && <span className="text-[10px] text-ia-teal">shared</span>}
                        </div>
                        <p className="text-sm text-ia-navy whitespace-pre-wrap">{n.content}</p>
                        <div className="flex gap-3 mt-1 text-[10px] text-ia-muted">
                          <span>{fmtDate(n.note_date)}</span>
                          {n.recorded_by && <span>by {n.recorded_by}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
