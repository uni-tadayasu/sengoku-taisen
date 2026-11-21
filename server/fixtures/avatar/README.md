# Avatar parser fixtures

The baseline, progressive, grayscale and restart-marker JPEGs are synthetic 256×256 test patterns generated with Pillow. `oversize-dimension.jpg` is the same pattern at 257×256 and must be rejected. Corresponding `*-clean.jpg` files are the metadata-free outputs; they were independently decoded and compared pixel-for-pixel with the inputs using Pillow before being checked in.

`chrome-canvas.jpg` is the 41,163-byte, 256×256 JPEG produced by the application's actual Chrome crop/resize/quality flow during local UI QA. It contains no authentication or account data and was not uploaded to a production account.

`scripts/test-avatar-jpeg.mjs` exercises the parser embedded in the real Worker against these fixed bytes and corrupted variants. `scripts/test-avatars.mjs` exercises authenticated upload, R2 storage and public retrieval through the real Worker with isolated local storage doubles. Neither suite needs an image library or network access.
