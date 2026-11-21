'use strict';
// Fixed app-owned stdio MCP relay; the external Agent receives only its scoped capability.
const { request } = require('node:http');
const { createInterface } = require('node:readline');
const target = URL.parse(process.env.SOMNUS_PLUGIN_MCP_URL || '');
const token = process.env.SOMNUS_PLUGIN_MCP_TOKEN || '';
if (!target || target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port ||
    target.username || target.password || target.search || target.hash ||
    !/^\/somnus-tools\/[a-f0-9]{32}$/.test(target.pathname) || !/^[a-f0-9]{64}$/.test(token)) process.exit(1);
const active = new Set();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('close', () => { for (const connection of active) connection.destroy(); });
input.on('line', line => {
  if (Buffer.byteLength(line) > 256 * 1024 || active.size >= 16) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const fail = () => { if (Object.hasOwn(message, 'id')) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
    error: { code: -32002, message: 'Somnus plugin tools are unavailable for this turn' } }) + '\n'); };
  const connection = request(target, { method: 'POST', agent: false, signal: AbortSignal.timeout(12 * 60_000),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(line),
      Accept: 'application/json' } }, response => {
    if (response.statusCode === 202) { response.resume(); return; }
    if (response.statusCode !== 200) { response.resume(); fail(); return; }
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 4 * 1024 * 1024) connection.destroy(); });
    response.on('end', () => { try { process.stdout.write(JSON.stringify(JSON.parse(body)) + '\n'); } catch { fail(); } });
    response.on('error', fail);
  });
  active.add(connection);
  connection.once('close', () => active.delete(connection));
  connection.once('error', fail);
  connection.end(line);
});
