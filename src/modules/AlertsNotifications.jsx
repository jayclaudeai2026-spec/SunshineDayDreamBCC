import { useMemo, useState } from 'react';
import {
  Bell, BellOff, CheckCircle2, AlertTriangle, AlertCircle, Info,
  ChevronDown, ChevronRight, RefreshCw, CheckCheck,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { supabase } from '../lib/supabase.js';
import { useSupabaseQuery, useAuthUser } from '../lib/hooks.js';
import { fmtRelative, fmtDate, cn, truncate, severityPillClass } from '../lib/utils.js';

const TABS = [
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'all',        label: 'All' },
  { key: 'resolved',   label: 'Resolved' },
];

const SEVERITY_ORDER = ['critical', 'error', 'warning', 'info'];

function severityIcon(severity) {
  switch (severity) {
    case 'critical': return AlertCircle;
    case 'error':    return AlertCircle;
    case 'warning':  return AlertTriangle;
    case 'info':     return Info;
    default:          return Bell;
  }
}

export default function AlertsNotifications() {
  const [activeTab, setActiveTab] = useState('unresolved');
  const [activeSeverity, setActiveSeverity] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
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

  // Counts
  const tabbed = useMemo(() => {
    const xs = alerts ?? [];
    return {
      unresolved: xs.filter((a) => !a.resolved_at),
      resolved:   xs.filter((a) =>  a.resolved_at),
      all:        xs,
    };
  }, [alerts]);

  // Category pills derived from current tab
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
    // Stable sort: severity rank then raised_at desc
    return [...xs].sort((a, b) => {
      const aRank = SEVERITY_ORDER.indexOf(a.severity);
      const bRank = SEVERITY_ORDER.indexOf(b.severity);
      if (aRank !== bRank) return aRank - bRank;
      return (b.raised_at ?? '').localeCompare(a.raised_at ?? '');
    });
  }, [currentTabRows, activeSeverity, activeCategory]);

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
          // Acknowledge if not already
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

          {/* Bulk action available when a severity filter is active */}
          {activeSeverity && activeTab === 'unresolved' && filteredRows.filter((a) => !a.acknowledged_at).length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={bulkAcknowledge}
                disabled={busy}
                className="ia-button-ghost text-xs"
              >
                <CheckCheck size={14} />
                <span>Acknowledge all {filteredRows.filter((a) => !a.acknowledged_at).length} unacknowledged in this filter</span>
              </button>
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
// Alert card
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

      {/* Resolution input */}
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

      {/* Expanded body */}
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
          </div>
        </div>
      )}
    </li>
  );
}
