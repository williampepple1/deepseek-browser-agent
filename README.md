# DeepSeek Browser Agent

An agentic Chrome extension powered by DeepSeek AI that can see web pages and complete tasks autonomously — click buttons, fill forms, navigate, extract data, and more.

> Built for Chrome Manifest V3. Uses the Side Panel API for a persistent chat interface.

## How It Works

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Sidebar    │────▶│ Background Worker │────▶│  Content Script  │
│   (you type  │     │  (agent loop +   │     │  (reads DOM,     │
│   tasks)     │◀────│   DeepSeek API)  │◀────│   executes       │
│              │     │                  │     │   actions)       │
└──────────────┘     └──────────────────┘     └─────────────────┘
```

### Agent Loop

1. You type a task in the sidebar (e.g. *"Search for wireless headphones on Amazon"*)
2. The content script scans the page and builds a map of every interactive element (buttons, inputs, links, selects) with numbered indices
3. The page content + your task is sent to DeepSeek's API along with 8 browser tools it can call
4. DeepSeek decides which action to take — it calls a tool like `click(element_index: 15)` or `type(element_index: 7, text: "headphones")`
5. The content script executes the action on the real page and returns the updated page state
6. Steps 3–5 repeat until the task is complete (up to 20 iterations, then it summarizes)

### Available Tools

The agent can use these browser actions:

| Tool | What it does |
|---|---|
| `click` | Click a button, link, or interactive element by index |
| `type` | Type text into an input field |
| `scroll` | Scroll the page up/down/to top/to bottom |
| `navigate` | Go to a specific URL |
| `get_page_content` | Refresh the page view (re-scans all elements) |
| `wait` | Pause for a number of seconds |
| `press` | Press a keyboard key (Enter, Tab, Escape, arrows) |
| `go_back` | Go back in browser history |

## Project Structure

```
deepseek-browser-agent/
├── manifest.json              # Extension manifest (MV3)
├── package.json
├── .gitignore
├── src/
│   ├── background/
│   │   └── service-worker.js  # Agent loop, DeepSeek API calls, message routing
│   ├── content/
│   │   └── content.js         # DOM scanning, action execution, element indexing
│   ├── sidebar/
│   │   ├── sidebar.html       # Chat UI & settings screen
│   │   ├── sidebar.css        # Dark theme styles
│   │   └── sidebar.js         # UI logic, message handling
│   └── lib/
│       ├── deepseek.js        # DeepSeek API client (OpenAI-compatible endpoint)
│       └── tools.js           # System prompt & tool definitions (JSON Schema)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Setup

### 1. Get a DeepSeek API Key

Get your API key from **[platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)**.

> Your key starts with `sk-`. Keep it private — never commit it to the repo.

### 2. Load the Extension in Chrome

1. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge)
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `deepseek-browser-agent` folder
5. The extension icon appears in your toolbar

### 3. Configure Your API Key

1. Click the extension icon to open the side panel
2. Click the gear icon (⚙) to open Settings
3. Paste your DeepSeek API key (starts with `sk-`)
4. Choose your model:
   - **DeepSeek V4 Flash** — fast, great for most tasks ($0.14/$0.28 per 1M tokens)
   - **DeepSeek V4 Pro** — most capable, best for complex tasks ($1.74/$3.48 per 1M tokens)
5. Toggle **thinking mode** on/off (enabled by default — adds chain-of-thought reasoning for better accuracy)
6. Click **Save Settings**

Your API key is stored in Chrome's synced storage and encrypted at rest by Chrome. It is only sent to `api.deepseek.com`.

## Usage Examples

Open any web page, click the extension icon, and try:

| Task | What the agent does |
|---|---|
| *"Search for iPhone 16 reviews"* | Types in the search box, clicks search, scrolls results |
| *"Fill this form with sample data"* | Fills each input field with realistic data |
| *"Log in with username admin and password test123"* | Fills username + password fields, clicks submit |
| *"Find the cheapest plan on this pricing page"* | Scrolls through pricing, extracts prices, compares |
| *"Go to github.com and search for deepseek"* | Navigates to GitHub, types in search, submits |
| *"Extract all product names and prices from this page"* | Scans the page, extracts structured data |

## Requirements

- **Chrome 114+** or **Edge 114+** (for Side Panel API support)
- A **DeepSeek API key** with available credits

## Security

- The API key is stored in `chrome.storage.sync` (encrypted at rest by Chrome)
- API calls go only to `api.deepseek.com`
- No data is sent to any third party
- The extension does not log or store your browsing data anywhere
- Content scripts only access the DOM of the active tab when you explicitly run a task

## Development

No build step required — just load the unpacked extension. All files are plain JavaScript, CSS, and HTML.

To reload after changes:
1. Make your edits
2. Go to `chrome://extensions`
3. Click the refresh icon on the DeepSeek Browser Agent card
4. Close and reopen the side panel to pick up UI changes

### Debugging

- **Background worker**: Click "Service Worker" on the extension card in `chrome://extensions` to open DevTools
- **Content script**: Open the page's DevTools → Sources → Content Scripts → find `content.js`
- **Sidebar**: Right-click the sidebar → Inspect
