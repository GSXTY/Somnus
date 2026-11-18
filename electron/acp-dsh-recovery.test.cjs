const assert = require('node:assert/strict');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { mkdtemp, readFile, rmdir, unlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { draftStore, queueStore } = require('./acp-dsh-recovery.cjs');

test('draft storage encrypts text and retains the latest requested write', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'somnus-drafts-'));
  const key = randomBytes(32);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: text => {
      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-ctr', key, iv);
      return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final()]);
    },
    decryptString: bytes => {
      const cipher = createDecipheriv('aes-256-ctr', key, bytes.subarray(0, 16));
      return Buffer.concat([cipher.update(bytes.subarray(16)), cipher.final()]).toString('utf8');
    },
  };
  const cid = 'a'.repeat(32);
  const folder = path.join(home, 'somnus-drafts');
  const file = path.join(folder, cid + '.bin');
  try {
    const draft = draftStore(home, storage);
    const saves = [draft.save(cid, { text: 'previous draft' }), draft.save(cid, { text: 'latest draft' })];
    assert.deepEqual(await draft.read(cid), { text: 'latest draft' });
    await Promise.all(saves);
    assert.equal((await readFile(file)).includes(Buffer.from('latest draft')), false);
    assert.deepEqual(await draftStore(home, storage).read(cid), { text: 'latest draft' });
    assert.equal(await draft.read('../alternative'), null);
    await draft.save(cid, null);
    assert.equal(await draft.read(cid), null);
    const draftImage = { name: 'chart.png', mime: 'image/png', size: 100, width: 2, height: 2,
      data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGP4//8/IwpAAQBX7wv1eDvxTQAAAABJRU5ErkJggg==' };
    const workspace = 'workspace:default';
    const docFile = { id: 'b'.repeat(32), name: 'notes.md', kind: 'text', chars: 20 };
    const dataFile = { id: 'c'.repeat(32), name: 'test.csv', row_count: 4, columns: ['id', 'state'] };
    await draft.save(workspace, { attachments: [draftImage], docFile, dataFile });
    const restored = await draftStore(home, storage).read(workspace);
    assert.deepEqual(restored.docFile, docFile);
    assert.deepEqual(restored.dataFile, dataFile);
    assert.equal(restored.attachments[0].size, 73);
    assert.equal(restored.attachments[0].mime, 'image/png');
    assert.equal(restored.attachments[0].data_url, draftImage.data_url);
    await assert.rejects(draft.save(workspace, { attachments: [{ ...draftImage, data_url: 'https://outside.invalid/photo.png' }] }), /本地 PNG/);
    await assert.rejects(draft.save(workspace, { docFile: { ...docFile, id: '../notes.md' } }), /引用无效/);
    await draft.save(workspace, null);
    const queue = queueStore(home, storage);
    const row = { id: 'd'.repeat(32), draft: { text: 'durable queued text', docFile, attachments: [draftImage] },
      route: { nativeDsh: true, companyOptions: { model: 'deepseek-flash', effort: 'low' } }, permission: 'read_only' };
    await queue.save(cid, [row]);
    const restoredQueue = await queueStore(home, storage).read(cid);
    assert.equal(restoredQueue[0].id, row.id);
    assert.equal(restoredQueue[0].draft.text, row.draft.text);
    assert.equal(restoredQueue[0].draft.attachments[0].data_url, draftImage.data_url);
    assert.deepEqual(restoredQueue[0].route, row.route);
    assert.equal(await queue.read('f'.repeat(32)), null);
    assert.equal((await readFile(path.join(home, 'somnus-queues', cid + '.bin'))).includes(Buffer.from(row.draft.text)), false);
    await assert.rejects(queue.save(cid, [row, row]), /排队消息格式无效/);
    await queue.save(cid, null);
  } finally {
    await unlink(file).catch(() => {});
    await unlink(path.join(home, 'somnus-queues', cid + '.bin')).catch(() => {});
    await rmdir(path.join(home, 'somnus-queues')).catch(() => {});
    await rmdir(folder).catch(() => {});
    await rmdir(home);
  }
});
