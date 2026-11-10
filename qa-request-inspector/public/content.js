// Content script - DOM field search, highlight and page QA checks.
// Not listed in the manifest: the side panel injects it into a page only when one of these features is used.
// Network capture is now handled by chrome.debugger CDP in background.js

(function() {

// Injected on demand by the side panel (utils/pageMessaging.ts); a second injection must do nothing.
if (window.__reqpaneContentScript) return;
window.__reqpaneContentScript = true;

// ========================================
// DOM Field Search & Highlight System
// ========================================

class DOMFieldSearcher {
  constructor() {
    this.textNodesCache = null;
    this.cacheTimestamp = 0;
    this.CACHE_TTL = 2000; // 2 seconds
  }

  buildTextNodesCache() {
    const now = Date.now();
    if (this.textNodesCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.textNodesCache;
    }

    if (!document.body) {
      this.textNodesCache = [];
      return this.textNodesCache;
    }

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'template'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!node.textContent?.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    this.textNodesCache = [];
    let node;
    while ((node = walker.nextNode())) {
      this.textNodesCache.push({
        node,
        text: node.textContent,
        element: node.parentElement
      });
    }

    this.cacheTimestamp = now;
    return this.textNodesCache;
  }

  searchValue(value, options = {}) {
    const { maxResults = 50 } = options;

    const searchStr = this.normalizeValue(value);
    if (!searchStr || searchStr.length < 2) {
      return { count: 0, elements: [] };
    }

    const textNodes = this.buildTextNodesCache();
    const results = [];
    const seenElements = new Set();

    for (const { text, element } of textNodes) {
      if (results.length >= maxResults) break;

      const elementId = element.outerHTML.slice(0, 200);
      if (seenElements.has(elementId)) continue;

      if (!this.isVisible(element)) continue;

      if (this.textMatches(text, searchStr)) {
        seenElements.add(elementId);
        results.push({
          selector: this.generateSelector(element),
          textPreview: text.slice(0, 100),
          isVisible: true,
          tagName: element.tagName.toLowerCase()
        });
      }
    }

    return { count: results.length, elements: results };
  }

  normalizeValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'string') return value.trim();
    return '';
  }

  textMatches(text, searchStr) {
    const textLower = text.toLowerCase();
    const searchLower = searchStr.toLowerCase();

    if (textLower.includes(searchLower)) {
      return true;
    }

    if (/^\d+$/.test(searchStr)) {
      const formatted = searchStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      if (textLower.includes(formatted.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  isVisible(element) {
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.offsetParent !== null
    );
  }

  generateSelector(element) {
    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = `#${current.id}`;
        path.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length && classes[0]) {
          selector += `.${classes.join('.')}`;
        }
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          c => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  batchSearch(values) {
    this.buildTextNodesCache();
    const results = {};
    for (const { path, value } of values) {
      results[path] = this.searchValue(value);
    }
    return results;
  }
}

class HighlightManager {
  constructor() {
    this.overlays = [];
    this.styleElement = null;
  }

  injectStyles() {
    if (this.styleElement) return;

    this.styleElement = document.createElement('style');
    this.styleElement.id = 'api-debugger-highlight-styles';
    this.styleElement.textContent = `
      .api-debugger-highlight {
        position: absolute;
        pointer-events: none;
        background: rgba(14, 165, 233, 0.2);
        border: 2px solid rgba(14, 165, 233, 0.8);
        border-radius: 4px;
        z-index: 999998;
        animation: api-debugger-pulse 1.5s ease-in-out infinite;
      }
      .api-debugger-highlight-label {
        position: absolute;
        top: -22px;
        left: 0;
        background: rgba(14, 165, 233, 0.95);
        color: white;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 4px;
        font-family: system-ui, sans-serif;
        white-space: nowrap;
        font-weight: 500;
      }
      @keyframes api-debugger-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  highlightElements(elements, label = '') {
    this.clearHighlights();
    this.injectStyles();

    elements.forEach((el, index) => {
      try {
        const element = document.querySelector(el.selector);
        if (!element) return;

        const rect = element.getBoundingClientRect();
        const overlay = document.createElement('div');
        overlay.className = 'api-debugger-highlight';
        overlay.style.cssText = `
          top: ${rect.top + window.scrollY}px;
          left: ${rect.left + window.scrollX}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
        `;

        if (index === 0 && label) {
          const labelEl = document.createElement('div');
          labelEl.className = 'api-debugger-highlight-label';
          labelEl.textContent = `${label} (${elements.length} found)`;
          overlay.appendChild(labelEl);
        }

        document.body.appendChild(overlay);
        this.overlays.push(overlay);

        if (index === 0) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (e) {
        console.warn('[Reqpane] Failed to highlight:', e);
      }
    });
  }

  clearHighlights() {
    this.overlays.forEach(overlay => overlay.remove());
    this.overlays = [];
  }
}

const domSearcher = new DOMFieldSearcher();
const highlightManager = new HighlightManager();

// ========================================
// Lightweight DOM / accessibility QA checks
// ========================================

class DOMQAChecker {
  isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
  }

  selectorFor(element) {
    return domSearcher.generateSelector(element);
  }

  labelledByText(element) {
    return (element.getAttribute('aria-labelledby') || '').split(/\s+/)
      .filter(Boolean)
      .some((id) => document.getElementById(id)?.textContent?.trim());
  }

  hasAccessibleName(element) {
    return Boolean(
      element.getAttribute('aria-label')?.trim() ||
      this.labelledByText(element) ||
      element.getAttribute('title')?.trim() ||
      (element.labels && Array.from(element.labels).some((label) => label.textContent?.trim()))
    );
  }

  elementDescription(element) {
    const attributes = ['data-testid', 'id', 'name', 'aria-label', 'title', 'placeholder', 'alt'];
    const details = attributes
      .map((name) => [name, element.getAttribute(name)?.trim()])
      .filter(([, value]) => Boolean(value))
      .slice(0, 3)
      .map(([name, value]) => `${name}="${value.slice(0, 80)}"`);
    const text = element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (text) details.push(`text="${text}"`);
    return `<${element.tagName.toLowerCase()}${details.length ? ` ${details.join(' ')}` : ''}>`;
  }

  finding(type, element) {
    return {
      type,
      selector: this.selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      elementDescription: this.elementDescription(element),
      pageUrl: location.href,
      pageTitle: document.title,
      timestamp: Date.now(),
    };
  }

  run() {
    if (!document.body) return { findings: [] };
    const findings = [];
    const MAX_FINDINGS = 200;
    const add = (type, element) => {
      if (findings.length < MAX_FINDINGS) findings.push(this.finding(type, element));
    };

    document.querySelectorAll('img').forEach((image) => {
      if (!this.isVisible(image)) return;
      const decorative = image.getAttribute('role') === 'presentation' || image.getAttribute('aria-hidden') === 'true';
      if (!decorative && !image.hasAttribute('alt')) add('missing-alt', image);
      // Do not report images that are still loading; lazy images are a normal pattern.
      if (image.complete && image.currentSrc && image.naturalWidth === 0) add('broken-image', image);
    });

    document.querySelectorAll('input, select, textarea').forEach((control) => {
      if (!this.isVisible(control) || control instanceof HTMLInputElement && control.type === 'hidden') return;
      const inputButton = control instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image'].includes(control.type);
      if (inputButton) return;
      if (!this.hasAccessibleName(control)) add('input-without-label', control);
    });

    document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]').forEach((button) => {
      if (!this.isVisible(button)) return;
      const inputValue = button instanceof HTMLInputElement ? button.value.trim() : '';
      const text = button.textContent?.trim() || inputValue;
      if (!text && !this.hasAccessibleName(button)) add('button-without-accessible-name', button);
    });

    document.querySelectorAll('[tabindex]').forEach(element => {
      if (this.isVisible(element) && element.tabIndex > 0) add('positive-tabindex', element);
    });
    document.querySelectorAll('[role="button"], [onclick]').forEach(element => {
      if (this.isVisible(element) && !element.matches('button, a[href], input, select, textarea') && element.tabIndex < 0) add('clickable-without-keyboard', element);
    });
    // Conservative contrast check: direct text, opaque solid background only.
    const rgb = text => { const match = text.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/); return match && (match[4] === undefined || Number(match[4]) === 1) ? match.slice(1,4).map(Number) : null; };
    const luminance = channels => channels.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126,0.7152,0.0722][i], 0);
    [...document.querySelectorAll('p, span, a, label, button, h1, h2, h3')].slice(0, 2000).forEach(element => {
      if (!this.isVisible(element) || ![...element.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
      const style = getComputedStyle(element);
      if (Number(style.opacity) !== 1 || style.backgroundImage !== 'none') return;
      const fg = rgb(style.color), bg = rgb(style.backgroundColor);
      if (!fg || !bg) return;
      const a = luminance(fg), b = luminance(bg), contrast = (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      if (contrast < (large ? 3 : 4.5)) add('low-contrast', element);
    });

    return { findings };
  }
}

const domQAChecker = new DOMQAChecker();

// ========================================
// Full accessibility audit (axe-core)
// ========================================
// axe.min.js is injected by the side panel into the same isolated world right before RUN_AXE_CHECKS.

let axeLocalized = false;

async function runAxeChecks(language) {
  const axe = globalThis.axe;
  if (!axe) return { findings: [], error: 'axe-core is not loaded' };
  // axe-locale-ru.js (injected with the library for the Russian interface) carries the translation.
  if (language === 'ru' && globalThis.__reqpaneAxeLocaleRu) {
    axe.configure({ locale: globalThis.__reqpaneAxeLocaleRu });
    axeLocalized = true;
  } else if (axeLocalized) {
    axe.reset();
    axeLocalized = false;
  }
  const results = await axe.run(document, { resultTypes: ['violations'] });
  const findings = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes.slice(0, 20)) {
      if (findings.length >= 300) break;
      // Elements inside frames or shadow roots have a multi-part target that querySelector cannot use.
      const simpleTarget = node.target.length === 1 && typeof node.target[0] === 'string';
      const html = String(node.html || '').replace(/\svalue="[^"]*"/gi, '').slice(0, 200);
      findings.push({
        type: 'axe',
        selector: simpleTarget ? node.target[0] : '',
        tagName: (html.match(/^<([a-z0-9-]+)/i) || [])[1] || '',
        elementDescription: html,
        pageUrl: location.href,
        pageTitle: document.title,
        timestamp: Date.now(),
        axe: {
          ruleId: violation.id,
          impact: node.impact || violation.impact || 'moderate',
          help: violation.help,
          helpUrl: violation.helpUrl,
          summary: String(node.failureSummary || '').slice(0, 400),
          wcag: violation.tags.filter((tag) => /^wcag\d|^best-practice$/.test(tag)),
        },
      });
    }
  }
  return { findings };
}

// ========================================
// Step recorder: clicks and input become reproduction steps
// ========================================
// Sends structured actions to the side panel; the panel words them and builds the Playwright scenario.
// Values of password fields are never read.

class StepRecorder {
  constructor() {
    this.active = false;
    this.lastTyped = new WeakMap(); // field -> value already reported
    this.onClick = this.onClick.bind(this);
    this.onChange = this.onChange.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('change', this.onChange, true);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('change', this.onChange, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  text(value, limit = 60) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
  }

  fieldName(element) {
    const label = element.labels && element.labels[0] ? this.text(element.labels[0].textContent) : '';
    return (
      label ||
      this.text(element.getAttribute('aria-label')) ||
      this.text(element.getAttribute('placeholder')) ||
      this.text(element.getAttribute('name')) ||
      this.text(element.id)
    );
  }

  /** How a test would find the element: test id, role and name, label, placeholder, or a CSS path. */
  describe(element) {
    const selector = domSearcher.generateSelector(element);
    const testIdAttribute = ['data-testid', 'data-test-id', 'data-test', 'data-qa'].find((name) => element.getAttribute(name));
    const tag = element.tagName.toLowerCase();
    const isField = tag === 'input' || tag === 'select' || tag === 'textarea';
    const inputType = tag === 'input' ? (element.getAttribute('type') || 'text').toLowerCase() : '';
    const isInputButton = ['button', 'submit', 'reset'].includes(inputType);
    const name = isField && !isInputButton
      ? this.fieldName(element)
      : this.text(element.getAttribute('aria-label')) || this.text(isInputButton ? element.value : element.innerText) || this.text(element.getAttribute('title'));
    const explicitRole = element.getAttribute('role');
    const role = explicitRole || (tag === 'button' || isInputButton ? 'button' : tag === 'a' && element.hasAttribute('href') ? 'link' : '');

    let locator;
    if (testIdAttribute) {
      locator = testIdAttribute === 'data-testid'
        ? { kind: 'testid', value: element.getAttribute(testIdAttribute) }
        : { kind: 'css', value: `[${testIdAttribute}="${element.getAttribute(testIdAttribute)}"]` };
    } else if (role && name) {
      locator = { kind: 'role', role, value: name };
    } else if (isField && element.labels && element.labels[0] && name) {
      locator = { kind: 'label', value: name };
    } else if (isField && element.getAttribute('placeholder')) {
      locator = { kind: 'placeholder', value: element.getAttribute('placeholder') };
    } else {
      locator = { kind: 'css', value: selector };
    }
    return { locator, selector, name, tag, role };
  }

  send(action) {
    try {
      void chrome.runtime.sendMessage({
        type: 'RECORDED_STEP',
        action: { ...action, pageUrl: location.href, timestamp: Date.now() },
      });
    } catch (e) {
      // The extension was reloaded: this copy of the script is orphaned.
      this.stop();
    }
  }

  onClick(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const interactive = event.target.closest(
      'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], summary, input[type="button"], input[type="submit"], input[type="reset"], [data-testid], [onclick]',
    );
    const element = interactive || event.target;
    // Typing into a field and toggling a checkbox are reported by "change".
    if (element.matches('input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea, label, option')) return;
    if (element === document.body || element === document.documentElement) return;
    this.send({ kind: 'click', ...this.describe(element) });
  }

  onChange(event) {
    const element = event.target;
    if (!event.isTrusted || !(element instanceof Element)) return;
    const tag = element.tagName.toLowerCase();
    if (tag === 'select') {
      const option = element.selectedOptions && element.selectedOptions[0];
      this.send({ kind: 'select', value: element.value, optionLabel: option ? this.text(option.textContent) : '', ...this.describe(element) });
      return;
    }
    if (tag === 'textarea') {
      this.send({ kind: 'fill', value: String(element.value).slice(0, 200), ...this.describe(element) });
      return;
    }
    if (tag !== 'input') return;
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      this.send({ kind: element.checked ? 'check' : 'uncheck', ...this.describe(element) });
    } else if (type === 'file') {
      this.send({ kind: 'upload', value: Array.from(element.files || []).map((file) => file.name).join(', '), ...this.describe(element) });
    } else {
      this.reportTyped(element);
    }
  }

  /** Reports the text of a field once per value; a password is reported without its value. */
  reportTyped(element) {
    const value = String(element.value);
    if (this.lastTyped.get(element) === value) return;
    this.lastTyped.set(element, value);
    const secret = (element.getAttribute('type') || '').toLowerCase() === 'password';
    this.send({ kind: 'fill', value: secret ? '' : value.slice(0, 200), ...(secret ? { secret: true } : {}), ...this.describe(element) });
  }

  onKeyDown(event) {
    if (!event.isTrusted || event.key !== 'Enter' || !(event.target instanceof Element)) return;
    if (!event.target.matches('input, [contenteditable="true"]')) return;
    // "change" fires after this keydown: report the typed text first to keep the order of steps.
    if (event.target.matches('input') && event.target.value) this.reportTyped(event.target);
    this.send({ kind: 'press', key: 'Enter', ...this.describe(event.target) });
  }
}

const stepRecorder = new StepRecorder();

// Handle DOM search messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_STEP_RECORDING') {
    stepRecorder.start();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'STOP_STEP_RECORDING') {
    stepRecorder.stop();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RUN_AXE_CHECKS') {
    runAxeChecks(message.language).then(sendResponse, (error) => sendResponse({ findings: [], error: String(error && error.message || error) }));
    return true;
  }

  if (message.type === 'SEARCH_DOM_FOR_VALUE') {
    const result = domSearcher.searchValue(message.value, message.options);
    sendResponse(result);
    return true;
  }

  if (message.type === 'BATCH_SEARCH_DOM') {
    const results = domSearcher.batchSearch(message.values);
    sendResponse(results);
    return true;
  }

  if (message.type === 'HIGHLIGHT_ELEMENTS') {
    highlightManager.highlightElements(message.elements, message.label);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CLEAR_HIGHLIGHTS') {
    highlightManager.clearHighlights();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RUN_DOM_QA_CHECKS') {
    sendResponse(domQAChecker.run());
    return true;
  }
});

// Clear highlights on navigation
window.addEventListener('beforeunload', () => {
  highlightManager.clearHighlights();
});

// Invalidate cache on DOM mutations
let mutationTimeout;
const mutationObserver = new MutationObserver(() => {
  clearTimeout(mutationTimeout);
  mutationTimeout = setTimeout(() => {
    domSearcher.textNodesCache = null;
  }, 500);
});

if (document.body) {
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }, { once: true });
}

})();
