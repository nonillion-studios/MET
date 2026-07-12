import { swal } from './swalTheme';

export function readImageFile(file: File, onLoaded: (dataUrl: string) => void) {
  if (file.size > 2 * 1024 * 1024) {
    swal({ icon: 'warning', title: 'Image Too Large', text: 'Please choose an image smaller than 2MB.' });
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => onLoaded(ev.target?.result as string);
  reader.readAsDataURL(file);
}

/** Downscales an image to a small square JPEG data URL — keeps avatars light enough for Supabase user metadata. */
export function readAvatarFile(file: File, onLoaded: (dataUrl: string) => void, size = 160) {
  if (file.size > 5 * 1024 * 1024) {
    swal({ icon: 'warning', title: 'Image Too Large', text: 'Please choose an image smaller than 5MB.' });
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      onLoaded(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = ev.target?.result as string;
  };
  reader.readAsDataURL(file);
}
