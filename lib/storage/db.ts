// No database access at module load: this module can safely be imported during SSR.
export const PROJECTS = 'projects';
export const SETTINGS = 'settings';
let connection: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('이 브라우저에서는 IndexedDB를 사용할 수 없습니다.'));
  }
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('demandlab', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(PROJECTS, { keyPath: 'id' });
        db.createObjectStore(SETTINGS);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('다른 DemandLab 탭을 닫고 다시 시도해 주세요.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
    }).catch(error => { connection = undefined; throw error; });
  }
  return connection;
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('저장이 취소되었습니다.'));
  });
}

export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
