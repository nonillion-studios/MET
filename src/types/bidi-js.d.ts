/** bidi-js ships no TypeScript types. Minimal ambient declaration covering only what
 *  textBidi.ts actually calls — verified against the installed bidi-js@1.0.3's real runtime
 *  behavior, not just its README. */
declare module 'bidi-js' {
  export interface BidiEmbeddingLevels {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }

  export interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): BidiEmbeddingLevels;
  }

  export default function bidiFactory(): Bidi;
}
