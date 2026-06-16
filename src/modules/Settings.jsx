import { useMemo, useState } from 'react';
import {
  Building2, Mail, FileText, Megaphone, Plug,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Star,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { supabase } from '../lib/supabase.js';
import {
  useClientContext, useSystemStatus, useEntities, useSupabaseQuery,
} from '../lib/hooks.js';
import { fmtDate, fmtRelative, cn, truncate } from '../lib/utils.js';

const TABS = [
  { key: 'context',     label: 'Client context',  icon: Building2 },
  { key: 'senders',     label: 'Email senders',   icon: Mail },
  { key: 'templates',   label: 'Email templates', icon: FileText },
  { key: 'social',      label: 'Social accounts', icon: Megaphone },
  { key: 'integrations',label: 'Integrations',    icon: Plug },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState('context');
  return (
    <section className="space-y-6">
      <header>
        <h1>Settings</h1>
        <p className="text-sm text-ia-muted mt-1">
          Read-only view of how your BCC is wired. Edits land in a follow-up release —
          for now, ask your Claude to update settings via the database directly.
        </p>
      </header>

      <div className="flex border-b border-ia-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap',
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

      {activeTab === 'context'      && <ClientContextTab />}
      {activeTab === 'senders'      && <EmailSendersTab />}
      {activeTab === 'templates'    && <EmailTemplatesTab />}
      {activeTab === 'social'       && <SocialAccountsTab />}
      {activeTab === 'integrations' && <IntegrationsTab />}
    </section>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ia-muted uppercase tracking-wide">{label}</dt>
      <dd className={cn('mt-0.5 text-ia-navy', mono && 'font-mono text-sm')}>{value ?? '\u2014'}</dd>
    </div>
  );
}

function ClientContextTab() {
  const { data: ctx, loading } = useClientContext();
  const { data: entities } = useEntities({ includeInactive: true });

  if (loading) return <LoadingState />;
  if (!ctx) {
    return (
      <EmptyState
        icon={Building2}
        title="No client_context row found"
        description="Phase 2 of the install playbook seeds this row. Have your Claude verify the migrations applied."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="ia-card">
        <SectionHeader title="Identity" description="The canonical record of who this BCC belongs to." />
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="Display name"      value={ctx.display_name} />
          <Field label="Owner"             value={ctx.owner_name} />
          <Field label="Owner email"       value={ctx.owner_email} />
          <Field label="Intake email"      value={ctx.intake_email} mono />
          <Field label="Tier"              value={ctx.tier} />
          <Field label="Variant"           value={ctx.variant} />
          <Field label="Founder client"    value={ctx.founder_client ? 'yes' : 'no'} />
          <Field label="Setup fee paid"    value={ctx.setup_fee_paid_amount != null ? `$${Number(ctx.setup_fee_paid_amount).toLocaleString()}` : '\u2014'} />
          <Field label="Install started"   value={ctx.install_started_at ? fmtDate(ctx.install_started_at) : '\u2014'} />
          <Field label="Handoff completed" value={ctx.handoff_completed_at ? fmtDate(ctx.handoff_completed_at) : 'in progress'} />
          <Field label="Support end date"  value={ctx.support_end_date ? fmtDate(ctx.support_end_date) : '\u2014'} />
        </dl>
        {ctx.notes && (
          <div className="mt-4 pt-4 border-t border-ia-border">
            <div className="text-xs font-medium text-ia-muted uppercase mb-1">Notes</div>
            <div className="text-sm text-ia-ink whitespace-pre-wrap">{ctx.notes}</div>
          </div>
        )}
      </div>

      <div className="ia-card">
        <SectionHeader title="Entities" description={`${entities?.length ?? 0} on file (active and inactive)`} />
        {!entities ? <LoadingState /> : entities.length === 0 ? (
          <EmptyState title="No entities yet" description="Phase 2 of the install playbook seeds entities from the discovery intake." />
        ) : (
          <table className="ia-table">
            <thead><tr>
              <th>Short name</th><th>Legal name</th><th>Type</th><th>Role</th><th>State</th><th>FYE</th><th>Active</th>
            </tr></thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-xs">{e.entity_short_name}</td>
                  <td className="text-ia-navy">{e.legal_name}</td>
                  <td>{e.entity_type}</td>
                  <td>{e.entity_role}</td>
                  <td>{e.state ?? '\u2014'}</td>
                  <td className="text-xs text-ia-muted">{e.fiscal_year_end != null ? `month ${e.fiscal_year_end}` : '\u2014'}</td>
                  <td>{e.is_active ? <span className="ia-pill-success">active</span> : <span className="ia-pill-muted">inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ctx.drive_folder_mappings && Object.keys(ctx.drive_folder_mappings).length > 0 && (
        <div className="ia-card">
          <SectionHeader title="Drive folder mappings" description="Where the BCC archives ingested documents per entity." />
          <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-64 font-mono">
            {JSON.stringify(ctx.drive_folder_mappings, null, 2)}
          </pre>
        </div>
      )}

      {ctx.brand_palette && Object.keys(ctx.brand_palette).length > 0 && (
        <div className="ia-card">
          <SectionHeader title="Brand palette" description="Used by social media content generation and any branded reports." />
          <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48 font-mono">
            {JSON.stringify(ctx.brand_palette, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function EmailSendersTab() {
  const { data: senders, loading } = useSupabaseQuery(
    () => supabase
      .from('email_sender_map')
      .select('id, sender_email, entity_id, is_primary, notes, created_at, entities(entity_short_name, legal_name)')
      .order('sender_email', { ascending: true }),
    [],
  );

  if (loading) return <LoadingState />;
  if (!senders || senders.length === 0) {
    return (
      <EmptyState icon={Mail} title="No sender mappings yet"
        description="Senders are added at Phase 4 of the install. Each bookkeeper email becomes a sender_map row pointing at the entity they service." />
    );
  }

  return (
    <div className="ia-card">
      <SectionHeader title="Sender \u2192 entity routing"
        description="The 4th layer of the 5-layer entity ID. When the email-ingest function can't identify the entity from subject, filename, or CSV content, it looks up the sender here." />
      <table className="ia-table">
        <thead><tr><th>Sender</th><th>Entity</th><th>Primary?</th><th>Notes</th></tr></thead>
        <tbody>
          {senders.map((s) => (
            <tr key={s.id}>
              <td className="font-mono text-xs">{s.sender_email}</td>
              <td>
                {s.entities ? (
                  <div>
                    <div className="font-mono text-xs">{s.entities.entity_short_name}</div>
                    <div className="text-xs text-ia-muted">{s.entities.legal_name}</div>
                  </div>
                ) : <span className="text-ia-muted">\u2014 entity missing \u2014</span>}
              </td>
              <td>
                {s.is_primary
                  ? <span className="ia-pill-info inline-flex items-center gap-1"><Star size={10} /> primary</span>
                  : <span className="text-xs text-ia-muted">\u2014</span>}
              </td>
              <td className="text-xs text-ia-muted">{s.notes ?? '\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmailTemplatesTab() {
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
      <EmptyState icon={FileText} title="No email templates"
        description="The IA master template ships exactly one template (ingest_receipt). It is seeded automatically by migration 003." />
    );
  }

  return (
    <div className="space-y-3">
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
                {truncate(t.subject_template ?? t.subject_line ?? '\u2014', 100)}
              </div>
              {t.description && <div className="text-xs text-ia-muted mt-1">{truncate(t.description, 160)}</div>}
            </div>
          </button>

          {expandedId === t.id && (
            <div className="mt-3 pt-3 border-t border-ia-border space-y-3">
              <div>
                <div className="text-xs font-medium text-ia-muted uppercase mb-1">Subject line</div>
                <div className="text-sm font-mono bg-ia-cream-dark p-2 rounded">
                  {t.subject_template ?? t.subject_line ?? '\u2014'}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-ia-muted uppercase mb-1">HTML body (preview)</div>
                <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-72 whitespace-pre-wrap break-words">
                  {t.html_body_template ?? t.html_body ?? '\u2014'}
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

function SocialAccountsTab() {
  const { data: accounts, loading } = useSupabaseQuery(
    () => supabase
      .from('social_accounts')
      .select('*, entities(entity_short_name, legal_name)')
      .order('platform', { ascending: true })
      .order('handle', { ascending: true }),
    [],
  );

  if (loading) return <LoadingState />;
  if (!accounts || accounts.length === 0) {
    return (
      <EmptyState icon={Megaphone} title="No social accounts configured"
        description="Add accounts during install or via the Social Media module. Most clients run 1-3 platforms." />
    );
  }

  return (
    <div className="ia-card">
      <SectionHeader title="Connected social accounts"
        description="Posting method 'api' uses Composio; 'manual_daily' means a daily prompt for the operator to post by hand. Instagram is the typical manual_daily case." />
      <table className="ia-table">
        <thead><tr>
          <th>Platform</th><th>Handle</th><th>Entity</th><th>Method</th><th>Active</th><th>Brand voice notes</th>
        </tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td><span className="ia-pill-info">{a.platform}</span></td>
              <td className="font-mono text-xs">{a.handle}</td>
              <td className="text-xs">
                {a.entities ? (
                  <>
                    <div className="font-mono">{a.entities.entity_short_name}</div>
                    <div className="text-ia-muted">{a.entities.legal_name}</div>
                  </>
                ) : '\u2014'}
              </td>
              <td>
                <span className={a.posting_method === 'api' ? 'ia-pill-success' : 'ia-pill-warning'}>
                  {a.posting_method}
                </span>
              </td>
              <td>{a.is_active ? <span className="ia-pill-success">on</span> : <span className="ia-pill-muted">off</span>}</td>
              <td className="text-xs text-ia-muted">{truncate(a.brand_voice_notes, 100) ?? '\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntegrationsTab() {
  const { data: status, loading } = useSystemStatus();

  if (loading) return <LoadingState />;
  if (!status) {
    return (
      <EmptyState icon={Plug} title="No system_status row found"
        description="The status singleton is created at the end of Phase 3. Run the install playbook to seed it." />
    );
  }

  const health = status.composio_connection_health ?? {};
  const toolkits = Object.keys(health);

  return (
    <div className="space-y-6">
      <div className="ia-card">
        <SectionHeader title="System overview"
          description="Snapshot of the operating posture, refreshed by the system_status_refresh recipe." />
        <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Field label="BCC version"     value={status.bcc_version} mono />
          <Field label="Overall health"  value={status.overall_health} />
          <Field label="Last check"      value={status.last_health_check_at ? fmtRelative(status.last_health_check_at) : '\u2014'} />
          <Field label="Active entities" value={status.active_entities_count} />
          <Field label="Last ingest"     value={status.last_email_ingest_at ? fmtRelative(status.last_email_ingest_at) : 'never'} />
          <Field label="Last parser run" value={status.last_parser_run_at ? fmtRelative(status.last_parser_run_at) : 'never'} />
          <Field label="Last automation" value={status.last_automation_run_at ? fmtRelative(status.last_automation_run_at) : 'never'} />
          <Field label="Ingest queue"    value={status.ingest_queue_depth} />
          <Field label="Failures 24h"    value={status.automation_failed_24h} />
        </dl>
      </div>

      <div className="ia-card">
        <SectionHeader title="Composio connection health"
          description={toolkits.length ? `${toolkits.length} toolkit${toolkits.length === 1 ? '' : 's'} wired` : 'No toolkit health recorded yet'} />
        {toolkits.length === 0 ? (
          <EmptyState title="No toolkit health recorded"
            description="Phase 3 of the install wires Composio connections and seeds this map." />
        ) : (
          <ul className="divide-y divide-ia-border">
            {toolkits.map((tk) => {
              const h = health[tk] ?? {};
              const ok = h.status === 'connected' || h.status === 'healthy' || h.connected === true;
              const StatusIcon = ok ? CheckCircle2 : (h.status === 'degraded' ? AlertCircle : XCircle);
              return (
                <li key={tk} className="py-2 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <StatusIcon size={16} className={cn(
                      'mt-0.5 flex-shrink-0',
                      ok ? 'text-emerald-700' : (h.status === 'degraded' ? 'text-amber-700' : 'text-red-700')
                    )} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-ia-navy">{tk}</div>
                      <div className="text-xs text-ia-muted">
                        {h.status ?? (ok ? 'connected' : 'unknown')}
                        {h.last_checked_at && <> \u00b7 checked {fmtRelative(h.last_checked_at)}</>}
                        {h.account_id && <> \u00b7 account {h.account_id}</>}
                      </div>
                      {h.error && <div className="text-xs text-red-700 mt-0.5">{h.error}</div>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 pt-3 border-t border-ia-border">
          <div className="text-xs font-medium text-ia-muted uppercase mb-1">Raw payload</div>
          <pre className="text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48 font-mono">
            {JSON.stringify(health, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
