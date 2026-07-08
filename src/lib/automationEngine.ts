import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import type { Automation, AutomationAction, AutomationTrigger } from '../types';
import { swalToast } from './swalTheme';

const STORAGE_KEY = 'automations';
const CHECK_INTERVAL_MS = 30_000;

const genId = () => `automation-${Math.random().toString(36).substr(2, 9)}`;

function describeAction(action: AutomationAction): { title: string; text: string } {
  switch (action.type) {
    case 'reminder':
      return { title: 'Reminder', text: action.message };
    case 'staleChapterCheck':
      return { title: 'Stale Chapter Check', text: `Take a look at chapters that haven't been touched in ${action.days}+ days.` };
    case 'cloudBackupReminder':
      return { title: 'Cloud Backup Reminder', text: 'Consider backing up your workspaces to Cloud Storage.' };
  }
}

function computeNextRunAt(trigger: AutomationTrigger, from: number): string | null {
  if (trigger.type === 'interval') return new Date(from + trigger.everyMs).toISOString();
  return null; // 'onOpen' automations only re-arm on the next app session
}

export function useAutomationEngine() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const automationsRef = useRef(automations);
  automationsRef.current = automations;

  useEffect(() => {
    get(STORAGE_KEY).then((saved) => {
      if (saved && Array.isArray(saved)) setAutomations(saved);
      setLoaded(true);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timeout = setTimeout(() => {
      set(STORAGE_KEY, automations).catch(console.error);
    }, 500);
    return () => clearTimeout(timeout);
  }, [automations, loaded]);

  // Arm any enabled 'onOpen' automations that haven't fired this session yet.
  useEffect(() => {
    if (!loaded) return;
    setAutomations(prev => prev.map(a =>
      a.enabled && a.trigger.type === 'onOpen' && !a.nextRunAt
        ? { ...a, nextRunAt: new Date().toISOString() }
        : a
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const runAutomation = useCallback((id: string) => {
    setAutomations(prev => prev.map(a => {
      if (a.id !== id) return a;
      const { title, text } = describeAction(a.action);
      swalToast({ icon: 'info', title, text });
      const now = Date.now();
      return {
        ...a,
        lastRunAt: new Date(now).toISOString(),
        nextRunAt: a.enabled ? computeNextRunAt(a.trigger, now) : null,
      };
    }));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const tick = () => {
      const now = Date.now();
      for (const a of automationsRef.current) {
        if (a.enabled && a.nextRunAt && new Date(a.nextRunAt).getTime() <= now) {
          runAutomation(a.id);
        }
      }
    };
    tick();
    const interval = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loaded, runAutomation]);

  const createAutomation = useCallback((input: { name: string; description: string; trigger: AutomationTrigger; action: AutomationAction }) => {
    const now = Date.now();
    const automation: Automation = {
      id: genId(),
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      action: input.action,
      enabled: true,
      lastRunAt: null,
      nextRunAt: computeNextRunAt(input.trigger, now),
      createdAt: new Date(now).toISOString(),
    };
    setAutomations(prev => [...prev, automation]);
  }, []);

  const updateAutomation = useCallback((id: string, updates: { name: string; description: string; trigger: AutomationTrigger; action: AutomationAction }) => {
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, ...updates, nextRunAt: computeNextRunAt(updates.trigger, Date.now()) } : a));
  }, []);

  const deleteAutomation = useCallback((id: string) => {
    setAutomations(prev => prev.filter(a => a.id !== id));
  }, []);

  const toggleAutomation = useCallback((id: string) => {
    setAutomations(prev => prev.map(a => {
      if (a.id !== id) return a;
      const enabled = !a.enabled;
      return { ...a, enabled, nextRunAt: enabled ? computeNextRunAt(a.trigger, Date.now()) : null };
    }));
  }, []);

  return { automations, createAutomation, updateAutomation, deleteAutomation, toggleAutomation, runNow: runAutomation };
}
