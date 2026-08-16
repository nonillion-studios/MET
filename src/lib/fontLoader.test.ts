import { describe, it, expect } from 'vitest';
import { arrayBufferToDataUrl } from './fontLoader';

// registerFontBytes/loadCustomFont/extractFontsFromZip/registerStoredFont all end in `new
// FontFace(...)` + `document.fonts.add(...)`, neither of which exist in this project's
// deliberately DOM-free vitest environment (see vitest.config.ts) — matching why those functions
// were never unit-tested before this file existed either. Only the pure encoding helper below is
// testable here; the rest is covered by the `run` skill's live-browser verification instead.
describe('arrayBufferToDataUrl', () => {
  it('encodes bytes as a base64 data URL that round-trips via atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 66, 67]);
    const dataUrl = arrayBufferToDataUrl(bytes.buffer);
    expect(dataUrl).toMatch(/^data:font\/ttf;base64,/);

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const decoded = atob(base64);
    const decodedBytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    expect(Array.from(decodedBytes)).toEqual(Array.from(bytes));
  });

  it('accepts a custom mime type', () => {
    const dataUrl = arrayBufferToDataUrl(new Uint8Array([1]).buffer, 'font/woff2');
    expect(dataUrl.startsWith('data:font/woff2;base64,')).toBe(true);
  });

  it('round-trips an empty buffer', () => {
    const dataUrl = arrayBufferToDataUrl(new ArrayBuffer(0));
    expect(dataUrl).toBe('data:font/ttf;base64,');
  });
});
