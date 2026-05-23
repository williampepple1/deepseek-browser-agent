const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export async function chatCompletion(messages, tools, apiKey, options = {}) {
  const {
    model = 'deepseek-v4-flash',
    thinkingEnabled = true,
    reasoningEffort = 'high'
  } = options;

  const body = {
    model,
    messages,
    max_tokens: thinkingEnabled ? 8192 : 4096,
    stream: false
  };

  if (thinkingEnabled) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = reasoningEffort;
  } else {
    body.thinking = { type: 'disabled' };
    body.temperature = 0.7;
  }

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY * Math.pow(2, attempt - 1)));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (response.ok) {
        return response.json();
      }

      if (response.status === 429 || response.status === 408 || response.status >= 500) {
        let errorMessage;
        try {
          const error = await response.json();
          errorMessage = error.error?.message || `HTTP ${response.status}`;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        lastError = new Error(`DeepSeek API error: ${errorMessage}`);
        continue;
      }

      let errorMessage;
      try {
        const error = await response.json();
        errorMessage = error.error?.message || `HTTP ${response.status}`;
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(`DeepSeek API error: ${errorMessage}`);
    } catch (err) {
      if (err.name === 'AbortError') {
        lastError = new Error('DeepSeek API request timed out');
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('DeepSeek API request failed after retries');
}
