import { useEffect, useState } from 'react';
import { Histogram } from './Histogram';
import { StudioPanel } from './StudioPanel';

type Channel = 'luminance' | 'r' | 'g' | 'b';

interface HistogramPanelProps {
  getSource: () => HTMLCanvasElement | null;
  hideTitle?: boolean;
}

export function HistogramPanel({ getSource, hideTitle }: HistogramPanelProps) {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [channel, setChannel] = useState<Channel>('luminance');

  useEffect(() => {
    function update() {
      const canvas = getSource();
      if (!canvas) { setImageData(null); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { setImageData(null); return; }
      setImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
    }
    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, [getSource]);

  const channels: { id: Channel; label: string }[] = [
    { id: 'luminance', label: 'Lum' },
    { id: 'r', label: 'R' },
    { id: 'g', label: 'G' },
    { id: 'b', label: 'B' },
  ];

  return (
    <StudioPanel title="Histogram" hideTitle={hideTitle} bare bodyClassName="p-2 flex flex-col gap-2">
      <div className="flex gap-1">
        {channels.map(ch => (
          <button
            key={ch.id}
            type="button"
            onClick={() => setChannel(ch.id)}
            className={`px-2 py-0.5 rounded-control text-micro border transition-colors ${
              channel === ch.id ? 'bg-accent-soft border-accent/30 text-accent' : 'bg-transparent border-hairline text-ink-faint hover:text-ink'
            }`}
          >
            {ch.label}
          </button>
        ))}
      </div>
      <Histogram imageData={imageData} channel={channel} height={80} />
    </StudioPanel>
  );
}
