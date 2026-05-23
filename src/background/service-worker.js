import { chatCompletion } from '../lib/deepseek.js';
import { BROWSER_TOOLS, SYSTEM_PROMPT } from '../lib/tools.js';

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

async function runAgentTask(userMessage, port, isAborted) {
  try {
    const { apiKey, model, thinkingEnabled, reasoningEffort } = await chrome.storage.sync.get(['apiKey', 'model', 'thinkingEnabled', 'reasoningEffort']);
    if (!apiKey) {
      port.postMessage({ type: 'error', data: 'Please set your DeepSeek API key in the settings (gear icon).' });
      return;
    }

    const tab = await getActiveTab();
    if (!tab) {
      port.postMessage({ type: 'error', data: 'No active tab found. Please open a web page first.' });
      return;
    }

    port.postMessage({ type: 'status', data: 'Reading page content...' });
    const contentReady = await ensureContentScript(tab.id);
    if (!contentReady) {
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('about:'))) {
        port.postMessage({ type: 'error', data: 'Cannot read Chrome system pages. Please open a regular web page.' });
      } else {
        port.postMessage({ type: 'error', data: 'Could not read page content. The page may be restricted or still loading. Try refreshing.' });
      }
      return;
    }

    const pageContext = await getPageContent(tab.id);
    if (!pageContext) {
      port.postMessage({ type: 'error', data: 'Could not read page content. Try refreshing the page.' });
      return;
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Here is the current page:\n\n${pageContext}\n\nUser task: ${userMessage}\n\nComplete this task step by step using the available tools. After each action you will see the updated page content.`
      }
    ];

    let iterations = 0;
    const MAX_ITERATIONS = 20;

    port.postMessage({ type: 'status', data: 'Thinking...' });

    while (iterations < MAX_ITERATIONS) {
      if (isAborted()) {
        port.postMessage({ type: 'status', data: 'Task cancelled.' });
        return;
      }

      const response = await chatCompletion(
        messages,
        BROWSER_TOOLS,
        apiKey,
        {
          model: model || 'deepseek-v4-flash',
          thinkingEnabled: thinkingEnabled !== false,
          reasoningEffort: reasoningEffort || 'high'
        }
      );

      const choice = response.choices?.[0];
      if (!choice) {
        port.postMessage({ type: 'error', data: 'No response from DeepSeek API.' });
        return;
      }

      const msg = choice.message;

      const assistantMsg = { role: 'assistant' };
      if (msg.content) assistantMsg.content = msg.content;
      if (msg.reasoning_content) assistantMsg.reasoning_content = msg.reasoning_content;
      if (msg.tool_calls) assistantMsg.tool_calls = msg.tool_calls;
      messages.push(assistantMsg);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          if (isAborted()) return;

          const funcName = toolCall.function.name;
          let funcArgs;
          try {
            funcArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            funcArgs = {};
          }

          port.postMessage({
            type: 'progress',
            data: {
              tool: funcName,
              args: funcArgs,
              thinking: msg.content || ''
            }
          });

          const result = await executeToolAction(tab.id, funcName, funcArgs);

          let toolResultContent;
          if (result.page_content) {
            toolResultContent = `Result: ${result.message || result.error}\n\nUpdated page:\n${result.page_content.substring(0, 3000)}`;
          } else if (result.updated_page) {
            toolResultContent = `Result: ${result.message || result.error}\n\nUpdated page:\n${result.updated_page.substring(0, 3000)}`;
          } else {
            toolResultContent = JSON.stringify(result);
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent
          });

          port.postMessage({ type: 'tool_result', data: result });

          if (result.possible_navigation) {
            await new Promise(r => setTimeout(r, 1500));
            await ensureContentScript(tab.id);
            const refreshedContent = await getPageContent(tab.id);
            if (refreshedContent) {
              messages.push({
                role: 'user',
                content: `[Page may have navigated. Current page content:]\n\n${refreshedContent}`
              });
            }
          }
        }

        port.postMessage({ type: 'status', data: 'Processing result...' });
      } else if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
        port.postMessage({
          type: 'result',
          data: msg.content || 'Task completed.'
        });
        return;
      } else {
        port.postMessage({
          type: 'error',
          data: `Unexpected finish reason: ${choice.finish_reason}`
        });
        return;
      }

      iterations++;
    }

    const finalContent = await getPageContent(tab.id);
    messages.push({
      role: 'user',
      content: `Maximum steps reached. Provide a summary based on the current page:\n\n${finalContent}`
    });

    const finalResponse = await chatCompletion(messages, [], apiKey, {
      model: model || 'deepseek-v4-flash',
      thinkingEnabled: thinkingEnabled !== false,
      reasoningEffort: reasoningEffort || 'high'
    });
    port.postMessage({
      type: 'result',
      data: finalResponse.choices?.[0]?.message?.content || 'Task execution completed. Check the page for results.'
    });

  } catch (error) {
    port.postMessage({ type: 'error', data: error.message || 'An unexpected error occurred.' });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidebar') {
    let taskAborted = false;

    port.onMessage.addListener(async (msg) => {
      switch (msg.type) {
        case 'get_settings': {
          const settings = await chrome.storage.sync.get(['apiKey', 'model', 'thinkingEnabled', 'reasoningEffort']);
          port.postMessage({ type: 'settings', data: settings });
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

        case 'run_task': {
          runAgentTask(msg.text, port, () => taskAborted);
          break;
        }

        case 'cancel_task': {
          taskAborted = true;
          break;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      taskAborted = true;
    });
  }
});
