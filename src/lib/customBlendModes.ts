import type { BlendMode } from '../components/studio/studioTypes';

/**
 * The 10 Photoshop blend modes with no native canvas `globalCompositeOperation` equivalent (see
 * `studioTypes.ts`'s `CUSTOM_BLEND_MODES`/`compositeOperationFor`). Real per-pixel formulas, used
 * by `exportImage.ts`'s flatten path, which already composites sequentially onto one real 2D
 * context — the backdrop is naturally available there, unlike in a per-node Konva filter.
 *
 * Standard published blend-mode formulas, 0-255 per channel. `applyCustomBlend` mutates `source`'s
 * RGB in place to become "the blended color against `backdrop`" — alpha is left untouched (the
 * caller draws the result back with a normal 'source-over' composite, which is what actually
 * applies the layer's own alpha/opacity; this function only ever answers "what color").
 */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function colorBurn(cb: number, cs: number): number {
  return cs === 0 ? 0 : clamp255(255 - ((255 - cb) * 255) / cs);
}
function colorDodge(cb: number, cs: number): number {
  return cs === 255 ? 255 : clamp255((cb * 255) / (255 - cs));
}
function darken(cb: number, cs: number): number {
  return Math.min(cb, cs);
}
function lighten(cb: number, cs: number): number {
  return Math.max(cb, cs);
}
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function applyCustomBlend(mode: BlendMode, backdrop: { data: Uint8ClampedArray }, source: { data: Uint8ClampedArray }): void {
  const bd = backdrop.data, sd = source.data;
  for (let i = 0; i < sd.length; i += 4) {
    const cbR = bd[i], cbG = bd[i + 1], cbB = bd[i + 2];
    const csR = sd[i], csG = sd[i + 1], csB = sd[i + 2];

    switch (mode) {
      case 'dissolve': {
        // A pixel is either fully kept or fully discarded, weighted by its own alpha as the
        // probability of surviving — the classic dissolve "noisy stencil" look. Real per-pixel
        // randomness, not a decorative branch.
        const keep = Math.random() * 255 < sd[i + 3];
        sd[i + 3] = keep ? sd[i + 3] : 0;
        continue;
      }
      case 'linear-burn':
        sd[i] = clamp255(cbR + csR - 255);
        sd[i + 1] = clamp255(cbG + csG - 255);
        sd[i + 2] = clamp255(cbB + csB - 255);
        continue;
      case 'darker-color': {
        // Picks one whole color (not per-channel) — whichever of backdrop/source is darker overall.
        const useBackdrop = luma(cbR, cbG, cbB) <= luma(csR, csG, csB);
        sd[i] = useBackdrop ? cbR : csR; sd[i + 1] = useBackdrop ? cbG : csG; sd[i + 2] = useBackdrop ? cbB : csB;
        continue;
      }
      case 'lighter-color': {
        const useBackdrop = luma(cbR, cbG, cbB) >= luma(csR, csG, csB);
        sd[i] = useBackdrop ? cbR : csR; sd[i + 1] = useBackdrop ? cbG : csG; sd[i + 2] = useBackdrop ? cbB : csB;
        continue;
      }
      case 'vivid-light':
        sd[i] = csR < 128 ? colorBurn(cbR, 2 * csR) : colorDodge(cbR, 2 * (csR - 128));
        sd[i + 1] = csG < 128 ? colorBurn(cbG, 2 * csG) : colorDodge(cbG, 2 * (csG - 128));
        sd[i + 2] = csB < 128 ? colorBurn(cbB, 2 * csB) : colorDodge(cbB, 2 * (csB - 128));
        continue;
      case 'linear-light':
        sd[i] = clamp255(cbR + 2 * csR - 255);
        sd[i + 1] = clamp255(cbG + 2 * csG - 255);
        sd[i + 2] = clamp255(cbB + 2 * csB - 255);
        continue;
      case 'pin-light':
        sd[i] = csR < 128 ? darken(cbR, 2 * csR) : lighten(cbR, 2 * (csR - 128));
        sd[i + 1] = csG < 128 ? darken(cbG, 2 * csG) : lighten(cbG, 2 * (csG - 128));
        sd[i + 2] = csB < 128 ? darken(cbB, 2 * csB) : lighten(cbB, 2 * (csB - 128));
        continue;
      case 'hard-mix':
        sd[i] = cbR + csR >= 255 ? 255 : 0;
        sd[i + 1] = cbG + csG >= 255 ? 255 : 0;
        sd[i + 2] = cbB + csB >= 255 ? 255 : 0;
        continue;
      case 'subtract':
        sd[i] = clamp255(cbR - csR);
        sd[i + 1] = clamp255(cbG - csG);
        sd[i + 2] = clamp255(cbB - csB);
        continue;
      case 'divide':
        sd[i] = csR === 0 ? 255 : clamp255((cbR * 255) / csR);
        sd[i + 1] = csG === 0 ? 255 : clamp255((cbG * 255) / csG);
        sd[i + 2] = csB === 0 ? 255 : clamp255((cbB * 255) / csB);
        continue;
      default:
        continue; // not a custom mode — caller shouldn't reach here, but leave source untouched
    }
  }
}
