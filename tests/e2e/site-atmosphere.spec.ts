import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`${theme} atmosphere follows dock accents with ${reducedMotion} motion`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion });
      await page.addInitScript((theme) => {
        localStorage.setItem('vwl-theme-preference', theme);
        localStorage.setItem('vwl-primary-color', 'blue');
        window.atmosphereQA = { uniforms: {}, draws: 0 };
        const names = new WeakMap();
        const proto = WebGLRenderingContext.prototype;
        const originalLocation = proto.getUniformLocation;
        proto.getUniformLocation = function (...args) {
          const location = originalLocation.apply(this, args);
          if (location) names.set(location, args[1]);
          return location;
        };
        for (const method of ['uniform3f', 'uniform1f']) {
          const original = proto[method];
          proto[method] = function (location, ...values) {
            if (this.canvas.classList.contains('vwl-home-atmosphere-canvas'))
              window.atmosphereQA.uniforms[names.get(location)] = values;
            return original.call(this, location, ...values);
          };
        }
        const originalDraw = proto.drawArrays;
        proto.drawArrays = function (...args) {
          if (this.canvas.classList.contains('vwl-home-atmosphere-canvas'))
            window.atmosphereQA.draws++;
          return originalDraw.apply(this, args);
        };
      }, theme);
      await page.goto('/#home');
      if (await page.getByTestId('disclaimer-gate').isVisible())
        await page.getByTestId('disclaimer-accept').click();
      await expect(page.locator('.vwl-home-atmosphere-active')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.atmosphereQA.draws)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.atmosphereQA.uniforms.uSpeed[0])).toBe(
        reducedMotion === 'reduce' ? 0 : 0.07,
      );
      for (const accent of ['red', 'green', 'blue']) {
        const before = await page.evaluate(() => window.atmosphereQA.draws);
        await page.getByRole('button', { name: 'Choose theme color', exact: true }).click();
        // The swatches fan's overlapping blades require a DOM click, as in the dock tests.
        await page
          .locator(`.vd-theme-customizer-fan [data-color="${accent}"]`)
          .evaluate((el) => el.click());
        await expect(page.locator('html')).toHaveAttribute('data-primary', accent);
        await expect
          .poll(() => page.evaluate(() => window.atmosphereQA.draws))
          .toBeGreaterThan(before);
        const dominant = accent === 'red' ? 0 : accent === 'green' ? 1 : 2;
        await expect
          .poll(() =>
            page.evaluate((dominant) => {
              const primary = window.atmosphereQA.uniforms.uColor1;
              return (
                primary[dominant] > primary[(dominant + 1) % 3] &&
                primary[dominant] > primary[(dominant + 2) % 3]
              );
            }, dominant),
          )
          .toBe(true);
        if (reducedMotion === 'reduce') {
          expect(await page.evaluate(() => window.atmosphereQA.uniforms.uTime[0])).toBe(0);
        }
        if (
          accent === 'green' &&
          reducedMotion === 'no-preference' &&
          info.project.name === 'Chromium Desktop'
        )
          await page.screenshot({ path: `qa/theme-refresh/gradient-green-${theme}.png` });
      }
      if (reducedMotion === 'reduce') {
        const before = await page.evaluate(() => window.atmosphereQA.draws);
        await page.setViewportSize({ width: 1200, height: 700 });
        await expect
          .poll(() => page.evaluate(() => window.atmosphereQA.draws))
          .toBeGreaterThan(before);
        expect(await page.evaluate(() => window.atmosphereQA.uniforms.uTime[0])).toBe(0);
      }
    });
  }
}
