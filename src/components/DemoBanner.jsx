import { Info } from 'lucide-react';
import { DEMO_MODE } from '../lib/supabase.js';

// Sticky banner shown in DEMO_MODE so it's always obvious you're not in a real install.
// Pulls the flag from src/lib/supabase.js to keep the source of truth in one place.
export default function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div className="bg-ia-teal-light border-b border-ia-teal/30 text-ia-teal-700 text-sm">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2">
        <Info size={14} />
        <span>
          Demo mode — connected to a demo/dev Supabase. Data may be stale, fabricated, or wiped at any time.
        </span>
      </div>
    </div>
  );
}
