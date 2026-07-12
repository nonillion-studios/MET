import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set, del } from 'idb-keyval';
import type { Automation, AutomationAction, AutomationTrigger } from '../types';
import { swalToast } from './swalTheme';
import { genId } from './id';
import type { CloudClient } from './cloudClient';

const STORAGE_KEY = 'cloud_transfer_automations';
const CHECK_INTERVAL_MS = 15_000;

export function stashTransferBlob(blobKey: string, blob: Blob): Promise<void> {
  return set(blobKey, blob);
}

function computeNextRunAt(trigger: AutomationTrigger, from: number): string | null {
  if (trigger.type === 'interval') return new Date(from + trigger.everyMs).toISOString();
  if (trigger.type === 'once') return trigger.at;
  return null; // 'onOpen' automations only re-arm on the next app session
}

export function useAutomationEngine(cloudClient: CloudClient) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const automationsRef = useRef(automations);
  automationsRef.current = automations;
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

  const executeAction = useCallback(async (name: string, action: AutomationAction) => {
    const cc = cloudClientRef.current;
    if (!cc.isConnected) {
      swalToast({ icon: 'error', title: 'Transfer skipped', text: `Connect Cloud Storage to let "${name}" run.` });
      return;
    }
    if (action.direction === 'upload') {
      try {
        const blob = await get<Blob>(action.blobKey);
        if (!blob) {
          swalToast({ icon: 'error', title: 'Transfer skipped', text: `"${name}" couldn't find its cached file.` });
          return;
        }
        const file = new File([blob], action.fileName, { type: blob.type });
        await cc.uploadFile(file, { name: action.fileName, notes: `Scheduled transfer via "${name}"`, tags: ['scheduled'], coverDataUrl: null, folderId: action.folderId });
      } catch (e) {
        console.error(e);
      }
      return;
    }
    // download
    const file = cc.files.find(f => f.id === action.cloudFileId);
    if (!file) {
      swalToast({ icon: 'error', title: 'Transfer skipped', text: `"${name}" couldn't find its cloud file — it may have been deleted.` });
      return;
    }
    await cc.downloadCloudFile(file);
  }, []);

  const runAutomation = useCallback((id: string) => {
    const automation = automationsRef.current.find(a => a.id === id);
    if (!automation) return;
    const now = Date.now();
    const isOneShot = automation.trigger.type === 'once';
    setAutomations(prev => prev.map(a => a.id === id ? {
      ...a,
      lastRunAt: new Date(now).toISOString(),
      enabled: isOneShot ? false : a.enabled,
      nextRunAt: a.enabled && !isOneShot ? computeNextRunAt(a.trigger, now) : null,
    } : a));
    executeAction(automation.name, automation.action);
    if (isOneShot && automation.action.direction === 'upload') {
      del(automation.action.blobKey).catch(() => {});
    }
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

  const deleteAutomation = useCallback((id: string) => {
    const automation = automationsRef.current.find(a => a.id === id);
    if (automation?.action.direction === 'upload') del(automation.action.blobKey).catch(() => {});
    setAutomations(prev => prev.filter(a => a.id !== id));
  }, []);

  const toggleAutomation = useCallback((id: string) => {
    setAutomations(prev => prev.map(a => {
      if (a.id !== id) return a;
      const enabled = !a.enabled;
      return { ...a, enabled, nextRunAt: enabled ? computeNextRunAt(a.trigger, Date.now()) : null };
    }));
  }, []);

  return { automations, createAutomation, deleteAutomation, toggleAutomation, runNow: runAutomation };
}

export type AutomationEngine = ReturnType<typeof useAutomationEngine>;
