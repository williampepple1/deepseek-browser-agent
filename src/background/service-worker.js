import { chatCompletion } from '../lib/deepseek.js';
import { BROWSER_TOOLS, SYSTEM_PROMPT } from '../lib/tools.js';

let activeTaskAborted = false;

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
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

async function executeToolAction(tabId, toolName, args) {
  switch (toolName) {
    case 'navigate': {
      const tab = await getActiveTab();
      if (!tab) return { success: false, error: 'No active tab' };
      await chrome.tabs.update(tabId, { url: args.url });
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
      const tab = await getActiveTab();
      if (!tab) return { success: false, error: 'No active tab' };
      if (!await chrome.tabs.goBack(tabId)) {
        return { success: false, error: 'No previous page in history' };
      }
      await new Promise(r => setTimeout(r, 1000));
      await ensureContentScript(tabId);
      const content = await getPageContent(tabId);
      return { success: true, message: 'Went back', page_content: content };
    }

    case 'click':
    case 'type':
    case 'scroll':
    case 'press':
    case 'get_page_content': {
      if (!await ensureContentScript(tabId)) {
        return { success: false, error: 'Cannot communicate with page. Try reloading the page.' };
      }
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'execute_action',
        action: { action: toolName, ...args }
      });
      return result?.data || { success: false, error: 'No response from page' };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

async function runAgentTask(userMessage, port) {
  activeTaskAborted = false;

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
    await ensureContentScript(tab.id);

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
      if (activeTaskAborted) {
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

      messages.push({
        role: 'assistant',
        content: msg.content || null,
        reasoning_content: msg.reasoning_content || null,
        tool_calls: msg.tool_calls || null
      });

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          if (activeTaskAborted) return;

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
            toolResultContent = `Result: ${result.message || result.error}\n\nUpdated page:\n${result.page_content}`;
          } else if (result.updated_page) {
            toolResultContent = `Result: ${result.message || result.error}\n\nUpdated page:\n${result.updated_page}`;
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
          runAgentTask(msg.text, port);
          break;
        }

        case 'cancel_task': {
          activeTaskAborted = true;
          break;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      activeTaskAborted = true;
    });
  }
});
