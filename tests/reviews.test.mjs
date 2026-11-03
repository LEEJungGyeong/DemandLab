import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// These modules have type-only imports; transpile without adding a test framework.
async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { parseCSV, readReviewCSV } = await loadModule('../lib/csv.ts');
const { normalizeReviews } = await loadModule('../lib/review.ts');
const { createDemoAnalysis } = await loadModule('../lib/demo.ts');

test('CSV BOM, commas, escaped quotes, multiline and TSV remain supported', () => {
  assert.deepEqual(parseCSV('\uFEFF리뷰,별점\r\n"좋아요, \"\"추천\"\"\n다시 구매",5\r\n'),
    [['리뷰', '별점'], ['좋아요, "추천"\n다시 구매', '5']]);
  assert.deepEqual(parseCSV('리뷰\t별점\n편해요\t4'), [['리뷰', '별점'], ['편해요', '4']]);
  assert.throws(() => parseCSV('리뷰\n"미완성'), /따옴표/);
});

test('file loading detects columns, decodes EUC-KR and rejects invalid files', async () => {
  const file = new File(['리뷰,별점,작성일,옵션\n좋아요,5,2026-10-30,흰색'], 'reviews.csv');
  const data = await readReviewCSV(file);
  assert.deepEqual(data.mapping, { text: 0, rating: 1, date: 2, option: 3 });
  const korean = new File([new Uint8Array([0xba, 0xbb, 0xb9, 0xae, 10, 0xc1, 0xc1, 0xbe, 0xc6, 0xbf, 0xe4])], 'korean.csv');
  assert.deepEqual((await readReviewCSV(korean)).rows, [['본문'], ['좋아요']]);
  await assert.rejects(readReviewCSV(new File(['리뷰'], 'empty.csv')), /열 이름/);
  await assert.rejects(readReviewCSV(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.csv')), /5MB/);
});

test('DevDay CSV fixtures are fictional and parse into the expected review rows', async () => {
  const existing = parseCSV(await readFile(new URL('./fixtures/devday-existing-reviews.csv', import.meta.url), 'utf8'));
  const drafts = parseCSV(await readFile(new URL('./fixtures/devday-review-drafts.csv', import.meta.url), 'utf8'));
  assert.equal(existing.length, 5);
  assert.equal(existing[0][0], '리뷰 본문');
  assert.ok(existing.slice(1).every(row => row[4] === '가상 시연 데이터'));
  assert.equal(normalizeReviews(existing, { text: 0, rating: 1, date: 2, option: 3 }).reviews.length, 4);
  assert.equal(drafts.length, 4);
  assert.ok(drafts.slice(1).every(row => row[2] === '가상 시연 데이터'));
});

test('normalization removes empty/duplicate reviews and preserves sponsor detection', () => {
  const data = normalizeReviews([['리뷰', '별점'], [' 좋아요 ', '5'], ['', '1'], ['좋아요', '3'], ['쿠팡체험단 리뷰', '4']],
    { text: 0, rating: 1, date: -1, option: -1 });
  assert.equal(data.skipped, 2);
  assert.equal(data.reviews.length, 2);
  assert.equal(data.reviews[0].rating, '5');
  assert.equal(data.reviews[1].id, 1);
  assert.equal(data.reviews[1].sponsored, true);
  const demo = createDemoAnalysis(data.reviews);
  assert.equal(demo.results.length, 2);
  assert.ok(demo.results.every(result => result.sentiment === '중립'));
});
