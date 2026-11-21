"""Isolated, read-only CSV trial using the existing dynamic_baseline detector."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import pandas as pd
from event_detection.dynamic_baseline_detector import detect, settings


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def load_recording(path):
    raw = path.read_bytes()
    try:
        frame = pd.read_csv(io.BytesIO(raw), encoding='utf-8-sig')
        encoding = 'utf-8-sig'
    except UnicodeDecodeError:
        frame = pd.read_csv(io.BytesIO(raw), encoding='gb18030')
        encoding = 'gb18030'
    frame = frame.dropna(how='all').reset_index(drop=True)
    if frame.empty or len(frame.columns) < 2:
        raise ValueError('CSV需要时间列和数值通道')
    clock = pd.to_datetime(frame.iloc[:, 0], errors='coerce')
    if clock.isna().any():
        raise ValueError('存在无效时间戳')
    seconds = (clock-clock.iloc[0]).dt.total_seconds().to_numpy()
    if np.any(np.diff(seconds) < 0) or seconds[-1] <= 0:
        raise ValueError('时间倒序或记录持续时间无效')
    channels = {str(col): pd.to_numeric(frame[col], errors='coerce').to_numpy(dtype=float)
                for col in frame.columns[1:]}
    if '流量' not in channels or not np.isfinite(channels['流量']).any():
        raise ValueError('缺少有效流量通道')
    gaps = [[float(seconds[i]), float(seconds[i+1])]
            for i in np.flatnonzero(np.diff(seconds) > 1)]
    metadata = dict(name=path.name, file_id=hashlib.sha256(raw).hexdigest(),
                    rows=len(frame), start=str(clock.iloc[0]), end=str(clock.iloc[-1]),
                    raw_duration=float(seconds[-1]), encoding=encoding,
                    source_columns=list(frame.columns), source_bytes=len(raw),
                    recorded_seconds=int(len(np.unique(seconds))), gaps=gaps,
                    timestamp_policy='original source timestamps; no interpolation')
    return SimpleNamespace(x=seconds, channels=channels, gaps=gaps, meta=metadata)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).parent/'runs',
                        help='Parent directory for a new, unique batch output folder')
    args = parser.parse_args()
    paths = sorted(args.input.glob('*.csv'))
    if not paths:
        raise SystemExit('输入目录没有CSV')
    output = args.output/datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    output.mkdir(parents=True, exist_ok=False)
    config = settings()
    manifest = dict(created_at=datetime.now(timezone.utc).isoformat(), input=str(args.input.resolve()),
                    algorithm=config, purpose='batch pipeline trial; user selected dynamic baseline; default method/window used',
                    identity='file device identifiers differ; common user ownership unverified',
                    clinical_scoring=False, files=[])
    summary = []
    errors = []
    for number, path in enumerate(paths, 1):
        begin = time.perf_counter()
        print(f'[{number}/{len(paths)}] START {path.name}', flush=True)
        entry = dict(filename=path.name, status='failed')
        try:
            recording = load_recording(path)
            result = detect(recording)
            origin = datetime.fromisoformat(recording.meta['start'])
            events = result['events']
            for event in events:
                event['duration_seconds'] = event['end']-event['start']
                event['wall_start'] = str(origin+timedelta(seconds=event['start']))
                event['wall_end'] = str(origin+timedelta(seconds=event['end']))
            stem = f'{number:02d}_{recording.meta["file_id"][:12]}'
            save_json(output/f'{stem}_results.json', dict(recording=recording.meta, result=result))
            columns = ['id','type','start','end','duration_seconds','wall_start','wall_end','status']
            pd.DataFrame(events).reindex(columns=columns).to_csv(output/f'{stem}_events.csv', index=False, encoding='utf-8-sig')
            counts = Counter(event['type'] for event in events)
            entry.update(status='completed', metadata=recording.meta,
                         candidate_count=len(events), counts=dict(counts),
                         eligible_seconds=result['eligible_seconds'], result_file=f'{stem}_results.json')
            summary.append(dict(filename=path.name, status='completed', start=recording.meta['start'],
                                end=recording.meta['end'], rows=recording.meta['rows'],
                                duration_hours=recording.meta['raw_duration']/3600,
                                eligible_seconds=result['eligible_seconds'], candidates=len(events),
                                **{kind: counts[kind] for kind in config['event_types']}))
            del recording, result, events
        except Exception as exc:
            entry['error'] = f'{type(exc).__name__}: {exc}'
            errors.append(dict(filename=path.name, error=entry['error']))
            summary.append(dict(filename=path.name, status='failed', error=entry['error']))
        entry['elapsed_seconds'] = round(time.perf_counter()-begin, 3)
        manifest['files'].append(entry)
        save_json(output/'manifest.json', manifest)
        print(f'[{number}/{len(paths)}] {entry["status"]} candidates={entry.get("candidate_count", "unknown")} elapsed={entry["elapsed_seconds"]}s', flush=True)
    pd.DataFrame(summary).to_csv(output/'summary.csv', index=False, encoding='utf-8-sig')
    save_json(output/'errors.json', errors)
    lines = ['# CSV批量执行试跑结果', '',
             '本次为独立离线流程验证，使用用户选择的原始动态基线方案及默认方法和窗口。',
             f'算法版本 {config["version"]}，centered_rms、2秒窗口、固定10秒持续门限，剩余比例25%/50%。',
             '文件涉及不同设备标识，尚未验证是否属于同一用户，结果按文件独立输出。',
             '流量语义沿用现有算法配置，未独立校准。输出为待复核候选，未作临床评分。', '',
             '| 文件 | 状态 | 行数 | 时长（小时） | 候选数 |', '|---|---|---:|---:|---:|']
    for row in summary:
        lines.append(f'| {row["filename"]} | {row["status"]} | {row.get("rows", "")} | {row.get("duration_hours", 0):.3f} | {row.get("candidates", "未知")} |')
    lines += ['', '候选数含数据缺失和信号异常，分类详见 summary.csv。失败与完成后零候选分别记录。',
              '每份文件输出 results.json 完整证据与 events.csv 事件表。manifest.json 保存来源指纹、参数和状态。',
              '输入按源时间读取，未重采样。批次独立保存，原始文件保持原样。']
    (output/'report.md').write_text('\n'.join(lines), encoding='utf-8')
    print(f'OUTPUT {output.resolve()}', flush=True)
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
