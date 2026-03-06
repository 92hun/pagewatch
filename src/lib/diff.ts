import type { DiffSegment } from '../types';

const MAX_LINES_FOR_DIFF = 2000; // 성능 가드

/**
 * 라인 기반 diff (LCS 알고리즘)
 */
export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  let oldLines = oldText.split('\n');
  let newLines = newText.split('\n');

  // 너무 큰 텍스트는 잘라서 처리
  if (oldLines.length > MAX_LINES_FOR_DIFF || newLines.length > MAX_LINES_FOR_DIFF) {
    oldLines = oldLines.slice(0, MAX_LINES_FOR_DIFF);
    newLines = newLines.slice(0, MAX_LINES_FOR_DIFF);
  }

  const lcs = longestCommonSubsequence(oldLines, newLines);
  const segments: DiffSegment[] = [];

  let oi = 0;
  let ni = 0;
  let li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      pushSegment(segments, 'unchanged', oldLines[oi]);
      oi++; ni++; li++;
    } else if (li < lcs.length && oi < oldLines.length && oldLines[oi] !== lcs[li]) {
      pushSegment(segments, 'removed', oldLines[oi]);
      oi++;
    } else if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
      pushSegment(segments, 'added', newLines[ni]);
      ni++;
    } else if (oi < oldLines.length) {
      pushSegment(segments, 'removed', oldLines[oi]);
      oi++;
    } else {
      break;
    }
  }

  return segments;
}

function pushSegment(segments: DiffSegment[], type: DiffSegment['type'], line: string): void {
  const last = segments.at(-1);
  if (last && last.type === type) {
    last.text += '\n' + line;
  } else {
    segments.push({ type, text: line });
  }
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // full DP table (역추적 필요)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/** 빠른 변경 여부 판단 */
export function hasChanged(oldText: string, newText: string): boolean {
  return oldText.trim() !== newText.trim();
}

/** diff 요약 생성 */
export function diffSummary(segments: DiffSegment[]): string {
  const added = segments.filter((s) => s.type === 'added').length;
  const removed = segments.filter((s) => s.type === 'removed').length;
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added} added`);
  if (removed > 0) parts.push(`-${removed} removed`);
  return parts.join(', ') || 'Content changed';
}
