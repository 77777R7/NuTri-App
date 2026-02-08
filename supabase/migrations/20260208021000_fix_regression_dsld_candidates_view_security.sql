-- Fix readonly access to regression DSLD candidate view.
--
-- In some Postgres/Supabase setups, views may run as SECURITY INVOKER, which would require
-- anon/authenticated to have privileges on the underlying table. We intentionally revoked
-- base-table privileges, so we must ensure the view executes with view-owner privileges.
--
-- This migration enforces `security_invoker=false` so CI can query the view using a readonly key.

alter view public.regression_dsld_form_candidates_v
  set (security_invoker = false);

-- Re-assert the intended privilege model.
revoke all on table public.dsld_labels_meta from anon, authenticated;
grant select on public.regression_dsld_form_candidates_v to anon, authenticated;

