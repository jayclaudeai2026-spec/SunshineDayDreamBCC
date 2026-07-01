-- Migration 049: register the playbook module in bcc_modules.
-- Owner sees it automatically via get_my_module_access(). Staff get access
-- via the Team & Access UI as needed.

INSERT INTO public.bcc_modules (module_key, display_name, description, sort_order, is_active)
VALUES (
  'playbook',
  'Playbook & Guide',
  'Client-facing prompt reference: 13 sections, 76 prompts organized by cadence and by module. Every prompt has a "Try in Claude" button that context-wraps and copies to clipboard.',
  45,
  TRUE
)
ON CONFLICT (module_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  sort_order   = EXCLUDED.sort_order,
  is_active    = EXCLUDED.is_active;
