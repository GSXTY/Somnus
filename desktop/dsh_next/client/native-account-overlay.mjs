import { replaceExact } from '../overlay.mjs';

function replaceOne(source, pattern, value, file) {
  if ([...source.matchAll(pattern)].length !== 1) throw new Error(`${file}: unexpected native account layout`);
  return source.replace(pattern, value);
}

/** Let the native settings button serve as the launcher without the account menu. */
export function hideAccountNavigation(source, file) {
  let result = replaceOne(source, /function AccountMenu\(\{[\s\S]*?(?=function createPlatformPages\()/g, '', file);
  result = replaceOne(result,
    /ctx\.remoteAccess\.whenAccess\(`account\/watch`,\(\)=>ctx\.slots\.inject\(`settings\.launcher`[\s\S]*?\},AccountMenu\)\)\);/g, '', file);
  result = replaceOne(result,
    /ctx\.remoteAccess\.whenAccess\(`account\/watch`,\(\)=>ctx\.slots\.inject\(`settings\.models\.sign-in`[\s\S]*?AccountOnboarding\)\)\);/g, '', file);
  result = replaceOne(result,
    /ctx\.slots\.inject\(`shell\.overlay`,\(\)=>ctx\.slots\.register\(\{name:`shell\.overlay`,id:`desktop-onboarding`[\s\S]*?\},DesktopOnboardingEntry\)\)/g, '', file);
  result = replaceOne(result,
    /ctx\.remoteAccess\.whenAccess\(`account\/watch`,\(\)=>ctx\.slots\.inject\(`settings\.section`,\(\)=>\{let unregister;[\s\S]*?return\(\)=>\{listeners\.delete\(update\);unregister\?\.\(\)\}\}\)\)/g, '', file);
  return result;
}

/** User-owned providers keep the original add/edit/delete forms and styles. */
export function userProviderModels(source, file) {
  let result = replaceExact(source, 'rows:snapshot.rows.map(row=>',
    'rows:snapshot.rows.filter(row=>!([`deepseek-account`,`deepseek-official`].includes(row.entry.provider))).map(row=>', file);
  result = replaceOne(result,
    /if\(!\(`dshDesktop`in globalThis\)\)ctx\.slots\.inject\(`settings\.onboarding`,\(\)=>ctx\.slots\.register\(\{name:`settings\.onboarding`,id:`welcome-notice`[\s\S]*?\},WelcomeNotice\)\);/g, '', file);
  return replaceOne(result,
    /ctx\.slots\.inject\(`settings\.onboarding`,\(\)=>ctx\.slots\.register\(\{name:`settings\.onboarding`,id:`deepseek-official`[\s\S]*?\},DeepSeekOnboardingDialog\)\)/g, '', file);
}
