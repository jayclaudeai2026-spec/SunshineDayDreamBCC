// PrintButton: triggers window.print() with a temporary document.title override
// so the saved PDF / printout has a meaningful filename.
//
// Print CSS in src/index.css hides chrome (.ia-no-print) and forces light
// surfaces so the output is readable on paper.
//
// Props:
//   title   - optional string. Overrides document.title for the duration of
//             the print call. Restored on afterprint or beforeunload.
//   label   - button text. Defaults to "Print".
//   variant - "ghost" (default) or "solid"
//   size    - "xs" (default) or "sm"
//   onBeforePrint / onAfterPrint - optional hooks for components that need
//             to expand collapsed sections or similar before the snapshot.

import { Printer } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils.js';

export default function PrintButton({
  title,
  label = 'Print',
  variant = 'ghost',
  size = 'xs',
  onBeforePrint,
  onAfterPrint,
  className,
}) {
  const originalTitleRef = useRef(null);

  // Always restore the title after the print dialog closes, even if the user
  // cancels. afterprint fires on cancel too.
  useEffect(() => {
    function restore() {
      if (originalTitleRef.current != null) {
        document.title = originalTitleRef.current;
        originalTitleRef.current = null;
      }
      onAfterPrint?.();
    }
    window.addEventListener('afterprint', restore);
    return () => window.removeEventListener('afterprint', restore);
  }, [onAfterPrint]);

  function handleClick() {
    if (title) {
      originalTitleRef.current = document.title;
      // Sanitize for filename safety on Save-as-PDF
      document.title = String(title).replace(/[/\\?%*:|"<>]/g, '-').slice(0, 200);
    }
    onBeforePrint?.();
    // Defer slightly so any re-render (e.g. expanding sections) lands first
    setTimeout(() => window.print(), 50);
  }

  const cls = variant === 'solid' ? 'ia-button' : 'ia-button-ghost';
  const sizeCls = size === 'sm' ? 'text-sm' : 'text-xs';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(cls, sizeCls, 'ia-no-print', className)}
      title={title ? `Print: ${title}` : 'Print this view'}
    >
      <Printer size={14} />
      {label}
    </button>
  );
}
