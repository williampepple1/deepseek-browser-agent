(function () {
  'use strict';

  let elementMap = new Map();
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'META', 'LINK', 'HEAD', 'TEMPLATE']);

  const INTERACTIVE_TAGS = new Set([
    'button', 'a', 'input', 'textarea', 'select',
    'details', 'summary', 'label', 'option'
  ]);

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'combobox', 'listbox',
    'menuitem', 'tab', 'switch', 'checkbox', 'radio',
    'option', 'slider', 'spinbutton', 'searchbox'
  ]);

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    return true;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) {
      if (tag === 'input' && (el.type === 'hidden' || el.disabled)) return false;
      if ((tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') && el.disabled) return false;
      return true;
    }
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') return true;
    return false;
  }

  function getElementText(el) {
    const tag = el.tagName.toLowerCase();
    let text = '';
    if (tag === 'input') {
      text = el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '';
    } else if (tag === 'textarea') {
      text = el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '';
    } else if (tag === 'select') {
      const sel = el.options[el.selectedIndex];
      text = sel ? sel.text : (el.getAttribute('aria-label') || el.name || '');
    } else if (tag === 'a') {
      text = el.textContent || '';
      const href = el.getAttribute('href');
      if (href) text += ' -> ' + href;
    } else {
      text = el.textContent || el.getAttribute('aria-label') || el.title || '';
    }
    return text.trim().replace(/\s+/g, ' ').substring(0, 150);
  }

  function getPageContent() {
    elementMap.clear();

    const elements = [];
    const textNodes = [];
    let index = 1;
    const MAX_ELEMENTS = 150;
    const MAX_TEXTNODES = 30;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (textNodes.length >= MAX_TEXTNODES) return NodeFilter.FILTER_REJECT;
            const text = node.textContent.trim();
            if (text.length < 20) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
            if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
          if (elements.length >= MAX_ELEMENTS) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (!isInteractive(node)) return NodeFilter.FILTER_REJECT;
          if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node.textContent.trim().substring(0, 300));
      } else {
        const tag = node.tagName.toLowerCase();
        const type = (tag === 'input') ? (node.type || 'text') : (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : tag);
        const text = getElementText(node);
        if (!text) continue;

        elementMap.set(index, node);

        let typeLabel = '';
        if (tag === 'input') typeLabel = `[${type}]`;
        else if (tag === 'a') typeLabel = '[link]';
        else if (tag === 'button') typeLabel = '[btn]';
        else if (tag === 'select') typeLabel = '[sel]';
        else if (tag === 'textarea') typeLabel = '[txt]';

        elements.push(`[${index}] <${tag}${typeLabel}> ${text}`);
        index++;
      }
    }

    let output = [];
    output.push(`URL: ${window.location.href}`);
    output.push(`Title: ${document.title}`);
    output.push('');
    output.push('=== Elements ===');
    output.push(elements.length > 0 ? elements.join('\n') : '(none)');
    output.push('');
    output.push('=== Text ===');
    output.push(textNodes.length > 0 ? textNodes.join('\n') : '(none)');

    return output.join('\n');
  }

  async function executeAction(action) {
    switch (action.action) {
      case 'click': {
        const idx = action.element_index;
        const el = elementMap.get(idx);
        if (!el || !document.contains(el)) {
          return { success: false, error: `Element [${idx}] no longer exists on page. Try get_page_content to refresh.` };
        }
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();

        const urlBefore = window.location.href;
        const isNavigationLikely = (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:')) ||
          (el.tagName === 'BUTTON' && el.closest('form') && (el.type === 'submit' || !el.type));

        el.click();

        await new Promise(r => setTimeout(r, 500));

        const urlChanged = window.location.href !== urlBefore;
        const updated = getPageContent();
        return {
          success: true,
          message: `Clicked [${idx}]: ${el.textContent?.trim().substring(0, 60)}`,
          updated_page: updated,
          possible_navigation: isNavigationLikely || urlChanged
        };
      }

      case 'type': {
        const idx = action.element_index;
        const el = elementMap.get(idx);
        if (!el || !document.contains(el)) {
          return { success: false, error: `Element [${idx}] no longer exists on page. Try get_page_content to refresh.` };
        }
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.value = action.text;
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
        await new Promise((resolve) => {
          let resolved = false;
          const done = () => { if (!resolved) { resolved = true; resolve(); } };
          window.addEventListener('scrollend', done, { once: true });
          setTimeout(done, 800);
        });
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
          const form = activeEl.closest('form');
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
          if (submitBtn && isVisible(submitBtn)) {
            submitBtn.click();
          } else {
            try { form.submit(); } catch {}
          }
          await new Promise(r => setTimeout(r, 800));
          const updated = getPageContent();
          return { success: true, message: 'Pressed Enter (form submitted)', updated_page: updated };
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
