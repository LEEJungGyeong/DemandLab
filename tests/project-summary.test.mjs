import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScriptModule } from './ts-module-loader.mjs';

const { summarizeProject } = await importTypeScriptModule('../lib/project-summary.ts');

function project(overrides = {}) {
  return {
    id: 'project-1',
    name: '이어폰 캠페인',
    productName: '무선 이어폰 A',
    productDescription: '통학과 음악 감상용',
    strengths: ['착용감'],
    targetCustomers: '대학생 및 통학생',
    useSituations: [],
    evaluationItems: [{ id: 'fit', title: '착용감' }],
    workspace: { reviews: [{ id: 1 }, { id: 2 }] },
    guideInputVersion: 3,
    submittedReviews: [{ id: 'review-1' }, { id: 'review-2' }],
    inspections: [],
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}

test('project summaries show real project readiness and counts for the active guide version', () => {
  const summary = summarizeProject(project({
    guide: { generatedAt: 'guide-v3', updatedAt: 'guide-v3', sourceVersion: 3 },
    inspections: [
      { reviewId: 'review-1', status: '보완 필요', guideVersion: 'guide-v3', inspectedAt: '2026-10-31T00:01:00.000Z' },
      { reviewId: 'review-2', status: '문제 없음', guideVersion: 'guide-v3', inspectedAt: '2026-10-31T00:02:00.000Z' },
      { reviewId: 'review-2', status: '검수 실패', guideVersion: 'guide-v3', inspectedAt: '2026-10-31T00:03:00.000Z' },
      { reviewId: 'review-1', status: '문제 없음', guideVersion: 'old-guide', inspectedAt: '2026-10-31T00:04:00.000Z' },
    ],
  }));
  assert.equal(summary.productName, '무선 이어폰 A');
  assert.equal(summary.targetCustomers, '대학생 및 통학생');
  assert.equal(summary.stage, '검수 결과 있음');
  assert.equal(summary.reviewCount, 2);
  assert.equal(summary.evaluationCount, 1);
  assert.equal(summary.hasGuide, true);
  assert.equal(summary.demoData, false);
  assert.equal(summary.inspectedCount, 2);
  assert.equal(summary.revisionCount, 1);
  assert.equal(summary.failedCount, 1);
});

test('project list marks demo analysis separately from real review analysis', () => {
  assert.equal(summarizeProject(project({
    workspace: { reviews: [], mode: '예시 · 모의 분석' },
  })).demoData, true);
});

test('project summary suggests the earliest incomplete real step', () => {
  assert.equal(summarizeProject(project({ productName: '' })).stage, '상품 정보 입력');
  assert.equal(summarizeProject(project({ evaluationItems: [] })).stage, '평가 항목 설정');
  assert.equal(summarizeProject(project({
    guide: { generatedAt: 'guide-v1', sourceVersion: 3 },
    submittedReviews: [],
  })).stage, '가이드 준비 완료');
  assert.equal(summarizeProject(project({
    guide: { generatedAt: 'guide-v1', sourceVersion: 3 },
  })).stage, '검수 대기');
  assert.equal(summarizeProject(project({
    guide: { generatedAt: 'guide-v1', sourceVersion: 2 },
  })).stage, '가이드 확인');
});
