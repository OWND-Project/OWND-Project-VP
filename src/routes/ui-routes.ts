import Router from "koa-router";
import { koaBody } from "koa-body";
import QRCode from "qrcode";

import { AppContext } from "../types/app-types.js";
import { initOID4VPInteractor } from "../usecases/oid4vp-interactor.js";
import { initVerifier, initResponseEndpoint } from "../oid4vp/index.js";
import {
  initResponseEndpointDatastore,
  initVerifierDatastore,
  initPostStateRepository,
  initSessionRepository,
} from "../usecases/oid4vp-repository.js";
import {
  authRequestPresenter,
  postStatePresenter,
} from "./presenters.js";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export const routes = async (appContext: AppContext) => {
  const router = new Router();
  const { db } = appContext;

  // Initialize repositories
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

  // Home page - クレーム選択画面
  router.get("/", async (ctx) => {
    await ctx.render("home");
  });

  // リクエスト送信処理
  router.post("/submit-request", koaBody(), async (ctx) => {
    const requestHost = process.env.OID4VP_REQUEST_HOST || "http://localhost:3000";

    // Get selected claims from form data
    const formData = ctx.request.body || {};
    logger.info(`Form data received: ${JSON.stringify(formData)}`);

    const selectedClaims: string[] = [];

    // Required claims (always included)
    const requiredClaims = [
      "issuing_authority",
      "issuing_country",
      "date_of_issuance",
      "achievement_title",
    ];

    // Add required claims
    selectedClaims.push(...requiredClaims);

    // Add selected optional claims
    // Form sends optional_claims as an array or single value
    const optionalClaimsFromForm = formData.optional_claims;
    if (optionalClaimsFromForm) {
      if (Array.isArray(optionalClaimsFromForm)) {
        selectedClaims.push(...optionalClaimsFromForm);
      } else {
        selectedClaims.push(optionalClaimsFromForm);
      }
    }

    logger.info(`Selected claims: ${JSON.stringify(selectedClaims)}`);

    // Build DCQL credential queries
    const dcqlCredentialQueries = [
      {
        id: "learning_credential",
        format: "dc+sd-jwt",
        meta: {
          vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"],
        },
        claims: selectedClaims.map(claim => ({ path: [claim] })),
      },
    ];

    // Generate authorization request with selected claims
    const result = await interactor.generateAuthRequest(authRequestPresenter, dcqlCredentialQueries);

    if (result.ok) {
      const { authRequest, requestId, transactionId } = result.payload;

      // Save request_id to session
      ctx.session!.request_id = requestId;
      if (transactionId) {
        ctx.session!.transaction_id = transactionId;
      }

      // Build full authorization request URL
      const authRequestUrl = `${requestHost}?${authRequest}`;

      // Redirect to authorization request display page
      ctx.redirect(`/auth-request?url=${encodeURIComponent(authRequestUrl)}`);
    } else {
      ctx.redirect(`/error?type=${result.error.type}`);
    }
  });

  // Authorization Request表示画面
  router.get("/auth-request", async (ctx) => {
    const authRequestUrl = ctx.query.url as string;

    if (!authRequestUrl) {
      ctx.redirect("/error?type=INVALID_PARAMETER");
      return;
    }

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(authRequestUrl, {
      width: 300,
      margin: 2,
    });

    await ctx.render("auth-request", {
      authRequestUrl,
      qrCodeDataUrl,
    });
  });

  // クレデンシャル情報表示画面
  router.get("/credential-info", async (ctx) => {
    const requestId = ctx.session?.request_id;

    if (!requestId) {
      ctx.redirect("/error?type=MISSING_SESSION");
      return;
    }

    const result = await interactor.getCredentialData(requestId);

    if (result.ok) {
      const { idToken, learningCredentialJwt } = result.payload;

      // Parse Learning Credential JWT (simplified - just display raw data)
      await ctx.render("credential-info", {
        idToken,
        learningCredentialJwt,
      });
    } else {
      ctx.redirect(`/error?type=${result.error.type}`);
    }
  });

  // エラー画面
  router.get("/error", async (ctx) => {
    const errorType = ctx.query.type as string || "UNKNOWN";

    const errorMessages: Record<string, string> = {
      "expired": "The request has expired. Please try again.",
      "invalid_submission": "Invalid credential submission.",
      "NOT_FOUND": "Session not found.",
      "EXPIRED": "Session has expired.",
      "MISSING_SESSION": "No active session found.",
      "INVALID_PARAMETER": "Invalid parameters provided.",
      "UNKNOWN": "An unexpected error occurred.",
    };

    const errorMessage = errorMessages[errorType] || errorMessages["UNKNOWN"];

    await ctx.render("error", {
      errorType,
      errorMessage,
    });
  });

  return router;
};

export default { routes };
