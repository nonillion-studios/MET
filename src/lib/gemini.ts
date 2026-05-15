import { GoogleGenAI, Type } from "@google/genai";
import { Region } from "../types";

export interface RawRegion {
  type: "bubble" | "sfx";
  originalText: string;
  translatedText: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  angle: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  bgColor?: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  lineHeight: number;
}

export async function processMangaPages(pages: { id: string, base64Image: string, mimeType: string }[], customApiKey?: string): Promise<{ id: string, regions: RawRegion[] }[]> {
  const key = customApiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("API Key is required");
  }
  const ai = new GoogleGenAI({ apiKey: key });

  const contents: any[] = [
    {
      text: `You are an expert manga translator and professional typesetter.
I am providing ${pages.length} manga page(s). Analyze EACH page independently.
For each page, detect all speech bubbles, narrative text, and sound effects (SFX).

1. Identify the original Japanese text.
2. Translate it accurately and naturally to Arabic. Prioritize smooth, colloquial or literary flow depending on context (do not use rigid literal translation). Ensure natural phrasing for Arabic readers.
3. Determine the bounding box coordinates [ymin, xmin, ymax, xmax] scaled to 0-1000.
4. Categorize as 'bubble' or 'sfx'.
5. typesetter decisions: 
    - angle: suggested text rotation in degrees (e.g., 0 for normal, angled for SFX).
    - textColor: hex color code.
    - strokeColor: hex color code for the text outline (critical for SFX or hiding original text).
    - strokeWidth: outline thickness (e.g. 0 to 10).
    - fontFamily: choose exactly from: "Cairo", "Tajawal", "Marhey", "Aref Ruqaa". (e.g. Marhey for bubbles, Aref Ruqaa for SFX, Cairo for narration).
    - fontSize: suggest a base size (e.g. 24-72).
    - fontWeight: 'normal', 'bold', '800', etc.
    - fontStyle: 'normal' or 'italic'.
    - textAlign: 'center', 'right', 'left' (mostly center for bubbles).
    - lineHeight: usually 1.2 to 1.5.

Return ONLY a JSON array of objects, one for each page, in the EXACT order they were provided.
Schema: [ { "pageIndex": 0, "regions": [ ... ] } ]`
    }
  ];

  pages.forEach(p => {
    contents.push({
      inlineData: {
        data: p.base64Image.split(",")[1] || p.base64Image,
        mimeType: p.mimeType,
      }
    });
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            pageIndex: { type: Type.INTEGER },
            regions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "either 'bubble' or 'sfx'" },
                  originalText: { type: Type.STRING },
                  translatedText: { type: Type.STRING },
                  ymin: { type: Type.NUMBER, description: "0-1000" },
                  xmin: { type: Type.NUMBER, description: "0-1000" },
                  ymax: { type: Type.NUMBER, description: "0-1000" },
                  xmax: { type: Type.NUMBER, description: "0-1000" },
                  angle: { type: Type.NUMBER, description: "degrees, usually 0 for bubbles" },
                  textColor: { type: Type.STRING, description: "hex color" },
                  strokeColor: { type: Type.STRING, description: "hex color for text outline" },
                  strokeWidth: { type: Type.NUMBER },
                  bgColor: { type: Type.STRING, description: "Hex bg color or transparent" },
                  fontFamily: { type: Type.STRING, description: "Cairo, Tajawal, Marhey, or Aref Ruqaa" },
                  fontSize: { type: Type.NUMBER },
                  fontWeight: { type: Type.STRING },
                  fontStyle: { type: Type.STRING },
                  textAlign: { type: Type.STRING },
                  lineHeight: { type: Type.NUMBER }
                },
                required: ["type", "originalText", "translatedText", "ymin", "xmin", "ymax", "xmax", "angle", "textColor", "strokeColor", "strokeWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "textAlign", "lineHeight"]
              }
            }
          },
          required: ["pageIndex", "regions"]
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No text returned from Gemini");

  try {
    const rawData = JSON.parse(text) as { pageIndex: number, regions: RawRegion[] }[];
    return rawData.map((item, idx) => ({
      id: pages[Math.min(idx, pages.length - 1)].id,
      regions: item.regions || []
    }));
  } catch (error) {
    console.error("Failed to parse JSON", text);
    throw new Error("Failed to parse AI response");
  }
}
