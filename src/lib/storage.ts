import type { MonitorItem, ChangeRecord, UserSettings } from '../types';
import { TIER_LIMITS } from '../types';

const KEYS = {
  monitors: 'pw_monitors',
  changes: 'pw_changes',
  settings: 'pw_settings',
} as const;

const DEFAULT_SETTINGS: UserSettings = {
  defaultIntervalMinutes: 1,
  notificationsEnabled: true,
  tier: 'pro',
  webhooks: [],
};

// ---------- Generic helpers ----------

async function get<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// ---------- Monitors ----------

export async function getMonitors(): Promise<MonitorItem[]> {
  return get<MonitorItem[]>(KEYS.monitors, []);
}

export async function getMonitor(id: string): Promise<MonitorItem | undefined> {
  const monitors = await getMonitors();
  return monitors.find((m) => m.id === id);
}

export async function addMonitor(item: MonitorItem): Promise<void> {
  const monitors = await getMonitors();
  monitors.push(item);
  await set(KEYS.monitors, monitors);
}

export async function updateMonitor(id: string, patch: Partial<MonitorItem>): Promise<void> {
  const monitors = await getMonitors();
  const idx = monitors.findIndex((m) => m.id === id);
  if (idx === -1) return;
  monitors[idx] = { ...monitors[idx], ...patch };
  await set(KEYS.monitors, monitors);
}

export async function removeMonitor(id: string): Promise<void> {
  const monitors = await getMonitors();
  await set(
    KEYS.monitors,
    monitors.filter((m) => m.id !== id),
  );
  // 관련 이력도 삭제
  const changes = await getChanges();
  await set(
    KEYS.changes,
    changes.filter((c) => c.monitorId !== id),
  );
}

// ---------- Changes ----------

export async function getChanges(monitorId?: string): Promise<ChangeRecord[]> {
  const all = await get<ChangeRecord[]>(KEYS.changes, []);
  if (!monitorId) return all;
  return all.filter((c) => c.monitorId === monitorId);
}

export async function addChange(record: ChangeRecord, maxHistory: number): Promise<void> {
  const all = await get<ChangeRecord[]>(KEYS.changes, []);
  all.unshift(record); // 최신순

  // 해당 모니터의 이력 제한 적용
  if (maxHistory !== Infinity) {
    const monitorChanges = all.filter((c) => c.monitorId === record.monitorId);
    if (monitorChanges.length > maxHistory) {
      const idsToRemove = new Set(monitorChanges.slice(maxHistory).map((c) => c.id));
      const filtered = all.filter((c) => !idsToRemove.has(c.id));
      await set(KEYS.changes, filtered);
      return;
    }
  }

  await set(KEYS.changes, all);
}

export async function clearChanges(monitorId?: string): Promise<void> {
  if (!monitorId) {
    await set(KEYS.changes, []);
    return;
  }
  const all = await get<ChangeRecord[]>(KEYS.changes, []);
  await set(
    KEYS.changes,
    all.filter((c) => c.monitorId !== monitorId),
  );
}

// ---------- Settings ----------

export async function getSettings(): Promise<UserSettings> {
  return get<UserSettings>(KEYS.settings, DEFAULT_SETTINGS);
}

export async function updateSettings(patch: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  await set(KEYS.settings, { ...current, ...patch });
}

// ---------- Tier helpers ----------

export async function getTierLimits(): Promise<(typeof TIER_LIMITS)[UserSettings['tier']]> {
  const { tier } = await getSettings();
  return TIER_LIMITS[tier];
}

// ---------- Utils ----------

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
}
