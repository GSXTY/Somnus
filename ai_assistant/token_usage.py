"""Normalize and aggregate model-reported token counts."""

MAX_SAFE_INTEGER = (1 << 53) - 1


def valid_count(value):
    return type(value) is int and 0 <= value <= MAX_SAFE_INTEGER


def valid_cached_count(value, input_tokens):
    return valid_count(value) and value <= input_tokens


def completion_counts(usage):
    if not isinstance(usage, dict):
        return None
    input_tokens, output_tokens = usage.get('prompt_tokens'), usage.get('completion_tokens')
    if not all(valid_count(value) for value in (input_tokens, output_tokens)):
        return None
    details = usage.get('prompt_tokens_details')
    cached_tokens = details.get('cached_tokens') if isinstance(details, dict) else None
    if not valid_cached_count(cached_tokens, input_tokens):
        cached_tokens = usage.get('prompt_cache_hit_tokens')
    if not valid_cached_count(cached_tokens, input_tokens):
        cached_tokens = None
    return input_tokens, output_tokens, cached_tokens


def record(meta, requests, *, interrupted):
    input_tokens = output_tokens = cached_tokens = counted = cache_counted = 0
    for counts in requests:
        if counts is None:
            continue
        new_input, new_output = input_tokens + counts[0], output_tokens + counts[1]
        if new_input <= MAX_SAFE_INTEGER and new_output <= MAX_SAFE_INTEGER:
            input_tokens, output_tokens = new_input, new_output
            counted += 1
            if counts[2] is not None:
                cached_tokens += counts[2]
                cache_counted += 1
    if not counted:
        meta.pop('usage', None)
        meta['usage_unavailable'] = True
        return
    meta.pop('usage_unavailable', None)
    usage = dict(input_tokens=input_tokens, output_tokens=output_tokens)
    if cache_counted == len(requests):
        usage['cached_input_tokens'] = cached_tokens
    if interrupted or counted != len(requests):
        usage['partial'] = True
    meta['usage'] = usage
