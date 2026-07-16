import { Workspace, Chapter, ProcessedImage } from '../types';
import { createPagesFromOriginals } from './pages';

/** Older saved data stored a flat `images: ProcessedImage[]` on Chapter instead of `pages: Page[]`. */
type LegacyChapter = Chapter & { images?: ProcessedImage[] };

function migrateChapter(chapter: LegacyChapter): Chapter {
  if (chapter.pages) return chapter;
  const { images, ...rest } = chapter;
  return { ...rest, pages: createPagesFromOriginals(images ?? []) };
}

export function migrateWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    tags: workspace.tags ?? [],
    mangas: workspace.mangas.map(manga => ({
      ...manga,
      volumes: manga.volumes.map(volume => ({
        ...volume,
        chapters: volume.chapters.map(migrateChapter),
      })),
    })),
  };
}
