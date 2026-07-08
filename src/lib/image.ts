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
