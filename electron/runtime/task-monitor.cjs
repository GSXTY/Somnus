const DEFAULT_POLICY = Object.freeze({
    tasks: Object.freeze({
        maxDurationMinutes: 0, idleWarningSeconds: 120, disconnectTimeoutSeconds: 60
    }), diagnostics: Object.freeze({
        level: 'error'
    })
});
function policy(value = {}) {
    const plain = item => item && typeof item === 'object' && !Array.isArray(item);
    if (!plain(value) || Object.keys(value).some(key => !['tasks', 'diagnostics'].includes(key)) ||
        value.tasks !== undefined && (!plain(value.tasks) || Object.keys(value.tasks).some(key => !['maxDurationMinutes', 'idleWarningSeconds', 'disconnectTimeoutSeconds'].includes(key))) ||
        value.diagnostics !== undefined && (!plain(value.diagnostics) || Object.keys(value.diagnostics).some(key => key !== 'level')))
        throw Error('任务运行设置格式无效。');
    const tasks = {
        ...DEFAULT_POLICY.tasks, ...value.tasks
    }, diagnostics = {
        ...DEFAULT_POLICY.diagnostics, ...value.diagnostics
    };
    for (const [key, min, max] of [['maxDurationMinutes', 0, 1440], ['idleWarningSeconds', 30, 3600], ['disconnectTimeoutSeconds', 15, 300]])
        if (!Number.isInteger(tasks[key]) || tasks[key] < min || tasks[key] > max)
            throw Error('任务运行设置超出范围。');
    if (!['off', 'error', 'info'].includes(diagnostics.level))
        throw Error('诊断级别无效。');
    return {
        tasks, diagnostics
    };
}
class TaskMonitor {
    constructor(settings, now = Date.now()) {
        this.policy = policy(settings);
        this.startedAt = now;
        this.lastActivity = now;
        const recovered = this.disconnected;
        this.disconnected = false;
        this.lastContact = now;
        this.cursor = undefined;
        this.warned = false;
        this.disconnected = false;
    }
    contact(cursor, now = Date.now()) {
        const recovered = this.disconnected;
        this.disconnected = false;
        this.lastContact = now;
        if (cursor !== this.cursor) {
            this.cursor = cursor;
            this.lastActivity = now;
            this.warned = false;
        }
        return recovered;
    }
    activity(now = Date.now()) {
        const wasIdle = this.warned;
        this.lastActivity = now;
        this.warned = false;
        return wasIdle;
    }
    failure(now = Date.now()) {
        this.disconnected = true;
        if (now - this.lastContact >= this.policy.tasks.disconnectTimeoutSeconds * 1000)
            throw Error('DSH 连接持续失联，已停止等待；请检查实际任务结果后再决定是否继续。');
    }
    check(now = Date.now()) {
        const cap = this.policy.tasks.maxDurationMinutes;
        if (cap && now - this.startedAt >= cap * 60000)
            throw Error('任务达到你设置的最长运行时间，已请求停止；不会自动重新执行。');
        if (!this.warned && now - this.lastActivity >= this.policy.tasks.idleWarningSeconds * 1000) {
            this.warned = true;
            return {
                code: 'idle', message: '任务暂未产生新活动，仍在等待；你可以查看轨迹或停止。'
            };
        }
        return null;
    }
}
module.exports = {
    TaskMonitor, policy, DEFAULT_POLICY
};
