import { cn } from '../lib/utils.js';

// Filter pill button — used for category/tag/status filters across modules.
// Clickable; active state styled with IA teal.
export default function FilterPill({ label, active = false, onClick, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
        active
          ? 'bg-ia-teal text-white'
          : 'bg-ia-cream-dark text-ia-navy hover:bg-ia-teal-light'
      )}
    >
      <span>{label}</span>
      {count != null && (
        <span className={cn(
          'inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full text-[10px] font-semibold',
          active ? 'bg-ia-card/20 text-white' : 'bg-ia-card text-ia-muted'
        )}>{count}</span>
      )}
    </button>
  );
}
