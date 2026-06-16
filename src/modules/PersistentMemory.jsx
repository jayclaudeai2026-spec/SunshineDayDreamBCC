import { useMemo, useState } from 'react';
import { Brain, BookOpen, History, Building2 } from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SearchInput from '../components/SearchInput.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { supabase } from '../lib/supabase.js';
import { useClientContext, useSupabaseQuery } from '../lib/hooks.js';
import { fmtRelative, fmtDate, truncate, cn } from '../lib/utils.js';

const TABS = [
  { key: 'rules',    label: 'Operational rules', icon: BookOpen },
  { key: 'sessions', label: 'Session notes',     icon: History },
  { key: 'context',  label: 'Client context',    icon: Building2 },
];

export default function PersistentMemory() {
  const [activeTab, setActiveTab] = useState('rules');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);

  const { data: memories, loading } = useSupabaseQuery(
    () => supabase
      .from('agent_memory')
      .select('id, agent_id, memory_type, content, metadata, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(500),
    [],
  );

  const { data: clientCtx } = useClientContext();

  // Filter memories by tab
  const rules = useMemo(() => (memories ?? []).filter((m) => m.memory_type === 'operational_rule'), [memories]);
  const sessions = useMemo(() => (memories ?? []).filter((m) => m.memory_type === 'session_note'), [memories]);

  const ruleCategoryCounts = useMemo(() => {
    const counts = {};
    rules.forEach((r) => {
      const cat = r.metadata?.rule_category ?? 'uncategorized';
      counts[cat] = (counts[cat] ?? 0) + 1;
    });
    return counts;
  }, [rules]);

  const filteredRules = useMemo(() => {
    let xs = rules;
    if (activeCategory) {
      xs = xs.filter((r) => (r.metadata?.rule_category ?? 'uncategorized') === activeCategory);
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      xs = xs.filter((r) => (r.content ?? '').toLowerCase().includes(needle));
    }
    return xs;
  }, [rules, activeCategory, search]);

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const needle = search.trim().toLowerCase();
    return sessions.filter((s) => (s.content ?? '').toLowerCase().includes(needle));
  }, [sessions, search]);

  return (
    <section className="space-y-6">
      <header>
        <h1>Memory</h1>
        <p className="text-sm text-ia-muted mt-1">
          Operational rules, session notes, and client context Claude carries across conversations.
        </p>
      </header>

      <div className="flex border-b border-ia-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setSearch(''); setActiveCategory(null); }}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
              activeTab === t.key
                ? 'border-ia-teal text-ia-teal font-medium'
                : 'border-transparent text-ia-muted hover:text-ia-navy'
            )}
          >
            <t.icon size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'rules' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search rules…"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill
              label="All"
              active={!activeCategory}
              onClick={() => setActiveCategory(null)}
              count={rules.length}
            />
            {Object.entries(ruleCategoryCounts).map(([cat, n]) => (
              <FilterPill
                key={cat}
                label={cat.replace(/_/g, ' ')}
                active={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
                count={n}
              />
            ))}
          </div>

          {loading ? (
            <LoadingState />
          ) : filteredRules.length === 0 ? (
            <EmptyState
              icon={Brain}
              title={search || activeCategory ? 'No matching rules' : 'No operational rules yet'}
              description={
                search || activeCategory
                  ? 'Try clearing the filters.'
                  : 'Rules accumulate as Claude learns operational facts from conversation. Tell Claude "remember that …" to add one.'
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredRules.map((r) => (
                <div key={r.id} className="ia-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {r.metadata?.rule_category && (
                        <span className="ia-pill-info mb-2 inline-block">
                          {r.metadata.rule_category.replace(/_/g, ' ')}
                        </span>
                      )}
                      <div className="text-sm text-ia-navy whitespace-pre-wrap">{r.content}</div>
                    </div>
                    <div className="text-xs text-ia-muted whitespace-nowrap">
                      {fmtRelative(r.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'sessions' && (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search session notes…"
          />
          {loading ? (
            <LoadingState />
          ) : filteredSessions.length === 0 ? (
            <EmptyState
              icon={History}
              title={search ? 'No matching sessions' : 'No session notes yet'}
              description="Tell Claude 'log session' or 'save this' to write a session note."
            />
          ) : (
            <div className="space-y-3">
              {filteredSessions.map((s) => (
                <div key={s.id} className="ia-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="text-xs text-ia-muted">
                      {s.metadata?.session_date
                        ? fmtDate(s.metadata.session_date)
                        : fmtDate(s.created_at)}
                      {s.agent_id && ` · agent: ${s.agent_id}`}
                    </div>
                    <div className="text-xs text-ia-muted">{fmtRelative(s.created_at)}</div>
                  </div>
                  <div className="text-sm text-ia-navy whitespace-pre-wrap">{s.content}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'context' && (
        <>
          <SectionHeader
            title="Client context"
            description="Canonical singleton (client_context id=1) — the source of truth for client identity, fiscal model, and integration mappings."
          />
          {!clientCtx ? (
            <LoadingState />
          ) : (
            <div className="ia-card">
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <ContextField label="Display name" value={clientCtx.display_name} />
                <ContextField label="Owner name" value={clientCtx.owner_name} />
                <ContextField label="Owner email" value={clientCtx.owner_email} />
                <ContextField label="Intake email" value={clientCtx.intake_email} />
                <ContextField label="Tier" value={clientCtx.tier} />
                <ContextField label="Variant" value={clientCtx.variant} />
                <ContextField label="Founder client" value={clientCtx.founder_client ? 'yes' : 'no'} />
                <ContextField label="Install started" value={clientCtx.install_started_at ? fmtDate(clientCtx.install_started_at) : '—'} />
                <ContextField label="Handoff completed" value={clientCtx.handoff_completed_at ? fmtDate(clientCtx.handoff_completed_at) : 'in progress'} />
                <ContextField label="Support end date" value={clientCtx.support_end_date ? fmtDate(clientCtx.support_end_date) : '—'} />
              </dl>
              {clientCtx.entities && (
                <div className="mt-4 pt-4 border-t border-ia-border">
                  <div className="text-xs font-medium text-ia-muted mb-2">Entities configured</div>
                  <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48">
                    {JSON.stringify(clientCtx.entities, null, 2)}
                  </pre>
                </div>
              )}
              {clientCtx.drive_folder_mappings && (
                <div className="mt-4 pt-4 border-t border-ia-border">
                  <div className="text-xs font-medium text-ia-muted mb-2">Drive folder mappings</div>
                  <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48">
                    {JSON.stringify(clientCtx.drive_folder_mappings, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ContextField({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ia-muted uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-ia-navy">{value ?? '—'}</dd>
    </div>
  );
}
