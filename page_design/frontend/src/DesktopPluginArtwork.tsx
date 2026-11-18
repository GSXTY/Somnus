import { useId } from 'react';

// Silhouettes follow the DSH desktop plugin artwork. The stops use Somnus theme colors.
export function DesktopPluginArtwork({ kind }: { kind: 'subagent' | 'search' | 'loop' | 'shell' }) {
  const id = useId();
  const fill = `url(#${id})`;
  const ink = 'var(--shell-accent)';
  return <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs><linearGradient id={id} x1="9" y1="8" x2="27" y2="28" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--shell-art-light)" /><stop offset="1" stopColor={ink} />
    </linearGradient></defs>
    {kind === 'subagent' && <>
      <rect x="15" y="15.2" width="12.2" height="12.2" rx="2" fill={fill} />
      <rect x="8.9" y="9.1" width="12.2" height="12.2" rx="2" fill={ink} fillOpacity=".68" />
    </>}
    {kind === 'search' && <>
      <path d="M26.5 27L22.4 22.8" stroke={ink} strokeWidth="3" />
      <circle cx="15.77" cy="16.22" r="6.2" stroke={fill} strokeWidth="4" />
    </>}
    {kind === 'loop' && <>
      <path d="M18.05 28.49C12.09 28.49 7.25 23.66 7.25 17.69C13.21 17.69 18.05 22.53 18.05 28.49ZM18.05 6.9C12.09 6.9 7.25 11.73 7.25 17.69C13.21 17.69 18.05 12.86 18.05 6.9Z" fill={fill} />
      <path d="M18.05 28.49C24.01 28.49 28.85 23.66 28.85 17.69C22.88 17.69 18.05 22.53 18.05 28.49ZM18.05 6.9C24.01 6.9 28.85 11.73 28.85 17.69C22.88 17.69 18.05 12.86 18.05 6.9Z" fill={ink} fillOpacity=".82" />
    </>}
    {kind === 'shell' && <path d="M10 11L16.6 17.6Q16.75 17.75 16.6 17.89L10 24.49M20.12 24.49H26.87"
      stroke={ink} strokeWidth="3.5" />}
  </svg>;
}
