import { describe, it, expect } from 'vitest';
import { drawTextLayer } from './exportImage';
import { DEFAULT_TEXT_SHADOW, DEFAULT_TEXT_GRADIENT, type TextLayerData } from '../components/studio/studioTypes';

/** Mirrors createTextLayer's defaults (studioTypes.ts) minus x/y/width, which each test sets. */
function makeText(overrides: Partial<TextLayerData> = {}): TextLayerData {
  return {
    content: 'Line one\nLine two\nLine three\nLine four\nLine five',
    x: 10,
    y: 20,
    width: 200,
    autoWidth: false,
    textMode: 'area',
    letterSpacing: 0,
    shadow: { ...DEFAULT_TEXT_SHADOW },
    gradient: { ...DEFAULT_TEXT_GRADIENT },
    runs: [],
    fontFamily: 'Arial',
    fontSize: 20,
    color: '#000000',
    align: 'left',
    bold: false,
    italic: false,
    underline: false,
    lineHeight: 1.15,
    strokeColor: '#ffffff',
    strokeWidth: 0,
    rotation: 0,
    status: 'draft',
    comment: '',
    ...overrides,
  };
}

/** A minimal duck-typed CanvasRenderingContext2D that just records what was called on it — the
 *  unit test environment here runs under Node (vitest.config.ts has no jsdom/canvas environment),
 *  so there's no real canvas to render into or read pixels back from; recording calls is the only
 *  way to assert `drawTextLayer` establishes (or doesn't establish) a clip. */
function makeMockCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };
  const ctx: Record<string, unknown> = {
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    rect: record('rect'),
    clip: record('clip'),
    ellipse: record('ellipse'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    drawImage: record('drawImage'),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    textBaseline: 'alphabetic',
    textAlign: 'start',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('drawTextLayer overflow clip (matching TextLayerNode.tsx\'s live-canvas clip)', () => {
  it('clips to the fixed-height frame for area text with an explicit fixedHeight', () => {
    const { ctx, calls } = makeMockCtx();
    const text = makeText({ fixedHeight: 30 });
    drawTextLayer(ctx, text);

    const rectCall = calls.find(c => c.name === 'rect');
    expect(rectCall).toBeDefined();
    expect(rectCall!.args).toEqual([text.x, text.y, text.width, text.fixedHeight]);
    expect(calls.some(c => c.name === 'clip')).toBe(true);
  });

  it('does not clip point text, however tall the content', () => {
    const { ctx, calls } = makeMockCtx();
    const text = makeText({ autoWidth: true, fixedHeight: undefined });
    drawTextLayer(ctx, text);
    expect(calls.some(c => c.name === 'rect')).toBe(false);
  });

  it('does not clip area text with no explicit fixedHeight (auto-grow box)', () => {
    const { ctx, calls } = makeMockCtx();
    const text = makeText({ fixedHeight: undefined });
    drawTextLayer(ctx, text);
    expect(calls.some(c => c.name === 'rect')).toBe(false);
  });
});
