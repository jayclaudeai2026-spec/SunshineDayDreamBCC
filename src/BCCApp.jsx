// Main BCC app shell.
// - Sidebar nav lists the 11 modules
// - Top bar shows entity name and any urgent alerts pill
// - <Outlet> via routes loads the active module
// - Auth gate: if not signed in (and not in demo mode), show a minimal
//   sign-in placeholder. Real auth UI ships in a follow-up commit.

import { Routes, Route, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, BarChart3, FileText, Brain, Workflow,
  Bell, Settings as SettingsIcon, ListChecks,
  Megaphone, Users, Receipt,
} from 'lucide-react';

import NavItem from './components/NavItem.jsx';
import DemoBanner from './components/DemoBanner.jsx';
import LoadingState from './components/LoadingState.jsx';
import { useAuthUser, useClientContext, useUnresolvedAlerts } from './lib/hooks.js';
import { DEMO_MODE, supabase } from './lib/supabase.js';
import { cn } from './lib/utils.js';

// Module imports — placeholders for now. Real implementations land in
// follow-up commits (3 modules per commit).
import Dashboard          from './modules/Dashboard.jsx';
import Financials         from './modules/Financials.jsx';
import Documents          from './modules/Documents.jsx';
import PersistentMemory   from './modules/PersistentMemory.jsx';
import Automations        from './modules/Automations.jsx';
import AlertsNotifications from './modules/AlertsNotifications.jsx';
import Settings           from './modules/Settings.jsx';
import TasksGoals         from './modules/TasksGoals.jsx';
import SocialMedia        from './modules/SocialMedia.jsx';
import HRPeople           from './modules/HRPeople.jsx';
import TaxCenter          from './modules/TaxCenter.jsx';

const NAV = [
  { to: '/',            end: true,  label: 'Dashboard',         icon: LayoutDashboard },
  { to: '/financials',              label: 'Financials',        icon: BarChart3 },
  { to: '/documents',               label: 'Documents',         icon: FileText },
  { to: '/memory',                  label: 'Memory',            icon: Brain },
  { to: '/automations',             label: 'Automations',       icon: Workflow },
  { to: '/alerts',                  label: 'Alerts',            icon: Bell },
  { to: '/tasks',                   label: 'Tasks & Goals',     icon: ListChecks },
  { to: '/social',                  label: 'Social Media',      icon: Megaphone },
  { to: '/hr',                      label: 'HR / People',       icon: Users },
  { to: '/tax',                     label: 'Tax Center',        icon: Receipt },
  { to: '/settings',                label: 'Settings',          icon: SettingsIcon },
];

export default function BCCApp() {
  const { user, loading: authLoading } = useAuthUser();
  const { data: ctx } = useClientContext();
  const { data: alerts } = useUnresolvedAlerts({ limit: 5 });

  if (authLoading) {
    return <LoadingState fullscreen label="Initializing BCC…" />;
  }

  if (!user && !DEMO_MODE) {
    return <SignInGate />;
  }

  const clientName = ctx?.display_name ?? 'Sunshine Daydream BCC';
  const alertCount = alerts?.length ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      <DemoBanner />
      <header className="bg-white border-b border-ia-border">
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
            {alertCount > 0 && (
              <a href="/alerts" className="ia-pill-danger no-underline" title={`${alertCount} unresolved alerts`}>
                <Bell size={12} className="inline mr-1" />
                {alertCount} alert{alertCount === 1 ? '' : 's'}
              </a>
            )}
            {user?.email && (
              <span className="text-xs text-ia-muted hidden sm:inline">{user.email}</span>
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
            {NAV.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/financials/*" element={<Financials />} />
            <Route path="/documents/*"  element={<Documents />} />
            <Route path="/memory/*"     element={<PersistentMemory />} />
            <Route path="/automations/*" element={<Automations />} />
            <Route path="/alerts"       element={<AlertsNotifications />} />
            <Route path="/tasks"        element={<TasksGoals />} />
            <Route path="/social/*"     element={<SocialMedia />} />
            <Route path="/hr/*"         element={<HRPeople />} />
            <Route path="/tax/*"        element={<TaxCenter />} />
            <Route path="/settings/*"   element={<Settings />} />
            <Route path="*"             element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <footer className="border-t border-ia-border bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 text-xs text-ia-muted flex items-center justify-between">
          <span>BCC powered by Claude</span>
          <span>v1.0</span>
        </div>
      </footer>
    </div>
  );
}

// ----- Minimal sign-in gate (placeholder for real auth UI) -----------------
function SignInGate() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ia-cream">
      <div className="ia-card max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-md bg-ia-navy mx-auto flex items-center justify-center text-white font-bold mb-3">
          SDD
        </div>
        <h2 className="text-ia-navy">Sign in to your BCC</h2>
        <p className="mt-2 text-sm text-ia-muted">
          The full sign-in flow ships in a follow-up release. For now, you can authenticate
          directly via the Supabase dashboard for your project (Authentication → Users → invite),
          or enable demo mode in <code>.env.local</code> by setting <code>VITE_DEMO_MODE=true</code>.
        </p>
      </div>
    </div>
  );
}
