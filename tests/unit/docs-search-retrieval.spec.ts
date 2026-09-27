import { expect, test } from '@playwright/test';

test('docs retrieval keeps named APIs while rejecting mixed gibberish and generic terms', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDocsSearch, retrieveDocs } = await import('/src/lib/docs-search.js');
    const engine = await createDocsSearch('minilm');
    try {
      return {
        named: await retrieveDocs(engine, 'VdDock'),
        placement: await retrieveDocs(engine, 'VdDock placement'),
        unsupported: await retrieveDocs(
          engine,
          'zqxv-9041 flinderquartz nonexistent component',
        ),
      };
    } finally {
      await engine.dispose();
    }
  });

  expect(result.named.length).toBeGreaterThan(0);
  expect(result.named[0].url).toContain('vd3.vanduo.dev');
  expect(result.placement.length).toBeGreaterThan(0);
  expect(result.unsupported).toEqual([]);
});
