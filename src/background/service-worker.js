import { chatCompletion } from '../lib/deepseek.js';
import { BROWSER_TOOLS, SYSTEM_PROMPT } from '../lib/tools.js';
import { initWebSocketBridge } from '../bridge/ws-client.js';

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return false;
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content.js']
      });
      await new Promise(r => setTimeout(r, 200));
      return true;
    } catch (e) {
      return false;
    }
  }
}

async function getPageContent(tabId) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'get_page_content' });
    return result?.data?.formatted || '';
  } catch (e) {
    return '';
  }
}

async function waitForPageLoad(tabId) {
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// --- Site Memory ---
async function getSiteMemory(domain) {
  const data = await chrome.storage.local.get(['siteMemory']);
  const memory = data.siteMemory || {};
  return memory[domain] || [];
}

async function saveSiteMemory(domain, note) {
  const data = await chrome.storage.local.get(['siteMemory']);
  const memory = data.siteMemory || {};
  if (!memory[domain]) memory[domain] = [];
  if (!memory[domain].includes(note)) {
    memory[domain].push(note);
  }
  await chrome.storage.local.set({ siteMemory: memory });
}

// --- Tool Execution ---
async function executeToolAction(tabId, toolName, args) {
  switch (toolName) {
    case 'navigate': {
      if (!args.url || !/^https?:\/\//i.test(args.url)) {
        return { success: false, error: 'Invalid URL. Must start with http:// or https://' };
      }
      await chrome.tabs.update(tabId, { url: args.url });
      await waitForPageLoad(tabId);
      await ensureContentScript(tabId);
      const content = await getPageContent(tabId);
      return { success: true, message: `Navigated to ${args.url}`, page_content: content };
    }

    case 'wait': {
      const seconds = Math.min(Math.max(args.seconds || 1, 1), 10);
      await new Promise(r => setTimeout(r, seconds * 1000));
      return { success: true, message: `Waited ${seconds}s` };
    }

    case 'go_back': {
      if (!await chrome.tabs.goBack(tabId)) {
        return { success: false, error: 'No previous page in history' };
      }
      await waitForPageLoad(tabId);
      await ensureContentScript(tabId);
      const content = await getPageContent(tabId);
      return { success: true, message: 'Went back', page_content: content };
    }

    case 'take_screenshot': {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      const winId = t?.windowId ?? null;
      const dataUrl = await chrome.tabs.captureVisibleTab(winId, { format: 'png' });
      return { success: true, message: 'Screenshot captured.', image_data: dataUrl };
    }

    case 'list_tabs': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const tabList = tabs.slice(0, 30).map(t => `[${t.id}] ${t.title}`).join('\n');
      return { success: true, message: 'Tabs listed:', page_content: tabList };
    }

    case 'switch_tab': {
      await chrome.tabs.update(args.tab_id, { active: true });
      return { success: true, message: `Switched to tab ${args.tab_id}`, new_tab_id: args.tab_id };
    }

    case 'open_tab': {
      const newTab = await chrome.tabs.create({ url: args.url });
      await waitForPageLoad(newTab.id);
      await chrome.tabs.update(newTab.id, { active: true });
      return { success: true, message: `Opened and switched to tab ${newTab.id}`, new_tab_id: newTab.id };
    }

    case 'read_document': {
      try {
        const response = await fetch(args.url);
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
        const text = await response.text();
        return { success: true, message: 'Document content:', page_content: text.substring(0, 5000) };
      } catch (e) {
        return { success: false, error: `Failed to fetch document: ${e.message}` };
      }
    }

    case 'add_site_note': {
      const t = await getActiveTab();
      if (!t) return { success: false, error: 'No active tab' };
      const domain = (() => { try { return new URL(t.url).hostname; } catch { return 'unknown'; } })();
      await saveSiteMemory(domain, args.note);
      return { success: true, message: `Saved note for ${domain}.` };
    }

    case 'click':
    case 'type':
    case 'scroll':
    case 'press':
    case 'get_page_content': {
      const safeArgs = { ...args };
      delete safeArgs.action;
      delete safeArgs.type;
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'execute_action',
        action: { action: toolName, ...safeArgs }
      });
      return result?.data || { success: false, error: 'No response from page' };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// --- Agent Task Loop ---
const runningTasks = new Set();
let currentTaskAborted = false;

async function runAgentTask(userMessage, port, isAborted) {
  const tab = await getActiveTab();
  if (!tab) {
    port.postMessage({ type: 'error', data: 'No active tab found.' });
    return;
  }
  if (runningTasks.has(tab.id)) {
    port.postMessage({ type: 'error', data: 'A task is already running in this tab.' });
    return;
  }
  runningTasks.add(tab.id);
  const entryTabId = tab.id;

  try {
    const { apiKey, model, thinkingEnabled, reasoningEffort } = await chrome.storage.sync.get(['apiKey', 'model', 'thinkingEnabled', 'reasoningEffort']);
    if (!apiKey) {
      port.postMessage({ type: 'error', data: 'Please set your DeepSeek API key in settings.' });
      return;
    }

    port.postMessage({ type: 'status', data: 'Reading page content...' });
    const contentReady = await ensureContentScript(tab.id);
    if (!contentReady) {
      const msg = tab.url?.startsWith('chrome://') || tab.url?.startsWith('about:')
        ? 'Cannot read Chrome system pages. Open a regular web page.'
        : 'Could not read page. Try refreshing.';
      port.postMessage({ type: 'error', data: msg });
      return;
    }

    const pageContext = await getPageContent(tab.id);
    if (!pageContext) {
      port.postMessage({ type: 'error', data: 'Could not read page content.' });
      return;
    }

    const domain = (() => { try { return new URL(tab.url).hostname; } catch { return 'unknown'; } })();
    const siteNotes = await getSiteMemory(domain);
    let systemPrompt = SYSTEM_PROMPT;
    if (siteNotes.length > 0) {
      systemPrompt += `\n\n### Site Memory for ${domain}:\n` + siteNotes.map(n => `- ${n}`).join('\n');
    }

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    let pendingImage = null;
    let iterations = 0;
    const MAX_ITERATIONS = 25;

    messages.push({ role: 'user', content: `Current page:\n${pageContext}\n\nUser task: ${userMessage}` });
    port.postMessage({ type: 'status', data: 'Thinking...' });

    while (iterations < MAX_ITERATIONS) {
      if (isAborted()) {
        port.postMessage({ type: 'status', data: 'Task cancelled.' });
        return;
      }

      const response = await chatCompletion(messages, BROWSER_TOOLS, apiKey, {
        model: model || 'deepseek-v4-flash',
        thinkingEnabled: thinkingEnabled !== false,
        reasoningEffort: reasoningEffort || 'high'
      });

      const choice = response.choices?.[0];
      if (!choice) {
        port.postMessage({ type: 'error', data: 'No response from DeepSeek API.' });
        return;
      }

      const asstMsg = choice.message;
      const assistantMsg = { role: 'assistant' };
      if (asstMsg.content) assistantMsg.content = asstMsg.content;
      if (asstMsg.reasoning_content) assistantMsg.reasoning_content = asstMsg.reasoning_content;
      if (asstMsg.tool_calls) assistantMsg.tool_calls = asstMsg.tool_calls;
      messages.push(assistantMsg);

      if (asstMsg.tool_calls && asstMsg.tool_calls.length > 0) {
        for (const tc of asstMsg.tool_calls) {
          if (isAborted()) return;

          const fName = tc.function.name;
          let fArgs = {};
          try { fArgs = JSON.parse(tc.function.arguments); } catch {}

          port.postMessage({ type: 'progress', data: { tool: fName, args: fArgs, thinking: asstMsg.content || '' } });

          const result = await executeToolAction(tab.id, fName, fArgs);

          if (result.new_tab_id) {
            tab.id = result.new_tab_id;
            await ensureContentScript(tab.id);
            const newContent = await getPageContent(tab.id);
            if (newContent) {
              messages.push({ role: 'user', content: `[Switched to new tab. Page content:]\n${newContent}` });
            }
          }

          if (result.image_data) pendingImage = result.image_data;

          let toolContent;
          if (result.page_content) {
            toolContent = `${result.message || result.error}\n\nPage:\n${result.page_content.substring(0, 3000)}`;
          } else if (result.updated_page) {
            toolContent = `${result.message || result.error}\n\nPage:\n${result.updated_page.substring(0, 3000)}`;
          } else if (result.success === false && result.error) {
            toolContent = `ERROR: ${result.error}\nAnalyze why this failed and try a different approach. Do NOT repeat the same action.`;
          } else {
            toolContent = JSON.stringify(result);
          }

          messages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent });
          port.postMessage({ type: 'tool_result', data: result });

          if (result.possible_navigation) {
            await new Promise(r => setTimeout(r, 1500));
            await ensureContentScript(tab.id);
            const fresh = await getPageContent(tab.id);
            if (fresh) {
              messages.push({ role: 'user', content: `[Page navigated. Updated content:]\n${fresh}` });
            }
          }
        }
      } else {
        // Inject pending image before final answer
        if (pendingImage) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: 'Here is the screenshot:' },
              { type: 'image_url', image_url: { url: pendingImage } }
            ]
          });
          pendingImage = null;
          continue;
        }

        port.postMessage({ type: 'result', data: asstMsg.content || 'Task completed.' });
        return;
      }

      // Inject pending image into next turn
      if (pendingImage) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Here is the latest screenshot:' },
            { type: 'image_url', image_url: { url: pendingImage } }
          ]
        });
        pendingImage = null;
      }

      iterations++;
    }

    const finalContent = await getPageContent(tab.id);
    messages.push({ role: 'user', content: `Max steps reached. Summarize:\n${finalContent}` });
    const finalResp = await chatCompletion(messages, null, apiKey, {
      model: model || 'deepseek-v4-flash',
      thinkingEnabled: thinkingEnabled !== false,
      reasoningEffort: reasoningEffort || 'high'
    });
    port.postMessage({ type: 'result', data: finalResp.choices?.[0]?.message?.content || 'Done.' });

  } catch (error) {
    port.postMessage({ type: 'error', data: error.message || 'Unexpected error.' });
  } finally {
    runningTasks.delete(entryTabId);
  }
}

// --- Port Management ---
initWebSocketBridge(runAgentTask, {
  get isAborted() { return currentTaskAborted; },
  set isAborted(v) { currentTaskAborted = v; }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidebar') {

    port.onMessage.addListener(async (msg) => {
      switch (msg.type) {
        case 'get_settings': {
          const s = await chrome.storage.sync.get(['apiKey', 'model', 'thinkingEnabled', 'reasoningEffort']);
          port.postMessage({ type: 'settings', data: s });
          break;
        }
        case 'save_settings': {
          await chrome.storage.sync.set({
            apiKey: msg.apiKey,
            model: msg.model || 'deepseek-v4-flash',
            thinkingEnabled: msg.thinkingEnabled !== false,
            reasoningEffort: msg.reasoningEffort || 'high'
          });
          port.postMessage({ type: 'settings_saved' });
          break;
        }
        case 'run_task':
          currentTaskAborted = false;
          runAgentTask(msg.text, port, () => currentTaskAborted);
          break;
        case 'cancel_task':
          currentTaskAborted = true;
          break;
      }
    });

    port.onDisconnect.addListener(() => { currentTaskAborted = true; });
  }
});
