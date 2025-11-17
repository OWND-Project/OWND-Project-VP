export interface OkResult<T> {
  ok: true;
  payload: T;
}

export interface OkVoidResult {
  ok: true;
}

export interface NgResult<T> {
  ok: false;
  error: T;
}

export type Result<T, E> = OkResult<T> | NgResult<E>;
export type VoidResult<E> = OkVoidResult | NgResult<E>;
