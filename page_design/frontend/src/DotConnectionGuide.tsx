import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Spin } from 'antd';
import { disconnectHostedDot, dotTaskSetup } from './assistantApi';
import type { DotTaskSetup } from './assistantApi';
import { describeError } from './errors.mjs';

const RECHECK_MS = 3000;
const DOT_SUBSCRIPTION_PROMPT = '请使用我安装的 Somnus 插件订阅 task.created 事件，使用 webhook 接收任务。每次收到事件后，用事件的 task_id 调用 read_task，按返回的文字要求处理，再用同一个 task_id 和结果调用 submit_result。请确认订阅是否成功。';
const DOT_TEST_PROMPT = '这是一条连通性测试。请只返回 SOMNUS-DOT-OK。';

function chatGptInstallUrl(value?: string) {
  try {
    const url = new URL(value || '');
    if (url.origin === 'https://chatgpt.com' && !url.username && !url.password) return url.href;
  } catch { /* hosted setup has no published plugin yet */ }
  return '';
}

function httpsOrigin(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/') return url.origin;
  } catch { /* wait for a complete address */ }
}

export function DotConnectionGuide({ onClose }: { onClose: () => void }) {
  const [setup, setSetup] = useState<DotTaskSetup>();
  const [checkingError, setCheckingError] = useState('');
  const [preparingError, setPreparingError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [externalAddress, setExternalAddress] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [pairing, setPairing] = useState<Pick<DotTaskSetup, 'pairing_code' | 'expires_at'>>();
  const prepareRequest = useRef<AbortController>();

  useEffect(() => () => prepareRequest.current?.abort(), []);
  useEffect(() => {
    if (preparing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        const current = await dotTaskSetup(controller.signal);
        if (controller.signal.aborted) return;
        setSetup(current);
        setCheckingError('');
      } catch (error) {
        if (controller.signal.aborted) return;
        setSetup(current => current && { ...current, ready: false });
        setCheckingError(describeError(error, '暂时无法检查 dot 连接。'));
      }
      timer = setTimeout(() => void update(), RECHECK_MS);
    }
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [preparing]);

  async function prepare(operation: 'connect' | 'disconnect' = 'connect') {
    if (prepareRequest.current) return;
    const controller = new AbortController();
    prepareRequest.current = controller;
    setPreparing(true);
    setPreparingError('');
    try {
      const current = operation === 'disconnect' ? await disconnectHostedDot() : await dotTaskSetup(controller.signal, true);
      if (!controller.signal.aborted) {
        setSetup(current);
        setCheckingError('');
        setPairing(current.pairing_code ? { pairing_code: current.pairing_code, expires_at: current.expires_at } : undefined);
      }
    } catch (error) {
      if (!controller.signal.aborted) setPreparingError(describeError(error, operation === 'disconnect' ? '未能断开 dot 连接。' : '未能准备 dot 连接。'));
    } finally {
      prepareRequest.current = undefined;
      if (!controller.signal.aborted) setPreparing(false);
    }
  }

  const origin = httpsOrigin(externalAddress);
  const path = setup?.secret_path ? '/mcp/' + setup.secret_path : '';
  const endpoint = origin && path ? origin + path : '';
  const localBase = setup?.port ? 'http://127.0.0.1:' + setup.port : '';
  const localTarget = localBase && path ? localBase + path : '';
  const quickTunnel = 'cloudflared tunnel --url ' + localBase;
  const ready = Boolean(setup?.enabled && setup.ready && !setup.paused && !checkingError);
  const hosted = setup?.mode === 'hosted';
  const installUrl = chatGptInstallUrl(setup?.install_url);
  const activePair = setup?.pairing_code ? setup : pairing;
  const expiry = typeof activePair?.expires_at === 'number' ?
    (activePair.expires_at < 1e12 ? activePair.expires_at * 1000 : activePair.expires_at) : Date.parse(activePair?.expires_at || '');
  const code = !setup?.paired && (!Number.isFinite(expiry) || expiry > Date.now()) ? activePair?.pairing_code : undefined;
  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(label + '已复制');
    } catch {
      setCopyStatus('复制失败，请手动选中文字复制。');
    }
  }

  return <Modal title={hosted ? '托管 dot 配对测试' : 'dot 个人接入教程'} open onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    <div className="plugin-connection-guide">
      <p>这是 Windows 桌面版的可选个人接入。你的 ChatGPT 账号需要能使用 dot，并允许添加自定义 MCP。</p>
      {checkingError && <Alert type="warning" message={checkingError} showIcon />}
      {hosted && setup.error && <Alert type="warning" message={setup.error} showIcon />}
      {preparingError && <Alert type="error" message={preparingError} showIcon />}
      {hosted ? <>
        {!setup.paired && !installUrl && <Alert type="warning" showIcon message="ChatGPT 插件尚未发布"
          description="插件发布后，可打开安装页面完成个人配对。" />}
        {!setup.paired && !code && (installUrl || setup.local_dev) && <div className="plugin-connection-start">
          <Button type="primary" loading={preparing} onClick={() => void prepare()}>获取配对码</Button>
        </div>}
        {code && <div className="plugin-connection-copy">
          <Input readOnly value={code} aria-label="dot 配对码" onFocus={event => event.target.select()} />
          <Button onClick={() => void copyValue(code, '配对码')}>复制配对码</Button>
        </div>}
        {!ready && <ol>
          {!setup.paired && installUrl && <li>
            <strong>安装 ChatGPT 插件</strong>
            <p><a href={installUrl} target="_blank" rel="noopener noreferrer">打开 ChatGPT 安装页面</a>，然后在插件登录页面输入上方配对码。</p>
          </li>}
          <li>
            <strong>让 dot 订阅任务</strong>
            <p>请 dot 使用 Somnus 插件订阅 <code>task.created</code>，收到任务后用 <code>read_task</code> 读取，再用 <code>submit_result</code> 返回结果。</p>
          </li>
        </ol>}
        {copyStatus && <small role="status">{copyStatus}</small>}
        <Alert type={ready ? 'success' : 'info'} showIcon
          message={setup.paused ? 'dot 已停用。可在个人插件中重新启用。' :
            ready ? '已订阅，可在会话发送对象中选择 dot。' : setup.paired ? '已配对，等待 dot 确认订阅' : '等待个人配对'} />
        {(setup.paired || setup.error && (setup.enabled || setup.paused)) && <Popconfirm title="断开这台电脑的 dot 配对？" okText="断开" cancelText="取消"
          onConfirm={() => prepare('disconnect')}>
          <Button type="link" loading={preparing}>断开配对</Button>
        </Popconfirm>}
      </> : !setup?.enabled || !localTarget ? <div className="plugin-connection-start">
        {setup && <Button type="primary" loading={preparing} onClick={() => void prepare()}>准备本机连接</Button>}
        {!setup && !checkingError && <Spin size="small" />}
      </div> : <>
        <ol>
          <li>
            <strong>连接这台电脑的专用 MCP</strong>
            <p>已有 HTTPS 转发服务时，将专用 MCP 路径转发到以下本机地址。仅使用这个 MCP 专用端口。使用 dot 期间请保持 Somnus 和转发服务运行。完整 MCP 地址含访问凭据，请勿分享。</p>
            <code className="plugin-connection-target">{localTarget}</code>
            <p>临时测试可先自行安装 <code>cloudflared</code>，然后在 Windows PowerShell 中运行以下命令。</p>
            <div className="plugin-connection-copy">
              <code className="plugin-connection-target">{quickTunnel}</code>
              <Button onClick={() => void copyValue(quickTunnel, '命令')}>复制命令</Button>
            </div>
            <p>保持该窗口运行。把终端生成的 <code>https://….trycloudflare.com</code> 填到下方。每次重启 Quick Tunnel 都会生成新地址，需要更新 ChatGPT 插件。</p>
            <label htmlFor="dot-external-address">对外 HTTPS 基础地址</label>
            <Input id="dot-external-address" placeholder="https://你的域名" value={externalAddress}
              status={externalAddress.trim() && !origin ? 'error' : undefined}
              onChange={event => { setExternalAddress(event.target.value); setCopyStatus(''); }} />
            {externalAddress.trim() && !origin && <small>请输入 HTTPS 域名，可包含端口。</small>}
            {endpoint && <div className="plugin-connection-copy">
              <Input readOnly value={endpoint} aria-label="dot MCP 地址" onFocus={event => event.target.select()} />
              <Button onClick={() => void copyValue(endpoint, '地址')}>复制地址</Button>
            </div>}
            {copyStatus && <small role="status">{copyStatus}</small>}
          </li>
          <li>
            <strong>在 ChatGPT 添加自定义 MCP</strong>
            <p>打开 <a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">ChatGPT 插件</a>，点「＋」添加自定义 MCP。连接方式选服务器 URL，粘贴上方生成的完整 MCP 地址。身份验证选「无身份验证」。</p>
            <p>地址变更后，更新原插件的 MCP 地址。没有编辑入口时，可用新地址重新添加插件。</p>
          </li>
          <li>
            <strong>让 dot 订阅任务</strong>
            <p>把下面这段话发给 ChatGPT 里的 Your dot。</p>
            <div className="plugin-connection-copy">
              <code className="plugin-connection-target">{DOT_SUBSCRIPTION_PROMPT}</code>
              <Button onClick={() => void copyValue(DOT_SUBSCRIPTION_PROMPT, '订阅指令')}>复制订阅指令</Button>
            </div>
            <p>如果 dot 提示已有活动订阅，请在原来的 dot 中取消旧订阅，再让当前 dot 订阅。</p>
          </li>
          <li>
            <strong>用一条测试消息验证</strong>
            <p>订阅后，回到 Somnus 会话，将发送对象切到 dot，发出以下文字。收到 <code>SOMNUS-DOT-OK</code> 才算任务往返成功。</p>
            <div className="plugin-connection-copy">
              <code className="plugin-connection-target">{DOT_TEST_PROMPT}</code>
              <Button onClick={() => void copyValue(DOT_TEST_PROMPT, '测试文字')}>复制测试文字</Button>
            </div>
          </li>
        </ol>
        <details className="plugin-connection-alternative">
          <summary>可选方案 · OpenAI Secure MCP Tunnel</summary>
          <p>官方文档提供 ChatGPT 自定义 MCP 的隧道接入步骤，Somnus 的 dot 订阅和任务往返尚未通过此方案验证。</p>
          <ol>
            <li>在 <a href="https://platform.openai.com/settings/organization/tunnels" target="_blank" rel="noopener noreferrer">OpenAI Platform 隧道设置</a> 创建隧道，取得 <code>tunnel_id</code> 和运行时 API 密钥。创建需要 Tunnels Read + Manage，运行和选择隧道需要 Tunnels Read + Use。还需要关联目标 ChatGPT 工作区并获得自定义 MCP 权限。ChatGPT Pro 订阅本身无法授予这些权限。</li>
            <li>按照官方文档运行 <code>tunnel-client</code>。在本机为客户端提供运行时密钥，将 HTTP MCP 目标设为上方完整的本机专用地址，并保持客户端运行。</li>
            <li>在 ChatGPT 的自定义 MCP 表单中选择「Tunnel」，选择隧道或输入 <code>tunnel_id</code>。创建后按上面的方式订阅并发送测试文字。</li>
          </ol>
          <a href="https://developers.openai.com/api/docs/guides/secure-mcp-tunnels" target="_blank" rel="noopener noreferrer">OpenAI Secure MCP Tunnel 官方指南</a>
        </details>
        <Alert type={ready ? 'success' : 'info'} showIcon
          message={setup.paused ? 'dot 已停用。可在个人插件中重新启用。' :
            ready ? '已订阅，可在会话发送对象中选择 dot。' : '等待 dot 确认订阅'}
          description="连接状态反映本机订阅状态。公网 HTTPS 是否可达取决于转发服务。" />
      </>}
    </div>
  </Modal>;
}
