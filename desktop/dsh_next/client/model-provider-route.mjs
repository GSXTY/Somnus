export function externalProvider(provider) {
  return provider.id.startsWith('somnus-acp-') || provider.id === 'somnus-codex' || provider.id === 'somnus-codebuddy';
}
