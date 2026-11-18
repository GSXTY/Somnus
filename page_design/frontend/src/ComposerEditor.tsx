import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { ClipboardEvent, FocusEvent, KeyboardEvent } from 'react';

export type ComposerReference = {
  id: string;
  kind: 'conversation' | 'quote' | 'file';
  label: string;
  offset: number;
  text?: string;
  fileId?: string;
};

export type ComposerEditorRef = {
  focus(): void;
  offset(): number | undefined;
  after(referenceId: string): void;
  root(): HTMLDivElement | null;
};

type Props = {
  ariaLabel: string;
  placeholder: string;
  controls?: string;
  activeDescendant?: string;
  value: string;
  references: ComposerReference[];
  disabled: boolean;
  onChange(value: string, references: ComposerReference[]): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onPaste(event: ClipboardEvent<HTMLDivElement>): void;
  onCompositionEnd(): void;
  onBlur(event: FocusEvent<HTMLDivElement>): void;
};

const limit = 12000;

function readDraft(root: DocumentFragment | HTMLDivElement, known: ComposerReference[]) {
  let name = '';
  const references: ComposerReference[] = [];
  const byId = new Map(known.map(reference => [reference.id, reference]));
  function visit(container: Node) {
    for (const [index, node] of Array.from(container.childNodes).entries()) {
      if (node.nodeType === Node.TEXT_NODE) { name += node.textContent || ''; continue; }
      if (!(node instanceof HTMLElement)) continue;
      const reference = node.dataset.composerReference ? byId.get(node.dataset.composerReference) : undefined;
      if (reference) { references.push({ ...reference, offset: Math.min(limit, name.length) }); continue; }
      if (node.tagName === 'BR') {
        if (node.nextSibling || name && container === root) name += '\n';
        continue;
      }
      if (index > 0 && (node.tagName === 'DIV' || node.tagName === 'P') && !name.endsWith('\n')) name += '\n';
      visit(node);
    }
  }
  visit(root);
  return { name: name.slice(0, limit), references };
}

function selectionOffset(root: HTMLDivElement, references: ComposerReference[]): number | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.focusNode || !root.contains(selection.focusNode)) return;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(selection.focusNode, selection.focusOffset);
  return readDraft(range.cloneContents(), references).name.length;
}

function positionCaret(root: HTMLDivElement, offset: number) {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  let consumed = 0;
  for (const node of root.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const size = node.textContent?.length || 0;
    if (consumed + size >= offset) { range.setStart(node, offset - consumed); range.collapse(true); break; }
    consumed += size;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertPlainText(root: HTMLDivElement, value: string) {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const text = root.ownerDocument.createTextNode(value);
  range.insertNode(text);
  range.setStartAfter(text);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export const ComposerEditor = forwardRef<ComposerEditorRef, Props>(function ComposerEditor(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const after = useRef<string>();
  const { references, value, disabled } = props;
  useImperativeHandle(ref, () => ({
    focus() { root.current?.focus(); },
    offset() { return root.current ? selectionOffset(root.current, references) : undefined; },
    after(referenceId) { after.current = referenceId; },
    root() { return root.current; },
  }), [references]);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node || composing.current) return;
    const current = readDraft(node, references);
    if (current.name === value && current.references.length === references.length &&
      current.references.every((reference, index) => reference.id === references[index].id && reference.offset === references[index].offset) &&
      node.querySelectorAll('[data-composer-reference]').length === references.length) return;

    const caret = selectionOffset(node, references);
    const fragment = node.ownerDocument.createDocumentFragment();
    let offset = 0;
    for (const reference of references) {
      const at = Math.min(value.length, Math.max(offset, reference.offset));
      if (at > offset) fragment.append(value.slice(offset, at));
      const chip = node.ownerDocument.createElement('span');
      chip.className = 'assistant-inline-reference';
      chip.dataset.composerReference = reference.id;
      chip.dataset.kind = reference.kind;
      chip.contentEditable = 'false';
      chip.title = reference.label;
      const label = node.ownerDocument.createElement('span');
      label.textContent = reference.label;
      const remove = node.ownerDocument.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.disabled = disabled;
      remove.dataset.removeReference = reference.id;
      remove.setAttribute('aria-label', '移除引用 ' + reference.label);
      chip.append(label, remove);
      fragment.append(chip);
      offset = at;
    }
    if (offset < value.length) fragment.append(value.slice(offset));
    node.replaceChildren(fragment);
    const inserted = [...node.querySelectorAll<HTMLElement>('[data-composer-reference]')].find(chip => chip.dataset.composerReference === after.current);
    after.current = undefined;
    if (inserted) {
      node.focus();
      const selection = node.ownerDocument.getSelection();
      const range = node.ownerDocument.createRange();
      range.setStartAfter(inserted);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else if (caret !== undefined) positionCaret(node, Math.min(caret, value.length));
  }, [value, references, disabled]);

  useLayoutEffect(() => {
    for (const button of root.current?.querySelectorAll<HTMLButtonElement>('[data-remove-reference]') || []) button.disabled = disabled;
  }, [disabled]);

  function publish() {
    if (!root.current || composing.current || disabled) return;
    const { name, references: next } = readDraft(root.current, references);
    props.onChange(name, next);
  }

  return <div className="assistant-composer-editor-wrap">
    <div ref={root} role="textbox" aria-label={props.ariaLabel} aria-placeholder={props.placeholder} aria-multiline="true" aria-disabled={disabled}
      aria-controls={props.controls} aria-activedescendant={props.activeDescendant}
      className="assistant-composer-editor" contentEditable={!disabled} spellCheck suppressContentEditableWarning
      onBeforeInput={event => {
        const input = event.nativeEvent as InputEvent;
        if (!input.isComposing && input.inputType?.startsWith('insert') && value.length >= limit &&
            root.current?.ownerDocument.getSelection()?.isCollapsed) event.preventDefault();
      }} onInput={publish} onKeyDown={event => {
        if ((event.target as HTMLElement).closest('[data-remove-reference]')) return;
        const { isComposing, keyCode } = event.nativeEvent;
        if (composing.current || isComposing || keyCode === 229) return;
        props.onKeyDown(event);
        if (!event.defaultPrevented && event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();
          insertPlainText(event.currentTarget, '\n');
          publish();
        }
      }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => {
        composing.current = false;
        props.onCompositionEnd();
        publish();
      }} onBlur={props.onBlur} onPaste={event => {
        props.onPaste(event);
        if (event.defaultPrevented) return;
        const text = event.clipboardData.getData('text/plain');
        event.preventDefault();
        if (text) { insertPlainText(event.currentTarget, text.slice(0, Math.max(0, limit - value.length))); publish(); }
      }} onClick={event => {
        const remove = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-reference]');
        if (!remove || disabled) return;
        remove.closest('[data-composer-reference]')?.remove();
        publish();
      }} />
    {!value && !references.length && <span className="assistant-composer-placeholder" aria-hidden="true">{props.placeholder}</span>}
  </div>;
});
