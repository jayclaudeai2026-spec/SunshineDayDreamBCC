// Main BCC app shell.
// - Auth gate: not signed in -> SignInGate (Supabase email+password)
// - Module access gate: signed in -> calls get_my_module_access() RPC and
//   filters NAV + gates routes accordingly. Owners see everything; staff see
//   only the modules the owner has granted.
// - Sidebar nav lists the modules the current user can access
// - Top bar shows entity name and any urgent alerts pill
// - <Outlet> via routes loads the active module

import { useState, useMemo, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, BarChart3, FileText, Brain, Workflow,
  Bell, Settings as SettingsIcon, ListChecks,
  Megaphone, Users, Receipt, ShieldCheck, Sun, Moon, Network, Activity,
} from 'lucide-react';

import NavItem from './components/NavItem.jsx';
import DemoBanner from './components/DemoBanner.jsx';
import LoadingState from './components/LoadingState.jsx';
import EmptyState from './components/EmptyState.jsx';
import {
  useAuthUser, useClientContext, useUnresolvedAlertCount, useMyModuleAccess,
} from './lib/hooks.js';
import { DEMO_MODE, supabase } from './lib/supabase.js';
import { cn } from './lib/utils.js';

// Module imports
import Dashboard           from './modules/Dashboard.jsx';
import DailySalesPulse     from './modules/DailySalesPulse.jsx';
import Financials          from './modules/Financials.jsx';
import Documents           from './modules/Documents.jsx';
import PersistentMemory    from './modules/PersistentMemory.jsx';
import Automations         from './modules/Automations.jsx';
import AlertsNotifications from './modules/AlertsNotifications.jsx';
import Settings            from './modules/Settings.jsx';
import TasksGoals          from './modules/TasksGoals.jsx';
import SocialMedia         from './modules/SocialMedia.jsx';
import HRPeople            from './modules/HRPeople.jsx';
import TaxCenter           from './modules/TaxCenter.jsx';
import TeamAccess          from './modules/TeamAccess.jsx';
import GroupFlowMap        from './modules/GroupFlowMap.jsx';

// NAV entries. `key` matches public.bcc_modules.module_key so we can filter
// based on the get_my_module_access() RPC response. `ownerOnly` forces the
// entry to only appear for owners regardless of grants (Team & Access).
const NAV = [
  { key: 'dashboard',   to: '/',             end: true,  label: 'Dashboard',     icon: LayoutDashboard },
  { key: 'daily_sales', to: '/daily-sales',              label: 'Daily Sales',   icon: Activity },
  { key: 'financials',  to: '/financials',                label: 'Financials',    icon: BarChart3 },
  { key: 'documents',   to: '/documents',                 label: 'Documents',     icon: FileText },
  { key: 'memory',      to: '/memory',                    label: 'Memory',        icon: Brain },
  { key: 'automations', to: '/automations',               label: 'Automations',   icon: Workflow },
  { key: 'alerts',      to: '/alerts',                    label: 'Alerts',        icon: Bell },
  { key: 'tasks',       to: '/tasks',                     label: 'Tasks & Goals', icon: ListChecks },
  { key: 'social',      to: '/social',                    label: 'Social Media',  icon: Megaphone },
  { key: 'hr',          to: '/hr',                        label: 'HR / People',   icon: Users },
  { key: 'tax',         to: '/tax',                       label: 'Tax Center',    icon: Receipt },
  { key: 'group',       to: '/group',                     label: 'Group',         icon: Network },
  { key: 'settings',    to: '/settings',                  label: 'Settings',      icon: SettingsIcon },
  { key: 'team',        to: '/team',                      label: 'Team & Access', icon: ShieldCheck, ownerOnly: true },
];


// ---------------------------------------------------------------------------
// Theme toggle: light <-> dark via localStorage + <html data-theme> attribute.
// Defaults to dark (set in index.html before React mounts to prevent FOUC).
// ---------------------------------------------------------------------------

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.getAttribute('data-theme') || 'dark';
  });

  const setTheme = (next) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('bcc-theme', next);
    } catch (e) {
      // localStorage may be unavailable in some embeddings -- silently no-op
    }
  };

  useEffect(() => {
    // Sync attribute on mount in case it drifted
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return [theme, setTheme];
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="ia-theme-toggle"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export default function BCCApp() {
  const { user, loading: authLoading } = useAuthUser();
  const { data: ctx } = useClientContext();
  const { data: alertCount } = useUnresolvedAlertCount();
  const { data: access, loading: accessLoading } = useMyModuleAccess();

  // IMPORTANT: derived hook values must be declared BEFORE any conditional
  // returns below to obey the Rules of Hooks (otherwise React throws #310
  // "Rendered more hooks than during the previous render" when authLoading
  // flips from true to false on subsequent renders).
  const isOwner    = DEMO_MODE ? true : Boolean(access?.is_owner);
  const allowedSet = useMemo(() => {
    if (DEMO_MODE) return new Set(NAV.map((n) => n.key));
    if (isOwner)   return new Set(NAV.map((n) => n.key));
    return new Set(Array.isArray(access?.modules) ? access.modules : []);
  }, [access, isOwner]);

  if (authLoading) {
    return <LoadingState fullscreen label="Initializing BCC…" />;
  }

  if (!user && !DEMO_MODE) {
    return <SignInGate />;
  }

  // Demo mode and signed-in users wait for the access RPC to resolve so
  // we don't briefly flash the full nav before filtering.
  if (!DEMO_MODE && accessLoading) {
    return <LoadingState fullscreen label="Checking access…" />;
  }

  const visibleNav = NAV.filter((n) => {
    if (n.ownerOnly && !isOwner) return false;
    return allowedSet.has(n.key);
  });

  const clientName = ctx?.display_name ?? 'Sunshine Daydream BCC';

  return (
    <div className="min-h-screen flex flex-col">
      <DemoBanner />
      <header className="bg-ia-card border-b border-ia-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-ia-navy flex items-center justify-center text-white font-bold text-xs">
              SDD
            </div>
            <div>
              <div className="font-semibold text-ia-navy text-sm leading-tight">{clientName}</div>
              <div className="text-xs text-ia-muted leading-tight">Business Command Center</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {allowedSet.has('alerts') && alertCount > 0 && (
              <a href="/alerts" className="ia-pill-danger no-underline" title={`${alertCount} unresolved alerts`}>
                <Bell size={12} className="inline mr-1" />
                {alertCount} alert{alertCount === 1 ? '' : 's'}
              </a>
            )}
            <ThemeToggle />
            {user?.email && (
              <span className="text-xs text-ia-muted hidden sm:inline">
                {user.email}{isOwner ? ' · owner' : ''}
              </span>
            )}
            {user && (
              <button
                className="ia-button-ghost text-xs"
                onClick={() => supabase.auth.signOut()}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 flex gap-6">
        <aside className="w-56 flex-shrink-0">
          <nav className="space-y-1 sticky top-6">
            {visibleNav.length === 0 ? (
              <div className="text-xs text-ia-muted px-3 py-2">
                No modules granted yet. Ask the owner to grant you access.
              </div>
            ) : (
              visibleNav.map((item) => (
                <NavItem key={item.to} {...item} />
              ))
            )}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <Routes>
            <Route path="/"             element={<GateRoute moduleKey="dashboard"   allowedSet={allowedSet}><Dashboard /></GateRoute>} />
            <Route path="/daily-sales/*" element={<GateRoute moduleKey="daily_sales" allowedSet={allowedSet}><DailySalesPulse /></GateRoute>} />
            <Route path="/financials/*" element={<GateRoute moduleKey="financials"  allowedSet={allowedSet}><Financials /></GateRoute>} />
            <Route path="/documents/*"  element={<GateRoute moduleKey="documents"   allowedSet={allowedSet}><Documents /></GateRoute>} />
            <Route path="/memory/*"     element={<GateRoute moduleKey="memory"      allowedSet={allowedSet}><PersistentMemory /></GateRoute>} />
            <Route path="/automations/*" element={<GateRoute moduleKey="automations" allowedSet={allowedSet}><Automations /></GateRoute>} />
            <Route path="/alerts"       element={<GateRoute moduleKey="alerts"      allowedSet={allowedSet}><AlertsNotifications /></GateRoute>} />
            <Route path="/tasks"        element={<GateRoute moduleKey="tasks"       allowedSet={allowedSet}><TasksGoals /></GateRoute>} />
            <Route path="/social/*"     element={<GateRoute moduleKey="social"      allowedSet={allowedSet}><SocialMedia /></GateRoute>} />
            <Route path="/hr/*"         element={<GateRoute moduleKey="hr"          allowedSet={allowedSet}><HRPeople /></GateRoute>} />
            <Route path="/tax/*"        element={<GateRoute moduleKey="tax"         allowedSet={allowedSet}><TaxCenter /></GateRoute>} />
            <Route path="/group/*"      element={<GateRoute moduleKey="group"       allowedSet={allowedSet}><GroupFlowMap /></GateRoute>} />
            <Route path="/settings/*"   element={<GateRoute moduleKey="settings"    allowedSet={allowedSet}><Settings /></GateRoute>} />
            <Route path="/team/*"       element={isOwner ? <TeamAccess /> : <Navigate to="/" replace />} />
            <Route path="*"             element={<Navigate to={visibleNav[0]?.to ?? '/'} replace />} />
          </Routes>
        </main>
      </div>

      <footer className="border-t border-ia-border bg-ia-card">
        <div className="max-w-7xl mx-auto px-4 py-3 text-xs text-ia-muted flex items-center justify-between">
          <span>BCC powered by Claude</span>
          <span>v1.0</span>
        </div>
      </footer>
    </div>
  );
}

// Route gate: if the user is not allowed to view `moduleKey`, show a friendly
// no-access message rather than the module content. Keeps direct URL navigation
// in check.
function GateRoute({ moduleKey, allowedSet, children }) {
  const location = useLocation();
  if (!allowedSet.has(moduleKey)) {
    return (
      <EmptyState
        title="No access to this module"
        description={`You don't have access to ${moduleKey}. Ask the owner to grant you access from Team & Access.`}
      />
    );
  }
  return children;
}

// ----- Supabase email/password sign-in -------------------------------------
function SignInGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
    } catch (err) {
      console.error('sign-in error:', err);
      setError(err?.message ?? 'Sign-in failed. Check your credentials and try again.');
      setSubmitting(false);
    }
  }

  const canSubmit = email.length > 0 && password.length > 0 && !submitting;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ia-cream">
      <div className="ia-card max-w-md w-full">
        <div className="text-center">
          <div className="w-12 h-12 rounded-md bg-ia-navy mx-auto flex items-center justify-center text-white font-bold mb-3">
            SDD
          </div>
          <h2 className="text-ia-navy">Sign in to your BCC</h2>
          <p className="mt-2 text-sm text-ia-muted">
            Enter your credentials to access the Business Command Center.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3" noValidate>
          <div>
            <label htmlFor="signin-email" className="block text-xs font-medium text-ia-navy mb-1">
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className={cn(
                'w-full px-3 py-2 border border-ia-border rounded-md text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ia-teal',
                'disabled:opacity-50',
              )}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="signin-password" className="block text-xs font-medium text-ia-navy mb-1">
              Password
            </label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className={cn(
                'w-full px-3 py-2 border border-ia-border rounded-md text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ia-teal',
                'disabled:opacity-50',
              )}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              'w-full bg-ia-navy text-white text-sm font-medium py-2 rounded-md transition',
              'hover:bg-ia-navy/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-xs text-ia-muted text-center">
          Need an account? Ask the owner to add you via the Supabase dashboard
          (Authentication → Users), then grant you module access from Team &amp; Access.
        </p>
      </div>
    </div>
  );
}
