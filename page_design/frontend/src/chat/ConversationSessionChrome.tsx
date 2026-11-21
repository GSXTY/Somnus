import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { DislikeOutlined, LikeOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { ChatMessage } from './assistantApi';

function motion(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}

export function ConversationTurnRail({ messages, log, onNavigate }: {
  messages: ChatMessage[]; log: RefObject<HTMLDivElement>; onNavigate: () => void;
}) {
  const turns = messages.filter(message => message.role === 'user');
  const signature = turns.map(turn => turn.id).join(',');
  const [active, setActive] = useState<string>();
  const rail = useRef<HTMLDivElement>(null);
  const cursor = useRef(false);

  useEffect(() => {
    const element = log.current;
    if (!element || !signature || turns.length < 2) return;
    const anchors = [...element.querySelectorAll<HTMLElement>('[data-turn-anchor]')];
    let animation = 0;
    const update = () => {
      const floor = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (floor <= 24) { setActive(anchors.at(-1)?.dataset.turnAnchor); return; }
      const threshold = element.getBoundingClientRect().top + Math.min(100, element.clientHeight / 3);
      let left = 0, right = anchors.length - 1;
      while (left < right) {
        const middle = Math.ceil((left + right) / 2);
        if (anchors[middle].getBoundingClientRect().top <= threshold) left = middle;
        else right = middle - 1;
      }
      setActive(anchors[left]?.dataset.turnAnchor);
    };
    const queue = () => {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(update);
    };
    element.addEventListener('scroll', queue, { passive: true });
    const resize = new ResizeObserver(queue);
    resize.observe(element);
    for (const anchor of anchors) resize.observe(anchor);
    queue();
    return () => { element.removeEventListener('scroll', queue); resize.disconnect(); cancelAnimationFrame(animation); };
  }, [log, signature, turns.length]);

  useEffect(() => {
    const scroller = rail.current;
    if (!scroller || cursor.current || scroller.contains(document.activeElement)) return;
    const mark = scroller.querySelector<HTMLButtonElement>('[aria-current=true]');
    if (!mark) return;
    const bounds = scroller.getBoundingClientRect(), item = mark.getBoundingClientRect();
    if (item.top < bounds.top || item.bottom > bounds.bottom) scroller.scrollTop += item.top - bounds.top - bounds.height / 2;
  }, [active, signature]);

  if (turns.length < 2) return null;
  const current = active ?? turns.at(-1)?.id;
  return <nav className="assistant-turn-rail" aria-label="对话轮次">
    <div ref={rail} className="assistant-turn-rail-scroll" onPointerEnter={() => { cursor.current = true; }}
      onPointerLeave={() => { cursor.current = false; }}>
      {turns.map((turn, index) => {
        const selected = current === turn.id;
        const label = '第 ' + (index + 1) + ' 轮';
        return <button key={turn.id} type="button" className="assistant-turn-mark" aria-label={label}
          aria-current={selected || undefined} tabIndex={selected ? 0 : -1}
          title={label + (turn.content ? ' · ' + turn.content.trim().slice(0, 140) : '')} onClick={() => {
            const element = log.current;
            const marker = element?.querySelector<HTMLElement>('[data-turn-anchor="' + CSS.escape(turn.id) + '"]');
            if (!element || !marker) return;
            onNavigate();
            const top = element.scrollTop + marker.getBoundingClientRect().top - element.getBoundingClientRect().top - 14;
            element.scrollTo({ top, behavior: motion() });
          }} onKeyDown={event => {
            const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1
              : event.key === 'Home' ? 0 : event.key === 'End' ? turns.length - 1 : undefined;
            if (next === undefined) return;
            event.preventDefault();
            const scroller = rail.current;
            const target = scroller?.children[Math.max(0, Math.min(turns.length - 1, next))] as HTMLElement | undefined;
            if (!target || !scroller) return;
            const bounds = scroller.getBoundingClientRect(), item = target.getBoundingClientRect();
            if (item.top < bounds.top) scroller.scrollTop += item.top - bounds.top;
            if (item.bottom > bounds.bottom) scroller.scrollTop += item.bottom - bounds.bottom;
            target.focus({ preventScroll: true });
          }} />;
      })}
    </div>
  </nav>;
}

type ReplyRating = 'positive' | 'negative';

export function ConversationReplyRating({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const storageKey = 'somnus.reply-rating.' + conversationId + '.' + messageId;
  const [value, setValue] = useState<ReplyRating>();
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setValue(saved === 'positive' || saved === 'negative' ? saved : undefined);
    } catch { setValue(undefined); }
  }, [storageKey]);
  function rate(next: ReplyRating) {
    const selected = next === value ? undefined : next;
    setValue(selected);
    try { if (selected) localStorage.setItem(storageKey, selected); else localStorage.removeItem(storageKey); }
    catch { /* keep the current view usable when storage is unavailable */ }
  }
  return <>
    <Button type="text" size="small" icon={<LikeOutlined />} aria-pressed={value === 'positive'}
      aria-label="有帮助" title="在本机记录有帮助" onClick={() => rate('positive')} />
    <Button type="text" size="small" icon={<DislikeOutlined />} aria-pressed={value === 'negative'}
      aria-label="没有帮助" title="在本机记录没有帮助" onClick={() => rate('negative')} />
  </>;
}
