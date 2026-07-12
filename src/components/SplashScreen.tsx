import { useEffect, useState } from 'react';
import splashVideoWebm from '../assets/splash-intro.webm';
import splashVideoMp4 from '../assets/splash-intro.mp4';

export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fallback = setTimeout(finish, 6000);
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish() {
    setLeaving(true);
    setTimeout(onFinish, 700);
  }

  return (
    <div className={`fixed inset-0 z-[999] bg-black overflow-hidden ${leaving ? 'pointer-events-none' : ''}`}>
      {/* Top half of video, slides up and off-screen */}
      <div
        className={`absolute inset-x-0 top-0 h-1/2 bg-black overflow-hidden transition-transform duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${
          leaving ? '-translate-y-full' : 'translate-y-0'
        }`}
      >
        <video
          autoPlay
          muted
          playsInline
          onEnded={finish}
          className="absolute inset-x-0 top-0 w-full h-[200%] object-cover"
        >
          <source src={splashVideoWebm} type="video/webm" />
          <source src={splashVideoMp4} type="video/mp4" />
        </video>
      </div>

      {/* Bottom half of video, slides down and off-screen */}
      <div
        className={`absolute inset-x-0 bottom-0 h-1/2 bg-black overflow-hidden transition-transform duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${
          leaving ? 'translate-y-full' : 'translate-y-0'
        }`}
      >
        <video
          autoPlay
          muted
          playsInline
          className="absolute inset-x-0 bottom-0 w-full h-[200%] object-cover"
        >
          <source src={splashVideoWebm} type="video/webm" />
          <source src={splashVideoMp4} type="video/mp4" />
        </video>
      </div>
    </div>
  );
}
