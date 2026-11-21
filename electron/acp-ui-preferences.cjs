const path = require('node:path');
const { atomicWrite, fileBytes, plainDirectory } = require('./desktop-profiles.cjs');
const OPTIONS = {
    theme: ['light', 'dark', 'system'], chatFontSize: [13, 14, 15, 16, 18],
    defaultPermission: ['read_only', 'workspace_write', 'workspace_direct', 'full'],
    sendKey: ['enter', 'mod-enter'], detail: ['compact', 'full'], collapse: ['never', 'finished'], collapsedReply: ['full', 'preview']
};
function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== Object.keys(OPTIONS).length || Object.keys(value).some(key => !Object.hasOwn(OPTIONS, key)))
        throw Error('界面偏好格式无效。');
    for (const [key, values] of Object.entries(OPTIONS))
        if (!values.includes(value[key]))
            throw Error('界面偏好选项无效。');
    return Object.fromEntries(Object.keys(OPTIONS).map(key => [key, value[key]]));
}
function createUiPreferences(home) {
    const file = path.join(home, 'ui-preferences.json');
    return {
        get() {
            try {
                const stored = JSON.parse(fileBytes(file, 4096).toString('utf8'));
                if (stored.schema_version !== 1)
                    return null;
                return validate(stored.value);
            }
            catch {
                return null;
            }
        },
        set(value) {
            const clean = validate(value);
            plainDirectory(home);
            atomicWrite(file, JSON.stringify({
                schema_version: 1, value: clean
            }, null, 2) + '\n');
            return clean;
        }
    };
}
module.exports = {
    createUiPreferences, validate
};
