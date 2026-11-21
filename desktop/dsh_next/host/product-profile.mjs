import { join, resolve } from 'node:path';

export const PRODUCT_APP_ID = 'com.vvfly.somnusnext';
export function productProfile(appData, override = '') {
  // A new product never imports the Explorer or previous Next profile.
  return override ? resolve(override) : join(appData, 'VVFLY', 'SomnusNext');
}
