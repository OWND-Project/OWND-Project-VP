import { Docs, KeyValues, Node } from "../orbit-db/index.js";

export type BoolNodeType = "BOOL_NODE" | "API_NODE";
export type AppType = BoolNodeType | "VERIFIER_NODE";
export interface BoolNodeAppContext {
  type: "BOOL_NODE" | "API_NODE";
  node: Node;
  docs: Docs;
}
export interface VerifierNodeAppContext {
  type: "VERIFIER_NODE";
  node: Node;
  openedKeyValues: KeyValues;
}
export type AppContext = BoolNodeAppContext | VerifierNodeAppContext;

export interface Message {
  message?: string;
}

export interface InvalidParameterResult extends Message {
  type: "INVALID_PARAMETER";
}

export interface InvalidHeader extends Message {
  type: "INVALID_HEADER";
}

export interface NotFoundResult extends Message {
  type: "NOT_FOUND";
}

export interface EXPIRED_RESOURCE extends Message {
  type: "EXPIRED";
}

export interface DuplicatedErrorResult extends Message {
  type: "DUPLICATED_ERROR";
}

export interface Conflict extends Message {
  type: "CONFLICT";
  instance?: string;
}

export interface GoneResult extends Message {
  type: "GONE";
}

export interface InternalError extends Message {
  type: "INTERNAL_ERROR";
}

export interface UnsupportedCurve extends Message {
  type: "UNSUPPORTED_CURVE";
}

export interface KeyDoesNotMatch extends Message {
  type: "KEY_DOES_NOT_MATCH";
}

export interface UnexpectedError extends Message {
  type: "UNEXPECTED_ERROR";
  cause?: Error | unknown;
}

export type NotSuccessResult =
  | InvalidParameterResult
  | InvalidHeader
  | NotFoundResult
  | EXPIRED_RESOURCE
  | DuplicatedErrorResult
  | Conflict
  | GoneResult
  | InternalError
  | UnsupportedCurve
  | KeyDoesNotMatch
  | UnexpectedError;
