// NDJSON progress keeps the UI responsive while the server validates and merges batches.
export async function readAnalysisResponse(response: Response, onProgress: (completed: number, total: number) => void): Promise<unknown> {
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) return response.json();
  if (!response.body) throw new Error('분석 응답을 읽을 수 없습니다.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: unknown;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error || '분석 요청에 실패했습니다.');
    if (event.type === 'progress') onProgress(event.completed, event.total);
    if (event.type === 'result') result = event.data;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop()!;
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(pending);
    if (!result) throw new Error('분석 연결이 중단되었습니다. 다시 시도해 주세요.');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
