const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const AUTH_ORIGIN = 'https://platform.deepseek.com';
const AUTH_PATH = '/dsh/authorize';
const PENDING_PHASES = new Set(['initializing', 'waiting-browser', 'exchanging', 'committing']);

function accountState(view) {
  if (view?.status !== 'signed-out' && view?.status !== 'credential-stored') {
    throw new Error('无法读取 DeepSeek 账号状态。');
  }
  if (PENDING_PHASES.has(view.attempt?.phase)) return { state: 'pending' };
  if (view.status === 'credential-stored') return { state: 'signed-in' };
  if (view.attempt?.phase === 'expired') return { state: 'failed', message: '授权已过期，请重新登录。' };
  if (view.attempt?.phase === 'failed') return { state: 'failed', message: 'DeepSeek 登录失败，请重试。' };
  return { state: 'signed-out' };
}

function authorizationUrl(target) {
  if (typeof target !== 'string' || target.length > 4096 || /[\x00-\x20\x7f]/.test(target)) return null;
  const url = URL.parse(target);
  return url?.origin === AUTH_ORIGIN && url.pathname === AUTH_PATH && !url.username && !url.password && !url.hash
    ? url : null;
}

class DshAccount {
  constructor(fetcher = globalThis.fetch) {
    this.fetch = fetcher;
  }

  async credentials(server) {
    if (!server.accountCookie) {
      server.accountCookie = (async () => {
        const url = new URL(await server.ready);
        const response = await this.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        const header = response.headers.get('set-cookie');
        const cookie = /^dsh-auth-[A-Za-z0-9_-]+=[A-Za-z0-9_.-]+(?=;|$)/.exec(header || '')?.[0];
        if (response.status !== 303 || !cookie) throw new Error('托管 DSH 账号服务未就绪。');
        return { origin: url.origin, cookie };
      })().catch(error => {
        delete server.accountCookie;
        throw error;
      });
    }
    return server.accountCookie;
  }

  async request(server, method, args = {}, signal = AbortSignal.timeout(5000)) {
    const { origin, cookie } = await this.credentials(server);
    const rpcId = randomUUID();
    const response = await this.fetch(origin + '/api/' + method, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    });
    if (!response.ok) throw new Error('托管 DSH 账号服务暂不可用。');
    const result = await response.json();
    if (result?.rpcId !== rpcId || result?.result?.ok !== true) {
      const error = new Error('托管 DSH 未能完成请求。');
      if (result?.rpcId === rpcId && typeof result.result?.error?.code === 'string') {
        error.code = result.result.error.code;
      }
      throw error;
    }
    return result.result.value;
  }

  async signIn(server, version, validateSender, launchBrowser) {
    const { origin } = await this.credentials(server);
    validateSender();
    let view = await this.request(server, 'account/startSignIn', {
      client: { version, locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 },
      callbackOrigin: origin, loginSource: 'desktop',
    });
    const deadline = Date.now() + 12_000;
    while (view?.attempt?.phase === 'initializing' && Date.now() < deadline) {
      await delay(250);
      validateSender();
      view = await this.request(server, 'account/getState');
    }
    if (view?.attempt?.phase === 'initializing') {
      return { state: 'failed', message: 'DeepSeek 登录响应超时，请重新点击登录。' };
    }
    if (view?.attempt?.phase === 'waiting-browser') {
      const url = authorizationUrl(view.attempt.authorizeUrl);
      if (!url) throw new Error('DeepSeek 返回的登录地址无效。');
      validateSender();
      await launchBrowser(url.href);
    }
    return accountState(view);
  }
}

module.exports = { DshAccount, accountState };
