const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTPS agent that ignores self-signed cert / corporate cert errors in dev
const rejectUnauthorized = process.env.REJECT_UNAUTHORIZED === 'true';
const agent = new https.Agent({ rejectUnauthorized });

// In-memory data store for OAuth (Reset on restart)
const authCodes = new Map(); // code -> client_id, redirect_uri, verifier, expires
const accessTokens = new Set(); // token string
const refreshTokens = new Map(); // refresh_token -> client_id

// Helper: Generate a simple random token
function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// -------------------------------------------------------------
// 1. Landing Page (Aesthetic Dark Theme)
// -------------------------------------------------------------
app.get('/', (req, res) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MCP OAuth Gateway</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-dark: #0b0f19;
          --panel-bg: rgba(17, 24, 39, 0.7);
          --accent-primary: #8b5cf6;
          --accent-secondary: #ec4899;
          --text-main: #f3f4f6;
          --text-muted: #9ca3af;
          --glow-color: rgba(139, 92, 246, 0.4);
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: 'Outfit', sans-serif;
          background: radial-gradient(circle at 50% 50%, #1e1b4b, var(--bg-dark));
          color: var(--text-main);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          overflow-x: hidden;
        }

        .container {
          max-width: 800px;
          width: 100%;
          background: var(--panel-bg);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 3rem;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 40px var(--glow-color);
          position: relative;
          z-index: 1;
        }

        .container::before {
          content: '';
          position: absolute;
          top: -2px; left: -2px; right: -2px; bottom: -2px;
          background: linear-gradient(45deg, var(--accent-primary), var(--accent-secondary));
          border-radius: 26px;
          z-index: -1;
          opacity: 0.15;
        }

        h1 {
          font-size: 2.5rem;
          font-weight: 800;
          text-align: center;
          background: linear-gradient(135deg, #a78bfa, #f472b6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 0.5rem;
        }

        .status {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: rgba(16, 185, 129, 0.2);
          border: 1px solid rgb(16, 185, 129);
          color: #34d399;
          font-size: 0.85rem;
          border-radius: 12px;
          margin-bottom: 2rem;
        }

        .intro {
          text-align: center;
          color: var(--text-muted);
          margin-bottom: 2.5rem;
          line-height: 1.6;
        }

        h2 {
          font-size: 1.25rem;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
          border-left: 4px solid var(--accent-primary);
          padding-left: 0.75rem;
          color: #e5e7eb;
        }

        ul {
          list-style: none;
          margin-bottom: 1.5rem;
        }

        li {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 1rem;
          margin-bottom: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .endpoint-name {
          font-family: 'JetBrains Mono', monospace;
          color: #f472b6;
          font-weight: bold;
          font-size: 0.95rem;
        }

        .endpoint-desc {
          color: var(--text-muted);
          font-size: 0.9rem;
        }

        .endpoint-url {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.85rem;
          background: #000;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          width: fit-content;
          color: #38bdf8;
          margin-top: 0.5rem;
        }

        footer {
          margin-top: 2rem;
          color: var(--text-muted);
          font-size: 0.85rem;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div style="text-align: center;">
          <h1>MCP OAuth Gateway</h1>
          <span class="status">● Active & Secure</span>
        </div>
        <p class="intro">
          This service wraps the Model Context Protocol (MCP) server for <strong>app-item-nof-mcp-dev</strong> with a secure OAuth 2.0 / 2.1 authentication protocol. Connect your Claude Enterprise or ChatGPT connectors using the endpoints below.
        </p>

        <h2>OAuth Endpoints</h2>
        <ul>
          <li>
            <span class="endpoint-name">Authorize Endpoint</span>
            <span class="endpoint-desc">Redirect your client flow here to authenticate.</span>
            <span class="endpoint-url">\${baseUrl}/oauth/authorize</span>
          </li>
          <li>
            <span class="endpoint-name">Token Endpoint</span>
            <span class="endpoint-desc">Exchange authorization codes for bearer tokens.</span>
            <span class="endpoint-url">\${baseUrl}/oauth/token</span>
          </li>
        </ul>

        <h2>MCP Transports & Integrations</h2>
        <ul>
          <li>
            <span class="endpoint-name">Server-Sent Events (SSE) Endpoint (Claude Desktop)</span>
            <span class="endpoint-desc">Compliant MCP SSE stream connection.</span>
            <span class="endpoint-url">\${baseUrl}/mcp/sse</span>
          </li>
          <li>
            <span class="endpoint-name">HTTP POST Endpoint (General / Message Client)</span>
            <span class="endpoint-desc">Universal JSON-RPC over HTTP POST proxy endpoint or SSE messaging.</span>
            <span class="endpoint-url">\${baseUrl}/mcp</span>
          </li>
          <li>
            <span class="endpoint-name">OpenAPI Definition (ChatGPT Custom Actions)</span>
            <span class="endpoint-desc">Dynamically generated OpenAPI 3.0 schema mapping MCP tools to REST endpoints.</span>
            <span class="endpoint-url">\${baseUrl}/openapi.json</span>
          </li>
        </ul>
      </div>
      <footer>
        &copy; 2026 Model Context Protocol Bridge.
      </footer>
    </body>
    </html>
  `);
});

// -------------------------------------------------------------
// 2. OAuth 2.0 Authorization Endpoint (Consent Page)
// -------------------------------------------------------------
app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, state, response_type, code_challenge, code_challenge_method } = req.query;

  if (!redirect_uri) {
    return res.status(400).send('Missing redirect_uri parameter');
  }

  // Display a premium approval window to the user
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Authorize App - MCP Gateway</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-dark: #0b0f19;
          --panel-bg: rgba(17, 24, 39, 0.7);
          --accent-primary: #8b5cf6;
          --accent-secondary: #ec4899;
          --text-main: #f3f4f6;
          --text-muted: #9ca3af;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'Outfit', sans-serif;
          background: radial-gradient(circle at 50% 50%, #1e1b4b, var(--bg-dark));
          color: var(--text-main);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
        }

        .card {
          max-width: 500px;
          width: 100%;
          background: var(--panel-bg);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 2.5rem;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
          text-align: center;
        }

        .avatar {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          border-radius: 16px;
          margin: 0 auto 1.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.8rem;
          font-weight: 800;
          color: #fff;
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.5);
        }

        h1 {
          font-size: 1.75rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
          color: #fff;
        }

        .subtitle {
          color: var(--text-muted);
          font-size: 0.95rem;
          margin-bottom: 2rem;
        }

        .permissions {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 1.25rem;
          text-align: left;
          margin-bottom: 2rem;
        }

        .permissions p {
          font-weight: 600;
          font-size: 0.9rem;
          color: #e5e7eb;
          margin-bottom: 0.5rem;
        }

        .permissions ul {
          list-style: none;
        }

        .permissions li {
          font-size: 0.85rem;
          color: var(--text-muted);
          padding-left: 1.25rem;
          position: relative;
          margin-bottom: 0.4rem;
        }

        .permissions li::before {
          content: '✓';
          position: absolute;
          left: 0;
          color: #10b981;
          font-weight: bold;
        }

        .btn {
          display: block;
          width: 100%;
          padding: 0.9rem;
          border-radius: 12px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          border: none;
          text-decoration: none;
          margin-bottom: 0.75rem;
        }

        .btn-approve {
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          color: #fff;
          box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);
        }

        .btn-approve:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(139, 92, 246, 0.6);
        }

        .btn-deny {
          background: rgba(255, 255, 255, 0.05);
          color: #d1d5db;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .btn-deny:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="avatar">M</div>
        <h1>App Connection Request</h1>
        <p class="subtitle">An AI Assistant wants to access tools on your behalf.</p>

        <div class="permissions">
          <p>This will allow the connector to:</p>
          <ul>
            <li>Access Model Context Protocol (MCP) tools</li>
            <li>Perform item searches and status retrieval</li>
            <li>Run actions on <strong>app-item-nof-mcp-dev</strong></li>
          </ul>
        </div>

        <form action="/oauth/approve" method="POST">
          <input type="hidden" name="client_id" value="${client_id || ''}">
          <input type="hidden" name="redirect_uri" value="${redirect_uri}">
          <input type="hidden" name="state" value="${state || ''}">
          <input type="hidden" name="code_challenge" value="${code_challenge || ''}">
          <input type="hidden" name="code_challenge_method" value="${code_challenge_method || ''}">
          
          <button type="submit" class="btn btn-approve">Authorize Access</button>
          <a href="${redirect_uri}?error=access_denied&state=${state || ''}" class="btn btn-deny">Cancel</a>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Approve OAuth Action
app.post('/oauth/approve', (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.body;

  if (!redirect_uri) {
    return res.status(400).send('Missing redirect_uri');
  }

  // Create a code and register it
  const code = generateRandomString(16);
  authCodes.set(code, {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    expires: Date.now() + 10 * 60 * 1000 // 10 min expiry
  });

  // Redirect back to client with code
  const url = new URL(redirect_uri);
  url.searchParams.append('code', code);
  if (state) {
    url.searchParams.append('state', state);
  }

  res.redirect(url.toString());
});

// Helper: Verify PKCE code_verifier
function verifyCodeVerifier(authData, codeVerifier) {
  if (!authData.code_challenge) {
    return true;
  }
  if (!codeVerifier) {
    return false;
  }
  if (authData.code_challenge_method === 'S256') {
    const hashed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return hashed === authData.code_challenge;
  }
  return codeVerifier === authData.code_challenge;
}

// -------------------------------------------------------------
// 3. OAuth 2.0 Token Endpoint
// -------------------------------------------------------------
app.post('/oauth/token', (req, res) => {
  const { grant_type, code, redirect_uri, client_id, client_secret, refresh_token, code_verifier } = req.body;

  // Handle client credentials grant (used by some automated APIs)
  if (grant_type === 'client_credentials') {
    if (client_id === process.env.OAUTH_CLIENT_ID && client_secret === process.env.OAUTH_CLIENT_SECRET) {
      const access_token = 'mcp-bearer-' + generateRandomString(32);
      accessTokens.add(access_token);

      return res.json({
        access_token,
        token_type: 'Bearer',
        expires_in: 3600
      });
    }
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Handle Authorization Code Grant
  if (grant_type === 'authorization_code') {
    if (!code) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing code' });
    }

    const authData = authCodes.get(code);
    if (!authData || authData.expires < Date.now()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Code invalid or expired' });
    }

    // Verify redirect_uri matches
    if (authData.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' });
    }

    // Verify PKCE code verifier
    if (!verifyCodeVerifier(authData, code_verifier)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }

    // Clean up used code
    authCodes.delete(code);

    const access_token = 'mcp-bearer-' + generateRandomString(32);
    const new_refresh_token = 'mcp-refresh-' + generateRandomString(32);

    accessTokens.add(access_token);
    refreshTokens.set(new_refresh_token, authData.client_id || client_id);

    return res.json({
      access_token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: new_refresh_token
    });
  }

  // Handle Refresh Token Grant
  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing refresh_token' });
    }

    const client = refreshTokens.get(refresh_token);
    if (!client) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token invalid' });
    }

    const access_token = 'mcp-bearer-' + generateRandomString(32);
    accessTokens.add(access_token);

    return res.json({
      access_token,
      token_type: 'Bearer',
      expires_in: 3600
    });
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
});

// -------------------------------------------------------------
// 4. MCP Proxy Endpoint (Post to Downstream with LTPA Token)
// -------------------------------------------------------------
const DOWNSTREAM_URL = process.env.DOWNSTREAM_MCP_URL;
const LTPA_TOKEN = process.env.LTPA_TOKEN;

// Helper: Parse SSE-formatted downstream string responses or raw JSON
function parseDownstreamResponse(data) {
  if (!data) return {};
  if (typeof data === 'object') {
    return data;
  }
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('event:')) {
      // Find the data: line and parse the JSON payload
      const lines = trimmed.split('\n');
      const dataLine = lines.find(line => line.startsWith('data: '));
      if (dataLine) {
        try {
          return JSON.parse(dataLine.substring(6).trim());
        } catch (e) {
          // Return as raw string if JSON parsing fails
          return dataLine.substring(6).trim();
        }
      }
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return trimmed;
    }
  }
  return data;
}

const GATEWAY_TOOLS = [
  {
    name: 'track_orders',
    description: 'Track status and details of a customer order.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'The unique order identifier (e.g. ORD-12345)'
        }
      },
      required: ['orderId']
    }
  },
  {
    name: 'track_deliveries',
    description: 'Track the real-time shipping/delivery status and checkpoint details.',
    inputSchema: {
      type: 'object',
      properties: {
        trackingNumber: {
          type: 'string',
          description: 'The carrier tracking number (e.g. 123456789012)'
        }
      },
      required: ['trackingNumber']
    }
  }
];

function isGatewayTool(name) {
  return name === 'track_orders' || name === 'track_deliveries';
}

function handleGatewayToolCall(name, args) {
  const cleanArgs = args || {};
  
  if (name === 'track_orders') {
    const orderId = String(cleanArgs.orderId || 'ORD-12345');
    const lowerId = orderId.toLowerCase();

    // 1. Misplaced case
    if (lowerId.includes('lost') || lowerId.includes('misplaced') || lowerId.includes('333')) {
      return {
        orderId: orderId,
        status: 'Misplaced',
        estimatedDelivery: 'Unknown',
        items: [
          { itemId: '345673', name: 'Classic Crewneck Sweater', quantity: 1, price: 49.99 }
        ],
        carrier: 'FedEx',
        trackingNumber: '123456789012',
        alert: 'Investigation opened: Package is currently misplaced. Please contact support if not updated in 24 hours.'
      };
    }

    // 2. Delayed case
    if (lowerId.includes('delay') || lowerId.includes('222')) {
      return {
        orderId: orderId,
        status: 'Delayed',
        originalDelivery: '2026-07-12',
        newDelivery: '2026-07-16',
        items: [
          { itemId: '345673', name: 'Classic Crewneck Sweater', quantity: 1, price: 49.99 }
        ],
        carrier: 'FedEx',
        trackingNumber: '123456789012',
        delayReason: 'Severe weather delay at Memphis Hub.'
      };
    }

    // 3. Default: On Time case
    return {
      orderId: orderId,
      status: 'On Time',
      estimatedDelivery: '2026-07-12',
      items: [
        { itemId: '345673', name: 'Classic Crewneck Sweater', quantity: 1, price: 49.99 }
      ],
      carrier: 'FedEx',
      trackingNumber: '123456789012',
      statusMessage: 'Package is on track and moving through the network.'
    };
  }

  if (name === 'track_deliveries') {
    const trackingNumber = String(cleanArgs.trackingNumber || '123456789012');
    const lowerTrack = trackingNumber.toLowerCase();

    // 1. Misplaced delivery
    if (lowerTrack.includes('lost') || lowerTrack.includes('misplaced') || lowerTrack.includes('333')) {
      return {
        trackingNumber: trackingNumber,
        carrier: 'FedEx',
        status: 'Pending Investigation',
        currentLocation: 'Unknown (Last scanned: Memphis, TN Hub)',
        estimatedDelivery: 'Unknown',
        history: [
          { timestamp: '2026-07-09T14:00:00Z', location: 'System Alert', activity: 'Investigation opened for misplaced package' },
          { timestamp: '2026-07-08T10:00:00Z', location: 'Memphis, TN Hub', activity: 'Arrived at FedEx Location' },
          { timestamp: '2026-07-07T16:30:00Z', location: 'Indianapolis, IN Hub', activity: 'Departed FedEx Location' }
        ]
      };
    }

    // 2. Delayed delivery
    if (lowerTrack.includes('delay') || lowerTrack.includes('222')) {
      return {
        trackingNumber: trackingNumber,
        carrier: 'FedEx',
        status: 'Delayed',
        currentLocation: 'Memphis, TN Hub',
        estimatedDelivery: '2026-07-16',
        delayReason: 'Severe weather delay at Memphis Hub.',
        history: [
          { timestamp: '2026-07-09T08:00:00Z', location: 'Memphis, TN Hub', activity: 'Delayed due to weather conditions' },
          { timestamp: '2026-07-08T10:00:00Z', location: 'Memphis, TN Hub', activity: 'Arrived at FedEx Location' },
          { timestamp: '2026-07-07T16:30:00Z', location: 'Indianapolis, IN Hub', activity: 'Departed FedEx Location' }
        ]
      };
    }

    // 3. Default: On Time delivery
    return {
      trackingNumber: trackingNumber,
      carrier: 'FedEx',
      status: 'In Transit (On Time)',
      currentLocation: 'Memphis, TN Hub',
      estimatedDelivery: '2026-07-12',
      history: [
        { timestamp: '2026-07-08T10:00:00Z', location: 'Memphis, TN Hub', activity: 'Arrived at FedEx Location' },
        { timestamp: '2026-07-07T16:30:00Z', location: 'Indianapolis, IN Hub', activity: 'Departed FedEx Location' }
      ]
    };
  }
  throw new Error(`Unknown gateway tool ${name}`);
}

// Helper: Check authentication header or query parameter
function isAuthenticated(req, res, next) {
  let token;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid authentication token' });
  }

  if (!accessTokens.has(token)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Token is invalid or expired' });
  }

  next();
}

// Proxied JSON-RPC endpoint
app.post('/mcp', isAuthenticated, async (req, res) => {
  try {
    // 1. Intercept tools/list to merge custom tools
    if (req.body && req.body.method === 'tools/list') {
      const response = await axios.post(DOWNSTREAM_URL, req.body, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'LtpaToken': LTPA_TOKEN
        },
        httpsAgent: agent
      });
      const parsedData = parseDownstreamResponse(response.data);
      if (parsedData.result && Array.isArray(parsedData.result.tools)) {
        parsedData.result.tools = [...parsedData.result.tools, ...GATEWAY_TOOLS];
      }
      return res.json(parsedData);
    }

    // 2. Intercept tools/call for custom gateway tools
    if (req.body && req.body.method === 'tools/call' && req.body.params && isGatewayTool(req.body.params.name)) {
      const result = handleGatewayToolCall(req.body.params.name, req.body.params.arguments);
      return res.json({
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        },
        id: req.body.id
      });
    }

    // 3. Fallback: Proxy everything else to downstream
    const response = await axios.post(DOWNSTREAM_URL, req.body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'LtpaToken': LTPA_TOKEN
      },
      httpsAgent: agent
    });

    const parsedData = parseDownstreamResponse(response.data);
    res.json(parsedData);
  } catch (error) {
    console.error('Downstream MCP request failed:', error.message);
    const statusCode = error.response ? error.response.status : 500;
    const errorData = error.response ? error.response.data : { error: 'Internal gateway error forwarding to downstream MCP' };
    res.status(statusCode).json(errorData);
  }
});

// Active SSE connection registry
const sseConnections = new Map();

// Establish SSE Connection for standard MCP Clients (e.g. Claude Desktop)
app.get('/mcp/sse', isAuthenticated, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const connectionId = generateRandomString(16);
  sseConnections.set(connectionId, res);

  // Send the message POST endpoint URL to the client
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  res.write(`event: endpoint\ndata: ${baseUrl}/mcp/message?connection_id=${connectionId}\n\n`);

  req.on('close', () => {
    sseConnections.delete(connectionId);
  });
});

// SSE Message endpoint (receives POST requests from client and routes to downstream)
app.post('/mcp/message', isAuthenticated, async (req, res) => {
  const { connection_id } = req.query;
  const clientResponseStream = sseConnections.get(connection_id);

  if (!clientResponseStream) {
    return res.status(404).send('SSE session not found or closed');
  }

  try {
    // 1. Intercept tools/list to merge custom tools
    if (req.body && req.body.method === 'tools/list') {
      const response = await axios.post(DOWNSTREAM_URL, req.body, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'LtpaToken': LTPA_TOKEN
        },
        httpsAgent: agent
      });
      const parsedData = parseDownstreamResponse(response.data);
      if (parsedData.result && Array.isArray(parsedData.result.tools)) {
        parsedData.result.tools = [...parsedData.result.tools, ...GATEWAY_TOOLS];
      }
      clientResponseStream.write(`event: message\ndata: ${JSON.stringify(parsedData)}\n\n`);
      return res.status(202).send('Accepted');
    }

    // 2. Intercept tools/call for custom gateway tools
    if (req.body && req.body.method === 'tools/call' && req.body.params && isGatewayTool(req.body.params.name)) {
      const result = handleGatewayToolCall(req.body.params.name, req.body.params.arguments);
      clientResponseStream.write(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        },
        id: req.body.id
      })}\n\n`);
      return res.status(202).send('Accepted');
    }

    // 3. Fallback: Proxy everything else to downstream
    const response = await axios.post(DOWNSTREAM_URL, req.body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'LtpaToken': LTPA_TOKEN
      },
      httpsAgent: agent
    });

    const parsedData = parseDownstreamResponse(response.data);
    clientResponseStream.write(`event: message\ndata: ${JSON.stringify(parsedData)}\n\n`);
    res.status(202).send('Accepted');
  } catch (error) {
    console.error('SSE Message forwarding failed:', error.message);
    const statusCode = error.response ? error.response.status : 500;
    const errorData = error.response ? error.response.data : { error: 'Internal gateway error forwarding to downstream MCP' };
    res.status(statusCode).json(errorData);
  }
});

// Support SSE metadata discovery/connections
app.get('/mcp', (req, res) => {
  // If the client performs a discovery GET check on the MCP path, we tell them it's ready.
  res.json({
    name: 'app-item-nof-mcp-dev-gateway',
    version: '1.0.0',
    description: 'OAuth 2.0 Wrapped Gateway for app-item-nof-mcp-dev',
    transport: 'HTTP POST JSON-RPC / SSE'
  });
});

// -------------------------------------------------------------
// 5. Dynamic OpenAPI Generator (For Custom GPT Action)
// -------------------------------------------------------------
app.get('/openapi.json', async (req, res) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;

  try {
    // Fetch tool list from downstream MCP server
    const listResponse = await axios.post(DOWNSTREAM_URL, {
      jsonrpc: '2.0',
      id: 'openapi-list',
      method: 'tools/list',
      params: {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'LtpaToken': LTPA_TOKEN
      },
      httpsAgent: agent
    });

    const parsedData = parseDownstreamResponse(listResponse.data);
    const downstreamTools = parsedData.result?.tools || [];
    const tools = [...downstreamTools, ...GATEWAY_TOOLS];

    // Map each tool to a path in OpenAPI spec
    const paths = {};
    for (const tool of tools) {
      const sanitizedPath = `/api/tools/call/${tool.name}`;
      paths[sanitizedPath] = {
        post: {
          summary: tool.description || `Call tool ${tool.name}`,
          operationId: `call_${tool.name}`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: tool.inputSchema || {
                  type: 'object',
                  properties: {}
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Successful Response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object'
                  }
                }
              }
            }
          },
          security: [
            {
              OAuthProxyAuth: []
            }
          ]
        }
      };
    }

    const openApiSpec = {
      openapi: '3.0.0',
      info: {
        title: 'MCP OAuth Gateway API',
        version: '1.0.0',
        description: 'Dynamically generated OpenAPI spec that bridges Custom GPT Actions to downstream MCP server.'
      },
      servers: [
        {
          url: baseUrl
        }
      ],
      paths,
      components: {
        securitySchemes: {
          OAuthProxyAuth: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: `${baseUrl}/oauth/authorize`,
                tokenUrl: `${baseUrl}/oauth/token`,
                scopes: {}
              }
            }
          }
        }
      }
    };

    res.json(openApiSpec);
  } catch (error) {
    console.error('Failed to generate OpenAPI spec from downstream tools:', error.message);
    res.status(500).json({ error: 'Failed to fetch downstream tools configuration' });
  }
});

// OpenAPI Action endpoint (Translates POST call to MCP JSON-RPC tools/call request)
app.post('/api/tools/call/:toolName', isAuthenticated, async (req, res) => {
  const { toolName } = req.params;
  const toolArgs = req.body;

  try {
    if (isGatewayTool(toolName)) {
      const result = handleGatewayToolCall(toolName, toolArgs);
      return res.json(result);
    }

    const rpcPayload = {
      jsonrpc: '2.0',
      id: `gpt-call-${generateRandomString(8)}`,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs
      }
    };

    const response = await axios.post(DOWNSTREAM_URL, rpcPayload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'LtpaToken': LTPA_TOKEN
      },
      httpsAgent: agent
    });

    const parsedData = parseDownstreamResponse(response.data);

    // Check JSON-RPC response format and extract content
    if (parsedData.error) {
      return res.status(400).json(parsedData.error);
    }

    res.json(parsedData.result || {});
  } catch (error) {
    console.error(`Error translating tool call ${toolName}:`, error.message);
    const statusCode = error.response ? error.response.status : 500;
    const errorData = error.response ? error.response.data : { error: `Internal bridge error calling tool ${toolName}` };
    res.status(statusCode).json(errorData);
  }
});

// -------------------------------------------------------------
// 6. OAuth Metadata Discovery Endpoint
// -------------------------------------------------------------
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;

  res.json({
    issuer: `${baseUrl}/`,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none']
  });
});

app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;

  res.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [
      `${baseUrl}/`
    ]
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`MCP OAuth Proxy is running on port ${PORT}`);
  console.log(`Downstream MCP URL: ${DOWNSTREAM_URL}`);
});
