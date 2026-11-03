import type { ReviewInspection } from './types';

export function mergeReviewInspectionResults(
  existing: ReviewInspection[],
  incoming: ReviewInspection[],
): ReviewInspection[] {
  const results = new Map<string, ReviewInspection>();
  for (const result of existing) {
    const key = result.status === '검수 실패'
      ? `failure:${result.reviewId}:${result.inspectedAt}`
      : `success:${result.reviewId}:${result.guideVersion}`;
    results.set(key, result);
  }
  for (const result of incoming) {
    const key = result.status === '검수 실패'
      ? `failure:${result.reviewId}:${result.inspectedAt}`
      : `success:${result.reviewId}:${result.guideVersion}`;
    results.set(key, result);
  }
  return [...results.values()];
}
