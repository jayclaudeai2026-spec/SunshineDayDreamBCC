import { Search, X } from 'lucide-react';

// Inline search input with icon and clear button.
export default function SearchInput({ value, onChange, placeholder = 'Search…', autoFocus = false }) {
  return (
    <div className="relative w-full max-w-md">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-ia-muted pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="ia-input pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ia-muted hover:text-ia-navy"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
