import { useEffect, useRef, useState } from 'react'
import { nativeFetch } from '../../../page_design/frontend/src/shared/nativeFetch.mjs'
import markup from '../../../event_detection/index.html?somnus-native'
import dashboardStyles from '../../../page_design/dashboard.css?somnus-native'
import eventStyles from '../../../page_design/events.css?somnus-native'
import mountViewer from '../../../event_detection/viewer.js?somnus-native'
import annotation from '../../../event_detection/annotation-model.js?somnus-native'

export function NativeWaveform({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const visibility = useRef<(active: boolean) => void>()
  const [error, setError] = useState('')
  useEffect(() => {
    const container = host.current!
    const shadow = container.shadowRoot || container.attachShadow({ mode: 'open' })
    const parsed = new DOMParser().parseFromString(markup, 'text/html')
    const body = document.createElement('div')
    body.tabIndex = 0
    body.addEventListener('pointerdown', event => {
      if ((event.target as Element).tagName === 'CANVAS') body.focus({ preventScroll: true })
    })
    body.className = `${parsed.body.className} analysis-embedded`
    body.innerHTML = parsed.body.innerHTML
    body.querySelectorAll('script').forEach(node => node.remove())
    const style = document.createElement('style')
    const styles = [...parsed.querySelectorAll('style')].map(node => node.textContent).join('\n') + dashboardStyles + eventStyles
    style.textContent = styles.replace(/:root/g, ':host').replace(/\bbody\b/g, '.events-page').replace(/\bhtml\b/g, ':host') + `
      :host {display:block;min-width:0;--text:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--border:var(--dsw-alias-border-l1);--primary:var(--dsw-alias-brand-primary);--bg:var(--dsw-alias-bg-base);--hover:var(--dsw-alias-bg-layer-2);--selected:var(--dsw-alias-interactive-bg-active)}
      .events-page {background:var(--dsw-alias-bg-base);color:var(--text)}
      .events-page.analysis-embedded {position:relative!important}
      .events-page.analysis-embedded .channel-sidebar {position:absolute!important;inset:0 auto 0 0!important;width:186px!important;height:100%!important;max-height:none!important;grid-column:auto!important;grid-row:auto!important;border-radius:0!important}
      .events-page.analysis-embedded > .sidebar, .events-page.analysis-embedded .events-global-header {display:none!important}
      .events-page :is(section,.channel-sidebar,.event-panel,.event-panel-head,.annotation-dialog,select,input,button,details.wave-settings) {background:var(--dsw-alias-bg-layer-1);color:var(--text);border-color:var(--border)}
    `
    shadow.replaceChildren(style, body)
    const abort = new AbortController()
    let visible = active
    const listeners: Array<() => void> = []
    const messages = new Set<EventListener>()
    const resizes = new Set<EventListener>()
    const timeouts = new Set<number>(), intervals = new Set<number>(), frames = new Set<number>(), urls = new Set<string>()
    const timeout = (fn: TimerHandler, delay?: number) => {
      if (abort.signal.aborted) return 0
      const id = window.setTimeout(() => { timeouts.delete(id); if (!abort.signal.aborted && typeof fn === 'function') fn() }, delay)
      timeouts.add(id); return id
    }
    const interval = (fn: TimerHandler, delay?: number) => {
      if (abort.signal.aborted) return 0
      const id = window.setInterval(fn, delay); intervals.add(id); return id
    }
    const frame = (fn: FrameRequestCallback) => {
      if (abort.signal.aborted) return 0
      const id = window.requestAnimationFrame(time => { frames.delete(id); if (!abort.signal.aborted) fn(time) })
      frames.add(id); return id
    }
    const localWindow = new Proxy(window, { get(target, key) {
      if (key === 'setTimeout') return timeout
      if (key === 'setInterval') return interval
      if (key === 'requestAnimationFrame') return frame
      if (key === 'matchMedia') return (query: string) => {
        const media = window.matchMedia(query)
        return new Proxy(media, { get(target, property) {
          if (property === 'addEventListener') return (name: string, listener: EventListener) => {
            target.addEventListener(name, listener)
            listeners.push(() => target.removeEventListener(name, listener))
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        } })
      }
      if (key === 'parent') return window
      if (key === 'location') return { origin: location.origin, search: '?embedded=1' }
      if (key === 'addEventListener') return (name: string, fn: EventListener, options?: AddEventListenerOptions) => {
        if (name === 'message') messages.add(fn)
        if (name === 'resize') resizes.add(fn)
        const source = name === 'keydown' ? body : name === 'scroll' ? container : window
        source.addEventListener(name, fn, options)
        listeners.push(() => source.removeEventListener(name, fn, options))
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const localDocument = new Proxy(document, { get(target, key) {
      if (key === 'hidden') return !visible || document.hidden
      if (key === 'body' || key === 'documentElement') return body
      if (key === 'activeElement') return shadow.activeElement
      if (key === 'getElementById') return (id: string) => body.querySelector('#' + CSS.escape(id))
      if (key === 'querySelector' || key === 'querySelectorAll') return body[key].bind(body)
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const localURL = new Proxy(URL, { get(target, key) {
      if (key === 'createObjectURL') return (blob: Blob) => { const url = URL.createObjectURL(blob); urls.add(url); return url }
      if (key === 'revokeObjectURL') return (url: string) => { urls.delete(url); URL.revokeObjectURL(url) }
      return Reflect.get(target, key)
    } })
    const request = (path: string, init: RequestInit = {}) => nativeFetch(path, {
      ...init, signal: init.signal ? AbortSignal.any([abort.signal, init.signal]) : abort.signal,
    })
    let dispose: (() => void) | undefined
    try {
      dispose = mountViewer(localDocument, localWindow, request, annotation.AnnotationModel,
        frame, window.cancelAnimationFrame.bind(window), timeout, window.clearTimeout.bind(window),
        interval, window.clearInterval.bind(window), localURL)
      visibility.current = value => {
        visible = value
        const event = new MessageEvent('message', { data: { source: 'data-workbench', type: 'analysis:visibility', visible: value }, source: window, origin: location.origin })
        messages.forEach(listener => listener(event))
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法加载波形工具') }
    const observer = new ResizeObserver(() => { if (!abort.signal.aborted) resizes.forEach(listener => listener(new Event('resize'))) })
    observer.observe(container)
    return () => {
      dispose?.(); abort.abort(); observer.disconnect(); visibility.current = undefined
      listeners.forEach(remove => remove())
      timeouts.forEach(id => window.clearTimeout(id)); intervals.forEach(id => window.clearInterval(id)); frames.forEach(id => window.cancelAnimationFrame(id))
      urls.forEach(url => URL.revokeObjectURL(url)); shadow.replaceChildren()
    }
  }, [])
  useEffect(() => { visibility.current?.(active) }, [active])
  return <>{error && <p role="alert">{error}</p>}<div ref={host} className="somnus-native-waveform" /></>
}
