-- Lets a team self-declare specialty tags (distinct from job titles assigned
-- to individual members) so the public directory can be filtered by what a
-- team focuses on, not just sorted by popularity.
alter table public.teams
  add column if not exists tags text[] not null default '{}';
