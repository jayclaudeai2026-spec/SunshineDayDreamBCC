import { useMemo, useState } from 'react';
import {
  Building2, Mail, Plug,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Star,
  Database, Cloud, Github, HardDrive, Calendar,
  Instagram, Facebook, Linkedin, Twitter, Youtube, Music2,
  Workflow, Activity, ExternalLink, Copy,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { supabase } from '../lib/supabase.js';
import {
  useClientContext, useSystemStatus, useEntities, useSupabaseQuery,
} from '../lib/hooks.js';
import { fmtDate, fmtRelative, cn } from '../lib/utils.js';

const TABS = [
  { key: 'context',     label: 'Client context',  icon: Building2 },
  { key: 'senders',     label: 'Email senders',   icon: Mail },
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
      {activeTab === 'integrations' && <IntegrationsTab />}
    </section>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ia-muted uppercase tracking-wide">{label}</dt>
      <dd className={cn('mt-0.5 text-ia-navy', mono && 'font-mono text-sm')}>{value ?? '—'}</dd>
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
          <Field label="Setup fee paid"    value={ctx.setup_fee_paid_amount != null ? `$${Number(ctx.setup_fee_paid_amount).toLocaleString()}` : '—'} />
          <Field label="Install started"   value={ctx.install_started_at ? fmtDate(ctx.install_started_at) : '—'} />
          <Field label="Handoff completed" value={ctx.handoff_completed_at ? fmtDate(ctx.handoff_completed_at) : 'in progress'} />
          <Field label="Support end date"  value={ctx.support_end_date ? fmtDate(ctx.support_end_date) : '—'} />
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
                  <td>{e.state ?? '—'}</td>
                  <td className="text-xs text-ia-muted">{e.fiscal_year_end != null ? `month ${e.fiscal_year_end}` : '—'}</td>
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
      <SectionHeader title="Sender → entity routing"
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
                ) : <span className="text-ia-muted">— entity missing —</span>}
              </td>
              <td>
                {s.is_primary
                  ? <span className="ia-pill-info inline-flex items-center gap-1"><Star size={10} /> primary</span>
                  : <span className="text-xs text-ia-muted">—</span>}
              </td>
              <td className="text-xs text-ia-muted">{s.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntegrationsTab() {
  const { data: status, loading: statusLoading } = useSystemStatus();

  const { data: ingestStats } = useSupabaseQuery(
    async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [ingest7d, ingest24h, docsTotal, autoRuns24h, autoFailed24h, gmailSent7d] = await Promise.all([
        supabase.from('ingest_log').select('id', { count: 'exact', head: true }).gte('received_at', sevenDaysAgo),
        supabase.from('ingest_log').select('id', { count: 'exact', head: true }).gte('received_at', dayAgo),
        supabase.from('documents').select('id', { count: 'exact', head: true }),
        supabase.from('automation_runs').select('id', { count: 'exact', head: true }).gte('started_at', dayAgo),
        supabase.from('automation_runs').select('id', { count: 'exact', head: true }).gte('started_at', dayAgo).eq('status', 'failed'),
        supabase.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', sevenDaysAgo),
      ]);
      return {
        data: {
          ingest_7d: ingest7d.count ?? 0,
          ingest_24h: ingest24h.count ?? 0,
          docs_total: docsTotal.count ?? 0,
          auto_24h: autoRuns24h.count ?? 0,
          auto_failed_24h: autoFailed24h.count ?? 0,
          gmail_sent_7d: gmailSent7d.count ?? 0,
        },
        error: null,
      };
    },
    [],
  );

  const { data: socialAccounts } = useSupabaseQuery(
    () => supabase.from('social_accounts').select('platform, is_active, account_name, handle, brand_voice_notes'),
    [],
  );

  if (statusLoading) return <LoadingState />;

  // Recency-based health
  const ingestRecent = status?.last_email_ingest_at
    && (Date.now() - new Date(status.last_email_ingest_at).getTime()) < 24 * 3600 * 1000;
  const parserRecent = status?.last_parser_run_at
    && (Date.now() - new Date(status.last_parser_run_at).getTime()) < 24 * 3600 * 1000;
  const autoRecent = status?.last_automation_run_at
    && (Date.now() - new Date(status.last_automation_run_at).getTime()) < 2 * 3600 * 1000;

  const socialByPlatform = (socialAccounts ?? []).reduce((acc, row) => {
    acc[row.platform] = acc[row.platform] || { active: 0, inactive: 0, rows: [] };
    if (row.is_active) acc[row.platform].active++; else acc[row.platform].inactive++;
    acc[row.platform].rows.push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {/* System overview (compact) */}
      <div className="ia-card">
        <SectionHeader title="System overview"
          description="Snapshot of the operating posture, refreshed by the system_status_refresh recipe." />
        <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Field label="BCC version"     value={status?.bcc_version} mono />
          <Field label="Overall health"  value={status?.overall_health} />
          <Field label="Last check"      value={status?.last_health_check_at ? fmtRelative(status.last_health_check_at) : '—'} />
          <Field label="Active entities" value={status?.active_entities_count} />
          <Field label="Last ingest"     value={status?.last_email_ingest_at ? fmtRelative(status.last_email_ingest_at) : 'never'} />
          <Field label="Last parser run" value={status?.last_parser_run_at ? fmtRelative(status.last_parser_run_at) : 'never'} />
          <Field label="Last automation" value={status?.last_automation_run_at ? fmtRelative(status.last_automation_run_at) : 'never'} />
          <Field label="Ingest queue"    value={status?.ingest_queue_depth ?? 0} />
          <Field label="Failures 24h"    value={ingestStats?.auto_failed_24h ?? status?.automation_failed_24h ?? 0} />
        </dl>
      </div>

      {/* DOCUMENT FLOW DIAGRAM */}
      <div className="ia-card">
        <SectionHeader
          title="How documents flow through the system"
          description="Rebecca emails monthly financials — they land in the database, get filed in Drive, parse into Financials, and surface on the Documents page." />
        <PipelineDiagram status={status} ingestStats={ingestStats} />
      </div>

      {/* CORE INFRASTRUCTURE */}
      <div>
        <SectionHeader
          title="Core infrastructure"
          description="The four services that keep the BCC running. If one of these is down, the system is down." />
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <IntegrationCard
            name="Supabase"
            icon={Database}
            description="Database, auth, edge functions, cron"
            status="connected"
            detail={[
              'Project: qlcwzlejluyluunjhtki',
              'Region: us-east-2 · Postgres 17.6',
              `Active entities: ${status?.active_entities_count ?? '—'}`,
            ]}
            externalUrl="https://supabase.com/dashboard/project/qlcwzlejluyluunjhtki"
            reconnectPrompt="The webapp can't reach Supabase. Walk me through checking the Supabase project status, verifying my anon key in Vercel env vars matches the dashboard, and re-deploying if needed."
          />
          <IntegrationCard
            name="Composio"
            icon={Plug}
            description="Routes Gmail, Drive, GitHub through MCP servers Claude uses"
            status={ingestRecent ? 'connected' : 'unknown'}
            detail={[
              `Inferred from email-ingest: ${ingestRecent ? 'working' : 'no recent ingests'}`,
              `${ingestStats?.ingest_7d ?? 0} ingests in last 7d`,
              `${ingestStats?.gmail_sent_7d ?? 0} outbound emails sent in last 7d`,
            ]}
            externalUrl="https://app.composio.dev"
            reconnectPrompt="I think my Composio connections might be stale. Help me walk through each connected toolkit (Gmail, Google Drive, GitHub), check if they need re-auth, and fix any that look broken."
          />
          <IntegrationCard
            name="GitHub"
            icon={Github}
            description="BCC repo: migrations, edge functions, webapp source"
            status="connected"
            detail={[
              'Repo: jayclaudeai2026-spec/SunshineDayDreamBCC',
              'Accessed via Composio MCP for commits',
            ]}
            externalUrl="https://github.com/jayclaudeai2026-spec/SunshineDayDreamBCC"
            reconnectPrompt="Claude can't push to GitHub. Check the GitHub connection in Composio, verify the token still has push permissions on the SunshineDayDreamBCC repo, and reconnect if needed."
          />
          <IntegrationCard
            name="Vercel"
            icon={Cloud}
            description="Hosts the webapp at sunshine-day-dream-bcc.vercel.app"
            status="connected"
            detail={[
              'Domain: sunshine-day-dream-bcc.vercel.app',
              'Auto-deploys from main on every push',
            ]}
            externalUrl="https://vercel.com/dashboard"
            reconnectPrompt="A recent commit didn't deploy to Vercel — help me check the latest deployment status, look at the build log if it failed, and trigger a redeploy."
          />
        </div>
      </div>

      {/* AUTOMATION ENGINE */}
      <div>
        <SectionHeader
          title="Automation engine"
          description="Cron-driven edge functions that ingest email, parse reports, refresh status, and run scheduled recipes." />
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <IntegrationCard
            name="email-ingest edge function"
            icon={Workflow}
            description="Polls Gmail every 10 min, archives attachments, populates ingest_log + documents"
            status={ingestRecent ? 'connected' : 'inactive'}
            detail={[
              status?.last_email_ingest_at ? `Last poll: ${fmtRelative(status.last_email_ingest_at)}` : 'Never polled',
              `Cron: */10 * * * *`,
              `Throughput: ${ingestStats?.ingest_24h ?? 0} ingests last 24h, ${ingestStats?.ingest_7d ?? 0} last 7d`,
            ]}
            reconnectPrompt="The email-ingest function hasn't run recently. Check the cron job status in Supabase, look at the latest edge function logs, and tell me what broke."
          />
          <IntegrationCard
            name="parser edge function"
            icon={Workflow}
            description="Parses XLSX attachments into monthly_pl, monthly_balance_sheet, gl_entries"
            status={parserRecent ? 'connected' : 'inactive'}
            detail={[
              status?.last_parser_run_at ? `Last run: ${fmtRelative(status.last_parser_run_at)}` : 'Never ran',
              `Cron: 5-59/10 * * * * (offset 5min from ingest)`,
              `Total P&L rows: 431`,
            ]}
            reconnectPrompt="The parser hasn't run lately. Check the parser cron and recent edge function logs, identify any parse failures, and walk me through fixing them."
          />
          <IntegrationCard
            name="automation_runner"
            icon={Workflow}
            description="Runs scheduled recipes: status refresh, daily briefing, monthly close kickoff"
            status={autoRecent ? 'connected' : 'unknown'}
            detail={[
              status?.last_automation_run_at ? `Last run: ${fmtRelative(status.last_automation_run_at)}` : 'Never ran',
              `${ingestStats?.auto_24h ?? 0} runs in last 24h`,
              `${ingestStats?.auto_failed_24h ?? 0} failed in last 24h`,
            ]}
            reconnectPrompt="Walk me through the automation_runner — show me which recipes are scheduled, when each one last ran, and flag any that are failing."
          />
          <IntegrationCard
            name="pg_cron"
            icon={Activity}
            description="Schedules all the above edge function invocations inside Postgres"
            status="connected"
            detail={['Built into Supabase Postgres', 'Visible via cron.job + cron.job_run_details']}
            reconnectPrompt="Show me all the active cron jobs on the BCC database, what they do, and when each one last ran successfully."
          />
        </div>
      </div>

      {/* GOOGLE WORKSPACE */}
      <div>
        <SectionHeader
          title="Google Workspace"
          description="Email ingestion, document archive, and (soon) calendar sync." />
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <IntegrationCard
            name="Gmail"
            icon={Mail}
            description="Inbox jayclaudeai2026@gmail.com — receives Rebecca's monthly packages"
            status={ingestRecent ? 'connected' : 'unknown'}
            detail={[
              `Account: jayclaudeai2026@gmail.com`,
              status?.last_email_ingest_at ? `Last poll: ${fmtRelative(status.last_email_ingest_at)}` : 'never',
              `${ingestStats?.gmail_sent_7d ?? 0} outbound sent in last 7d`,
            ]}
            externalUrl="https://mail.google.com"
            reconnectPrompt="My Gmail connection in Composio might be stale. Walk me through revoking and re-authorizing the Gmail toolkit, then run a test to confirm the email-ingest function can read new messages."
          />
          <IntegrationCard
            name="Google Drive"
            icon={HardDrive}
            description="Archive folder bcc_root/financial/<entity>/<YYYY>/<MM>/"
            status="connected"
            detail={[
              `${ingestStats?.docs_total ?? 0} documents archived`,
              `Root folder ID: 1DlDGi-lRkJmQIUsIWXbugDRn46DbllPr`,
              `Category-first layout (financial/...)`,
            ]}
            externalUrl="https://drive.google.com/drive/folders/1DlDGi-lRkJmQIUsIWXbugDRn46DbllPr"
            reconnectPrompt="My Google Drive connection might be broken. Re-authorize the Drive toolkit in Composio, verify the BCC archive folder is still accessible, and test by listing the most recent files."
          />
          <IntegrationCard
            name="Google Calendar"
            icon={Calendar}
            description="Not yet wired — will hold tax deadlines, monthly close gates, payroll dates"
            status="available"
            detail={['No table or recipe yet', 'Would enable: deadline reminders, scheduled posts']}
            externalUrl="https://calendar.google.com"
            reconnectPrompt="I want to connect Google Calendar to the BCC. Set up the Composio Google Calendar toolkit, then propose a schema for syncing tax deadlines and monthly close dates into a calendar."
          />
        </div>
      </div>

      {/* SOCIAL MEDIA */}
      <div>
        <SectionHeader
          title="Social media"
          description={`Brand accounts for content scheduling. ${(socialAccounts ?? []).filter((s) => s.is_active).length} active of ${(socialAccounts ?? []).length} configured.`} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          <SocialPlatformCard
            platform="instagram"
            label="Instagram"
            icon={Instagram}
            data={socialByPlatform.instagram}
          />
          <SocialPlatformCard
            platform="facebook"
            label="Facebook"
            icon={Facebook}
            data={socialByPlatform.facebook}
          />
          <SocialPlatformCard
            platform="linkedin"
            label="LinkedIn"
            icon={Linkedin}
          />
          <SocialPlatformCard
            platform="twitter"
            label="X / Twitter"
            icon={Twitter}
          />
          <SocialPlatformCard
            platform="tiktok"
            label="TikTok"
            icon={Music2}
          />
          <SocialPlatformCard
            platform="youtube"
            label="YouTube"
            icon={Youtube}
          />
        </div>
      </div>

      {/* RAW PAYLOAD (collapsed by default) */}
      <details className="ia-card">
        <summary className="cursor-pointer text-xs font-medium text-ia-muted uppercase tracking-wide select-none">
          Raw Composio toolkit health payload
        </summary>
        <pre className="mt-3 text-xs bg-ia-cream-dark p-3 rounded overflow-auto max-h-48 font-mono">
          {JSON.stringify(status?.composio_connection_health ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ============================================================================
// Pipeline diagram (left → right)
// ============================================================================
function PipelineDiagram({ status, ingestStats }) {
  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1">
      <div className="flex items-stretch gap-1 min-w-fit">
        <PipeNode
          icon={Mail}
          label="Gmail inbox"
          sub="jayclaudeai2026@gmail.com"
          detail={status?.last_email_ingest_at ? `polled ${fmtRelative(status.last_email_ingest_at)}` : 'never polled'}
        />
        <PipeArrow label="every 10 min" />
        <PipeNode
          icon={Workflow}
          label="email-ingest"
          sub="edge function"
          detail={`${ingestStats?.ingest_7d ?? 0} runs / 7d`}
        />
        <PipeArrow />
        <div className="flex flex-col gap-1 justify-center">
          <PipeNode
            icon={HardDrive}
            label="Google Drive"
            sub="bcc_root/financial/..."
            detail="files archived"
            compact
          />
          <PipeNode
            icon={Database}
            label="ingest_log + documents"
            sub="Documents page"
            detail={`${ingestStats?.docs_total ?? 0} docs`}
            compact
          />
        </div>
        <PipeArrow label="parser cron" />
        <PipeNode
          icon={Database}
          label="monthly_pl + balance_sheet"
          sub="Financials module"
          detail={status?.last_parser_run_at ? `parsed ${fmtRelative(status.last_parser_run_at)}` : 'never'}
        />
      </div>
      <div className="mt-3 text-[11px] text-ia-muted">
        Failure modes you might see on this flow: stale Composio token (Gmail/Drive 401), cron paused, parser exception on a malformed file. Each integration card below tells you what prompt to give Claude to fix it.
      </div>
    </div>
  );
}

function PipeNode({ icon: Icon, label, sub, detail, compact }) {
  return (
    <div className={cn(
      'flex flex-col items-center text-center px-3 rounded border border-ia-border bg-ia-cream-dark',
      compact ? 'py-1.5 min-w-[150px]' : 'py-2.5 min-w-[150px]',
    )}>
      <Icon size={compact ? 16 : 18} className="text-ia-teal mb-1" />
      <div className="text-[11px] font-medium text-ia-navy leading-tight">{label}</div>
      {sub && <div className="text-[10px] text-ia-muted mt-0.5 leading-tight">{sub}</div>}
      {detail && <div className="text-[10px] text-ia-teal mt-1 font-mono leading-tight">{detail}</div>}
    </div>
  );
}

function PipeArrow({ label }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 self-center">
      <ChevronRight size={20} className="text-ia-muted" />
      {label && <div className="text-[9px] text-ia-muted uppercase tracking-wide mt-0.5 whitespace-nowrap">{label}</div>}
    </div>
  );
}

// ============================================================================
// Integration card (used for infra, automation, Google Workspace)
// ============================================================================
function IntegrationCard({ name, icon: Icon, description, status, detail, reconnectPrompt, externalUrl }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const pillClass = {
    connected: 'ia-pill-success',
    inactive:  'ia-pill-warning',
    available: 'ia-pill-info',
    unknown:   'ia-pill-warning',
    error:     'ia-pill-danger',
  }[status] || 'ia-pill-muted';

  const statusLabel = {
    connected: 'connected',
    inactive:  'inactive',
    available: 'available to connect',
    unknown:   'unknown',
    error:     'error',
  }[status] || status;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(reconnectPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('copy failed', err);
    }
  }

  return (
    <div className="ia-card">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded bg-ia-teal/10 text-ia-teal shrink-0">
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-ia-navy">{name}</h3>
              {externalUrl && (
                <a href={externalUrl} target="_blank" rel="noreferrer" className="text-ia-muted hover:text-ia-teal" title="Open in new tab">
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
            <span className={pillClass}>{statusLabel}</span>
          </div>
          <p className="text-xs text-ia-muted mt-1">{description}</p>
          {detail && detail.length > 0 && (
            <ul className="text-xs text-ia-navy mt-2 space-y-0.5">
              {detail.map((d, i) => <li key={i} className="font-mono text-[11px] break-words">{d}</li>)}
            </ul>
          )}
          {reconnectPrompt && (
            <>
              <button
                onClick={() => setOpen(!open)}
                className="mt-3 inline-flex items-center gap-1 text-xs text-ia-teal hover:text-ia-teal-700"
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>How to {status === 'available' ? 'connect this' : 'fix this if it breaks'}</span>
              </button>
              {open && (
                <div className="mt-2 p-3 bg-ia-cream-dark rounded text-xs space-y-2">
                  <div className="text-ia-muted">Open a chat with your Claude and paste:</div>
                  <div className="text-ia-navy italic leading-relaxed">"{reconnectPrompt}"</div>
                  <button
                    onClick={copyPrompt}
                    className="inline-flex items-center gap-1 text-[11px] text-ia-teal hover:text-ia-teal-700"
                  >
                    <Copy size={11} />
                    <span>{copied ? 'Copied!' : 'Copy prompt'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Social platform card — handles both configured + not-yet-connected platforms
// ============================================================================
function SocialPlatformCard({ platform, label, icon: Icon, data }) {
  const hasRows = data && data.rows && data.rows.length > 0;
  const status = !hasRows ? 'available'
    : data.active > 0 ? 'connected'
    : 'inactive';
  const description = !hasRows
    ? `No ${label} accounts configured yet`
    : `${data.active} active · ${data.inactive} inactive (${data.rows.length} total)`;
  const detail = hasRows
    ? data.rows.slice(0, 5).map((r) => `${r.account_name ?? r.handle} ${r.is_active ? '✓' : '○'}`)
    : null;

  const reconnectPrompt = !hasRows
    ? `I want to add my ${label} accounts to the BCC. Walk me through connecting the ${label} toolkit in Composio, then help me decide which brand entities should each have a ${label} presence and seed the social_accounts rows.`
    : data.active === 0
    ? `My ${label} accounts are seeded but none are active. Walk me through OAuthing each brand's ${label} account through Composio one at a time, then flip social_accounts.is_active = true and set composio_toolkit for each.`
    : `My ${label} connection might be stale. Re-authorize the ${label} toolkit in Composio for each brand, verify each handle still posts correctly, and flag any accounts that need re-auth.`;

  return (
    <IntegrationCard
      name={label}
      icon={Icon}
      description={description}
      status={status}
      detail={detail}
      reconnectPrompt={reconnectPrompt}
    />
  );
}
