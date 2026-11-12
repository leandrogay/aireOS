// The Customers page colour wheel's maths: HSL <-> hex, and points on the
// wheel <-> hue and saturation. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clampLightness,
  hexToHsl,
  hslToHex,
  hueSatToPoint,
  pointToHueSat,
} from '../app/utils/colorWheel.js';

describe('hslToHex / hexToHsl', () => {
  test('pure hues convert to their hex', () => {
    assert.equal(hslToHex({ h: 0, s: 100, l: 50 }), '#FF0000');
    assert.equal(hslToHex({ h: 120, s: 100, l: 50 }), '#00FF00');
    assert.equal(hslToHex({ h: 240, s: 100, l: 50 }), '#0000FF');
  });

  test('a grey has no hue or saturation', () => {
    assert.deepEqual(hexToHsl('#808080'), { h: 0, s: 0, l: 50 });
  });

  test('a customer colour survives the round trip to within a step', () => {
    for (const hex of ['#7A70B8', '#9A7B00', '#2E7BA6', '#C45C26', '#6B8E23']) {
      const back = hslToHex(hexToHsl(hex));
      const diff = [1, 3, 5].map((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16)));
      assert.ok(Math.max(...diff) <= 4, `${hex} came back as ${back}`);
    }
  });
});

describe('wheel points', () => {
  test('hue goes clockwise from the top, saturation from the centre to the rim', () => {
    assert.deepEqual(pointToHueSat(50, 0, 50), { h: 0, s: 100 });
    assert.deepEqual(pointToHueSat(100, 50, 50), { h: 90, s: 100 });
    assert.deepEqual(pointToHueSat(50, 75, 50), { h: 180, s: 50 });
    assert.equal(pointToHueSat(50, 50, 50).s, 0);
  });

  test('a point past the rim counts as the rim', () => {
    assert.equal(pointToHueSat(50, -40, 50).s, 100);
  });

  test('a hue and saturation map back to the same point', () => {
    const point = hueSatToPoint({ h: 90, s: 100 }, 50);
    assert.ok(Math.abs(point.x - 100) < 1e-9 && Math.abs(point.y - 50) < 1e-9);
  });
});

describe('clampLightness', () => {
  test('keeps the slider inside the range a chart colour may use', () => {
    assert.equal(clampLightness(90), 60);
    assert.equal(clampLightness(5), 15);
    assert.equal(clampLightness(40), 40);
  });
});
