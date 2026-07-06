import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import adsConfig from '../config/ads.json';
import { GlassCard } from './ui';

interface AdBanner {
  id: string;
  placement: string;
  enabled: boolean;
  title: string;
  subtitle: string;
  imageUrl: string;
  linkUrl: string;
}

const BANNERS = (adsConfig as { banners: AdBanner[] }).banners;

export function adsGloballyEnabled(): boolean {
  return localStorage.getItem('met_ads_enabled') !== 'false';
}

export function AdSlot({ placement, className }: { placement: string; className?: string }) {
  const [visible, setVisible] = useState(adsGloballyEnabled());

  useEffect(() => {
    const onStorage = () => setVisible(adsGloballyEnabled());
    window.addEventListener('storage', onStorage);
    window.addEventListener('met-ads-toggle', onStorage as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('met-ads-toggle', onStorage as EventListener);
    };
  }, []);

  const banner = BANNERS.find(b => b.placement === placement && b.enabled);
  if (!banner || !visible) return null;

  const content = (
    <GlassCard
      variant="regular"
      radius="2xl"
      className={`flex items-center gap-3 px-4 py-3 border-dashed !border-2 border-hairline text-ink-muted ${className || ''}`}
    >
      {banner.imageUrl ? (
        <img src={banner.imageUrl} alt={banner.title} className="w-10 h-10 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center shrink-0">
          <Megaphone size={18} className="text-accent" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink truncate">{banner.title}</p>
        <p className="text-[11px] text-ink-faint truncate">{banner.subtitle}</p>
      </div>
      <span className="text-[9px] uppercase tracking-widest text-ink-faint font-mono shrink-0">Ad</span>
    </GlassCard>
  );

  if (banner.linkUrl) {
    return (
      <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }

  return content;
}
