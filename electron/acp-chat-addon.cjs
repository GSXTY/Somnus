const { fetchJson, safePackage } = require('./acp-dsh-community.cjs');
const { installChatSkill, installWorkspaceSkill } = require('./acp-chat-skill.cjs');
const { installChatMcp, mcpAddress } = require('./acp-chat-mcp.cjs');

const REGISTRY = 'https://registry.npmjs.org';
const IM = '@xmanrui/dsh-im';
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;
const INSTALL = /^(?:(?:请|麻烦)\s*)?(?:帮我\s*)?(?:安装|装一下|装上|加装)\s*.+$|^(?:(?:please|help me)\s+)?install\s+.+$|^(?:(?:请|麻烦)\s*)?(?:帮我\s*)?把\s*.+?(?:装上|装一下|安装好)$|^.+?(?:帮我安装|这个安装)$/i;
const NEGATED = /(?:不要|别|不想|无需|不用|不能|取消|禁止)\s*(?:给我|帮我|自动|直接|再|去)?\s*(?:安装|装一下|装上)|\b(?:do not|don't|never)\s+install\b/i;

function alias(reference) {
  const cleaned = reference.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (cleaned === 'dsh im' || cleaned === 'im 机器人') return IM;
  if (cleaned === 'ppt master') return 'https://github.com/hugohe3/ppt-master';
  return reference;
}

function authorize(input) {
  const { kind, reference, request } = input ?? {};
  if (!['plugin', 'skill', 'workspace-skill', 'mcp'].includes(kind) || typeof reference !== 'string' ||
      !reference.trim() || reference.length > 220 || typeof request !== 'string' ||
      request.length > 240 || !INSTALL.test(request.trim().replace(/[。！!]+$/, '')) ||
      NEGATED.test(request) || /[\r\n<>“”"'；;|&]/.test(request) || /^(?:>|\x60)/.test(request)) {
    throw new Error('请在聊天中直接说明要安装的插件、Skill 或 MCP。');
  }
  const canonical = kind === 'workspace-skill' ? reference.trim() : alias(reference.trim());
  const escaped = reference.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const explicitReference = new RegExp(`(?:^|[^a-z0-9._/@-])${escaped}(?=$|[^a-z0-9._/@-])`, 'i');
  const knownAlias = canonical === IM && /\bdsh[\s_-]+im\b|IM\s*机器人/i.test(request) ||
    canonical === 'https://github.com/hugohe3/ppt-master' && /\bppt[\s_-]+master\b/i.test(request);
  if (!explicitReference.test(request) && !knownAlias) throw new Error('安装目标必须出现在你发送的消息里。');
  if (kind === 'mcp') {
    if (!/\bMCP\b/i.test(request)) throw new Error('请注明这是 MCP 连接。');
    mcpAddress(canonical);
  }
  if (kind === 'workspace-skill' && !/(?:工作区\s*(?:Skill|技能)|workspace\s+skill)/i.test(request)) {
    throw new Error('请直接指定要复制的工作区 Skill。');
  }
  return { kind, reference: canonical, request };
}

function profileFor(metadata) {
  const profiles = metadata.dsh.compatibility?.profiles;
  const client = metadata.dsh.client?.platform;
  if (client === 'desktop' && !profiles?.includes('web')) {
    throw new Error('该插件要求 DSH Desktop 原生组件，当前 Somnus 无法加载。');
  }
  if (client === 'web' || profiles?.includes('web') && !profiles.includes('acp')) return 'web';
  if (!Array.isArray(profiles) || profiles.includes('acp')) return 'acp';
  throw new Error('该插件声明的配置与当前 Somnus 搭载的 DSH 不兼容。');
}

async function resolvePackage(market, reference) {
  if (!safePackage(reference)) throw new Error('请提供插件名称或完整 npm 包名。');
  const { community } = market;
  let pinned;
  if (!reference.includes('/')) {
    const catalog = await community.index(false).catch(() => null);
    const exact = catalog?.byId.get(reference);
    const matches = exact ? [exact] : catalog?.plugins.filter(item =>
      item.name.endsWith('/' + reference) ||
      Object.values(item.title || {}).some(title => title?.toLowerCase() === reference.toLowerCase())) || [];
    if (matches.length > 1) {
      throw new Error('找到多个同名插件，请指定完整包名：' + matches.slice(0, 5).map(item => item.name).join('、'));
    }
    if (matches.length === 1) {
      reference = matches[0].name;
      pinned = community.selected(matches[0], catalog.semver)?.version;
    }
  }
  const requested = pinned || 'latest';
  const metadata = await fetchJson(community.fetch, REGISTRY + '/' +
    encodeURIComponent(reference) + '/' + encodeURIComponent(requested), 512 * 1024, 15_000)
    .catch(() => { throw new Error('未找到可核对的 npm 插件，请检查完整包名和网络连接。'); });
  const distribution = URL.parse(metadata.dist?.tarball);
  if (metadata.name !== reference || !VERSION.test(metadata.version || '') ||
      pinned && pinned !== metadata.version || !metadata.dsh?.bundle?.patch ||
      distribution?.origin !== REGISTRY || distribution.username || distribution.password ||
      !/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist?.integrity || '')) {
    throw new Error('这个发行版没有可验证的 DSH 插件包。');
  }
  return metadata;
}

async function liveWeb(market, id, validateSender) {
  try {
    const server = await market.settings(validateSender);
    const snapshot = await market.account.request(server, 'pluginInventory/list');
    const entry = snapshot?.entries?.find(row => row.moduleName === id);
    return Boolean(entry?.enabled && entry.fiberPhase === 'active');
  } catch {
    return false;
  }
}

function createChatAddonInstaller(market, origin, workspaceRoot) {
  let active = false;
  return async (input, validateSender, progress = () => {}) => {
    const { kind, reference, request } = authorize(input);
    if (active) throw new Error('已有一个插件或 Skill 正在安装。');
    active = true;
    try {
      validateSender();
      progress('discovering');
      if (kind === 'skill') return await installChatSkill({ market, reference, request, validateSender, onProgress: progress });
      if (kind === 'workspace-skill') {
        if (!workspaceRoot) throw new Error('请选择已绑定本机目录的工作区。');
        const root = await workspaceRoot(input.workspaceId, input.conversationId);
        return await installWorkspaceSkill({ market, reference, workspaceRoot: root, validateSender, onProgress: progress });
      }
      if (kind === 'mcp') return await installChatMcp(origin, reference, validateSender, progress);

      const { community } = market;
      if (reference === IM && market.ownsDefaultIm?.(await market.webProfile())) {
        const result = await market.ensureDefaultIm();
        validateSender();
        const installed = result?.status === 'ready' && await community.installed(await market.webProfile(), IM);
        if (!installed) throw new Error(result?.message ?? 'Somnus 正在准备默认 DSH IM。');
        return { name: IM, pluginId: IM, version: installed.version, profile: 'web',
          alreadyInstalled: true, verified: await liveWeb(market, IM, validateSender), settings: 'dsh-im' };
      }
      const official = (await market.status()).plugins.find(row =>
        row.available && (row.sourceUrl?.split('/package/')[1]?.split('/v/')[0] === reference ||
          row.id === reference || row.name.toLowerCase().replaceAll(' ', '-') === reference));
      if (official) {
        progress('installing');
        await market.setOfficialEnabled(official.id, true, validateSender);
        progress('verifying');
        const installed = (await market.status()).plugins.some(row => row.id === official.id && row.installed);
        if (!installed) throw new Error('未能核对启用后的官方插件。');
        return { name: official.name, pluginId: official.id, version: official.version, profile: 'acp',
          verified: true, settings: 'plugins', alreadyInstalled: official.installed };
      }

      const [launch, acp, web] = await Promise.all([market.launch(), market.profile(), market.webProfile()]);
      if (!launch) throw new Error('Somnus 托管的 DSH 运行时尚未就绪。');
      const installedWeb = await community.installed(web, reference);
      const installedAcp = await community.installed(acp, reference);
      const metadata = installedWeb || installedAcp || await resolvePackage(market, reference);
      const id = metadata.name;
      const version = metadata.version;
      const profileName = profileFor(metadata);
      const loadProfile = profileName === 'web' ? () => market.webProfile() : () => market.profile();
      let profile = await loadProfile();
      if (!profile) throw new Error('需要的托管 DSH 配置尚未就绪。');
      const current = await community.installed(profile, id);
      const alreadyInstalled = Boolean(current && profile.bundles.includes(id));
      if (!alreadyInstalled) {
        const api = await community.validateBundle(metadata);
        validateSender();
        progress('installing');
        if (!current) {
          const installer = await community.installer();
          if (!installer) throw new Error('Somnus 托管的 DSH 安装器尚未就绪。');
          validateSender();
          await community.install(launch, profile, installer, id, version, profileName);
          profile = await loadProfile();
        }
        const location = await community.packageRoot(profile, id);
        const actual = await community.installed(profile, id);
        if (!location || !actual) throw new Error('未能验证已安装插件的包文件。');
        for (const patch of api.bundlePatchPaths(location, actual.dsh.bundle)) api.loadOverlayPatches('dsh', patch);
        validateSender();
        await market.writeBundleSelection(profile, id, true);
        if (profileName === 'web') market.closeSettings();
      }
      progress('verifying');
      const updated = await loadProfile();
      const verifiedPackage = await community.installed(updated, id);
      if (!verifiedPackage || !updated.bundles.includes(id)) throw new Error('未能验证插件在目标配置中的启用状态。');
      const live = profileName === 'web' && await liveWeb(market, id, validateSender);
      return {
        name: id, pluginId: id, version: verifiedPackage.version, profile: profileName, alreadyInstalled,
        verified: live, settings: id === IM ? 'dsh-im' : 'plugins',
        message: profileName === 'web'
          ? (live ? '已确认 Web 后台加载插件。' : '已核对 Web 配置和包文件，暂未确认插件在后台运行。')
          : '已核对官方 ACP 配置和包文件。公司默认 DSH 仅加载允许清单中的插件（VV_MAN_COMPANY_DSH_PLUGINS），尚未在该模型会话中验证。',
      };
    } finally {
      active = false;
    }
  };
}

module.exports = { createChatAddonInstaller, authorize, profileFor };
