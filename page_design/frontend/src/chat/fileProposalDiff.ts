function lines(text: string | null) {
  if (!text) return [];
  const content = text.replace(/\r\n/g, '\n');
  return (content.endsWith('\n') ? content.slice(0, -1) : content).split('\n');
}

function changedRange(before: string | null, after: string) {
  const oldLines = lines(before), newLines = lines(after);
  let start = 0, endOld = oldLines.length, endNew = newLines.length;
  while (start < endOld && start < endNew && oldLines[start] === newLines[start]) start++;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) { endOld--; endNew--; }
  return { oldLines, newLines, start, endOld, endNew };
}

const maxDiffWork = 200_000;

export function lineCounts(before: string | null, after: string) {
  const { oldLines, newLines, start, endOld, endNew } = changedRange(before, after);
  if ((endOld - start) * (endNew - start) > maxDiffWork) return null;
  const shared = new Uint32Array(endNew - start + 1);
  for (let i = start; i < endOld; i++) {
    let diagonal = 0;
    for (let j = 1; j < shared.length; j++) {
      const previous = shared[j];
      shared[j] = oldLines[i] === newLines[start + j - 1] ? diagonal + 1 : Math.max(shared[j], shared[j - 1]);
      diagonal = previous;
    }
  }
  return { added: endNew - start - shared[shared.length - 1], removed: endOld - start - shared[shared.length - 1] };
}

type DiffLine = { kind: 'context' | 'added' | 'removed'; text: string; oldNumber?: number; newNumber?: number };
type Hunk = { header: string; rows: DiffLine[]; omittedBefore: number; omittedAfter: number };

export function unifiedFileDiff(before: string | null, after: string): Hunk[] | null {
  const { oldLines, newLines, start, endOld, endNew } = changedRange(before, after);
  const height = endOld - start, width = endNew - start;
  if (!height && !width) return [];
  if (height * width > maxDiffWork || height + width > 8000) return null;

  const stride = width + 1;
  const shared = new Uint32Array((height + 1) * stride);
  for (let i = height - 1; i >= 0; i--) {
    for (let j = width - 1; j >= 0; j--) {
      const cell = i * stride + j;
      shared[cell] = oldLines[start + i] === newLines[start + j]
        ? shared[cell + stride + 1] + 1 : Math.max(shared[cell + 1], shared[cell + stride]);
    }
  }
  const context = 3;
  const leading = Math.max(0, start - context);
  const rows: DiffLine[] = [];
  for (let line = leading; line < start; line++) {
    rows.push({ kind: 'context', text: oldLines[line], oldNumber: line + 1, newNumber: line + 1 });
  }
  let i = 0, j = 0;
  while (i < height || j < width) {
    if (i < height && j < width && oldLines[start + i] === newLines[start + j]) {
      rows.push({ kind: 'context', text: oldLines[start + i], oldNumber: start + ++i, newNumber: start + ++j });
    } else if (i < height && (j === width || shared[(i + 1) * stride + j] >= shared[i * stride + j + 1])) {
      rows.push({ kind: 'removed', text: oldLines[start + i], oldNumber: start + ++i });
    } else {
      rows.push({ kind: 'added', text: newLines[start + j], newNumber: start + ++j });
    }
  }
  const trailing = oldLines.length - endOld;
  for (let line = 0; line < Math.min(context, trailing); line++) {
    rows.push({ kind: 'context', text: oldLines[endOld + line], oldNumber: endOld + line + 1, newNumber: endNew + line + 1 });
  }
  const groups: { start: number; end: number }[] = [];
  rows.forEach((row, index) => {
    if (row.kind === 'context') return;
    const start = Math.max(0, index - context), end = Math.min(rows.length, index + context + 1);
    const last = groups[groups.length - 1];
    if (last && start <= last.end) last.end = end;
    else groups.push({ start, end });
  });
  let oldBefore = leading, newBefore = leading, cursor = 0;
  return groups.map((group, index) => {
    const omittedBefore = group.start - cursor + (index === 0 ? leading : 0);
    oldBefore += group.start - cursor;
    newBefore += group.start - cursor;
    const hunkRows = rows.slice(group.start, group.end);
    const oldCount = hunkRows.filter(row => row.oldNumber !== undefined).length;
    const newCount = hunkRows.filter(row => row.newNumber !== undefined).length;
    const header = '@@ -' + (oldBefore + Number(oldCount > 0)) + ',' + oldCount +
      ' +' + (newBefore + Number(newCount > 0)) + ',' + newCount + ' @@';
    oldBefore += oldCount;
    newBefore += newCount;
    cursor = group.end;
    return { header, rows: hunkRows, omittedBefore, omittedAfter: index === groups.length - 1 ? Math.max(0, trailing - context) : 0 };
  });
}
