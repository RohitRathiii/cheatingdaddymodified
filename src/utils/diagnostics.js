const fs = require('node:fs');
const path = require('node:path');

function rotateLogs(filePath, maxBytes = 5 * 1024 * 1024, keep = 3) {
    try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size < maxBytes) return;
        for (let index = keep - 1; index >= 1; index--) {
            const source = `${filePath}.${index}`;
            const destination = `${filePath}.${index + 1}`;
            if (fs.existsSync(source)) fs.renameSync(source, destination);
        }
        fs.renameSync(filePath, `${filePath}.1`);
    } catch (error) {
        console.warn('Could not rotate diagnostics:', error.message);
    }
}

function startDiagnostics({ app, BrowserWindow, directory, intervalMs = 15000 }) {
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, 'performance.jsonl');
    const record = () => {
        rotateLogs(filePath);
        const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
        const metrics = {
            at: new Date().toISOString(),
            process: process.memoryUsage(),
            electron: app.getAppMetrics().map(item => ({ type: item.type, pid: item.pid, memory: item.memory })),
            resources: { windows: windows.length, visibleWindows: windows.filter(window => window.isVisible()).length },
            meeting: typeof global.getMeetingDiagnostics === 'function' ? global.getMeetingDiagnostics() : {},
        };
        fs.appendFile(filePath, `${JSON.stringify(metrics)}\n`, () => {});
    };
    record();
    const timer = setInterval(record, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

module.exports = { rotateLogs, startDiagnostics };
