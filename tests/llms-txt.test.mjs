import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const text = await readFile(new URL('../public/llms.txt', import.meta.url), 'utf8');

test('llms.txt is structured and covers the approved public collections', () => {
  assert.match(text, /^# Carrie Gabaree\n/);
  assert.match(text, /^> .+/m);
  assert.match(text, /^## Oral-history interviews and transcripts$/m);
  assert.match(text, /\[Archive search\]\(https:\/\/carriegabaree\.com\/search\)/);
  for (const id of ['CORHC-0001', 'CORHC-0002', 'CORHC-0003', 'CORHC-0004', 'CORHC-0005', 'CGDA-0001']) {
    assert.match(text, new RegExp(id));
  }
  assert.doesNotMatch(text, /ai-train\s*=\s*yes/i);
  assert.ok(text.length < 12000);
});
