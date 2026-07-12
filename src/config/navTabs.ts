import { Settings, Users, CloudCog, LayoutGrid, type LucideIcon } from 'lucide-react';

export type NavTabId = 'settings' | 'teams' | 'cloud' | 'library';

export interface NavTab {
  id: NavTabId;
  label: string;
  icon: LucideIcon;
}

export const NAV_TABS: NavTab[] = [
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'cloud', label: 'Cloud', icon: CloudCog },
  { id: 'library', label: 'Library', icon: LayoutGrid },
];
