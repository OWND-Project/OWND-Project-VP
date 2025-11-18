// PEX-related verification functions removed - no longer needed in DCQL flow
// All extract functions (extractPresentation, extractCredential, extractNestedCredential, getDescriptorMap)
// were only used by deprecated PEX methods and have been removed

export type Token = string | Record<string, any>;

export interface VerifiableCredentialResult<T, U> {
  id: string;
  format: string;
  raw: T;
  value: U;
  verified: boolean;
}

export interface ExtractedCredential<T, U> {
  raw: T;
  value: U;
  verified: boolean;
}

export interface ExtractResultOk<T> {
  ok: true;
  payload: T;
}

export interface ExtractResultNg<T> {
  ok: false;
  error: { type: T; cause?: Error | unknown };
}

export type ExtractResult<T, E> = ExtractResultOk<T> | ExtractResultNg<E>;

export type VerifierFunction<T, U> = (credential: T) => Promise<U>;

export type ExtractVerifiableCredentialError =
  | "UNSUPPORTED_FORMAT"
  | "DECODE_VP_FAILURE"
  | "DECODE_VC_FAILURE"
  | "EXCEPTION_OCCURRED";

export type ExtractError =
  | "UNMATCHED_PATH"
  | "UNSUPPORTED_FORMAT"
  | "DECODE_FAILURE"
  | "VALIDATE_FAILURE";
