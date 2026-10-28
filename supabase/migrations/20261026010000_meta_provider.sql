-- Migration 0066: Meta as a model provider (docs/decisions.md 2026-10-26,
-- for the Meta Global AI Developer Hackathon). A model call and an agent
-- run may name meta beside anthropic and openai; nothing else changes.

alter table public.llm_calls drop constraint llm_calls_provider_check;
alter table public.llm_calls
  add constraint llm_calls_provider_check check (provider in ('anthropic', 'openai', 'meta'));

alter table public.runs drop constraint runs_provider_check;
alter table public.runs
  add constraint runs_provider_check check (provider in ('anthropic', 'openai', 'meta'));
