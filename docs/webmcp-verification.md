# WebMCP Proof Page Verification

This document describes how to verify that the WebMCP browser API (`document.modelContext.registerTool`) works locally.

## Prerequisites

- Google Chrome browser (Chromium-based, version 130+)
- The `webmcp-proof.html` file in the `examples/` directory
- Access to the Model Context Tool Inspector extension (available on Chrome Web Store)

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

