import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/project-analysis.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} });
const { isAnalysisStale, recordProjectAnalysis } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const project = {
  analysisInputVersion: 2,
  analyzedInputVersion: 2,
  workspace: { results: [], themes: [], reviews: [] },
};

test('recorded analysis stays current until product or review input version changes', () => {
  const analyzed = recordProjectAnalysis(project, {
    results: [{ id: 0, theme: '착용감', subtheme: '편안함', sentiment: '긍정', evidence: '편해요' }],
    themes: [{ name: '착용감' }],
    mode: 'AI 분석 완료',
    notice: '원문 근거 확인 완료',
  });
  assert.equal(isAnalysisStale(analyzed), false);
  assert.equal(isAnalysisStale({ ...analyzed, analysisInputVersion: 3 }), true);
  assert.equal(isAnalysisStale({
    ...project,
    analyzedInputVersion: undefined,
    workspace: { ...project.workspace, results: analyzed.workspace.results },
  }), true);
});

test('recording analysis preserves other project and workspace data', () => {
  const withData = { ...project, id: 'product-a', workspace: { ...project.workspace, reviews: [{ id: 0, text: '리뷰' }] } };
  const analyzed = recordProjectAnalysis(withData, {
    results: [], themes: [], mode: '업로드 데이터', notice: '준비됨',
  });
  assert.equal(analyzed.id, 'product-a');
  assert.deepEqual(analyzed.workspace.reviews, withData.workspace.reviews);
  assert.equal(analyzed.analyzedInputVersion, 2);
});
