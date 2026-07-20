-- team_members.custom_permissions (text[]) and custom_title have existed as
-- free-text, owner-editable fields with no enforcement anywhere — anyone
-- could type a permission name into custom_permissions and nothing checked
-- it. This gives teams a real, per-team-defined permission: an owner
-- declares a named permission once (team_custom_permission_defs), then
-- grants it to specific leaders (team_custom_permission_grants), checked via
-- team_member_has_custom_perm(). custom_permissions/custom_title on
-- team_members are left as-is (decorative labels a leader can display),
-- unrelated to this real grant model.
create table if not exists public.team_custom_permission_defs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  label text not null,
  created_at timestamptz not null default now(),
  unique (team_id, key)
);

alter table public.team_custom_permission_defs enable row level security;

drop policy if exists "team_custom_permission_defs_select" on public.team_custom_permission_defs;
create policy "team_custom_permission_defs_select" on public.team_custom_permission_defs
  for select to authenticated using (
    public.is_team_active_member(team_id) or public.is_team_owner(team_id)
  );

drop policy if exists "team_custom_permission_defs_write" on public.team_custom_permission_defs;
create policy "team_custom_permission_defs_write" on public.team_custom_permission_defs
  for all to authenticated using (
    public.is_team_owner(team_id)
  ) with check (
    public.is_team_owner(team_id)
  );

create table if not exists public.team_custom_permission_grants (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  def_id uuid not null references public.team_custom_permission_defs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (def_id, user_id)
);

alter table public.team_custom_permission_grants enable row level security;

drop policy if exists "team_custom_permission_grants_select" on public.team_custom_permission_grants;
create policy "team_custom_permission_grants_select" on public.team_custom_permission_grants
  for select to authenticated using (
    public.is_team_active_member(team_id) or public.is_team_owner(team_id)
  );

drop policy if exists "team_custom_permission_grants_write" on public.team_custom_permission_grants;
create policy "team_custom_permission_grants_write" on public.team_custom_permission_grants
  for all to authenticated using (
    public.is_team_owner(team_id)
  ) with check (
    public.is_team_owner(team_id)
  );

create or replace function public.team_member_has_custom_perm(_team_id uuid, _key text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.is_team_owner(_team_id) then
    return true;
  end if;

  return exists (
    select 1
    from public.team_custom_permission_grants g
    join public.team_custom_permission_defs d on d.id = g.def_id
    join public.team_members tm on tm.team_id = _team_id and tm.user_id = auth.uid() and tm.status = 'active'
    where g.team_id = _team_id and g.user_id = auth.uid() and d.key = _key
  );
end;
$$;
