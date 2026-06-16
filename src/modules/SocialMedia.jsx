import { useMemo, useState } from 'react';
import {
  Instagram, Facebook, Linkedin, Twitter, Youtube, Hash,
  Calendar, CheckCircle2, AlertCircle, FileText, Megaphone,
  ChevronDown, ChevronRight, RefreshCw, ExternalLink, Image as ImageIcon,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { useSupabaseQuery } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';
import { fmtRelative, fmtDate, cn, truncate } from '../lib/utils.js';

const TABS = [
  { key: 'accounts',   label: 'Accounts' },
  { key: 'scheduled',  label: 'Scheduled' },
  { key: 'published',  label: 'Published' },
  { key: 'brandvoice', label: 'Brand voice' },
];

const PLATFORM_ICON = {
  instagram: Instagram,
  facebook:  Facebook,
  linkedin:  Linkedin,
  twitter_x: Twitter,
  threads:   Hash,
  tiktok:    Megaphone,
  youtube:   Youtube,
};

const PLATFORM_LABEL = {
  instagram: 'Instagram',
  facebook:  'Facebook',
  linkedin:  'LinkedIn',
  twitter_x: 'X / Twitter',
  threads:   'Threads',
  tiktok:    'TikTok',
  youtube:   'YouTube',
};

function platformIcon(p) {
  const I = PLATFORM_ICON[p] ?? Hash;
  return <I size={14} />;
}

function postingMethodBadge(method) {
  if (method === 'manual_daily') {
    return (
      <span className="ia-pill-warning text-[10px]" title="Instagram API does not support scheduling; post manually each day">
        Manual daily
      </span>
    );
  }
  return <span className="ia-pill-success text-[10px]">API-schedulable</span>;
}

function engagementSummary(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  const entries = Object.entries(metrics).filter(([, v]) => v !== null && v !== undefined && v !== 0);
  if (entries.length === 0) return null;
  return entries.slice(0, 6).map(([k, v]) => (
    <span key={k} className="inline-flex items-center gap-1 text-xs text-ia-muted">
      <span className="font-medium text-ia-navy">{typeof v === 'number' ? v.toLocaleString() : String(v)}</span>
      <span>{k.replace(/_/g, ' ')}</span>
    </span>
  ));
}

export default function SocialMedia() {
  const [activeTab, setActiveTab] = useState('accounts');
  const [activePlatform, setActivePlatform] = useState(null);
  const [expandedPostId, setExpandedPostId] = useState(null);

  const accountsQ = useSupabaseQuery(
    () => supabase
      .from('social_accounts')
      .select('*')
      .order('platform', { ascending: true })
      .order('handle', { ascending: true }),
    [],
  );

  const postsQ = useSupabaseQuery(
    () => supabase
      .from('social_posts')
      .select('*, social_accounts(platform, handle, account_name)')
      .order('scheduled_for', { ascending: true, nullsFirst: false })
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(200),
    [],
  );

  const themesQ = useSupabaseQuery(
    () => supabase
      .from('content_themes')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true }),
    [],
  );

  const scheduleQ = useSupabaseQuery(
    () => supabase
      .from('social_schedule')
      .select('*, social_accounts(platform, handle)')
      .eq('is_active', true)
      .order('posting_day_of_week', { ascending: true }),
    [],
  );

  const accounts = accountsQ.data ?? [];
  const posts = postsQ.data ?? [];
  const themes = themesQ.data ?? [];
  const schedules = scheduleQ.data ?? [];

  const platforms = useMemo(() => {
    const set = new Set(accounts.map((a) => a.platform));
    return Array.from(set);
  }, [accounts]);

  const platformCounts = useMemo(() => {
    const c = {};
    for (const a of accounts) c[a.platform] = (c[a.platform] ?? 0) + 1;
    return c;
  }, [accounts]);

  const scheduledPosts = useMemo(() => {
    return posts.filter((p) => p.status === 'scheduled' || (p.status === 'draft' && p.scheduled_for));
  }, [posts]);

  const publishedPosts = useMemo(() => {
    return posts.filter((p) => p.status === 'posted');
  }, [posts]);

  const filteredAccounts = useMemo(() => {
    if (!activePlatform) return accounts;
    return accounts.filter((a) => a.platform === activePlatform);
  }, [accounts, activePlatform]);

  const filteredScheduled = useMemo(() => {
    if (!activePlatform) return scheduledPosts;
    return scheduledPosts.filter((p) => p.social_accounts?.platform === activePlatform);
  }, [scheduledPosts, activePlatform]);

  const filteredPublished = useMemo(() => {
    if (!activePlatform) return publishedPosts;
    return publishedPosts.filter((p) => p.social_accounts?.platform === activePlatform);
  }, [publishedPosts, activePlatform]);

  const loading = accountsQ.loading || postsQ.loading || themesQ.loading;
  const refetchAll = () => {
    accountsQ.refetch();
    postsQ.refetch();
    themesQ.refetch();
    scheduleQ.refetch();
  };

  const counts = {
    accounts:   accounts.length,
    scheduled:  scheduledPosts.length,
    published:  publishedPosts.length,
    brandvoice: themes.length,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Social media</h1>
          <p className="text-sm text-ia-muted mt-1">
            Accounts, scheduled posts, published history, and the brand voice themes that
            drive content generation. Instagram is manual-only; FB and LinkedIn schedule via API.
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
            onClick={() => { setActiveTab(t.key); setActivePlatform(null); setExpandedPostId(null); }}
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

      {/* Platform filter pills (Accounts/Scheduled/Published only) */}
      {activeTab !== 'brandvoice' && platforms.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ia-muted uppercase mr-1">Platform</span>
          <FilterPill label="All" active={!activePlatform} onClick={() => setActivePlatform(null)} count={accounts.length} />
          {platforms.map((p) => (
            <FilterPill
              key={p}
              label={PLATFORM_LABEL[p] ?? p}
              active={activePlatform === p}
              onClick={() => setActivePlatform(p)}
              count={platformCounts[p]}
            />
          ))}
        </div>
      )}

      {loading && <LoadingState label="Loading social data..." />}

      {/* ACCOUNTS TAB */}
      {activeTab === 'accounts' && !loading && (
        <>
          {filteredAccounts.length === 0 ? (
            <EmptyState
              title="No social accounts yet"
              description="Add accounts in Supabase Studio (public.social_accounts) — one row per platform handle."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredAccounts.map((a) => (
                <div key={a.id} className="ia-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-ia-cream-dark text-ia-navy">
                        {platformIcon(a.platform)}
                      </div>
                      <div>
                        <div className="font-medium text-ia-navy">{a.account_name ?? a.handle}</div>
                        <div className="text-xs text-ia-muted">@{a.handle} · {PLATFORM_LABEL[a.platform] ?? a.platform}</div>
                      </div>
                    </div>
                    {a.is_active
                      ? <span className="ia-pill-success text-[10px]">Active</span>
                      : <span className="ia-pill-muted text-[10px]">Inactive</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {postingMethodBadge(a.posting_method)}
                    {a.composio_toolkit && (
                      <span className="text-ia-muted">via {a.composio_toolkit}</span>
                    )}
                    {a.account_url && (
                      <a href={a.account_url} target="_blank" rel="noopener noreferrer"
                         className="text-ia-teal hover:underline inline-flex items-center gap-1">
                        Profile <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  {a.brand_voice_notes && (
                    <p className="text-xs text-ia-muted mt-2 italic">"{truncate(a.brand_voice_notes, 140)}"</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {schedules.length > 0 && (
            <div className="mt-6">
              <SectionHeader title="Active cadence" subtitle="From social_schedule" />
              <div className="ia-card space-y-2 mt-2">
                {schedules.map((s) => {
                  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                  const dayLabel = s.posting_day_of_week != null ? days[s.posting_day_of_week] : '—';
                  return (
                    <div key={s.id} className="flex items-center justify-between text-sm border-b border-ia-border last:border-0 pb-2 last:pb-0">
                      <div className="flex items-center gap-2">
                        {platformIcon(s.social_accounts?.platform)}
                        <span>@{s.social_accounts?.handle}</span>
                      </div>
                      <div className="text-xs text-ia-muted">
                        {s.posts_per_week}/wk · {dayLabel} {s.posting_time_local ?? ''} {s.timezone}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* SCHEDULED TAB */}
      {activeTab === 'scheduled' && !loading && (
        filteredScheduled.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description="Posts in draft with a scheduled_for date, or with status='scheduled', will appear here."
          />
        ) : (
          <div className="space-y-3">
            {filteredScheduled.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                expanded={expandedPostId === p.id}
                onToggle={() => setExpandedPostId(expandedPostId === p.id ? null : p.id)}
                showScheduled
              />
            ))}
          </div>
        )
      )}

      {/* PUBLISHED TAB */}
      {activeTab === 'published' && !loading && (
        filteredPublished.length === 0 ? (
          <EmptyState
            title="No published posts yet"
            description="Once a post hits status='posted', it shows up here with engagement metrics."
          />
        ) : (
          <div className="space-y-3">
            {filteredPublished.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                expanded={expandedPostId === p.id}
                onToggle={() => setExpandedPostId(expandedPostId === p.id ? null : p.id)}
                showPublished
              />
            ))}
          </div>
        )
      )}

      {/* BRAND VOICE TAB */}
      {activeTab === 'brandvoice' && !loading && (
        themes.length === 0 ? (
          <EmptyState
            title="No content themes defined"
            description="Add themes in Supabase Studio (public.content_themes) — they're the building blocks for content automation recipes."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {themes.map((t) => (
              <div key={t.id} className="ia-card">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-ia-teal" />
                    <span className="font-medium text-ia-navy">{t.name}</span>
                  </div>
                  {t.is_active
                    ? <span className="ia-pill-success text-[10px]">Active</span>
                    : <span className="ia-pill-muted text-[10px]">Inactive</span>}
                </div>
                {t.description && (
                  <p className="text-xs text-ia-muted mb-2">{t.description}</p>
                )}
                {t.brand_voice_notes && (
                  <div className="text-xs italic bg-ia-cream/60 rounded p-2 mb-2">
                    "{truncate(t.brand_voice_notes, 200)}"
                  </div>
                )}
                {t.hashtags_pool && t.hashtags_pool.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.hashtags_pool.slice(0, 10).map((h) => (
                      <span key={h} className="text-[10px] text-ia-teal bg-ia-cream-dark px-1.5 py-0.5 rounded">
                        #{h.replace(/^#/, '')}
                      </span>
                    ))}
                    {t.hashtags_pool.length > 10 && (
                      <span className="text-[10px] text-ia-muted">+{t.hashtags_pool.length - 10} more</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

function PostCard({ post, expanded, onToggle, showScheduled, showPublished }) {
  const acct = post.social_accounts ?? {};
  return (
    <div className="ia-card">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <div className="mt-0.5">
              {expanded ? <ChevronDown size={14} className="text-ia-muted" /> : <ChevronRight size={14} className="text-ia-muted" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                {platformIcon(acct.platform)}
                <span className="text-xs text-ia-muted">@{acct.handle}</span>
                {post.status === 'failed' && <span className="ia-pill-danger text-[10px]">Failed</span>}
                {post.status === 'archived' && <span className="ia-pill-muted text-[10px]">Archived</span>}
                {post.generated_by_recipe_run_id && (
                  <span className="text-[10px] text-ia-muted">recipe</span>
                )}
              </div>
              <p className="text-sm text-ia-navy truncate">{truncate(post.content_text ?? '(no text)', 200)}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-ia-muted">
                {showScheduled && post.scheduled_for && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={11} /> Scheduled {fmtDate(post.scheduled_for)} · {fmtRelative(post.scheduled_for)}
                  </span>
                )}
                {showPublished && post.posted_at && (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 size={11} /> Posted {fmtRelative(post.posted_at)}
                  </span>
                )}
                {post.image_urls && post.image_urls.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon size={11} /> {post.image_urls.length} image{post.image_urls.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-ia-border space-y-3 text-sm">
          {post.content_text && (
            <div className="whitespace-pre-wrap text-ia-navy">{post.content_text}</div>
          )}
          {post.hashtags && post.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {post.hashtags.map((h) => (
                <span key={h} className="text-[10px] text-ia-teal bg-ia-cream-dark px-1.5 py-0.5 rounded">
                  #{h.replace(/^#/, '')}
                </span>
              ))}
            </div>
          )}
          {post.image_urls && post.image_urls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.image_urls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-ia-teal hover:underline inline-flex items-center gap-1">
                  <ImageIcon size={11} /> Image {i + 1} <ExternalLink size={10} />
                </a>
              ))}
            </div>
          )}
          {post.link_url && (
            <div>
              <a href={post.link_url} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-ia-teal hover:underline inline-flex items-center gap-1">
                Link <ExternalLink size={10} />
              </a>
            </div>
          )}
          {post.post_url && (
            <div>
              <a href={post.post_url} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-ia-teal hover:underline inline-flex items-center gap-1">
                View live post <ExternalLink size={10} />
              </a>
            </div>
          )}
          {showPublished && post.engagement_metrics && Object.keys(post.engagement_metrics).length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-medium text-ia-muted uppercase">Engagement</span>
              {engagementSummary(post.engagement_metrics)}
            </div>
          )}
          {post.failure_reason && (
            <div className="text-xs text-red-700 bg-red-50 rounded p-2 inline-flex items-start gap-1">
              <AlertCircle size={11} className="mt-0.5" />
              <span>{post.failure_reason}</span>
            </div>
          )}
          <div className="text-[10px] text-ia-muted flex gap-3">
            <span>id #{post.id}</span>
            <span>created {fmtDate(post.created_at)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
