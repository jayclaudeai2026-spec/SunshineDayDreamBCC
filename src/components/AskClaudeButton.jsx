// AskClaudeButton: copies a structured markdown context block to the clipboard
// so the user can paste it into a Claude conversation and pick up where they
// left off. Works as a generic "I'm looking at THIS, what should I do" hand-off.
//
// Props:
//   moduleLabel - "Alerts", "Financials", "System Map", etc. Required.
//   subject     - one-line subject of what the user is focused on. Optional but
//                 strongly recommended (e.g. alert #364, "SDD March 2026 P&L").
//   context     - JSON-serializable object with the relevant record(s). Optional.
//                 Will be stringified into a code block at the bottom.
//   suggestedPrompt - optional default question. If omitted, we render a generic
//                 "help me work through this" prompt.
//   label       - button text. Defaults to "Ask Claude".
//   variant     - "ghost" (default) or "solid".
//   size        - "xs" (default) or "sm".
//
// Behavior:
//   - Click copies a fully-formed markdown block to the clipboard.
//   - Button changes to "Copied — paste into Claude" for ~2.5s.
//   - On failure (browser refused), falls back to opening a modal with the
//     payload pre-selected so the user can hit Cmd+C manually.

import { Sparkles, Check, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils.js';

function buildPayload({ moduleLabel, subject, context, suggestedPrompt }) {
  const lines = [];
  lines.push(`# Question for Claude about my BCC`);
  lines.push('');
  lines.push(`**Module:** ${moduleLabel}`);
  if (subject) lines.push(`**Looking at:** ${subject}`);
  if (typeof window !== 'undefined' && window.location?.href) {
    lines.push(`**URL:** ${window.location.href}`);
  }
  lines.push(`**Captured:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## My question');
  lines.push('');
  lines.push(suggestedPrompt || '_(replace this line with what you want Claude to help with)_');
  lines.push('');
  if (context !== undefined && context !== null) {
    lines.push('## Context (auto-captured)');
    lines.push('');
    lines.push('```json');
    try {
      lines.push(JSON.stringify(context, null, 2));
    } catch {
      lines.push(String(context));
    }
    lines.push('```');
  }
  return lines.join('\n');
}

export default function AskClaudeButton({
  moduleLabel,
  subject,
  context,
  suggestedPrompt,
  label = 'Ask Claude',
  variant = 'ghost',
  size = 'xs',
  className,
}) {
  const [state, setState] = useState('idle'); // idle | copied | error
  const [fallbackText, setFallbackText] = useState(null);

  async function handleClick() {
    const payload = buildPayload({ moduleLabel, subject, context, suggestedPrompt });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(payload);
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch (e) {
      console.error('AskClaude clipboard error:', e);
      setFallbackText(payload);
      setState('error');
    }
  }

  function dismissFallback() {
    setFallbackText(null);
    setState('idle');
  }

  const cls = variant === 'solid' ? 'ia-button' : 'ia-button-ghost';
  const sizeCls = size === 'sm' ? 'text-sm' : 'text-xs';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(cls, sizeCls, 'ia-no-print', className)}
        title="Copy a context block to share with Claude"
      >
        {state === 'copied'
          ? <><Check size={14} /> Copied — paste into Claude</>
          : state === 'error'
            ? <><AlertTriangle size={14} /> Couldn't copy — open</>
            : <><Sparkles size={14} /> {label}</>}
      </button>

      {fallbackText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="ia-card max-w-2xl w-full">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-ia-navy">Copy this into Claude</h3>
              <button onClick={dismissFallback} className="ia-button-ghost text-xs">Close</button>
            </div>
            <p className="text-xs text-ia-muted mb-2">
              Your browser blocked auto-copy. Select all and copy (Cmd/Ctrl+A, Cmd/Ctrl+C):
            </p>
            <textarea
              readOnly
              value={fallbackText}
              rows={16}
              className="ia-input font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>
      )}
    </>
  );
}
