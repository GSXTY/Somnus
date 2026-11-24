/**
 * Somnus「工具」注册表：外壳与工具插件之间的唯一契约。
 *
 * 设计边界（重要）：
 *   - 纯逻辑，不依赖 React / DOM / cordis，方便直接 `node --test` 验证；
 *   - 外壳（somnus-workbench）负责创建实例、通过 cordis 服务 `somnusTools`
 *     暴露给插件，并注入 `open()` 的实现（layout.selectPanel）；
 *   - 工具插件只做两件事：注册自己的 `main` 面板（panelKey），再用
 *     `registry.register(entry)` 往这里登记一张卡片；
 *   - 本模块的 `somnusToolRegistry` 是**外壳包内**的单例，供内置工具页渲染；
 *     插件不要 import 这个单例（它们各自打包，会得到另一份副本），必须通过
 *     `ctx.inject(['somnusTools'], ...)` 取到外壳提供的同一个实例。
 */

/** 工具前置条件标签的类型；具体文案由渲染层决定。 */
export type ToolPrereq = 'database' | 'files' | 'model'

/** 工具卡片图标；具体图形由渲染层决定。 */
export type ToolIcon = 'database' | 'wave' | 'spark' | 'tool'

/** 一张工具卡片。 */
export type ToolEntry = {
  /** 稳定标识，例如 'sql' | 'deep-analysis' | 'waveform'。 */
  id: string
  /** 卡片标题。 */
  title: string
  /** 一句话说明。 */
  hint: string
  /** 前置条件标签（可选）。 */
  prereq?: ToolPrereq
  /** 图标（可选，缺省按 'tool' 渲染）。 */
  icon?: ToolIcon
  /** 插件注册的 `main` 面板 key，点击卡片时交给 layout.selectPanel。 */
  panelKey: string
  /** 排序权重，升序；缺省 0。 */
  order?: number
}

/** 注册表对外接口。 */
export type ToolRegistry = {
  /** 登记一张卡片；返回注销函数（幂等）。重复 id 覆盖并 warn。 */
  register(entry: ToolEntry): () => void
  /** 已按 order、title 排序的条目拷贝。 */
  entries(): ToolEntry[]
  /** 订阅注册表变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
  /** 打开某个面板；由外壳注入实现。 */
  open(panelKey: string): void
  /** 注入 open() 的实现（外壳通常接到 layout.selectPanel）。 */
  setOpener(open: (panelKey: string) => void): void
}

const PREREQS: readonly ToolPrereq[] = ['database', 'files', 'model']
const ICONS: readonly ToolIcon[] = ['database', 'wave', 'spark', 'tool']
const WARN_PREFIX = '[somnusTools]'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function warnInvalid(reason: string): void {
  // 关键：非法条目只警告，绝不抛异常，避免一个坏插件让整页工具列表消失。
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`${WARN_PREFIX} 忽略无效的工具条目：${reason}`)
  }
}

/** 校验并把外部传入的对象规范化成内部条目；非法返回 undefined（调用方 warn）。 */
function normalizeEntry(input: ToolEntry): ToolEntry | undefined {
  if (input === null || typeof input !== 'object') return undefined
  if (!isNonEmptyString(input.id)) return undefined
  if (!isNonEmptyString(input.title)) return undefined
  if (!isNonEmptyString(input.hint)) return undefined
  if (!isNonEmptyString(input.panelKey)) return undefined
  if (input.prereq !== undefined && !PREREQS.includes(input.prereq)) return undefined
  if (input.icon !== undefined && !ICONS.includes(input.icon)) return undefined

  const entry: ToolEntry = {
    id: input.id,
    title: input.title,
    hint: input.hint,
    panelKey: input.panelKey,
  }
  if (input.prereq !== undefined) entry.prereq = input.prereq
  if (input.icon !== undefined) entry.icon = input.icon
  // order 只做宽容归一：非有限数字按 0 处理，不算非法条目。
  entry.order = typeof input.order === 'number' && Number.isFinite(input.order) ? input.order : 0
  return entry
}

/** 排序规则：order 升序，其次按 title 的代码点升序（不依赖 ICU，结果稳定）。 */
function compareEntries(a: ToolEntry, b: ToolEntry): number {
  const delta = (a.order ?? 0) - (b.order ?? 0)
  if (delta !== 0) return delta
  if (a.title < b.title) return -1
  if (a.title > b.title) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 创建一张互不影响的注册表。
 *
 * 语义约定：
 *   - 重复 id：后注册的覆盖先前的，并 warn；被覆盖条目的注销函数变成 no-op，
 *     不会误删后来者（每次注册都持有一个 token，注销时比对 token）。
 *   - 注销幂等：同一注销函数调用多次只有第一次生效。
 *   - 非法条目：忽略并 warn，不抛异常、不改变现有注册表。
 *   - entries() 返回浅拷贝数组，元素也是拷贝，调用方可随意修改。
 */
export function createToolRegistry(): ToolRegistry {
  type Slot = { token: symbol; entry: ToolEntry }
  const slots = new Map<string, Slot>()
  const listeners = new Set<() => void>()
  let opener: ((panelKey: string) => void) | undefined

  function notify(): void {
    // 先复制，避免监听器在回调里注销导致遍历异常。
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        // 单个监听器出错不能影响其他监听器，也不能影响注册方。
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn(`${WARN_PREFIX} 工具注册表监听器出错：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  return {
    register(input: ToolEntry): () => void {
      const entry = normalizeEntry(input)
      if (!entry) {
        warnInvalid(`id/title/hint/panelKey 必须是非空字符串，prereq/icon 必须是枚举值（收到 ${describe(input)}）`)
        return () => {}
      }
      if (slots.has(entry.id)) {
        // 覆盖：旧条目的注销函数在下面通过 token 比对自动失效。
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn(`${WARN_PREFIX} 工具 id「${entry.id}」被重复注册，后者覆盖前者`)
        }
      }
      const token = Symbol(entry.id)
      slots.set(entry.id, { token, entry })
      notify()

      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        const current = slots.get(entry.id)
        // token 不匹配说明已经被后来者覆盖：注销函数变成 no-op。
        if (!current || current.token !== token) return
        slots.delete(entry.id)
        notify()
      }
    },

    entries(): ToolEntry[] {
      return [...slots.values()]
        .map(slot => ({ ...slot.entry }))
        .sort(compareEntries)
    },

    subscribe(listener: () => void): () => void {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      let active = true
      return () => {
        if (!active) return
        active = false
        listeners.delete(listener)
      }
    },

    open(panelKey: string): void {
      if (typeof panelKey !== 'string' || panelKey.trim() === '') {
        warnInvalid('open() 收到的 panelKey 为空')
        return
      }
      if (!opener) {
        console.warn(`${WARN_PREFIX} 外壳尚未注入 open()，无法打开面板「${panelKey}」`)
        return
      }
      opener(panelKey)
    },

    setOpener(next: (panelKey: string) => void): void {
      opener = typeof next === 'function' ? next : undefined
    },
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return typeof value
  const candidate = value as { id?: unknown }
  return typeof candidate.id === 'string' ? `id=${JSON.stringify(candidate.id)}` : 'object'
}

/**
 * 外壳包内的单例：`somnus-workbench` 把它 provide 成 cordis 服务 `somnusTools`，
 * 内置工具页 `NativeTools` 直接读它。
 */
export const somnusToolRegistry: ToolRegistry = createToolRegistry()
