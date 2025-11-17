import Router from "koa-router";
import { koaBody } from "koa-body";

import {
  NotSuccessResult,
  VerifierNodeAppContext,
} from "../types/app-types.js";
import {
  CommitData,
  initOID4VPInteractor,
  KeyValueType,
} from "../usecases/oid4vp-interactor.js";
import claimInteractor from "../usecases/claim-interactor.js";
import {
  authRequestPresenter,
  authResponsePresenter,
  confirmCommentPresenter,
  exchangeResponseCodePresenter,
  postStatePresenter,
} from "./presenters.js";
import { WaitCommitData } from "../usecases/types.js";
import {
  handleError,
  missingBody,
  missingBody2,
  missingHeader,
  toErrorBody,
} from "./error-handler.js";
import { initVerifier, initResponseEndpoint } from "../oid4vp/index.js";
import {
  initResponseEndpointDatastore,
  initVerifierDatastore,
  initPostStateRepository,
  initSessionRepository,
} from "../usecases/oid4vp-repository.js";
import { Result } from "../tool-box/index.js";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export const apiDomain = "oid4vp";

type Ret = {
  authRequest: string;
  requestId: string;
  transactionId?: string;
};

export const routes = async (appContext: VerifierNodeAppContext) => {
  const router = new Router();

  const { openedKeyValues } = appContext;

  const stateKeyValue = openedKeyValues.keyValues[KeyValueType.states.name];
  const stateRepository = initPostStateRepository(stateKeyValue);

  const sessionKeyValue = openedKeyValues.keyValues[KeyValueType.sessions.name];
  const sessionRepository = initSessionRepository(sessionKeyValue);

  const verifierDatastore = initVerifierDatastore(openedKeyValues);
  const verifier = initVerifier(verifierDatastore);

  const responseEndpointDatastore =
    initResponseEndpointDatastore(openedKeyValues);
  const responseEndpoint = initResponseEndpoint(responseEndpointDatastore);

  const interactor = initOID4VPInteractor(
    verifier,
    responseEndpoint,
    stateRepository,
    sessionRepository,
  );

  const responseEndpointPath = new URL(
    process.env.OID4VP_RESPONSE_URI || "INVALID_OID4VP_REQUEST_HOST",
  ).pathname;
  console.info("responseEndpointPath: ", responseEndpointPath);

  router.post(`/${apiDomain}/auth-request`, koaBody(), async (ctx) => {
    if (!ctx.request.body) {
      missingBody2(ctx);
      return;
    }
    const payload = ctx.request.body;
    const { type } = payload;
    let result: Result<Ret, NotSuccessResult>;
    let requestHost: string;
    if (!type || type === "post_comment") {
      requestHost = process.env.OID4VP_REQUEST_HOST || "INVALID_REQUEST_HOST";
      result = await interactor.generateAuthRequest<Ret>(
        payload,
        authRequestPresenter,
      );
    } else {
      requestHost = process.env.SIOP_V2_REQUEST_HOST || "INVALID_REQUEST_HOST";
      result = await interactor.generateAuthRequest4Delete<Ret>(
        payload,
        authRequestPresenter,
      );
    }
    if (result.ok) {
      const { authRequest, requestId, transactionId } = result.payload;
      ctx.status = 200;
      ctx.session!.request_id = requestId;
      if (transactionId) {
        ctx.session!.transaction_id = transactionId;
      }
      ctx.body = { value: `${requestHost}?${authRequest}` };
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  router.get(`/${apiDomain}/request`, koaBody(), async (ctx) => {
    const query = ctx.query;
    const type = query.type;
    const id = query.id;
    if (!id || typeof id !== "string") {
      ctx.status = 400;
      ctx.body = toErrorBody("BAD_REQUEST");
    } else {
      if (type === "post_comment") {
        const pdId = query.presentationDefinitionId;
        if (!pdId || typeof pdId !== "string") {
          ctx.status = 400;
          ctx.body = toErrorBody("BAD_REQUEST");
        } else {
          const result = await interactor.getRequestObject(id, pdId);
          if (result.ok) {
            ctx.status = 200;
            ctx.body = result.payload;
          } else {
            const { statusCode, body } = handleError(result.error);
            ctx.status = statusCode;
            ctx.body = body;
          }
        }
      } else {
        const result = await interactor.getRequestObject4Delete(id);
        if (result.ok) {
          ctx.status = 200;
          ctx.body = result.payload;
        } else {
          const { statusCode, body } = handleError(result.error);
          ctx.status = statusCode;
          ctx.body = body;
        }
      }
    }
  });
  router.get(
    `/${apiDomain}/presentation-definition`,
    koaBody(),
    async (ctx) => {
      const query = ctx.query;
      const id = typeof query.id === "string" ? String(query.id) : "";
      if (id) {
        const pd = await interactor.getPresentationDefinition(id);
        if (pd) {
          ctx.status = 200;
          ctx.body = pd;
        } else {
          ctx.status = 404;
          ctx.body = toErrorBody("NOT_FOUND");
        }
      } else {
        ctx.status = 404;
        ctx.body = toErrorBody("NOT_FOUND");
      }
    },
  );
  router.post(
    responseEndpointPath,
    koaBody({
      formLimit: process.env.OID4VP_VERIFIER_AUTH_RESPONSE_LIMIT || "1mb",
    }),
    async (ctx) => {
      if (!ctx.request.body) {
        const { statusCode, body } = missingBody();
        ctx.status = statusCode;
        ctx.body = body;
        return;
      }
      const payload = ctx.request.body;
      logger.info(
        `authResponse receive from wallet : ${JSON.stringify(payload)}`,
      );
      const result = await interactor.receiveAuthResponse(
        payload,
        authResponsePresenter,
      );
      if (result.ok) {
        ctx.status = 200;
        ctx.body = result.payload;
      } else {
        const { statusCode, body } = handleError(result.error);
        ctx.status = statusCode;
        ctx.body = body;
      }
    },
  );
  router.post(
    `/${apiDomain}/response-code/exchange`,
    koaBody(),
    async (ctx) => {
      const query = ctx.query;
      const type =
        typeof query.type === "string" ? String(query.type) : undefined;
      const responseCode =
        typeof query.response_code === "string"
          ? String(query.response_code)
          : undefined;
      if (!responseCode) {
        const { statusCode, body } = handleError({
          type: "INVALID_PARAMETER",
          message: "response_code should be specified.",
        });
        ctx.status = statusCode;
        ctx.body = body;
      } else {
        const transactionId = ctx.session!.transactionId;
        if (!type || type === "post_comment") {
          const result = await interactor.exchangeAuthResponse(
            responseCode,
            transactionId,
            exchangeResponseCodePresenter,
          );
          if (result.ok) {
            const { requestId, claim } = result.payload;
            ctx.status = 200;
            ctx.body = claim;
            ctx.session!.request_id = requestId;
          } else {
            const { statusCode, body } = handleError(result.error);
            ctx.status = statusCode;
            ctx.body = body;
          }
        } else {
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode,
            transactionId,
          );
          if (result.ok) {
            ctx.status = 204;
          } else {
            const { statusCode, body } = handleError(result.error);
            ctx.status = statusCode;
            ctx.body = body;
          }
        }
        logger.info(
          `response-code/exchange response : code=${ctx.status} body=${JSON.stringify(ctx.body)}`,
        );
      }
    },
  );
  router.post(`/${apiDomain}/comment/confirm`, koaBody(), async (ctx) => {
    const requestId = ctx.session?.request_id ?? undefined;
    const result = await interactor.confirmComment<{ id: string }>(
      requestId,
      confirmCommentPresenter,
    );
    if (result.ok) {
      ctx.session = null; // https://github.com/koajs/session?tab=readme-ov-file#destroying-a-session
      ctx.status = 200;
      ctx.body = result.payload;
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  router.post(`/${apiDomain}/comment/cancel`, koaBody(), async (ctx) => {
    const requestId = ctx.session?.request_id ?? undefined;
    const result = await interactor.cancelComment(requestId);
    if (result.ok) {
      ctx.status = 204;
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  router.get(`/${apiDomain}/comment/states`, koaBody(), async (ctx) => {
    const requestId = ctx.session?.request_id ?? undefined;
    if (!requestId) {
      const { statusCode, body } = missingHeader();
      ctx.status = statusCode;
      ctx.body = body;
      return;
    }
    const state = await interactor.getStates(requestId, postStatePresenter);
    if (state) {
      // PR https://github.com/datasign-inc/mic2024-backend/pull/72 の修正では不足であったため、
      // 追加で以下修正をするものです. 正常に投稿等が完了した場合は、セッションを無効化します。
      // こうすることで、コメントを連投する場合など次回移行の操作のstateが新たになるようにします。
      if (state.value === "committed") {
        ctx.session = null;
      }
      //
      ctx.status = 200;
      ctx.body = state;
    } else {
      ctx.status = 404;
    }
  });
  return router;
};

export default { routes };
