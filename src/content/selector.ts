/**
 * PageWatch Element Selector
 * 페이지에 오버레이를 주입하고, 사용자가 클릭한 요소의 CSS selector를 추출
 */

let isActive = false;
let highlightOverlay: HTMLDivElement | null = null;
let selectorBar: HTMLDivElement | null = null;
let hoveredElement: Element | null = null;
let styleEl: HTMLStyleElement | null = null;

const SELECTOR_STYLES = `
#pw-highlight-overlay {
  position: absolute;
  display: none;
  pointer-events: none;
  z-index: 2147483645;
  border: 2px solid #667eea;
  background: rgba(102, 126, 234, 0.12);
  border-radius: 3px;
  transition: all 0.1s ease-out;
  box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.08);
}
#pw-selector-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 2147483646;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
}
.pw-bar-content {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
}
.pw-bar-icon { font-size: 16px; flex-shrink: 0; }
.pw-bar-text { font-weight: 600; flex-shrink: 0; }
.pw-bar-selector {
  flex: 1;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.15);
  padding: 4px 8px; border-radius: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.pw-bar-btn {
  padding: 6px 14px; border: none; border-radius: 5px;
  font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0;
}
.pw-bar-cancel { background: rgba(255,255,255,0.2); color: white; }
.pw-bar-cancel:hover { background: rgba(255,255,255,0.35); }
`;

// ---------- 메시지 수신 ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_SELECTOR') {
    startSelectorMode();
    sendResponse({ ok: true });
  }
  return true;
});

// ---------- Selector Mode ----------

function startSelectorMode(): void {
  if (isActive) return;
  isActive = true;

  // CSS 주입
  styleEl = document.createElement('style');
  styleEl.textContent = SELECTOR_STYLES;
  document.head.appendChild(styleEl);

  // 오버레이 생성
  highlightOverlay = document.createElement('div');
  highlightOverlay.id = 'pw-highlight-overlay';
  document.body.appendChild(highlightOverlay);

  // 툴바 생성
  selectorBar = document.createElement('div');
  selectorBar.id = 'pw-selector-bar';
  selectorBar.innerHTML = `
    <div class="pw-bar-content">
      <span class="pw-bar-icon">🎯</span>
      <span class="pw-bar-text">Click an element to select it</span>
      <span class="pw-bar-selector" id="pw-current-selector"></span>
      <button class="pw-bar-btn pw-bar-cancel" id="pw-cancel">Cancel (Esc)</button>
    </div>
  `;
  document.body.appendChild(selectorBar);

  // 이벤트 바인딩
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  selectorBar.querySelector('#pw-cancel')!.addEventListener('click', cancelSelector);
}

function stopSelectorMode(): void {
  if (!isActive) return;
  isActive = false;

  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown, true);

  highlightOverlay?.remove();
  selectorBar?.remove();
  styleEl?.remove();
  highlightOverlay = null;
  selectorBar = null;
  styleEl = null;
  hoveredElement = null;
}

// ---------- Event Handlers ----------

function onMouseMove(e: MouseEvent): void {
  if (!isActive) return;

  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target || target.id?.startsWith('pw-') || target.closest('#pw-selector-bar')) return;

  hoveredElement = target;
  updateHighlight(target);

  const selectorDisplay = selectorBar?.querySelector('#pw-current-selector');
  if (selectorDisplay) {
    selectorDisplay.textContent = generateSelector(target);
  }
}

function onClick(e: MouseEvent): void {
  if (!isActive) return;

  const target = e.target as Element;
  if (target.id?.startsWith('pw-') || target.closest('#pw-selector-bar')) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  if (!hoveredElement) return;

  const selector = generateSelector(hoveredElement);
  const preview = hoveredElement.textContent?.trim().slice(0, 50) || '';

  stopSelectorMode();

  // 결과 전송
  chrome.runtime.sendMessage({
    type: 'SELECTOR_RESULT',
    selector,
    preview,
  });
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    cancelSelector();
  }
}

function cancelSelector(): void {
  stopSelectorMode();
  chrome.runtime.sendMessage({ type: 'SELECTOR_CANCELLED' });
}

// ---------- Highlight ----------

function updateHighlight(element: Element): void {
  if (!highlightOverlay) return;

  const rect = element.getBoundingClientRect();
  highlightOverlay.style.top = `${rect.top + window.scrollY}px`;
  highlightOverlay.style.left = `${rect.left + window.scrollX}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.display = 'block';
}

// ---------- CSS Selector Generator ----------

function generateSelector(element: Element): string {
  if (element.id && !element.id.startsWith('pw-')) {
    return `#${CSS.escape(element.id)}`;
  }

  const uniqueClass = findUniqueClassSelector(element);
  if (uniqueClass) return uniqueClass;

  return buildPathSelector(element);
}

function findUniqueClassSelector(element: Element): string | null {
  const classes = Array.from(element.classList).filter((c) => !c.startsWith('pw-'));
  if (classes.length === 0) return null;

  const tag = element.tagName.toLowerCase();

  for (const cls of classes) {
    const sel = `${tag}.${CSS.escape(cls)}`;
    if (document.querySelectorAll(sel).length === 1) {
      return sel;
    }
  }

  if (classes.length >= 2) {
    const sel = `${tag}.${classes.map(CSS.escape).join('.')}`;
    if (document.querySelectorAll(sel).length === 1) {
      return sel;
    }
  }

  return null;
}

function buildPathSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && parts.length < 4) {
    let part = current.tagName.toLowerCase();

    if (current.id && !current.id.startsWith('pw-')) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    const parentEl: Element | null = current.parentElement;
    if (parentEl) {
      const currentTag = current.tagName;
      const siblings = Array.from(parentEl.children).filter(
        (child: Element) => child.tagName === currentTag,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(part);
    current = parentEl;
  }

  return parts.join(' > ');
}
