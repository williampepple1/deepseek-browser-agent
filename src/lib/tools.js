export const SYSTEM_PROMPT = `You are a browser automation agent powered by DeepSeek. You help users complete tasks on web pages by controlling the browser through function calls.

Your capabilities:
- Click buttons, links, and other interactive elements
- Type text into input fields and forms
- Scroll through pages
- Navigate to URLs
- Extract information from pages
- Wait for elements to load
- Go back in browser history

Important rules:
1. Use element indices (like [1], [2]) from the page content to reference elements
2. Execute ONE action at a time, then wait for the result before the next action
3. After actions, you will receive updated page content automatically — use it to decide your next step
4. Be concise — briefly explain each step as you work
5. If an element is not found, call get_page_content to refresh your view of the page
6. For search forms: type the query first, then press Enter or click the search button
7. For login forms: fill username/email first, then password, then submit
8. If you need to extract information, call get_page_content as your final step
9. If an action fails, try an alternative approach — e.g. if click[5] fails, try press Enter instead
10. If the page changes unexpectedly (SPA navigation, popups), call get_page_content to re-scan
11. Never repeat the exact same action that just failed — try a different approach
12. When you complete the task, provide a clear summary of what was accomplished.

When you complete the task, provide a clear summary of what was accomplished.`;

export const BROWSER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click on an interactive element on the page. Use the element_index from the page content shown in [brackets].',
      parameters: {
        type: 'object',
        properties: {
          element_index: {
            type: 'number',
            description: 'The index number of the element to click, as shown in [brackets] in the page content'
          }
        },
        required: ['element_index']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description: 'Type text into an input element. The existing content will be replaced with the new text.',
      parameters: {
        type: 'object',
        properties: {
          element_index: {
            type: 'number',
            description: 'The index number of the input or textarea element'
          },
          text: {
            type: 'string',
            description: 'The text to type into the element'
          }
        },
        required: ['element_index', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page up, down, to top, or to bottom.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['down', 'up', 'top', 'bottom'],
            description: 'Direction to scroll the page'
          },
          amount: {
            type: 'number',
            description: 'Number of pixels to scroll (default: 500). Only used with up/down directions.'
          }
        },
        required: ['direction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate the current tab to a specific URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to navigate to, including https://'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_page_content',
      description: 'Get the current page content including all interactive elements and visible text. Use this to refresh your view of the page after actions or to extract information.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for a specified number of seconds. Useful when waiting for page content to load or animations to complete.',
      parameters: {
        type: 'object',
        properties: {
          seconds: {
            type: 'number',
            description: 'Number of seconds to wait (minimum 1, maximum 10)'
          }
        },
        required: ['seconds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'press',
      description: 'Press a keyboard key (Enter, Tab, Escape, etc.) on the currently focused element.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'],
            description: 'The name of the key to press'
          }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Capture the visible area of the current tab as an image.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: 'List all open tabs in the current window.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: 'Switch to a different tab by its ID.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'number', description: 'The ID of the tab to switch to' }
        },
        required: ['tab_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_tab',
      description: 'Open a new tab with a specific URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to open' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_document',
      description: 'Fetch and read text content from a text-based document (txt, md, html).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the document' }
        },
        required: ['url']
      }
    }
  }
];
