// ConfirmDeleteButton: two-click destructive button.
//
// First click flips the button into a "Confirm delete?" state for
// `confirmMs` milliseconds (default 4s). A second click within that
// window calls onConfirm. After the window, it reverts to the safe state.
//
// Props:
//   onConfirm   - async function called on the second click
//   label       - text on the first state. Defaults to "Delete".
//   confirmLabel- text on the armed state. Defaults to "Confirm delete?".
//   busyLabel   - text while onConfirm is running. Defaults to "Deleting…".
//   confirmMs   - how long the armed state stays active. Defaults to 4000.
//   disabled    - external disable.
//   className   - extra classes.

import { Trash2, AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils.js';

export default function ConfirmDeleteButton({
  onConfirm,
  label = 'Delete',
  confirmLabel = 'Confirm delete?',
  busyLabel = 'Deleting…',
  confirmMs = 4000,
  disabled,
  className,
}) {
  const [state, setState] = useState('idle'); // idle | armed | busy
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  async function handleClick() {
    if (state === 'idle') {
      setState('armed');
      timeoutRef.current = setTimeout(() => setState('idle'), confirmMs);
      return;
    }
    if (state === 'armed') {
      clearTimeout(timeoutRef.current);
      setState('busy');
      try {
        await onConfirm?.();
        // Parent should unmount this component on success; safety fallback:
        setState('idle');
      } catch (e) {
        console.error('Delete failed:', e);
        setState('idle');
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || state === 'busy'}
      className={cn(
        state === 'armed' ? 'ia-button-danger' : 'ia-button-ghost',
        'text-xs ia-no-print',
        className,
      )}
      title={state === 'armed' ? 'Click again to confirm permanent delete' : 'Delete this item'}
    >
      {state === 'armed'
        ? <><AlertTriangle size={14} /> {confirmLabel}</>
        : state === 'busy'
          ? <>{busyLabel}</>
          : <><Trash2 size={14} /> {label}</>}
    </button>
  );
}
