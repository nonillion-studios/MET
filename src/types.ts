export interface Region {
  id: string;
  type: "bubble" | "sfx";
  originalText: string;
  translatedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  bgColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  lineHeight: number;
}

export interface PaintStroke {
  tool: "erase" | "draw" | "fill_poly" | "bg_erase" | "smart_sfx";
  points: number[];
  color: string;
  size: number;
}

export interface ProcessedImage {
  id: string;
  filename: string;
  dataUrl: string;
  mimeType: string;
  regions: Region[];
  paintStrokes: PaintStroke[];
  history?: { regions: Region[], paintStrokes: PaintStroke[] }[];
  status: "idle" | "processing" | "done" | "error";
  width: number;
  height: number;
  error?: string;
}
