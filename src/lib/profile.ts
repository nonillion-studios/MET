import type { Profile } from '../types';

const STORAGE_KEY = 'team_profile';

export const EMPTY_PROFILE: Profile = { name: '', teamName: '', avatar: '' };

export function getProfile(): Profile {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { name: parsed.name || '', teamName: parsed.teamName || '', avatar: parsed.avatar || '' };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(profile: Profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event('storage'));
}

export function hasProfile(): boolean {
  return getProfile().name.trim().length > 0;
}
