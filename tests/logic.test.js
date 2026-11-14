import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoPrompt, validateMusic, safeProviderUrl, safeOutputPath, publicJob } from '../src/logic.js';

test('video instructions are bounded and include preset', () => {
  const p = buildVideoPrompt('urban', 'Change the background into an evening street scene.');
  assert.match(p, /urban nighttime/);
  assert.throws(() => buildVideoPrompt('none', 'Change the entire background please.'));
});
test('music validation rejects empty and costly duration', () => {
  assert.deepEqual(validateMusic('Original upbeat Dominican dembow beat', 30).seconds, 30);
  assert.throws(() => validateMusic('copy', 30));
  assert.throws(() => validateMusic('Original upbeat Dominican dembow beat', 9000));
});
test('only safe output URLs and paths', () => {
  assert.throws(() => safeProviderUrl('http://localhost:3000/private'));
  assert.throws(() => safeProviderUrl('https://127.0.0.1/foo'));
  assert.match(safeProviderUrl('https://cdn.example.com/file.mp4'), /cdn/);
  assert.match(safeOutputPath('/data', '12345678-1234-1234-1234-123456789012', 'video'), /\.mp4$/);
});
test('public jobs never leak private provider links', () => {
  const job = publicJob({id:'123', kind:'video', title:'New edit', status:'done', ready:true, sourcePath:'/secret', outputUrl:'https://private'});
  assert.equal(job.sourcePath, undefined);
  assert.equal(job.outputUrl, undefined);
});
