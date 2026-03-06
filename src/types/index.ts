/** 모니터링 항목 */
export interface MonitorItem {
  id: string;
  url: string;
  name: string;
  selector: string | null;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: number;
  lastCheckedAt: number | null;
  lastSnapshot: string | null;
  status: MonitorStatus;
  /** 조건부 알림 — 조건 충족 시에만 알림 */
  alertCondition: AlertCondition | null;
  /** 프리셋 템플릿 ID */
  preset: string | null;
}

export type MonitorStatus = 'idle' | 'active' | 'checking' | 'changed' | 'error';

/** 조건부 알림 설정 */
export interface AlertCondition {
  mode: 'keyword' | 'keyword_gone' | 'price_below' | 'price_above' | 'any_change';
  value: string; // 키워드 텍스트 또는 가격 숫자 (string으로 저장)
}

/** 변경 이력 */
export interface ChangeRecord {
  id: string;
  monitorId: string;
  detectedAt: number;
  previousText: string;
  currentText: string;
  diff: DiffSegment[];
}

/** diff 단위 */
export interface DiffSegment {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

/** 사용자 설정 */
export interface UserSettings {
  defaultIntervalMinutes: number;
  notificationsEnabled: boolean;
  tier: Tier;
  /** 웹훅 알림 채널 */
  webhooks: WebhookConfig[];
}

export interface WebhookConfig {
  id: string;
  type: 'discord' | 'slack' | 'telegram' | 'custom';
  name: string;
  url: string; // Discord/Slack webhook URL, 또는 Telegram bot API URL
  enabled: boolean;
}

export type Tier = 'free' | 'pro';

/** 티어별 제한 */
export const TIER_LIMITS = {
  free: {
    maxMonitors: 3,
    minIntervalMinutes: 30,
    maxHistory: 5,
    csvExport: false,
  },
  pro: {
    maxMonitors: Infinity,
    minIntervalMinutes: 1,
    maxHistory: Infinity,
    csvExport: true,
  },
} as const;

export type TierLimits = (typeof TIER_LIMITS)[Tier];

/** 프리셋 템플릿 */
export interface PresetTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  urlPlaceholder: string;
  selector: string | null;
  intervalMinutes: number;
  alertCondition: AlertCondition | null;
}

export const PRESETS: PresetTemplate[] = [
  {
    id: 'price-drop',
    name: 'Price Drop',
    icon: '💰',
    description: 'Alert when price drops below target',
    urlPlaceholder: 'Product page URL...',
    selector: null,
    intervalMinutes: 5,
    alertCondition: { mode: 'price_below', value: '' },
  },
  {
    id: 'restock',
    name: 'Restock Alert',
    icon: '📦',
    description: 'Alert when "sold out" disappears or "add to cart" appears',
    urlPlaceholder: 'Product page URL...',
    selector: null,
    intervalMinutes: 5,
    alertCondition: { mode: 'keyword', value: 'add to cart,in stock,buy now,구매,장바구니' },
  },
  {
    id: 'job-posting',
    name: 'New Job Posting',
    icon: '💼',
    description: 'Alert when new positions are posted',
    urlPlaceholder: 'Careers page URL...',
    selector: null,
    intervalMinutes: 30,
    alertCondition: { mode: 'any_change', value: '' },
  },
  {
    id: 'announcement',
    name: 'New Announcement',
    icon: '📢',
    description: 'Alert when new content is posted',
    urlPlaceholder: 'Notice/blog page URL...',
    selector: null,
    intervalMinutes: 15,
    alertCondition: { mode: 'any_change', value: '' },
  },
  {
    id: 'keyword-watch',
    name: 'Keyword Watch',
    icon: '🔍',
    description: 'Alert when specific keyword appears on page',
    urlPlaceholder: 'Any page URL...',
    selector: null,
    intervalMinutes: 10,
    alertCondition: { mode: 'keyword', value: '' },
  },
];

/** 메시지 타입 */
export type MessageType =
  | { type: 'START_SELECTOR'; tabId: number }
  | { type: 'SELECTOR_RESULT'; selector: string; preview: string }
  | { type: 'SELECTOR_CANCELLED' }
  | { type: 'CHECK_NOW'; monitorId: string }
  | { type: 'CHECK_ALL' }
  | { type: 'REGISTER_SELECTOR_WAIT'; monitorId: string };
