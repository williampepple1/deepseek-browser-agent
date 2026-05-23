let port;
let isRunning = false;
let pendingMessages = [];
let reconnectTimer = null;

function connectPort() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    port = chrome.runtime.connect({ name: 'sidebar' });
  } catch {
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    scheduleReconnect();
  });

  sendPending();
  postMessage({ type: 'get_settings' });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(connectPort, 500);
}

function postMessage(msg) {
  if (port) {
    try {
      port.postMessage(msg);
      return;
    } catch {
      port = null;
    }
  }
  if (pendingMessages.length < 20) {
    pendingMessages.push(msg);
  }
  scheduleReconnect();
}

function sendPending() {
  const msgs = pendingMessages;
  pendingMessages = [];
  for (const msg of msgs) {
    postMessage(msg);
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'settings':
      if (msg.data.apiKey) {
        apiKeyInput.value = msg.data.apiKey || '';
        modelSelect.value = msg.data.model || 'deepseek-v4-flash';
        thinkingToggle.checked = msg.data.thinkingEnabled !== false;
        effortSelect.value = msg.data.reasoningEffort || 'high';
        effortSelect.disabled = !thinkingToggle.checked;
        effortGroup.style.opacity = thinkingToggle.checked ? '1' : '0.4';
      }
      break;

    case 'settings_saved':
      showChat();
      addStatusMessage('Settings saved.');
      break;

    case 'status':
      if (isRunning) updateStatus(msg.data);
      break;

    case 'progress':
      if (isRunning) addProgressMessage(msg.data);
      break;

    case 'tool_result':
      if (isRunning) addToolResultMessage(msg.data);
      break;

    case 'result':
      if (isRunning) {
        addAgentMessage(msg.data);
        setRunning(false);
      }
      break;

    case 'error':
      addErrorMessage(msg.data);
      setRunning(false);
      break;
  }
}

const chatScreen = document.getElementById('chat');
const settingsScreen = document.getElementById('settings');
const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const cancelBtn = document.getElementById('cancel-btn');
const settingsBtn = document.getElementById('settings-btn');
const saveSettingsBtn = document.getElementById('save-settings');
const backSettingsBtn = document.getElementById('back-from-settings');
const apiKeyInput = document.getElementById('api-key-input');
const modelSelect = document.getElementById('model-select');
const thinkingToggle = document.getElementById('thinking-toggle');
const effortSelect = document.getElementById('effort-select');
const effortGroup = document.getElementById('effort-group');

thinkingToggle.addEventListener('change', () => {
  effortGroup.style.opacity = thinkingToggle.checked ? '1' : '0.4';
  effortSelect.disabled = !thinkingToggle.checked;
});

function setRunning(running) {
  isRunning = running;
  sendBtn.disabled = running;
  userInput.disabled = running;
  cancelBtn.classList.toggle('hidden', !running);
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function trimMessages() {
  const MAX_MESSAGES = 80;
  const msgs = messagesEl.querySelectorAll('.message:not(.welcome)');
  while (msgs.length > MAX_MESSAGES) {
    msgs[0].remove();
  }
}

function addStatusMessage(text) {
  const existing = messagesEl.querySelector('.message.status:last-child');
  if (existing && existing.dataset.status === 'active') {
    existing.textContent = text;
  } else {
    const div = document.createElement('div');
    div.className = 'message status';
    div.dataset.status = 'active';
    div.textContent = text;
    messagesEl.appendChild(div);
    trimMessages();
  }
  scrollToBottom();
}

function updateStatus(text) {
  const existing = messagesEl.querySelector('.message.status:last-child');
  if (existing && existing.dataset.status === 'active') {
    existing.innerHTML = `<span class="spinner"></span>${escapeHtml(text)}`;
  } else {
    const div = document.createElement('div');
    div.className = 'message status';
    div.dataset.status = 'active';
    div.innerHTML = `<span class="spinner"></span>${escapeHtml(text)}`;
    messagesEl.appendChild(div);
    trimMessages();
  }
  scrollToBottom();
}

function addAgentMessage(text) {
  clearStatusMessages();
  hideWelcome();
  const div = document.createElement('div');
  div.className = 'message agent';
  div.textContent = text;
  messagesEl.appendChild(div);
  trimMessages();
  scrollToBottom();
}

function addProgressMessage(data) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = 'message progress';

  let html = '';
  if (data.thinking && data.thinking.trim()) {
    html += `<div class="tool-name">${escapeHtml(data.thinking.substring(0, 300))}</div>`;
  }
  if (data.tool) {
    const argsStr = formatArgs(data.args);
    html += `<div class="tool-action">${escapeHtml(data.tool)}(${argsStr})</div>`;
  }
  div.innerHTML = html;
  messagesEl.appendChild(div);
  trimMessages();
  scrollToBottom();
}

function addToolResultMessage(data) {
  if (!data) return;
  const text = data.message || data.error || '';
  if (!text) return;

  const div = document.createElement('div');
  div.className = 'message progress';
  const isError = data.error || data.success === false;
  div.innerHTML = `<div class="tool-result" style="color:${isError ? 'var(--error)' : 'var(--success)'}">${isError ? '✗' : '✓'} ${escapeHtml(text.substring(0, 200))}</div>`;
  messagesEl.appendChild(div);
  trimMessages();
  scrollToBottom();
}

function addErrorMessage(text) {
  hideWelcome();
  clearStatusMessages();
  const div = document.createElement('div');
  div.className = 'message error';
  div.textContent = text;
  messagesEl.appendChild(div);
  trimMessages();
  scrollToBottom();
}

function clearStatusMessages() {
  messagesEl.querySelectorAll('.message.status').forEach(el => el.remove());
}

function hideWelcome() {
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.style.display = 'none';
}

function formatArgs(args) {
  if (!args || Object.keys(args).length === 0) return '';
  const parts = [];
  for (const [key, value] of Object.entries(args)) {
    const str = typeof value === 'string' ? `"${value.substring(0, 30)}"` : JSON.stringify(value).substring(0, 50);
    parts.push(`${key}: ${str}`);
  }
  return parts.join(', ').substring(0, 100);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showChat() {
  settingsScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
}

function showSettings() {
  chatScreen.classList.add('hidden');
  settingsScreen.classList.remove('hidden');
}

sendBtn.addEventListener('click', () => {
  const text = userInput.value.trim();
  if (!text || isRunning) return;

  hideWelcome();
  clearStatusMessages();

  const div = document.createElement('div');
  div.className = 'message user';
  div.textContent = text;
  messagesEl.appendChild(div);
  trimMessages();
  userInput.value = '';
  userInput.style.height = 'auto';
  setRunning(true);

  postMessage({ type: 'run_task', text });
});

cancelBtn.addEventListener('click', () => {
  postMessage({ type: 'cancel_task' });
  setRunning(false);
  addStatusMessage('Task cancelled.');
});

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
});

settingsBtn.addEventListener('click', showSettings);
backSettingsBtn.addEventListener('click', showChat);

saveSettingsBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelSelect.value;
  if (!apiKey) {
    addErrorMessage('API key is required.');
    return;
  }
  if (!apiKey.startsWith('sk-')) {
    addErrorMessage('API key should start with "sk-". Please check your key.');
    return;
  }
  postMessage({
    type: 'save_settings',
    apiKey,
    model,
    thinkingEnabled: thinkingToggle.checked,
    reasoningEffort: effortSelect.value
  });
});

document.querySelectorAll('.welcome ul li').forEach(li => {
  li.addEventListener('click', () => {
    userInput.value = li.textContent.replace(/[""]/g, '');
    sendBtn.click();
  });
});

connectPort();
