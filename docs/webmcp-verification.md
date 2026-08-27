# WebMCP Proof Page Verification

This document describes how to verify that the WebMCP browser API (`document.modelContext.registerTool`) works locally.

## Prerequisites

- Google Chrome **149 or newer** (the WebMCP origin trial landed in Chrome 149;
  the `chrome://flags/#enable-webmcp-testing` flag wants 150 or newer). If the
  flag search in `chrome://flags` finds nothing for "webmcp", the build is too
  old; use the latest stable, or Chrome Dev/Canary.
- Confirm the version at `chrome://version/` before anything else.

## Fastest check: the DevTools console (no extension needed)

The Model Context Tool Inspector extension is a nicer UI, but the definitive
check needs only the browser console. On any page that registered tools, open
DevTools (F12) and run:

```js
(async () => {
  if (!('modelContext' in document)) {
    console.log('WebMCP is NOT enabled in this Chrome. Check the version (149+) and the flag.');
    return;
  }
  const tools = await document.modelContext.getTools();
  console.log('Registered tools:', tools.map(t => ({ name: t.name, description: t.description })));
  if (tools.length) {
    const result = await document.modelContext.executeTool(tools[0], { text: 'from-webmcp' });
    console.log('executeTool(first) result:', result);
  }
})();
```

`'modelContext' in document` false means WebMCP is not active in this browser
(a version or flag problem, not a page problem). A non-empty `getTools()` on a
Hypernormal face means the same-origin bridge works. `executeTool` running the
first tool proves an agent can drive the app.

## Full check with the extension

## Verification Steps

### 1. Enable the WebMCP Chrome Flag

1. Open Chrome and navigate to `chrome://flags/#enable-webmcp-testing`
2. Find the flag labeled "Enable WebMCP testing" (or similar)
3. Change its setting from "Default" to "Enabled"
4. Click the "Relaunch" button to restart Chrome with the flag enabled

### 2. Serve the Proof Page Locally

From the root directory of this repository, serve the `examples/` directory using one of these methods:

**Option A: Using npx serve (if Node.js/npm is installed)**
```bash
npx serve examples
```

This will start a local server and display a URL like `http://localhost:3000` or similar.

**Option B: Using Python's built-in server**
```bash
python3 -m http.server 8000
```

Then navigate to `http://localhost:8000/webmcp-proof.html`

### 3. Install the Model Context Tool Inspector Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Search for "Model Context Tool Inspector" on the Chrome Web Store
3. Install the extension
4. The extension icon should appear in your Chrome toolbar

### 4. Verify the Proof Page

1. In your browser, navigate to the served proof page:
   - If using `npx serve`: `http://localhost:3000/webmcp-proof.html`
   - If using Python: `http://localhost:8000/webmcp-proof.html`

2. Observe the page content:
   - **Success**: The page displays "tools: echo registered"
   - **Failure**: The page displays "document.modelContext is absent. Enable chrome://flags/#enable-webmcp-testing and relaunch."

3. Open the Model Context Tool Inspector extension
4. Confirm that the "echo" tool is visible in the inspector
5. Attempt to execute the echo tool with a test input (e.g., `{"text": "hello"}`)
6. Verify that the tool returns the input text unchanged

## Recording Results

Record your verification results in the Log section below, including:
- Chrome version (find this at `chrome://version/`)
- Whether the page displayed "tools: echo registered"
- Whether the echo tool appeared in the Model Context Tool Inspector
- Whether executing the echo tool with test input returned the expected result
- Any errors or unexpected behavior observed

## Log

### 2026-08-27 — WebMCP tool registration confirmed in Chrome

Verified against a live installation (`wrangler dev` at `localhost:8787`), not
the static proof page. The shared-list example was minted, its face registered
at `/f/shared-list`, and opened in a WebMCP-enabled Chrome at
`/f/shared-list?app=/a/<id>`.

- The face rendered live state (items added in the browser appeared
  immediately), confirming the WebSocket broadcast layer end to end.
- In the DevTools console, `await document.modelContext.getTools()` returned
  `['add', 'remove', 'toggle']` — exactly the charter's three `public` verbs.
- The charter's fourth verb, `clear` (`access: owner`), was correctly **absent**
  from the registered tools, confirming the public-only filter in
  `toolsFromCharter`.

This confirms the registration half of the Operate door: an app's public verbs
register as WebMCP tools on the installation's origin, through the real
`document.modelContext` API, with owner-only verbs excluded.

**Execution confirmed too.** `document.modelContext.executeTool(addTool, input)`
was run from the console (input passed as a JSON string, which is the format
Chrome's manual `executeTool` entry point parses; a real agent's structured
arguments are parsed by Chrome the same way before our `execute` callback
receives them, so the runtime handles both). The tool call ran the `add` verb in
the sandbox, wrote state atomically, and returned the MCP result envelope:

```
{"content":[{"type":"text","text":"{\"id\":\"...\",\"text\":\"added via WebMCP tool\",\"done\":false}"}]}
```

The new item appeared in the live face immediately, confirming the full loop:
WebMCP tool call -> runtime -> Worker -> verb execution -> atomic state write ->
WebSocket broadcast -> re-render. This is the complete Operate door working end
to end in a real WebMCP-enabled Chrome.

One implementation note for a future refinement: Chrome's manual `executeTool`
wants the input as a JSON string. Our projected `inputSchema` could add
`additionalProperties: false` at projection time so an agent that sends an extra
field gets a schema-level rejection rather than a hard parse error; deferred, not
blocking.

Chrome version: (record from `chrome://version/`).
