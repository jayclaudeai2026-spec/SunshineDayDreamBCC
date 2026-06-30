import { useMemo, useState } from 'react';
import {
  Bell, BellOff, CheckCircle2, AlertTriangle, AlertCircle, Info,
  ChevronDown, ChevronRight, RefreshCw, CheckCheck, Clock, ListChecks,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import StatCard from '../components/StatCard.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
import PrintButton from '../components/PrintButton.jsx';
import { supabase } from '../lib/supabase.js';
import { useSupabaseQuery, useAuthUser } from '../lib/hooks.js';
import { fmtRelative, fmtDate, cn, truncate, severityPillClass } from '../lib/utils.js';

const TABS = [
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'all',        label: 'All' },
  { key: 'resolved',   label: 'Resolved' },
];

const SEVERITY_ORDER = ['critical', 'error', 'warning', 'info'];

// Age buckets used by the Triage heatmap and the oldest-open list.
const AGE_BUCKETS = [
  { key: 'fresh',  label: '<24h',  maxHours:   24 },
  { key: 'week',   label: '1-7d',  maxHours:  168 },
  { key: 'month',  label: '7-30d', maxHours:  720 },
  { key: 'stale',  label: '>30d',  maxHours: Infinity },
];

function bucketForAgeHours(hours) {
  for (const b of AGE_BUCKETS) {
    if (hours < b.maxHours) return b.key;
  }
  return 'stale';
}

function severityIcon(severity) {
  switch (severity) {
    case 'critical': return AlertCircle;
    case 'error':    return AlertCircle;
    case 'warning':  return AlertTriangle;
    case 'info':     return Info;
    default:          return Bell;
  }
}

function formatAgeShort(hours) {
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export default function AlertsNotifications() {
  const [activeTab, setActiveTab] = useState('unresolved');
  const [activeSeverity, setActiveSeverity] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [bulkResolveOpen, setBulkResolveOpen] = useState(false);
  const [bulkResolveNotes, setBulkResolveNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const { user } = useAuthUser();
  const actor = user?.email ?? 'webapp';

  const { data: alerts, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('system_alerts')
      .select('*')
      .order('raised_at', { ascending: false })
      .limit(500),
    [],
  );

  // Tab buckets
  const tabbed = useMemo(() => {
    const xs = alerts ?? [];
    return {
      unresolved: xs.filter((a) => !a.resolved_at),
      resolved:   xs.filter((a) =>  a.resolved_at),
      all:        xs,
    };
  }, [alerts]);

  const currentTabRows = tabbed[activeTab] ?? [];

  const severityCounts = useMemo(() => {
    const counts = {};
    currentTabRows.forEach((a) => {
      counts[a.severity] = (counts[a.severity] ?? 0) + 1;
    });
    return counts;
  }, [currentTabRows]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    currentTabRows.forEach((a) => {
      counts[a.category] = (counts[a.category] ?? 0) + 1;
    });
    return counts;
  }, [currentTabRows]);

  const filteredRows = useMemo(() => {
    let xs = currentTabRows;
    if (activeSeverity) xs = xs.filter((a) => a.severity === activeSeverity);
    if (activeCategory) xs = xs.filter((a) => a.category === activeCategory);
    return [...xs].sort((a, b) => {
      const aRank = SEVERITY_ORDER.indexOf(a.severity);
      const bRank = SEVERITY_ORDER.indexOf(b.severity);
      if (aRank !== bRank) return aRank - bRank;
      return (b.raised_at ?? '').localeCompare(a.raised_at ?? '');
    });
  }, [currentTabRows, activeSeverity, activeCategory]);

  // -----------------------------------------------------------------------
  // Triage block (unresolved tab only) — stat strip + heatmap + oldest list
  // -----------------------------------------------------------------------

  const triage = useMemo(() => {
    const open = tabbed.unresolved ?? [];
    const now = Date.now();
    const ageHours = (a) => (now - new Date(a.raised_at).getTime()) / 3_600_000;
    const enriched = open.map((a) => ({ ...a, _ageHours: ageHours(a), _bucket: bucketForAgeHours(ageHours(a)) }));

    const criticalCount = enriched.filter((a) => a.severity === 'critical' || a.severity === 'error').length;
    const warningCount  = enriched.filter((a) => a.severity === 'warning').length;
    const oldest        = enriched.reduce((acc, a) => (acc == null || a._ageHours > acc._ageHours ? a : acc), null);

    // Resolved in trailing 7 days
    const oneWeekAgo = now - 7 * 24 * 3_600_000;
    const resolvedLast7d = (tabbed.resolved ?? []).filter((a) => a.resolved_at && new Date(a.resolved_at).getTime() >= oneWeekAgo).length;

    // Category × age heatmap, only for categories present in open set
    const matrix = {};
    const categories = new Set();
    enriched.forEach((a) => {
      categories.add(a.category);
      matrix[a.category] = matrix[a.category] ?? {};
      matrix[a.category][a._bucket] = (matrix[a.category][a._bucket] ?? 0) + 1;
    });
    const heatmapRows = [...categories]
      .map((cat) => ({
        category: cat,
        total: enriched.filter((a) => a.category === cat).length,
        cells: AGE_BUCKETS.map((b) => matrix[cat]?.[b.key] ?? 0),
      }))
      .sort((a, b) => b.total - a.total);

    // Cell maximum across the matrix (for shading intensity)
    let cellMax = 0;
    heatmapRows.forEach((r) => r.cells.forEach((c) => { if (c > cellMax) cellMax = c; }));

    // Top 5 oldest open, with severity-rank tiebreak (critical before info)
    const oldestFive = [...enriched]
      .sort((a, b) => {
        if (Math.abs(a._ageHours - b._ageHours) > 1) return b._ageHours - a._ageHours;
        return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
      })
      .slice(0, 5);

    // Resolution velocity: median + mean hours-to-resolve across alerts resolved in
    // the trailing 30 days. Useful signal for how quickly the queue is getting worked.
    const thirtyDaysAgo = now - 30 * 24 * 3_600_000;
    const recentResolved = (tabbed.resolved ?? [])
      .filter((a) => a.resolved_at && new Date(a.resolved_at).getTime() >= thirtyDaysAgo)
      .map((a) => (new Date(a.resolved_at).getTime() - new Date(a.raised_at).getTime()) / 3_600_000)
      .filter((h) => Number.isFinite(h) && h >= 0);
    let medianResolutionHours = null;
    let meanResolutionHours = null;
    if (recentResolved.length > 0) {
      const sorted = [...recentResolved].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianResolutionHours = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
      meanResolutionHours = sorted.reduce((s, x) => s + x, 0) / sorted.length;
    }

    return {
      openCount: open.length,
      criticalCount,
      warningCount,
      oldest,
      resolvedLast7d,
      medianResolutionHours,
      meanResolutionHours,
      recentResolvedCount: recentResolved.length,
      heatmapRows,
      cellMax,
      oldestFive,
    };
  }, [tabbed.unresolved, tabbed.resolved]);

  async function acknowledge(alert) {
    setBusy(true);
    try {
      await supabase
        .from('system_alerts')
        .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: actor })
        .eq('id', alert.id);
      await refetch();
    } catch (err) {
      console.error('acknowledge failed', err);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(alert) {
    setBusy(true);
    try {
      await supabase
        .from('system_alerts')
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: actor,
          resolution_notes: resolutionNotes.trim() || null,
          ...(alert.acknowledged_at ? {} : { acknowledged_at: new Date().toISOString(), acknowledged_by: actor }),
        })
        .eq('id', alert.id);
      setResolvingId(null);
      setResolutionNotes('');
      await refetch();
    } catch (err) {
      console.error('resolve failed', err);
    } finally {
      setBusy(false);
    }
  }

  async function bulkAcknowledge() {
    if (filteredRows.length === 0) return;
    if (!confirm(`Acknowledge ${filteredRows.length} alert${filteredRows.length === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    try {
      const ids = filteredRows.filter((a) => !a.acknowledged_at).map((a) => a.id);
      if (ids.length > 0) {
        await supabase
          .from('system_alerts')
          .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: actor })
          .in('id', ids);
      }
      await refetch();
    } catch (err) {
      console.error('bulk ack failed', err);
    } finally {
      setBusy(false);
    }
  }

  async function bulkResolve() {
    const targets = filteredRows.filter((a) => !a.resolved_at);
    if (targets.length === 0) return;
    const sharedNote = bulkResolveNotes.trim() || null;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const ids = targets.map((a) => a.id);
      const unackIds = targets.filter((a) => !a.acknowledged_at).map((a) => a.id);
      if (unackIds.length > 0) {
        await supabase
          .from('system_alerts')
          .update({ acknowledged_at: nowIso, acknowledged_by: actor })
          .in('id', unackIds);
      }
      await supabase
        .from('system_alerts')
        .update({
          resolved_at: nowIso,
          resolved_by: actor,
          ...(sharedNote ? { resolution_notes: sharedNote } : {}),
        })
        .in('id', ids);
      setBulkResolveOpen(false);
      setBulkResolveNotes('');
      await refetch();
    } catch (err) {
      console.error('bulk resolve failed', err);
    } finally {
      setBusy(false);
    }
  }

  const unresolvedCriticalCount = tabbed.unresolved.filter((a) => a.severity === 'critical' || a.severity === 'error').length;

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Alerts &amp; notifications</h1>
          <p className="text-sm text-ia-muted mt-1">
            What the system raised — ingestion failures, automation errors, tax deadlines,
            connection drops. Acknowledge to silence; resolve to close out.
          </p>
        </div>
        <button className="ia-button-ghost" onClick={refetch} aria-label="Refresh alerts">
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </header>

      {/* Unresolved-critical banner */}
      {unresolvedCriticalCount > 0 && activeTab !== 'unresolved' && (
        <div className="ia-card border-red-200 bg-red-50/50 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle size={16} />
            <span>{unresolvedCriticalCount} unresolved critical/error alert{unresolvedCriticalCount === 1 ? '' : 's'}</span>
          </div>
          <button onClick={() => { setActiveTab('unresolved'); setActiveSeverity(null); setActiveCategory(null); }}
                  className="ia-button-ghost text-xs">View</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-ia-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setActiveSeverity(null); setActiveCategory(null); }}
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
            )}>{tabbed[t.key].length}</span>
          </button>
        ))}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Triage dashboard — only on Unresolved tab, only when we have data   */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === 'unresolved' && triage.openCount > 0 && (
        <TriageBoard
          triage={triage}
          activeCategory={activeCategory}
          onPickCategory={(cat) => setActiveCategory(cat)}
          onClearCategory={() => setActiveCategory(null)}
          onAck={acknowledge}
          onResolveStart={(a) => { setResolvingId(a.id); setResolutionNotes(''); setExpandedId(a.id); }}
          busy={busy}
        />
      )}

      {/* Filter pills */}
      {currentTabRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ia-muted uppercase mr-1">Severity</span>
            <FilterPill label="All" active={!activeSeverity} onClick={() => setActiveSeverity(null)} count={currentTabRows.length} />
            {SEVERITY_ORDER.filter((s) => severityCounts[s] > 0).map((s) => (
              <FilterPill
                key={s}
                label={s}
                active={activeSeverity === s}
                onClick={() => setActiveSeverity(s)}
                count={severityCounts[s]}
              />
            ))}
          </div>

          {Object.keys(categoryCounts).length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ia-muted uppercase mr-1">Category</span>
              <FilterPill label="All" active={!activeCategory} onClick={() => setActiveCategory(null)} />
              {Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                <FilterPill key={cat} label={cat} active={activeCategory === cat} onClick={() => setActiveCategory(cat)} count={n} />
              ))}
            </div>
          )}

          {activeTab === 'unresolved' && filteredRows.length > 0 && (activeSeverity || activeCategory) && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {filteredRows.filter((a) => !a.acknowledged_at).length > 0 && (
                  <button
                    onClick={bulkAcknowledge}
                    disabled={busy}
                    className="ia-button-ghost text-xs"
                  >
                    <CheckCircle2 size={14} />
                    <span>Acknowledge {filteredRows.filter((a) => !a.acknowledged_at).length} unack'd in filter</span>
                  </button>
                )}
                <button
                  onClick={() => setBulkResolveOpen((v) => !v)}
                  disabled={busy}
                  className="ia-button-ghost text-xs"
                  title="Resolve every alert matching the current filter"
                >
                  <CheckCheck size={14} />
                  <span>{bulkResolveOpen ? 'Cancel bulk resolve' : `Resolve ${filteredRows.length} in filter`}</span>
                </button>
                {bulkResolveOpen && (
                  <span className="text-[11px] text-ia-muted">
                    These will close together. Add an optional shared note ↓
                  </span>
                )}
              </div>
              {bulkResolveOpen && (
                <div className="rounded-lg border border-ia-border bg-ia-card p-3 space-y-2">
                  <textarea
                    value={bulkResolveNotes}
                    onChange={(e) => setBulkResolveNotes(e.target.value)}
                    placeholder={`Shared resolution note for these ${filteredRows.length} alert${filteredRows.length === 1 ? '' : 's'} (optional). If left blank, no resolution_notes will be written.`}
                    rows={2}
                    className="w-full text-sm rounded border border-ia-border bg-ia-page px-2 py-1 text-ia-ink focus:outline-none focus:border-ia-teal"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (confirm(`Resolve ${filteredRows.length} alert${filteredRows.length === 1 ? '' : 's'} in this filter?`)) {
                          bulkResolve();
                        }
                      }}
                      disabled={busy}
                      className="ia-button-primary text-xs"
                    >
                      <CheckCheck size={14} />
                      <span>Confirm resolve {filteredRows.length}</span>
                    </button>
                    <button
                      onClick={() => { setBulkResolveOpen(false); setBulkResolveNotes(''); }}
                      disabled={busy}
                      className="ia-button-ghost text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      {error ? (
        <div className="ia-card border-red-200 bg-red-50/50 text-sm text-red-800">
          Failed to load alerts: {String(error.message ?? error)}
        </div>
      ) : loading ? (
        <LoadingState />
      ) : filteredRows.length === 0 ? (
        activeTab === 'unresolved' ? (
          <div className="ia-card flex items-center justify-center py-10 text-emerald-700 gap-2 text-sm">
            <CheckCircle2 size={18} />
            <span>All clear — no unresolved alerts.</span>
          </div>
        ) : (
          <EmptyState
            icon={BellOff}
            title="No alerts match these filters"
            description="Try removing filters or switch to another tab."
          />
        )
      ) : (
        <ul className="space-y-2">
          {filteredRows.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              expanded={expandedId === a.id}
              onToggleExpand={() => setExpandedId(expandedId === a.id ? null : a.id)}
              onAck={() => acknowledge(a)}
              onResolveStart={() => { setResolvingId(a.id); setResolutionNotes(''); }}
              onResolveCancel={() => { setResolvingId(null); setResolutionNotes(''); }}
              onResolveConfirm={() => resolve(a)}
              resolving={resolvingId === a.id}
              resolutionNotes={resolutionNotes}
              setResolutionNotes={setResolutionNotes}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Triage board: stat strip + heatmap + oldest-open quick list
// ---------------------------------------------------------------------------

function TriageBoard({ triage, activeCategory, onPickCategory, onClearCategory, onAck, onResolveStart, busy }) {
  const { openCount, criticalCount, warningCount, oldest, resolvedLast7d,
          medianResolutionHours, recentResolvedCount,
          heatmapRows, cellMax, oldestFive } = triage;

  const velocitySublabel = (() => {
    if (medianResolutionHours == null) return 'closed in the last week';
    const label = formatAgeShort(medianResolutionHours);
    return `median ${label} to close (${recentResolvedCount} closed · 30d)`;
  })();

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Open"
          value={openCount}
          sublabel={`${warningCount} warning · ${criticalCount} critical/error`}
          icon={Bell}
          tone={criticalCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Oldest open"
          value={oldest ? formatAgeShort(oldest._ageHours) : '—'}
          sublabel={oldest ? `#${oldest.id} · ${oldest.category}` : 'nothing pending'}
          icon={Clock}
          tone={oldest && oldest._ageHours > 24 * 14 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Resolved 7d"
          value={resolvedLast7d}
          sublabel={velocitySublabel}
          icon={CheckCheck}
          tone="positive"
        />
        <StatCard
          label="Categories open"
          value={heatmapRows.length}
          sublabel={heatmapRows.length > 0 ? `top: ${heatmapRows[0].category}` : '—'}
          icon={ListChecks}
          tone="neutral"
        />
      </div>

      {/* Heatmap: category × age bucket */}
      <div className="rounded-lg border border-ia-border bg-ia-card shadow-ia-card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h3 className="text-sm font-semibold text-ia-navy">Triage matrix</h3>
          <span className="text-[11px] text-ia-muted">Click a category cell to filter the list below.</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-ia-muted">
              <th className="text-left font-medium px-4 py-2 w-1/3">Category</th>
              {AGE_BUCKETS.map((b) => (
                <th key={b.key} className="text-right font-medium px-3 py-2">{b.label}</th>
              ))}
              <th className="text-right font-medium px-4 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {heatmapRows.map((row) => {
              const isActive = activeCategory === row.category;
              return (
                <tr key={row.category}
                    className={cn(
                      'border-t border-ia-border cursor-pointer transition-colors',
                      isActive ? 'bg-ia-teal/10' : 'hover:bg-ia-cream-dark/50',
                    )}
                    onClick={() => isActive ? onClearCategory() : onPickCategory(row.category)}>
                  <td className="px-4 py-2 font-medium text-ia-navy">{row.category}</td>
                  {row.cells.map((n, i) => {
                    const intensity = cellMax > 0 ? n / cellMax : 0;
                    // Visual cue only — uses inline opacity to avoid arbitrary Tailwind classes.
                    return (
                      <td key={i} className="text-right px-3 py-2 font-mono">
                        {n > 0 ? (
                          <span
                            className="inline-block min-w-[1.5rem] px-1.5 py-0.5 rounded text-ia-navy font-semibold"
                            style={{ backgroundColor: `rgba(232,153,92,${0.15 + intensity * 0.55})` }}
                          >
                            {n}
                          </span>
                        ) : (
                          <span className="text-ia-muted">·</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right px-4 py-2 font-semibold text-ia-navy">{row.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Oldest 5 open */}
      {oldestFive.length > 0 && (
        <div className="rounded-lg border border-ia-border bg-ia-card shadow-ia-card">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-ia-border">
            <h3 className="text-sm font-semibold text-ia-navy">5 oldest open · needs eyes</h3>
            <span className="text-[11px] text-ia-muted">Sorted by age, then severity</span>
          </div>
          <ul className="divide-y divide-ia-border">
            {oldestFive.map((a) => {
              const Icon = severityIcon(a.severity);
              return (
                <li key={a.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <span className={cn(severityPillClass(a.severity), 'inline-flex items-center gap-1 flex-shrink-0')}>
                    <Icon size={10} />
                    {a.severity}
                  </span>
                  <span className="ia-pill-muted flex-shrink-0">{a.category}</span>
                  <span className="text-ia-navy min-w-0 flex-1 truncate">#{a.id} · {truncate(a.message, 120)}</span>
                  <span className="text-xs text-ia-muted flex-shrink-0">{formatAgeShort(a._ageHours)}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!a.acknowledged_at && (
                      <button onClick={() => onAck(a)} disabled={busy} className="ia-button-ghost text-xs" title="Acknowledge">
                        <CheckCircle2 size={12} />
                      </button>
                    )}
                    <button onClick={() => onResolveStart(a)} disabled={busy} className="ia-button-ghost text-xs" title="Resolve">
                      <CheckCheck size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert card (unchanged)
// ---------------------------------------------------------------------------

function AlertCard({
  alert,
  expanded, onToggleExpand,
  onAck,
  onResolveStart, onResolveCancel, onResolveConfirm,
  resolving, resolutionNotes, setResolutionNotes,
  busy,
}) {
  const Icon = severityIcon(alert.severity);
  const isResolved = !!alert.resolved_at;
  const isAcked    = !!alert.acknowledged_at;

  return (
    <li className={cn(
      'ia-card-tight',
      alert.severity === 'critical' && !isResolved && 'border-red-300',
      alert.severity === 'error' && !isResolved && 'border-red-200',
    )}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-start gap-2 flex-1 min-w-0 text-left"
        >
          {expanded
            ? <ChevronDown size={16} className="text-ia-muted mt-0.5 flex-shrink-0" />
            : <ChevronRight size={16} className="text-ia-muted mt-0.5 flex-shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(severityPillClass(alert.severity), 'inline-flex items-center gap-1')}>
                <Icon size={10} />
                {alert.severity}
              </span>
              <span className="ia-pill-muted">{alert.category}</span>
              {isResolved && <span className="ia-pill-success">resolved</span>}
              {!isResolved && isAcked && <span className="ia-pill-info">acknowledged</span>}
            </div>
            <div className="text-sm text-ia-navy mt-1.5 whitespace-pre-wrap">
              {expanded ? alert.message : truncate(alert.message, 160)}
            </div>
            <div className="text-xs text-ia-muted mt-1">
              raised {fmtRelative(alert.raised_at)}
              {isAcked && <> · acked by {alert.acknowledged_by ?? '?'} {fmtRelative(alert.acknowledged_at)}</>}
              {isResolved && <> · resolved by {alert.resolved_by ?? '?'} {fmtRelative(alert.resolved_at)}</>}
            </div>
          </div>
        </button>

        {!isResolved && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isAcked && (
              <button onClick={onAck} disabled={busy} className="ia-button-ghost text-xs">
                <CheckCircle2 size={12} />
                <span>Ack</span>
              </button>
            )}
            {!resolving && (
              <button onClick={onResolveStart} disabled={busy} className="ia-button text-xs">
                <CheckCheck size={12} />
                <span>Resolve</span>
              </button>
            )}
          </div>
        )}
      </div>

      {resolving && (
        <div className="mt-3 pt-3 border-t border-ia-border space-y-2">
          <label className="text-xs font-medium text-ia-muted uppercase">Resolution notes (optional)</label>
          <textarea
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            rows={2}
            placeholder="What was done? Helps the next person reading this alert."
            className="ia-input"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={onResolveCancel} disabled={busy} className="ia-button-ghost text-xs">Cancel</button>
            <button onClick={onResolveConfirm} disabled={busy} className="ia-button text-xs">
              <CheckCheck size={12} />
              <span>Mark resolved</span>
            </button>
          </div>
        </div>
      )}

      {expanded && !resolving && (
        <div className="mt-3 pt-3 border-t border-ia-border space-y-3">
          {alert.context && Object.keys(alert.context).length > 0 && (
            <div>
              <div className="text-xs font-medium text-ia-muted uppercase mb-1">Context</div>
              <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48 font-mono">
                {JSON.stringify(alert.context, null, 2)}
              </pre>
            </div>
          )}

          {alert.resolution_notes && (
            <div>
              <div className="text-xs font-medium text-ia-muted uppercase mb-1">Resolution notes</div>
              <div className="text-sm text-ia-ink whitespace-pre-wrap">{alert.resolution_notes}</div>
            </div>
          )}

          <div className="text-xs text-ia-muted flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>raised {fmtDate(alert.raised_at, 'PPpp')}</span>
            {alert.entity_id && <span>entity #{alert.entity_id}</span>}
            <span>alert #{alert.id}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-ia-border">
            <AskClaudeButton
              moduleLabel="Alerts"
              subject={`Alert #${alert.id}: ${alert.category} (${alert.severity})`}
              context={{
                id: alert.id,
                severity: alert.severity,
                category: alert.category,
                entity_id: alert.entity_id,
                raised_at: alert.raised_at,
                acknowledged_at: alert.acknowledged_at,
                resolved_at: alert.resolved_at,
                message: alert.message,
                context: alert.context,
                resolution_notes: alert.resolution_notes,
              }}
              suggestedPrompt={`Help me work through alert #${alert.id}. What does this mean, what should I do about it, and how do I close it out?`}
            />
            <PrintButton title={`BCC Alert #${alert.id} — ${alert.category}`} />
          </div>
        </div>
      )}
    </li>
  );
}
