import type { MonitorItem, WebhookConfig } from '../types';

/**
 * 모든 활성 웹훅으로 변경 알림 전송
 */
export async function sendWebhooks(
  webhooks: WebhookConfig[],
  monitor: MonitorItem,
  summary: string,
): Promise<void> {
  const enabled = webhooks.filter((w) => w.enabled);
  if (enabled.length === 0) return;

  const results = await Promise.allSettled(
    enabled.map((w) => sendSingleWebhook(w, monitor, summary)),
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      console.error(`[PageWatch] Webhook "${enabled[i].name}" failed:`, (results[i] as PromiseRejectedResult).reason);
    }
  }
}

async function sendSingleWebhook(
  webhook: WebhookConfig,
  monitor: MonitorItem,
  summary: string,
): Promise<void> {
  const payload = buildPayload(webhook, monitor, summary);

  await fetch(webhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function buildPayload(
  webhook: WebhookConfig,
  monitor: MonitorItem,
  summary: string,
): unknown {
  const title = `PageWatch: Change Detected`;
  const body = `**${monitor.name || monitor.url}**\n${summary}\n\n[Open Page](${monitor.url})`;

  switch (webhook.type) {
    case 'discord':
      return {
        embeds: [
          {
            title,
            description: body,
            color: 0x667eea,
            timestamp: new Date().toISOString(),
            footer: { text: 'PageWatch' },
          },
        ],
      };

    case 'slack':
      return {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: title },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${monitor.name || monitor.url}*\n${summary}\n<${monitor.url}|Open Page>`,
            },
          },
        ],
      };

    case 'telegram': {
      // Telegram Bot API: webhook.url should be like
      // https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>
      return {
        text: `${title}\n\n${monitor.name || monitor.url}\n${summary}\n\n${monitor.url}`,
      };
    }

    case 'custom':
    default:
      return {
        event: 'page_changed',
        monitor: {
          id: monitor.id,
          name: monitor.name,
          url: monitor.url,
        },
        summary,
        timestamp: new Date().toISOString(),
      };
  }
}
