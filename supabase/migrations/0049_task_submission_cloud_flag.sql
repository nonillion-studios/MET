-- Task submission/reference attachments (uploadTaskAttachment in cloudClient.ts)
-- land in the same Telegram channel as genuine Team Cloud uploads but carry a
-- plain filename caption rather than team_file JSON metadata, so they were
-- indistinguishable from real uploads in the Team Cloud file browser. Mirrors
-- is_chat_upload (0043_team_cloud_files.sql) so both kinds of incidental
-- channel files can be excluded from the "genuine uploads" card list.
alter table public.team_cloud_files
  add column if not exists is_task_submission boolean not null default false;
