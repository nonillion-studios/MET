import React, { useState, useEffect } from 'react';
import { Clock, Bell, User, Search, Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { IconButton } from './ui';
import logo from '../assets/logo.jpg';

export function TopBar() {
  const [time, setTime] = useState(new Date());
  const [searchOpen, setSearchOpen] = useState(false);
  const [profile, setProfile] = useState<{name: string, avatar: string}>({ name: '', avatar: '' });
  const { resolvedTheme, toggleTheme } = useTheme();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem('team_profile') || '{}');
      if (p.name || p.avatar) {
        setProfile({ name: p.name || 'Anonymous User', avatar: p.avatar || '' });
      }
    } catch {}
    
    // Listen to changes from localstorage
    const handleStorage = () => {
      try {
        const p = JSON.parse(localStorage.getItem('team_profile') || '{}');
        setProfile({ name: p.name || 'User', avatar: p.avatar || '' });
      } catch {}
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <div className="liquid-glass-bar w-full h-14 sm:h-16 rounded-b-[22px] lg:rounded-none border border-hairline border-t-0 lg:border-x-0 px-2.5 sm:px-6 flex items-center justify-between gap-2 shrink-0 z-40 sticky top-0">
      {/* Brand */}
      <div className={`flex items-center gap-2.5 min-w-0 shrink-0 ${searchOpen ? 'hidden sm:flex' : 'flex'}`}>
        <img
          src={logo}
          alt="MET"
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover shrink-0 ring-1 ring-hairline shadow-[0_0_16px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
          draggable={false}
        />
        <span className="hidden md:inline font-display text-sm font-bold text-ink tracking-tight truncate">
          Manga<span className="text-accent">Editing Tool</span>
        </span>
      </div>

      {/* Search & Utility */}
      <div className="flex items-center gap-4 min-w-0 flex-1 justify-end sm:justify-start">
        {/* Compact icon-only trigger on narrow screens */}
        <IconButton
          onClick={() => setSearchOpen(v => !v)}
          className="sm:hidden"
          aria-label="Search"
        >
          <Search size={16} />
        </IconButton>
        <div className={`relative group ${searchOpen ? 'absolute left-2.5 right-2.5 top-1/2 -translate-y-1/2 z-10' : 'hidden'} sm:static sm:block sm:translate-y-0`}>
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search size={16} className="text-ink-faint group-focus-within:text-accent transition-colors" />
          </div>
          <input
            type="text"
            placeholder="Search workspace..."
            autoFocus={searchOpen}
            onBlur={() => setSearchOpen(false)}
            className="w-full sm:w-64 bg-elevated sm:bg-ink/5 border border-hairline hover:border-accent/30 focus:border-accent rounded-xl pl-10 pr-4 py-2 text-sm text-ink outline-none transition-all placeholder:text-ink-faint focus:bg-accent-soft focus:shadow-[0_0_15px_var(--color-accent-soft)]"
          />
        </div>
      </div>

      {/* Right Side: Theme toggle, Notifications & Time grouped in one capsule + Profile */}
      <div className={`items-center gap-1.5 xs:gap-2 sm:gap-3 shrink-0 ${searchOpen ? 'hidden sm:flex' : 'flex'}`}>
        <div className="flex items-center gap-0.5 xs:gap-1 bg-ink/5 border border-hairline rounded-full p-1">
          {/* Theme toggle */}
          <IconButton
            size="sm"
            onClick={toggleTheme}
            className="!bg-transparent !border-0 hover:!bg-ink/8"
            aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>

          {/* Clock */}
          <div className="hidden xs:flex items-center gap-1.5 text-ink-muted px-2.5 sm:px-3 py-1.5">
            <Clock size={14} className="text-accent" />
            <span className="hidden sm:inline font-mono text-xs tracking-widest">{time.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute:'2-digit' })}</span>
          </div>

          {/* Notifications */}
          <IconButton
            size="sm"
            aria-label="Notifications"
            className="relative !bg-transparent !border-0 hover:!bg-accent-soft hover:!text-accent"
          >
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger rounded-full ring-2 ring-[var(--color-surface)]"></span>
          </IconButton>
        </div>

        {/* Profile */}
        <div className="flex items-center gap-2.5 bg-ink/5 border border-hairline rounded-full pl-1 pr-1 sm:pr-3.5 py-1">
          <div className="hidden md:flex flex-col text-right items-start">
            <span className="text-sm font-bold text-ink leading-none mb-1">{profile.name || "New User"}</span>
            <span className="text-[10px] text-accent font-mono leading-none">Manga Team</span>
          </div>
          <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full border-2 border-accent/30 overflow-hidden bg-accent-soft flex items-center justify-center p-0.5">
            {profile.avatar ? (
               <img src={profile.avatar} alt="Profile" className="w-full h-full object-cover rounded-full" />
            ) : (
               <User size={18} className="text-accent" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
