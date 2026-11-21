'use strict';
const assert = require('node:assert/strict');
const {fitRect, labelRect, sceneHeight} = require('../town-fit.js');
const kamon = require('../kamon.js');
const points = [[39,27],[24,76],[51,62],[87,41],[86,79],[17,44],[68,43],[57,27]];
let cases = 0;
for (const width of [240, 290, 320, 375, 480, 681, 900, 1400]) {
  for (const height of [160, 240, 400, 600, 1000]) {
    const fit = fitRect(width, height);
    assert(Math.abs(fit.width / fit.height - 1.5) < 1e-9);
    assert(fit.left >= 0 && fit.top >= 0);
    assert(fit.left + fit.width <= width + 1e-8 && fit.top + fit.height <= height + 1e-8);
    assert(Math.abs(fit.width - width) < 1e-8 || Math.abs(fit.height - height) < 1e-8, 'The uncropped image uses all of one available dimension');
    for (const [px, py] of points) {
      const x = fit.width * px / 100, y = fit.height * py / 100;
      const label = labelRect(x, y, fit.width, fit.height, 125, 28, 44, px === 57 || px === 87);
      assert(label.left >= 5 && label.top >= 5);
      assert(label.left + label.width <= fit.width - 5 + 1e-8);
      assert(label.top + label.height <= fit.height - 5 + 1e-8);
      assert(Math.abs(x - 22 + label.relativeLeft - label.left) < 1e-8);
      assert(Math.abs(y - 22 + label.relativeTop - label.top) < 1e-8);
    }
    cases++;
  }
}
assert.deepEqual(fitRect(0, 0), {width:0, height:0, left:0, top:0});
// The actual 1364×766 QA fixture put the artwork at y=411.656 in a main
// viewport ending at y=726. Its former fixed 374px height clipped the bottom.
const initial = sceneHeight(374, 593, 411.656 - 133, 20);
assert(initial < 374);
assert(411.656 + initial <= 726 - 20);
assert.equal(sceneHeight(374, 593, (411.656 - 120) - 133 + 120, 20), initial, 'Scroll position cannot change the image height');
assert.equal(sceneHeight(500, 593, 278.656, 20, true), 500, 'An explicit drag height remains the user choice');
for (const [height, offset] of [[400, 180], [230, 63], [160, 63], [100, 53]]) {
  const chosen = sceneHeight(240, height, offset, 10);
  assert(chosen > 0 && chosen <= 240);
  assert(offset + chosen <= height - 10, 'Short/zoomed desktop art stays above the main viewport bottom');
  const fitted = fitRect(540, chosen); assert(fitted.height <= chosen);
}
assert.equal(kamon.url('德川家'), kamon.url('徳川家'));
assert.match(kamon.render('德川家'), /aria-label="德川家：/);
assert.match(kamon.render('徳川家'), /aria-label="徳川家：/);
console.log(`PASS ${cases} town fit/label geometries, zero-size startup, and the two Tokugawa crest labels.`);
