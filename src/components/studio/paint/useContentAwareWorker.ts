import { useRef, useCallback, useEffect } from 'react';
import { proximityMatchFill, type PixelBuffer, type RepairMask } from './contentAwareAlgorithms';
import type { ContentAwareRequest, ContentAwareResponse } from './contentAware.worker';

interface PendingRequest {
  resolve: (result: PixelBuffer) => void;
  reject: (err: Error) => void;
}

/**
 * Owns the Content-Aware Web Worker's lifecycle. Proximity Match is exposed as `runProximitySync`
 * (a direct, synchronous call into `contentAwareAlgorithms.ts` — cheap enough to run on every
 * brush segment without a worker round-trip); Create Texture / Content-Aware go through `runHeavy`,
 * which lazily spins up the worker on first use and resolves/rejects by matching `requestId`.
 */
export function useContentAwareWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('./contentAware.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (e: MessageEvent<ContentAwareResponse>) => {
        const pending = pendingRef.current.get(e.data.requestId);
        if (pending) {
          pendingRef.current.delete(e.data.requestId);
          pending.resolve(e.data.result);
        }
      });
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  const runHeavy = useCallback((
    mode: 'texture' | 'contentAware',
    patch: PixelBuffer,
    mask: RepairMask,
    brushSize: number,
  ): Promise<PixelBuffer> => {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingRef.current.set(requestId, { resolve, reject });
      const request: ContentAwareRequest = { requestId, mode, patch, mask, brushSize };
      getWorker().postMessage(request);
    });
  }, [getWorker]);

  /** Cancels every in-flight computation. A running Gauss-Seidel pass can't be aborted mid-loop, so
   *  this tears the worker down outright (`terminate()`) rather than trying to signal it — the next
   *  `runHeavy` call lazily spins up a fresh one. */
  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    for (const pending of pendingRef.current.values()) pending.reject(new Error('Content-aware fill cancelled'));
    pendingRef.current.clear();
  }, []);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  return { runHeavy, cancel, runProximitySync: proximityMatchFill };
}
