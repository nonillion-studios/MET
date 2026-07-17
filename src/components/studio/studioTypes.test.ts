import { describe, it, expect } from 'vitest';
import {
  parseTyperScript, createTyperStyle, buildFolderTree, flattenFolderTree,
  createTyperFolder, reparentFolder, deleteTyperFolder,
  type TyperStyle, type TyperFolder,
} from './studioTypes';

/**
 * `parseTyperScript` and the TyperFolder tree helpers are the pure core of TypeR (scripted
 * lettering). Folder priority, configurable ignore rules, and defaultStyleId fallback are all new
 * ports of the real ScanR/TypeR extension's behavior, and — like `layerTree.ts` — illegal folder
 * tree edits (cycles, self-parenting) must no-op rather than corrupt the tree.
 */

function style(over: Partial<TyperStyle>): TyperStyle {
  return { id: over.id ?? 'style', name: over.name ?? 'Style', prefix: '', fontFamily: 'Arial', fontSize: 20, color: '#000000', bold: false, italic: false, strokeColor: '#ffffff', strokeWidth: 0, ...over };
}

describe('parseTyperScript', () => {
  it('matches the longest prefix by default', () => {
    const styles = [style({ id: 'dialogue', prefix: '' }), style({ id: 'sfx', prefix: '!!' })];
    const [line] = parseTyperScript('!!BOOM', styles);
    expect(line.style.id).toBe('sfx');
  });

  it('prioritizes a style in currentFolderId over a longer prefix match elsewhere', () => {
    const folders: TyperFolder[] = [{ id: 'a', name: 'A', parentId: null, order: 0 }, { id: 'b', name: 'B', parentId: null, order: 1 }];
    const styles = [
      style({ id: 'short-in-a', prefix: '!', folderId: 'a' }),
      style({ id: 'long-in-b', prefix: '!!', folderId: 'b' }),
    ];
    const linesNoFolder = parseTyperScript('!!BOOM', styles, { folders });
    expect(linesNoFolder[0].style.id).toBe('long-in-b');

    const linesWithFolder = parseTyperScript('!!BOOM', styles, { folders, currentFolderId: 'a' });
    expect(linesWithFolder[0].style.id).toBe('short-in-a');
  });

  it('extends folder priority to descendant folders', () => {
    const folders: TyperFolder[] = [
      { id: 'parent', name: 'Parent', parentId: null, order: 0 },
      { id: 'child', name: 'Child', parentId: 'parent', order: 0 },
    ];
    const styles = [style({ id: 'in-child', prefix: '!', folderId: 'child' }), style({ id: 'unsorted', prefix: '!' })];
    const lines = parseTyperScript('!BOOM', styles, { folders, currentFolderId: 'parent' });
    expect(lines[0].style.id).toBe('in-child');
  });

  it('honors configurable ignoreLinePrefixes beyond the "##" default', () => {
    const styles = [style({ id: 'dialogue', prefix: '' })];
    const lines = parseTyperScript('%% skip me\nreal line', styles, { ignoreLinePrefixes: ['##', '%%'] });
    expect(lines).toHaveLength(1);
    expect(lines[0].content).toBe('real line');
  });

  it('strips configured ignoreTags from anywhere in the line', () => {
    const styles = [style({ id: 'dialogue', prefix: '' })];
    const lines = parseTyperScript('Hello [TL: note] world', styles, { ignoreTags: ['[TL: note]'] });
    expect(lines[0].content).toBe('Hello  world');
  });

  it('falls back to defaultStyleId when no prefix matches and there is no empty-prefix style', () => {
    const styles = [style({ id: 'sfx', prefix: '!!' }), style({ id: 'thought', prefix: '~' })];
    const lines = parseTyperScript('plain line', styles, { defaultStyleId: 'thought' });
    expect(lines[0].style.id).toBe('thought');
  });

  it('still falls back to the empty-prefix style when no defaultStyleId is set', () => {
    const styles = [style({ id: 'sfx', prefix: '!!' }), style({ id: 'dialogue', prefix: '' })];
    const lines = parseTyperScript('plain line', styles);
    expect(lines[0].style.id).toBe('dialogue');
  });
});

describe('TyperFolder tree', () => {
  it('buildFolderTree nests by parentId and sorts by order', () => {
    const folders: TyperFolder[] = [
      { id: 'b', name: 'B', parentId: null, order: 1 },
      { id: 'a', name: 'A', parentId: null, order: 0 },
      { id: 'a1', name: 'A1', parentId: 'a', order: 0 },
    ];
    const tree = buildFolderTree(folders);
    expect(tree.map(n => n.id)).toEqual(['a', 'b']);
    expect(tree[0].children.map(n => n.id)).toEqual(['a1']);
  });

  it('flattenFolderTree produces indented breadcrumb labels', () => {
    const folders: TyperFolder[] = [{ id: 'a', name: 'A', parentId: null, order: 0 }, { id: 'a1', name: 'A1', parentId: 'a', order: 0 }];
    const options = flattenFolderTree(buildFolderTree(folders));
    expect(options).toEqual([
      { id: 'a', depth: 0, label: 'A' },
      { id: 'a1', depth: 1, label: 'A / A1' },
    ]);
  });

  it('createTyperFolder assigns the next sibling order under a parent', () => {
    const folders: TyperFolder[] = [{ id: 'a', name: 'A', parentId: null, order: 0 }];
    const folder = createTyperFolder(folders, 'B', null);
    expect(folder.order).toBe(1);
    expect(folder.parentId).toBeNull();
  });

  it('reparentFolder no-ops on self-parenting', () => {
    const folders: TyperFolder[] = [{ id: 'a', name: 'A', parentId: null, order: 0 }];
    expect(reparentFolder(folders, 'a', 'a')).toBe(folders);
  });

  it('reparentFolder no-ops when the new parent is a descendant (would create a cycle)', () => {
    const folders: TyperFolder[] = [
      { id: 'a', name: 'A', parentId: null, order: 0 },
      { id: 'b', name: 'B', parentId: 'a', order: 0 },
    ];
    const result = reparentFolder(folders, 'a', 'b');
    expect(result).toBe(folders);
  });

  it('reparentFolder moves a folder under a new parent otherwise', () => {
    const folders: TyperFolder[] = [
      { id: 'a', name: 'A', parentId: null, order: 0 },
      { id: 'b', name: 'B', parentId: null, order: 0 },
    ];
    const result = reparentFolder(folders, 'b', 'a');
    expect(result.find(f => f.id === 'b')?.parentId).toBe('a');
  });

  it('deleteTyperFolder removes descendant folders and unsorts (not deletes) their styles', () => {
    const folders: TyperFolder[] = [
      { id: 'parent', name: 'Parent', parentId: null, order: 0 },
      { id: 'child', name: 'Child', parentId: 'parent', order: 0 },
    ];
    const styles = [style({ id: 's1', folderId: 'child' }), style({ id: 's2', folderId: null })];
    const result = deleteTyperFolder(folders, styles, 'parent');
    expect(result.folders).toHaveLength(0);
    expect(result.styles.find(s => s.id === 's1')?.folderId).toBeNull();
    expect(result.styles.find(s => s.id === 's2')?.folderId).toBeNull();
  });
});
