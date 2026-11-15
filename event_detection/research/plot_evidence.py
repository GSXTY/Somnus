"""Export research figures from original EDF/CSV, without modifying annotations.

Optional dependency: matplotlib. S9 labels use OSCAR's end-marker convention,
not a claim of physiologically exact onset. YA70 plots use source-second
statistics, not invented uniformly sampled breath waveforms.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np


def _plotting():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.family': 'Microsoft YaHei', 'axes.unicode_minus': False,
                         'figure.facecolor': '#f4f7fb', 'axes.facecolor': 'white',
                         'axes.edgecolor': '#dce3ee', 'axes.labelcolor': '#475569',
                         'text.color': '#172b4d', 'xtick.color': '#64748b', 'ytick.color': '#64748b',
                         'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
    return plt


def plot_s9(root, output):
    from event_detection.research.edf_evidence import EDFFile
    import matplotlib.dates as dates
    plt = _plotting()
    root = Path(root)
    files = sorted((root / 'DATALOG').rglob('20191228*edf'))
    readers = {p.stem.rsplit('_', 1)[-1]: EDFFile(p) for p in files}
    a, b = datetime(2019, 12, 28, 23, 28, 15), datetime(2019, 12, 28, 23, 31, 17)
    fig, axes = plt.subplots(3, 1, figsize=(14, 7.5), sharex=True, gridspec_kw={'height_ratios': [2, 1, 1]})
    for axis, family, name, unit, color, factor in [
        (axes[0], 'BRP', ('Flow', 'Flow.40ms'), '流量（L/min）', '#1d4ed8', 60),
        (axes[1], 'PLD', ('Therapy Pressur', 'Therapy Pres'), '治疗压力（cmH2O）', '#0f766e', 1),
        (axes[2], 'PLD', ('Leak',), '漏气率（L/min）', '#946635', 60),
    ]:
        reader = readers[family]
        channel = next(c for c in reader.channels if c['name'] in name)
        values = np.array(reader.read_signal(channel['index'])) * factor
        seconds = np.arange(len(values)) / channel['sample_rate_hz']
        keep = (seconds >= (a-reader.start).total_seconds()) & (seconds <= (b-reader.start).total_seconds())
        times = [reader.start + timedelta(seconds=float(t)) for t in seconds[keep]]
        axis.plot(times, values[keep], color=color, linewidth=.9, drawstyle='steps-post' if family == 'PLD' else 'default')
        axis.set_ylabel(unit)
        axis.grid(alpha=.18)
    reader = readers['EVE']
    for annotation in reader.annotations():
        if 'Obstructive Apnea' not in annotation['texts']:
            continue
        end = reader.start + timedelta(seconds=annotation['onset_seconds'])
        begin = end - timedelta(seconds=annotation['duration_seconds'])
        if end >= a and begin <= b:
            for axis in axes:
                axis.axvspan(begin, end, color='#f59e0b', alpha=.12)
                axis.axvline(end, color='#d97706', linewidth=1, linestyle='--')
            axes[0].text(end, .98, f"  OA 设备标记 · {annotation['duration_seconds']:g}s\n  {end:%H:%M:%S}",
                         transform=axes[0].get_xaxis_transform(), va='top', fontsize=9, color='#92400e')
    axes[-1].xaxis.set_major_formatter(dates.DateFormatter('%H:%M:%S'))
    axes[-1].xaxis.set_major_locator(dates.SecondLocator(bysecond=range(0,60,15)))
    axes[-1].set_xlim(a,b)
    axes[-1].set_xlabel('S9 设备文件头时间（未指定时区）')
    fig.suptitle('S9 原始 EDF 证据 · 与 OSCAR 截图相同的三分钟', x=.075, ha='left', fontsize=17, weight='bold')
    fig.text(.075, .915, '流量 25 Hz；压力/漏气率 0.5 Hz，各用自己的文件头时间。虚线是设备事件结束标记，色带向前展开其记录时长。', color='#64748b', fontsize=10)
    fig.text(.075, .02, '色带来自 EVE 设备注释及 OSCAR 绘制约定；没有重新推断 OA/CA，也没有执行设备控制。', fontsize=9, color='#64748b')
    fig.subplots_adjust(top=.86, bottom=.12, left=.085, right=.97, hspace=.17)
    fig.savefig(output, dpi=160)
    plt.close(fig)


def plot_ya70(csv, output):
    import pandas as pd
    from event_detection.viewer import Recording
    from event_detection.dynamic_baseline_v3 import compute
    from event_detection.research.residual_recovery import compare
    plt = _plotting()
    path = Path(csv)
    recording = Recording(path.read_bytes(), path.name)
    result = compute(recording, 'detrended_abs', 5, 10)
    comparison = compare(result, recording.meta['raw_duration'])
    a, b = 6400, 6510
    frame = pd.DataFrame({n:recording.channels[n] for n in ('流量', '压力', '漏气量') if n in recording.channels})
    groups = frame.groupby(np.floor(recording.x).astype(int))
    med, lower, upper = groups.median(), groups.quantile(.05), groups.quantile(.95)
    fig, axes = plt.subplots(3, 1, figsize=(14, 8), sharex=True)
    selected = (med.index>=a)&(med.index<=b)
    x = med.index[selected]
    axes[0].fill_between(x, lower.loc[x,'流量'], upper.loc[x,'流量'], color='#93c5fd', alpha=.4, label='每源秒 p05–p95')
    axes[0].plot(x,med.loc[x,'流量'], color='#1d4ed8', linewidth=1, label='每源秒中位数')
    axes[0].set_ylabel('机器总流量（L/min）')
    clock = result['source']['clock']
    scope = (clock>=a)&(clock<=b)
    remaining = result['traces']['remaining']
    axes[1].plot(clock[scope], remaining[scope], color='#1d4ed8', label='5 秒主窗剩余比')
    axes[1].axhline(.5, color='#d97706', linestyle='--', linewidth=1, label='50% 试验门限')
    axes[1].set_ylabel('主窗强度 / 参考')
    axes[2].plot(x,med.loc[x,'漏气量'], color='#0f766e',label='总漏气中位数')
    axes[2].set_ylabel('总漏气率（L/min）')
    seen_original = seen_difference = False
    for event in result['events']:
        if event['start']<b and event['end']>a:
            for axis in axes:
                axis.axvspan(event['start'],event['end'],color='#94a3b8',alpha=.24,
                             label='原算法输出' if axis is axes[0] and not seen_original else None)
            seen_original=True
    for difference in comparison['review_differences']:
        if difference['start']<b and difference['end']>a:
            for axis in axes:
                axis.axvspan(difference['start'],difference['end'],color='#fbbf24',alpha=.22,
                             label='待复核差异' if axis is axes[0] and not seen_difference else None)
            seen_difference=True
    for axis in axes:
        axis.grid(alpha=.18)
        axis.legend(loc='upper left',fontsize=8,ncol=3,frameon=False)
    axes[-1].set_xlim(a,b)
    axes[-1].set_xlabel('CSV 原始相对秒；秒内采样时钟尚未验证，因此这里展示源秒统计')
    fig.suptitle('YA70 对照实验 · 长减弱过程中的剩余片段',x=.075,ha='left',fontsize=17,weight='bold')
    fig.text(.075,.915,'当前默认 v3：detrended_abs / 5 秒窗 / 最短 10 秒。灰色保留原输出；黄色仅提示复核，不作为新增事件。',fontsize=10,color='#64748b')
    fig.text(.075,.025,f"CSV 指纹 {recording.meta['file_id'][:16]} · 黄色不是人工真值，也不证明精确率或召回率提高。",fontsize=9,color='#64748b')
    fig.subplots_adjust(top=.86,bottom=.12,left=.085,right=.97,hspace=.18)
    fig.savefig(output,dpi=160)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--s9-root',type=Path)
    parser.add_argument('--csv',type=Path)
    parser.add_argument('--output-dir',type=Path,required=True)
    args = parser.parse_args()
    if not args.s9_root and not args.csv:parser.error('Supply --s9-root and/or --csv')
    args.output_dir.mkdir(parents=True,exist_ok=True)
    for name,source,fn in [('s9-event-evidence.png',args.s9_root,plot_s9),('ya70-residual-evidence.png',args.csv,plot_ya70)]:
        if source:
            output=args.output_dir/name
            if output.exists():raise FileExistsError(output)
            fn(source,output)
            print(output.resolve())


if __name__ == '__main__':
    main()
