const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export async function chatCompletion(messages, tools, apiKey, options = {}) {
  const {
    model = 'deepseek-v4-flash',
    thinkingEnabled = true,
    reasoningEffort = 'high'
  } = options;

  const body = {
    model,
    messages,
    max_tokens: 4096,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

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

    if (!response.ok) {
      let errorMessage;
      try {
        const error = await response.json();
        errorMessage = error.error?.message || `HTTP ${response.status}`;
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(`DeepSeek API error: ${errorMessage}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}
