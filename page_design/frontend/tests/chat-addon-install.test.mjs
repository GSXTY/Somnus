import test from 'node:test';
import assert from 'node:assert/strict';
import { addonInstallIntent } from '../src/chatAddonInstall.ts';

test('identifies explicit installation targets in user drafts', () => {
  const requests = [
    ['帮我安装一下 dsh im', 'plugin', '@xmanrui/dsh-im'],
    ['帮我把 PPT Master 这个 Skill 装上', 'skill', 'https://github.com/hugohe3/ppt-master'],
    ['安装插件：@team/example-plugin', 'plugin', '@team/example-plugin'],
    ['@team/example-plugin 帮我安装', 'plugin', '@team/example-plugin'],
    ['帮我安装 https://github.com/team/example 这个 Skill', 'skill', 'https://github.com/team/example'],
  ];
  for (const [request, kind, reference] of requests) {
    assert.deepEqual(addonInstallIntent(request), { kind, reference, request });
  }
});

test('does not treat questions, quotations, commands or arbitrary URLs as installation requests', () => {
  for (const request of [
    '不要安装 @team/example-plugin', '怎么安装 @team/example-plugin？', '安装 @team/example-plugin 吗',
    '配置 @team/example-plugin', '“安装 @team/example-plugin”', '> 安装 @team/example-plugin',
    '\x60\x60\x60\n安装 @team/example-plugin\n\x60\x60\x60', 'dsh plugin add @team/example-plugin',
    '安装 @team/example-plugin && echo ok', '安装 https://example.org/team/plugin Skill',
    '安装 https://github.com/team/example', '安装 python',
  ]) assert.equal(addonInstallIntent(request), undefined, request);
});
