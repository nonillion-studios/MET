export interface ProcessedImage {
  id: string;
  filename: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface Chapter {
  id: string;
  name: string;
  coverUrl: string;
  images: ProcessedImage[];
}

export interface Volume {
  id: string;
  name: string;
  coverUrl: string;
  chapters: Chapter[];
}

export interface MangaSeries {
  id: string;
  title: string;
  type: "manga" | "manhwa";
  coverUrl: string;
  description: string;
  volumes: Volume[];
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  mangas: MangaSeries[];
}

export type AutomationTrigger =
  | { type: 'interval'; everyMs: number }
  | { type: 'onOpen' };

export type AutomationAction =
  | { type: 'reminder'; message: string }
  | { type: 'staleChapterCheck'; days: number }
  | { type: 'cloudBackupReminder' };

export interface Automation {
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}
