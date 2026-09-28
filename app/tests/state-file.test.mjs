import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSerializedJsonWriter } from '../dist-electron/state-file.js';

test('overlapping saves persist the latest snapshot without losing a temporary file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'doit-state-'));
  const file = path.join(directory, 'state.json');
  try {
    const save = createSerializedJsonWriter();
    await Promise.all(Array.from({ length: 40 }, (_, index) =>
      save(file, { index, payload: 'x'.repeat(20_000) })));

    assert.equal(JSON.parse(await readFile(file, 'utf8')).index, 39);
    assert.deepEqual(await readdir(directory), ['state.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed save does not block the next save', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'doit-state-'));
  try {
    const save = createSerializedJsonWriter();
    await assert.rejects(save(directory, { failed: true }));
    const file = path.join(directory, 'state.json');
    await save(file, { recovered: true });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { recovered: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
