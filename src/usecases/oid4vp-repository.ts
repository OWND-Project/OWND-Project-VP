import { v4 as uuidv4 } from "uuid";
import {
  PostState,
  PostStateValue,
  RequestId,
  WaitCommitData,
  EntityWithLifeCycle,
} from "./types.js";
import { getCurrentUnixTimeInSeconds, isExpired } from "../utils/data-util.js";
import {
  EntityWithLifeCycleOption,
  KeyValueType,
  PostStateOption,
} from "./oid4vp-interactor.js";
import { Result } from "../tool-box/index.js";
import {
  AuthResponse,
  ResponseEndpointDatastore,
  VpRequest,
  PresentationDefinition,
  VerifierDatastore,
  VpRequestAtVerifier,
} from "../oid4vp/index.js";
import { KeyValues, OpenedKeyValue } from "../orbit-db/index.js";

export const initResponseEndpointDatastore = (openedKeyValues: KeyValues) => {
  const requestsAtResponseEndpointKeyValue =
    openedKeyValues.keyValues[KeyValueType.requestsAtResponseEndpoint.name];
  const responseAtResponseEndpointKeyValue =
    openedKeyValues.keyValues[KeyValueType.responsesAtResponseEndpoint.name];
  // implement datastore
  const responseEndpointDatastore: ResponseEndpointDatastore = {
    saveRequest: async (request: VpRequest) => {
      await requestsAtResponseEndpointKeyValue.db.put<VpRequest>(
        request.id,
        request,
      );
    },
    getRequest: async (requestId: string) => {
      return await requestsAtResponseEndpointKeyValue.db.get<VpRequest>(
        requestId,
      );
    },
    saveResponse: async (response: AuthResponse) => {
      await responseAtResponseEndpointKeyValue.db.put<AuthResponse>(
        response.id,
        response,
      );
    },
    getResponse: async (responseCode: string) => {
      return await responseAtResponseEndpointKeyValue.db.get<AuthResponse>(
        responseCode,
      );
    },
  };
  return responseEndpointDatastore;
};

export const initVerifierDatastore = (openedKeyValues: KeyValues) => {
  const requestsAtVerifierKeyValue =
    openedKeyValues.keyValues[KeyValueType.requestsAtVerifier.name];
  const presentationDefinitionsKeyValue =
    openedKeyValues.keyValues[KeyValueType.presentationDefinitions.name];
  // implement datastore
  const verifierDatastore: VerifierDatastore = {
    saveRequest: async (request: VpRequestAtVerifier) => {
      await requestsAtVerifierKeyValue.db.put<VpRequestAtVerifier>(
        request.id,
        request,
      );
    },
    getRequest: async (requestId: string) => {
      return await requestsAtVerifierKeyValue.db.get<VpRequestAtVerifier>(
        requestId,
      );
    },
    savePresentationDefinition: async (
      presentationDefinition: PresentationDefinition,
    ) => {
      await presentationDefinitionsKeyValue.db.put<PresentationDefinition>(
        presentationDefinition.id,
        presentationDefinition,
      );
    },
    getPresentationDefinition: async (presentationDefinitionId: string) => {
      return await presentationDefinitionsKeyValue.db.get<PresentationDefinition>(
        presentationDefinitionId,
      );
    },
  };
  return verifierDatastore;
};

export type SessionRepository = ReturnType<typeof initSessionRepository>;
export const initSessionRepository = (keyValue: OpenedKeyValue) => {
  const putRequestId = async (
    requestId: string,
    opts?: EntityWithLifeCycleOption,
  ) => {
    const session = {
      id: uuidv4(),
      data: { requestId },
      issuedAt: opts?.issuedAt ?? getCurrentUnixTimeInSeconds(),
      expiredIn: opts?.expiredIn ?? 600,
    };
    await keyValue.db.put<RequestId>(session.id, session);
    return session;
  };
  const putWaitCommitData = async (
    requestId: string,
    idToken: string,
    claimJwt: string,
    affiliationJwt?: string,
    opts?: EntityWithLifeCycleOption,
  ) => {
    const session: WaitCommitData = {
      id: requestId,
      data: {
        idToken,
        claimJwt,
      },
      issuedAt: opts?.issuedAt ?? getCurrentUnixTimeInSeconds(),
      expiredIn: opts?.expiredIn ?? 600,
    };
    if (affiliationJwt) {
      session.data.affiliationJwt = affiliationJwt;
    }
    await keyValue.db.put<WaitCommitData>(session.id, session);
    return session;
  };

  const getSession = async <T extends EntityWithLifeCycle>(
    sessionId: string,
  ): Promise<Result<T, { type: "NOT_FOUND" | "EXPIRED" }>> => {
    const session = await keyValue.db.get<T>(sessionId);
    if (!session) {
      return { ok: false, error: { type: "NOT_FOUND" } };
    } else {
      if (isExpired(session.issuedAt, session.expiredIn)) {
        return { ok: false, error: { type: "EXPIRED" } };
      }
      return { ok: true, payload: session };
    }
  };
  return {
    putRequestId,
    putWaitCommitData,
    getSession,
  };
};

export type PostStateRepository = ReturnType<typeof initPostStateRepository>;
export const initPostStateRepository = (keyValue: OpenedKeyValue) => {
  const putState = async (
    requestId: string,
    value: PostStateValue,
    opts?: PostStateOption,
  ) => {
    let issuedAt = opts?.issuedAt ?? getCurrentUnixTimeInSeconds();
    let expiredIn = opts?.expiredIn ?? 600;
    // get origin values(expiredIn, issuedAt)
    const prevState = await keyValue.db.get<PostState>(requestId);
    if (prevState) {
      issuedAt = prevState.issuedAt;
      expiredIn = prevState.expiredIn;
    }
    const state: PostState = { id: requestId, value, issuedAt, expiredIn };
    if (opts?.targetId) {
      state.targetId = opts?.targetId;
    }
    await keyValue.db.put(requestId, state);
    return state;
  };

  const getState = async (requestId: string) => {
    const state = await keyValue.db.get<PostState>(requestId);
    if (state) {
      const { issuedAt, expiredIn, targetId } = state;
      if (isExpired(issuedAt, expiredIn)) {
        return await putState(requestId, "expired", {
          issuedAt,
          expiredIn,
          targetId,
        });
      }
    }
    return state;
  };
  return {
    putState,
    getState,
  };
};
