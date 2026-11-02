import type { ReviewInspection } from './types';

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildReviewInspectionCSV(inspections: ReviewInspection[]): string {
  const headers = [
    '리뷰 ID', '작성자 식별자', '리뷰 본문', '전체 검수 상태', '충족 항목 수',
    '부분 충족 항목 수', '미충족 항목 수', '보완할 항목', 'AI 피드백', '검수 시각',
  ];
  const rows = inspections.map(result => [
    result.reviewId,
    result.authorId ?? '',
    result.text,
    result.status,
    String(result.satisfiedCount),
    String(result.partialCount),
    String(result.missingCount),
    result.items.filter(item => item.required && item.status !== '충족' && item.status !== '해당 없음')
      .map(item => `${item.title}: ${item.missingInfo.join(' · ') || item.status}`).join(' / '),
    result.error ?? [
      result.summary,
      ...result.items.filter(item => item.required && item.status !== '충족')
        .map(item => `${item.title}: ${item.feedback}`),
      result.disclosure.feedback,
    ].filter(Boolean).join(' / '),
    result.inspectedAt,
  ]);
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}
