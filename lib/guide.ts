import type { ProductProject, ReviewGuide } from './types';
import type { GuideGenerationInput } from './ai/types';

export function buildGuideGenerationInput(project: ProductProject): GuideGenerationInput {
  const analysisIsExample = /예시|모의/.test(project.workspace.mode);
  const reviewById = new Map(project.workspace.reviews.map(review => [review.id, review]));
  const grouped = new Map<string, {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
    evidence: { sentiment: string; quote: string }[];
  }>();

  if (!analysisIsExample) {
    for (const result of project.workspace.results) {
      let topic = grouped.get(result.theme);
      if (!topic) {
        topic = { positive: 0, negative: 0, neutral: 0, mixed: 0, evidence: [] };
        grouped.set(result.theme, topic);
      }
      if (result.sentiment === '긍정') topic.positive++;
      else if (result.sentiment === '부정') topic.negative++;
      else if (result.sentiment === '중립') topic.neutral++;
      else if (result.sentiment === '혼합') topic.mixed++;

      const source = reviewById.get(result.id);
      if (topic.evidence.length < 2 && source?.text.includes(result.evidence)) {
        topic.evidence.push({ sentiment: result.sentiment, quote: result.evidence.slice(0, 500) });
      }
    }
  }

  const topics = [...grouped.entries()].slice(0, 20).map(([theme, counts]) => ({
    theme,
    positive: counts.positive,
    negative: counts.negative,
    neutral: counts.neutral,
    mixed: counts.mixed,
    evidence: counts.evidence,
  }));
  const hasAnalysis = topics.length > 0;
  return {
    product: {
      name: project.productName,
      description: project.productDescription,
      emphasizedStrengths: project.strengths.map(item => item.trim()).filter(Boolean),
      targetCustomers: project.targetCustomers,
      useSituations: project.useSituations.map(item => item.trim()).filter(Boolean),
    },
    evaluationItems: project.evaluationItems.map(item => item.title),
    ...(hasAnalysis ? {
      existingReviewAnalysis: {
        stale: project.analyzedInputVersion !== project.analysisInputVersion,
        topics,
      },
    } : {}),
  };
}

export function isReviewGuideStale(guide: ReviewGuide | undefined, project: ProductProject): boolean {
  return !guide || guide.sourceVersion === undefined || guide.sourceVersion !== project.guideInputVersion;
}

export function formatReviewGuideMarkdown(guide: ReviewGuide): string {
  const sections = [
    `# ${guide.title ?? '리뷰단 가이드'}`,
    `상품: ${guide.productName ?? ''}`,
    `타깃 고객: ${guide.targetCustomers ?? ''}`,
    '',
    `## 가이드 목적\n${guide.purpose ?? ''}`,
    ...(guide.testItems ?? []).flatMap((item, index) => [
      '',
      `## 테스트 ${index + 1}. ${item.title}`,
      `**테스트 목적:** ${item.purpose}`,
      `**추천 사용 상황:** ${item.recommendedSituation}`,
      `**테스트 방법:** ${item.method}`,
      '',
      '**관찰하거나 기록할 정보**',
      ...item.observe.map(value => `- ${value}`),
      '',
      '**참고 질문**',
      ...item.questions.map(value => `- ${value}`),
      '',
      '**체크리스트**',
      ...item.checklist.map(value => `- [ ] ${value}`),
    ]),
    '',
    '## 리뷰 작성 안내',
    ...(guide.writingGuidance ?? []).map(value => `- ${value}`),
    '',
  ];
  return sections.join('\n');
}

export function formatReviewGuideText(guide: ReviewGuide): string {
  return formatReviewGuideMarkdown(guide)
    .replace(/^#{1,6}\s/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^- \[ \] /gm, '[ ] ');
}
