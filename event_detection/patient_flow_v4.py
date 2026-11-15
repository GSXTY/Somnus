"""Independent patient-flow candidate experiment; does not reproduce OSCAR scoring.

OSCAR inspires the p60 robust-reference concept and evidence/review workflow,
not the thresholds or a copied implementation. Its per-breath whole-chunk
peak reference is adapted here to past-only source-second meanabs. No patient-flow reconstruction, leak subtraction, DC
removal, unverified 1 Hz filtering, or clinical hypopnea confirmation occurs.
"""
from collections import deque
from datetime import datetime, timezone
import copy
import hashlib
import json
import math

import numpy as np

from event_detection.dynamic_baseline_comparison import source_seconds

PROFILE = 'patient_flow_v4'
VERSION = 'patient-flow-v4-experimental-v2'
WINDOWS = tuple(range(1, 11))
TYPES = ('呼吸暂停候选', '低通气候选', '数据缺失', '信号异常')


def names(window):
    return [f'患者流量v4{window}秒'+suffix for suffix in
            ('强度', '参考', '10%门限', '70%门限', '剩余比例', '1秒强度', '1秒参考')]


CHANNELS = tuple(name for window in WINDOWS for name in names(window))


def _at_most(value, threshold):
    # Ratios are dimensionless. Avoid binary rounding changing exact 90%/30%
    # reduction tests; this tolerance is not a tunable physiological threshold.
    return value <= threshold + 1e-12


def settings(min_duration=10, event_types=None, dynamic_method=None, window_seconds=None):
    method = 'absolute_mean' if dynamic_method is None else dynamic_method
    window = 5 if window_seconds is None else window_seconds
    if method != 'absolute_mean':
        raise ValueError('患者流量v4仅支持absolute_mean：患者流量绝对值均值')
    if (isinstance(window, bool) or not isinstance(window, (int, float))
            or not math.isfinite(window) or window not in WINDOWS):
        raise ValueError('患者流量v4检测窗口请选择1～10秒整数')
    if isinstance(min_duration, bool) or not isinstance(min_duration, (int, float)) or min_duration != 10:
        raise ValueError('患者流量v4最短持续固定10秒')
    if (event_types is not None and (not isinstance(event_types, list) or not event_types
            or any(t not in TYPES for t in event_types))):
        raise ValueError('患者流量v4事件类型无效')
    return dict(profile=PROFILE, version=VERSION, method=method, window_seconds=int(window),
                min_duration=10, event_types=[t for t in TYPES if event_types is None or t in event_types],
                flow_source='csv_flow', flow_semantics='user_confirmed_patient_flow',
                user_confirmed_patient_flow=True, flow_unit='L/min',
                amplitude='equal-source-second mean(abs(patient_flow)); no division by two',
                amplitude_validation='meanabs_proxy_not_validated_clinical_peak_excursion',
                apnea_remaining_ratio=.1, hypopnea_remaining_ratio=.7,
                near_ratio=.1, reduction_ratio=.7,
                threshold_origin='engineering_starting_configuration_not_OSCAR_thresholds',
                baseline_seconds=120, baseline_quantile=.6, min_reference_seconds=30,
                baseline_quantile_method='numpy.quantile(method=linear); past accepted rows excluding current source second',
                ratio_comparison_tolerance=1e-12,
                baseline_policy='past accepted source seconds only; freeze on main<=70% or fast<=10%; short rejected valid dips may join future history after recovery; held same-segment reference until 30 accepted seconds rebuild; no retrospective trace rewrite',
                pretrigger_evidence='at most W already-observed valid source seconds rechecked using frozen reference; no fixed backdating',
                recovery_remaining_ratio=.8, recovery_seconds=2,
                recovery_rule='both main and fast >80% for two consecutive valid source seconds',
                timing='apnea and hypopnea: continuous fast source-bin coverage with main-window support; no fixed window backdating',
                episode_policy='one output per unrecovered episode; qualifying apnea priority, otherwise hypopnea fallback; shoulders retained as evidence',
                finalization='emit on sustained recovery, quality reset, or recording end; finalized_at is observed availability, not threshold_met_at',
                leak_subtraction=False, background_removal=False, lowpass_1hz=False,
                uniform_sampling_verified=False, clinical_scoring=False,
                hypopnea_confirmation='unavailable_without_desaturation_or_arousal',
                oscar_inspiration='p60 robust-reference concept adapted from OSCAR UF peak references to causal source-second meanabs; waveform/event evidence and duplicate-review workflow; not OSCAR thresholds, implementation, or ResMed firmware',
                device_control=False)


def _runs(rows, predicate, source_coverage):
    """Fast bins cover [tick-1,tick); main comparisons use actual end instants."""
    runs, selected = [], []
    for row in rows:
        if predicate(row):
            if selected and row['tick'] != selected[-1]['tick']+1:
                runs.append(selected)
                selected = []
            selected.append(row)
        elif selected:
            runs.append(selected)
            selected = []
    if selected:
        runs.append(selected)
    return [dict(start=r[0]['tick']-1 if source_coverage else r[0]['tick'],
                 end=r[-1]['tick'], rows=r) for r in runs]


def compute(recording, method=None, window=None, min_duration=10):
    config = settings(min_duration, dynamic_method=method, window_seconds=window)
    window = config['window_seconds']
    cache = getattr(recording, '_patient_flow_v4_cache', None)
    if cache is None:
        cache = {}
        recording._patient_flow_v4_cache = cache
    if window in cache:
        return cache[window]
    source = source_seconds(recording)
    size = len(source['clock'])
    # source_seconds already holds per-second mean(abs(flow))/2. Explicitly
    # undo that engineering comparison scale; output is meanabs in L/min.
    fast_values = source['means']['absolute'].to_numpy(dtype=float)*2
    traces = {n: np.full(size, np.nan) for n in
              ('strength', 'reference', 'remaining', 'fast', 'fast_reference', 'fast_remaining')}
    history, short, recent = deque(), deque(maxlen=window), deque(maxlen=window)
    episode, events = None, []
    previous_segment = None
    held_reference = None

    def close(reason, finalized_at):
        nonlocal episode
        if episode is None:
            return False
        parent, episode = episode, None
        rows = parent['rows']
        if not rows:
            return False
        fast_runs = _runs(rows, lambda r: _at_most(r['fast_ratio'], .1), True)
        main_runs = _runs(rows, lambda r: _at_most(r['ratio'], .7), False)
        weak_runs = _runs(rows, lambda r: _at_most(r['fast_ratio'], .7), True)
        apneas = [run for run in fast_runs if run['end']-run['start'] >= 10
                  and any(run['start'] <= r['tick'] <= run['end']+window
                          and _at_most(r['ratio'], .7) for r in rows)]
        hypopneas = [run for run in weak_runs if run['end']-run['start'] >= 10
                     and any(run['start'] <= r['tick'] <= run['end']+window
                             and _at_most(r['ratio'], .7) for r in rows)]
        candidates = apneas or hypopneas
        if not candidates:
            return False
        # One label and one primary interval per unrecovered process. Separate
        # cores/shoulders remain inspectable; they are not additive counts.
        primary = max(candidates, key=lambda r: (r['end']-r['start'], -r['start']))
        a, b = primary['start'], primary['end']
        is_apnea = bool(apneas)
        threshold_met_at = a+10
        support = [r['tick'] for r in rows
                   if a <= r['tick'] <= b+window and _at_most(r['ratio'], .7)]
        threshold_met_at = max(threshold_met_at, min(support), parent['triggered_at'])
        # No lookahead shape correction or future-based reference rewrite.
        evidence = dict(schema=1, algorithm_version=VERSION,
                        user_confirmed_patient_flow=True, clinical_scoring=False,
                        hypopnea_confirmation='unavailable_without_desaturation_or_arousal',
                        flow_semantics='user_confirmed_patient_flow', flow_unit='L/min',
                        amplitude=config['amplitude'], method='absolute_mean', window_seconds=window,
                        amplitude_validation=config['amplitude_validation'],
                        minimum_duration=10, baseline_seconds=120, baseline_quantile=.6,
                        baseline_quantile_method=config['baseline_quantile_method'],
                        ratio_comparison_tolerance=1e-12,
                        main_reference_amplitude=parent['reference'], fast_reference_amplitude=parent['fast_reference'],
                        estimated_waveform_interval=[a, b], boundary_resolution_seconds=1,
                        boundary_basis='source_bin_coverage',
                        boundary_rule='at least 10 consecutive qualifying complete fast source bins, with main-window support; no fixed backdating',
                        threshold_remaining_ratio=.1 if is_apnea else .7,
                        threshold_met_at=threshold_met_at, confirmed_at=threshold_met_at,
                        triggered_at=parent['triggered_at'],
                        finalized_at=float(finalized_at), finalization_reason=reason,
                        boundary_censored=reason != 'sustained_recovery',
                        episode_start=parent['start'], episode_end=rows[-1]['tick'],
                        episode_interval=[parent['start'], rows[-1]['tick']],
                        reference_from_held_estimate=parent['reference_held'],
                        reference_age_at_trigger_seconds=parent['reference_age'],
                        pretrigger_evidence_seconds=parent['pretrigger_seconds'],
                        apnea_core_intervals=[[r['start'], r['end']] for r in fast_runs],
                        qualified_apnea_intervals=[[r['start'], r['end']] for r in apneas],
                        hypopnea_main_intervals=[[r['start'], r['end']] for r in main_runs],
                        hypopnea_source_intervals=[[r['start'], r['end']] for r in weak_runs],
                        qualified_hypopnea_intervals=[[r['start'], r['end']] for r in hypopneas],
                        mutually_exclusive_episode=True, episode_output_count=1,
                        suppressed_shoulder_counting=True,
                        episode_policy=config['episode_policy'],
                        remaining_ratio_median=float(np.median([r['ratio'] for r in primary['rows']])),
                        fast_remaining_ratio_median=float(np.median([r['fast_ratio'] for r in primary['rows']])),
                        leak_subtraction=False, background_removal=False, lowpass_1hz=False,
                        threshold_origin=config['threshold_origin'], oscar_inspiration=config['oscar_inspiration'],
                        review_flags=['工程候选；暂停分类未验证', '无血氧下降或觉醒支持，低通气不能临床确认']
                        + (['沿用同段最近有效参考，当前正常历史尚不足30秒；需复核'] if parent['reference_held'] else [])
                        + ([] if reason == 'sustained_recovery' else ['过程因质量边界或记录末端截断']))
        for key in ('apnea_core_intervals', 'qualified_apnea_intervals',
                    'hypopnea_main_intervals', 'hypopnea_source_intervals', 'qualified_hypopnea_intervals'):
            intervals = evidence[key]
            evidence[key+'_total_count'] = len(intervals)
            evidence[key+'_truncated'] = len(intervals) > 20
            evidence[key+'_total_seconds'] = sum(b-a for a, b in intervals)
            evidence[key] = intervals[:20]
        events.append(dict(start=float(a), end=float(b),
                           type='呼吸暂停候选' if is_apnea else '低通气候选', evidence=evidence))
        return True

    for i, tick in enumerate(source['clock']):
        tick = float(tick)
        segment = source['segment'][i]
        changed = segment != previous_segment
        if changed or not source['valid'][i]:
            # At tick the source bin ending at tick has been observed; a reset
            # can finalize the prior episode but cannot join its time coverage.
            close('segment_or_quality_reset', tick)
            history.clear()
            short.clear()
            recent.clear()
            held_reference = None
        previous_segment = segment
        if not source['valid'][i]:
            continue
        fast = float(fast_values[i])
        short.append(fast)
        traces['fast'][i] = fast
        if len(short) < window:
            continue
        strength = float(np.mean(short))
        traces['strength'][i] = strength
        recent.append(dict(tick=tick, strength=strength, fast=fast))
        while history and history[0][0] < tick-120:
            history.popleft()
        reference_held = False
        if episode:
            main_ref, fast_ref = episode['reference'], episode['fast_reference']
        elif len(history) >= 30:
            main_ref = float(np.quantile([r[1] for r in history], .6, method='linear'))
            fast_ref = float(np.quantile([r[2] for r in history], .6, method='linear'))
            if min(main_ref, fast_ref) > 1e-9:
                held_reference = dict(reference=main_ref, fast_reference=fast_ref, at=tick)
        elif held_reference is not None:
            main_ref, fast_ref = held_reference['reference'], held_reference['fast_reference']
            reference_held = True
        else:
            main_ref = fast_ref = None
        if main_ref is None or fast_ref is None or min(main_ref, fast_ref) <= 1e-9:
            history.append((tick, strength, fast))
            continue
        ratio, fast_ratio = strength/main_ref, fast/fast_ref
        traces['reference'][i], traces['fast_reference'][i] = main_ref, fast_ref
        traces['remaining'][i], traces['fast_remaining'][i] = ratio, fast_ratio
        row = dict(tick=tick, strength=strength, fast=fast, ratio=ratio, fast_ratio=fast_ratio)
        if episode is None:
            if not _at_most(ratio, .7) and not _at_most(fast_ratio, .1):
                history.append((tick, strength, fast))
                continue
            previous = [dict(r, ratio=r['strength']/main_ref, fast_ratio=r['fast']/fast_ref)
                        for r in list(recent)[:-1]]
            while previous and not (_at_most(previous[0]['fast_ratio'], .7)
                                    or _at_most(previous[0]['ratio'], .7)):
                previous.pop(0)
            episode = dict(start=previous[0]['tick']-1 if previous else tick-1,
                           reference=main_ref, fast_reference=fast_ref,
                           triggered_at=tick,
                           reference_held=reference_held,
                           reference_age=None if held_reference is None else tick-held_reference['at'],
                           pretrigger_seconds=len(previous), rows=previous, recovery_rows=[])
        episode['rows'].append(row)
        if ratio > .8 and fast_ratio > .8:
            episode['recovery_rows'].append(row)
            if len(episode['recovery_rows']) >= 2:
                recovery_rows = episode['recovery_rows'].copy()
                rejected_rows = [r for r in episode['rows'] if r['tick'] >= episode['triggered_at']]
                short_episode = tick-episode['triggered_at'] < 120
                emitted = close('sustained_recovery', tick)
                # A rejected short dip may be accepted only now, at recovery,
                # for FUTURE references. Never overwrite its historical trace.
                accepted_rows = rejected_rows if not emitted and short_episode else recovery_rows
                for r in accepted_rows:
                    history.append((r['tick'], r['strength'], r['fast']))
        else:
            episode['recovery_rows'].clear()
    close('recording_end', float(recording.meta['raw_duration']))
    result = dict(source=source, traces=traces, events=events, settings=config)
    cache[window] = result
    return result


def detect(recording, start=0, end=None, min_duration=10, event_types=None,
           dynamic_method=None, window_seconds=None):
    config = settings(min_duration, event_types, dynamic_method, window_seconds)
    end = recording.meta['raw_duration'] if end is None else end
    if (any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
            for v in (start, end)) or not 0 <= start < end <= recording.meta['raw_duration']):
        raise ValueError('患者流量v4分析范围无效')
    result = compute(recording, config['method'], config['window_seconds'], 10)
    identity = {k: v for k, v in config.items() if k != 'event_types'}
    events = []

    def add(a, b, kind, evidence, note):
        if kind not in config['event_types'] or b <= start or a >= end or b <= a:
            return
        evidence = copy.deepcopy(evidence)
        evidence.update(user_confirmed_patient_flow=True, clinical_scoring=False,
                        hypopnea_confirmation='unavailable_without_desaturation_or_arousal')
        if a < start or b > end:
            evidence.setdefault('review_flags', []).append('跨选区，保留完整区间')
        digest = hashlib.sha256(json.dumps([recording.meta['file_id'], a, b, kind, identity],
                                          sort_keys=True).encode()).hexdigest()[:32]
        events.append(dict(id='det-'+digest, start=float(a), end=float(b), type=kind,
                           channels=['流量'], mode='raw', source='detector', status='candidate',
                           detection_profile=PROFILE, detection_input='csv_flow', detection_version=VERSION,
                           detection_method='absolute_mean', detection_window_seconds=config['window_seconds'],
                           detection_min_duration=10, evidence=evidence, note=note,
                           updated_at=datetime.now(timezone.utc).isoformat()))

    for event in result['events']:
        add(event['start'], event['end'], event['type'], event['evidence'],
            '患者流量v4试验；CSV流量由用户确认为患者呼吸流量，直接使用绝对值均值L/min；'
            '暂停剩余≤10%、低通气剩余≤70%、固定10秒为工程初始配置，非OSCAR阈值；'
            '借鉴OSCAR的波形/事件证据复核流程，未复现其或ResMed算法。'
            '单个未充分恢复过程仅输出一个候选，肩部/核心见证据；无血氧/觉醒支持，不作临床确认。')
    for a, b in getattr(recording, 'gaps', []):
        add(float(a), float(b), '数据缺失', dict(schema=1, review_flags=['原始时间戳缺口；不跨缺口检测']),
            '原始时间戳缺口；重置参考和窗口。')
    source = result['source']
    invalid = ~source['valid']
    edges = np.diff(np.r_[False, invalid, False].astype(int))
    for a, b in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
        if b-a >= 10:
            add(float(a), float(b), '信号异常', dict(schema=1, review_flags=['无效源秒连续至少10秒']),
                '无效源秒连续至少10秒；不用于患者流量参考。')
    scope = (source['clock'] >= start) & (source['clock'] <= end)
    return dict(file_id=recording.meta['file_id'], settings=config, scan_start=start, scan_end=end, time_basis='raw',
                events=sorted(events, key=lambda e: (e['start'], e['type'])),
                analyzed_rows=len(recording.x),
                eligible_seconds=int(np.sum(np.isfinite(result['traces']['remaining']) & scope)),
                diagnostics=dict(candidate_episodes=len(result['events'])),
                warnings=['CSV流量语义由用户确认；不减漏气、不去背景、不假设秒内均匀高频时钟。',
                          '90%/30%下降与10秒是本方案工程初始配置，不是OSCAR或ResMed源码阈值。',
                          '仅波形候选；低通气缺少血氧下降/觉醒支持，暂停未作临床类型分类。',
                          '暂停/低通气均需完整连续源秒支持至少10秒，主窗只佐证；过去W秒缓冲核对边界，不固定回溯。',
                          'meanabs不是已验证的临床峰值幅度；逐秒连续支持是保守工程规则，可能漏掉有短峰的真实低通气。',
                          'threshold_met_at为达标时刻；finalized_at为恢复/截断后结果实际可得时刻，二者分开。',
                          '同一未充分恢复过程互斥输出一个候选，肩部和多个核心不可简单累计。'])


def waveform_channels(recording, requested, method='absolute_mean', min_duration=10):
    settings(min_duration, dynamic_method=method)
    answer = {}
    positions = np.searchsorted(np.arange(int(recording.meta['raw_duration']))+1,
                                recording.x, side='right')-1
    for window in WINDOWS:
        keys = names(window)
        if not any(key in requested for key in keys):
            continue
        traces = compute(recording, method, window, min_duration)['traces']
        reference = traces['reference']
        series = (traces['strength'], reference, reference*.1, reference*.7,
                  traces['remaining']*100, traces['fast'], traces['fast_reference'])
        for key, values in zip(keys, series):
            if key not in requested:
                continue
            out = np.full(len(recording.x), np.nan)
            valid = (positions >= 0) & (positions < len(values))
            out[valid] = values[positions[valid]]
            answer[key] = out
    return answer
