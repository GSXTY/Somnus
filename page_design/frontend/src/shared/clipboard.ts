declare global {
  interface Window {
    somnusClipboard?: { writeText: (text: string) => Promise<void> };
  }
}

export async function copyText(text: string) {
  if (window.somnusClipboard?.writeText) {
    await window.somnusClipboard.writeText(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Browser deployments may lack access to the async clipboard API.
    }
  }
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const focused = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('无法访问剪贴板');
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (selection && ranges.length) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
