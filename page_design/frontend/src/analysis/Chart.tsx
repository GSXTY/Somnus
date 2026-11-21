import { useContext, useEffect, useRef } from 'react';
import { GlassContext } from '../app/GlassExperience';
import { warmOption } from '../app/glassLogic.mjs';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkPointComponent, MarkAreaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkPointComponent, MarkAreaComponent, CanvasRenderer]);

export function Chart({ option, height = 270, label, onReady }: { option: EChartsCoreOption; height?: number; label: string; onReady?: (chart: echarts.EChartsType) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.EChartsType>();
  const {enabled}=useContext(GlassContext);
  const themedOption=enabled?warmOption(option):option;
  const serialized = JSON.stringify(themedOption);
  useEffect(() => {
    if (!container.current) return;
    const chart = echarts.init(container.current, undefined, { renderer: 'canvas' });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container.current);
    onReady?.(chart);
    return () => { observer.disconnect(); instance.current = undefined; chart.dispose(); };
    // The callbacks used here are mount-only; chart updates use the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { instance.current?.setOption(themedOption, { notMerge: true, lazyUpdate: true }); }, [serialized]);
  return <div ref={container} className="chart" style={{ height }} role="img" aria-label={label} />;
}
