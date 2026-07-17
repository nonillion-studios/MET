# CLAUDE.md — MangaStudio

دليل المشروع لجلسات Claude المستقبلية. اقرأه بالكامل قبل تعديل `mangastudio.html`.

## What this is

**MangaStudio** — استوديو ترجمة وتنظيف مانجا/ويبتون كامل في **ملف HTML واحد** (بدون build، بدون تبعيات وقت التطوير). يعمل بفتحه مباشرة في المتصفح (`file://`). التبعية الخارجية الوحيدة تُحمَّل عند الطلب: `ag-psd` من jsDelivr لتصدير PSD.

ثلاث شاشات (أوضاع) يديرها `setMode()` عبر كلاسات على `<body>`:

| Mode | body class | المحتوى |
|---|---|---|
| Home | `mode-home` | واجهة بأسلوب Photoshop Home: شريط جانبي (`.ph-side`) + بطاقات + Recent/قوالب |
| Studio | `mode-studio` | الكانفس + كل اللوحات (كل عناصر الاستوديو تحمل class `studio-el`) |
| Text Editor | `mode-text` | محرر بترقيم صفحات مثل Word (`#textEditor`) |

## File anatomy (ترتيب الأقسام داخل الملف)

1. `<style>` — كل الـ CSS. متغيرات التصميم في `:root` (لغة Liquid Glass: `--glass`, `--accent:#7c6af5`, `--blur`…). كتل CSS مُعلَّمة بتعليقات `V3…V7` حسب الإصدار.
2. HTML: `#homeScreen` → `#viewport` (الكانفس) → `#topbar` → `#optionsbar` → `#toolrail` → `#pages` → `#inspector` → `#typerPanel` → `#scriptDrawer` → `#minimap` → `#statusbar` → المودالات (`#cmdk-overlay`, `#import-overlay`, `#export-overlay`, `#project-overlay`) → `#textEditor` → `#musicDock` → `#colorPanel` → `#brushPanel` → popovers/toast → inputs مخفية.
3. `<script>` واحد في الأسفل — كله vanilla JS. الأدوات المساعدة: `$`, `$$`, `toast(title,sub)`.

## Core state (لا تكسر هذه العقود)

```js
// المشاريع والفصول والصفحات
chapters = { 'Ch. 01': { 'Page 07': {orig,origUrl,origSize, clean,cleanUrl,cleanSize, texts} } }
pageStore = chapters[curChapter]   // مرجع حي — switchChapter() يعيد ربطه
currentPage = 'Page 07' | ''       // مفتاح نصي، ليس رقماً
pageImg    // HTMLImage للنسخة المعروضة (clean ?? orig) — تستخدمه drawBase/التصدير/الإحداثيات
```

- **الفرز برقم الصفحة**: `pageNameFromFile()` يلتقط *آخر* مجموعة أرقام في اسم الملف (`ch42_p07.png → Page 07`). ملفات بلا أرقام تُرقَّم تسلسلياً.
- **الأصل فوق التبييض**: `#origOverlay` (div بخلفية) داخل `#page`، يظهر عبر `body.show-original` + `data-avail="1"` — `toggleOriginal()`.
- **لا يوجد demo/placeholder**: أي مشروع يبدأ فارغاً (`updateEmptyState()` يظهر `#emptyState` ويخفي `#page`). عناصر الديمو القديمة (`.bubble/.panel-box/.sfx/.ai-box`) ما زالت في الـ DOM لكنها مخفية دائماً بـ `body.real-project` — **لا تعتمد عليها في ميزات جديدة**.

## Canvas engine

- `#page` عنصر DOM يتقلّص/يتمدد: `width` + `aspect-ratio` تُضبط من `refreshPageImages()` حسب أبعاد الصورة الطبيعية (ويبتون = عرض 360–600px وارتفاع حقيقي).
- **Zoom**: `setZoom()` عبر `--zoom` scale على `#page`. **Pan**: `panX/panY` translate على `#stage` — عجلة، أداة Hand، Space، الزر الأوسط. `resetPan()` عند فتح صفحة. `zoomFit()` (زر Fit، مفتاح `0`).
- **Paint**: `#paint` canvas داخل الصفحة بدقة ×2. محرك **Stamps** (`stamp()`): فرش soft/hard/ink/airbrush/chalk/calligraphy + فرش صور مرفوعة (`brushDefs[key].img`). `strokes[]` = لقطات ImageData للتراجع (سقف 25).
- **Clone**: Alt+Click مصدر → `cloneSegment()` ينسخ من `comp` (art+paint). **Content-Aware**: سحب مستطيل → تعبئة من متوسط ألوان الحواف. **Eyedropper**: J أو Alt+Click بالفرشاة.
- `art` = canvas خفي يحاكي الصفحة (`drawBase()` يرسم الصورة المرفوعة أو الموك) — مصدر العينات للـ clone/CA وأساس التصدير.
- **Pen**: مسارات فيكتور في `#penSvg` (viewBox 1000×1414)، مقابض Bezier، Stroke/Fill إلى `#paint` عبر `penPath2D()`.

## Text layers (أداة الكتابة + TypeR)

- `#textLayer` داخل الصفحة؛ العناصر `.txt-item` (left/top بالنسبة المئوية، fontSize بالبكسل). إنشاء: نقرة بأداة Text. تحريك: سحب بأداة Select. تحرير: دبل-كليك → `startTxtEdit()` يعيد استخدام `#textToolbar` (نفس آلية `editingBubble`). حذف: Delete. **الحفظ لكل صفحة**: `saveTexts()` يخزن `innerHTML` في `pageStore[page].texts`، ويُستعاد في `selectPage()`.
- **TypeR v2** (`#typerPanel`, زر ⌨): **منفذ مطابق للإضافة الحقيقية TypeR 2.5** (المصدر في app_src/context.jsx). الحالة في كائن `TR`. خوارزمية التحليل حرفياً: بادئات التجاهل (`##`)، بادئات الأنماط (tags) بأولوية مجلد النمط الحالي ثم العام، أسطر `//` = إكمال تُلحق تلقائياً بآخر طبقة موضوعة مع سطر جديد، `Page N` (وعربي: الصفحة/ص + أرقام هندية عبر `arNum`) → **تبديل صفحة تلقائي** أثناء التقدم. الأنماط: `{name,folder,prefixes[],prefixColor,props{font,size,bold,italic,color},stroke{size,color}}` — Stroke يُعرض بـ `-webkit-text-stroke` + `dataset.strokeW/C` ويُرسم في التصدير بـ `strokeText`. **التوسيط التلقائي** `centerInBubble()`: flood-fill على مصغّر `comp` (280px) من موضع النص لكشف حدود الفقاعة. محرر نمط (`#trEdit`)، مجلدات قابلة للطي، نسخ نمط، استيراد/تصدير `TypeR_Export.json`. اختصارات: Ctrl+Enter التالي، Shift+X الصفحة التالية، Ctrl+Shift+± حجم النص المحدد، Esc يفك التسليح. الوضع: ⊕ ثم نقرة على الصفحة (capture-phase قبل بقية المستمعين).
- تلوين التحديد داخل النص: `ttColor` يستخدم `execCommand('foreColor')` إن وُجد تحديد، وإلا يلوّن العنصر كاملاً. `ttWheel` 🎨 يفتح عجلة الألوان.

## Marquee tool + Multi-Bubble (TypeR integration)

- **Marquee** (`data-tool="marquee"`, M · Shift+M يبدّل النوع) بأربعة أنواع في flyout على الزر: `rect`/`ell`/`col`/`row`. الرسم على `#marqLayer` (نسب %) عبر مستمع **capture-phase** على `#paint` — لذا الحارس `if(curTool==='marquee')return` في محرك الرسم. Shift = مربع/دائرة مثالية. `#marqSize` يعرض الأبعاد بالدقة الحقيقية.
- **تحديد مفرد + TypeR مفتوح**: زر `#mqAuto` (Auto/Manual). Auto → `placeInSel()` يضع السطر الحالي موسَّطاً بنمطه ثم `trAdvance()`. Manual → ينشئ صندوقاً فارغاً (أو نص السطر) ويفتح التحرير.
- **Multi-Bubble Mode** (`#mbToggle`, footer badge `#mbBadge`، اختصار الإضافة Ctrl+Alt+M غير مربوط تجنباً للتعارض): التحديدات تتراكم في `marqSels[]` مرقّمة، ثم `mbFill()` يملؤها **بالتتابع** من أسطر TypeR غير المتجاهلة بنمط كل سطر.
- **إرسال المحرر → TypeR**: `#trFromEditor` (وزر `#teToTyper` داخل المحرر) يرسل **كل نص** المحرر (كل صفحات كل التبويبات، مع تجريد علامات spell-miss) إلى `#trPaste` ويشغّل `trParse()`.
- **تلوين نص عام**: زر لون في `#ctxbar` (يظهر الآن فوق صناديق `.txt-item` المحددة أيضاً) يلوّن الصندوق كامل الحالي بلون الـ FG؛ داخل التحرير `ttColor` يلوّن التحديد فقط عبر `execCommand`.

## Export

`#exportGo`: PNG/JPG/WEBP — يركّب بدقة الصورة الحقيقية: `drawBase` → `#paint` مكبَّراً → `drawBubbleText` + `drawTextItems` (يتخطى العناصر المخفية `offsetWidth===0`). JPG يُسطَّح على أبيض.
**PSD**: `exportPSD()` — يحمّل `ag-psd@25` كسولاً من CDN؛ طبقات: Background / Cleaning / طبقة **نص قابلة للتعديل** لكل `.txt-item` (`text:{text,transform,style:{font,fontSize,fillColor,fauxBold/Italic}}`). يتطلب إنترنت؛ فشل التحميل → toast واضح.

## Text editor (Word-like)

- `#teDoc` حاوية (dir/lang/spellcheck تُورَّث) تضم صفحات `.te-page` (A4 = 794×1123px) contenteditable.
- **الترقيم**: `teReflow()` — سحب لأعلى ثم دفع الفائض لأسفل عبر نقل عقد DOM، حذف الصفحات الفارغة الذيلية، الحفاظ على caret. يعمل على كل `input`.
- **Zoom** بخاصية CSS `zoom` على `#teDoc` + `flex-wrap` → صفحات جنباً إلى جنب عند التصغير.
- **تبويبات = مستندات**: `teDocs[] = {title, pages:[html…], dir}`، `switchTeDoc/saveTeDoc/loadTeDoc`.
- **المدقق الإملائي**: قاموس `AR_FIXES` (عربي + إنجليزي). `runProof()` → `markWord()` يلف كل خطأ بـ `<span class="spell-miss" data-fix>` (تسطير أحمر متموج) — **نقرة على الكلمة تصححها**، ولوحة النتائج فيها إصلاح لكل نوع/الكل/مسح التمييز. **مهم**: عند أي تصدير تُزال العلامات من نسخة clone (`l5` patch) — حافظ على هذا.
- يبدأ فارغاً (بلا placeholder). البحث والاستبدال عبر `replaceInDoc()` (TreeWalker).

## Home

`phView(view)` يبدّل المحتوى: home/works/shared/templates/deleted — القوالب تفتح `startProject()`. البحث `#hrSearch` يفلتر البطاقات. أزرار الشريط الجانبي proxies إلى `#goStudio/#goText`.

## Conventions & gotchas

- **التعديل بالباتشات**: عدّل بسلاسل فريدة (python replace/str_replace) وتحقق دائماً بـ `new Function(scriptContent)` بعد كل تغيير.
- دوال معرّفة بـ `function` (hoisted) — يعتمد الترتيب عليها؛ لا تحوّلها إلى const arrow بلا فحص.
- `.tool[data-tool]` فقط يستدعي `setTool` — أزرار مثل `#origBtn` بلا data-tool عمداً. `setTool` يحرس `if(!toolMeta[name])return`.
- مستمعو keyboard يتجاهلون INPUT/TEXTAREA/contenteditable، ومحروسون بـ `mode-studio` لاختصارات الأدوات.
- `PAINT_TOOLS` يحدد متى يستقبل `#paint` الأحداث (`body.painting`). أدوات جديدة على الصفحة نفسها: أضف كلاس body خاصاً + عطّل pointer-events للعناصر المتداخلة (انظر `pinning/penning/texting/typer-arm`).
- الصور تُخزَّن كـ object URLs — لا revoke (مقصود، الحالة حية).
- RTL: واجهة إنجليزية للأدوات، محتوى المستخدم عربي — انتبه لـ `direction` عند إضافة حقول.

## Known limitations / روадmap

- لا حفظ دائم (كل شيء in-memory). التالي المنطقي: تسلسل المشروع إلى JSON + IndexedDB أو ملف `.msp`.
- طبقة paint واحدة لكل جلسة صفحة (تُمسح عند تبديل الصفحة) — يمكن حفظها كـ dataURL في pageStore مثل texts.
- محرر النصوص: لا دمج backspace عبر حدود الصفحات (الـ pull-back يعوّضه بعد أول إدخال).
- PSD: أسماء الخطوط تمرَّر كما هي؛ فوتوشوب يستبدل غير المثبّت.
- YouTube iframe يُحجب داخل sandbox معاينة Claude — يعمل عند فتح الملف مباشرة.

## Quick test checklist بعد أي تعديل

1. `node -e "new Function(script)"` ينجح.
2. Home → مشروع جديد → Import أصل+تبييض بأسماء `01_x.png` → تفتح الصفحة بنسبتها، O يعرض الأصل فوقها.
3. عجلة الماوس تمرر ويبتوناً طويلاً؛ Space+سحب؛ Fit.
4. T ينشئ صندوق نص، TypeR يضع 3 أسطر، Export PNG يتضمنها، PSD يفتح بطبقات.
5. المحرر: اكتب حتى صفحة ثانية تلقائياً، تدقيق إملائي يظلّل "لاكن"، نقرة تصححها، DOC يفتح في Word بصفحتين.
