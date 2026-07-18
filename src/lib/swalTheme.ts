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

/** Plain confirmation dialog for money-moving actions (deposit, penalize,
 *  transfer, withdrawal decisions) — a deliberate click-through, no CAPTCHA. */
export async function confirmAction(title: string, text?: string): Promise<boolean> {
  const { isConfirmed } = await swal({
    title,
    text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Confirm',
  });
  return isConfirmed;
}

export { Swal };
