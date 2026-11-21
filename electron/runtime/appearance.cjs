const THEMES = new Set(['light', 'dark', 'system']);
const COLORS = Object.freeze({
  light: { background: '#ffffff', symbolColor: '#183b36' },
  dark: { background: '#171b1a', symbolColor: '#e7efec' },
});
function createAppearance(window, nativeTheme, initialTheme = 'light', notify = () => {}) {
  let theme = THEMES.has(initialTheme) ? initialTheme : 'light';
  let closed = false;
  const effective = () => theme === 'system' ? nativeTheme.shouldUseDarkColors ? 'dark' : 'light' : theme;
  const apply = () => {
    if (closed || window.isDestroyed()) return;
    const colors = COLORS[effective()];
    window.setBackgroundColor?.(colors.background);
    // Preserve the transparent caption overlay and existing height, including modal dimming.
    window.setTitleBarOverlay?.({color:'rgba(0,0,0,0)',symbolColor:colors.symbolColor});
  };
  const update = () => { apply(); if (!closed) notify({theme,effectiveTheme:effective()}); };
  nativeTheme.on('updated', update);
  const set = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !THEMES.has(value.theme)) throw Error('界面主题无效。');
    theme = value.theme;
    nativeTheme.themeSource = theme;
    apply();
    return { theme, effectiveTheme: effective() };
  };
  const close = () => { closed = true; nativeTheme.removeListener('updated', update); };
  window.once('closed', close);
  set({ theme });
  return { set, snapshot: () => ({ theme, effectiveTheme: effective() }), close };
}
module.exports = { createAppearance, COLORS };
