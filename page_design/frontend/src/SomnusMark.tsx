const mascotUrl = new URL('./assets/somnus-mascot.png', import.meta.url).href;

export function SomnusMark({ className = '' }: { className?: string }) {
  return <img className={`somnus-mark ${className}`} src={mascotUrl}
    width="26" height="26" alt="" aria-hidden="true" draggable={false} />;
}
