import { getSettings, updateSettings, getChanges, getMonitors, clearAllData, generateId } from '../lib/storage';
import type { ChangeRecord, MonitorItem, WebhookConfig } from '../types';
import { TIER_LIMITS } from '../types';

// ---------- DOM ----------

const intervalInput = document.getElementById('interval') as HTMLInputElement;
const notificationsToggle = document.getElementById('notifications') as HTMLInputElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnPro = document.getElementById('btn-pro') as HTMLButtonElement;
const proCard = document.getElementById('pro-card')!;
const toast = document.getElementById('toast')!;

// Webhook elements
const webhookListEl = document.getElementById('webhook-list')!;
const webhookType = document.getElementById('webhook-type') as HTMLSelectElement;
const webhookName = document.getElementById('webhook-name') as HTMLInputElement;
const webhookUrl = document.getElementById('webhook-url') as HTMLInputElement;
const btnAddWebhook = document.getElementById('btn-add-webhook') as HTMLButtonElement;

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', init);

async function init(): Promise<void> {
  const settings = await getSettings();

  intervalInput.value = String(settings.defaultIntervalMinutes);
  notificationsToggle.checked = settings.notificationsEnabled;

  if (settings.tier === 'pro') {
    proCard.style.display = 'none';
  }

  if (settings.tier === 'free') {
    intervalInput.min = String(TIER_LIMITS.free.minIntervalMinutes);
  } else {
    intervalInput.min = String(TIER_LIMITS.pro.minIntervalMinutes);
  }

  await renderWebhooks();
  bindEvents();
}

function bindEvents(): void {
  intervalInput.addEventListener('change', saveSettings);
  notificationsToggle.addEventListener('change', saveSettings);
  btnExport.addEventListener('click', exportCsv);
  btnClear.addEventListener('click', handleClear);
  btnPro.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://pagewatch.app/pro' });
  });
  btnAddWebhook.addEventListener('click', addWebhook);
}

// ---------- Save ----------

async function saveSettings(): Promise<void> {
  const settings = await getSettings();
  const limits = TIER_LIMITS[settings.tier];

  let interval = parseInt(intervalInput.value, 10);
  if (isNaN(interval) || interval < limits.minIntervalMinutes) {
    interval = limits.minIntervalMinutes;
    intervalInput.value = String(interval);
  }

  await updateSettings({
    defaultIntervalMinutes: interval,
    notificationsEnabled: notificationsToggle.checked,
  });

  showToast('Settings saved');
}

// ---------- Webhooks ----------

async function renderWebhooks(): Promise<void> {
  const settings = await getSettings();
  const webhooks = settings.webhooks || [];

  if (webhooks.length === 0) {
    webhookListEl.innerHTML = '<p style="color:#aaa; font-size:12px; text-align:center; padding:8px 0;">No webhooks configured yet.</p>';
    return;
  }

  webhookListEl.innerHTML = '';
  for (const wh of webhooks) {
    const item = document.createElement('div');
    item.className = 'webhook-item';
    item.innerHTML = `
      <span class="webhook-type-badge ${wh.type}">${wh.type}</span>
      <div class="webhook-info">
        <div class="webhook-name">${escapeHtml(wh.name)}</div>
        <div class="webhook-url-preview">${escapeHtml(wh.url)}</div>
      </div>
      <div class="webhook-actions">
        <button class="btn-icon toggle-wh" title="${wh.enabled ? 'Disable' : 'Enable'}">${wh.enabled ? '&#x2705;' : '&#x26aa;'}</button>
        <button class="btn-icon test-wh" title="Send test">&#x1f4e4;</button>
        <button class="btn-icon danger delete-wh" title="Delete">&times;</button>
      </div>
    `;

    item.querySelector('.toggle-wh')!.addEventListener('click', async () => {
      await toggleWebhook(wh.id);
    });

    item.querySelector('.test-wh')!.addEventListener('click', async () => {
      await testWebhook(wh);
    });

    item.querySelector('.delete-wh')!.addEventListener('click', async () => {
      if (confirm(`Remove webhook "${wh.name}"?`)) {
        await deleteWebhook(wh.id);
      }
    });

    webhookListEl.appendChild(item);
  }
}

async function addWebhook(): Promise<void> {
  const type = webhookType.value as WebhookConfig['type'];
  const name = webhookName.value.trim();
  const url = webhookUrl.value.trim();

  if (!name) {
    showToast('Enter a name for the webhook.');
    return;
  }
  if (!url) {
    showToast('Enter the webhook URL.');
    return;
  }

  const newWebhook: WebhookConfig = {
    id: generateId(),
    type,
    name,
    url,
    enabled: true,
  };

  const settings = await getSettings();
  const webhooks = [...(settings.webhooks || []), newWebhook];
  await updateSettings({ webhooks });

  webhookName.value = '';
  webhookUrl.value = '';
  showToast('Webhook added!');
  await renderWebhooks();
}

async function toggleWebhook(id: string): Promise<void> {
  const settings = await getSettings();
  const webhooks = (settings.webhooks || []).map((w) =>
    w.id === id ? { ...w, enabled: !w.enabled } : w,
  );
  await updateSettings({ webhooks });
  await renderWebhooks();
}

async function deleteWebhook(id: string): Promise<void> {
  const settings = await getSettings();
  const webhooks = (settings.webhooks || []).filter((w) => w.id !== id);
  await updateSettings({ webhooks });
  showToast('Webhook removed.');
  await renderWebhooks();
}

async function testWebhook(wh: WebhookConfig): Promise<void> {
  showToast('Sending test...');
  try {
    const payload = buildTestPayload(wh);
    const resp = await fetch(wh.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      showToast('Test sent successfully!');
    } else {
      showToast(`Test failed: HTTP ${resp.status}`);
    }
  } catch (err) {
    showToast(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

function buildTestPayload(wh: WebhookConfig): unknown {
  const title = 'PageWatch Test';
  const body = 'This is a test notification from PageWatch.';

  switch (wh.type) {
    case 'discord':
      return {
        embeds: [{ title, description: body, color: 0x667eea }],
      };
    case 'slack':
      return {
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: title } },
          { type: 'section', text: { type: 'mrkdwn', text: body } },
        ],
      };
    case 'telegram':
      return { text: `${title}\n\n${body}`, parse_mode: 'Markdown' };
    default:
      return { event: 'test', message: body, timestamp: new Date().toISOString() };
  }
}

// ---------- Export ----------

async function exportCsv(): Promise<void> {
  const settings = await getSettings();
  if (settings.tier === 'free') {
    if (!confirm('CSV export is a Pro feature. Upgrade to Pro?')) return;
    chrome.tabs.create({ url: 'https://pagewatch.app/pro' });
    return;
  }

  const monitors = await getMonitors();
  const changes = await getChanges();

  const monitorMap = new Map(monitors.map((m) => [m.id, m]));

  const rows = [
    ['Date', 'URL', 'Monitor Name', 'Previous (excerpt)', 'Current (excerpt)'].join(','),
    ...changes.map((c) => {
      const m = monitorMap.get(c.monitorId);
      return [
        new Date(c.detectedAt).toISOString(),
        csvEscape(m?.url ?? ''),
        csvEscape(m?.name ?? ''),
        csvEscape(c.previousText.slice(0, 200)),
        csvEscape(c.currentText.slice(0, 200)),
      ].join(',');
    }),
  ].join('\n');

  const blob = new Blob(['\ufeff' + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `pagewatch-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('CSV exported');
}

function csvEscape(value: string): string {
  const escaped = value.replace(/"/g, '""').replace(/\n/g, ' ');
  return `"${escaped}"`;
}

// ---------- Clear ----------

async function handleClear(): Promise<void> {
  if (!confirm('This will remove ALL monitors, change history, and settings. Continue?')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;

  await clearAllData();
  showToast('All data cleared');

  setTimeout(() => location.reload(), 1000);
}

// ---------- Helpers ----------

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
