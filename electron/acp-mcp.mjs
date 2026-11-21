#!/usr/bin/env node
/**
 * Minimal MCP stdio bridge for the Somnus ACP Host.
 * Exposes one tool, `codex`, so the DSH main Agent can delegate a turn to Codex
 * without changing the DSH session/provider.
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.SOMNUS_ACP_URL || '';
const token = process.env.SOMNUS_ACP_TOKEN || '';
const modelFile = join(tmpdir(), 'somnus-acp-model.json');

function selectedModel() {
  try {
    const value = JSON.parse(readFileSync(modelFile, 'utf8'));
    return typeof value?.modelId === 'string' ? value.modelId : undefined;
  } catch {
    return undefined;
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function callCodex(text, agentId = 'codex') {
  if (!url || !token) throw new Error('Codex ACP Host 尚未就绪。');
  const response = await fetch(url + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-somnus-acp-token': token },
    body: JSON.stringify({ agentId, conversationId: 'mcp-' + Date.now(), text, modelId: selectedModel() }),
  });
  if (!response.ok) throw new Error(`Codex ACP 请求失败（${response.status}）`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Codex ACP 没有返回流。');
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let tools = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));
      if (event.text) output += event.text;
      if (event.error) throw new Error(event.error);
      if (event.done && Array.isArray(event.tools)) tools = event.tools;
    }
  }
  if (tools.length) {
    const summary = tools.map(tool => `- ${tool.title || tool.kind || '工具'}${tool.command ? `：${tool.command}` : ''}（${tool.status || '完成'}）`).join('\n');
    output += `\n\n[Codex 执行记录]\n${summary}`;
  }
  return output;
}

const tools = [{
  name: 'codex',
  description: 'Delegate a coding task to the Codex ACP agent. Use when the user asks for Codex or when Codex-specific execution is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The complete task or question for Codex.' },
    },
    required: ['task'],
    additionalProperties: false,
  },
}, {
  name: 'codebuddy',
  description: 'Delegate a coding task to the CodeBuddy Code ACP agent. Use only when the user explicitly asks for CodeBuddy.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The complete task or question for CodeBuddy.' },
    },
    required: ['task'],
    additionalProperties: false,
  },
}];

const input = createInterface({ input: process.stdin });
input.on('line', async line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  try {
    if (request.method === 'initialize') {
      send({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'somnus-codex', version: '1.0.0' },
      } });
      return;
    }
    if (request.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: request.id, result: { tools } });
      return;
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name;
      const task = request.params?.arguments?.task;
      if (!['codex', 'codebuddy'].includes(name) || typeof task !== 'string' || !task.trim()) {
        throw new Error('ACP 工具参数无效。');
      }
      const text = await callCodex(task.trim(), name);
      send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text }] } });
      return;
    }
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method not found' } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message } });
  }
});
