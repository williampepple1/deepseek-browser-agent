// WebSocket bridge: connects Chrome extension to Nanguo backend
// Uses chrome.alarms to survive MV3 service worker termination.

const DEFAULT_BACKEND = 'ws://localhost:8080/ws/agent';
const ALARM_RECONNECT = 'nanguo-reconnect';
const ALARM_HEARTBEAT = 'nanguo-heartbeat';
let ws = null;
let currentTaskId = null;

function log(...args) {
  console.log('[Nanguo]', ...args);
}

export function initWebSocketBridge(runAgentTask, abortState) {
  log('Bridge initializing...');

  chrome.alarms.create(ALARM_HEARTBEAT, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_RECONNECT) {
      connect();
    } else if (alarm.name === ALARM_HEARTBEAT) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connect();
      }
    }
  });

  connect();

  function connect() {
    chrome.storage.sync.get(['backendUrl'], (settings) => {
      const url = settings.backendUrl || DEFAULT_BACKEND;

      // Close stale connection
      if (ws) {
        try { ws.onclose = null; ws.onerror = null; ws.close(); } catch (e) {}
      }

      try {
        ws = new WebSocket(url);
      } catch (e) {
        log('WebSocket construction failed:', e.message);
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        log('Connected to', url);
      };

      ws.onmessage = async (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'run_task') {
          currentTaskId = msg.task_id;
          if (abortState) abortState.isAborted = false;
          log('Received task:', currentTaskId, msg.command);

          const mockPort = {
            postMessage: (data) => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ ...data, task_id: currentTaskId }));
              }
            }
          };

          try {
            await runAgentTask(msg.command, mockPort, () => abortState ? abortState.isAborted : false);
          } catch (e) {
            log('Task error:', e.message);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'error', task_id: currentTaskId, data: e.message }));
            }
          }
        } else if (msg.type === 'cancel_task') {
          if (abortState) abortState.isAborted = true;
        } else if (msg.type === 'ping') {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        }
      };

      ws.onclose = () => {
        log('Disconnected');
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    });
  }

  function scheduleReconnect() {
    chrome.alarms.create(ALARM_RECONNECT, { delayInMinutes: 0.1 });
  }
}
