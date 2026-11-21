export type AddonInstall = { kind: 'plugin' | 'skill' | 'workspace-skill' | 'mcp'; reference: string; request: string;
  workspaceId?: string; conversationId?: string };
export type AddonSettings = 'dsh-im' | 'plugins' | 'skills' | 'mcp';
export type AddonStage = 'discovering' | 'installing' | 'verifying';

type AddonInstallResult = {
  name: string;
  version?: string;
  profile: 'acp' | 'web' | 'skills' | 'mcp';
  verified: boolean;
  settings?: AddonSettings;
  pluginId?: string;
  alreadyInstalled: boolean;
  message?: string;
};

declare global {
  interface Window {
    somnusAddonInstaller?: {
      install: (input: AddonInstall) => Promise<AddonInstallResult>;
      onProgress?: (listener: (stage: AddonStage) => void) => () => void;
    };
  }
}

const github = /^https:\/\/github\.com\/[a-z\d][a-z\d-]{0,38}\/[a-z\d][a-z\d._-]{0,99}\/?$/i;
const npmPackage = /^(?:@[a-z\d][a-z\d._-]*\/)?[a-z\d][a-z\d._-]*$/;
const pptMaster = 'https://github.com/hugohe3/ppt-master';

export function addonInstallIntent(text: string): AddonInstall | undefined {
  const request = text.trim();
  if (request.length > 240 || /[\r\n<>“”"'；;|&]/.test(request) || /^(?:>|\x60)/.test(request)) return;
  const cleaned = request.replace(/[。！!]+$/, '').trim();
  const match = /^(?:(?:请|麻烦)\s*)?(?:帮我\s*)?(?:安装(?:一下)?|装一下|装上)\s*[:：]?\s*(.+)$/i.exec(cleaned)
    || /^(?:(?:please|help me)\s+)?install\s+(.+)$/i.exec(cleaned)
    || /^(?:(?:请|麻烦)\s*)?(?:帮我\s*)?把\s*(.+?)\s*(?:装上|装一下|安装好)$/i.exec(cleaned)
    || /^(.+?)\s*(?:帮我安装(?:一下)?|这个安装)$/i.exec(cleaned);
  if (!match) return;
  let candidate = match[1].trim().replace(/(?:，|,)?\s*(?:并|然后)\s*打开(?:对应的?)?设置(?:页)?$/, '');
  candidate = candidate.replace(/\s*(?:到|至|为)\s*(?:全局|用户级|用户目录|个人配置)\s*$/i, '').trim();
  const localSkill = /^(?:工作区\s*(?:Skill|技能)|workspace\s+skill)(?:\s*[:：]\s*|\s+)([a-z0-9]+(?:-[a-z0-9]+)*)$/i.exec(candidate);
  if (localSkill && localSkill[1].length <= 64) return { kind: 'workspace-skill', reference: localSkill[1].toLowerCase(), request };
  const mcp = /^MCP(?:\s*[:：]\s*|\s+)(https:\/\/[^\s]+)$/i.exec(candidate);
  if (mcp) {
    try {
      const url = new URL(mcp[1]);
      if (!url.username && !url.password && !url.search && !url.hash && url.port !== '0') {
        return { kind: 'mcp', reference: mcp[1], request };
      }
    } catch { /* use the regular chat when the address is invalid */ }
    return;
  }
  const prefix = /^(插件|plugin|技能|skill)(?:\s*[:：]\s*|\s+)/i.exec(candidate);
  const suffix = /(?:\s*这个\s*|\s+)(插件|plugin|技能|skill)$|(插件|技能)$/i.exec(candidate);
  const label = prefix?.[1] || suffix?.[1] || suffix?.[2];
  const type = label ? /^(?:插件|plugin)$/i.test(label) ? 'plugin' : 'skill' : undefined;
  candidate = candidate.slice(prefix?.[0].length || 0, suffix?.index ?? candidate.length).trim();
  if (/^\x60[^\x60]+\x60$/.test(candidate)) candidate = candidate.slice(1, -1);
  if (/^(?:dsh[ -]im|im\s*机器人)$/i.test(candidate) && type !== 'skill') {
    return { kind: 'plugin', reference: '@xmanrui/dsh-im', request };
  }
  if (/^ppt[ -]master$/i.test(candidate) && type !== 'plugin') {
    return { kind: 'skill', reference: pptMaster, request };
  }
  if (github.test(candidate) && (type === 'skill' || type === undefined && candidate.replace(/\/$/, '').toLowerCase() === pptMaster)) {
    return { kind: 'skill', reference: candidate, request };
  }
  if (type !== 'skill' && npmPackage.test(candidate) && (type === 'plugin' || candidate.startsWith('@') || /[.-]/.test(candidate))) {
    return { kind: 'plugin', reference: candidate, request };
  }
}
