import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import type { Automation, AutomationAction, AutomationTrigger, Workspace } from '../types';
import { swalToast } from './swalTheme';
import { genId } from './id';
import { getProfile } from './profile';
import type { CloudClient } from './cloudClient';
import logo from '../assets/logo.jpg';

const STORAGE_KEY = 'automations';
const CHECK_INTERVAL_MS = 30_000;

export function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
  return Notification.requestPermission();
}

function notify(title: string, text: string) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body: text, icon: logo });
      return;
    } catch (e) {
      console.error(e);
    }
  }
  swalToast({ icon: 'info', title, text });
}

function computeNextRunAt(trigger: AutomationTrigger, from: number): string | null {
  if (trigger.type === 'interval') return new Date(from + trigger.everyMs).toISOString();
  return null; // 'onOpen' automations only re-arm on the next app session
}

export function useAutomationEngine(cloudClient: CloudClient, workspaces: Workspace[]) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const automationsRef = useRef(automations);
  automationsRef.current = automations;
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const cloudClientRef = useRef(cloudClient);
  cloudClientRef.current = cloudClient;

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

  const executeAction = useCallback((name: string, action: AutomationAction) => {
    switch (action.type) {
      case 'reminder':
        notify('Reminder', action.message);
        return;
      case 'staleChapterCheck':
        notify('Stale Chapter Check', `Take a look at chapters that haven't been touched in ${action.days}+ days.`);
        return;
      case 'cloudBackup': {
        const workspace = workspacesRef.current.find(w => w.id === action.workspaceId);
        const cc = cloudClientRef.current;
        if (!workspace) {
          swalToast({ icon: 'error', title: 'Automation skipped', text: `"${name}" couldn't find its workspace — it may have been deleted.` });
          return;
        }
        if (!cc.isConnected) {
          swalToast({ icon: 'error', title: 'Automation skipped', text: `Connect Cloud Storage to let "${name}" back up "${workspace.name}".` });
          return;
        }
        cc.uploadWorkspaceBackup(workspace, { notes: `Automated backup via "${name}"`, tags: ['auto-backup'], profile: getProfile() })
          .then(() => notify('Cloud Backup', `"${workspace.name}" backed up to Cloud Storage.`))
          .catch(() => {});
        return;
      }
    }
  }, []);

  const runAutomation = useCallback((id: string) => {
    const automation = automationsRef.current.find(a => a.id === id);
    if (!automation) return;
    const now = Date.now();
    setAutomations(prev => prev.map(a => a.id === id ? {
      ...a,
      lastRunAt: new Date(now).toISOString(),
      nextRunAt: a.enabled ? computeNextRunAt(a.trigger, now) : null,
    } : a));
    executeAction(automation.name, automation.action);
  }, [executeAction]);

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
      id: genId('automation'),
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
