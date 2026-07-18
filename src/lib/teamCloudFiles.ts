import { supabase } from './supabaseClient';
import { uploadImageToStorage } from './image';

export type CloudFileVisibility = 'public' | 'team' | 'private';

export interface TeamCloudFileMeta {
  id: string;
  team_id: string;
  channel_msg_id: number;
  folder_msg_id: number | null;
  uploader_user_id: string | null;
  visibility: CloudFileVisibility;
  owner_user_id: string | null;
  cover_image_path: string | null;
  cover_version: number;
  display_name: string | null;
  is_chat_upload: boolean;
  created_at: string;
}

export interface TeamCloudFolderMeta {
  id: string;
  team_id: string;
  folder_msg_id: number;
  is_secret: boolean;
  created_at: string;
}

export async function listCloudFileMeta(teamId: string): Promise<TeamCloudFileMeta[]> {
  const { data, error } = await supabase.from('team_cloud_files').select().eq('team_id', teamId);
  if (error) return [];
  return (data as TeamCloudFileMeta[]) ?? [];
}

export async function listCloudFolderMeta(teamId: string): Promise<TeamCloudFolderMeta[]> {
  const { data, error } = await supabase.from('team_cloud_folders').select().eq('team_id', teamId);
  if (error) return [];
  return (data as TeamCloudFolderMeta[]) ?? [];
}

export async function upsertCloudFileMeta(input: {
  teamId: string;
  channelMsgId: number;
  folderMsgId: number | null;
  uploaderUserId?: string | null;
  visibility?: CloudFileVisibility;
  ownerUserId?: string | null;
  displayName?: string | null;
  isChatUpload?: boolean;
}): Promise<string | null> {
  const { error } = await supabase.from('team_cloud_files').upsert(
    {
      team_id: input.teamId,
      channel_msg_id: input.channelMsgId,
      folder_msg_id: input.folderMsgId,
      ...(input.uploaderUserId !== undefined ? { uploader_user_id: input.uploaderUserId } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.ownerUserId !== undefined ? { owner_user_id: input.ownerUserId } : {}),
      ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      ...(input.isChatUpload !== undefined ? { is_chat_upload: input.isChatUpload } : {}),
    },
    { onConflict: 'team_id,channel_msg_id' }
  );
  return error ? error.message : null;
}

export async function setCloudFileVisibility(teamId: string, channelMsgId: number, visibility: CloudFileVisibility, ownerUserId: string | null): Promise<string | null> {
  return upsertCloudFileMeta({ teamId, channelMsgId, folderMsgId: null, visibility, ownerUserId });
}

export async function setCloudFolderSecret(teamId: string, folderMsgId: number, isSecret: boolean): Promise<string | null> {
  const { error } = await supabase.from('team_cloud_folders').upsert(
    { team_id: teamId, folder_msg_id: folderMsgId, is_secret: isSecret },
    { onConflict: 'team_id,folder_msg_id' }
  );
  return error ? error.message : null;
}

export async function uploadCloudFileCover(teamId: string, channelMsgId: number, dataUrl: string): Promise<string | null> {
  const path = `teams/${teamId}/cloud-covers/${channelMsgId}-${Date.now()}.jpg`;
  const url = await uploadImageToStorage(dataUrl, path);
  if (!url) return null;
  const { data: existing } = await supabase
    .from('team_cloud_files')
    .select('cover_version')
    .eq('team_id', teamId)
    .eq('channel_msg_id', channelMsgId)
    .maybeSingle();
  const nextVersion = (existing?.cover_version ?? 0) + 1;
  const { error } = await supabase.from('team_cloud_files').upsert(
    { team_id: teamId, channel_msg_id: channelMsgId, cover_image_path: url, cover_version: nextVersion },
    { onConflict: 'team_id,channel_msg_id' }
  );
  return error ? error.message : null;
}
