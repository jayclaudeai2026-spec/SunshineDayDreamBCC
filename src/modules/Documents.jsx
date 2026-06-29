import { useMemo, useState } from 'react';
import { ExternalLink, FileText, Tag, Filter } from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import PrintButton from '../components/PrintButton.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { supabase } from '../lib/supabase.js';
import { useEntities, useSupabaseQuery } from '../lib/hooks.js';
import { fmtDate, fmtRelative, truncate } from '../lib/utils.js';

const CATEGORIES = [
  'financial', 'tax', 'legal', 'contract', 'payroll', 'hr',
  'insurance', 'compliance', 'marketing', 'operational',
  'real_estate', 'banking', 'other',
];

export default function Documents() {
  const { data: entities } = useEntities();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeEntity, setActiveEntity] = useState(null);

  const { data: docs, loading } = useSupabaseQuery(
    () => {
      let q = supabase
        .from('documents')
        .select('id, entity_id, drive_file_id, drive_url, file_name, file_extension, mime_type, size_bytes, category, tags, description, reporting_period, tax_year, source, uploaded_by_email, is_archived, created_at')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(200);
      if (activeCategory) q = q.eq('category', activeCategory);
      if (activeEntity)   q = q.eq('entity_id', activeEntity);
      // We do client-side filtering for the free-text search; Supabase
      // websearch_to_tsquery via RPC is cleaner but requires a server-side fn.
      // For 200 rows the client-side filter is comfortable.
      return q;
    },
    [activeCategory, activeEntity],
  );

  // Counts per category (across all returned docs, not just current filter)
  const { data: allDocsForCounts } = useSupabaseQuery(
    () => supabase
      .from('documents')
      .select('category', { count: 'exact' })
      .eq('is_archived', false)
      .limit(2000),
    [],
  );

  const categoryCounts = useMemo(() => {
    const counts = {};
    (allDocsForCounts ?? []).forEach((d) => {
      counts[d.category] = (counts[d.category] ?? 0) + 1;
    });
    return counts;
  }, [allDocsForCounts]);

  const filtered = useMemo(() => {
    if (!docs) return [];
    if (!search.trim()) return docs;
    const needle = search.trim().toLowerCase();
    return docs.filter((d) => {
      const haystack = [
        d.file_name,
        d.description,
        ...(d.tags ?? []),
        d.category,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [docs, search]);

  const entityById = useMemo(() => {
    const m = new Map();
    (entities ?? []).forEach((e) => m.set(e.id, e.entity_short_name));
    return m;
  }, [entities]);

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Documents</h1>
          <p className="text-sm text-ia-muted mt-1">
            Searchable index of every Drive document. Files live in Drive; this table indexes
            them for fast lookup by name, description, tags, and full-text content.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end ia-no-print">
          <PrintButton title="BCC Documents — search results" />
          <AskClaudeButton
            moduleLabel="Documents"
            subject={`Document search · ${(filtered ?? []).length} of ${(allDocsForCounts ?? []).length} shown`}
            context={{
              search,
              active_category: activeCategory,
              active_entity: activeEntity,
              total_indexed: (allDocsForCounts ?? []).length,
              filtered_count: (filtered ?? []).length,
              category_counts: categoryCounts,
            }}
            suggestedPrompt="Help me find what I'm looking for in here, or summarize what's been arriving lately by category."
          />
        </div>
      </header>

      <div className="ia-card">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search filename, description, tags…"
            autoFocus
          />
          {entities && entities.length > 1 && (
            <select
              value={activeEntity ?? ''}
              onChange={(e) => setActiveEntity(e.target.value ? Number(e.target.value) : null)}
              className="ia-input max-w-[12rem] py-1.5"
            >
              <option value="">All entities</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.entity_short_name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-ia-muted">
            <Filter size={12} />
            <span>Category:</span>
          </div>
          <FilterPill
            label="All"
            active={!activeCategory}
            onClick={() => setActiveCategory(null)}
            count={Object.values(categoryCounts).reduce((s, n) => s + n, 0)}
          />
          {CATEGORIES.map((c) => (
            <FilterPill
              key={c}
              label={c.replace(/_/g, ' ')}
              active={activeCategory === c}
              onClick={() => setActiveCategory(c)}
              count={categoryCounts[c]}
            />
          ))}
        </div>
      </div>

      <div className="ia-card">
        <SectionHeader
          title={
            loading ? 'Loading…'
              : `${filtered.length} document${filtered.length === 1 ? '' : 's'}`
                + (search ? ` matching "${truncate(search, 30)}"` : '')
          }
        />
        {loading ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={search ? 'No matches' : 'No documents yet'}
            description={
              search
                ? 'Try a shorter search or clear the filters.'
                : 'Documents land here automatically when the email-ingest pipeline processes attachments, or you can upload manually.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ia-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Entity</th>
                  <th>Category</th>
                  <th>Tags</th>
                  <th>Period / Year</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div className="font-medium text-ia-navy">{truncate(d.file_name, 60)}</div>
                      {d.description && (
                        <div className="text-xs text-ia-muted mt-0.5">
                          {truncate(d.description, 80)}
                        </div>
                      )}
                    </td>
                    <td className="text-sm">
                      {d.entity_id ? entityById.get(d.entity_id) ?? `#${d.entity_id}` : '—'}
                    </td>
                    <td>
                      <span className="ia-pill-info">
                        {(d.category ?? 'other').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="text-xs text-ia-muted">
                      {(d.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="inline-flex items-center gap-0.5 mr-1.5">
                          <Tag size={10} /><span>{t}</span>
                        </span>
                      ))}
                      {(d.tags?.length ?? 0) > 3 && (
                        <span className="text-ia-muted">+{d.tags.length - 3} more</span>
                      )}
                    </td>
                    <td className="text-xs text-ia-muted">
                      {d.reporting_period && fmtDate(d.reporting_period, 'MMM yyyy')}
                      {d.tax_year && (d.reporting_period ? ' · ' : '') + `TY ${d.tax_year}`}
                      {!d.reporting_period && !d.tax_year && '—'}
                    </td>
                    <td className="text-xs text-ia-muted whitespace-nowrap">
                      {fmtRelative(d.created_at)}
                    </td>
                    <td>
                      {d.drive_url ? (
                        <a
                          href={d.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-ia-teal hover:text-ia-teal-700 no-underline text-xs"
                        >
                          <ExternalLink size={12} /><span>Open</span>
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
