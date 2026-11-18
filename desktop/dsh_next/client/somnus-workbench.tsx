import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './slot-contract.ts'
import './somnus-workbench.css'

export type SomnusPage = 'workbench' | 'waveform'

export interface SomnusNavigationBridge {
  openPage(page: SomnusPage): Promise<void>
}

const panelId = 'somnus-workbench' as MainPanelId
const localeId = 'somnus-workbench'
const zh = {
  title: 'Somnus 工作台',
  intro: '在独立窗口中打开工作台或波形分析。',
  workbench: '工作台',
  workbenchDescription: '查看设备数据、分析工具和设置。',
  waveform: '波形分析',
  waveformDescription: '打开本地采样记录，查看呼吸波形和事件。',
  openWorkbench: '打开工作台',
  openWaveform: '打开波形分析',
  opening: '正在打开…',
  openError: '暂时无法打开 Somnus 页面，请重试。',
  database: '公司数据库 MCP',
  databaseDescription: '提供公司数据库的只读查询。',
  textToSql: 'Text-to-SQL MCP',
  textToSqlDescription: '将自然语言问题转换为 SQL。',
  managedMcp: '由 Somnus 管理，始终启用。',
}
const en: typeof zh = {
  title: 'Somnus workbench',
  intro: 'Open the workbench or the waveform viewer in a separate window.',
  workbench: 'Workbench',
  workbenchDescription: 'View device data, analysis tools, and settings.',
  waveform: 'Waveform viewer',
  waveformDescription: 'Open a local recording and view respiratory waveforms and events.',
  openWorkbench: 'Open workbench',
  openWaveform: 'Open waveform viewer',
  opening: 'Opening…',
  openError: 'The Somnus page could not be opened. Try again.',
  database: 'Company Database MCP',
  databaseDescription: 'Provides read-only company database queries.',
  textToSql: 'Text-to-SQL MCP',
  textToSqlDescription: 'Turns natural-language questions into SQL.',
  managedMcp: 'Managed by Somnus and always enabled.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'somnus-workbench': keyof typeof zh
  }
}

function WorkbenchIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M6.5 12h3l1.8-3.2 2.2 6.4 1.7-3.2h2.3" />
  </svg>
}

function WorkbenchPanel({ t, navigation }: PropsLocale<typeof localeId> & { navigation: SomnusNavigationBridge }) {
  const [opening, setOpening] = useState<SomnusPage>()
  const [failed, setFailed] = useState(false)

  async function openPage(page: SomnusPage) {
    setOpening(page)
    setFailed(false)
    try {
      await navigation.openPage(page)
    } catch {
      setFailed(true)
    } finally {
      setOpening(undefined)
    }
  }

  return <section className="somnus-next-workbench" aria-labelledby="somnus-next-workbench-title">
    <div className="somnus-next-workbench-content">
      <header>
        <h1 id="somnus-next-workbench-title">{t('title')}</h1>
        <p>{t('intro')}</p>
      </header>
      <div className="somnus-next-workbench-pages">
        <section aria-labelledby="somnus-next-workbench-page">
          <h2 id="somnus-next-workbench-page">{t('workbench')}</h2>
          <p>{t('workbenchDescription')}</p>
          <Button variant="primary" disabled={Boolean(opening)} onClick={() => void openPage('workbench')}>
            {t(opening === 'workbench' ? 'opening' : 'openWorkbench')}
          </Button>
        </section>
        <section aria-labelledby="somnus-next-waveform-page">
          <h2 id="somnus-next-waveform-page">{t('waveform')}</h2>
          <p>{t('waveformDescription')}</p>
          <Button variant="outline" disabled={Boolean(opening)} onClick={() => void openPage('waveform')}>
            {t(opening === 'waveform' ? 'opening' : 'openWaveform')}
          </Button>
        </section>
      </div>
      {failed && <p role="alert">{t('openError')}</p>}
    </div>
  </section>
}

export function registerSomnusWorkbench(ctx: Context): void {
  const navigation = typeof window === 'undefined' ? undefined :
    (window as Window & { somnusNext?: SomnusNavigationBridge }).somnusNext
  if (typeof navigation?.openPage !== 'function') return

  ctx.effect(() => ctx.locale.register(localeId, { zh, en }), 'Somnus workbench labels')
  const t = ctx.locale.bind(localeId)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: panelId,
    locale: localeId,
    inject: () => ({ navigation }),
  }, WorkbenchPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: panelId,
    order: 20,
    locale: localeId,
    label: () => t('title'),
  }, WorkbenchIcon))

  ctx.slots.inject('plugins.item', function* () {
    for (const [id, title, description] of [
      ['somnus-database', 'database', 'databaseDescription'],
      ['somnus-text-to-sql', 'textToSql', 'textToSqlDescription'],
    ] as const) {
      yield ctx.slots.register({
        name: 'plugins.item',
        id,
        order: 50,
        locale: localeId,
        label: () => t(title),
      }, ({ t, view }: PropsLocale<typeof localeId> & PropsRuntime<'plugins.item'>) =>
        view === 'summary' ? t(description) : <p>{t('managedMcp')}</p>)
    }
  })
}
