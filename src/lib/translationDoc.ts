import { ProcessedImage } from '../types';

export function createTranslationDoc(images: ProcessedImage[]): string {
  let doc = `============== ملاحظات للمترجم ==============
1. قم بتعديل الترجمة الموجودة أسفل قسم "الترجمة:" فقط ويفضل عدم تركها فارغة.
2. يجب أن تحافظ على العلامة [END] بعد نهاية الترجمة لكل نص.
3. يحظر تماماً تعديل السطور التي تحتوي على [ID:] لتجنب تعطل استيراد الملف.
4. يوجد في نهاية الملف قسم خاص ببيانات الإحداثيات والخطوط، الرجاء عدم حذفه أو تعديله.
=========================================\n\n`;

  images.forEach(img => {
    if (img.regions.length === 0) return;
    doc += `--- الصفحة: ${img.name} ---\n\n`;
    img.regions.forEach(r => {
      doc += `[ID: ${r.id}]\n`;
      doc += `النوع: ${r.type === 'bubble' ? 'فقاعة حوار' : 'مؤثر صوتي (SFX)'}\n`;
      doc += `الأصل:\n${r.originalText || '(فارغ)'}\n`;
      doc += `الترجمة:\n${r.translatedText || ''}\n`;
      doc += `[END]\n\n`;
    });
  });

  doc += `============== بيانات التحرير والاحداثيات (لا تلمس هذا الجزء) ==============\n`;
  const metadata = images.map(img => ({
    id: img.id,
    name: img.name,
    regions: img.regions.map(r => ({
      id: r.id,
      x: r.x, y: r.y, width: r.width, height: r.height,
      angle: r.angle, textColor: r.textColor, strokeColor: r.strokeColor,
      strokeWidth: r.strokeWidth, bgColor: r.bgColor, fontFamily: r.fontFamily,
      fontSize: r.fontSize, fontWeight: r.fontWeight, fontStyle: r.fontStyle,
      textAlign: r.textAlign, lineHeight: r.lineHeight, autoFitText: r.autoFitText,
      shadowBlur: r.shadowBlur, shadowColor: r.shadowColor
    }))
  }));
  doc += JSON.stringify(metadata);

  return doc;
}

export function parseTranslationDoc(docText: string, currentImages: ProcessedImage[]): ProcessedImage[] {
  const translations: Record<string, string> = {};
  
  // Extract texts based on ID and [END]
  const regex = /\[ID:\s*([a-zA-Z0-9-]+)\][\s\S]*?الترجمة:\n([\s\S]*?)\n(?:\[END\])/g;
  let match;
  while ((match = regex.exec(docText)) !== null) {
     const id = match[1];
     let translated = match[2];
     // remove trailing and leading space/newlines but keep internal ones
     translated = translated.replace(/^\s+|\s+$/g, '');
     translations[id] = translated;
  }

  // Update images maintaining everything else
  return currentImages.map(img => ({
    ...img,
    regions: img.regions.map(r => {
      if (translations[r.id] !== undefined) {
         return { ...r, translatedText: translations[r.id] };
      }
      return r;
    })
  }));
}
