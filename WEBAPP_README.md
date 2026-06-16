# BCC Webapp

React-based webapp for the Imaginary AI Business Command Center. Connects to the client's IA Supabase project and surfaces the eleven BCC modules.

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your project values
cp .env.example .env.local
# Edit .env.local — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Run the dev server
npm run dev
```

The app will be available at `http://localhost:5173`.

## Production build

```bash
npm run build       # outputs to dist/
npm run preview     # local preview of the production build
```

Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, S3+CloudFront, etc.). The webapp is a pure SPA — no Node server required.

## Demo mode

To run against a demo Supabase project without requiring sign-in, set `VITE_DEMO_MODE=true` in `.env.local`. A teal banner appears at the top of the app reminding you data may be stale or fabricated.

## Folder layout

```
src/
├── BCCApp.jsx                  Main shell with sidebar nav + routing
├── main.jsx                    React 18 root + BrowserRouter
├── index.css                   Tailwind base + IA palette CSS vars
├── lib/
│   ├── supabase.js             Supabase client (anon key, RLS-protected)
│   ├── hooks.js                useSupabaseQuery, useOperatingContext, useClientContext, etc.
│   └── utils.js                Formatters, classnames, severity/health helpers
├── components/                 Shared UI primitives (9)
│   ├── DemoBanner.jsx
│   ├── EmptyState.jsx
│   ├── ErrorBoundary.jsx
│   ├── FilterPill.jsx
│   ├── LoadingState.jsx
│   ├── NavItem.jsx
│   ├── SearchInput.jsx
│   ├── SectionHeader.jsx
│   └── StatCard.jsx
└── modules/                    The 11 BCC modules (all implemented)
    ├── Dashboard.jsx
    ├── Financials.jsx
    ├── Documents.jsx
    ├── PersistentMemory.jsx
    ├── Automations.jsx
    ├── AlertsNotifications.jsx
    ├── Settings.jsx
    ├── TasksGoals.jsx
    ├── SocialMedia.jsx
    ├── HRPeople.jsx
    └── TaxCenter.jsx
```

All 11 modules have real implementations as of HEAD. The operating Claude (via Supabase MCP) can also query and operate any module's tables directly without the webapp — useful for setup and admin work.

## Auth

The webapp uses Supabase Auth (email magic-link or password by default). Add users via the Supabase dashboard at Authentication → Users → Invite. RLS policies on every table grant `authenticated` role read access; writes go through Edge Functions with the service role key.

## Connecting to your Supabase project

1. Open your IA Supabase project (e.g. `https://app.supabase.com/project/<your-ref>`)
2. Settings → API
3. Copy the **Project URL** → `VITE_SUPABASE_URL`
4. Copy the **anon public** key → `VITE_SUPABASE_ANON_KEY`
5. Paste both into `.env.local`
6. `npm run dev` and sign in with an invited user
