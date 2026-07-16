-- Lets a team leader upload a promotional image shown on the public join
-- card / join-request flow, per the "leader-uploaded join-description ad"
-- requirement. Stored as a URL (Supabase Storage public URL or data URL),
-- same convention as the existing `logo` column.
alter table public.teams
  add column if not exists join_ad_url text;
