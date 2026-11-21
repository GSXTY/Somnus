const path = require('node:path');
const { atomicWrite, fileBytes, plainDirectory } = require('./desktop-profiles.cjs');
const { policy, DEFAULT_POLICY } = require('./runtime/task-monitor.cjs');
function createRuntimePolicy(home) {
    const file = path.join(home, 'runtime-policy.json');
    return {
        get() {
            try {
                return policy(JSON.parse(fileBytes(file, 4096).toString('utf8')));
            }
            catch {
                return policy(DEFAULT_POLICY);
            }
        }, set(value) {
            const clean = policy(value);
            plainDirectory(home);
            atomicWrite(file, JSON.stringify(clean, null, 2) + '\n');
            return clean;
        }
    };
}
module.exports = {
    createRuntimePolicy
};
