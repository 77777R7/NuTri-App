import assert from 'node:assert/strict';
import test from 'node:test';

import {
  choosePreferredProductImageUrl,
  isIherbImageUrl,
  isInternalRenderImageUrl,
} from '@/lib/productImagePreference';

test('product image preference picks iHerb CDN art first', () => {
  const result = choosePreferredProductImageUrl(
    'https://example.com/other.jpg',
    'https://cloudinary.images-iherb.com/image/upload/f_auto,q_auto:eco/images/now/now001/u/10.jpg',
  );

  assert.equal(
    result,
    'https://cloudinary.images-iherb.com/image/upload/f_auto,q_auto:eco/images/now/now001/u/10.jpg',
  );
  assert.equal(isIherbImageUrl(result), true);
});

test('product image preference blocks internal render fallbacks', () => {
  const internalUrl =
    'https://dlwlobgmjzcmpirwvetq.supabase.co/storage/v1/object/public/overlay-label-assets/generated-fallback-cards/rendered-now.jpg';

  assert.equal(isInternalRenderImageUrl(internalUrl), true);
  assert.equal(choosePreferredProductImageUrl(internalUrl), null);
});
