import Router from "koa-router";
import { koaBody } from "koa-body";

import { NotSuccessResult, AppContext } from "../types/app-types.js";
import { initOID4VPInteractor } from "../usecases/oid4vp-interactor.js";
import {
  authRequestPresenter,
  authResponsePresenter,
  exchangeResponseCodePresenter,
  postStatePresenter,
} from "./presenters.js";
import {
  handleError,
  missingBody,
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
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export const apiDomain = "oid4vp";

type Ret = {
  authRequest: string;
  requestId: string;
  transactionId?: string;
};

export const routes = async (appContext: AppContext) => {
  const router = new Router();

  const { db } = appContext;

  // SQLiteベースのリポジトリ初期化
  const stateRepository = initPostStateRepository(db);
  const sessionRepository = initSessionRepository(db);

  const verifierDatastore = initVerifierDatastore(db);
  const verifier = initVerifier(verifierDatastore);

  const responseEndpointDatastore = initResponseEndpointDatastore(db);
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
    const requestHost = process.env.OID4VP_REQUEST_HOST || "INVALID_REQUEST_HOST";
    const result = await interactor.generateAuthRequest<Ret>(
      authRequestPresenter,
    );
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
    const id = query.id;

    if (!id || typeof id !== "string") {
      ctx.status = 400;
      ctx.body = toErrorBody("BAD_REQUEST");
      return;
    }

    // presentationDefinitionId is deprecated (PEX removed, using DCQL now)
    // Pass empty string for backward compatibility
    const result = await interactor.getRequestObject(id, "");
    if (result.ok) {
      ctx.status = 200;
      ctx.body = result.payload;
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  // Removed: GET /presentation-definition endpoint (PEX deprecated, replaced by DCQL)
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
        return;
      }

      const transactionId = ctx.session!.transactionId;
      const result = await interactor.exchangeAuthResponse(
        responseCode,
        transactionId,
        exchangeResponseCodePresenter,
      );

      if (result.ok) {
        const { requestId, claimer } = result.payload;
        ctx.status = 200;
        ctx.body = claimer;
        ctx.session!.request_id = requestId;
      } else {
        const { statusCode, body } = handleError(result.error);
        ctx.status = statusCode;
        ctx.body = body;
      }

      logger.info(
        `response-code/exchange response : code=${ctx.status} body=${JSON.stringify(ctx.body)}`,
      );
    },
  );
  router.get(`/${apiDomain}/states`, koaBody(), async (ctx) => {
    const requestId = ctx.session?.request_id ?? undefined;
    if (!requestId) {
      const { statusCode, body } = missingHeader();
      ctx.status = statusCode;
      ctx.body = body;
      return;
    }
    const state = await interactor.getStates(requestId, postStatePresenter);
    if (state) {
      ctx.status = 200;
      // requestIdをレスポンスに含める（セッションが失われた場合のフォールバック用）
      ctx.body = { ...state, requestId };
    } else {
      ctx.status = 404;
    }
  });
  router.get(`/${apiDomain}/credential-data`, koaBody(), async (ctx) => {
    const requestId = ctx.session?.request_id ?? undefined;
    if (!requestId) {
      const { statusCode, body } = missingHeader();
      ctx.status = statusCode;
      ctx.body = body;
      return;
    }
    const result = await interactor.getCredentialData(requestId);
    if (result.ok) {
      ctx.status = 200;
      ctx.body = result.payload;
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  return router;
};

export default { routes };
