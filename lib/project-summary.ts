import type { ProductProject, ProjectSummary, ReviewInspection } from './types';

export function summarizeProject(project: ProductProject): ProjectSummary {
  const guideVersion = project.guide?.updatedAt || project.guide?.generatedAt || '';
  const latestInspectionByReview = new Map<string, ReviewInspection>();
  const successfulInspectionByReview = new Map<string, ReviewInspection>();

  for (const inspection of project.inspections ?? []) {
    const latest = latestInspectionByReview.get(inspection.reviewId);
    if (!latest || inspection.inspectedAt > latest.inspectedAt) {
      latestInspectionByReview.set(inspection.reviewId, inspection);
    }
    if (inspection.status === '검수 실패' || inspection.guideVersion !== guideVersion) continue;
    const successful = successfulInspectionByReview.get(inspection.reviewId);
    if (!successful || inspection.inspectedAt > successful.inspectedAt) {
      successfulInspectionByReview.set(inspection.reviewId, inspection);
    }
  }

  const currentInspections = [...successfulInspectionByReview.values()];
  const completeProduct = Boolean(project.productName.trim() && project.productDescription.trim()
    && project.strengths.some(item => item.trim()) && project.targetCustomers.trim());
  const staleGuide = Boolean(project.guide
    && (project.guide.sourceVersion === undefined
      || project.guide.sourceVersion !== project.guideInputVersion));
  const stage = !completeProduct ? '상품 정보 입력'
    : !project.evaluationItems.length ? '평가 항목 설정'
      : !project.guide ? '가이드 생성 전'
        : staleGuide ? '가이드 확인'
          : currentInspections.length ? '검수 결과 있음'
            : project.submittedReviews.length ? '검수 대기'
              : '가이드 준비 완료';

  return {
    id: project.id,
    name: project.name,
    productName: project.productName,
    targetCustomers: project.targetCustomers,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    stage,
    demoData: /예시|모의/.test(project.workspace.mode),
    reviewCount: project.workspace.reviews.length,
    evaluationCount: project.evaluationItems.length,
    hasGuide: Boolean(project.guide),
    inspectedCount: currentInspections.length,
    revisionCount: currentInspections.filter(result => result.status === '보완 필요').length,
    failedCount: [...latestInspectionByReview.values()].filter(result =>
      result.status === '검수 실패' && result.guideVersion === guideVersion).length,
  };
}
