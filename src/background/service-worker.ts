import { getMonitors, getMonitor, updateMonitor, getTierLimits } from '../lib/storage';
import { checkMonitor } from '../lib/monitor';
import type { MessageType } from '../types';

// 셀렉터 선택 대기 중인 모니터 ID
let pendingSelectorMonitorId: string | null = null;

const ALARM_PREFIX = 'pw-check-';
const MASTER_ALARM = 'pw-master';

// ---------- 설치/시작 ----------

chrome.runtime.onInstalled.addListener(() => {
  scheduleAllAlarms().catch(logError);
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAllAlarms().catch(logError);
});

// ---------- 알람 처리 ----------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MASTER_ALARM) {
    checkAllMonitors().catch(logError);
    return;
  }

  if (alarm.name.startsWith(ALARM_PREFIX)) {
    const monitorId = alarm.name.slice(ALARM_PREFIX.length);
    checkMonitor(monitorId).catch(logError);
  }
});

// ---------- 메시지 처리 ----------

chrome.runtime.onMessage.addListener((message: MessageType, _sender, sendResponse) => {
  if (message.type === 'CHECK_NOW') {
    checkMonitor(message.monitorId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (message.type === 'CHECK_ALL') {
    checkAllMonitors()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // 셀렉터 선택 대기 등록 (팝업에서 요청)
  if (message.type === 'REGISTER_SELECTOR_WAIT') {
    pendingSelectorMonitorId = (message as unknown as { monitorId: string }).monitorId;
    sendResponse({ ok: true });
    return false;
  }

  // 셀렉터 결과 수신 (content script에서 전송 — 팝업 닫혀도 여기서 처리)
  if (message.type === 'SELECTOR_RESULT') {
    const monitorId = pendingSelectorMonitorId;
    pendingSelectorMonitorId = null;
    if (monitorId) {
      const selectorMsg = message as unknown as { selector: string; preview: string };
      updateMonitor(monitorId, {
        selector: selectorMsg.selector,
        name: selectorMsg.preview || undefined,
      }).catch(logError);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'SELECTOR_CANCELLED') {
    pendingSelectorMonitorId = null;
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ---------- 스토리지 변경 → 알람 재스케줄 ----------

chrome.storage.onChanged.addListener((changes) => {
  if (changes['pw_monitors']) {
    scheduleAllAlarms().catch(logError);
  }
});

// ---------- 알람 스케줄링 ----------

async function scheduleAllAlarms(): Promise<void> {
  const existingAlarms = await chrome.alarms.getAll();
  for (const alarm of existingAlarms) {
    if (alarm.name.startsWith(ALARM_PREFIX) || alarm.name === MASTER_ALARM) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  const monitors = await getMonitors();
  const limits = await getTierLimits();
  let scheduled = 0;

  for (const monitor of monitors) {
    if (!monitor.enabled) continue;

    const interval = Math.max(monitor.intervalMinutes, limits.minIntervalMinutes);

    await chrome.alarms.create(`${ALARM_PREFIX}${monitor.id}`, {
      periodInMinutes: interval,
      delayInMinutes: 0.5,
    });
    scheduled++;
  }

  if (scheduled > 0) {
    await chrome.alarms.create(MASTER_ALARM, { periodInMinutes: 5 });
  }
}

// ---------- 모든 모니터 체크 ----------

async function checkAllMonitors(): Promise<void> {
  const monitors = await getMonitors();
  const limits = await getTierLimits();
  const now = Date.now();

  const checks: Promise<void>[] = [];

  for (const monitor of monitors) {
    if (!monitor.enabled) continue;

    const interval = Math.max(monitor.intervalMinutes, limits.minIntervalMinutes);
    const intervalMs = interval * 60 * 1000;

    if (!monitor.lastCheckedAt || now - monitor.lastCheckedAt >= intervalMs * 0.9) {
      checks.push(checkMonitor(monitor.id));
    }
  }

  if (checks.length > 0) {
    await Promise.allSettled(checks);
  }
}

// ---------- 알림 클릭 ----------

chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId.startsWith('pw-change-')) {
    const monitorId = notifId.slice('pw-change-'.length).replace(/-\d+$/, '');
    getMonitor(monitorId).then((monitor) => {
      if (monitor) chrome.tabs.create({ url: monitor.url });
    });
  }
});

// ---------- Util ----------

function logError(e: unknown): void {
  console.error('[PageWatch]', e);
}
