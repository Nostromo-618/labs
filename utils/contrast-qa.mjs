/** Text contrast spot checks and final production setup screenshots. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = (process.env.CONTRAST_QA_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const results = [];
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(
      (value) => localStorage.setItem('vanduo-theme-preference', value),
      theme,
    );
    const page = await context.newPage();
    await page.goto(`${base}/demo/ai-chat-demo.html`);
    await page.getByRole('button', { name: 'Load AI Model' }).waitFor();
    const result = await page.evaluate(() => {
      const note = document.querySelector('.vwl-ai-note');
      const style = getComputedStyle(note);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const luminance = (color) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const foreground = luminance(style.color);
      const backgrounds = ['--vd-bg-primary', '--vd-bg-secondary'].map((token) => {
        const color = style.getPropertyValue(token);
        const bg = luminance(color);
        return {
          token,
          color,
          ratio: (Math.max(foreground, bg) + 0.05) / (Math.min(foreground, bg) + 0.05),
        };
      });
      return { theme: document.documentElement.dataset.theme, color: style.color, backgrounds };
    });
    assert.equal(result.theme, theme);
    assert(result.backgrounds.every((bg) => bg.ratio >= 4.5));
    results.push(result);
    await page.screenshot({
      path: `qa/local-refresh/screenshots/chat-setup-${theme}.png`,
      fullPage: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(
  'qa/local-refresh/contrast.json',
  JSON.stringify(
    {
      scope:
        'Muted chat copy against primary/secondary solid surfaces; glass gradients also visually inspected. This is not a complete WCAG audit.',
      results,
    },
    null,
    2,
  ),
);
console.log(results);
