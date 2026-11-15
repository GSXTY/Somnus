const { request } = require('node:http');
const { createInterface } = require('node:readline');

const endpoint = process.env.VVMAN_MCP_URL || '';
const capability = process.env.VVMAN_MCP_CAPABILITY || '';
if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/.test(endpoint) || !/^[a-f0-9]{64}$/.test(capability)) process.exit(1);

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const outstanding = new Set();
let version;
input.on('close', () => {
  for (const connection of outstanding) connection.destroy();
});
input.on('line', line => {
  if (line.length > 128 * 1024 || outstanding.size >= 24) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const headers = {
    Authorization: 'Bearer ' + capability,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(line),
    ...(version ? { 'MCP-Protocol-Version': version } : {}),
  };
  const replyError = () => {
    if (message && Object.hasOwn(message, 'id')) process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'Somnus tool transport unavailable' },
    }) + '\n');
  };
  const connection = request(endpoint, { method: 'POST', agent: false, headers, signal: AbortSignal.timeout(12 * 60_000) }, response => {
    if (response.statusCode === 202) {
      response.resume();
      return;
    }
    if (response.statusCode !== 200) {
      response.resume();
      replyError();
      return;
    }
    let output = '';
    response.setEncoding('utf8');
    response.on('data', chunk => {
      output += chunk;
      if (output.length > 4 * 1024 * 1024) connection.destroy(Error('Oversize MCP reply'));
    });
    response.on('error', () => {});
    response.on('end', () => {
      try {
        const result = JSON.parse(output);
        if (message.method === 'initialize') version = result.result?.protocolVersion;
        process.stdout.write(JSON.stringify(result) + '\n');
      } catch { replyError(); }
    });
  });
  outstanding.add(connection);
  connection.once('close', () => outstanding.delete(connection));
  connection.once('error', replyError);
  connection.end(line);
});
