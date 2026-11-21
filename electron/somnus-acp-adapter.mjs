/**
 * DSH LLM adapters that route a model call directly to the Somnus ACP Host.
 * Each ACP agent is its own DSH provider so the model picker groups models by
 * agent (Codex / CodeBuddy) instead of flattening them into one list.
 */
export const name = 'somnus-acp-adapter'
export const inject = ['llm', 'agents', 'tools']
import { randomUUID } from 'node:crypto'
import contextTransfer from './somnus-acp-context.cjs'
import { createDshPluginInterop } from './somnus-plugin-interop.mjs'

const endpoint = process.env.SOMNUS_ACP_URL || ''
const token = process.env.SOMNUS_ACP_TOKEN || ''

const PROVIDERS = Object.create(null)

function providerId(agent) {
  if (agent.id === 'codex') return 'somnus-codex'
  if (agent.id === 'codebuddy') return 'somnus-codebuddy'
  return 'somnus-acp-' + encodeURIComponent(agent.id)
}

const modelCache = new Map()
let pluginInterop

async function agentCatalog(agentId) {
  if (modelCache.has(agentId)) return modelCache.get(agentId)
  const response = await fetch(`${endpoint}/models?agentId=${encodeURIComponent(agentId)}`, {
    headers: { 'x-somnus-acp-token': token }, signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`ACP ${agentId} model catalog failed (${response.status})`)
  const value = await response.json()
  const catalog = {
    models: Array.isArray(value.models) ? value.models : [],
    reasoning: value.reasoning || undefined,
  }
  modelCache.set(agentId, catalog)
  setTimeout(() => modelCache.delete(agentId), 5_000).unref?.()
  return catalog
}

function efforts(catalog) {
  if (!catalog?.reasoning?.options?.length) return undefined
  return { defaultEffort: catalog.reasoning.current || undefined, efforts: catalog.reasoning.options.map(item => ({ id: item.id, name: item.name || item.id })) }
}

const adapter = {
  providerInfo(provider) {
    const entry = PROVIDERS[provider]
    return { id: provider, name: entry?.name || provider }
  },
  providerRetryPolicy() {
    // DSH consumes a resolved policy here, not a provider configuration.
    // Never retry ACP prompts implicitly: an external agent may already have
    // performed tools before its transport reports a failure.
    return Object.freeze({ mode: 'normal', maxRetries: 0,
      retryableCodes: Object.freeze(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT']),
      initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 })
  },
  imageRequestPricing() {},
  imageRequestTarget(_provider, _model, image) {
    return { width: image.width, height: image.height, maxBytes: image.bytes }
  },
  async listModels(provider) {
    const entry = PROVIDERS[provider]
    if (!entry) return []
    try {
      const catalog = await agentCatalog(entry.agent)
      const reasoning = efforts(catalog)
      if (!catalog.models.length) return []
      return catalog.models.map(model => ({
        provider,
        id: model.id,
        name: model.name,
        contextWindow: 475000,
        defaultMaxTokens: 16384,
        ...(reasoning ? { reasoning } : {}),
      }))
    } catch {
      return []
    }
  },
  async resolveModel(provider, model) {
    const entry = PROVIDERS[provider]
    if (!entry) throw new Error(`Unknown ACP provider "${provider}"`)
    const catalog = await agentCatalog(entry.agent)
    const found = catalog.models.find(item => item.id === model)
    if (!found) throw new Error('ACP model is unavailable; verify the agent in Configuration')
    const reasoning = efforts(catalog)
    return { provider, id: model, name: found.name || found.id, contextWindow: 475000, defaultMaxTokens: 16384,
      ...(reasoning ? { reasoning } : {}) }
  },
  async prepareCall(provider, model, signal) {
    const requestId = randomUUID()
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: options => this.stream(options, requestId),
    }
  },
  async *stream(options, requestId = randomUUID()) {
    const entry = PROVIDERS[options.provider]
    if (!entry) throw new Error(`Unknown ACP provider "${options.provider}"`)
    if (!endpoint || !token) throw new Error('ACP Host is not ready')
    // Native DSH titles reuse the owning sessionId while running concurrently
    // with its agent loop. They must not enter that conversation's ACP ledger.
    const auxiliary = typeof options.purpose === 'string' && options.purpose.length > 0
    const pluginTurn = await (!auxiliary && pluginInterop && options.sessionId && options.tools?.length
      ? pluginInterop.openTurn({ ...options, requestId, signal: options.signal || new AbortController().signal }, entry.agent)
        .catch(error => {
          console.warn('Somnus plugin tool bridge unavailable for this ACP turn:', error?.message || error)
          return undefined
        })
      : Promise.resolve(undefined))
    try {
    const response = await fetch(endpoint + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-somnus-acp-token': token },
      body: JSON.stringify({
        agentId: entry.agent,
        conversationId: auxiliary ? `dsh-aux-${requestId}` : `dsh-${options.sessionId || randomUUID()}`,
        ...(auxiliary ? { purpose: options.purpose.slice(0, 80) } : {}),
        requestId,
        transcript: contextTransfer.transcript(options.messages || []),
        ...(pluginTurn ? { pluginTools: pluginTurn.descriptor } : {}),
        ...(options.model && options.model !== 'default' ? { modelId: options.model } : {}),
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      }),
      signal: options.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`ACP ${entry.name} failed (${response.status}): ${body}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('ACP Host returned no stream')
    const decoder = new TextDecoder()
    let buffer = ''
    let started = false
    let text = ''
    let usage
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const event = JSON.parse(line.slice(6))
        if (event.error) throw new Error(event.error)
        if (event.pluginCompatibility) pluginTurn?.reportCompatibility?.(event.pluginCompatibility)
        if (event.text) {
          if (!started) {
            started = true
            yield { type: 'block-start', index: 0, blockType: 'text' }
          }
          text += event.text
          yield { type: 'text-delta', index: 0, text: event.text }
        }
        if (event.done && event.usage) {
          usage = {
            inputTokens: event.usage.inputTokens || 0,
            outputTokens: event.usage.outputTokens || 0,
            ...(event.usage.totalTokens ? { totalTokens: event.usage.totalTokens } : {}),
          }
        }
      }
    }
    if (!started) {
      started = true
      yield { type: 'block-start', index: 0, blockType: 'text' }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    if (usage) yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
    } finally { pluginTurn?.close() }
  },
}

export async function apply(ctx) {
  if (!endpoint || !token) return
  pluginInterop = createDshPluginInterop(ctx)
  ctx.effect(() => () => { void pluginInterop.close() }, 'Somnus ACP plugin tool bridge')
  let registration
  let signature = ''
  let disposed = false
  let refreshing = false
  const refresh = async () => {
    if (refreshing || disposed) return
    refreshing = true
    try {
      const response = await fetch(endpoint + '/agents', {
        headers: { 'x-somnus-acp-token': token }, signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error('Configured ACP agents unavailable')
      const data = await response.json()
      const entries = (Array.isArray(data.agents) ? data.agents : [])
        .filter(agent => typeof agent.id === 'string' && typeof agent.name === 'string')
        .map(agent => [providerId(agent), { agent: agent.id, name: agent.name, revision: agent.revision }])
      const next = JSON.stringify(entries)
      if (next === signature || disposed) return
      for (const key of Object.keys(PROVIDERS)) delete PROVIDERS[key]
      for (const [id, entry] of entries) PROVIDERS[id] = entry
      modelCache.clear()
      const routes = Object.keys(PROVIDERS)
      if (registration) registration.replace(routes)
      else if (routes.length) registration = ctx.llm.registerAdapter(routes, adapter)
      signature = next
    } catch (error) {
      ctx.logger?.warn?.('Somnus ACP configuration refresh failed: ' + error.message)
    } finally { refreshing = false }
  }
  await refresh()
  ctx.effect(() => {
    const timer = setInterval(refresh, 2000)
    timer.unref?.()
    return () => { disposed = true; clearInterval(timer) }
  }, 'Configured Somnus ACP agents')
}
