-- ============================================================================
-- PHASE 3D - Camera Discovery Customer Agent Link
--
-- Additive-only migration:
-- - customer_agents is now the source of truth for production agents.
-- - local_agents remains legacy and is not removed.
-- - camera_discovery_jobs.agent_id remains for legacy compatibility.
-- ============================================================================

ALTER TABLE public.camera_discovery_jobs
  ADD COLUMN IF NOT EXISTS customer_agent_id uuid NULL
    REFERENCES public.customer_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_customer_agent
  ON public.camera_discovery_jobs (customer_agent_id, status);

COMMENT ON COLUMN public.camera_discovery_jobs.customer_agent_id IS
  'Production customer agent assigned to this discovery job. Supersedes legacy agent_id which references local_agents.';
