import { EndpointError } from "../../oid4vp/response-endpoint.js";
import {
  CredentialError,
  DescriptorError,
  GetRequestError,
  PresentationError,
} from "../../oid4vp/verifier.js";
import { NotSuccessResult } from "../../types/app-types.js";
import { PostState } from "../types.js";
import { Result } from "../../tool-box/index.js";
import { IdTokenError } from "../../oid4vp/siop-v2.js";

export const handleRequestError = (
  requestId: string,
  error: GetRequestError,
): NotSuccessResult => {
  const { type } = error;
  console.error(type);
  if (type === "NOT_FOUND") {
    console.log(`${error.subject} is not found`);
    return { type: "NOT_FOUND" };
  } else if (type === "EXPIRED") {
    return { type: "EXPIRED" };
  } else if (type === "CONSUMED") {
    const message = `request ${requestId} is already consumed`;
    return { type: "CONFLICT" };
  } else {
    return { type: "UNEXPECTED_ERROR", cause: error.cause };
  }
};

export const checkStateForDelete = (
  state: PostState | null,
): Result<{ id: string }, NotSuccessResult> => {
  if (!state) {
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  } else if (state.value === "expired") {
    return { ok: false, error: { type: "EXPIRED" } };
  } else if (state.value === "committed") {
    return { ok: false, error: { type: "CONFLICT" } };
  } else if (state.value !== "started") {
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }
  if (!state.targetId) {
    return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
  }
  return { ok: true, payload: { id: state.targetId } };
};

export const handleIdTokenError = (error: IdTokenError): NotSuccessResult => {
  const { type } = error;
  console.error(type);
  if (type === "NOT_FOUND") {
    console.log(`${error.subject} is not found`);
    return {
      type: "NOT_FOUND",
      message: "id_token is not found.",
    };
  } else if (type === "EXPIRED") {
    return { type: "EXPIRED", message: "id_token is expired." };
  } else if (type === "VALIDATE_FAILURE") {
    return {
      type: "INVALID_PARAMETER",
      message: "id_token can not be validated.",
    };
  } else {
    return error;
  }
};

export const handleEndpointError = (error: EndpointError): NotSuccessResult => {
  const { type } = error;
  console.error(type);
  if (type === "NOT_FOUND") {
    console.log(`${error.subject} is not found`);
    return {
      type: "NOT_FOUND",
      message: "authorization response is not found.",
    };
  } else if (type === "EXPIRED") {
    return { type: "EXPIRED", message: "authorization response is expired." };
  } else if (type === "INVALID_AUTH_RESPONSE_PAYLOAD") {
    return {
      type: "UNEXPECTED_ERROR",
      message: "invalid authorization response has been saved.",
    };
  } else {
    return { type: "UNEXPECTED_ERROR", cause: error.cause };
  }
};

export const handleDescriptorError = (
  error: DescriptorError,
): NotSuccessResult => {
  const { type } = error;
  console.error(type);
  if (type === "NOT_FOUND") {
    return { type: "UNEXPECTED_ERROR" };
  } else if (type === "EXPIRED") {
    return { type: "EXPIRED" };
  } else if (type === "INVALID_SUBMISSION") {
    return { type: "INVALID_PARAMETER", message: error.reason };
  } else {
    return { type: "UNEXPECTED_ERROR" };
  }
};

export const handlePresentationError = (
  error: PresentationError,
): NotSuccessResult => {
  const { type } = error;
  console.error(type);
  if (type === "EXPIRED") {
    return { type: "EXPIRED" };
  } else if (type === "INVALID_SUBMISSION") {
    return { type: "INVALID_PARAMETER", message: error.reason };
  } else {
    return { type: "UNEXPECTED_ERROR" };
  }
};

export const handleCredentialError = (
  error: CredentialError,
): NotSuccessResult => {
  const { type } = error;
  console.error(type);
  if (type === "INVALID_SUBMISSION") {
    return { type: "INVALID_PARAMETER", message: error.reason };
  } else {
    return { type: "UNEXPECTED_ERROR" };
  }
};
