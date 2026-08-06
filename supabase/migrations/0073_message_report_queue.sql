-- Admin review queue for message_reports (0062_reports_and_privacy.sql added the table and the
-- report-to-admin insert action, but nothing to resolve/dismiss a report or act on it yet).
--
-- team_messages already lets a leader/owner edit *any* field of any team message via the existing
-- team_messages_update_managers_pin policy (RLS is row-level, not column-level — that policy was
-- only ever exercised for `pinned` before, but nothing stops it being used for `deleted`/`body`
-- too). direct_messages has no such manager-override policy at all — a narrowly-scoped one is
-- added here, deliberately gated on the DM actually having an *open* report against it, so a
-- manager can moderate a reported message without gaining blanket edit access to every private
-- conversation in the team.
drop policy if exists "direct_messages_update_managers_moderation" on public.direct_messages;
create policy "direct_messages_update_managers_moderation" on public.direct_messages
  for update to authenticated using (
    exists (
      select 1 from public.message_reports
      where message_table = 'direct_messages' and message_id = direct_messages.id
        and team_id = direct_messages.team_id and status = 'open'
    )
    and (
      exists (select 1 from public.team_members where team_id = direct_messages.team_id and user_id = auth.uid() and role = 'leader' and status = 'active')
      or exists (select 1 from public.teams where id = direct_messages.team_id and owner_id = auth.uid())
    )
  );
