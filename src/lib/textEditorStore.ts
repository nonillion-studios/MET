import { get, set } from 'idb-keyval';

export interface TextEditorDoc {
  id: string;
  title: string;
  dir: 'ltr' | 'rtl';
  /** Each entry is one A4 page's innerHTML. */
  pages: string[];
}

const STORAGE_KEY = 'text_editor_docs';

export async function loadTextEditorDocs(): Promise<TextEditorDoc[] | null> {
  const saved = await get(STORAGE_KEY);
  return Array.isArray(saved) ? saved : null;
}

export async function saveTextEditorDocs(docs: TextEditorDoc[]): Promise<void> {
  await set(STORAGE_KEY, docs);
}
