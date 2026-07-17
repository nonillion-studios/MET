import Swal, { type SweetAlertOptions } from 'sweetalert2';

function currentPalette() {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    background: isDark ? '#1C1C1E' : '#FFFFFF',
    color: isDark ? '#F2F2F2' : '#1C1C1E',
    confirmButtonColor: isDark ? '#0A84FF' : '#007AFF',
    cancelButtonColor: isDark ? '#3A3A3C' : '#E5E5EA',
  };
}

export function swal(options: SweetAlertOptions) {
  return Swal.fire({ ...currentPalette(), ...options });
}

export function swalToast(options: SweetAlertOptions) {
  return swal({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2500, ...options });
}

/** Lightweight math CAPTCHA confirmation for money-moving actions (deposit,
 *  penalize, transfer, withdrawal decisions) — a cheap deterrent against
 *  fat-finger/accidental clicks, not real bot protection. */
export async function confirmWithCaptcha(title: string): Promise<boolean> {
  const a = 1 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * 8);
  const { value } = await swal({
    title,
    input: 'number',
    inputLabel: `To confirm, what is ${a} + ${b}?`,
    showCancelButton: true,
    confirmButtonText: 'Confirm',
    inputValidator: (v: string) => (v === '' ? 'Required' : undefined),
  });
  return Number(value) === a + b;
}

export { Swal };
