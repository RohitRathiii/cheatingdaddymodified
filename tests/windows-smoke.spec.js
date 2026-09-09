const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');

test.describe('Windows packaged shell', () => {
    test.skip(process.platform !== 'win32', 'Run this gate on the Windows release worker');

    test('renders controls and can hide and restore the overlay', async () => {
        const app = await electron.launch({ args: [path.join(__dirname, '..')] });
        try {
            const window = await app.firstWindow();
            await expect(window.locator('cheating-daddy-app')).toBeVisible();
            await expect(window.locator('.app-shell')).toBeVisible();
            const hidden = await app.evaluate(({ BrowserWindow }) => {
                const main = BrowserWindow.getAllWindows()[0];
                main.hide();
                return main.isVisible();
            });
            expect(hidden).toBe(false);
            const restored = await app.evaluate(({ BrowserWindow }) => {
                const main = BrowserWindow.getAllWindows()[0];
                main.show();
                return main.isVisible();
            });
            expect(restored).toBe(true);
        } finally {
            await app.close();
        }
    });
});
