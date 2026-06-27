const axios = require('axios');
const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function testSSE() {
  console.log('--- STARTING SSE INTEGRATION TEST ---');
  
  try {
    // 1. Obtain token by simulating OAuth authorization
    console.log('\n[SSE TEST 1] Simulating approval of connection via /oauth/approve POST...');
    const approvalRes = await axios.post(`${BASE_URL}/oauth/approve`, {
      client_id: 'mcp-client-id',
      redirect_uri: 'http://localhost:3000/oauth/callback',
      state: 'sse-state'
    }, {
      maxRedirects: 0,
      validateStatus: (status) => status === 302
    });

    const redirectUrl = new URL(approvalRes.headers.location);
    const code = redirectUrl.searchParams.get('code');
    console.log(`✓ Received Auth Code: ${code}`);

    console.log('\n[SSE TEST 2] Exchanging auth code for access token...');
    const tokenRes = await axios.post(`${BASE_URL}/oauth/token`, {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: 'http://localhost:3000/oauth/callback',
      client_id: 'mcp-client-id'
    });

    const token = tokenRes.data.access_token;
    console.log(`✓ Received Access Token: ${token}`);

    // 2. Establish SSE connection
    console.log('\n[SSE TEST 3] Establishing SSE Connection...');
    
    const req = http.request(`${BASE_URL}/mcp/sse?token=${token}`, {
      method: 'GET'
    }, (res) => {
      console.log(`✓ SSE Response Status: ${res.statusCode}`);
      console.log(`✓ SSE Headers Content-Type:`, res.headers['content-type']);
      
      let buffer = '';
      let messagePostEndpoint = '';
      
      res.on('data', async (chunk) => {
        const dataStr = chunk.toString();
        console.log(`[SSE DATA RECEIVED]:\n${dataStr}`);
        buffer += dataStr;
        
        if (buffer.includes('event: endpoint')) {
          const lines = buffer.split('\n');
          const dataLine = lines.find(l => l.startsWith('data: '));
          if (dataLine) {
            messagePostEndpoint = dataLine.replace('data: ', '').trim();
            console.log(`✓ Parsed client message POST endpoint: ${messagePostEndpoint}`);
            
            // Now send a JSON-RPC message to the parsed POST endpoint
            console.log('\n[SSE TEST 4] Sending JSON-RPC request to POST endpoint...');
            try {
              const postRes = await axios.post(`${BASE_URL}${messagePostEndpoint}`, {
                jsonrpc: '2.0',
                id: 'sse-test-rpc',
                method: 'tools/list',
                params: {}
              }, {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              });
              
              console.log(`✓ POST Message status: ${postRes.status} (${postRes.statusText})`);
            } catch (err) {
              console.log(`✓ POST Message responded:`, err.response ? err.response.status : err.message);
            }
          }
        }
        
        if (buffer.includes('event: message')) {
          console.log('\n[SSE TEST 5] Received response back on SSE event stream!');
          console.log('✓ Success! Closing connection.');
          res.destroy();
          process.exit(0);
        }
      });
    });
    
    req.on('error', (e) => {
      console.error(`Problem with request: ${e.message}`);
      process.exit(1);
    });
    
    req.end();
  } catch (error) {
    console.error('SSE Test failed:', error.message);
    process.exit(1);
  }
}

testSSE();
