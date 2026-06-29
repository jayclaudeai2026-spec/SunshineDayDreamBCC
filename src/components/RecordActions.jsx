// RecordActions: standardized right-aligned action toolbar for record views.
// Renders any combination of Print / Ask Claude / Edit / Save / Cancel / Delete
// buttons based on which props are supplied. Drop into the top-right of any
// detail/edit panel for a consistent look across modules.
//
// Use it when a module wants ALL or most of these buttons together. For
// one-off placements (e.g. an inline Print button in a card footer), the
// individual components work standalone.
//
// Props (all optional):
//   onPrint, printTitle           -> renders PrintButton
//   askClaude: {moduleLabel, subject, context, suggestedPrompt} -> AskClaudeButton
//   onEdit                        -> renders Edit (ghost)
//   onSave, saving, saveDisabled  -> renders Save (solid)
//   onCancel                      -> renders Cancel (ghost)
//   onDelete                      -> renders ConfirmDeleteButton
//   deleteLabel                   -> override delete label
//   extra                         -> children to render before the action buttons
//
// All buttons get the ia-no-print class so they vanish in printouts.

import { Edit2, Save, X } from 'lucide-react';
import PrintButton from './PrintButton.jsx';
import AskClaudeButton from './AskClaudeButton.jsx';
import ConfirmDeleteButton from './ConfirmDeleteButton.jsx';
import { cn } from '../lib/utils.js';

export default function RecordActions({
  onPrint, printTitle, printLabel,
  askClaude,
  onEdit, editLabel = 'Edit',
  onSave, saving = false, saveDisabled = false, saveLabel,
  onCancel, cancelLabel = 'Cancel',
  onDelete, deleteLabel,
  extra,
  className,
}) {
  return (
    <div className={cn('flex items-center gap-2 flex-wrap ia-no-print', className)}>
      {extra}

      {onPrint !== undefined && (
        <PrintButton
          title={printTitle}
          label={printLabel ?? 'Print'}
          onBeforePrint={typeof onPrint === 'function' ? onPrint : undefined}
        />
      )}

      {askClaude && (
        <AskClaudeButton
          moduleLabel={askClaude.moduleLabel}
          subject={askClaude.subject}
          context={askClaude.context}
          suggestedPrompt={askClaude.suggestedPrompt}
          label={askClaude.label}
        />
      )}

      {onEdit && (
        <button onClick={onEdit} className="ia-button-ghost text-xs">
          <Edit2 size={14} /> {editLabel}
        </button>
      )}

      {onCancel && (
        <button onClick={onCancel} className="ia-button-ghost text-xs" disabled={saving}>
          <X size={14} /> {cancelLabel}
        </button>
      )}

      {onSave && (
        <button onClick={onSave} className="ia-button text-xs" disabled={saving || saveDisabled}>
          <Save size={14} /> {saving ? 'Saving…' : (saveLabel ?? 'Save')}
        </button>
      )}

      {onDelete && (
        <ConfirmDeleteButton onConfirm={onDelete} label={deleteLabel ?? 'Delete'} />
      )}
    </div>
  );
}
