import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseFontFaceBlocks, pickBlock, fetchGoogleFont } from './googleFonts';

describe('parseFontFaceBlocks', () => {
  it('parses a single-block CSS2 response', () => {
    const css = `
      /* latin */
      @font-face {
        font-family: 'Bangers';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/bangers/v1/abc.woff2) format('woff2');
      }
    `;
    const blocks = parseFontFaceBlocks(css);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].url).toBe('https://fonts.gstatic.com/s/bangers/v1/abc.woff2');
  });

  it('parses multiple subset blocks with their own unicode-range', () => {
    const css = `
      @font-face {
        font-family: 'Cairo';
        src: url(https://fonts.gstatic.com/s/cairo/v1/arabic.woff2) format('woff2');
        unicode-range: U+0600-06FF, U+0750-077F;
      }
      @font-face {
        font-family: 'Cairo';
        src: url(https://fonts.gstatic.com/s/cairo/v1/latin.woff2) format('woff2');
        unicode-range: U+0000-00FF, U+0131, U+0152-0153;
      }
    `;
    const blocks = parseFontFaceBlocks(css);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].unicodeRange).toContain('U+0600-06FF');
    expect(blocks[1].unicodeRange).toContain('U+0000-00FF');
  });

  it('returns an empty array when no url() is present', () => {
    expect(parseFontFaceBlocks('body { color: red; }')).toEqual([]);
  });
});

describe('pickBlock', () => {
  it('returns the only block when there is just one, regardless of preferredScript', () => {
    const blocks = [{ url: 'a' }];
    expect(pickBlock(blocks)).toBe(blocks[0]);
  });

  it('picks the Latin subset by default among several', () => {
    const blocks = [
      { url: 'arabic', unicodeRange: 'U+0600-06FF' },
      { url: 'latin', unicodeRange: 'U+0000-00FF, U+0131' },
    ];
    expect(pickBlock(blocks)?.url).toBe('latin');
  });

  it('picks the Arabic subset when preferredScript is arabic', () => {
    const blocks = [
      { url: 'arabic', unicodeRange: 'U+0600-06FF' },
      { url: 'latin', unicodeRange: 'U+0000-00FF' },
    ];
    expect(pickBlock(blocks, 'arabic')?.url).toBe('arabic');
  });

  it('falls back to the last block when no subset matches the preferred script', () => {
    const blocks = [
      { url: 'first', unicodeRange: 'U+2000-206F' },
      { url: 'last', unicodeRange: 'U+2070-209F' },
    ];
    expect(pickBlock(blocks, 'arabic')?.url).toBe('last');
  });
});

describe('fetchGoogleFont', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the CSS2 response then the font file URL it points to', async () => {
    const css = `@font-face { font-family: 'Bangers'; src: url(https://fonts.gstatic.com/s/bangers/v1/abc.woff2) format('woff2'); }`;
    const fontBytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => css })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => fontBytes });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleFont('Bangers');
    expect(result).toBe(fontBytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('fonts.googleapis.com/css2?family=Bangers');
    expect(fetchMock.mock.calls[1][0]).toBe('https://fonts.gstatic.com/s/bangers/v1/abc.woff2');
  });

  it('throws a friendly error when the CSS request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchGoogleFont('Bangers')).rejects.toThrow(/Couldn't reach Google Fonts/);
  });

  it('throws when the CSS response has no usable font url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'body {}' }));
    await expect(fetchGoogleFont('Bangers')).rejects.toThrow(/didn't return a usable font file/);
  });

  it('throws when the font file itself fails to download', async () => {
    const css = `@font-face { src: url(https://fonts.gstatic.com/s/bangers/v1/abc.woff2) format('woff2'); }`;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => css })
      .mockResolvedValueOnce({ ok: false, status: 404 }));
    await expect(fetchGoogleFont('Bangers')).rejects.toThrow(/Failed to download/);
  });
});
