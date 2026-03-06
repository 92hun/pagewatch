import type { MonitorItem, ChangeRecord } from '../types';
import { getMonitor, updateMonitor, addChange, getSettings, getTierLimits, generateId } from './storage';
import { computeDiff, hasChanged, diffSummary } from './diff';
import { notifyChange, notifyError } from './notification';
import { shouldAlert } from './alert-condition';

const MAX_SNAPSHOT_SIZE = 200_000; // 200KB per snapshot
const FETCH_TIMEOUT_MS = 15_000; // 15초 타임아웃

/**
 * 단일 모니터 항목 체크
 */
export async function checkMonitor(monitorId: string): Promise<void> {
  const monitor = await getMonitor(monitorId);
  if (!monitor || !monitor.enabled) return;

  await updateMonitor(monitorId, { status: 'checking' });

  try {
    const currentText = await fetchPageContent(monitor.url, monitor.selector);
    const now = Date.now();

    if (monitor.lastSnapshot === null) {
      await updateMonitor(monitorId, {
        lastSnapshot: currentText,
        lastCheckedAt: now,
        status: 'active',
      });
      return;
    }

    if (hasChanged(monitor.lastSnapshot, currentText)) {
      const diff = computeDiff(monitor.lastSnapshot, currentText);
      const summary = diffSummary(diff);

      // 조건부 알림 체크 — 조건 미충족 시 스냅샷만 갱신하고 알림 안 보냄
      const alertTriggered = shouldAlert(
        monitor.alertCondition ?? null,
        monitor.lastSnapshot,
        currentText,
      );
      console.log(`[PageWatch] Alert triggered: ${alertTriggered}`);

      const record: ChangeRecord = {
        id: generateId(),
        monitorId,
        detectedAt: now,
        previousText: monitor.lastSnapshot,
        currentText,
        diff,
      };

      const limits = await getTierLimits();
      await addChange(record, limits.maxHistory);

      await updateMonitor(monitorId, {
        lastSnapshot: currentText,
        lastCheckedAt: now,
        status: alertTriggered ? 'changed' : 'active',
      });

      if (alertTriggered) {
        const settings = await getSettings();
        if (settings.notificationsEnabled) {
          await notifyChange(monitor, summary, settings.webhooks);
        }
      }
    } else {
      await updateMonitor(monitorId, {
        lastCheckedAt: now,
        status: 'active',
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[PageWatch] Check failed for ${monitor.url}:`, message);
    await updateMonitor(monitorId, { status: 'error', lastCheckedAt: Date.now() });
    const settings = await getSettings();
    if (settings.notificationsEnabled) {
      await notifyError(monitor, message);
    }
  }
}

/**
 * 페이지 HTML을 fetch (타임아웃 포함)
 * 참고: 서비스워커에서는 credentials/User-Agent 설정 불가
 */
async function fetchPageContent(url: string, selector: string | null): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limited. Will retry later.');
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    if (!selector) {
      return truncateSnapshot(extractBodyText(html));
    }

    const extracted = extractBySelector(html, selector);
    return truncateSnapshot(extracted || extractBodyText(html));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out (15s)');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function truncateSnapshot(text: string): string {
  if (text.length > MAX_SNAPSHOT_SIZE) {
    return text.slice(0, MAX_SNAPSHOT_SIZE) + '\n[...truncated]';
  }
  return text;
}

/**
 * HTML에서 body 텍스트만 추출
 */
function extractBodyText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return text;
}

/**
 * HTML에서 CSS selector에 해당하는 영역 추출 (DOMParser 기반)
 */
function extractBySelector(html: string, selector: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.querySelector(selector);
    if (!el) return null;
    // 스크립트/스타일 제거 후 텍스트 추출
    el.querySelectorAll('script, style, noscript').forEach((s) => s.remove());
    return el.textContent?.trim() || null;
  } catch {
    return null;
  }
}
