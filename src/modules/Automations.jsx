import { useMemo, useState } from 'react';
import {
  Workflow, Play, Pause, ChevronDown, ChevronRight, RefreshCw,
  CheckCircle2, XCircle, Clock, AlertCircle, Cpu, Cable, Mail, FileText,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
import PrintButton from '../components/PrintButton.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { supabase } from '../lib/supabase.js';
import { useSupabaseQuery } from '../lib/hooks.js';
import { fmtRelative, fmtDate, cn, truncate } from '../lib/utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recipeStatusTone(recipe) {
  if (!recipe.is_active) return 'muted';
  if (recipe.last_error) return 'danger';
  if (recipe.failure_count > recipe.success_count && recipe.failure_count > 0) return 'warning';
  return 'success';
}

function recipeStatusLabel(recipe) {
  if (!recipe.is_active) return 'disabled';
  if (recipe.last_error) return 'last-run failed';
  if (recipe.failure_count > recipe.success_count && recipe.failure_count > 0) return 'unstable';
  if (recipe.last_run_at) return 'active';
  return 'never run';
}

function runStatusPillClass(status) {
  switch (status) {
    case 'success':  return 'ia-pill-success';
    case 'failed':   return 'ia-pill-danger';
    case 'running':  return 'ia-pill-info';
    case 'queued':   return 'ia-pill-muted';
    case 'skipped':  return 'ia-pill-muted';
    case 'timeout':  return 'ia-pill-danger';
    default:         return 'ia-pill-muted';
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const SORT_OPTIONS = [
  { key: 'next_due',   label: 'Next due' },
  { key: 'last_run',   label: 'Last run' },
  { key: 'recipe_key', label: 'Name' },
];

const VIEW_TABS = [
  { key: 'recipes',   label: 'Recipes' },
  { key: 'templates', label: 'Templates' },
];

export default function Automations() {
  const [activeView, setActiveView] = useState('recipes');
  const [activeFilter, setActiveFilter] = useState('all');  // all|active|disabled
  const [activeKind, setActiveKind] = useState('all');      // all|internal|composio
  const [activeCategory, setActiveCategory] = useState(null);
  const [sortBy, setSortBy] = useState('next_due');
  const [expandedId, setExpandedId] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const { data: recipes, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('automation_recipes')
      .select('*')
      .order('recipe_key', { ascending: true }),
    [],
  );

  // Category pills derived from data
  const categoryCounts = useMemo(() => {
    const c = {};
    (recipes ?? []).forEach((r) => {
      const cat = r.category ?? 'uncategorized';
      c[cat] = (c[cat] ?? 0) + 1;
    });
    return c;
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    let xs = recipes ?? [];
    if (activeFilter === 'active')   xs = xs.filter((r) => r.is_active);
    if (activeFilter === 'disabled') xs = xs.filter((r) => !r.is_active);
    if (activeKind === 'internal')   xs = xs.filter((r) => r.is_internal);
    if (activeKind === 'composio')   xs = xs.filter((r) => !r.is_internal);
    if (activeCategory) xs = xs.filter((r) => (r.category ?? 'uncategorized') === activeCategory);

    xs = [...xs];
    if (sortBy === 'last_run') {
      xs.sort((a, b) => (b.last_run_at ?? '').localeCompare(a.last_run_at ?? ''));
    } else if (sortBy === 'next_due') {
      xs.sort((a, b) => {
        // active first, then by next_run_at, then by last_run_at
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (a.next_run_at ?? 'z').localeCompare(b.next_run_at ?? 'z');
      });
    } else {
      xs.sort((a, b) => a.recipe_key.localeCompare(b.recipe_key));
    }
    return xs;
  }, [recipes, activeFilter, activeKind, activeCategory, sortBy]);

  async function toggleActive(recipe) {
    setBusyKey(recipe.recipe_key);
    try {
      await supabase
        .from('automation_recipes')
        .update({ is_active: !recipe.is_active })
        .eq('id', recipe.id);
      await refetch();
    } catch (err) {
      console.error('toggleActive failed', err);
    } finally {
      setBusyKey(null);
    }
  }

  async function runNow(recipe) {
    setBusyKey(recipe.recipe_key);
    try {
      // Fire-and-forget POST to automation-runner Edge Function.
      // The Edge Function URL pattern: <supabase-url>/functions/v1/automation-runner
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/automation-runner`;
      const session = (await supabase.auth.getSession()).data?.session;
      const ownerEmail = session?.user?.email ?? 'webapp';
      await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          recipe_key: recipe.recipe_key,
          triggered_by: `manual:${ownerEmail}`,
        }),
      });
      // Refetch after a small delay so any quick INTERNAL recipes have time to log a run.
      setTimeout(() => refetch(), 1500);
    } catch (err) {
      console.error('runNow failed', err);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Automations</h1>
          <p className="text-sm text-ia-muted mt-1">
            Recipes that read, write, and notify on a schedule. Run on demand or toggle off
            entirely.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton title="BCC Automations" />
          <AskClaudeButton
            moduleLabel="Automations module"
            subject="Automations module"
            context={{ activeView, recipes: recipes ?? [], recent_runs: runs ?? [] }}
            suggestedPrompt="Walk me through my active recipes and recent run history. Anything failing, slow, or worth pausing?"
          />
          <button className="ia-button-ghost" onClick={refetch} aria-label="Refresh">
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
        </div>
      </header>

      {/* View tabs: Recipes | Templates */}
      <div className="flex border-b border-ia-border">
        {VIEW_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveView(t.key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
              activeView === t.key
                ? 'border-ia-teal text-ia-teal font-medium'
                : 'border-transparent text-ia-muted hover:text-ia-navy'
            )}
          >
            {t.key === 'recipes' ? <Workflow size={14} /> : <FileText size={14} />}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {activeView === 'templates' && <EmailTemplatesView />}

      {activeView === 'recipes' && (<>
      {/* Filter row */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ia-muted uppercase mr-1">Status</span>
          <FilterPill label="All"      active={activeFilter === 'all'}      onClick={() => setActiveFilter('all')}      count={recipes?.length ?? 0} />
          <FilterPill label="Active"   active={activeFilter === 'active'}   onClick={() => setActiveFilter('active')}   count={(recipes ?? []).filter((r) => r.is_active).length} />
          <FilterPill label="Disabled" active={activeFilter === 'disabled'} onClick={() => setActiveFilter('disabled')} count={(recipes ?? []).filter((r) => !r.is_active).length} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ia-muted uppercase mr-1">Kind</span>
          <FilterPill label="All"      active={activeKind === 'all'}      onClick={() => setActiveKind('all')} />
          <FilterPill label="Internal" active={activeKind === 'internal'} onClick={() => setActiveKind('internal')} count={(recipes ?? []).filter((r) => r.is_internal).length} />
          <FilterPill label="Composio" active={activeKind === 'composio'} onClick={() => setActiveKind('composio')} count={(recipes ?? []).filter((r) => !r.is_internal).length} />
        </div>

        {Object.keys(categoryCounts).length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ia-muted uppercase mr-1">Category</span>
            <FilterPill label="All" active={!activeCategory} onClick={() => setActiveCategory(null)} />
            {Object.entries(categoryCounts).map(([cat, n]) => (
              <FilterPill
                key={cat}
                label={cat.replace(/_/g, ' ')}
                active={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
                count={n}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs">
          <span className="text-ia-muted">Sort by</span>
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setSortBy(o.key)}
              className={cn(
                'px-2 py-0.5 rounded-full',
                sortBy === o.key ? 'bg-ia-teal text-white' : 'text-ia-muted hover:text-ia-navy'
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="ia-card border-red-200 bg-red-50/50 text-sm text-red-800">
          Failed to load automations: {String(error.message ?? error)}
        </div>
      ) : loading ? (
        <LoadingState />
      ) : filteredRecipes.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No recipes match these filters"
          description="Clear filters above or activate disabled recipes during the install playbook."
        />
      ) : (
        <ul className="space-y-2">
          {filteredRecipes.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              expanded={expandedId === r.id}
              onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
              onToggleActive={() => toggleActive(r)}
              onRunNow={() => runNow(r)}
              busy={busyKey === r.recipe_key}
            />
          ))}
        </ul>
      )}
      </>)}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Email templates view (moved from Settings)
// ---------------------------------------------------------------------------

function EmailTemplatesView() {
  const { data: templates, loading } = useSupabaseQuery(
    () => supabase
      .from('email_templates')
      .select('*')
      .order('category', { ascending: true })
      .order('template_key', { ascending: true }),
    [],
  );
  const [expandedId, setExpandedId] = useState(null);

  if (loading) return <LoadingState />;
  if (!templates || templates.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No email templates"
        description="Templates are seeded by migration 003. Each automation recipe can reference a template by key."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-ia-muted">
        Bodies and subjects used by COMPOSIO:step_chain recipes via GMAIL_SEND_EMAIL. Read-only — edit in Supabase Studio or via Claude.
      </div>
      {templates.map((t) => (
        <div key={t.id} className="ia-card-tight">
          <button type="button" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
            className="w-full flex items-start gap-2 text-left">
            {expandedId === t.id
              ? <ChevronDown size={16} className="text-ia-muted mt-0.5" />
              : <ChevronRight size={16} className="text-ia-muted mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ia-navy text-sm">{t.display_name ?? t.template_key}</span>
                <span className="ia-pill-muted">{t.category ?? 'uncategorized'}</span>
                {t.is_active ? <span className="ia-pill-success">active</span> : <span className="ia-pill-muted">inactive</span>}
              </div>
              <div className="text-xs font-mono text-ia-muted mt-1">{t.template_key}</div>
              <div className="text-xs text-ia-ink mt-1">
                <span className="text-ia-muted">subject: </span>
                {truncate(t.subject_template ?? t.subject_line ?? '—', 100)}
              </div>
              {t.description && <div className="text-xs text-ia-muted mt-1">{truncate(t.description, 160)}</div>}
            </div>
          </button>

          {expandedId === t.id && (
            <div className="mt-3 pt-3 border-t border-ia-border space-y-3">
              <div>
                <div className="text-xs font-medium text-ia-muted uppercase mb-1">Subject line</div>
                <div className="text-sm font-mono bg-ia-cream-dark p-2 rounded">
                  {t.subject_template ?? t.subject_line ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-ia-muted uppercase mb-1">HTML body (preview)</div>
                <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-72 whitespace-pre-wrap break-words">
                  {t.html_body_template ?? t.html_body ?? '—'}
                </pre>
              </div>
              {t.text_body_template && (
                <div>
                  <div className="text-xs font-medium text-ia-muted uppercase mb-1">Plain-text body</div>
                  <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48 whitespace-pre-wrap">
                    {t.text_body_template}
                  </pre>
                </div>
              )}
              {t.variable_schema && Object.keys(t.variable_schema).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-ia-muted uppercase mb-1">Variables expected</div>
                  <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-40 font-mono">
                    {JSON.stringify(t.variable_schema, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipe card (collapsible)
// ---------------------------------------------------------------------------

function RecipeCard({ recipe, expanded, onToggleExpand, onToggleActive, onRunNow, busy }) {
  const tone = recipeStatusTone(recipe);
  const statusClass = {
    success: 'ia-pill-success',
    warning: 'ia-pill-warning',
    danger:  'ia-pill-danger',
    muted:   'ia-pill-muted',
  }[tone];

  const kindPillClass = recipe.is_internal ? 'ia-pill-info' : 'ia-pill-muted';
  const KindIcon = recipe.is_internal ? Cpu : Cable;

  return (
    <li className="ia-card-tight">
      <div className="flex items-center justify-between gap-3">
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
              <span className="font-medium text-sm text-ia-navy">{recipe.name ?? recipe.recipe_key}</span>
              <span className={cn('ia-pill', kindPillClass, 'inline-flex items-center gap-1')}>
                <KindIcon size={10} />
                {recipe.is_internal ? 'internal' : 'composio'}
              </span>
              {recipe.category && (
                <span className="ia-pill-muted">{recipe.category}</span>
              )}
              <span className={statusClass}>{recipeStatusLabel(recipe)}</span>
            </div>
            <div className="text-xs text-ia-muted mt-1 font-mono">{recipe.recipe_key}</div>
            <div className="text-xs text-ia-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
              {recipe.schedule_cron && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  <code className="font-mono text-[11px]">{recipe.schedule_cron}</code>
                </span>
              )}
              {recipe.last_run_at && <span>last ran {fmtRelative(recipe.last_run_at)}</span>}
              {recipe.next_run_at && recipe.is_active && (
                <span>next {fmtRelative(recipe.next_run_at)}</span>
              )}
              <span className="text-emerald-700">{recipe.success_count} ✓</span>
              {recipe.failure_count > 0 && (
                <span className="text-red-700">{recipe.failure_count} ✗</span>
              )}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onRunNow}
            disabled={busy}
            className="ia-button text-xs"
            title="Trigger this recipe now"
          >
            <Play size={12} />
            <span>Run now</span>
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busy}
            className={cn('ia-button-ghost text-xs', !recipe.is_active && 'text-ia-muted')}
            title={recipe.is_active ? 'Disable this recipe' : 'Enable this recipe'}
          >
            {recipe.is_active ? <Pause size={12} /> : <Play size={12} />}
            <span>{recipe.is_active ? 'Disable' : 'Enable'}</span>
          </button>
        </div>
      </div>

      {expanded && (
        <RecipeDetail recipe={recipe} />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Expanded recipe detail — recent runs + input config
// ---------------------------------------------------------------------------

function RecipeDetail({ recipe }) {
  const { data: runs, loading } = useSupabaseQuery(
    () => supabase
      .from('automation_runs')
      .select('id, status, triggered_by, started_at, completed_at, duration_ms, records_written, records_skipped, error_message, retry_count')
      .eq('recipe_id', recipe.id)
      .order('started_at', { ascending: false })
      .limit(10),
    [recipe.id],
  );

  return (
    <div className="mt-3 pt-3 border-t border-ia-border space-y-4">
      {recipe.description && (
        <div className="text-sm text-ia-ink">{recipe.description}</div>
      )}

      {recipe.last_error && (
        <div className="ia-card-tight border-red-200 bg-red-50/50 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-medium">Last error</div>
            <div className="mt-1 font-mono whitespace-pre-wrap break-words">{recipe.last_error}</div>
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-ia-muted uppercase mb-2">Recent runs (last 10)</div>
        {loading ? (
          <LoadingState />
        ) : !runs || runs.length === 0 ? (
          <div className="text-xs text-ia-muted py-2">No runs yet.</div>
        ) : (
          <table className="ia-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Trigger</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Writes</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={runStatusPillClass(r.status)}>{r.status}</span>
                  </td>
                  <td className="text-xs text-ia-muted">{r.triggered_by ?? '—'}</td>
                  <td className="text-xs text-ia-muted">{r.started_at ? fmtRelative(r.started_at) : '—'}</td>
                  <td className="text-xs text-ia-muted">
                    {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="text-xs text-ia-muted">
                    {r.records_written ?? 0}
                    {r.records_skipped > 0 && <span className="text-amber-700"> ({r.records_skipped} skipped)</span>}
                  </td>
                  <td className="text-xs text-ia-muted">{truncate(r.error_message, 80) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {recipe.input_config && Object.keys(recipe.input_config).length > 0 && (
        <div>
          <div className="text-xs font-medium text-ia-muted uppercase mb-2">Input config</div>
          <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-64 font-mono">
            {JSON.stringify(recipe.input_config, null, 2)}
          </pre>
        </div>
      )}

      {recipe.output_targets && Object.keys(recipe.output_targets).length > 0 && (
        <div>
          <div className="text-xs font-medium text-ia-muted uppercase mb-2">Output targets</div>
          <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48 font-mono">
            {JSON.stringify(recipe.output_targets, null, 2)}
          </pre>
        </div>
      )}

      {recipe.notes && (
        <div>
          <div className="text-xs font-medium text-ia-muted uppercase mb-1">Notes</div>
          <div className="text-xs text-ia-ink whitespace-pre-wrap">{recipe.notes}</div>
        </div>
      )}

      <div className="text-xs text-ia-muted flex items-center gap-3 pt-2 border-t border-ia-border">
        {recipe.last_run_at && <span><Clock size={11} className="inline mr-0.5" /> last ran {fmtDate(recipe.last_run_at, 'PPpp')}</span>}
        <span>created {fmtDate(recipe.created_at, 'MMM d, yyyy')}</span>
      </div>
    </div>
  );
}
