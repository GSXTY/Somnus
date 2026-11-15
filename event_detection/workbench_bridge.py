"""Read-only local detection context for the workbench host.

The caller holds the recording/store locks. This bridge never loads a file,
touches a cache, starts a scan, or infers user ownership from demo identities.
Counts describe all historical annotations of the current file, not distinct
clinical events. No waveform, source path, or user identity is returned.
"""

import re


def build_detection_context(recording, event_store=None):
    """Return a fresh JSON-compatible context; store read failures propagate.

    ``available`` means a local recording is open, not that a database user is
    bound or that annotation storage is available. Unavailable counts use zero
    placeholders with ``event_counts_available=False`` and an explicit warning.
    """
    context = {
        'available': recording is not None,
        'recording': None,
        'user_binding': {
            'verified': False,
            'user_id': None,
            'reason': '当前本地CSV尚未关联数据库用户',
        },
        'event_counts': {'candidate': 0, 'reviewed': 0, 'ignored': 0},
        'event_counts_available': False,
        'event_counts_scope': '当前文件全历史标记；跨批次可能重叠，不是独立临床事件数或临床AHI',
        'events_url': '/events',
        'limitations': [
            '首页演示用户与当前本地CSV没有已验证的归属关系，不能据此绑定。',
            '自动候选仍需人工复核；本入口不扫描、不修改标记或批次。',
            '记录时间跨度不是实际治疗时长或有效分析时长，不计算临床AHI。',
        ],
    }
    if recording is None:
        context['limitations'].append('尚未打开本地CSV，请进入事件检测页面添加文件；计数不可用。')
        return context

    meta = recording.meta
    # Both Windows and POSIX separators: never expose the source directory.
    name = re.split(r'[/\\]', str(meta.get('name', '')))[-1]
    context['recording'] = {
        'id': meta['file_id'],
        'name': name,
        'rows': meta.get('rows'),
        'raw_duration': meta.get('raw_duration'),
        'display_duration': meta.get('display_duration'),
        'time_basis': 'raw_duration为源时间戳轴跨度；display_duration为旧脚本估算展开轴跨度，单位秒。秒内采样时钟未经本入口验证，两轴不可直接混用。',
    }
    if event_store is None:
        context['limitations'].append('事件库不可用，计数为占位值，不代表当前文件没有标记。')
        return context

    packet = event_store.read(meta['file_id'])
    for event in packet.get('events', []):
        status = event.get('status')
        if status in context['event_counts']:
            context['event_counts'][status] += 1
    context['event_counts_available'] = True
    return context
