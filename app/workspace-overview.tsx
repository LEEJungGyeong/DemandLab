'use client';
import { useState } from 'react';
import { ArrowUpRight, MessageSquare, Star, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { isAnalysisStale } from '../lib/project-analysis';
import type { ProductProject } from '../lib/types';

type Props = { project?: ProductProject; onNavigate: (step: number) => void };
export default function WorkspaceOverview({project,onNavigate}:Props){
 const [query,setQuery]=useState('');
 const [onlyAttention,setOnlyAttention]=useState(false);
 const reviews=project?.workspace.reviews ?? [];
 const reviewIds=new Set(reviews.map(r=>r.id));
 const results=(project?.workspace.results ?? []).filter(r=>reviewIds.has(r.id));
 const stale=project ? isAnalysisStale(project) : false;
 const ratings=reviews.map(r=>Number(r.rating)).filter(n=>n>=1&&n<=5);
 const negative=new Set(results.filter(r=>r.sentiment==='부정').map(r=>r.id));
 const positive=new Set(results.filter(r=>r.sentiment==='긍정').map(r=>r.id));
 const topics=[...new Set(results.map(r=>r.theme))].map(name=>({name,count:new Set(results.filter(r=>r.theme===name).map(r=>r.id)).size,negative:new Set(results.filter(r=>r.theme===name&&r.sentiment==='부정').map(r=>r.id)).size})).sort((a,b)=>b.count-a.count).slice(0,5);
 const visible=reviews.filter(r=>r.text.toLowerCase().includes(query.toLowerCase())&&(!onlyAttention||negative.has(r.id)||Number(r.rating)>0&&Number(r.rating)<=2));
 const attention=reviews.filter(r=>negative.has(r.id)||Number(r.rating)>0&&Number(r.rating)<=2).length;
 const analyzed=new Set(results.map(r=>r.id)).size;
 return <div className="overview-board">
  <div className="overview-context"><span className="live-dot"/><b>{project?.productName||project?.name||'새 워크스페이스'}</b><span>{reviews.length?'현재 프로젝트 기준':'리뷰를 등록하면 분석 현황이 표시됩니다'}</span>{/예시|모의|데모/.test(project?.workspace.mode ?? '')&&<em>예시·모의 데이터</em>}{stale&&results.length>0&&<em>입력 변경됨 · 재분석 필요</em>}</div>
  <div className="overview-kpis">{[
   {label:'등록 리뷰',value:reviews.length.toLocaleString(),unit:'건',icon:MessageSquare,note:'현재 프로젝트 전체 리뷰'},
   {label:'평균 평점',value:ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1):'—',unit:'/ 5',icon:Star,note:`유효 평점 ${ratings.length}건 기준`},
   {label:'확인할 리뷰',value:attention,unit:'건',icon:AlertCircle,note:'부정 분석 또는 평점 2점 이하'},
   {label:'분석된 리뷰',value:analyzed,unit:'건',icon:CheckCircle2,note:`전체 ${reviews.length}건 중 분석 완료`},
  ].map(({label,value,unit,icon:Icon,note})=><article key={label}><div><span>{label}</span><Icon size={18}/></div><strong>{value}<small>{unit}</small></strong><p>{note}</p></article>)}</div>
  <div className="overview-grid">
   <section className="overview-panel overview-topics"><div className="panel-heading"><div><span className="overline">CUSTOMER VOICE</span><h2>고객이 많이 이야기한 주제</h2></div><button onClick={()=>onNavigate(2)} aria-label="리뷰 분석 열기"><ArrowUpRight size={20}/></button></div>
    {topics.length?<div className="topic-ranking">{topics.map((t,i)=><div key={t.name}><span className="rank">0{i+1}</span><div><div className="topic-label"><b>{t.name}</b><span>{t.count}건 · 부정 {t.negative}건</span></div><div className="topic-track"><span style={{width:`${t.count/Math.max(...topics.map(t=>t.count))*100}%`}}/></div></div></div>)}</div>:<div className="overview-empty"><MessageSquare size={30}/><strong>아직 분석된 리뷰가 없어요</strong><p>리뷰를 불러오고 분석하면 주요 주제와 부정 반응을 비교할 수 있어요.</p><button onClick={()=>onNavigate(2)}>리뷰 분석 시작 <ArrowUpRight size={15}/></button></div>}
    {!!results.length&&<div className="sentiment-summary"><span>긍정 언급 <b>{positive.size}건</b></span><span>부정 언급 <b>{negative.size}건</b></span><small>한 리뷰에 여러 감성이 포함될 수 있습니다.</small></div>}
   </section>
   <section className="overview-panel next-panel"><span className="overline">NEXT ACTION</span><h2>다음 할 일을 확인하세요</h2><p>상품 이해부터 리뷰 검수까지,<br/>단계별로 이어서 진행할 수 있어요.</p><div className="next-actions">{[
    {step:1,title:'상품과 타깃 설정',detail:project?.productName?'상품 정보 확인·수정':'상품 정보 입력이 필요해요',done:!!project?.productName},
    {step:2,title:'리뷰 분석·평가 항목',detail:`리뷰 ${reviews.length}건 · 평가 항목 ${project?.evaluationItems.length??0}개`,done:!!project?.evaluationItems.length},
    {step:3,title:'리뷰단 가이드 만들기',detail:project?.guide?'저장된 가이드 확인':'평가 항목으로 테스트 설계',done:!!project?.guide},
    {step:4,title:'리뷰 초안 검수',detail:`제출된 리뷰 ${project?.submittedReviews.length??0}건`,done:!!project?.inspections.length},
   ].map(a=><button key={a.step} onClick={()=>onNavigate(a.step)}><span className={a.done?'step-done':'step-index'}>{a.done?<CheckCircle2 size={18}/>:a.step}</span><span><b>{a.title}</b><small>{a.detail}</small></span><ArrowUpRight size={17}/></button>)}</div></section>
   <section className="overview-panel overview-reviews"><div className="panel-heading"><div><span className="overline">REVIEW INBOX</span><h2>리뷰를 빠르게 살펴보세요 <small>{reviews.length}</small></h2></div><button onClick={()=>onNavigate(2)}>전체 분석 <ArrowUpRight size={16}/></button></div>
   <div className="overview-review-toolbar"><label><Search size={17}/><input aria-label="대시보드 리뷰 검색" placeholder="리뷰 내용 검색" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className={onlyAttention?'selected':''} aria-pressed={onlyAttention} onClick={()=>setOnlyAttention(!onlyAttention)}>주의 리뷰만 {attention}</button></div>
   {visible.length?<div className="overview-review-list">{visible.slice(0,4).map(r=><details key={r.id}><summary><span className="rating-pill"><Star size={13}/>{r.rating||'—'}</span><span>{r.text}</span><span className="review-state">{negative.has(r.id)?'부정 언급':positive.has(r.id)?'긍정 언급':'원문 확인'}</span></summary><p>{r.text}</p><small>{r.date||'작성일 미등록'} · {r.option||'옵션 미등록'}</small></details>)}</div>:<p className="inbox-empty">{reviews.length?'검색 조건에 맞는 리뷰가 없습니다.':'아직 등록된 리뷰가 없습니다. CSV를 업로드하거나 기존 리뷰 분석에서 예시 데이터를 살펴보세요.'}</p>}
   {visible.length>4&&<button className="more-reviews" onClick={()=>onNavigate(2)}>나머지 {visible.length-4}건은 리뷰 분석에서 보기 →</button>}
   </section>
  </div>
 </div>
}
