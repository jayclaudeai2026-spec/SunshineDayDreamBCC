import { useMemo, useState, useEffect } from 'react';
import {
  Brain, BookOpen, History, Building2,
  Plus, Edit3, Trash2, Save, X, AlertCircle,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import PrintButton from '../components/PrintButton.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SearchInput from '../components/SearchInput.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { supabase } from '../lib/supabase.js';
import { useClientContext, useSupabaseQuery } from '../lib/hooks.js';
import { fmtRelative, fmtDate, cn } from '../lib/utils.js';

const TABS = [
  { key: 'rules',    label: 'Operational rules', icon: BookOpen,  memoryType: 'operational_rule' },
  { key: 'sessions', label: 'Session notes',     icon: History,   memoryType: 'session_note' },
  { key: 'context',  label: 'Client context',    icon: Building2, memoryType: null },
];

export default function PersistentMemory() {
  const [activeTab, setActiveTab] = useState('rules');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);

  // editingId === null => not editing
  // editingId === 'new' => adding a new row at top
  // editingId === <number> => editing an existing row by id
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const { data: memories, loading, refetch: refetchMemories } = useSupabaseQuery(
    () => supabase
      .from('agent_memory')
      .select('id, agent_id, memory_type, content, metadata, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(500),
    [],
  );

  const { data: clientCtx, refetch: refetchContext } = useClientContext();

  const rules = useMemo(
    () => (memories ?? []).filter((m) => m.memory_type === 'operational_rule'),
    [memories],
  );
  const sessions = useMemo(
    () => (memories ?? []).filter((m) => m.memory_type === 'session_note'),
    [memories],
  );

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

  // Reset editor when switching tabs
  function switchTab(key) {
    setActiveTab(key);
    setSearch('');
    setActiveCategory(null);
    setEditingId(null);
    setActionError(null);
  }

  async function saveMemoryRow({ id, memoryType, content, metadataText }) {
    setActionError(null);
    if (!content || !content.trim()) {
      setActionError('Content is required.');
      return false;
    }
    let metadataObj = {};
    if (metadataText && metadataText.trim()) {
      try {
        metadataObj = JSON.parse(metadataText);
        if (typeof metadataObj !== 'object' || Array.isArray(metadataObj) || metadataObj === null) {
          throw new Error('Metadata must be a JSON object.');
        }
      } catch (err) {
        setActionError('Metadata is not valid JSON: ' + (err.message ?? err));
        return false;
      }
    }
    setBusy(true);
    try {
      if (id === 'new') {
        const { error } = await supabase.from('agent_memory').insert({
          agent_id: 'main',
          memory_type: memoryType,
          content: content.trim(),
          metadata: metadataObj,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('agent_memory')
          .update({
            content: content.trim(),
            metadata: metadataObj,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (error) throw error;
      }
      setEditingId(null);
      await refetchMemories();
      return true;
    } catch (err) {
      console.error('save memory failed', err);
      setActionError('Save failed: ' + (err.message ?? String(err)));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function deleteMemoryRow(row) {
    const label = row.memory_type === 'operational_rule' ? 'operational rule' : 'session note';
    if (!confirm(`Delete this ${label}? This cannot be undone.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const { error } = await supabase.from('agent_memory').delete().eq('id', row.id);
      if (error) throw error;
      await refetchMemories();
    } catch (err) {
      console.error('delete memory failed', err);
      setActionError('Delete failed: ' + (err.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Memory</h1>
          <p className="text-sm text-ia-muted mt-1">
            Operational rules, session notes, and client context Claude carries across conversations.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end ia-no-print">
          <PrintButton title="BCC Memory — Claude's persistent knowledge" />
          <AskClaudeButton
            moduleLabel="Memory"
            subject={`Memory · ${activeTab} tab · ${(memories ?? []).length} total items`}
            context={{
              tab: activeTab,
              total_count: (memories ?? []).length,
              rules_count: (rules ?? []).length,
              sessions_count: (sessions ?? []).length,
              search,
            }}
            suggestedPrompt="What's in my memory right now that's outdated, contradictory, or worth promoting to a standing rule?"
          />
        </div>
      </header>

      <div className="flex border-b border-ia-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
              activeTab === t.key
                ? 'border-ia-teal text-ia-teal font-medium'
                : 'border-transparent text-ia-muted hover:text-ia-navy',
            )}
          >
            <t.icon size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {actionError && (
        <div className="ia-card border-red-200 bg-red-50/50 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div className="flex-1">{actionError}</div>
          <button onClick={() => setActionError(null)} className="text-red-800 hover:text-red-900">
            <X size={14} />
          </button>
        </div>
      )}

      {activeTab === 'rules' && (
        <>
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search rules…"
            />
            {editingId !== 'new' && (
              <button
                onClick={() => { setEditingId('new'); setActionError(null); }}
                className="ia-button text-sm"
              >
                <Plus size={14} />
                <span>Add rule</span>
              </button>
            )}
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

          {editingId === 'new' && (
            <MemoryRowEditor
              memoryType="operational_rule"
              initialContent=""
              initialMetadata={{}}
              busy={busy}
              onCancel={() => setEditingId(null)}
              onSave={(payload) => saveMemoryRow({ id: 'new', memoryType: 'operational_rule', ...payload })}
            />
          )}

          {loading ? (
            <LoadingState />
          ) : filteredRules.length === 0 && editingId !== 'new' ? (
            <EmptyState
              icon={Brain}
              title={search || activeCategory ? 'No matching rules' : 'No operational rules yet'}
              description={
                search || activeCategory
                  ? 'Try clearing the filters.'
                  : 'Rules accumulate as Claude learns operational facts from conversation. Tell Claude "remember that …" to add one, or click Add rule above.'
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredRules.map((r) => (
                editingId === r.id ? (
                  <MemoryRowEditor
                    key={r.id}
                    memoryType={r.memory_type}
                    initialContent={r.content ?? ''}
                    initialMetadata={r.metadata ?? {}}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={(payload) => saveMemoryRow({ id: r.id, memoryType: r.memory_type, ...payload })}
                  />
                ) : (
                  <MemoryRowCard
                    key={r.id}
                    row={r}
                    chipText={r.metadata?.rule_category && r.metadata.rule_category.replace(/_/g, ' ')}
                    onEdit={() => { setEditingId(r.id); setActionError(null); }}
                    onDelete={() => deleteMemoryRow(r)}
                    busy={busy}
                  />
                )
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'sessions' && (
        <>
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search session notes…"
            />
            {editingId !== 'new' && (
              <button
                onClick={() => { setEditingId('new'); setActionError(null); }}
                className="ia-button text-sm"
              >
                <Plus size={14} />
                <span>Add note</span>
              </button>
            )}
          </div>

          {editingId === 'new' && (
            <MemoryRowEditor
              memoryType="session_note"
              initialContent=""
              initialMetadata={{ session: new Date().toISOString().slice(0, 10) }}
              busy={busy}
              onCancel={() => setEditingId(null)}
              onSave={(payload) => saveMemoryRow({ id: 'new', memoryType: 'session_note', ...payload })}
            />
          )}

          {loading ? (
            <LoadingState />
          ) : filteredSessions.length === 0 && editingId !== 'new' ? (
            <EmptyState
              icon={History}
              title={search ? 'No matching sessions' : 'No session notes yet'}
              description="Tell Claude 'log session' or 'save this' to write a session note, or click Add note above."
            />
          ) : (
            <div className="space-y-3">
              {filteredSessions.map((s) => (
                editingId === s.id ? (
                  <MemoryRowEditor
                    key={s.id}
                    memoryType={s.memory_type}
                    initialContent={s.content ?? ''}
                    initialMetadata={s.metadata ?? {}}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={(payload) => saveMemoryRow({ id: s.id, memoryType: s.memory_type, ...payload })}
                  />
                ) : (
                  <MemoryRowCard
                    key={s.id}
                    row={s}
                    chipText={
                      s.metadata?.session_date
                        ? fmtDate(s.metadata.session_date)
                        : fmtDate(s.created_at)
                    }
                    onEdit={() => { setEditingId(s.id); setActionError(null); }}
                    onDelete={() => deleteMemoryRow(s)}
                    busy={busy}
                  />
                )
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'context' && (
        <ContextTab
          clientCtx={clientCtx}
          refetch={refetchContext}
          setActionError={setActionError}
        />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Card: read-only view of a memory row with Edit + Delete actions
// ----------------------------------------------------------------------------
function MemoryRowCard({ row, chipText, onEdit, onDelete, busy }) {
  return (
    <div className="ia-card group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {chipText && (
            <span className="ia-pill-info mb-2 inline-block">
              {chipText}
            </span>
          )}
          <div className="text-sm text-ia-navy whitespace-pre-wrap">{row.content}</div>
          {row.metadata && Object.keys(row.metadata).length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="text-ia-muted cursor-pointer hover:text-ia-navy select-none">
                metadata
              </summary>
              <pre className="mt-2 bg-ia-cream-dark p-2 rounded overflow-auto max-h-40 text-[11px]">
                {JSON.stringify(row.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-xs text-ia-muted whitespace-nowrap">
            {fmtRelative(row.updated_at ?? row.created_at)}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={onEdit}
              disabled={busy}
              className="p-1 rounded hover:bg-ia-cream-dark text-ia-muted hover:text-ia-navy disabled:opacity-50"
              title="Edit"
              aria-label="Edit"
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={onDelete}
              disabled={busy}
              className="p-1 rounded hover:bg-red-50 text-ia-muted hover:text-red-700 disabled:opacity-50"
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Editor: inline editor used for both Add and Edit of a memory row
// ----------------------------------------------------------------------------
function MemoryRowEditor({
  memoryType,
  initialContent,
  initialMetadata,
  busy,
  onCancel,
  onSave,
}) {
  const [content, setContent] = useState(initialContent);
  const [metadataText, setMetadataText] = useState(
    initialMetadata && Object.keys(initialMetadata).length > 0
      ? JSON.stringify(initialMetadata, null, 2)
      : '{}',
  );

  const isNew = initialContent === '';
  const label = memoryType === 'operational_rule' ? 'rule' : 'session note';

  async function handleSave() {
    await onSave({ content, metadataText });
  }

  return (
    <div className="ia-card border-ia-teal/40 bg-ia-teal/[0.03]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-medium text-ia-teal uppercase tracking-wide">
          {isNew ? `New ${label}` : `Editing ${label}`}
        </div>
      </div>

      <label className="block text-xs font-medium text-ia-muted uppercase mb-1">Content</label>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={Math.max(6, Math.min(24, content.split('\n').length + 1))}
        className="w-full text-sm font-mono text-ia-navy border border-ia-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ia-teal/40 focus:border-ia-teal"
        placeholder="What should Claude remember?"
        autoFocus
      />

      <label className="block text-xs font-medium text-ia-muted uppercase mt-4 mb-1">Metadata (JSON)</label>
      <textarea
        value={metadataText}
        onChange={(e) => setMetadataText(e.target.value)}
        rows={Math.max(3, Math.min(12, metadataText.split('\n').length + 1))}
        className="w-full text-xs font-mono text-ia-navy border border-ia-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ia-teal/40 focus:border-ia-teal"
        placeholder='{"rule_category": "..."}'
      />
      <div className="text-[11px] text-ia-muted mt-1">
        Optional. Must be a JSON object (use <code>{`{}`}</code> for none).
      </div>

      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onCancel} disabled={busy} className="ia-button-ghost text-sm">
          <X size={14} />
          <span>Cancel</span>
        </button>
        <button onClick={handleSave} disabled={busy} className="ia-button text-sm">
          <Save size={14} />
          <span>{busy ? 'Saving…' : 'Save'}</span>
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Client context tab — read-only view + edit mode
// ----------------------------------------------------------------------------
function ContextTab({ clientCtx, refetch, setActionError }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);

  // Initialize form when entering edit mode
  useEffect(() => {
    if (editing && clientCtx) {
      setForm({
        display_name: clientCtx.display_name ?? '',
        owner_name: clientCtx.owner_name ?? '',
        owner_email: clientCtx.owner_email ?? '',
        intake_email: clientCtx.intake_email ?? '',
        bookkeeper_email: clientCtx.bookkeeper_email ?? '',
        tier: clientCtx.tier ?? '',
        variant: clientCtx.variant ?? '',
        founder_client: !!clientCtx.founder_client,
        setup_fee_paid_amount: clientCtx.setup_fee_paid_amount ?? '',
        setup_fee_paid_at: toLocalDateTime(clientCtx.setup_fee_paid_at),
        install_started_at: toLocalDateTime(clientCtx.install_started_at),
        handoff_completed_at: toLocalDateTime(clientCtx.handoff_completed_at),
        support_end_date: clientCtx.support_end_date ?? '',
        notes: clientCtx.notes ?? '',
        drive_folder_mappings_text: clientCtx.drive_folder_mappings
          ? JSON.stringify(clientCtx.drive_folder_mappings, null, 2)
          : '{}',
        brand_palette_text: clientCtx.brand_palette
          ? JSON.stringify(clientCtx.brand_palette, null, 2)
          : '{}',
      });
    }
  }, [editing, clientCtx]);

  if (!clientCtx) {
    return <LoadingState />;
  }

  async function handleSave() {
    setActionError(null);
    // Validate JSONB fields
    let driveMap, palette;
    try {
      driveMap = form.drive_folder_mappings_text.trim() ? JSON.parse(form.drive_folder_mappings_text) : null;
    } catch (err) {
      setActionError('drive_folder_mappings is not valid JSON: ' + (err.message ?? err));
      return;
    }
    try {
      palette = form.brand_palette_text.trim() ? JSON.parse(form.brand_palette_text) : null;
    } catch (err) {
      setActionError('brand_palette is not valid JSON: ' + (err.message ?? err));
      return;
    }

    const payload = {
      display_name: form.display_name || null,
      owner_name: form.owner_name || null,
      owner_email: form.owner_email || null,
      intake_email: form.intake_email || null,
      bookkeeper_email: form.bookkeeper_email || null,
      tier: form.tier || null,
      variant: form.variant || null,
      founder_client: !!form.founder_client,
      setup_fee_paid_amount: form.setup_fee_paid_amount === '' ? null : Number(form.setup_fee_paid_amount),
      setup_fee_paid_at: fromLocalDateTime(form.setup_fee_paid_at),
      install_started_at: fromLocalDateTime(form.install_started_at),
      handoff_completed_at: fromLocalDateTime(form.handoff_completed_at),
      support_end_date: form.support_end_date || null,
      notes: form.notes || null,
      drive_folder_mappings: driveMap,
      brand_palette: palette,
      updated_at: new Date().toISOString(),
    };

    setBusy(true);
    try {
      const { error } = await supabase
        .from('client_context')
        .update(payload)
        .eq('client_id', clientCtx.client_id);
      if (error) throw error;
      setEditing(false);
      await refetch();
    } catch (err) {
      console.error('save client_context failed', err);
      setActionError('Save failed: ' + (err.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <>
        <div className="flex items-end justify-between gap-4">
          <SectionHeader
            title="Client context"
            description="Canonical singleton (client_context) — the source of truth for client identity, fiscal model, and integration mappings."
          />
          <button onClick={() => setEditing(true)} className="ia-button text-sm shrink-0">
            <Edit3 size={14} />
            <span>Edit</span>
          </button>
        </div>
        <div className="ia-card">
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <ContextField label="Client ID" value={clientCtx.client_id} />
            <ContextField label="Display name" value={clientCtx.display_name} />
            <ContextField label="Owner name" value={clientCtx.owner_name} />
            <ContextField label="Owner email" value={clientCtx.owner_email} />
            <ContextField label="Intake email" value={clientCtx.intake_email} />
            <ContextField label="Bookkeeper email" value={clientCtx.bookkeeper_email} />
            <ContextField label="Tier" value={clientCtx.tier} />
            <ContextField label="Variant" value={clientCtx.variant} />
            <ContextField label="Founder client" value={clientCtx.founder_client ? 'yes' : 'no'} />
            <ContextField
              label="Setup fee paid"
              value={
                clientCtx.setup_fee_paid_amount != null
                  ? `$${Number(clientCtx.setup_fee_paid_amount).toLocaleString()}${
                      clientCtx.setup_fee_paid_at ? ` on ${fmtDate(clientCtx.setup_fee_paid_at)}` : ''
                    }`
                  : '—'
              }
            />
            <ContextField
              label="Install started"
              value={clientCtx.install_started_at ? fmtDate(clientCtx.install_started_at) : '—'}
            />
            <ContextField
              label="Handoff completed"
              value={clientCtx.handoff_completed_at ? fmtDate(clientCtx.handoff_completed_at) : 'in progress'}
            />
            <ContextField
              label="Support end date"
              value={clientCtx.support_end_date ? fmtDate(clientCtx.support_end_date) : '—'}
            />
          </dl>

          {clientCtx.notes && (
            <div className="mt-4 pt-4 border-t border-ia-border">
              <div className="text-xs font-medium text-ia-muted uppercase tracking-wide mb-1">Notes</div>
              <div className="text-sm text-ia-navy whitespace-pre-wrap">{clientCtx.notes}</div>
            </div>
          )}

          {clientCtx.drive_folder_mappings && (
            <div className="mt-4 pt-4 border-t border-ia-border">
              <div className="text-xs font-medium text-ia-muted uppercase tracking-wide mb-2">
                Drive folder mappings
              </div>
              <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48">
                {JSON.stringify(clientCtx.drive_folder_mappings, null, 2)}
              </pre>
            </div>
          )}

          {clientCtx.brand_palette && (
            <div className="mt-4 pt-4 border-t border-ia-border">
              <div className="text-xs font-medium text-ia-muted uppercase tracking-wide mb-2">
                Brand palette
              </div>
              <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48">
                {JSON.stringify(clientCtx.brand_palette, null, 2)}
              </pre>
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-ia-border text-[11px] text-ia-muted">
            Last updated {fmtRelative(clientCtx.updated_at)}
          </div>
        </div>
      </>
    );
  }

  // Edit mode — form may briefly be null on the first render after toggling
  if (!form) {
    return <LoadingState />;
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <SectionHeader
          title="Edit client context"
          description="Direct edit of the client_context singleton row. Saves are immediate."
        />
      </div>
      <div className="ia-card border-ia-teal/40 bg-ia-teal/[0.03] space-y-4">
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Client ID (read-only)">
            <input
              type="text"
              value={clientCtx.client_id ?? ''}
              disabled
              className="ia-input bg-ia-elevated text-ia-muted"
            />
          </Field>
          <TextField label="Display name" value={form.display_name}
            onChange={(v) => setForm({ ...form, display_name: v })} />
          <TextField label="Owner name" value={form.owner_name}
            onChange={(v) => setForm({ ...form, owner_name: v })} />
          <TextField label="Owner email" value={form.owner_email} type="email"
            onChange={(v) => setForm({ ...form, owner_email: v })} />
          <TextField label="Intake email" value={form.intake_email} type="email"
            onChange={(v) => setForm({ ...form, intake_email: v })} />
          <TextField label="Bookkeeper email" value={form.bookkeeper_email} type="email"
            onChange={(v) => setForm({ ...form, bookkeeper_email: v })} />
          <TextField label="Tier" value={form.tier}
            onChange={(v) => setForm({ ...form, tier: v })} />
          <TextField label="Variant" value={form.variant}
            onChange={(v) => setForm({ ...form, variant: v })} />
          <Field label="Founder client">
            <label className="inline-flex items-center gap-2 text-sm text-ia-navy">
              <input
                type="checkbox"
                checked={!!form.founder_client}
                onChange={(e) => setForm({ ...form, founder_client: e.target.checked })}
                className="rounded border-ia-border"
              />
              <span>{form.founder_client ? 'yes' : 'no'}</span>
            </label>
          </Field>
          <TextField label="Setup fee paid amount" value={form.setup_fee_paid_amount} type="number" step="0.01"
            onChange={(v) => setForm({ ...form, setup_fee_paid_amount: v })} />
          <TextField label="Setup fee paid at" value={form.setup_fee_paid_at} type="datetime-local"
            onChange={(v) => setForm({ ...form, setup_fee_paid_at: v })} />
          <TextField label="Install started" value={form.install_started_at} type="datetime-local"
            onChange={(v) => setForm({ ...form, install_started_at: v })} />
          <TextField label="Handoff completed" value={form.handoff_completed_at} type="datetime-local"
            onChange={(v) => setForm({ ...form, handoff_completed_at: v })} />
          <TextField label="Support end date" value={form.support_end_date} type="date"
            onChange={(v) => setForm({ ...form, support_end_date: v })} />
        </div>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={4}
            className="w-full text-sm text-ia-navy border border-ia-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ia-teal/40 focus:border-ia-teal"
          />
        </Field>

        <Field label="Drive folder mappings (JSON)">
          <textarea
            value={form.drive_folder_mappings_text}
            onChange={(e) => setForm({ ...form, drive_folder_mappings_text: e.target.value })}
            rows={6}
            className="w-full text-xs font-mono text-ia-navy border border-ia-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ia-teal/40 focus:border-ia-teal"
          />
        </Field>

        <Field label="Brand palette (JSON)">
          <textarea
            value={form.brand_palette_text}
            onChange={(e) => setForm({ ...form, brand_palette_text: e.target.value })}
            rows={6}
            className="w-full text-xs font-mono text-ia-navy border border-ia-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ia-teal/40 focus:border-ia-teal"
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-ia-border">
          <button onClick={() => setEditing(false)} disabled={busy} className="ia-button-ghost text-sm">
            <X size={14} />
            <span>Cancel</span>
          </button>
          <button onClick={handleSave} disabled={busy} className="ia-button text-sm">
            <Save size={14} />
            <span>{busy ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs font-medium text-ia-muted uppercase tracking-wide mb-1">{label}</div>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange, type = 'text', step }) {
  return (
    <Field label={label}>
      <input
        type={type}
        value={value ?? ''}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="ia-input"
      />
    </Field>
  );
}

function ContextField({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ia-muted uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-ia-navy break-words">{value ?? '—'}</dd>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers for datetime-local inputs <-> ISO strings
// ----------------------------------------------------------------------------
function toLocalDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDateTime(localStr) {
  if (!localStr) return null;
  const d = new Date(localStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
