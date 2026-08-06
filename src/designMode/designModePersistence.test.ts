import { describe, expect, it } from 'vitest';
import { designKey, imageIdFromDesignKey, DESIGN_KEY_PREFIX } from './designModePersistence';

describe('designModePersistence key isolation', () => {
  it('prefixes Design Mode keys distinctly from Studio\'s studio_<chapterId> keys', () => {
    expect(designKey('img-1')).toBe('design_img-1');
    expect(designKey('img-1').startsWith('studio_')).toBe(false);
  });

  it('round-trips an id through designKey/imageIdFromDesignKey', () => {
    const id = 'e2e-design-image';
    expect(imageIdFromDesignKey(designKey(id))).toBe(id);
  });

  it('does not treat a studio_ key (or any non-design_ key) as a Design Mode key', () => {
    expect(imageIdFromDesignKey('studio_chapter-1')).toBeNull();
    expect(imageIdFromDesignKey('studio_versions_chapter-1')).toBeNull();
    expect(imageIdFromDesignKey('workspaces_library')).toBeNull();
  });

  it('never produces a key that could be mistaken for a Studio key', () => {
    // Guards the isolation guarantee itself: any id, even an adversarial one, still resolves to a
    // design_-prefixed key and back to the same id.
    for (const id of ['a', 'studio_x', 'design_nested', '']) {
      expect(designKey(id).startsWith(DESIGN_KEY_PREFIX)).toBe(true);
      expect(imageIdFromDesignKey(designKey(id))).toBe(id);
    }
  });
});
