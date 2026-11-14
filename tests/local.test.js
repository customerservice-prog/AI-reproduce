import test from 'node:test';
import assert from 'node:assert/strict';
import {detectMedia} from '../src/local-engine.js';

test('auto selects video, photo or audio without a prompt',()=>{
  assert.equal(detectMedia('example.MP4'),'video');
  assert.equal(detectMedia('photo.jpeg'),'imageEdit');
  assert.equal(detectMedia('vocal.FLAC'),'audio');
  assert.equal(detectMedia('notes.pdf'),null);
  assert.equal(detectMedia('../malicious.exe'),null);
});
