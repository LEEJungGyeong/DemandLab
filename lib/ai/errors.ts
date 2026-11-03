export type AIErrorCode =
  | 'invalid-request'
  | 'missing-api-key'
  | 'openai-authentication'
  | 'openai-rate-limit'
  | 'openai-model-error'
  | 'provider-error'
  | 'ollama-unavailable'
  | 'ollama-model-missing'
  | 'invalid-json'
  | 'invalid-response'
  | 'guide-product-missing'
  | 'guide-evaluation-missing'
  | 'invalid-guide-response'
  | 'review-check-guide-missing'
  | 'review-check-reviews-missing'
  | 'invalid-review-check-response'
  | 'invalid-review-draft'
  | 'network-error';

const messages: Record<AIErrorCode, string> = {
  'invalid-request': 'AI 요청 형식이 올바르지 않습니다.',
  'missing-api-key': 'OpenAI API 키를 입력한 뒤 연결을 확인해 주세요.',
  'openai-authentication': 'OpenAI API 키가 올바르지 않거나 해당 요청 권한이 없습니다.',
  'openai-rate-limit': 'OpenAI 사용량 제한에 도달했습니다. 사용량과 결제 상태를 확인해 주세요.',
  'openai-model-error': '선택한 OpenAI 모델을 호출하지 못했습니다. 모델 이름과 계정의 모델 접근 권한을 확인해 주세요.',
  'provider-error': 'AI 제공자 요청에 실패했습니다. 모델과 제공자 상태를 확인해 주세요.',
  'ollama-unavailable': 'Ollama에 연결할 수 없습니다. Ollama를 실행하고 127.0.0.1:11434에서 응답하는지 확인해 주세요.',
  'ollama-model-missing': '선택한 Ollama 모델을 찾을 수 없습니다. 설치된 모델 목록을 새로고침해 주세요.',
  'invalid-json': 'AI 응답을 JSON 형식으로 읽지 못했습니다. 다른 모델로 다시 시도해 주세요.',
  'invalid-response': 'AI 응답에 필수 결과가 없거나 형식이 올바르지 않습니다.',
  'guide-product-missing': '가이드 생성에 필요한 상품명, 상품 설명, 강조할 강점, 목표 고객을 먼저 입력해 주세요.',
  'guide-evaluation-missing': '가이드에 포함할 핵심 평가 항목을 하나 이상 선택해 주세요.',
  'invalid-guide-response': 'AI가 필수 가이드 항목을 빠뜨리거나 잘못된 형식으로 응답했습니다. 다시 생성해 주세요.',
  'review-check-guide-missing': '저장된 구조화 리뷰 가이드가 없습니다. 먼저 리뷰 가이드를 생성하고 저장해 주세요.',
  'review-check-reviews-missing': '검수할 리뷰를 한 건 이상 입력해 주세요.',
  'invalid-review-check-response': 'AI 검수 응답이 올바른 형식이 아니거나 리뷰 원문 근거가 일치하지 않습니다.',
  'invalid-review-draft': 'AI 초안의 문장 형식이나 사용 경험 근거가 맞지 않습니다. 입력 내용을 구체적으로 적고 다시 생성해 주세요.',
  'network-error': 'AI 요청 중 네트워크 오류가 발생했습니다. 연결 상태를 확인하고 다시 시도해 주세요.',
};

export class AIServiceError extends Error {
  readonly code: AIErrorCode;
  readonly status: number;

  constructor(code: AIErrorCode, status = 502) {
    super(messages[code]);
    this.name = 'AIServiceError';
    this.code = code;
    this.status = status;
  }
}

export function toAIServiceError(error: unknown): AIServiceError {
  if (error instanceof AIServiceError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new AIServiceError('network-error', 504);
  }
  if (error instanceof TypeError) return new AIServiceError('network-error', 502);
  return new AIServiceError('provider-error', 502);
}
