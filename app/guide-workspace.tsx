'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Clipboard, Download, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { AISettings } from '../lib/ai/types';
import type { ProductProject, ReviewGuide, ReviewGuideTestItem } from '../lib/types';
import {
  buildGuideGenerationInput, formatReviewGuideMarkdown, formatReviewGuideText, isReviewGuideStale,
} from '../lib/guide';

type Props = {
  project: ProductProject | null;
  settings: AISettings;
  apiKey: string;
  settingsReady: boolean;
  onOpenSettings: () => void;
  onBack: () => void;
  onSaveGuide: (projectId: string, guide: ReviewGuide) => boolean;
  saveNow: () => Promise<void>;
  storageStatus: string;
  storageError: string;
};

const splitLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);

function isGuide(value: unknown): value is ReviewGuide {
  if (!value || typeof value !== 'object') return false;
  const guide = value as ReviewGuide;
  return typeof guide.title === 'string' && typeof guide.purpose === 'string'
    && Array.isArray(guide.testItems) && Array.isArray(guide.writingGuidance)
    && typeof guide.generatedAt === 'string';
}

export default function GuideWorkspace({
  project, settings, apiKey, settingsReady, onOpenSettings, onBack, onSaveGuide,
  saveNow, storageStatus, storageError,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState({ message: '', provider: settings.provider, model: settings.models[settings.provider] });
  const error = failure.provider === settings.provider && failure.model === settings.models[settings.provider]
    ? failure.message : '';
  function setError(message: string) {
    setFailure({ message, provider: settings.provider, model: settings.models[settings.provider] });
  }
  const [message, setMessage] = useState('');
  const busyRef = useRef(false);
  const inputSection = useRef<HTMLDetailsElement>(null);
  const generationSection = useRef<HTMLDetailsElement>(null);
  const outputSection = useRef<HTMLDetailsElement>(null);
  function openSection(section: 'input' | 'generate' | 'output') {
    const target = section === 'input' ? inputSection : section === 'generate' ? generationSection : outputSection;
    if (target.current) target.current.open = true;
  }

  const input = project ? buildGuideGenerationInput(project) : undefined;
  const guide = isGuide(project?.guide) ? project.guide : undefined;
  const hasSavedGuide = Boolean(project?.guide);
  const stale = project ? isReviewGuideStale(guide, project) : true;
  const ready = Boolean(project?.productName.trim() && project.productDescription.trim()
    && project.strengths.some(item => item.trim()) && project.targetCustomers.trim()
    && project.evaluationItems.length);
  const providerName = settings.provider === 'gemini' ? 'Gemini' : settings.provider === 'openai' ? 'OpenAI' : 'Ollama';
  const model = settings.models[settings.provider] || (settings.provider === 'openai' ? 'gpt-4.1-mini' : '선택되지 않음');

  function updateGuide(patch: Partial<ReviewGuide>) {
    if (!guide || !project) return;
    const next = {
      ...guide,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (patch.testItems) next.checklist = patch.testItems.flatMap(item => item.checklist);
    if (patch.writingGuidance) next.content = patch.writingGuidance.join('\n');
    next.content = formatReviewGuideMarkdown(next);
    if (!onSaveGuide(project.id, next)) {
      setError('상품 프로젝트가 바뀌어 가이드를 저장하지 않았습니다. 해당 프로젝트를 다시 선택해 주세요.');
      return;
    }
    setMessage('변경 사항을 프로젝트에 자동 저장하고 있습니다.');
  }

  function updateTestItem(id: string, patch: Partial<ReviewGuideTestItem>) {
    if (!guide?.testItems) return;
    updateGuide({ testItems: guide.testItems.map(item => item.id === id ? { ...item, ...patch } : item) });
  }

  function updateList(id: string, field: 'observe' | 'questions' | 'checklist', value: string) {
    updateTestItem(id, { [field]: splitLines(value) });
  }

  async function generate() {
    if (busyRef.current || !project || !input || !ready || !settingsReady) return;
    if (hasSavedGuide && !window.confirm('현재 가이드가 새 생성 결과로 바뀝니다. 기존 편집 내용을 덮어쓸까요?')) return;
    if (settings.provider === 'openai' && !apiKey.trim()) {
      setError('가이드 생성 전에 OpenAI API 키를 입력해 주세요.');
      onOpenSettings();
      return;
    }
    if (settings.provider === 'ollama' && !settings.models.ollama) {
      setError('AI 연결 설정에서 설치된 Ollama 모델을 조회하고 선택해 주세요.');
      onOpenSettings();
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/generate-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.models[settings.provider],
          ...(settings.provider !== 'ollama' ? { key: apiKey } : {}),
          input,
        }),
      });
      const data = await response.json() as { guide?: unknown; error?: string };
      if (!response.ok) throw new Error(data.error || 'AI 가이드 생성 요청이 실패했습니다.');
      if (!isGuide(data.guide)) throw new Error('AI 응답에 필수 가이드 항목이 없거나 형식이 올바르지 않습니다.');
      const saved = onSaveGuide(project.id, {
        ...data.guide,
        sourceVersion: project.guideInputVersion ?? 0,
      });
      if (!saved) throw new Error('요청 중 상품 프로젝트가 바뀌어 가이드를 저장하지 않았습니다. 해당 프로젝트를 다시 선택해 주세요.');
      openSection('output');
      setMessage('가이드를 생성하고 현재 상품 프로젝트에 저장했습니다.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '가이드 생성 중 네트워크 오류가 발생했습니다.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function addTestItem() {
    if (!guide?.testItems) return;
    const item: ReviewGuideTestItem = {
      id: crypto.randomUUID(),
      title: '새 테스트 항목',
      purpose: '확인하려는 내용을 입력하세요.',
      recommendedSituation: '추천 사용 상황을 입력하세요.',
      method: '안전하고 일반적인 사용 조건에서 실제로 수행할 방법을 입력하세요.',
      observe: ['관찰하거나 기록할 정보를 입력하세요.'],
      questions: ['실제 경험을 묻는 질문을 입력하세요.'],
      checklist: ['확인할 내용을 입력하세요.'],
    };
    updateGuide({ testItems: [...guide.testItems, item] });
  }

  function deleteTestItem(id: string) {
    if (!guide?.testItems || guide.testItems.length < 2) {
      setError('테스트 항목은 최소 1개 이상 유지해야 합니다.');
      return;
    }
    updateGuide({ testItems: guide.testItems.filter(item => item.id !== id) });
  }

  async function save() {
    setError('');
    try {
      await saveNow();
      setMessage('가이드를 IndexedDB에 저장했습니다.');
    } catch {
      setError('가이드를 저장하지 못했습니다. 저장소 오류를 확인하고 다시 시도해 주세요.');
    }
  }

  async function copy() {
    if (!guide) return;
    try {
      await navigator.clipboard.writeText(formatReviewGuideMarkdown(guide));
      setMessage('가이드를 클립보드에 복사했습니다.');
      setError('');
    } catch {
      setError('클립보드에 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.');
    }
  }

  function download(format: 'txt' | 'md') {
    if (!guide) return;
    const text = format === 'md' ? formatReviewGuideMarkdown(guide) : formatReviewGuideText(guide);
    const mimeType = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${guide.productName || project?.productName || 'DemandLab'}_리뷰가이드.${format}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(format === 'md'
      ? 'UTF-8 Markdown 가이드 파일을 다운로드했습니다.'
      : 'UTF-8 텍스트 가이드 파일을 다운로드했습니다.');
  }

  return (
    <section className="content guide-content">
      <div className="guide-topbar">
        <button className="plain" type="button" onClick={onBack}><ArrowLeft size={16} />리뷰 분석으로 돌아가기</button>
        <span>{project?.name ?? '상품 프로젝트 없음'}</span>
      </div>
      <div className="title-row">
        <div>
          <div className="eyebrow">REVIEWER GUIDE</div>
          <h1>리뷰단 가이드</h1>
          <p>준비 상태를 확인하고, 필요한 항목만 펼쳐서 편집하세요.</p>
        </div>
      </div>

      <div className="guide-at-glance">
        <div><span>상품 준비</span><strong>{ready ? '생성 준비 완료' : '입력 확인 필요'}</strong></div>
        <div><span>평가 항목</span><strong>{project?.evaluationItems.length ?? 0}<small>개</small></strong></div>
        <div><span>테스트 가이드</span><strong>{guide ? `${guide.testItems?.length ?? 0}개 항목` : '생성 전'}</strong></div>
        <a href={guide ? '#guide-output' : '#guide-generate'} onClick={() => openSection(guide ? 'output' : 'generate')}>{guide ? '가이드 편집하기' : '생성 설정으로 이동'} →</a>
      </div>
      <nav className="guide-jump" aria-label="가이드 섹션 바로가기"><a href="#guide-input" onClick={() => openSection('input')}>A · 프로젝트 정보</a><a href="#guide-generate" onClick={() => openSection('generate')}>B · 생성 설정</a><a href="#guide-output" onClick={() => openSection('output')}>C · 가이드 편집</a></nav>
      <div className="guide-preparation-grid">
      <details id="guide-input" ref={inputSection} className="guide-section-disclosure">
        <summary><h2>A. 프로젝트 정보</h2><ChevronDown size={20} aria-hidden="true" /></summary>
        <section className="dashboard-card guide-input-card">
        <p>입력한 상품 정보와 평가 항목을 사용합니다.</p>
        {!project ? <div className="empty">먼저 상품 분석 화면에서 상품 프로젝트를 선택하거나 생성해 주세요.</div> : <>
          <div className="guide-project-brief"><strong>{project.productName || '상품명 미입력'}</strong><span>강점 {project.strengths.filter(s => s.trim()).length}개 · 평가 항목 {project.evaluationItems.length}개</span></div>
          <div className="guide-project-details">
          <dl className="guide-project-summary">
            <div><dt>상품명</dt><dd>{project.productName || '미입력'}</dd></div>
            <div><dt>상품 설명 및 주요 특징</dt><dd>{project.productDescription || '미입력'}</dd></div>
            <div><dt>목표 고객층</dt><dd>{project.targetCustomers || '미입력'}</dd></div>
            <div><dt>강조하고 싶은 강점 <small>사업자 입력 · 검증 전</small></dt>
              <dd>{project.strengths.length ? project.strengths.join(' · ') : '미입력'}</dd></div>
            <div><dt>주요 사용 상황</dt><dd>{project.useSituations.length ? project.useSituations.join(' · ') : '별도 지정 없음'}</dd></div>
            <div><dt>선택된 평가 항목</dt>
              <dd>{project.evaluationItems.length
                ? project.evaluationItems.map(item => item.title).join(' · ')
                : '선택된 평가 항목이 없습니다.'}</dd></div>
          </dl>
          {input?.existingReviewAnalysis && <div className="guide-review-summary">
            <strong>기존 리뷰 분석 주제도 참고합니다{input.existingReviewAnalysis.stale ? ' · 최신이 아닐 수 있음' : ''}</strong>
            <ul>{input.existingReviewAnalysis.topics.map(topic =>
              <li key={topic.theme}>{topic.theme} — 긍정 {topic.positive} · 부정 {topic.negative}
                {' · 중립 '}{topic.neutral} · 혼합 {topic.mixed}
                {topic.evidence.length > 0 && <blockquote>{topic.evidence[0].quote}</blockquote>}
              </li>)}</ul>
          </div>}
          {!input?.existingReviewAnalysis && project.workspace.results.length > 0
            && <p className="muted-note">예시·모의 분석 결과는 실제 리뷰 분석 근거로 AI에 전달하지 않습니다.</p>}
        </div></>}
      </section>
      </details>

      <details id="guide-generate" ref={generationSection} className="guide-section-disclosure">
        <summary><h2>B. AI 생성 설정</h2><ChevronDown size={20} aria-hidden="true" /></summary>
        <section className="guide-generation-panel">
        <div>
          <div className="eyebrow">AI GENERATION</div>
          <p>{providerName} · {model}</p>
          <small>{settings.provider === 'ollama'
            ? '내 컴퓨터의 Ollama 모델로 생성합니다.'
            : `${providerName}로 생성합니다. 사용량에 따른 비용이 발생할 수 있습니다.`}</small>
        </div>
        <div className="guide-generation-actions">
          <button className="plain" type="button" onClick={onOpenSettings}>AI 연결 설정</button>
          <button className="primary" type="button" disabled={!ready || busy || !settingsReady} onClick={() => void generate()}>
            {busy ? 'AI가 안전한 테스트 항목을 구성하고 있어요…'
              : hasSavedGuide ? <><RefreshCw size={16} />가이드 다시 생성</> : 'AI 리뷰 가이드 생성'}
          </button>
        </div>
        {!ready && <p className="guide-required" role="status">
          생성하려면 상품명, 상품 설명, 강조할 강점, 목표 고객층과 평가 항목을 입력해 주세요. 리뷰 CSV 분석은 선택 사항입니다.
        </p>}
      </section>
      </details>

      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {storageError && <div className="error" role="alert">{storageError}</div>}
      {message && <div className="notice" role="status">{message}</div>}

      <details id="guide-output" ref={outputSection} className="guide-section-disclosure guide-output-disclosure">
        <summary><h2>C. 생성된 가이드 편집</h2><ChevronDown size={20} aria-hidden="true" /></summary>
      {guide && <section className="guide-editor">
        {stale && <div className="stale-notice" role="status">
          상품 정보, 평가 항목 또는 기존 리뷰 분석이 가이드 생성 이후 변경되었습니다. 기존 가이드는 보존되어 있으며 다시 생성하거나 직접 수정할 수 있습니다.
        </div>}
        <section className="dashboard-card">
          <div className="section-title">
            <div><p>{guide.provider === 'gemini' ? 'Gemini' : guide.provider === 'openai' ? 'OpenAI' : guide.provider === 'ollama' ? 'Ollama' : '기존 저장 가이드'}
                {guide.model ? ` · ${guide.model}` : ''} · 생성 {new Date(guide.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                {guide.updatedAt ? ` · 수정 ${new Date(guide.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : ''}</p>
            </div>
            <span className="badge">{stale ? '입력 변경됨' : '현재 입력 기준'}</span>
          </div>
          <label className="guide-field">가이드 제목
            <input maxLength={160} value={guide.title ?? ''} onChange={event => updateGuide({ title: event.target.value })} />
          </label>
          <label className="guide-field">가이드 목적
            <textarea rows={3} maxLength={1200} value={guide.purpose ?? ''}
              onChange={event => updateGuide({ purpose: event.target.value })} />
          </label>
          {guide.testItems?.map((item, index) => <details className="guide-test-card reading-test" key={item.id}>
            <summary><span className="test-index">{String(index + 1).padStart(2, '0')}</span><span className="test-summary-copy"><strong>{item.title || '새 테스트 항목'}</strong><small>{item.required !== false ? '필수 평가' : '선택 평가'} · 체크리스트 {item.checklist.length}개</small></span><span className="expand-label">상세 편집</span></summary>
            <div className="test-edit-body">
            <div className="guide-test-heading">
              <h3>테스트 {index + 1}</h3>
              <label className="guide-required-toggle">
                <input type="checkbox" checked={item.required !== false}
                  onChange={event => updateTestItem(item.id, { required: event.target.checked })} />
                필수 평가 항목
              </label>
              <button className="plain" type="button" onClick={() => deleteTestItem(item.id)}>
                <Trash2 size={15} />항목 삭제
              </button>
            </div>
            <label className="guide-field">평가 주제
              <input maxLength={160} value={item.title}
                onChange={event => updateTestItem(item.id, { title: event.target.value })} />
            </label>
            <label className="guide-field">테스트 목적
              <textarea rows={2} maxLength={800} value={item.purpose}
                onChange={event => updateTestItem(item.id, { purpose: event.target.value })} />
            </label>
            <label className="guide-field">추천 테스트 상황
              <textarea rows={2} maxLength={500} value={item.recommendedSituation}
                onChange={event => updateTestItem(item.id, { recommendedSituation: event.target.value })} />
            </label>
            <label className="guide-field">실제 테스트 방법
              <textarea rows={3} maxLength={1200} value={item.method}
                onChange={event => updateTestItem(item.id, { method: event.target.value })} />
            </label>
            <div className="guide-list-fields">
              <label className="guide-field">관찰하거나 기록할 정보 <small>줄마다 한 항목</small>
                <textarea rows={4} value={item.observe.join('\n')}
                  onChange={event => updateList(item.id, 'observe', event.target.value)} />
              </label>
              <label className="guide-field">작성 시 참고할 질문 <small>줄마다 한 항목</small>
                <textarea rows={4} value={item.questions.join('\n')}
                  onChange={event => updateList(item.id, 'questions', event.target.value)} />
              </label>
              <label className="guide-field">체크리스트 <small>줄마다 한 항목</small>
                <textarea rows={4} value={item.checklist.join('\n')}
                  onChange={event => updateList(item.id, 'checklist', event.target.value)} />
              </label>
            </div>
          </div></details>)}
          <button className="plain" type="button" onClick={addTestItem}><Plus size={16} />테스트 항목 추가</button>
          <details className="reading-details"><summary>리뷰 작성 안내 편집 · {guide.writingGuidance?.length ?? 0}개</summary><label className="guide-field writing-guidance">리뷰 작성 안내 <small>줄마다 한 항목</small>
            <textarea rows={7} value={(guide.writingGuidance ?? []).join('\n')}
              onChange={event => {
                const writingGuidance = splitLines(event.target.value);
                updateGuide({ writingGuidance, content: writingGuidance.join('\n') });
              }} />
          </label>
          </details>
          <div className="guide-safety-note">
            실제로 수행하지 않은 내용은 작성하지 않도록 안내하세요. 제품 제공·협찬 등 경제적 관계는 해당 플랫폼과 관련 기준에 맞게 공개해야 합니다.
          </div>
          <div className="guide-actions">
            <button className="primary" type="button" onClick={() => void save()}><Check size={16} />가이드 저장</button>
            <button className="plain" type="button" onClick={() => void copy()}><Clipboard size={16} />가이드 복사</button>
            <button className="plain" type="button" onClick={() => download('txt')}><Download size={16} />UTF-8 텍스트 다운로드</button>
            <button className="plain" type="button" onClick={() => download('md')}><Download size={16} />Markdown 다운로드</button>
          </div>
          <small role="status">저장 상태: {storageStatus}</small>
        </section>
      </section>}



      {project?.guide && !guide && <section className="dashboard-card guide-editor">
        <div className="stale-notice" role="status">이전에 저장된 가이드 형식입니다. 원본은 유지되며, 새 가이드를 생성할 때만 확인 후 교체합니다.</div>
        <h3>{project.guide.title ?? '리뷰 가이드'}</h3>
        <p className="legacy-guide-content">{project.guide.editedContent ?? project.guide.content}</p>
        {!!project.guide.checklist.length && <ul>
          {project.guide.checklist.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>}
      </section>}

      {!project?.guide && !guide && <div className="empty guide-empty">
        <strong>아직 생성된 가이드가 없습니다.</strong>
        <p>필수 상품 정보와 평가 항목을 준비하면 AI 가이드 초안을 만들 수 있습니다. 기존 고객 리뷰 분석이 없어도 생성할 수 있습니다.</p>
      </div>}
      </details>

    </section>
  );
}
