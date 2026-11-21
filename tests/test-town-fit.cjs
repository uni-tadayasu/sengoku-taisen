'use strict';
const assert = require('node:assert/strict');
const {fitRect, labelRect, sceneHeight, panelSceneHeight} = require('../town-fit.js');
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
assert.equal(sceneHeight(500, 593, 278.656, 20), initial, 'A saved drag height is capped to the viewport after resize or zoom');
assert.equal(sceneHeight(160, 593, 278.656, 20), 160, 'A smaller explicit drag height stays the user choice');
assert.equal(sceneHeight(500, 1000, 120, 20), 500, 'The saved preference can expand again when space returns');
for (const [height, offset] of [[400, 180], [230, 63], [160, 63], [100, 53]]) {
  const chosen = sceneHeight(240, height, offset, 10);
  assert(chosen > 0 && chosen <= 240);
  assert(offset + chosen <= height - 10, 'Short/zoomed desktop art stays above the main viewport bottom');
  const fitted = fitRect(540, chosen); assert(fitted.height <= chosen);
}
// The PC town and its console now share the full main-pane height. A long
// construction queue, status message or Lv.64 title cannot shrink the scene.
for(const geometry of [
  {width:822,panel:569,heading:42,caption:0},
  {width:1326,panel:902,heading:42,caption:0},
  {width:779,panel:422,heading:42,caption:0},
  {width:345,panel:244,heading:42,caption:0},
  {width:290,panel:216,heading:64,caption:0}
]){
  const {width,panel,heading,caption}=geometry,available=panel-heading-caption;
  const height=panelSceneHeight(panel,heading,caption),fit=fitRect(width,height);
  assert.equal(height,available,'Uncustomized PC canvas consumes the full available height');
  assert(fit.width<=width+1e-8&&fit.height<=available+1e-8,'The entire source image remains contained');
  assert(Math.abs(fit.width-width)<1e-8||Math.abs(fit.height-available)<1e-8,'No artificial preferred height leaves avoidable empty space');
  assert.equal(panelSceneHeight(panel,heading,caption,10000),available,'An oversized saved drag height is capped');
  assert.equal(panelSceneHeight(panel,heading,caption,100),Math.min(100,available),'A smaller height remains adjustable');
}
const largerTown=fitRect(822,panelSceneHeight(569,42,0));
assert(largerTown.width>=790&&largerTown.height>=527,'1366×768 geometry has a much larger complete town');
assert(largerTown.width*largerTown.height>3*(438*292),'Artwork area exceeds three times the previous 438×292 result');
assert.equal(panelSceneHeight(569,60,0),509,'Long labels and larger system text use their actual measured height');
assert.equal(panelSceneHeight(0,42,0),1,'Hidden or not-yet-sized panels remain finite');
assert.equal(kamon.url('德川家'), kamon.url('徳川家'));
assert.match(kamon.render('德川家'), /aria-label="德川家：/);
assert.match(kamon.render('徳川家'), /aria-label="徳川家：/);
console.log(`PASS ${cases} town fit/label geometries, full-height PC canvas/maximized image, drag limits, zero-size startup, and the two Tokugawa crest labels.`);
