// Content script - DOM field search and highlight system
// Network capture is now handled by chrome.debugger CDP in background.js

(function() {

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

// Handle DOM search messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
