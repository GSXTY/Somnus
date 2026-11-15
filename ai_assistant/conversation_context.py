"""Build bounded model context from completed turns in one conversation."""
from dataclasses import dataclass
import json
import re


RECENT_TURNS = 12
RECENT_BYTES = 24_000
RECENT_ESTIMATE = 8_000
SUMMARY_BYTES = 4_800
SUMMARY_ESTIMATE = 1_600
FIRST_ROWS = 64
LAST_ROWS = 256
EXCERPT_CHARS = 1_200
MAX_PAIR_BYTES = 8_000
MAX_PAIR_ESTIMATE = 2_700
RESERVED_PAIR_BYTES = 1_250
RESERVED_PAIR_ESTIMATE = 420
CLIPPED = '\n[历史消息节选]\n'
ASSISTANT_TASK_LINK = re.compile(r'\n*\[查看深度分析任务\]\(/#deep-analysis[^\n)]*\)\s*$')
STAKE = re.compile(
    r'请记住|记住|约定|以后|始终|必须|只能|一律|不要|禁止|不能|要求|优先|偏好|决定|命名为|'
    r'\b(?:remember|agreed?|shall|must|always|never|only|prefer\w*|decided?|require\w*|do not|use .{1,30} for .{1,30})\b',
    re.I,
)
FILLER = re.compile(r'^(?:你好|您好|谢谢|多谢|好的|收到|明白了|了解了|可以|没问题|hi|hello|ok(?:ay)?|thanks|sure|got it)[.!?。！？\s]*$', re.I)
FENCED = re.compile(r'(?ms)^\s*(?:```|~~~)[^\n]*\n.*?(?:^\s*(?:```|~~~)[^\n]*$|\Z)')
DATA = re.compile(r'data:[\w.+\-/]+;base64,|[a-z0-9+/=]{180}', re.I)


@dataclass(frozen=True)
class Turn:
    user_id: str
    reply_id: str
    question: str
    answer: str
    transport: str | None = None


def _metrics(text):
    # A conservative planning estimate. The actual tokenizer depends on the model.
    non_ascii = sum(not char.isascii() for char in text)
    return len(text.encode('utf-8')), non_ascii + (len(text) - non_ascii + 3) // 4


def _fits(text, byte_limit, estimate_limit):
    size, estimate = _metrics(text)
    return size <= byte_limit and estimate <= estimate_limit


def _edge(text, byte_limit, estimate_limit, *, tail=False):
    low, high = 0, min(len(text), byte_limit)
    while low < high:
        middle = (low + high + 1) // 2
        excerpt = text[-middle:] if tail else text[:middle]
        if _fits(excerpt, byte_limit, estimate_limit):
            low = middle
        else:
            high = middle - 1
    return (text[-low:] if tail else text[:low]) if low else ''


def _clip(text, byte_limit, estimate_limit):
    if _fits(text, byte_limit, estimate_limit):
        return text
    marker_bytes, marker_tokens = _metrics(CLIPPED)
    if byte_limit <= marker_bytes or estimate_limit <= marker_tokens:
        return _edge(text, max(0, byte_limit), max(0, estimate_limit))
    head_bytes = (byte_limit - marker_bytes) * 2 // 3
    head_tokens = (estimate_limit - marker_tokens) * 2 // 3
    head = _edge(text, head_bytes, head_tokens)
    tail = _edge(text, byte_limit - marker_bytes - head_bytes,
                 estimate_limit - marker_tokens - head_tokens, tail=True)
    return head.rstrip() + CLIPPED + tail.lstrip()


def _sample(db, cid, before, *, text_only):
    # Index-backed scans from both ends keep early decisions available without loading
    # the whole transcript or any encoded attachments. Pair only adjacent messages.
    boundary = db.execute('SELECT rowid FROM messages WHERE id=? AND conversation_id=?', (before, cid)).fetchone()
    if not boundary:
        return []
    upper = boundary[0]

    def read(order, lower, stop, limit):
        return db.execute(f'''SELECT rowid, id, role, status, transport,
            substr(content,1,?) AS excerpt FROM messages
            WHERE conversation_id=? AND rowid >= ? AND rowid < ?
            ORDER BY rowid {order} LIMIT ?''', (EXCERPT_CHARS, cid, lower, stop, limit)).fetchall()

    first = read('ASC', 0, upper, FIRST_ROWS)
    last = read('DESC', 0, upper, LAST_ROWS)
    middle = []
    if first and last and first[-1]['rowid'] < last[-1]['rowid']:
        start, stop = first[-1]['rowid'] + 1, last[-1]['rowid']
        for index in range(4):
            checkpoint = start + (stop - start) * index // 4
            middle.append(read('ASC', checkpoint, stop, 32))
    # Walk each contiguous window separately, so no pair crosses the unsampled gap.
    turns = {}
    for window in (first, *middle, reversed(last)):
        pending = None
        for row in window:
            if row['role'] == 'user':
                pending = row
                continue
            if (pending is not None and row['role'] == 'assistant'
                    and pending['status'] == row['status'] == 'complete'
                    and pending['transport'] == row['transport']):
                question, answer = pending['excerpt'], row['excerpt']
                if not (text_only or row['transport'] is not None) or (
                        question.strip() and answer.strip() and question != '[已添加文件]'):
                    turns[row['rowid']] = Turn(pending['id'], row['id'], question, answer, row['transport'])
            pending = None
    return [turns[key] for key in sorted(turns)]


def _excerpts(turn):
    for role, text in (('用户', turn.question), ('助手', turn.answer)):
        text = FENCED.sub('', ASSISTANT_TASK_LINK.sub('', text))
        lines = re.split(r'[\r\n]+|(?<=[。！？!?])\s*|(?<=\.)\s+', text)
        kept = 0
        for line in lines:
            line = ' '.join(line.strip(' \t-*#>').split())
            if (not line or FILLER.fullmatch(line) or line.count('|') >= 2
                    or line.startswith(('{', '[')) or DATA.search(line)):
                continue
            important = role == '用户' and bool(STAKE.search(line))
            if kept >= (3 if role == '用户' else 1) and not important:
                continue
            if role == '助手' and (line.casefold() in ('ok', 'confirmed.', 'confirmed', 'done.', 'done')
                                  or re.search(r'[;{}]|=>|\b(?:SELECT|INSERT|UPDATE)\s', line)):
                continue
            kept += 1
            excerpt = line if len(line) <= 240 else line[:237] + '…'
            yield important, role, excerpt


def _summary(turns):
    groups = [list(_excerpts(turn)) for turn in turns]
    accepted = []
    seen = set()
    remaining_bytes, remaining_tokens = SUMMARY_BYTES, SUMMARY_ESTIMATE

    def collect(indices, wanted, quota):
        nonlocal remaining_bytes, remaining_tokens
        for index in indices:
            for important, role, text in groups[index]:
                if not wanted(important, role):
                    continue
                key = re.sub(r'[\s。.!！？?：:]+', '', text.casefold())
                line = f'- {role}：{text}\n'
                size, estimate = _metrics(line)
                if key in seen or size > min(quota, remaining_bytes) or estimate > remaining_tokens:
                    continue
                seen.add(key)
                accepted.append((index, len(accepted), line))
                remaining_bytes -= size
                remaining_tokens -= estimate
                quota -= size

    earliest = range(min(12, len(groups)))
    newest = range(len(groups) - 1, -1, -1)
    collect(earliest, lambda important, role: important, SUMMARY_BYTES // 3)
    collect(newest, lambda important, role: important, remaining_bytes)
    collect(earliest, lambda important, role: role == '用户', SUMMARY_BYTES // 6)
    collect(newest, lambda important, role: role == '用户', remaining_bytes * 3 // 4)
    collect(newest, lambda important, role: role == '助手', remaining_bytes)
    return ''.join(line for _, _, line in sorted(accepted)).rstrip()


def previous_completed_reply(db, cid, before):
    row = db.execute('''SELECT id FROM messages WHERE conversation_id=? AND role='assistant'
        AND status='complete' AND rowid < (SELECT rowid FROM messages WHERE id=? AND conversation_id=?)
        ORDER BY rowid DESC LIMIT 1''', (cid, before, cid)).fetchone()
    return row['id'] if row else None


def build(db, cid, before, *, text_only=False, current_images=None, image_limit=0):
    turns = _sample(db, cid, before, text_only=text_only)
    recent, prior = turns[-RECENT_TURNS:], turns[:-RECENT_TURNS]
    selected = []
    remaining_bytes, remaining_tokens = RECENT_BYTES, RECENT_ESTIMATE
    image_count = len(current_images or [])
    image_bytes = sum(item['size'] for item in current_images or [])
    for index, turn in enumerate(reversed(recent)):
        # Only the recent window needs full text or the original images. An old
        # assistant can store 100k characters, so even this projection is bounded.
        if text_only or current_images is None or turn.transport is not None:
            body = db.execute('SELECT content FROM messages WHERE id=?', (turn.user_id,)).fetchone()[0]
            images = []
        else:
            question = db.execute('SELECT content, attachments FROM messages WHERE id=?', (turn.user_id,)).fetchone()
            body = question['content']
            images = json.loads(question['attachments'])
        batch_bytes = sum(item['size'] for item in images)
        if image_count + len(images) > 4 or image_bytes + batch_bytes > image_limit:
            # Keep the whole-pair image behavior and preserve explicit decisions from
            # skipped image turns without rebroadcasting their visual evidence.
            prior.extend(Turn(item.user_id, item.reply_id, item.question, '')
                         for item in recent[:len(recent) - index] if STAKE.search(item.question))
            break
        answer = db.execute('SELECT content FROM messages WHERE id=?', (turn.reply_id,)).fetchone()[0]
        if text_only or turn.transport is not None:
            answer = ASSISTANT_TASK_LINK.sub('', answer).rstrip()
            if not answer:
                continue
        # Leave room for the other recent pairs when one turn is exceptionally large.
        still_older = len(recent) - index - 1
        byte_limit = min(MAX_PAIR_BYTES, remaining_bytes - 32 - still_older * RESERVED_PAIR_BYTES)
        estimate_limit = min(MAX_PAIR_ESTIMATE, remaining_tokens - 16 - still_older * RESERVED_PAIR_ESTIMATE)
        qb, qt = _metrics(body)
        ab, at = _metrics(answer)
        if qb + ab > byte_limit or qt + at > estimate_limit:
            original_body = body
            body = _clip(body, byte_limit - min(ab, byte_limit // 2),
                         estimate_limit - min(at, estimate_limit // 2))
            qb, qt = _metrics(body)
            answer = _clip(answer, byte_limit - qb, estimate_limit - qt)
            ab, at = _metrics(answer)
            if body != original_body and STAKE.search(turn.question):
                prior.append(Turn(turn.user_id, turn.reply_id, turn.question, ''))
        batch = [dict(role='user', content=body), dict(role='assistant', content=answer)]
        if current_images is not None:
            batch[0]['attachments'] = images
            batch[1]['attachments'] = []
        selected[0:0] = batch
        remaining_bytes -= qb + ab + 32
        remaining_tokens -= qt + at + 16
        image_count += len(images)
        image_bytes += batch_bytes
    return _summary(prior), selected
