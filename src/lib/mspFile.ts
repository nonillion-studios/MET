import JSZip from 'jszip';
import type { Workspace, Chapter } from '../types';
import { migrateWorkspace } from './migrate';
import { loadChapterStudioData, saveChapterStudioData, type ChapterStudioData } from './studioProjectStore';

const SCHEMA_VERSION = 1;
const PROJECT_ENTRY = 'project.json';

interface MspProjectFile {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  workspace: Workspace;
  studioDataByChapterId: Record<string, ChapterStudioData>;
}

function allChapters(workspace: Workspace): Chapter[] {
  return workspace.mangas.flatMap(m => m.volumes.flatMap(v => v.chapters));
}

/** Bundles a workspace (series/volumes/chapters/pages) plus every chapter's Studio layer/TypeR
 *  data into a single `.msp` (zipped JSON) file, downloadable as a native project format. */
export async function exportWorkspaceToMsp(workspace: Workspace): Promise<Blob> {
  const studioDataByChapterId: Record<string, ChapterStudioData> = {};
  for (const chapter of allChapters(workspace)) {
    const data = await loadChapterStudioData(chapter.id);
    if (data) studioDataByChapterId[chapter.id] = data;
  }

  const payload: MspProjectFile = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace,
    studioDataByChapterId,
  };

  const zip = new JSZip();
  zip.file(PROJECT_ENTRY, JSON.stringify(payload));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadMsp(blob: Blob, workspaceName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${workspaceName.replace(/[^\w\-]+/g, '_') || 'project'}.msp`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ImportedMspProject {
  workspace: Workspace;
  studioDataByChapterId: Record<string, ChapterStudioData>;
}

/** Reads a `.msp` file back into a Workspace + per-chapter Studio data. Does not write to
 *  storage itself — callers merge the workspace into their own state and persist chapter data. */
export async function importMspFile(file: File): Promise<ImportedMspProject> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error(`"${file.name}" isn't a valid .msp file${err instanceof Error ? `: ${err.message}` : ''}`);
  }

  const entry = zip.file(PROJECT_ENTRY);
  if (!entry) throw new Error(`"${file.name}" is missing its project data — it may not be a MangaStudio project file.`);

  let payload: MspProjectFile;
  try {
    payload = JSON.parse(await entry.async('string'));
  } catch {
    throw new Error(`"${file.name}"'s project data is corrupted and couldn't be read.`);
  }

  if (!payload || typeof payload !== 'object' || !payload.workspace) {
    throw new Error(`"${file.name}" doesn't contain a recognizable project.`);
  }

  return {
    workspace: migrateWorkspace(payload.workspace),
    studioDataByChapterId: payload.studioDataByChapterId ?? {},
  };
}

/** Persists every chapter's imported Studio data into the per-chapter IndexedDB store. */
export async function saveImportedStudioData(studioDataByChapterId: Record<string, ChapterStudioData>): Promise<void> {
  await Promise.all(
    Object.entries(studioDataByChapterId).map(([chapterId, data]) => saveChapterStudioData(chapterId, data))
  );
}

/** Bundles every workspace's `.msp` into a single zip — the "back up everything locally" entry
 *  point (Settings). Each entry stays a valid standalone `.msp` (extract + re-import individually). */
export async function exportAllWorkspacesToZip(workspaces: Workspace[]): Promise<Blob> {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const workspace of workspaces) {
    const mspBlob = await exportWorkspaceToMsp(workspace);
    let name = workspace.name.replace(/[^\w\-]+/g, '_') || workspace.id;
    while (usedNames.has(name)) name = `${name}_${workspace.id.slice(0, 6)}`;
    usedNames.add(name);
    zip.file(`${name}.msp`, mspBlob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadFullBackup(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `met_backup_${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
