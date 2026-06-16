// Section header used inside modules for sub-sections.
// Renders title + optional description + optional right-aligned action(s).
export default function SectionHeader({ title, description, actions }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <div>
        <h2 className="text-ia-navy">{title}</h2>
        {description && (
          <p className="text-sm text-ia-muted mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
