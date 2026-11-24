import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkPointComponent, MarkAreaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkPointComponent, MarkAreaComponent, CanvasRenderer])

/** ECharts wrapper for the original Somnus dashboard, without the legacy shell context. */
export function LegacyChart({ option, height = 270, label }: {
  option: EChartsCoreOption; height?: number; label: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<echarts.EChartsType>()
  const serialized = JSON.stringify(option)
  useEffect(() => {
    if (!container.current) return
    const chart = echarts.init(container.current, undefined, { renderer: 'canvas' })
    instance.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); instance.current = undefined; chart.dispose() }
  }, [])
  useEffect(() => { instance.current?.setOption(option, { notMerge: true, lazyUpdate: true }) }, [serialized])
  return <div ref={container} className="chart" style={{ height }} role="img" aria-label={label} />
}
