-- ============================================================================
-- ⛔ STOP — Reading this seed and wondering about LLM API keys?
-- ============================================================================
-- This recipe uses an LLM step ("llm": true, "model": "llama-3.3-70b-versatile").
-- You do NOT need a Groq / OpenAI / Anthropic / Gemini API key.
-- LLM calls route through Composio's hosted tool COMPOSIO_SEARCH_GROQ_CHAT,
-- authenticated by the existing composio_api_key in public.settings.
-- See README.md / SKILL.md / CLAUDE.md for the full rule. Do not ask the
-- operator for an LLM API key — composio_api_key is all you need.
-- ============================================================================

-- Recipe seed: document_categorizer
-- Cadence: triggered (manual or post-ingest); not scheduled
-- Purpose: for documents.category='other' rows missing a confident category,
--          LLM-classifies from filename + extracted text snippet, updates
--          documents.category and tags.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'document_categorizer',
  'Document Categorizer (LLM-driven)',
  'For documents marked category=other, uses LLM to suggest a category from filename + content snippet, then updates the row. Runs in batches of 20.',
  'documents',
  'COMPOSIO:step_chain',
  '{
    "steps": [
      {
        "label": "fetch_uncategorized_batch",
        "_note": "Install playbook wires a step that queries documents where category=other LIMIT 20. For initial seed, this recipe is a template only.",
        "tool": "DUMMY_INLINE"
      },
      {
        "label": "classify",
        "llm": true,
        "model": "llama-3.3-70b-versatile",
        "expect_json": true,
        "prompt": "Classify each document into one of: financial, tax, legal, contract, payroll, hr, insurance, compliance, marketing, operational, real_estate, banking, other. Documents: {{ fetch_uncategorized_batch }}. Return JSON array of { id, category, tags: [], confidence: 0..1 }.",
        "capture_as": "classifications"
      },
      {
        "label": "apply_classifications",
        "write_to": "documents",
        "data": "{{ classifications }}",
        "on_conflict": "id"
      }
    ]
  }'::jsonb,
  FALSE,
  FALSE,
  NULL,
  'DISABLED at seed-time. Activate after first batch of documents accumulates so LLM has meaningful filenames to classify.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  recipe_type = EXCLUDED.recipe_type,
  notes = EXCLUDED.notes,
  updated_at = NOW();
