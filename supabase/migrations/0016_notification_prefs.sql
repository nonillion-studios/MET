-- Per-member notification category opt-out (broadcasts/tasks/chat), so
-- members aren't forced into every notification a team generates.
alter table public.team_members
  add column if not exists notification_prefs jsonb not null default '{"broadcasts": true, "tasks": true, "chat": true}'::jsonb;
