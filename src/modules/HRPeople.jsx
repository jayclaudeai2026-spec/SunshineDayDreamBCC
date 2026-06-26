import { useMemo, useState } from 'react';
import {
  Users, Briefcase, Calendar, FileText, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, RefreshCw, AlertCircle, CheckCircle2, Mail, Phone,
  Edit2, Save, X, Building2, UserPlus, MapPin, Search, ArrowUpDown, DollarSign,
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
  const middle = emp.middle_initial && !emp.preferred_name ? ` ${emp.middle_initial}.` : '';
  const last = emp.last_name || '';
  return `${first}${middle} ${last}`.trim() || `Employee #${emp.id}`;
}

// ───────────────────────────────────────────────────────────────
// ByEntityPayrollRollup — H1 2026 payroll totals grouped by entity.
// Click a card to filter the roster to that entity.
// ───────────────────────────────────────────────────────────────
function ByEntityPayrollRollup({ payroll, onEntityClick, activeEntityFilter }) {
  const byEntity = useMemo(() => {
    const m = new Map();
    for (const p of payroll) {
      const eid = p.entity_id;
      if (eid == null) continue;
      if (!m.has(eid)) {
        m.set(eid, {
          entity_id: eid,
          entity_short_name: p.entities?.entity_short_name ?? `entity#${eid}`,
          gross_pay: 0,
          total_taxes: 0,
          total_deductions: 0,
          net_pay: 0,
          employee_ids: new Set(),
        });
      }
      const row = m.get(eid);
      row.gross_pay += Number(p.gross_pay ?? 0);
      row.total_taxes += Number(p.total_taxes ?? 0);
      row.total_deductions += Number(p.total_deductions ?? 0);
      row.net_pay += Number(p.net_pay ?? 0);
      row.employee_ids.add(p.employee_id);
    }
    return Array.from(m.values())
      .map((r) => ({ ...r, employee_count: r.employee_ids.size }))
      .sort((a, b) => b.gross_pay - a.gross_pay);
  }, [payroll]);

  const aggregate = useMemo(() => {
    return byEntity.reduce(
      (acc, r) => ({
        gross_pay: acc.gross_pay + r.gross_pay,
        net_pay: acc.net_pay + r.net_pay,
        total_taxes: acc.total_taxes + r.total_taxes,
        total_deductions: acc.total_deductions + r.total_deductions,
      }),
      { gross_pay: 0, net_pay: 0, total_taxes: 0, total_deductions: 0 }
    );
  }, [byEntity]);

  if (byEntity.length === 0) return null;

  return (
    <div className="ia-card">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="text-[10px] uppercase font-medium text-ia-muted inline-flex items-center gap-1">
          <Building2 size={11} /> H1 2026 payroll by entity
        </div>
        <div className="text-[10px] text-ia-muted">
          Total gross <span className="text-ia-navy font-medium">{fmtCurrency(aggregate.gross_pay)}</span>
          {' · '}Net <span className="text-ia-navy font-medium">{fmtCurrency(aggregate.net_pay)}</span>
          {activeEntityFilter != null && (
            <button
              onClick={() => onEntityClick(null)}
              className="ml-2 inline-flex items-center gap-1 text-ia-teal hover:text-ia-navy"
            >
              <X size={10} /> Clear filter
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {byEntity.map((r) => {
          const isActive = activeEntityFilter === r.entity_id;
          return (
            <button
              key={r.entity_id}
              onClick={() => onEntityClick(isActive ? null : r.entity_id)}
              className={cn(
                'text-left p-2.5 rounded border transition-colors',
                isActive
                  ? 'border-ia-teal bg-ia-teal/5 ring-1 ring-ia-teal/30'
                  : 'border-ia-border hover:border-ia-teal/50 bg-ia-cream/30'
              )}
            >
              <div className="text-xs font-medium text-ia-navy mb-1 flex items-center justify-between">
                <span className="truncate">{r.entity_short_name}</span>
                <span className="text-[10px] text-ia-muted ml-1 shrink-0">{r.employee_count} ppl</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-ia-muted">
                <span>Gross</span><span className="text-right text-ia-navy">{fmtCurrency(r.gross_pay)}</span>
                <span>Taxes</span><span className="text-right">{fmtCurrency(r.total_taxes)}</span>
                <span>Deductions</span><span className="text-right">{fmtCurrency(r.total_deductions)}</span>
                <span className="pt-0.5 mt-0.5 border-t border-ia-border/50">Net</span>
                <span className="text-right text-ia-navy font-medium pt-0.5 mt-0.5 border-t border-ia-border/50">{fmtCurrency(r.net_pay)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// EmployeeProfileEditor — quick-edit panel for profile fields.
// Compact trigger when collapsed: warning pill if fields are missing,
// muted "Edit profile" link if all populated.
// ───────────────────────────────────────────────────────────────
function EmployeeProfileEditor({ employee, onSaved }) {
  const addr = employee.address ?? {};
  const ec = employee.emergency_contact ?? {};
  const addrEmpty = !addr || Object.keys(addr).length === 0 || (!addr.street && !addr.city && !addr.state && !addr.zip);
  const ecEmpty = !ec || Object.keys(ec).length === 0 || (!ec.name && !ec.phone);

  const missing = [];
  if (!employee.role_title) missing.push('role_title');
  if (!employee.email) missing.push('email');
  if (!employee.phone) missing.push('phone');
  if (!employee.hire_date) missing.push('hire_date');
  if (!employee.ssn_last4) missing.push('ssn_last4');
  if (addrEmpty) missing.push('address');
  if (ecEmpty) missing.push('emergency_contact');

  const [isOpen, setIsOpen] = useState(false);
  const [v, setV] = useState({
    role_title: employee.role_title ?? '',
    email: employee.email ?? '',
    phone: employee.phone ?? '',
    hire_date: employee.hire_date ?? '',
    ssn_last4: employee.ssn_last4 ?? '',
    address_street: addr.street ?? '',
    address_city: addr.city ?? '',
    address_state: addr.state ?? '',
    address_zip: addr.zip ?? '',
    emergency_name: ec.name ?? '',
    emergency_phone: ec.phone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    const update = {};
    if (v.role_title && v.role_title !== (employee.role_title ?? '')) update.role_title = v.role_title;
    if (v.email && v.email !== (employee.email ?? '')) update.email = v.email;
    if (v.phone && v.phone !== (employee.phone ?? '')) update.phone = v.phone;
    if (v.hire_date && v.hire_date !== (employee.hire_date ?? '')) update.hire_date = v.hire_date;
    if (v.ssn_last4 && v.ssn_last4 !== (employee.ssn_last4 ?? '')) {
      const cleaned = String(v.ssn_last4).replace(/[^0-9]/g, '').slice(0, 4);
      if (cleaned.length === 4) update.ssn_last4 = cleaned;
    }
    const newAddr = {
      street: v.address_street || addr.street,
      city: v.address_city || addr.city,
      state: v.address_state || addr.state,
      zip: v.address_zip || addr.zip,
    };
    const cleanedAddr = Object.fromEntries(Object.entries(newAddr).filter(([, val]) => val));
    if (Object.keys(cleanedAddr).length > 0 && JSON.stringify(cleanedAddr) !== JSON.stringify(addr)) {
      update.address = cleanedAddr;
    }
    const newEc = {
      name: v.emergency_name || ec.name,
      phone: v.emergency_phone || ec.phone,
    };
    const cleanedEc = Object.fromEntries(Object.entries(newEc).filter(([, val]) => val));
    if (Object.keys(cleanedEc).length > 0 && JSON.stringify(cleanedEc) !== JSON.stringify(ec)) {
      update.emergency_contact = cleanedEc;
    }
    if (Object.keys(update).length === 0) {
      setSaving(false);
      setIsOpen(false);
      return;
    }
    const { error: err } = await supabase.from('employees').update(update).eq('id', employee.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setIsOpen(false);
    onSaved && onSaved();
  };

  if (!isOpen) {
    return missing.length > 0 ? (
      <button
        onClick={() => setIsOpen(true)}
        className="ia-pill-warning inline-flex items-center gap-1 text-[10px] hover:opacity-80"
      >
        <UserPlus size={10} /> Complete profile ({missing.length} missing)
      </button>
    ) : (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] text-ia-muted hover:text-ia-teal"
      >
        <Edit2 size={10} /> Edit profile
      </button>
    );
  }

  const inputCls = 'w-full text-xs px-2 py-1 border border-ia-border rounded bg-white focus:outline-none focus:border-ia-teal';
  const labelCls = 'text-[10px] uppercase text-ia-muted font-medium mb-0.5';

  return (
    <div className="mt-2 p-3 bg-ia-cream/30 rounded border border-ia-border">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-ia-navy inline-flex items-center gap-1">
          <Edit2 size={11} /> Edit profile
        </div>
        <button onClick={() => { setIsOpen(false); setError(null); }} className="text-ia-muted hover:text-ia-navy">
          <X size={12} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <div className={labelCls}>Role title</div>
          <input type="text" className={inputCls} value={v.role_title} onChange={(e) => setV({ ...v, role_title: e.target.value })} placeholder="e.g. Store Manager" />
        </div>
        <div>
          <div className={labelCls}>Hire date</div>
          <input type="date" className={inputCls} value={v.hire_date} onChange={(e) => setV({ ...v, hire_date: e.target.value })} />
        </div>
        <div>
          <div className={labelCls}>Email</div>
          <input type="email" className={inputCls} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="name@example.com" />
        </div>
        <div>
          <div className={labelCls}>Phone</div>
          <input type="tel" className={inputCls} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="(555) 123-4567" />
        </div>
        <div>
          <div className={labelCls}>SSN last 4</div>
          <input type="text" maxLength={4} className={inputCls} value={v.ssn_last4} onChange={(e) => setV({ ...v, ssn_last4: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} placeholder="0000" />
        </div>
        <div></div>
        <div className="sm:col-span-2 mt-1">
          <div className={cn(labelCls, 'inline-flex items-center gap-1')}><MapPin size={10}/> Address</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-1">
            <input type="text" className={cn(inputCls, 'sm:col-span-2')} value={v.address_street} onChange={(e) => setV({ ...v, address_street: e.target.value })} placeholder="Street" />
            <input type="text" className={inputCls} value={v.address_city} onChange={(e) => setV({ ...v, address_city: e.target.value })} placeholder="City" />
            <div className="flex gap-1">
              <input type="text" className={cn(inputCls, 'flex-1')} maxLength={2} value={v.address_state} onChange={(e) => setV({ ...v, address_state: e.target.value.toUpperCase().slice(0,2) })} placeholder="ST" />
              <input type="text" className={cn(inputCls, 'flex-1')} maxLength={10} value={v.address_zip} onChange={(e) => setV({ ...v, address_zip: e.target.value })} placeholder="ZIP" />
            </div>
          </div>
        </div>
        <div className="sm:col-span-2 mt-1">
          <div className={labelCls}>Emergency contact</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" className={inputCls} value={v.emergency_name} onChange={(e) => setV({ ...v, emergency_name: e.target.value })} placeholder="Name" />
            <input type="tel" className={inputCls} value={v.emergency_phone} onChange={(e) => setV({ ...v, emergency_phone: e.target.value })} placeholder="Phone" />
          </div>
        </div>
      </div>
      {error && (
        <div className="mt-2 text-[11px] text-red-700 bg-red-50 rounded p-1.5">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={() => { setIsOpen(false); setError(null); }}
          className="ia-button-ghost text-xs"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1 bg-ia-teal text-white text-xs rounded hover:opacity-90 disabled:opacity-50"
        >
          <Save size={11} /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}


// ───────────────────────────────────────────────────────────────
// EmployeePayrollDetail — per-entity payroll breakdown pulled from
// payroll_history. One row per (employee, entity) pair, plus a total
// row when the employee has multiple entity assignments.
// ───────────────────────────────────────────────────────────────
function EmployeePayrollDetail({ employee, payroll }) {
  const empPayroll = payroll.filter((p) => p.employee_id === employee.id);
  if (empPayroll.length === 0) return null;

  const totals = empPayroll.reduce(
    (acc, p) => ({
      gross: acc.gross + Number(p.gross_pay ?? 0),
      fed: acc.fed + Number(p.federal_withholding ?? 0),
      state: acc.state + Number(p.state_withholding ?? 0),
      fica: acc.fica + Number(p.fica_employee ?? 0),
      medicare: acc.medicare + Number(p.medicare_employee ?? 0),
      suta: acc.suta + Number(p.suta ?? 0),
      futa: acc.futa + Number(p.futa ?? 0),
      fica_employer: acc.fica_employer + Number(p.fica_employer ?? 0),
      medicare_employer: acc.medicare_employer + Number(p.medicare_employer ?? 0),
      health: acc.health + Number(p.health_insurance ?? 0),
      retirement_emp: acc.retirement_emp + Number(p.retirement_employee ?? 0),
      retirement_er: acc.retirement_er + Number(p.retirement_employer ?? 0),
      other_ded: acc.other_ded + Number(p.other_deductions ?? 0),
      net: acc.net + Number(p.net_pay ?? 0),
    }),
    { gross: 0, fed: 0, state: 0, fica: 0, medicare: 0, suta: 0, futa: 0, fica_employer: 0, medicare_employer: 0, health: 0, retirement_emp: 0, retirement_er: 0, other_ded: 0, net: 0 }
  );

  const employerSideTotal = totals.fica_employer + totals.medicare_employer + totals.futa + totals.suta;

  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase font-medium text-ia-muted mb-1 inline-flex items-center gap-1">
        <DollarSign size={10} /> Payroll detail · H1 2026 · {empPayroll.length} {empPayroll.length === 1 ? 'entity' : 'entities'}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-ia-muted">
            <tr className="border-b border-ia-border">
              <th className="font-medium py-1 pr-2 text-left">Entity</th>
              <th className="font-medium py-1 px-1 text-right">Gross</th>
              <th className="font-medium py-1 px-1 text-right">Fed</th>
              <th className="font-medium py-1 px-1 text-right">State</th>
              <th className="font-medium py-1 px-1 text-right">FICA+Med</th>
              <th className="font-medium py-1 px-1 text-right">Other</th>
              <th className="font-medium py-1 pl-1 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {empPayroll.map((p) => {
              const ficaMed = Number(p.fica_employee ?? 0) + Number(p.medicare_employee ?? 0);
              const other = Number(p.health_insurance ?? 0) + Number(p.retirement_employee ?? 0) + Number(p.other_deductions ?? 0);
              return (
                <tr key={p.id} className="border-b border-ia-border/40 last:border-0">
                  <td className="py-1 pr-2 text-ia-navy text-xs">{p.entities?.entity_short_name ?? `#${p.entity_id}`}</td>
                  <td className="py-1 px-1 text-right text-ia-navy">{fmtCurrency(p.gross_pay)}</td>
                  <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(p.federal_withholding)}</td>
                  <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(p.state_withholding)}</td>
                  <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(ficaMed)}</td>
                  <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(other)}</td>
                  <td className="py-1 pl-1 text-right font-medium text-ia-navy">{fmtCurrency(p.net_pay)}</td>
                </tr>
              );
            })}
            {empPayroll.length > 1 && (
              <tr className="border-t border-ia-border font-medium bg-ia-cream/40">
                <td className="py-1 pr-2 text-ia-navy">Total</td>
                <td className="py-1 px-1 text-right text-ia-navy">{fmtCurrency(totals.gross)}</td>
                <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(totals.fed)}</td>
                <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(totals.state)}</td>
                <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(totals.fica + totals.medicare)}</td>
                <td className="py-1 px-1 text-right text-ia-muted">{fmtCurrency(totals.health + totals.retirement_emp + totals.other_ded)}</td>
                <td className="py-1 pl-1 text-right text-ia-navy">{fmtCurrency(totals.net)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {employerSideTotal > 0 && (
        <div className="text-[10px] text-ia-muted mt-1.5 italic">
          Employer-side cost: FICA {fmtCurrency(totals.fica_employer)} · Medicare {fmtCurrency(totals.medicare_employer)} · FUTA {fmtCurrency(totals.futa)} · SUTA {fmtCurrency(totals.suta)} = {fmtCurrency(employerSideTotal)} total
        </div>
      )}
    </div>
  );
}

export default function HRPeople() {
  const [activeTab, setActiveTab] = useState('roster');
  const [activeStatus, setActiveStatus] = useState('active');
  const [activeEntityFilter, setActiveEntityFilter] = useState(null);
  const [activeEmployeeType, setActiveEmployeeType] = useState(null);
  const [sortBy, setSortBy] = useState('entity');
  const [searchQuery, setSearchQuery] = useState('');
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

  // employee_id -> Set(entity_ids) for filtering
  const empToEntities = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!m.has(a.employee_id)) m.set(a.employee_id, new Set());
      m.get(a.employee_id).add(a.entity_id);
    }
    return m;
  }, [assignments]);

  // employee_id -> primary entity assignment (with embedded entities relation)
  const primaryAssignmentByEmp = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      const existing = m.get(a.employee_id);
      if (!existing) m.set(a.employee_id, a);
      else if (a.is_primary && !existing.is_primary) m.set(a.employee_id, a);
      else if (!existing.is_primary && a.entity_id < existing.entity_id) m.set(a.employee_id, a);
    }
    return m;
  }, [assignments]);

  // employee_id -> sum of H1 2026 gross pay
  const grossByEmp = useMemo(() => {
    const m = new Map();
    for (const p of payroll) {
      m.set(p.employee_id, (m.get(p.employee_id) ?? 0) + Number(p.gross_pay ?? 0));
    }
    return m;
  }, [payroll]);

  // Employee types present (for filter pills)
  const employeeTypes = useMemo(() => {
    const set = new Set(employees.map((e) => e.employee_type).filter(Boolean));
    return Array.from(set);
  }, [employees]);
  const employeeTypeCounts = useMemo(() => {
    const c = {};
    for (const e of employees) c[e.employee_type] = (c[e.employee_type] ?? 0) + 1;
    return c;
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    let out = employees;
    if (activeStatus) out = out.filter((e) => e.status === activeStatus);
    if (activeEntityFilter != null) {
      out = out.filter((e) => empToEntities.get(e.id)?.has(activeEntityFilter));
    }
    if (activeEmployeeType) {
      out = out.filter((e) => e.employee_type === activeEmployeeType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter((e) => {
        const name = `${e.preferred_name || ''} ${e.first_name || ''} ${e.last_name || ''}`.toLowerCase();
        const title = (e.role_title || '').toLowerCase();
        const email = (e.email || '').toLowerCase();
        return name.includes(q) || title.includes(q) || email.includes(q);
      });
    }
    const sorted = [...out];
    if (sortBy === 'entity') {
      sorted.sort((a, b) => {
        const ea = primaryAssignmentByEmp.get(a.id);
        const eb = primaryAssignmentByEmp.get(b.id);
        const na = ea?.entities?.entity_short_name ?? 'zzz_unassigned';
        const nb = eb?.entities?.entity_short_name ?? 'zzz_unassigned';
        if (na !== nb) return na.localeCompare(nb);
        return (a.last_name || '').localeCompare(b.last_name || '');
      });
    } else if (sortBy === 'name_asc') {
      sorted.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || ''));
    } else if (sortBy === 'hire_desc' || sortBy === 'hire_asc') {
      sorted.sort((a, b) => {
        const da = a.hire_date || '';
        const db = b.hire_date || '';
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return sortBy === 'hire_desc' ? db.localeCompare(da) : da.localeCompare(db);
      });
    } else if (sortBy === 'gross_desc') {
      sorted.sort((a, b) => (grossByEmp.get(b.id) ?? 0) - (grossByEmp.get(a.id) ?? 0));
    }
    return sorted;
  }, [employees, activeStatus, activeEntityFilter, activeEmployeeType, searchQuery, sortBy, empToEntities, primaryAssignmentByEmp, grossByEmp]);

  // Grouped view when sortBy === 'entity'
  const employeeGroups = useMemo(() => {
    if (sortBy !== 'entity') return null;
    const groups = [];
    let currentKey = null;
    for (const e of filteredEmployees) {
      const pa = primaryAssignmentByEmp.get(e.id);
      const key = pa?.entities?.entity_short_name ?? '(unassigned)';
      if (currentKey !== key) {
        groups.push({ entity: key, employees: [] });
        currentKey = key;
      }
      groups[groups.length - 1].employees.push(e);
    }
    return groups;
  }, [filteredEmployees, sortBy, primaryAssignmentByEmp]);

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

  const renderEmployeeCard = (emp) => {
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

                      <EmployeePayrollDetail employee={emp} payroll={payroll} />

                      <EmployeeProfileEditor employee={emp} onSaved={refetchAll} />
                    </div>
                  )}
                </div>
              );
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

      {/* By-entity payroll rollup */}
      {!loading && payroll.length > 0 && (
        <ByEntityPayrollRollup
          payroll={payroll}
          activeEntityFilter={activeEntityFilter}
          onEntityClick={(eid) => { setActiveEntityFilter(eid); setActiveTab('roster'); setExpandedEmpId(null); }}
        />
      )}

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

          {/* Employee type filter pills */}
          {employeeTypes.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ia-muted uppercase mr-1">Type</span>
              <FilterPill label="All" active={!activeEmployeeType} onClick={() => setActiveEmployeeType(null)} count={employees.length} />
              {employeeTypes.map((t) => (
                <FilterPill
                  key={t}
                  label={EMPLOYEE_TYPE_LABEL[t] ?? t.replace('_', ' ')}
                  active={activeEmployeeType === t}
                  onClick={() => setActiveEmployeeType(t)}
                  count={employeeTypeCounts[t]}
                />
              ))}
            </div>
          )}

          {/* Search + Sort row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ia-muted pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, title, or email..."
                className="w-full text-xs pl-7 pr-7 py-1.5 border border-ia-border rounded bg-white focus:outline-none focus:border-ia-teal"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ia-muted hover:text-ia-navy" aria-label="Clear search">
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="inline-flex items-center gap-1.5">
              <ArrowUpDown size={12} className="text-ia-muted" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="text-xs px-2 py-1.5 border border-ia-border rounded bg-white focus:outline-none focus:border-ia-teal"
              >
                <option value="entity">Sort: Primary entity</option>
                <option value="name_asc">Sort: Name (A–Z)</option>
                <option value="hire_desc">Sort: Hire date (newest)</option>
                <option value="hire_asc">Sort: Hire date (oldest)</option>
                <option value="gross_desc">Sort: H1 2026 gross (high → low)</option>
              </select>
            </div>
            {(searchQuery || activeEmployeeType || activeEntityFilter != null) && (
              <span className="text-[11px] text-ia-muted">
                {filteredEmployees.length} of {employees.length} shown
              </span>
            )}
          </div>

          {/* Roster — grouped by entity when sortBy='entity', otherwise flat grid */}
          {employeeGroups ? (
            employeeGroups.length === 0 ? (
              <EmptyState title="No matches" description="Try clearing filters or adjusting the search query." />
            ) : (
              <div className="space-y-4">
                {employeeGroups.map((g) => (
                  <div key={g.entity}>
                    <div className="text-[10px] uppercase font-medium text-ia-muted mb-1.5 inline-flex items-center gap-1">
                      <Building2 size={10} /> {g.entity}
                      <span className="text-ia-muted/70">· {g.employees.length}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {g.employees.map((emp) => renderEmployeeCard(emp))}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : filteredEmployees.length === 0 ? (
            <EmptyState title="No matches" description="Try clearing filters or adjusting the search query." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredEmployees.map((emp) => renderEmployeeCard(emp))}
            </div>
          )}
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
