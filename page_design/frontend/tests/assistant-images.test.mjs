import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageBatch, validateImageDimensions, prepareImages, isLocalImage, imageLimits } from '../src/chat/assistantImages.mjs';

test('image limits reject unsupported, empty, oversized, over-count and combined-size inputs', () => {
  const file = (size, type = 'image/png') => ({ size, type });
  validateImageBatch([file(5 * 1024 * 1024), file(5 * 1024 * 1024)]);
  for (const files of [[file(1, 'image/gif')], [file(0)], [file(imageLimits.singleBytes + 1)], Array.from({ length: 5 }, () => file(1)), Array.from({ length: 3 }, () => file(4 * 1024 * 1024))]) assert.throws(() => validateImageBatch(files));
  assert.throws(() => validateImageBatch([file(1)], Array.from({ length: 4 }, () => file(1))), /4张/);
  assert.throws(() => validateImageBatch([file(1)], [file(10 * 1024 * 1024)]), /10MB/);
});

test('image dimensions and safe local history rendering never accept an external URL', () => {
  validateImageDimensions(4000, 4000);
  assert.throws(() => validateImageDimensions(8193, 1));
  assert.throws(() => validateImageDimensions(5000, 4000));
  assert.throws(() => validateImageDimensions(0, 20));
  assert.equal(isLocalImage('data:image/png;base64,aGVsbG8='), true);
  for (const value of ['https://example.com/image.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA']) assert.equal(isLocalImage(value), false);
});

test('failed import preserves existing draft and validates count before reading any file', async () => {
  const existing = [{ name: 'old.png', size: 1 }]; let reads = 0;
  await assert.rejects(prepareImages([{ type: 'image/gif', size: 1 }], existing, async () => { reads++; }), /PNG/);
  assert.equal(reads, 0); assert.deepEqual(existing, [{ name: 'old.png', size: 1 }]);
  await assert.rejects(prepareImages([{ type: 'image/png', size: 1 }], existing, async () => { throw Error('decode failed'); }), /decode/);
  assert.equal(existing.length, 1);
});
