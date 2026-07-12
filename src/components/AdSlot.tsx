import { useEffect, useState } from 'react';
import adImage1 from '../assets/a103ba81-1f9b-41dc-a6db-cd0109797bcb.png';
import adImage2 from '../assets/ad-2.png';

interface Ad {
  imageUrl: string;
  linkUrl: string;
}

const ADS: Ad[] = [
  { imageUrl: adImage1, linkUrl: 'www.example.com' },
  { imageUrl: adImage2, linkUrl: 'www.example.com' },
];
const ROTATE_MS = 10000;

// Shared across every AdSlot instance so a broken image (bad URL, 404,
// offline host) is skipped everywhere instead of leaving an empty
// liquid-glass box in its place.
const brokenAds = new Set<number>();

// Natural aspect ratio (height / width, as a %) for each ad, resolved once and
// shared across instances so the box never has to guess a size before the
// image loads and never collapses/jumps when the rotation swaps images.
const ratioCache = new Map<number, number>();

function preloadRatio(idx: number, url: string) {
  if (ratioCache.has(idx)) return;
  const img = new Image();
  img.onload = () => {
    ratioCache.set(idx, (img.naturalHeight / img.naturalWidth) * 100);
  };
  img.src = url;
}
ADS.forEach((ad, idx) => preloadRatio(idx, ad.imageUrl));

function currentIndex() {
  if (ADS.length === 0) return 0;
  return Math.floor(Date.now() / ROTATE_MS) % ADS.length;
}

function nextValidIndex(start: number): number {
  for (let i = 0; i < ADS.length; i++) {
    const candidate = (start + i) % ADS.length;
    if (!brokenAds.has(candidate)) return candidate;
  }
  return -1;
}

export function AdSlot({ placement, className }: { placement?: string; className?: string }) {
  const [index, setIndex] = useState(currentIndex());
  const [, bump] = useState(0);

  useEffect(() => {
    if (ADS.length < 2) return;
    const msIntoSlot = Date.now() % ROTATE_MS;
    const timeout = setTimeout(function tick() {
      setIndex(currentIndex());
    }, ROTATE_MS - msIntoSlot);
    const interval = setInterval(() => setIndex(currentIndex()), ROTATE_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  const validIndex = nextValidIndex(index);
  if (validIndex === -1) return null;
  const ad = ADS[validIndex];
  const ratio = ratioCache.get(validIndex);

  return (
    <a
      href={ad.linkUrl || undefined}
      target="_blank"
      rel="noopener noreferrer sponsored"
      aria-label="Advertisement"
      data-placement={placement}
      className={`liquid-glass relative block w-full overflow-hidden rounded-2xl transition-[padding-top] duration-500 ease-out ${className || ''}`}
      style={{ paddingTop: `${ratio ?? 20.4}%` }}
    >
      <img
        key={validIndex}
        src={ad.imageUrl}
        alt="Advertisement"
        className="absolute inset-0 w-full h-full object-contain animate-ad-fade"
        draggable={false}
        onLoad={e => {
          if (!ratioCache.has(validIndex)) {
            const img = e.currentTarget;
            ratioCache.set(validIndex, (img.naturalHeight / img.naturalWidth) * 100);
            bump(n => n + 1);
          }
        }}
        onError={() => {
          brokenAds.add(validIndex);
          bump(n => n + 1);
        }}
      />
    </a>
  );
}
