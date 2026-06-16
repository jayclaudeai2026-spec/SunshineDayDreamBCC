import { NavLink } from 'react-router-dom';
import { cn } from '../lib/utils.js';

// Sidebar nav item with active-state styling.
export default function NavItem({ to, icon: Icon, label, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(
        'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
        isActive
          ? 'bg-ia-teal text-white'
          : 'text-ia-navy hover:bg-ia-cream-dark'
      )}
    >
      {Icon && <Icon size={16} />}
      <span>{label}</span>
    </NavLink>
  );
}
