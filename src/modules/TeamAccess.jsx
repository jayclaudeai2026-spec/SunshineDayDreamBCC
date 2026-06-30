// Team & Access — owner-only admin module.
// Lists every user in the BCC, lets the owner toggle module access per user,
// promote/demote owners, and rename display names. New users are added via
// the Supabase dashboard (Authentication → Users → Add user); this module
// only assigns access after a user exists.
//
// All mutations go through SECURITY DEFINER RPCs that enforce
// is_current_user_owner() (see migration 022).

import { useState, useMemo, useEffect } from 'react';
import { ShieldCheck, RefreshCw, Save, AlertTriangle, Check } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useTeamMembers, useBccModules, useMyModuleAccess } from '../lib/hooks.js';
import LoadingState from '../components/LoadingState.jsx';
import AskClaudeButton from '../components/AskClaudeButton.jsx';
import PrintButton from '../components/PrintButton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { cn } from '../lib/utils.js';

export default function TeamAccess() {
  const { data: me } = useMyModuleAccess();
  const { data: modules, loading: modulesLoading } = useBccModules();
  const { data: members, loading: membersLoading, error: membersError, refetch } = useTeamMembers();

  // Belt-and-suspenders: BCCApp already gates this route, but if anyone lands
  // here without owner rights, show a denial.
  if (me && !me.is_owner) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Owner-only"
        description="Only owners can manage team access. Ask the BCC owner if you need permissions changed."
      />
    );
  }

  if (modulesLoading || membersLoading) {
    return <LoadingState label="Loading team..." />;
  }

  if (membersError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Could not load team"
        description={membersError.message ?? 'Unknown error fetching team members.'}
      />
    );
  }

  const memberList = Array.isArray(members) ? members : [];
  const moduleList = Array.isArray(modules) ? modules : [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-ia-navy flex items-center gap-2">
            <ShieldCheck className="inline" size={20} />
            Team &amp; Access
          </h1>
          <p className="text-sm text-ia-muted mt-1">
            Manage who can sign in to this BCC and which modules they can see.
            Owners see everything by default.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <PrintButton title="BCC Team & Access" />
          <AskClaudeButton
            moduleLabel="Team & Access module"
            subject="Team & Access— permissions audit"
            context={{ members: memberList, modules: moduleList }}
            suggestedPrompt="Audit who has access to what. Anything that looks misconfigured or that I should tighten?"
          />
          <button
            onClick={refetch}
            className="ia-button-ghost text-xs flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </header>

      <InviteInstructions />

      {memberList.length === 0 ? (
        <EmptyState
          title="No users yet"
          description="Add your first user from the Supabase dashboard, then assign access here."
        />
      ) : (
        <div className="space-y-4">
          {memberList.map((m) => (
            <MemberRow
              key={m.user_id}
              member={m}
              modules={moduleList}
              onSaved={refetch}
              selfUserId={me?.user_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InviteInstructions() {
  return (
    <div className="ia-card bg-ia-cream/40">
      <h3 className="text-ia-navy text-sm font-semibold flex items-center gap-1">
        <ShieldCheck size={14} /> How to add a new user
      </h3>
      <ol className="mt-2 text-sm text-ia-navy space-y-1 list-decimal ml-5">
        <li>
          Open the{' '}
          <a
            href="https://supabase.com/dashboard/project/qlcwzlejluyluunjhtki/auth/users"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ia-teal underline"
          >
            Supabase Authentication panel
          </a>
          .
        </li>
        <li>
          Click <strong>Add user → Create new user</strong>. Enter their email
          and an initial password, and check <strong>Auto Confirm User</strong>.
          (The emailed-link invite flow leads to a blank page in this webapp;
          assigning an explicit password is the working path.)
        </li>
        <li>
          Come back here and the user will appear below. Check the modules
          they should see, then click <strong>Save grants</strong>.
        </li>
        <li>
          Share the email + password with the user. They can change the password
          from their account settings after signing in.
        </li>
      </ol>
    </div>
  );
}

function MemberRow({ member, modules, onSaved, selfUserId }) {
  const isSelf = selfUserId && member.user_id === selfUserId;
  const initialGrants = useMemo(() => {
    const out = {};
    for (const m of modules) out[m.module_key] = Boolean(member.modules?.[m.module_key]);
    return out;
  }, [member, modules]);

  const [grants, setGrants] = useState(initialGrants);
  const [displayName, setDisplayName] = useState(member.display_name ?? '');
  const [isOwner, setIsOwner] = useState(Boolean(member.is_owner));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    setGrants(initialGrants);
    setDisplayName(member.display_name ?? '');
    setIsOwner(Boolean(member.is_owner));
  }, [initialGrants, member]);

  function toggle(moduleKey) {
    setGrants((g) => ({ ...g, [moduleKey]: !g[moduleKey] }));
    setStatus(null);
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    const errors = [];

    // 1. Display name (only if changed and non-empty)
    if ((displayName ?? '') !== (member.display_name ?? '')) {
      const { error } = await supabase.rpc('update_user_display_name', {
        p_user_id: member.user_id,
        p_display_name: displayName || null,
      });
      if (error) errors.push(`display name: ${error.message}`);
    }

    // 2. Owner toggle (only if changed)
    if (Boolean(isOwner) !== Boolean(member.is_owner)) {
      const { error } = await supabase.rpc('set_user_owner', {
        p_user_id: member.user_id,
        p_is_owner: isOwner,
      });
      if (error) {
        errors.push(`owner flag: ${error.message}`);
        setIsOwner(Boolean(member.is_owner));
      }
    }

    // 3. Module grants (one RPC per changed module)
    for (const mod of modules) {
      const before = Boolean(member.modules?.[mod.module_key]);
      const after = Boolean(grants[mod.module_key]);
      if (before === after) continue;
      const { error } = await supabase.rpc('set_module_access', {
        p_user_id: member.user_id,
        p_module_key: mod.module_key,
        p_allowed: after,
      });
      if (error) errors.push(`${mod.module_key}: ${error.message}`);
    }

    setSaving(false);
    if (errors.length === 0) {
      setStatus({ kind: 'ok', message: 'Saved.' });
      onSaved?.();
    } else {
      setStatus({ kind: 'err', message: errors.join('; ') });
    }
  }

  const lastSignIn = member.last_sign_in_at
    ? new Date(member.last_sign_in_at).toLocaleString()
    : 'never signed in';

  return (
    <div className="ia-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="text-ia-navy font-semibold text-sm">{member.email}</div>
          <div className="text-xs text-ia-muted mt-0.5">Last sign-in: {lastSignIn}</div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-ia-navy mb-1">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setStatus(null); }}
                placeholder={member.email?.split('@')[0] ?? ''}
                className="ia-input py-1.5"
              />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={isOwner}
                disabled={isSelf}
                onChange={(e) => { setIsOwner(e.target.checked); setStatus(null); }}
                title={isSelf ? 'Cannot change your own owner flag' : 'Owner = full access to every module'}
              />
              <span className="text-sm text-ia-navy">
                Owner{isSelf && <span className="text-ia-muted text-xs ml-1">(this is you)</span>}
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium text-ia-navy mb-2">Module access</div>
        {isOwner ? (
          <div className="text-xs text-ia-muted italic">
            Owners have implicit access to every module. Module checkboxes are ignored.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {modules.map((m) => (
              <label key={m.module_key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(grants[m.module_key])}
                  onChange={() => toggle(m.module_key)}
                />
                <span className="text-ia-navy">{m.display_name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="ia-button"
        >
          {saving ? (
            <><RefreshCw size={14} className="animate-spin" /> Saving…</>
          ) : (
            <><Save size={14} /> Save grants</>
          )}
        </button>
        {status?.kind === 'ok' && (
          <span className="text-xs text-green-700 flex items-center gap-1">
            <Check size={12} /> {status.message}
          </span>
        )}
        {status?.kind === 'err' && (
          <span className="text-xs text-red-700 flex items-center gap-1">
            <AlertTriangle size={12} /> {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
