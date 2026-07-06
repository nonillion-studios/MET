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
  images: ProcessedImage[];
}

export interface Volume {
  id: string;
  name: string;
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
