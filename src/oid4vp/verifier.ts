import { v4 as uuidv4 } from "uuid";
import { PrivateJwk } from "elliptic-jwk";

import { Result } from "../tool-box/index.js";
import {
  ConsumedError,
  DescriptorMap,
  ExpiredError,
  InputDescriptor,
  UnexpectedError,
  NotFoundError,
  PresentationDefinition,
  PresentationSubmission,
  SubmissionRequirement,
} from "./types.js";

import { AuthResponsePayload, VpRequest } from "./response-endpoint.js";
import {
  camelToSnake,
  generateRequestObjectJwt,
  GenerateRequestObjectOptions,
  generateRequestObjectPayload,
  MissingSignerKey,
  snakeToCamel,
  UnsupportedClientIdSchemeError,
} from "./auth-request.js";
import {
  extractNestedCredential,
  extractCredential,
  extractPresentation,
  getDescriptorMap,
  VerifierFunction,
} from "./verify.js";
import { getCurrentUnixTimeInSeconds, isExpired } from "../utils/data-util.js";

export interface VpRequestAtVerifier {
  id: string;
  nonce: string;
  session?: string;
  transactionId?: string;
  issuedAt: number;
  expiredIn: number;
  consumedAt: number;
}

export interface VerifierDatastore {
  saveRequest: (request: VpRequestAtVerifier) => Promise<void>;
  getRequest: (requestId: string) => Promise<VpRequestAtVerifier | null>;
  savePresentationDefinition: (
    presentationDefinition: PresentationDefinition,
  ) => Promise<void>;
  getPresentationDefinition: (
    presentationDefinitionId: string,
  ) => Promise<PresentationDefinition | null>;
}

export type AuthorizationRequest = {
  clientId: string;
  params?: Record<string, any>;
  requestUri?: string;
};

export interface InvalidSubmission {
  type: "INVALID_SUBMISSION";
  reason: string;
}
export interface NoSubmission {
  type: "NO_SUBMISSION";
}
export interface ValidateFailure {
  type: "VALIDATE_FAILURE";
}

export type DescriptorError =
  | NotFoundError
  | ExpiredError
  | UnexpectedError
  | InvalidSubmission
  | NoSubmission;
export type PresentationError =
  | ExpiredError
  | UnexpectedError
  | InvalidSubmission
  | NoSubmission;
export type CredentialError = InvalidSubmission;

export type GetRequestError =
  | NotFoundError
  | ExpiredError
  | ConsumedError
  | UnexpectedError;

export type Verifier = ReturnType<typeof initVerifier>;
/**
 * The Verifier function provides functionality to start vp requests and generate presentation definitions using the provided datastore.
 * @param datastore - A datastore object used to save request data
 * @returns An object that provides two methods: `startRequest` and `generatePresentationDefinition`
 */
export const initVerifier = (datastore: VerifierDatastore) => {
  const state: { authResponse?: AuthResponsePayload } = {};
  /**
   * Starts a vp request and saves it in the datastore.
   * Generates a unique nonce for the request, sets the issued time, and specifies an expiration time.
   * @param request - The verification request data
   * @param clientId
   * @param opts - Optional object where you can specify an expiration time (expiredIn).
   * @returns A Promise that resolves to `VpRequestAtVerifier` type with the request data
   */
  const startRequest = async (
    request: VpRequest,
    clientId: string,
    opts?: {
      expiredIn?: number;
      issuerJwk?: PrivateJwk;
      requestObject?: GenerateRequestObjectOptions;
      generateId?: () => string;
      x5c?: string[];
    },
  ) => {
    const nonce = opts?.generateId ? opts.generateId() : uuidv4();
    const __request: VpRequestAtVerifier = {
      id: request.id,
      nonce,
      issuedAt: new Date().getTime() / 1000,
      expiredIn: opts?.expiredIn ?? 3600,
      consumedAt: 0,
    };
    if (request.transactionId) {
      __request.transactionId = request.transactionId;
    }
    await datastore.saveRequest(__request);

    const __opts: GenerateRequestObjectOptions = {
      ...opts?.requestObject,
      state: opts?.requestObject?.state || __request.id,
      nonce: opts?.requestObject?.nonce || __request.nonce,
    };

    // https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#name-verifier-metadata-managemen
    const clientIdScheme =
      opts?.requestObject?.clientIdScheme || "redirect_uri";
    if (clientIdScheme === "redirect_uri") {
      const authRequest = generateRequestObjectPayload(clientId, __opts);
      return {
        clientId,
        params: camelToSnake(authRequest),
      };
    } else if (
      clientIdScheme === "x509_san_dns" ||
      clientIdScheme === "x509_san_uri"
    ) {
      if (opts && opts.issuerJwk) {
        const { issuerJwk } = opts;
        return {
          clientId,
          request: await generateRequestObjectJwt(clientId, issuerJwk, {
            ...__opts,
            x509CertificateInfo: { x5c: opts.x5c },
          }),
        };
      } else {
        throw new MissingSignerKey(
          "The provided client_id_scheme needs to sign request object",
        );
      }
    } else {
      throw new UnsupportedClientIdSchemeError(
        "The provided client_id_scheme is not supported in the current implementation.",
      );
    }
  };
  const getRequest = async (
    requestId: string,
  ): Promise<Result<VpRequestAtVerifier, GetRequestError>> => {
    const subject = "VpRequest";
    const identifier = requestId;
    try {
      const request = await datastore.getRequest(requestId);
      if (!request) {
        return { ok: false, error: { type: "NOT_FOUND", subject, identifier } };
      } else {
        if (isExpired(request.issuedAt, request.expiredIn)) {
          return { ok: false, error: { type: "EXPIRED", subject, identifier } };
        }
        if (0 < request.consumedAt) {
          return {
            ok: false,
            error: { type: "CONSUMED", subject, identifier },
          };
        }
      }
      return { ok: true, payload: request };
    } catch (err) {
      console.error(err);
      return { ok: false, error: { type: "UNEXPECTED_ERROR", cause: err } };
    }
  };

  const consumeRequest = async (
    requestId: string,
  ): Promise<Result<VpRequestAtVerifier, GetRequestError>> => {
    // const request = await datastore.getRequest(requestId);
    const request = await getRequest(requestId);
    if (!request.ok) {
      return request;
    }
    const __request = {
      ...request.payload,
      consumedAt: getCurrentUnixTimeInSeconds(),
    };
    try {
      await datastore.saveRequest(__request);
      return { ok: true, payload: __request };
    } catch (err) {
      console.error(err);
      return { ok: false, error: { type: "UNEXPECTED_ERROR", cause: err } };
    }
  };

  /**
   * Generates a presentation definition and saves it in the datastore.
   * The presentation definition includes input descriptors, submission requirements, and optionally a name and purpose.
   * @param inputDescriptors - An array of input descriptors
   * @param submissionRequirements - An array of submission requirements
   * @param name - The name of the presentation definition (optional)
   * @param purpose - The purpose of the presentation definition (optional)
   * @returns A Promise that resolves to the presentation definition object
   */
  const generatePresentationDefinition = async (
    inputDescriptors: InputDescriptor[],
    submissionRequirements: SubmissionRequirement[],
    name: string = "",
    purpose: string = "",
  ) => {
    // https://identity.foundation/presentation-exchange/#presentation-definition
    const pd = {
      id: uuidv4(),
      inputDescriptors,
      submissionRequirements: submissionRequirements,
      name,
      purpose,
    };
    await datastore.savePresentationDefinition(pd);
    return pd;
  };

  /**
   *
   * @param presentationDefinitionId
   */
  const getPresentationDefinition = async (
    presentationDefinitionId: string,
  ) => {
    return await datastore.getPresentationDefinition(presentationDefinitionId);
  };

  /**
   *
   * @param presentationDefinitionId
   */
  const getPresentationDefinitionMap = async (
    presentationDefinitionId: string,
  ) => {
    const pd = await getPresentationDefinition(presentationDefinitionId);
    if (pd) {
      return camelToSnake(pd);
    } else {
      return null;
    }
  };

  const getOptionalDescriptor = async (
    inputDescriptorId: string,
    authResponse: AuthResponsePayload,
  ): Promise<
    Result<{ descriptorMap: DescriptorMap | null }, DescriptorError>
  > => {
    const result = await getDescriptor(inputDescriptorId, authResponse);
    if (!result.ok) {
      const { type } = result.error;
      if (type === "NO_SUBMISSION") {
        return { ok: true, payload: { descriptorMap: null } };
      }
    }
    return result;
  };

  const getDescriptor = async (
    inputDescriptorId: string,
    authResponse: AuthResponsePayload,
  ): Promise<Result<{ descriptorMap: DescriptorMap }, DescriptorError>> => {
    const { presentationSubmission } = authResponse;

    let submission: PresentationSubmission;
    try {
      submission = snakeToCamel(JSON.parse(presentationSubmission));
    } catch (err) {
      return {
        ok: false,
        error: { type: "UNEXPECTED_ERROR", cause: err },
      };
    }
    const pd = await getPresentationDefinition(submission.definitionId);
    if (!pd) {
      return {
        ok: false,
        error: { type: "NOT_FOUND", subject: "Presentation Definition" },
      };
    }
    const inputDescriptor = pd.inputDescriptors.filter(
      (item) => item.id === inputDescriptorId,
    );
    if (!inputDescriptor || inputDescriptor.length === 0) {
      return {
        ok: false,
        error: { type: "INVALID_SUBMISSION", reason: "No Input Descriptor" },
      };
    }
    const descMap = getDescriptorMap(
      inputDescriptor[0],
      submission.descriptorMap,
    );
    if (!descMap) {
      return {
        ok: false,
        error: { type: "NO_SUBMISSION" },
      };
    }
    setAuthResponse(authResponse);
    return { ok: true, payload: { descriptorMap: descMap } };
  };

  interface VP<T> {
    decoded: T;
    raw: any;
  }
  interface Presentation<T = any> {
    vp: VP<T>;
    descriptorMap: DescriptorMap;
  }
  const getPresentation = async <T, U>(
    descMap: DescriptorMap,
    verifier?: VerifierFunction<T, U>,
  ): Promise<Result<Presentation<U>, PresentationError>> => {
    const { vpToken, presentationSubmission } = getAuthResponse()!;
    const opts = verifier ? { verifier } : undefined;
    const extractResult = await extractPresentation<T, U>(
      vpToken,
      descMap,
      opts,
    );
    if (extractResult.ok) {
      return {
        ok: true,
        payload: {
          vp: extractResult.payload,
          descriptorMap: descMap,
        },
      };
    } else {
      const { error } = extractResult;
      let reason = "";
      if (error.type === "UNMATCHED_PATH") {
        reason = "vp token matched to path is not found";
      } else if (error.type === "UNSUPPORTED_FORMAT") {
        reason = `unsupported format (${descMap.format}) specified`;
      } else if (error.type === "DECODE_FAILURE") {
        reason = `decode ${vpToken} was failed`;
      } else if (error.type === "VALIDATE_FAILURE") {
        reason = `validate ${vpToken} was failed`;
      }
      return { ok: false, error: { type: "INVALID_SUBMISSION", reason } };
    }
  };

  const getCredential = async <T, U>(
    presentation: Presentation,
    verifier: VerifierFunction<T, U>,
  ): Promise<Result<{ raw: T; decoded: U }, CredentialError>> => {
    const { format, path, pathNested } = presentation.descriptorMap;
    const opts = { verifier };
    if (pathNested) {
      const extractResult = await extractNestedCredential<T, U>(
        presentation.vp.decoded,
        pathNested.format,
        pathNested.path,
        opts,
      );
      if (extractResult.ok) {
        return { ok: true, payload: extractResult.payload };
      } else {
        const { error } = extractResult;
        let reason = "";
        if (error.type === "UNMATCHED_PATH") {
          reason = "vp token matched to path is not found";
        } else if (error.type === "UNSUPPORTED_FORMAT") {
          reason = `unsupported format (${pathNested.format}) specified`;
        } else if (error.type === "DECODE_FAILURE") {
          reason = `decode credential was failed`;
        } else if (error.type === "VALIDATE_FAILURE") {
          reason = `validate credential was failed`;
        }
        return { ok: false, error: { type: "INVALID_SUBMISSION", reason } };
      }
    } else {
      const { raw } = presentation.vp;
      const extractResult = await extractCredential<T, U>(raw, format, opts);
      if (extractResult.ok) {
        const { payload } = extractResult;
        // return { raw: presentation.vp.raw, ...payload };
        return { ok: true, payload: { decoded: payload, raw } };
      } else {
        // return toError("CREDENTIAL_NOT_SUBMITTED");
        throw Error("CREDENTIAL_NOT_SUBMITTED");
      }
    }
  };

  const setAuthResponse = (authResponse: AuthResponsePayload) => {
    state.authResponse = authResponse;
  };
  const getAuthResponse = () => {
    return state.authResponse;
  };

  return {
    startRequest,
    getRequest,
    consumeRequest,
    setAuthResponse,
    getAuthResponse,
    generatePresentationDefinition,
    getPresentationDefinition,
    getPresentationDefinitionMap,
    getCredential,
    getDescriptor,
    getOptionalDescriptor,
    getPresentation,
  };
};
