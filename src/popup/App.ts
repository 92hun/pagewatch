import {
  getMonitors,
  addMonitor,
  updateMonitor,
  removeMonitor,
  getChanges,
  getSettings,
  getTierLimits,
  generateId,
} from '../lib/storage';
import { describeCondition } from '../lib/alert-condition';
import type { MonitorItem, MessageType, AlertCondition } from '../types';
import { PRESETS } from '../types';

// ---------- Safe message sender ----------

function sendBgMessage(msg: MessageType): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ---------- DOM References ----------

const monitorListEl = document.getElementById('monitor-list')!;
const emptyStateEl = document.getElementById('empty-state')!;
const btnAddCurrent = document.getElementById('btn-add-current')! as HTMLButtonElement;
const btnAddUrl = document.getElementById('btn-add-url')! as HTMLButtonElement;
const inputUrl = document.getElementById('input-url')! as HTMLInputElement;
const btnSettings = document.getElementById('btn-settings')!;
const tierBadge = document.getElementById('tier-badge')!;
const limitWarning = document.getElementById('limit-warning')!;
const monitorCount = document.getElementById('monitor-count')!;
const btnUpgrade = document.getElementById('btn-upgrade')!;
const presetSection = document.getElementById('preset-section')!;
const presetGrid = document.getElementById('preset-grid')!;

// ---------- State ----------

let monitors: MonitorItem[] = [];
let expandedMonitorId: string | null = null;
let editingConditionId: string | null = null;

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error('[PageWatch] Init error:', err));
});

async function init(): Promise<void> {
  await renderTierInfo();
  await renderMonitors();
  renderPresets();
  bindEvents();
  startStorageSync();
}

function bindEvents(): void {
  btnAddCurrent.addEventListener('click', () => {
    addCurrentTab().catch((err) => {
      console.error('[PageWatch] Add tab error:', err);
      showToast('Failed to add — check console.');
    });
  });
  btnAddUrl.addEventListener('click', () => {
    addFromUrl().catch((err) => {
      console.error('[PageWatch] Add URL error:', err);
      showToast('Failed to add — check console.');
    });
  });
  inputUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFromUrl().catch(() => showToast('Failed to add URL.'));
  });
  btnSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  btnUpgrade.addEventListener('click', () => chrome.tabs.create({ url: 'https://pagewatch.app/pro' }));
}

// ---------- 실시간 동기화 ----------

function startStorageSync(): void {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['pw_monitors'] || changes['pw_changes']) {
      renderMonitors();
    }
  });
}

// ---------- Preset Templates ----------

function renderPresets(): void {
  presetSection.classList.remove('hidden');

  presetGrid.innerHTML = '';
  for (const preset of PRESETS) {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.innerHTML = `
      <span class="preset-icon">${preset.icon}</span>
      <span class="preset-name">${escapeHtml(preset.name)}</span>
    `;
    card.title = preset.description;
    card.addEventListener('click', () => applyPreset(preset.id));
    presetGrid.appendChild(card);
  }
}

async function applyPreset(presetId: string): Promise<void> {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return;

  const limits = await getTierLimits();
  if (monitors.length >= limits.maxMonitors) {
    showToast(`Limit reached (${limits.maxMonitors}). Upgrade to Pro!`);
    return;
  }

  // 프리셋 URL은 유저가 직접 입력해야 함
  const url = inputUrl.value.trim();
  if (!url) {
    showToast('Enter a URL first, then pick a preset.');
    inputUrl.focus();
    return;
  }

  const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    new URL(fullUrl);
  } catch {
    showToast('Invalid URL format.');
    return;
  }

  if (monitors.some((m) => m.url === fullUrl)) {
    showToast('Already monitoring this URL.');
    return;
  }

  const item: MonitorItem = {
    id: generateId(),
    url: fullUrl,
    name: `${preset.icon} ${preset.name} — ${new URL(fullUrl).hostname}`,
    selector: preset.selector,
    intervalMinutes: Math.max(preset.intervalMinutes, limits.minIntervalMinutes),
    enabled: true,
    createdAt: Date.now(),
    lastCheckedAt: null,
    lastSnapshot: null,
    status: 'idle',
    alertCondition: preset.alertCondition,
    preset: preset.id,
  };

  await addMonitor(item);
  sendBgMessage({ type: 'CHECK_NOW', monitorId: item.id });
  inputUrl.value = '';

  // price_below 프리셋 → 사용자에게 가격 입력 요청
  if (preset.alertCondition?.mode === 'price_below' || preset.alertCondition?.mode === 'price_above') {
    showToast('Monitor added! Set your target price below.');
    editingConditionId = item.id;
  } else if (preset.alertCondition?.mode === 'keyword' && !preset.alertCondition.value) {
    showToast('Monitor added! Enter keywords below.');
    editingConditionId = item.id;
  } else {
    showToast(`${preset.icon} ${preset.name} monitor added!`);
  }

  await renderMonitors();
}

// ---------- Add Monitor ----------

async function addCurrentTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    showToast('Cannot monitor this page.');
    return;
  }

  const limits = await getTierLimits();
  if (monitors.length >= limits.maxMonitors) {
    showToast(`Limit reached (${limits.maxMonitors}). Upgrade to Pro!`);
    return;
  }

  if (monitors.some((m) => m.url === tab.url)) {
    showToast('Already monitoring this page.');
    return;
  }

  const settings = await getSettings();
  const item: MonitorItem = {
    id: generateId(),
    url: tab.url!,
    name: tab.title || new URL(tab.url!).hostname,
    selector: null,
    intervalMinutes: Math.max(settings.defaultIntervalMinutes, limits.minIntervalMinutes),
    enabled: true,
    createdAt: Date.now(),
    lastCheckedAt: null,
    lastSnapshot: null,
    status: 'idle',
    alertCondition: null,
    preset: null,
  };

  await addMonitor(item);
  sendBgMessage({ type: 'CHECK_NOW', monitorId: item.id });
  showToast('Monitor added!');
  await renderMonitors();

  if (tab.id) {
    promptSelectorChoice(item.id, tab.id);
  }
}

async function addFromUrl(): Promise<void> {
  const raw = inputUrl.value.trim();
  if (!raw) return;

  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    new URL(url);
  } catch {
    showToast('Invalid URL format.');
    return;
  }

  const limits = await getTierLimits();
  if (monitors.length >= limits.maxMonitors) {
    showToast(`Limit reached (${limits.maxMonitors}). Upgrade to Pro!`);
    return;
  }

  if (monitors.some((m) => m.url === url)) {
    showToast('Already monitoring this URL.');
    return;
  }

  const settings = await getSettings();
  const item: MonitorItem = {
    id: generateId(),
    url,
    name: new URL(url).hostname,
    selector: null,
    intervalMinutes: Math.max(settings.defaultIntervalMinutes, limits.minIntervalMinutes),
    enabled: true,
    createdAt: Date.now(),
    lastCheckedAt: null,
    lastSnapshot: null,
    status: 'idle',
    alertCondition: null,
    preset: null,
  };

  await addMonitor(item);
  sendBgMessage({ type: 'CHECK_NOW', monitorId: item.id });

  inputUrl.value = '';
  showToast('Monitor added! First check starting...');
  await renderMonitors();
}

// ---------- Render ----------

async function renderMonitors(): Promise<void> {
  monitors = await getMonitors();

  monitorListEl.querySelectorAll('.monitor-item, .history-panel, .condition-editor').forEach((el) => el.remove());

  if (monitors.length === 0) {
    emptyStateEl.classList.remove('hidden');
    limitWarning.classList.add('hidden');
    updateAddButtonState(true);
    return;
  }

  emptyStateEl.classList.add('hidden');

  for (const monitor of monitors) {
    const el = createMonitorElement(monitor);
    monitorListEl.appendChild(el);

    // 조건 편집기 표시
    if (editingConditionId === monitor.id) {
      const condEl = createConditionEditor(monitor);
      monitorListEl.appendChild(condEl);
    }

    if (expandedMonitorId === monitor.id) {
      const historyEl = await createHistoryPanel(monitor.id);
      monitorListEl.appendChild(historyEl);
    }
  }

  const settings = await getSettings();
  const limits = await getTierLimits();
  if (settings.tier === 'free') {
    monitorCount.textContent = `${monitors.length}`;
    limitWarning.classList.remove('hidden');
  } else {
    limitWarning.classList.add('hidden');
  }

  updateAddButtonState(monitors.length < limits.maxMonitors);
}

function updateAddButtonState(canAdd: boolean): void {
  btnAddCurrent.disabled = !canAdd;
  btnAddUrl.disabled = !canAdd;
  if (!canAdd) {
    btnAddCurrent.style.opacity = '0.5';
    btnAddUrl.style.opacity = '0.5';
  } else {
    btnAddCurrent.style.opacity = '1';
    btnAddUrl.style.opacity = '1';
  }
}

function createMonitorElement(monitor: MonitorItem): HTMLElement {
  const div = document.createElement('div');
  const statusClass = monitor.status === 'changed' ? 'changed' : monitor.status === 'error' ? 'error' : '';
  div.className = `monitor-item ${statusClass}`;

  const lastChecked = monitor.lastCheckedAt ? timeAgo(monitor.lastCheckedAt) : 'Waiting for first check...';

  const statusLabel: Record<string, string> = {
    idle: 'Pending',
    active: 'Active',
    checking: 'Checking...',
    changed: 'Changed!',
    error: 'Error',
  };

  const conditionText = monitor.alertCondition
    ? describeCondition(monitor.alertCondition)
    : 'Any change';

  div.innerHTML = `
    <span class="monitor-status-dot dot-${monitor.status}"></span>
    <div class="monitor-info">
      <div class="monitor-name">${escapeHtml(monitor.name)}</div>
      <div class="monitor-url">${escapeHtml(monitor.url)}</div>
      <div class="monitor-meta">
        ${statusLabel[monitor.status] || monitor.status}
        · ${monitor.selector ? escapeHtml(monitor.selector) : 'Full page'}
        · ${monitor.intervalMinutes}m · ${lastChecked}
      </div>
      <div class="condition-label">${escapeHtml(conditionText)}</div>
    </div>
    <div class="monitor-actions">
      <button class="action-btn check-btn" title="Check now">&#x1f504;</button>
      <button class="action-btn condition-btn" title="Alert condition">&#x1f514;</button>
      <button class="action-btn history-btn" title="View changes">&#x1f4cb;</button>
      <label class="toggle">
        <input type="checkbox" ${monitor.enabled ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <button class="action-btn delete" title="Delete">&times;</button>
    </div>
  `;

  // Toggle
  const toggle = div.querySelector('input[type="checkbox"]')! as HTMLInputElement;
  toggle.addEventListener('change', async () => {
    await updateMonitor(monitor.id, { enabled: toggle.checked });
    if (toggle.checked) sendBgMessage({ type: 'CHECK_NOW', monitorId: monitor.id });
  });

  // Delete
  div.querySelector('.delete')!.addEventListener('click', async () => {
    if (confirm(`Remove "${monitor.name}"?`)) {
      await removeMonitor(monitor.id);
      await renderMonitors();
    }
  });

  // Check now
  div.querySelector('.check-btn')!.addEventListener('click', () => {
    sendBgMessage({ type: 'CHECK_NOW', monitorId: monitor.id });
    showToast('Checking now...');
  });

  // Condition editor toggle
  div.querySelector('.condition-btn')!.addEventListener('click', () => {
    editingConditionId = editingConditionId === monitor.id ? null : monitor.id;
    renderMonitors();
  });

  // History toggle
  div.querySelector('.history-btn')!.addEventListener('click', () => {
    expandedMonitorId = expandedMonitorId === monitor.id ? null : monitor.id;
    renderMonitors();
  });

  // Clear changed status on click
  if (monitor.status === 'changed') {
    div.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.monitor-actions')) return;
      await updateMonitor(monitor.id, { status: 'active' });
    });
  }

  return div;
}

// ---------- Condition Editor ----------

function createConditionEditor(monitor: MonitorItem): HTMLElement {
  const div = document.createElement('div');
  div.className = 'condition-editor';

  const condition = monitor.alertCondition || { mode: 'any_change' as const, value: '' };

  const modes = [
    { value: 'any_change', label: 'Any change' },
    { value: 'keyword', label: 'Keyword appears' },
    { value: 'keyword_gone', label: 'Keyword disappears' },
    { value: 'price_below', label: 'Price drops below' },
    { value: 'price_above', label: 'Price rises above' },
  ];

  const modeOptions = modes
    .map((m) => `<option value="${m.value}" ${condition.mode === m.value ? 'selected' : ''}>${m.label}</option>`)
    .join('');

  const showValue = condition.mode !== 'any_change';
  const placeholder =
    condition.mode === 'keyword' || condition.mode === 'keyword_gone'
      ? 'Keywords (comma-separated)'
      : 'Target price';

  div.innerHTML = `
    <div class="condition-row">
      <select class="cond-mode">${modeOptions}</select>
      <input class="cond-value" type="text" placeholder="${placeholder}" value="${escapeHtml(condition.value)}" style="${showValue ? '' : 'display:none'}" />
    </div>
    <div class="condition-save-row">
      <button class="btn btn-sm btn-secondary cond-cancel">Cancel</button>
      <button class="btn btn-sm btn-primary cond-save">Save</button>
    </div>
  `;

  const modeSelect = div.querySelector('.cond-mode') as HTMLSelectElement;
  const valueInput = div.querySelector('.cond-value') as HTMLInputElement;

  modeSelect.addEventListener('change', () => {
    const isAny = modeSelect.value === 'any_change';
    valueInput.style.display = isAny ? 'none' : '';
    if (modeSelect.value === 'keyword' || modeSelect.value === 'keyword_gone') {
      valueInput.placeholder = 'Keywords (comma-separated)';
    } else {
      valueInput.placeholder = 'Target price';
    }
  });

  div.querySelector('.cond-cancel')!.addEventListener('click', () => {
    editingConditionId = null;
    renderMonitors();
  });

  div.querySelector('.cond-save')!.addEventListener('click', async () => {
    const mode = modeSelect.value as AlertCondition['mode'];
    const value = valueInput.value.trim();

    const newCondition: AlertCondition | null =
      mode === 'any_change' ? null : { mode, value };

    await updateMonitor(monitor.id, { alertCondition: newCondition });
    editingConditionId = null;
    showToast('Alert condition saved!');
    await renderMonitors();
  });

  return div;
}

// ---------- History Panel (Improved Diff) ----------

async function createHistoryPanel(monitorId: string): Promise<HTMLElement> {
  const changes = await getChanges(monitorId);
  const div = document.createElement('div');
  div.className = 'history-panel';

  if (changes.length === 0) {
    div.innerHTML = '<p class="muted" style="text-align:center; font-size:11px;">No changes detected yet.</p>';
    return div;
  }

  div.innerHTML = `<h3>Recent Changes (${changes.length})</h3>`;

  for (const change of changes.slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'history-item';

    // Diff 통계
    const addedCount = change.diff.filter((s) => s.type === 'added').length;
    const removedCount = change.diff.filter((s) => s.type === 'removed').length;

    // 향상된 diff 표시
    const diffLines = change.diff
      .slice(0, 20) // 최대 20개 세그먼트
      .filter((seg) => seg.type !== 'unchanged')
      .map((seg) => {
        const cls = seg.type === 'added' ? 'diff-line-added' : 'diff-line-removed';
        return `<div class="diff-line ${cls}">${escapeHtml(truncate(seg.text, 120))}</div>`;
      })
      .join('');

    item.innerHTML = `
      <div class="history-time">${formatDate(change.detectedAt)}</div>
      <div class="diff-stats">
        <span class="diff-stat-added">+${addedCount} added</span>
        <span class="diff-stat-removed">-${removedCount} removed</span>
      </div>
      <div class="diff-container">${diffLines || '<div class="diff-line diff-line-context">Content changed</div>'}</div>
    `;
    div.appendChild(item);
  }

  return div;
}

// ---------- Selector Prompt ----------

function promptSelectorChoice(monitorId: string, tabId: number): void {
  const banner = document.createElement('div');
  banner.className = 'add-section';
  banner.style.borderTop = '1px solid #e8eaed';
  banner.innerHTML = `
    <p style="font-size:12px; margin-bottom:8px;">
      <strong>Watch a specific area?</strong> (optional)
    </p>
    <div style="display:flex; gap:8px;">
      <button class="btn btn-primary btn-sm" id="btn-select-area">Pick Element</button>
      <button class="btn btn-secondary btn-sm" id="btn-skip-selector">Watch Full Page</button>
    </div>
  `;
  monitorListEl.prepend(banner);

  banner.querySelector('#btn-select-area')!.addEventListener('click', async () => {
    banner.remove();

    try {
      // 서비스워커에 셀렉터 대기 등록 (팝업 닫혀도 결과 수신 가능)
      await chrome.runtime.sendMessage({ type: 'REGISTER_SELECTOR_WAIT', monitorId });

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/selector.js'],
      });

      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'START_SELECTOR', tabId }).catch(() => {});
      }, 200);
    } catch (err) {
      console.error('[PageWatch] Selector injection failed:', err);
      showToast('Cannot use selector on this page.');
      return;
    }

    window.close();
  });

  banner.querySelector('#btn-skip-selector')!.addEventListener('click', () => {
    banner.remove();
  });
}

// ---------- Tier Info ----------

async function renderTierInfo(): Promise<void> {
  const settings = await getSettings();
  if (settings.tier === 'pro') {
    tierBadge.textContent = 'Pro';
    tierBadge.className = 'badge badge-pro';
  }
}

// ---------- Helpers ----------

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function showToast(message: string): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
    background: #333; color: white; padding: 8px 16px; border-radius: 6px;
    font-size: 12px; z-index: 9999; max-width: 340px; text-align: center;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
