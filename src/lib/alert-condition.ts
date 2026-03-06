import type { AlertCondition } from '../types';

/**
 * 변경된 텍스트가 알림 조건을 충족하는지 검사
 * true = 알림 보내야 함
 */
export function shouldAlert(
  condition: AlertCondition | null,
  previousText: string,
  currentText: string,
): boolean {
  if (!condition || condition.mode === 'any_change') {
    return true; // 조건 없으면 항상 알림
  }

  const curr = currentText.toLowerCase();
  const prev = previousText.toLowerCase();

  switch (condition.mode) {
    case 'keyword': {
      // 키워드가 새로 나타났을 때 알림
      const keywords = condition.value
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (keywords.length === 0) return true;
      return keywords.some((kw) => curr.includes(kw) && !prev.includes(kw));
    }

    case 'keyword_gone': {
      // 키워드가 사라졌을 때 알림 (예: "품절"이 사라지면)
      const keywords = condition.value
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (keywords.length === 0) return true;
      return keywords.some((kw) => prev.includes(kw) && !curr.includes(kw));
    }

    case 'price_below': {
      const target = parseFloat(condition.value);
      if (isNaN(target)) return true;
      const currentPrice = extractLowestPrice(currentText);
      if (currentPrice === null) return false;
      return currentPrice < target;
    }

    case 'price_above': {
      const target = parseFloat(condition.value);
      if (isNaN(target)) return true;
      const currentPrice = extractLowestPrice(currentText);
      if (currentPrice === null) return false;
      return currentPrice > target;
    }

    default:
      return true;
  }
}

/**
 * 텍스트에서 가격 숫자를 추출 (가장 낮은 가격 반환)
 */
function extractLowestPrice(text: string): number | null {
  // 다양한 가격 패턴 매칭
  const patterns = [
    /[\$€£₩]\s*([\d,]+(?:\.\d{1,2})?)/g,           // $99.99, ₩12,000
    /([\d,]+(?:\.\d{1,2})?)\s*(?:원|달러|불)/g,       // 12,000원
    /(?:price|가격|판매가)[:\s]*([\d,]+(?:\.\d{1,2})?)/gi, // price: 99.99
  ];

  const prices: number[] = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) {
        prices.push(num);
      }
    }
  }

  return prices.length > 0 ? Math.min(...prices) : null;
}

/** 조건 설명 텍스트 생성 */
export function describeCondition(condition: AlertCondition | null): string {
  if (!condition || condition.mode === 'any_change') return 'Any change';
  switch (condition.mode) {
    case 'keyword':
      return `Keyword appears: "${condition.value}"`;
    case 'keyword_gone':
      return `Keyword disappears: "${condition.value}"`;
    case 'price_below':
      return `Price drops below ${condition.value}`;
    case 'price_above':
      return `Price rises above ${condition.value}`;
    default:
      return 'Any change';
  }
}
