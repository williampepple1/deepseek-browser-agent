(function () {
  'use strict';

  let elementMap = new Map();

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getPageContent() {
    elementMap.clear();

    const candidates = new Set();

    const interactiveSelectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="searchbox"]',
      '[role="listbox"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="option"]',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
      'details summary'
    ];

    interactiveSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (isVisible(el)) candidates.add(el);
        });
      } catch (e) {
        // Skip invalid selectors
      }
    });

    let elements = [];
    let textNodes = [];
    let index = 1;

    for (const el of candidates) {
      const tag = el.tagName.toLowerCase();
      let text = '';
      let elementType = '';

      if (tag === 'input') {
        elementType = el.type || 'text';
        text = el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '';
      } else if (tag === 'textarea') {
        elementType = 'textarea';
        text = el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '';
      } else if (tag === 'select') {
        elementType = 'select';
        const selected = el.options[el.selectedIndex];
        text = selected ? selected.text : (el.getAttribute('aria-label') || el.name || '');
      } else if (tag === 'a') {
        elementType = 'link';
        text = el.textContent || '';
        const href = el.getAttribute('href');
        if (href) text += ' -> ' + href;
      } else if (tag === 'button') {
        elementType = 'button';
        text = el.textContent || el.getAttribute('aria-label') || el.title || '';
      } else {
        elementType = tag;
        text = el.textContent || el.getAttribute('aria-label') || '';
      }

      text = text.trim().replace(/\s+/g, ' ').substring(0, 150);
      if (!text) continue;

      el.setAttribute('data-dsai-idx', index);
      elementMap.set(index, el);

      const tagInfo = elementType ? `${tag}[${elementType}]` : tag;
      elements.push(`[${index}] <${tagInfo}> ${text}`);

      index++;
    }

    // Collect visible text content from main content area (limited)
    const mainContent = document.querySelector('main, article, [role="main"], .content, #content') || document.body;
    const walker = document.createTreeWalker(
      mainContent,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentElement;
          if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text.length > 15) textNodes.push(text);
    }

    const pageText = textNodes.slice(0, 40).join('\n').substring(0, 2500);

    let output = [];
    output.push(`URL: ${window.location.href}`);
    output.push(`Title: ${document.title}`);
    output.push('');
    output.push('=== Interactive Elements ===');
    if (elements.length === 0) {
      output.push('(No interactive elements found)');
    } else {
      output.push(elements.join('\n'));
    }
    output.push('');
    output.push('=== Page Text ===');
    output.push(pageText || '(No visible text content)');

    return output.join('\n');
  }

  async function executeAction(action) {
    switch (action.action) {
      case 'click': {
        const idx = action.element_index;
        const el = elementMap.get(idx);
        if (!el) return { success: false, error: `Element [${idx}] not found on page. Try refreshing page content.` };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();

        const isNavigationLikely = (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:')) ||
          (el.tagName === 'BUTTON' && el.closest('form') && (el.type === 'submit' || !el.type));

        el.click();

        await new Promise(r => setTimeout(r, 400));

        const updated = getPageContent();
        return {
          success: true,
          message: `Clicked [${idx}]: ${el.textContent?.trim().substring(0, 60)}`,
          updated_page: updated,
          possible_navigation: isNavigationLikely
        };
      }

      case 'type': {
        const idx = action.element_index;
        const el = elementMap.get(idx);
        if (!el) return { success: false, error: `Element [${idx}] not found on page.` };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(el, action.text);
          } else {
            el.value = action.text;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.getAttribute('contenteditable') === 'true') {
          el.textContent = action.text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const updated = getPageContent();
        return {
          success: true,
          message: `Typed "${action.text}" into [${idx}]`,
          updated_page: updated
        };
      }

      case 'scroll': {
        const amount = action.amount || 500;
        switch (action.direction) {
          case 'down': window.scrollBy({ top: amount, behavior: 'smooth' }); break;
          case 'up': window.scrollBy({ top: -amount, behavior: 'smooth' }); break;
          case 'bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break;
          case 'top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
        }
        await new Promise(r => setTimeout(r, 300));
        const updated = getPageContent();
        return { success: true, message: `Scrolled ${action.direction}`, updated_page: updated };
      }

      case 'press': {
        const activeEl = document.activeElement || document.body;
        const key = action.key;
        const opts = { key, code: key, keyCode: 0, which: 0, bubbles: true, cancelable: true };
        activeEl.dispatchEvent(new KeyboardEvent('keydown', opts));
        activeEl.dispatchEvent(new KeyboardEvent('keypress', opts));
        activeEl.dispatchEvent(new KeyboardEvent('keyup', opts));

        if (key === 'Enter' && activeEl.closest('form')) {
          await new Promise(r => setTimeout(r, 500));
          const updated = getPageContent();
          return { success: true, message: `Pressed Enter (form submission likely)`, updated_page: updated };
        }
        return { success: true, message: `Pressed key: ${key}` };
      }

      case 'get_page_content': {
        const content = getPageContent();
        return { success: true, page_content: content };
      }

      default:
        return { success: false, error: `Unknown action: ${action.action}` };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'get_page_content': {
            const content = getPageContent();
            sendResponse({ type: 'page_content', data: { formatted: content } });
            break;
          }
          case 'execute_action': {
            const result = await executeAction(msg.action);
            sendResponse({ type: 'action_result', data: result });
            break;
          }
          case 'ping': {
            sendResponse({ type: 'pong' });
            break;
          }
        }
      } catch (err) {
        sendResponse({ type: 'error', data: { message: err.message } });
      }
    })();
    return true;
  });
})();
