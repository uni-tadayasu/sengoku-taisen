'use strict';

// esbuild already handles syntax and browser targets. This second pass only
// removes redundant declarations/rules without moving rules between positions
// or media queries. Keep the options explicit and the dependency version pinned.
const CleanCSS = require('clean-css');

function compactCss(source) {
  const result = new CleanCSS({
    rebase: false,
    inline: false,
    level: {
      1: {
        all: false,
        selectorsSortingMethod: false,
        roundingPrecision: false,
        specialComments: 'all'
      },
      2: {
        all: false,
        mergeAdjacentRules: true,
        removeDuplicateRules: true,
        removeEmpty: true,
        overrideProperties: true,
        reduceNonAdjacentRules: true,
        // clean-css 5 cannot parse clamp() font sizes reliably. Preserve every
        // font shorthand, including responsive sizes and its fallback family.
        skipProperties: ['font']
      }
    }
  }).minify(source);
  if (result.errors.length || result.warnings.length) {
    throw Error('CSS compaction failed: ' + [...result.errors, ...result.warnings].join('\n'));
  }
  return result.styles + '\n';
}

module.exports = {compactCss};
