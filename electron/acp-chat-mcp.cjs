const { createHash } = require('node:crypto');

function mcpAddress(reference) {
  const url = typeof reference === 'string' && reference.length <= 2048 && !/[\\\s\x00-\x1f]/.test(reference)
    ? URL.parse(reference) : null;
  if (url?.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.search || url.hash || url.port === '0') {
    throw new Error('请提供不含凭据、查询参数或片段的 HTTPS MCP 地址。');
  }
  return url;
}

async function installChatMcp(origin, reference, validateSender, progress, fetcher = fetch) {
  const endpoint = mcpAddress(reference).href;
  const base = new URL('/api/mcp/servers', origin).href;
  const request = async (method = 'GET', suffix = '', body) => {
    validateSender();
    const response = await fetcher(base + suffix, {
      method, redirect: 'error', signal: AbortSignal.timeout(method === 'POST' && suffix ? 35_000 : 5000),
      headers: { 'X-Data-Agent-Local': '1', 'Content-Type': 'application/json', Origin: origin },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const list = async () => {
    const { status, data } = await request();
    if (status !== 200 || !Array.isArray(data?.servers) || data.error) throw new Error('无法读取本机 MCP 配置。');
    return data.servers.find(server => server?.transport === 'http' && URL.parse(server.url)?.href === endpoint);
  };
  let server = await list();
  let alreadyInstalled = Boolean(server);
  if (!server) {
    progress('installing');
    const id = 'server-' + createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
    const config = { id, name: new URL(endpoint).hostname, transport: 'http', url: endpoint, enabled: true };
    const { status, data } = await request('POST', '', config);
    if (status === 409) {
      server = await list();
      alreadyInstalled = Boolean(server);
    } else if (status === 200) {
      server = data?.server;
    }
    if (!server || server.id !== id && !alreadyInstalled) throw new Error('无法将 MCP 保存到当前用户配置。');
  }
  const result = { name: server.name, profile: 'mcp', settings: 'mcp', alreadyInstalled };
  if (!server.enabled) return { ...result, verified: false, message: '此现有连接已停用，可在 MCP 设置中开启。' };
  progress('verifying');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(server.id ?? '')) throw new Error('MCP 服务器标识无效。');
  const tested = await request('POST', '/' + encodeURIComponent(server.id) + '/test', {}).catch(() => null);
  validateSender();
  return tested?.status === 200 && tested.data?.server?.status === 'ready'
    ? { ...result, verified: true, message: '下一条 DSH 原生消息可直接调用此 MCP。需要确认的工具会在调用前请你批准。' }
    : { ...result, verified: false, message: '连接已保存在用户配置中。可以在 MCP 设置检查服务是否需要认证。' };
}

module.exports = { installChatMcp, mcpAddress };
