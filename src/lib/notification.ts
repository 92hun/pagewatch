import type { MonitorItem, WebhookConfig } from '../types';
import { sendWebhooks } from './webhook';

export async function notifyChange(
  monitor: MonitorItem,
  summary: string,
  webhooks: WebhookConfig[] = [],
): Promise<void> {
  const notifId = `pw-change-${monitor.id}-${Date.now()}`;

  await chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'PageWatch: Change Detected!',
    message: `${monitor.name || monitor.url}\n${summary}`,
    priority: 2,
  });

  // 웹훅 알림도 동시 전송
  if (webhooks.length > 0) {
    sendWebhooks(webhooks, monitor, summary).catch((err) => {
      console.error('[PageWatch] Webhook batch error:', err);
    });
  }
}

export async function notifyError(monitor: MonitorItem, error: string): Promise<void> {
  await chrome.notifications.create(`pw-error-${monitor.id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'PageWatch: Monitor Error',
    message: `${monitor.name || monitor.url}\n${error}`,
    priority: 1,
  });
}
