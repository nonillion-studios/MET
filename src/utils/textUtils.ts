import Konva from 'konva';

export function calculateAutoFitFontSize(
  text: string,
  width: number,
  height: number,
  fontFamily: string,
  fontStyle: string,
  lineHeight: number,
  letterSpacing: number,
  defaultFontSize: number
): number {
  if (!text) return defaultFontSize;

  let minFontSize = 8;
  let maxFontSize = 100;
  let bestFontSize = defaultFontSize;

  // Clean and find the longest word
  const words = text.split(/\s+/);
  const longestWord = words.reduce((a, b) => a.length > b.length ? a : b, '');

  const measureNode = new Konva.Text({
    text: longestWord,
    fontFamily: fontFamily,
    fontStyle: fontStyle,
    letterSpacing: letterSpacing,
  });

  const testNode = new Konva.Text({
    text: text.split('\n').map(line => '\u202B' + line + '\u200F').join('\n'),
    width: width,
    fontFamily: fontFamily,
    fontStyle: fontStyle,
    lineHeight: lineHeight,
    letterSpacing: letterSpacing,
    wrap: 'word'
  });

  // Give 8% height buffer and 4% width buffer to handle speech bubble curvaceous edges without scaling down to tiny texts
  const heightLimit = height * 1.08;
  const widthLimit = width * 1.04;

  while (minFontSize <= maxFontSize) {
    const mid = Math.floor((minFontSize + maxFontSize) / 2);
    
    testNode.fontSize(mid);
    const textHeight = testNode.height();

    measureNode.fontSize(mid);
    const longestWordWidth = measureNode.width();

    if (textHeight > heightLimit || longestWordWidth > (widthLimit - 4)) {
      maxFontSize = mid - 1;
    } else {
      bestFontSize = mid;
      minFontSize = mid + 1;
    }
  }

  measureNode.destroy();
  testNode.destroy();

  return Math.max(9, bestFontSize); // Absolute minimum 9px to prevent unreadable microscopic fonts
}
