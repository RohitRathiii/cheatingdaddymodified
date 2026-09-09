const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');

test('desktop renderer reaches its ready state', async () => {
    const app = await electron.launch({ args: [path.join(__dirname, '..')] });
    try {
        const window = await app.firstWindow();
        await expect(window.locator('cheating-daddy-app')).toBeVisible({ timeout: 15000 });
        await expect(window.locator('.app-shell')).toBeVisible();
    } finally {
        await app.close();
    }
});
