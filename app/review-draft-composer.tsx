'use client';

import { useRef, useState } from 'react';
import type { AISettings } from '../lib/ai/types';
import { RHETORICAL_TECHNIQUES, type ReviewDraftInput, type ReviewDraftResponse } from '../lib/ai/review-draft';
import type { ProductProject, ReviewComposition } from '../lib/types';
import { isReviewGuideStale } from '../lib/guide';

type Props = {
  project: ProductProject;
  settings: AISettings;
  apiKey: string;
  onOpenSettings: () => void;
  onSave: (projectId: string, value: ReviewComposition) => boolean;
  onAdd: (projectId: string, text: string) => boolean;
  onOpenInspection: () => void;
};

const empty: ReviewComposition = {
  experience: '', techniques: ['구체적 묘사', '인과 설명', '장단점 균형'], relationship: '', text: '',
};
const descriptions = {
  '구체적 묘사': '언제·어디서·어떻게 사용했는지 선명하게',
  '비교·대조': '직접 관찰한 전후·조건별 차이를 나란히',
  '인과 설명': '관찰한 결과와 평가 이유를 연결',
  '장단점 균형': '좋았던 점과 아쉬웠던 점을 함께',
};
const inputSignature = (input: ReviewDraftInput) => JSON.stringify([
  input.mode ?? 'experience', input.product, input.guide, input.guideVersion,
  input.experience, input.techniques, input.relationship,
]);

export default function ReviewDraftComposer({ project, settings, apiKey, onOpenSettings, onSave, onAdd, onOpenInspection }: Props) {
  const value = project.reviewComposition ?? empty;
  const guide = project.guide;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const context = `${settings.provider}:${settings.models[settings.provider]}`;
  const [failure, setFailure] = useState({ message: '', context });
  const error = failure.context === context ? failure.message : '';
  const setError = (message: string) => setFailure({ message, context });
  const [message, setMessage] = useState('');
  const input: ReviewDraftInput = {
    ...(value.mode === 'guide-example' ? { mode: 'guide-example' as const } : {}),
    product: { name: project.productName, description: project.productDescription,
      strengths: project.strengths.map(s => s.trim()).filter(Boolean) },
    guide: value.mode === 'guide-example' ? { checklist: [] } : guide ?? { checklist: [] },
    guideVersion: value.mode === 'guide-example' ? '' : guide?.updatedAt ?? guide?.generatedAt ?? '',
    experience: value.mode === 'guide-example' ? '' : value.experience.trim(),
    techniques: value.mode === 'guide-example' ? [...RHETORICAL_TECHNIQUES] : value.techniques,
    relationship: value.mode === 'guide-example' ? '시연용 가상 데이터' : value.relationship || '없음',
  };
  const signature = inputSignature(input);
  const changed = Boolean(value.signature && value.signature !== signature);
  const ready = value.experience.trim().length >= 20 && value.relationship && value.techniques.length > 0;
  const update = (patch: Partial<ReviewComposition>) => {
    onSave(project.id, { ...value, ...patch });
    setError(''); setMessage('');
  };

  async function generate(example = false) {
    if (busyRef.current || (!example && (!ready || !guide?.testItems?.length))) return;
    const requestInput: ReviewDraftInput = example
      ? { ...input, mode: 'guide-example', guide: { checklist: [] }, guideVersion: '', experience: '', techniques: [...RHETORICAL_TECHNIQUES], relationship: '시연용 가상 데이터' }
      : { ...input, mode: undefined, guide: guide!, guideVersion: guide!.updatedAt ?? guide!.generatedAt,
        experience: value.experience.trim(), techniques: value.techniques, relationship: value.relationship || '없음' };
    if ((settings.provider === 'openai' && !apiKey.trim())
      || (settings.provider === 'ollama' && !settings.models.ollama)) {
      setError(settings.provider === 'openai' ? 'OpenAI API 키를 입력해 주세요.' : '설치된 Ollama 모델을 선택해 주세요.');
      onOpenSettings(); return;
    }
    if (value.text && !window.confirm('현재 리뷰 초안을 새 생성 결과로 바꿀까요?')) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/draft-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: settings.provider, model: settings.models[settings.provider], input: requestInput,
          ...(settings.provider !== 'ollama' ? { key: apiKey } : {}) }),
      });
      const data = await response.json() as { error?: string; draft?: ReviewDraftResponse & {
        generatedAt: string; provider: AISettings['provider']; model: string;
      } };
      if (!response.ok) throw new Error(data.error || '리뷰 초안 생성에 실패했습니다.');
      if (!data.draft || typeof data.draft.text !== 'string' || !Array.isArray(data.draft.sentences)) {
        throw new Error('리뷰 초안 응답 형식이 올바르지 않습니다.');
      }
      const draft = data.draft;
      if (!onSave(project.id, { ...value, mode: requestInput.mode, text: draft.text, generatedText: draft.text,
        sentences: draft.sentences, signature: inputSignature(requestInput), generatedAt: draft.generatedAt, provider: draft.provider, model: draft.model })) {
        throw new Error('프로젝트가 바뀌어 결과를 저장하지 않았습니다. 원래 프로젝트에서 다시 생성해 주세요.');
      }
      setMessage(example ? '강조하고 싶은 상품 강점을 반영한 예시 리뷰를 자동 생성했습니다.'
        : '리뷰 초안을 생성했습니다. 경험과 다른 표현이 없는지 확인하고 검수로 보내세요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '리뷰 초안 생성에 실패했습니다.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function sendToInspection() {
    setError('');
    if (!onAdd(project.id, value.text)) {
      setError('검수 목록에 추가하지 못했습니다. 프로젝트와 리뷰 수 제한(50건)을 확인해 주세요.'); return;
    }
    onOpenInspection();
  }

  return <section className="dashboard-card review-draft-composer" aria-labelledby="review-draft-title">
    <div className="eyebrow">AI REVIEW WRITING</div>
    <h2 id="review-draft-title">D. 상품 강점으로 AI 리뷰 작성</h2>
    <p>상품 정보에서 입력한 ‘강조하고 싶은 상품 강점’을 기준으로 리뷰를 자동 생성합니다.</p>
    <details className="reading-details"><summary>반영할 상품 강점 · {project.strengths.filter(s => s.trim()).length}개</summary><div className="guide-review-summary">
      <ul>{project.strengths.filter(s => s.trim()).map((s, i) => <li key={i}>{s}</li>)}</ul>
      {!project.strengths.some(s => s.trim()) && <p>상품 정보에서 강조하고 싶은 강점을 먼저 입력해 주세요.</p>}
    </div>
    </details>
    <div className="guide-actions"><button className="primary" type="button" disabled={busy || !project.productName.trim() || !project.strengths.some(s => s.trim())} onClick={() => void generate(true)}>
      {busy ? '상품 강점에 맞춰 리뷰를 작성하고 있어요…' : '상품 강점으로 리뷰 자동 생성'}
    </button><span>추가 입력 없이 생성</span></div>
    <p className="muted-note">테스트 가이드 생성이나 경험 입력 없이 사용할 수 있습니다. 실제 사용 경험이 아닌 예시 리뷰로 표시됩니다.</p>
    {guide && isReviewGuideStale(guide, project) && value.mode !== 'guide-example' && <div className="stale-notice">가이드 생성 이후 입력이 변경됐습니다. 경험 기반 작성에는 현재 저장된 가이드를 사용합니다.</div>}
    <details><summary>직접 기록한 사용 경험으로 작성하기</summary>
    <label className="inspection-field">사용 경험과 관찰 기록 <small>필수 · 20~6,000자</small>
      <textarea rows={7} maxLength={6000} value={value.experience} disabled={busy}
        placeholder={'사용 상황 / 직접 확인한 변화 / 좋았던 점 / 아쉬웠던 점을 적어 주세요.\n비교 표현을 쓰려면 실제 비교한 조건과 결과를 함께 적어 주세요. 시연용 가상 경험은 아래에서 가상 데이터를 선택하세요.'}
        onChange={event => update({ experience: event.target.value })} />
    </label>
    <fieldset className="rhetoric-options" disabled={busy}><legend>작성 방식 <small>입력한 경험에 맞춰 적용</small></legend>
      {RHETORICAL_TECHNIQUES.map(technique => <label key={technique}>
        <input type="checkbox" checked={value.techniques.includes(technique)} onChange={event => update({
          techniques: event.target.checked ? [...value.techniques, technique] : value.techniques.filter(t => t !== technique),
        })} /> <span><strong>{technique}</strong><small>{descriptions[technique]}</small></span>
      </label>)}
    </fieldset>
    <label className="inspection-field">제품·광고 제공 관계 <small>필수</small>
      <select value={value.relationship} disabled={busy} onChange={event => update({ relationship: event.target.value as ReviewComposition['relationship'] })}>
        <option value="">관계를 선택하세요</option><option value="없음">제공·광고 관계 없음</option>
        <option value="제품 제공">제품 제공받음</option><option value="광고비 지원">광고비 지원받음</option>
        <option value="시연용 가상 데이터">시연용 가상 데이터</option>
      </select>
    </label>
    <div className="guide-actions"><button className="primary" type="button" disabled={!ready || busy || !guide?.testItems?.length} onClick={() => void generate()}>
      {busy ? '사용 경험을 리뷰 문장으로 정리하고 있어요…' : value.text ? '리뷰 초안 다시 생성' : 'AI 리뷰 초안 생성'}
    </button><span>{settings.provider === 'ollama' ? 'Ollama' : 'OpenAI'} · {settings.models[settings.provider] || '모델 미선택'}</span></div>
    </details>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {value.text && <>
      {changed && <div className="stale-notice">생성에 사용한 상품 정보 또는 입력이 변경됐습니다. 다시 생성한 후 검수로 보내세요.</div>}
      <label className="inspection-field">생성된 리뷰 초안 <small>확인·편집 가능</small>
        <textarea rows={9} maxLength={6000} disabled={busy} value={value.text} onChange={event => update({ text: event.target.value })} />
      </label>
      <small>{value.provider === 'ollama' ? 'Ollama' : 'OpenAI'} · {value.model} · 프로젝트에 자동 저장</small>
      <details className="draft-evidence"><summary>문장 구성과 입력 근거 확인</summary>
        {value.text !== value.generatedText && <p>초안을 직접 수정했습니다. 아래 근거는 최초 생성 문장 기준입니다.</p>}
        <ol>{value.sentences?.map((sentence, index) => <li key={index}>
          <strong>{sentence.technique}</strong><p>{sentence.text}</p><blockquote>{value.mode === 'guide-example' ? '반영한 상품 강점' : '입력 근거'}: {sentence.evidence}</blockquote>
        </li>)}</ol>
      </details>
      <button className="primary" type="button" disabled={busy || changed || !value.text.trim()} onClick={() => void sendToInspection()}>
        확인한 초안을 검수 목록에 추가하고 이동
      </button>
    </>}
  </section>;
}
