class RuntimeDiagnostics {
    constructor(readPolicy) {
        this.readPolicy = readPolicy;
        this.events = [];
    }
    record(level, code) {
        const configured = this.readPolicy().diagnostics.level;
        if (configured === 'off' || configured === 'error' && level !== 'error')
            return;
        if (!['error', 'info'].includes(level) || !/^[a-z_]{1,64}$/.test(code))
            return;
        this.events.push({
            at: Date.now(), level, code, runtime: 'dsh-native'
        });
        this.events = this.events.slice(-200);
    }
    snapshot() {
        return {
            version: 1, events: this.events.map(event => ({
                ...event
            }))
        };
    }
}
module.exports = {
    RuntimeDiagnostics
};
