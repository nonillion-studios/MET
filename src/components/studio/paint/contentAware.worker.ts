/**
 * Runs the heavier two Content-Aware modes (Create Texture / Content-Aware) off the main thread,
 * so a large brush stroke's Gauss-Seidel relaxation pass (up to a couple hundred iterations over a
 * few-hundred-pixel-square working rect, see `iterationsFor` in `contentAwareAlgorithms.ts`) can
 * never freeze the UI. Proximity Match is cheap enough to also run synchronously on the main thread
 * for the live per-segment brush preview (see `useContentAwareWorker.ts`) — this worker exists for
 * the two modes that aren't real-time-safe, not because Proximity Match needs it.
 *
 * Deliberately does not use `OffscreenCanvas`: every algorithm in `contentAwareAlgorithms.ts`
 * operates on plain typed arrays (`Uint8ClampedArray`/`Float32Array`), not canvas drawing
 * operations, so there is no actual canvas work to offload here — the worker boundary itself
 * (this file, via `postMessage`) is what keeps the main thread responsive, which is the real goal.
 * Wrapping a canvas call around otherwise-canvas-free math would be decorative, not real.
 */

import { runContentAwareFill, type ContentAwareMode, type PixelBuffer, type RepairMask } from './contentAwareAlgorithms';

export interface ContentAwareRequest {
  requestId: string;
  mode: ContentAwareMode;
  patch: PixelBuffer;
  mask: RepairMask;
  brushSize: number;
}

export interface ContentAwareResponse {
  requestId: string;
  result: PixelBuffer;
}

self.addEventListener('message', (e: MessageEvent<ContentAwareRequest>) => {
  const { requestId, mode, patch, mask, brushSize } = e.data;
  const result = runContentAwareFill(mode, patch, mask, brushSize);
  const response: ContentAwareResponse = { requestId, result };
  (self as unknown as Worker).postMessage(response);
});
