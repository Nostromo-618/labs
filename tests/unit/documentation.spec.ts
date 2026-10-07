import { test, expect } from '@playwright/test';
import { renderDocumentation, documentationPage } from '../../utils/documentation.mjs';

test('documentation rebases safe links while preserving unsafe destinations as inert text', () => {
  const html = renderDocumentation(
    '# Heading\n\n[report](./report.md#details) [evidence](./raw.json?a=1&b=2) [app](../#demos/aichat) [external](https://example.com/file.md) [bad](javascript:alert) [encoded](java%73cript:alert) [network](//evil.example)\n\n## Details',
    '/doc/guide.md',
  );
  expect(html).toContain('href="/doc/report.html#details"');
  expect(html).toContain('href="/doc/raw.json?a=1&amp;b=2"');
  expect(html).toContain('href="/#demos/aichat"');
  expect(html).toContain('href="https://example.com/file.md"');
  expect(html.match(/<a /g)).toHaveLength(4);
  expect(html).toContain('id="details"');
});

test('standalone docs are escaped, script-free and have unique heading anchors', () => {
  const html = documentationPage('# <script>bad</script>\n\n## Same\n\n## Same', '/doc/test.md');
  expect(html).not.toContain('<script>');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain('id="same"');
  expect(html).toContain('id="same-1"');
  expect(html).toContain('href="/doc/test.md"');
});

test('workspace report opens from inline chat docs and its onward links work', async ({ page }) => {
  await page.goto('/#demos/aichat');
  await page.getByRole('button', { name: 'I understand and accept' }).click();
  const link = page.getByRole('link', { name: 'workspace validation', exact: true }).first();
  await expect(link).toHaveAttribute('href', '/doc/vwl-chat-workspace-validation.html');
  await link.click();
  await expect(page).toHaveURL(/\/doc\/vwl-chat-workspace-validation\.html$/);
  await expect(page.locator('main h1')).toContainText('workspace validation');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('link', { name: 'the latest feature validation' })).toHaveAttribute(
    'href',
    '/doc/vwl-checked-stream-conversation-validation.html',
  );
  await page.getByRole('link', { name: 'the latest feature validation' }).click();
  await expect(page.locator('main h1')).toContainText('validation');
  await expect(page.getByRole('link', { name: 'Machine-readable measurements' })).toHaveAttribute(
    'href',
    '/doc/checked-stream-validation.json',
  );
  await page.getByRole('link', { name: 'Back to AI Chat' }).click();
  await expect(page).toHaveURL(/#demos\/aichat$/);
});

test('pinned attribution and voice catalog are served without exposing sibling paths', async ({
  request,
}) => {
  const notices = await request.get('/doc/chat-third-party-notices.html');
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain('obscenity 0.4.6');
  const voices = await request.get('/doc/kokoro-english-voices.json');
  expect((await voices.json()).length).toBe(28);
  const missing = await request.get('/doc/nonexistent.html');
  expect(missing.status()).toBe(404);
});
