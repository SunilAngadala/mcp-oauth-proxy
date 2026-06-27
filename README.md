# MCP OAuth Proxy

An OAuth 2.0 / 2.1 Proxy for HTTP Model Context Protocol (MCP) servers. This proxy acts as a secure, authenticated gateway enabling integration between downstream MCP servers and client platforms like **Claude Web (Custom Connectors)**, **Claude Desktop**, and **OpenAI ChatGPT (Custom Actions)**.

---

## Features

- **Standard OAuth 2.0 / 2.1 Flow**:
  - `/oauth/authorize` Authorization endpoint with PKCE validation support and a consent screen.
  - `/oauth/token` token endpoint supporting `authorization_code`, `client_credentials`, and `refresh_token` flows.
  - In-memory session and token storage.
- **SSE Connection Transport**:
  - Compliant `/mcp/sse` and `/mcp/message` stream transport endpoints for standard clients.
  - Dynamically constructs absolute URLs for message endpoints behind proxies.
- **OpenAPI Action Bridge**:
  - Dynamically compiles tools from the downstream MCP server into a standard OpenAPI 3.0 specification via `/openapi.json`.
  - Maps tool-call executions to RESTful endpoints at `/api/tools/call/:toolName`.
- **Robust Downstream Parsing**:
  - Integrates with downstream endpoints using static tokens (e.g. `LtpaToken`).
  - Automatically handles downstream self-signed/corporate certificate authority validation issues (`REJECT_UNAUTHORIZED`).
  - Seamlessly extracts JSON-RPC payloads from downstream SSE-framed strings.

---

## Setup & Local Development

### 1. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory (based on the provided template):
```env
PORT=3000
DOWNSTREAM_MCP_URL=https://<your-downstream-mcp-server-domain>/mcp
LTPA_TOKEN=<your-downstream-authentication-token>
OAUTH_CLIENT_ID=mcp-client-id
OAUTH_CLIENT_SECRET=mcp-client-secret
REJECT_UNAUTHORIZED=false
```

### 3. Start the Server
```bash
npm run dev
```

### 4. Running Integration Tests
Start the server, and in a separate terminal run the HTTP and SSE test suites:
```bash
# Test OAuth flow, REST mapping, and OpenAPI generation
node test-proxy.js

# Test long-lived SSE streaming and message forwarding
node test-sse.js
```

---

## Deployment to Render

1. Create a new **Web Service** on Render connected to your GitHub repository.
2. Select the **Node** environment, set Build Command to `npm install`, and Start Command to `npm start`.
3. Use the **Add from .env** button in the Environment Variables section and paste your local `.env` values.
4. Once deployed, note your service's live URL (e.g. `https://your-service.onrender.com`).

---

## Client Integration Guides

### 1. Claude Web (Custom Connectors)
In your `claude.ai` dashboard under **Connectors** -> **Add Custom Connector**:
- **Name**: `MCP OAuth Proxy`
- **Remote MCP server URL**: `https://mcp-oauth-proxy-m3py.onrender.com/mcp/sse`
- **OAuth Client ID**: `mcp-client-id`
- **OAuth Client Secret**: `mcp-client-secret`
Click **Add**, complete the OAuth consent screen prompt, and Claude will automatically link the downstream tools.

### 2. Claude Desktop (Local Bridge)
1. Request a client credentials token:
   ```bash
   curl -X POST https://mcp-oauth-proxy-m3py.onrender.com/oauth/token \
     -H "Content-Type: application/json" \
     -d '{"grant_type":"client_credentials","client_id":"mcp-client-id","client_secret":"mcp-client-secret"}'
   ```
2. Open your `claude_desktop_config.json`:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
3. Add the server block using the `@modelcontextprotocol/client-cli` stdio-to-SSE bridge:
   ```json
   {
     "mcpServers": {
       "mcp-oauth-proxy": {
         "command": "npx",
         "args": [
           "-y",
           "@modelcontextprotocol/client-cli",
           "https://mcp-oauth-proxy-m3py.onrender.com/mcp/sse?token=YOUR_ACCESS_TOKEN"
         ]
       }
     }
   }
   ```
4. Restart Claude Desktop.

### 3. OpenAI ChatGPT (Custom Actions)
In your Custom GPT configure editor under **Actions**:
1. Click **Import from URL** and paste: `https://mcp-oauth-proxy-m3py.onrender.com/openapi.json`.
2. Under **Authentication**, select **OAuth**:
   - **Client ID**: `mcp-client-id`
   - **Client Secret**: `mcp-client-secret`
   - **Authorization URL**: `https://mcp-oauth-proxy-m3py.onrender.com/oauth/authorize`
   - **Token URL**: `https://mcp-oauth-proxy-m3py.onrender.com/oauth/token`
3. Save the GPT and trigger a tool call to start the OAuth sign-in flow.

---

## Live Demo Custom Tools (Mock Tracking)

For testing and demonstration, the gateway integrates two custom tools (`track_orders` and `track_deliveries`) locally. These tools return dynamic, realistic mock data for your demo from **July 7 to July 20, 2026**.

You can trigger different delivery and order scenarios in Claude or ChatGPT by using key phrases or codes in your query:

### 1. 🟢 On Time (Default)
Returns an "On Time" status with delivery set to **July 12, 2026**.
- **Trigger**: Any standard order number (e.g., `ORD-12345` or general text).

### 2. 🟡 Delayed
Returns a "Delayed" status with the delivery pushed from July 12th to **July 16th** due to weather.
- **Trigger**: Contains the word `delay` or code `222` (e.g., `ORD-delay`, `222`).

### 3. 🔴 Misplaced / Lost
Returns a "Misplaced" status with an "Unknown" delivery date and system alert flags.
- **Trigger**: Contains the word `lost`, `misplaced`, or code `333` (e.g., `ORD-lost`, `333`).