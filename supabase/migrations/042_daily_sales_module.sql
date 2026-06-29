-- Migration 042: register the daily_sales module in bcc_modules.
-- Owner sees it automatically via get_my_module_access(). Staff get access
-- via the Team & Access UI as needed.

INSERT INTO public.bcc_modules (module_key, display_name, description, sort_order, is_active)
VALUES (
  'daily_sales',
  'Daily Sales',
  'Heartland Retail POS daily sales pulse: per-location trends, recent days, and avg ticket',
  15,
  TRUE
)
ON CONFLICT (module_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  sort_order   = EXCLUDED.sort_order,
  is_active    = EXCLUDED.is_active;
