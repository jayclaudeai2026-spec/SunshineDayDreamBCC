import { Inbox } from 'lucide-react';

// Friendly empty-state for tables/lists/views with nothing to show.
// title is required; description and action are optional. icon defaults to <Inbox>.
export default function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}) {
  return (
    <div className="ia-card flex flex-col items-center justify-center text-center py-10">
      <Icon className="text-ia-muted mb-3" size={36} />
      <h3 className="text-ia-navy">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-ia-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
