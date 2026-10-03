import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { PNG } from 'pngjs';
import manifest from '../src/app/manifest';

it('provides a stable app identity, standalone launch and valid installation icons', () => {
  const app = manifest();
  expect(app.id).toBe('/');
  expect(app.start_url).toBe('/');
  expect(app.scope).toBe('/');
  expect(app.display).toBe('standalone');
  expect(app.prefer_related_applications).toBe(false);
  expect(app.icons?.filter((icon) => icon.purpose === 'any').map((icon) => icon.sizes)).toEqual([
    '192x192',
    '512x512',
  ]);
  for (const icon of app.icons || []) {
    const png = PNG.sync.read(readFileSync(`public${icon.src}`));
    expect(`${png.width}x${png.height}`).toBe(icon.sizes);
    expect(icon.type).toBe('image/png');
    // Home-screen icons need an opaque background on every platform.
    for (let offset = 3; offset < png.data.length; offset += 4)
      if (png.data[offset] !== 255) throw new Error('App icon contains a transparent pixel');
  }
});

it('keeps the maskable icon artwork inside the central safe area', () => {
  const png = PNG.sync.read(readFileSync('public/icons/app-maskable-512.png'));
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      if (png.data[offset] === 23 && png.data[offset + 1] === 23 && png.data[offset + 2] === 23)
        continue;
      expect(Math.hypot(x - 256, y - 256)).toBeLessThan(512 * 0.4);
    }
  }
});
