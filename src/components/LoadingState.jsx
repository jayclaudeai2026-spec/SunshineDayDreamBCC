import { Loader2 } from 'lucide-react';

// Simple loading spinner. Use inline for small areas, fullscreen for module-level loads.
export default function LoadingState({ label = 'Loading…', fullscreen = false, size = 20 }) {
  const content = (
    <div className="flex items-center gap-2 text-ia-muted text-sm">
      <Loader2 className="animate-spin" size={size} />
      <span>{label}</span>
    </div>
  );
  if (!fullscreen) return content;
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      {content}
    </div>
  );
}
