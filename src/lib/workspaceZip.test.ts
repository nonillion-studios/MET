import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportMangaToZip } from './workspaceZip';
import type { MangaSeries } from '../types';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function buildManga(): MangaSeries {
  return {
    id: 'manga-1',
    title: 'Test Series',
    type: 'manhwa',
    coverUrl: PNG_DATA_URL,
    description: 'A description',
    volumes: [
      {
        id: 'vol-1',
        name: 'Volume 1',
        coverUrl: PNG_DATA_URL,
        chapters: [
          {
            id: 'ch-1',
            name: 'Chapter 1',
            coverUrl: '',
            pages: [
              {
                id: 'page-1',
                order: 0,
                original: { id: 'img-1', filename: 'page1.png', dataUrl: PNG_DATA_URL, mimeType: 'image/png', width: 1, height: 1 },
                cleaned: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('exportMangaToZip', () => {
  it('writes info.json + cover.* at manga and volume level, info.json only (no cover) at chapter level', async () => {
    const manga = buildManga();
    const progressCalls: Array<[number, number]> = [];
    const blob = await exportMangaToZip(manga, (current, total) => progressCalls.push([current, total]));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    const mangaInfoRaw = await zip.file('Test_Series/info.json')?.async('text');
    expect(mangaInfoRaw).toBeTruthy();
    const mangaInfo = JSON.parse(mangaInfoRaw!);
    expect(mangaInfo).toMatchObject({ name: 'Test Series', description: 'A description', type: 'manhwa' });
    expect(zip.file('Test_Series/cover.png')).toBeTruthy();

    const volumeInfoRaw = await zip.file('Test_Series/Volume_1/info.json')?.async('text');
    expect(volumeInfoRaw).toBeTruthy();
    expect(JSON.parse(volumeInfoRaw!)).toMatchObject({ name: 'Volume 1' });
    expect(zip.file('Test_Series/Volume_1/cover.png')).toBeTruthy();

    const chapterInfoRaw = await zip.file('Test_Series/Volume_1/Chapter_1/info.json')?.async('text');
    expect(chapterInfoRaw).toBeTruthy();
    expect(JSON.parse(chapterInfoRaw!)).toMatchObject({ name: 'Chapter 1' });
    // Chapter has no coverUrl in the fixture, so no cover file should be written.
    expect(zip.file('Test_Series/Volume_1/Chapter_1/cover.png')).toBeNull();

    expect(zip.file('Test_Series/Volume_1/Chapter_1/page-001_page1.png')).toBeTruthy();

    // Progress should have advanced monotonically and finished at the precomputed total.
    expect(progressCalls.length).toBeGreaterThan(0);
    const [, total] = progressCalls[0];
    expect(progressCalls[progressCalls.length - 1]).toEqual([total, total]);
  });
});
