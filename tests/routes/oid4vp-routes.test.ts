import { assert } from "chai";
import Koa from "koa";
import request from "supertest";

import { clearDir, createKeyPair, generatePaths } from "../test-utils.js";
import { apiDomain } from "../../src/routes/oid4vp-routes.js";

import { init } from "../../src/api.js";
import { faker } from "@faker-js/faker";
import { snakeToCamel } from "../../src/oid4vp/auth-request.js";
import {
  ClientMetadata,
  PresentationDefinition,
  VC_FORMAT_VC_SD_JWT,
} from "../../src/oid4vp/types.js";
import { KeyValueType } from "../../src/usecases/oid4vp-interactor.js";
import { initMockAgent } from "../helpers/mock-request.js";
import { TAG_PREFIX } from "../../src/routes/error-handler.js";
import { OpenedKeyValue, setupNode } from "../../src/orbit-db/index.js";
import { getLibp2pOptions } from "../../src/helpers/libp2p-helper.js";
import {
  initPostFixtures,
  PostFixtures,
  testAuthResponsePayload4SIOPv2,
} from "../fixtures/index.js";
import { generateCert } from "../oid4vp/test-utils.js";
import {
  CERT_PEM_POSTAMBLE,
  CERT_PEM_PREAMBLE,
} from "../../src/tool-box/x509/constant.js";
import { verifyJwt } from "../../src/tool-box/verify.js";

describe("oid4vp/routes", () => {
  let app: Koa | undefined;
  let stopApp: () => Promise<void>;

  let presentationDefinitionsKeyValue: OpenedKeyValue;
  let postFixtures: PostFixtures;

  const clientId = faker.internet.url({ appendSlash: false });
  const clientName = faker.string.alpha();
  const requestHost = "oid4vp://localhost/request";
  const siopV2RequestHost = "siopv2://localhost/request";
  const requestUri = `${clientId}/request`;
  const responseUri = `${clientId}/responses`;
  const redirectUri = `${clientId}/redirect`;
  const presentationDefinitionUri = `${clientId}/presentation-definitions`;

  const redirectPath = `/${apiDomain}/response-code/exchange`;
  const mainNodeHost = "https://node.boolcheck.com";
  const apiNodeHost = "https://api.boolcheck.com";
  const frontendHost = "https://boolcheck.com";

  process.env.OID4VP_REQUEST_HOST = requestHost;
  process.env.SIOP_V2_REQUEST_HOST = siopV2RequestHost;
  process.env.OID4VP_CLIENT_ID = clientId;
  process.env.OID4VP_CLIENT_METADATA_NAME = clientName;
  process.env.OID4VP_REQUEST_URI = requestUri;
  process.env.OID4VP_RESPONSE_URI = responseUri;
  process.env.SIOP_V2_REDIRECT_URI = redirectUri;
  process.env.OID4VP_PRESENTATION_DEFINITION_URI = presentationDefinitionUri;
  process.env.OID4VP_COOKIE_SECRET = "this is a secret of cookie signer";
  process.env.MAIN_NODE_HOST = mainNodeHost;
  process.env.API_HOST = apiNodeHost;
  process.env.OID4VP_REDIRECT_URI_RETURNED_BY_RESPONSE_URI = `${frontendHost}/oid4vp/response-code/exchange`;

  beforeEach(async () => {
    await clearDir();

    const paths = generatePaths();
    const opt = getLibp2pOptions();
    const vpNode = await setupNode(opt, {
      ipfsPath: paths.ipfsPath,
      orbitdbPath: paths.orbitdbPath,
      keystorePath: paths.keystorePath,
      identityKey: "oid4vp",
    });

    const openedKeyValues = await vpNode.openKeyValueIndexed([
      KeyValueType.requestsAtResponseEndpoint,
      KeyValueType.requestsAtVerifier,
      KeyValueType.presentationDefinitions,
      KeyValueType.responsesAtResponseEndpoint,
      KeyValueType.sessions,
      KeyValueType.states,
    ]);
    const { app: __app, stopApp: __stopApp } = await init("VERIFIER_NODE", {
      verifierNode: {
        node: vpNode,
        openedKeyValues,
      },
    });
    app = __app;
    stopApp = __stopApp;

    presentationDefinitionsKeyValue =
      openedKeyValues.keyValues[KeyValueType.presentationDefinitions.name];
    postFixtures = initPostFixtures();
  });

  afterEach(async () => {
    if (stopApp) {
      await stopApp();
    }
    await clearDir();
  });

  describe("/auth-request", () => {
    it("should return auth request params", async () => {
      // generate test data
      const url = faker.internet.url();
      const comment = "test comment";
      const boolValue = 1;

      // execute
      const response = await request(app!.callback())
        .post(`/${apiDomain}/auth-request`)
        .send({ url, comment, boolValue });
      const cookiesAtStartRequest = getCookies(response);

      // assert
      const authRequest = response.body;
      assert.equal(response.status, 200);
      assert.isTrue(authRequest.value.startsWith(`${requestHost}?`));

      // parse the URL and extract the query string
      const __url = new URL(authRequest.value);
      const searchParams = new URLSearchParams(__url.search);

      assert.equal(searchParams.get("client_id"), clientId);

      const clientMetadataStr = searchParams.get("client_metadata");
      assert.isNotNull(clientMetadataStr, "client_metadata should exist");

      const clientMetadata: ClientMetadata = snakeToCamel(
        JSON.parse(clientMetadataStr!),
      );
      assert.isString(clientMetadata.clientName, clientName);

      const presentationDefinitionUriParam = searchParams.get(
        "presentation_definition_uri",
      );
      assert.isNotNull(
        presentationDefinitionUriParam,
        "presentation_definition_uri should exist",
      );
      assert.isTrue(
        presentationDefinitionUriParam!.startsWith(
          `${presentationDefinitionUri}?id=`,
        ),
        `presentation_definition_uri should start with ${presentationDefinitionUri}`,
      );

      // check state
      const response2 = await request(app!.callback())
        .get(`/${apiDomain}/comment/states`)
        .set("Cookie", cookiesAtStartRequest);

      // assert
      assert.equal(response2.status, 200);
      const state = response2.body;
      assert.equal(state.value, "started");
    });
    it("should return auth request params(for delete)", async () => {
      // generate test data
      const id = faker.string.uuid();

      // execute
      const response = await request(app!.callback())
        .post(`/${apiDomain}/auth-request`)
        .send({ type: "delete_comment", id });
      const cookiesAtStartRequest = getCookies(response);

      // assert
      const authRequest = response.body;
      assert.equal(response.status, 200);
      assert.isTrue(authRequest.value.startsWith(`${siopV2RequestHost}?`));

      // parse the URL and extract the query string
      const __url = new URL(authRequest.value);
      const searchParams = new URLSearchParams(__url.search);

      assert.equal(searchParams.get("client_id"), clientId);

      const clientMetadataStr = searchParams.get("client_metadata");
      assert.isNotNull(clientMetadataStr, "client_metadata should exist");

      const clientMetadata: ClientMetadata = snakeToCamel(
        JSON.parse(clientMetadataStr!),
      );
      assert.isString(clientMetadata.clientName, clientName);

      // check state
      const response2 = await request(app!.callback())
        .get(`/${apiDomain}/comment/states`)
        .set("Cookie", cookiesAtStartRequest);

      // assert
      assert.equal(response2.status, 200);
      const state = response2.body;
      assert.equal(state.value, "started");
    });
  });

  describe("/request", () => {
    let _requestUri = "";
    const keypair = createKeyPair();
    beforeEach(async () => {
      const subject =
        "/C=JP/ST=Tokyo/L=Chiyoda-ku/O=Example Company/CN=example.jp";
      const cert = await generateCert(subject, keypair);
      const leafKeyX509 = `${CERT_PEM_PREAMBLE}\\n${cert}\\n${CERT_PEM_POSTAMBLE}`;

      process.env.OID4VP_REQUEST_URI = requestUri;
      process.env.OID4VP_CLIENT_ID_SCHEME = "x509_san_dns";
      process.env.OID4VP_VERIFIER_JWK = JSON.stringify(keypair);
      process.env.OID4VP_VERIFIER_X5C = leafKeyX509;
    });
    afterEach(async () => {
      process.env.OID4VP_CLIENT_ID_SCHEME = "redirect_uri";
    });
    describe("post_comment", () => {
      beforeEach(async () => {
        const url = faker.internet.url();
        const comment = "test comment";
        const boolValue = 1;

        const response = await request(app!.callback())
          .post(`/${apiDomain}/auth-request`)
          .send({ url, comment, boolValue });
        const authRequest = response.body;

        // parse the URL and extract the query string
        const __url = new URL(authRequest.value);
        const searchParams = new URLSearchParams(__url.search);
        _requestUri = searchParams.get("request_uri")!;
      });
      it("should return request object", async () => {
        const __url = new URL(_requestUri);
        const response = await request(app!.callback()).get(
          `/${apiDomain}/request${__url.search}`,
        );

        // assert
        assert.equal(response.status, 200);
        const requestObject = response.text;
        const result = await verifyJwt(requestObject, {
          skipVerifyChain: true,
        });

        if (result.ok) {
          const payload = result.payload;
          assert.equal(payload["client_id"], clientId);

          const clientMetadata: ClientMetadata = snakeToCamel(
            payload["client_metadata"],
          );
          assert.equal(clientMetadata.clientName, clientName);

          const presentationDefinition = payload["presentation_definition"];
          assert.isObject(
            presentationDefinition,
            "presentation_definition should exist",
          );
        } else {
          assert.fail("should be verified successfully");
        }
      });
    });
    describe("delete_comment", () => {
      beforeEach(async () => {
        const id = faker.string.uuid();
        const response = await request(app!.callback())
          .post(`/${apiDomain}/auth-request`)
          .send({ type: "delete_comment", id });
        const authRequest = response.body;

        // parse the URL and extract the query string
        const __url = new URL(authRequest.value);
        const searchParams = new URLSearchParams(__url.search);
        _requestUri = searchParams.get("request_uri")!;
      });
      it("should return request object", async () => {
        const __url = new URL(_requestUri);
        const response = await request(app!.callback()).get(
          `/${apiDomain}/request${__url.search}`,
        );

        // assert
        assert.equal(response.status, 200);
        const requestObject = response.text;
        const result = await verifyJwt(requestObject, {
          skipVerifyChain: true,
        });

        if (result.ok) {
          const payload = result.payload;
          assert.equal(payload["client_id"], clientId);

          const clientMetadata: ClientMetadata = snakeToCamel(
            payload["client_metadata"],
          );
          assert.equal(clientMetadata.clientName, clientName);
        } else {
          assert.fail("should be verified successfully");
        }
      });
    });
  });

  describe("/presentation-definitions", () => {
    describe("404 not found", () => {
      it("should return 404(1)", async () => {
        // execute
        const response = await request(app!.callback()).get(
          `/${apiDomain}/presentation-definition`,
        );

        // assert
        assert.equal(response.status, 404);
        const error = response.body;
        assert.equal(error.type, `${TAG_PREFIX}:NotFound`);
      });
      it("should return 404(2)", async () => {
        // execute
        const response = await request(app!.callback()).get(
          `/${apiDomain}/presentation-definition?id=no-such-id`,
        );

        // assert
        assert.equal(response.status, 404);
        const error = response.body;
        assert.equal(error.type, `${TAG_PREFIX}:NotFound`);
      });
    });
    describe("200", () => {
      it("should return presentation definition", async () => {
        // generate test data
        const id = faker.string.uuid();

        // register test data
        const inputDescriptor1Id = faker.string.uuid();
        const inputDescriptor1Name = faker.string.alpha(10);
        const inputDescriptor1Purpose = faker.string.alpha(10);
        const inputDescriptor1Group = ["A"];

        // submissionRequirements のテストデータを生成
        const submissionRequirementName = "Claim";
        const submissionRequirementRule = "pick";
        const submissionRequirementCount = 1;
        const submissionRequirementFrom = "A";

        await presentationDefinitionsKeyValue.db.put<PresentationDefinition>(
          id,
          {
            id,
            inputDescriptors: [
              {
                id: inputDescriptor1Id,
                format: VC_FORMAT_VC_SD_JWT,
                name: inputDescriptor1Name,
                purpose: inputDescriptor1Purpose,
                constraints: {},
                group: inputDescriptor1Group,
              },
            ],
            submissionRequirements: [
              {
                name: submissionRequirementName,
                rule: submissionRequirementRule,
                count: submissionRequirementCount,
                from: submissionRequirementFrom,
              },
            ],
          },
        );

        // execute
        const response = await request(app!.callback()).get(
          `/${apiDomain}/presentation-definition?id=${id}`,
        );

        // assert
        assert.equal(response.status, 200);
        const pd = response.body;
        assert.equal(pd.id, id);
        const inputDescriptor1 = pd.input_descriptors[0];
        assert.equal(inputDescriptor1.id, inputDescriptor1Id);
        assert.equal(inputDescriptor1.format["vc+sd-jwt"].alg, "ES256");
        assert.equal(inputDescriptor1.name, inputDescriptor1Name);
        assert.equal(inputDescriptor1.purpose, inputDescriptor1Purpose);
        assert.deepEqual(inputDescriptor1.group, inputDescriptor1Group);

        const submissionRequirement = pd.submission_requirements[0];
        assert.equal(submissionRequirement.name, submissionRequirementName);
        assert.equal(submissionRequirement.rule, submissionRequirementRule);
        assert.equal(submissionRequirement.count, submissionRequirementCount);
        assert.equal(submissionRequirement.from, submissionRequirementFrom);
      });
    });
  });
  describe("/response-endpoint", () => {
    let state: string | null = null;
    beforeEach(async () => {
      const url = faker.internet.url();
      const comment = "test comment";
      const boolValue = 1;

      const response = await request(app!.callback())
        .post(`/${apiDomain}/auth-request`)
        .send({ url, comment, boolValue });
      const authRequest = response.body;

      // parse the URL and extract the query string
      const __url = new URL(authRequest.value);
      const searchParams = new URLSearchParams(__url.search);

      state = searchParams.get("state");
    });
    describe("400 bad request", () => {
      it("should return 400", async () => {
        const path = new URL(responseUri).pathname;
        // execute
        const response = await request(app!.callback()).post(path).send({
          state,
        });

        // assert
        assert.equal(response.status, 400);
      });
    });
    describe("404 not found", () => {
      it("should return 404", async () => {
        const path = new URL(responseUri).pathname;
        // execute
        const response = await request(app!.callback()).post(path).send({
          state: "no-such-request-id",
          vp_token: "dummy value",
          presentation_submission: "dummy value",
        });

        // assert
        assert.equal(response.status, 404);
      });
    });
    describe("200", () => {
      it("should return 200", async () => {
        const path = new URL(responseUri).pathname;
        // execute
        const response = await request(app!.callback()).post(path).send({
          state,
          vp_token: "dummy value",
          presentation_submission: "dummy value",
          id_token: "dummy value",
        });

        // assert
        assert.equal(response.status, 200);
        const authResponse = response.body;
        const responseCode = authResponse.redirect_uri
          .split("#")[1]
          .split("response_code=")[1];
        assert.isNotEmpty(responseCode);
      });
    });
  });
  describe("/exchange-response-code", () => {
    let requestId: string | undefined;
    let nonce: string | undefined;
    let definitionId: string | undefined;
    let type: string | undefined;
    let responseCode: string | undefined;

    describe("post comment", () => {
      beforeEach(async () => {
        /* ---------------- Start VP Flow ------------------ */
        const url = faker.internet.url();
        const comment = "test comment";
        const boolValue = 1;

        const response1 = await request(app!.callback())
          .post(`/${apiDomain}/auth-request`)
          .send({ url, comment, boolValue });
        const authRequest = response1.body;
        assert.isTrue(authRequest.value.startsWith(`${requestHost}?`));
        const __url = new URL(authRequest.value);
        const searchParams = new URLSearchParams(__url.search);
        nonce = searchParams.get("nonce")!;
        requestId = searchParams.get("state")!;
        definitionId = searchParams
          .get("presentation_definition_uri")!
          .split("id=")[1];

        /* ---------------- Receive Auth Response ------------------ */
        const path = new URL(responseUri).pathname;
        const payload = await postFixtures.response2({
          requestId,
          nonce,
          definitionId,
        });
        const response2 = await request(app!.callback())
          .post(path)
          .send(payload);
        const authResponseResponse = response2.body;
        ({ type, responseCode } = handleResponseUriResponse(
          authResponseResponse.redirect_uri,
        ));
      });
      describe("400", () => {
        it("should return 400", async () => {
          const response = await request(app!.callback()).post(
            `${redirectPath}`,
          );

          // assert
          assert.equal(response.status, 400);
          const error = response.body;
          assert.equal(error.type, `${TAG_PREFIX}:BadRequest`);
        });
      });
      describe("200", () => {
        let mockAgent: ReturnType<typeof initMockAgent>;
        beforeEach(async () => {
          const { response2 } = postFixtures.memo;
          // const url = apiNodeHost;
          // const path =
          //   "/database/urls?filter=" + encodeURIComponent(response2.url);
          // mockAgent = mockGetAccess(url, path, [{ url: response2.url }]);
          mockAgent = initMockAgent();
          mockAgent.getAccess(
            apiNodeHost,
            "/database/urls",
            [{ url: response2.url }],
            {
              query: { filter: response2.url },
            },
          );
        });
        afterEach(async () => {
          await mockAgent.close();
        });
        it("should return 200", async () => {
          const response = await request(app!.callback()).post(
            `${redirectPath}?type=${type}&response_code=${responseCode}`,
          );

          // assert
          assert.equal(response.status, 200);
          const claim = response.body;
          const { response2 } = postFixtures.memo;
          assert.equal(claim.comment, response2.comment);
          assert.equal(claim.url.url, response2.url);
          assert.equal(claim.claimer.id_token, response2.claim.idToken);
          assert.equal(claim.claimer.icon, response2.claim.icon);
          assert.equal(
            claim.claimer.organization,
            response2.claim.organization,
          );
          const authResponse = response.body;
          // @ts-ignore
          const cookies = response.headers["set-cookie"].filter((cookie) =>
            cookie.startsWith("koa.sess"),
          );
          assert.equal(cookies.length, 2);
        });
      });
    });

    describe("delete comment", () => {
      let mockAgent: ReturnType<typeof initMockAgent>;
      beforeEach(async () => {
        /* ---------------- Start VP Flow ------------------ */
        const id = faker.string.uuid();
        const __path = `/database/claims/${id}`;

        const response1 = await request(app!.callback())
          .post(`/${apiDomain}/auth-request`)
          .send({ type: "delete_comment", id });
        const authRequest = response1.body;
        assert.isTrue(authRequest.value.startsWith(`${siopV2RequestHost}?`));
        const __url = new URL(authRequest.value);
        const searchParams = new URLSearchParams(__url.search);
        nonce = searchParams.get("nonce")!;
        requestId = searchParams.get("state")!;

        /* ---------------- Receive Auth Response ------------------ */
        const path = new URL(responseUri).pathname;
        const payload = await testAuthResponsePayload4SIOPv2(requestId, nonce);
        const response2 = await request(app!.callback())
          .post(path)
          .send(payload);
        const authResponseResponse = response2.body;
        ({ type, responseCode } = handleResponseUriResponse(
          authResponseResponse.redirect_uri,
        ));

        /* ---------------- Mock up url access ------------------ */
        mockAgent = initMockAgent();
        mockAgent.deleteAccess(mainNodeHost, __path);
      });
      afterEach(async () => {
        if (mockAgent) {
          await mockAgent.close();
        }
      });
      describe("400", () => {
        it("should return 400", async () => {
          const response = await request(app!.callback()).post(
            `${redirectPath}`,
          );

          // assert
          assert.equal(response.status, 400);
          const error = response.body;
          assert.equal(error.type, `${TAG_PREFIX}:BadRequest`);
        });
      });
      describe("204", () => {
        it("should return 200", async () => {
          const response = await request(app!.callback()).post(
            `${redirectPath}?type=${type}&response_code=${responseCode}`,
          );

          // assert
          assert.equal(response.status, 204);
        });
      });
    });
  });
  describe("/confirm-comment", () => {
    const newClaimId = faker.string.uuid();
    let requestId: string | undefined;
    let nonce: string | undefined;
    let definitionId: string | undefined;
    let type: string | undefined;
    let responseCode: string | undefined;
    let cookiesAtStartRequest: any;
    let cookies: any;
    let mockAgent: ReturnType<typeof initMockAgent>;

    beforeEach(async () => {
      /* ---------------- Start VP Flow ------------------ */
      const url = faker.internet.url();
      const comment = "test comment";
      const boolValue = 1;

      const response1 = await request(app!.callback())
        .post(`/${apiDomain}/auth-request`)
        .send({ url, comment, boolValue });
      const authRequest = response1.body;
      assert.isTrue(authRequest.value.startsWith(`${requestHost}?`));
      const __url = new URL(authRequest.value);
      const searchParams = new URLSearchParams(__url.search);
      nonce = searchParams.get("nonce")!;
      requestId = searchParams.get("state")!;
      definitionId = searchParams
        .get("presentation_definition_uri")!
        .split("id=")[1];
      cookiesAtStartRequest = getCookies(response1);

      /* ---------------- Receive Auth Response ------------------ */
      const path = new URL(responseUri).pathname;
      const payload = await postFixtures.response1({
        requestId,
        nonce,
        definitionId,
      });
      const response2 = await request(app!.callback()).post(path).send(payload);
      const authResponseResponse = response2.body;
      ({ type, responseCode } = handleResponseUriResponse(
        authResponseResponse.redirect_uri,
      ));

      mockAgent = initMockAgent();
      /* ---------------- Exchange Response Code ------------------ */
      const { memo } = postFixtures;
      mockAgent.getAccess(
        apiNodeHost,
        "/database/urls",
        [{ url: memo.response1.url }],
        {
          query: { filter: memo.response1.url },
        },
      );
      const response3 = await request(app!.callback()).post(
        `${redirectPath}?type=${type}&response_code=${responseCode}`,
      );
      cookies = getCookies(response3);

      /* ---------------- Other ------------------ */
      process.env.NEW_CLAIM_ENDPOINT_HOST = mainNodeHost;
      mockAgent.postAccess(mainNodeHost, "/database/claims", {
        id: newClaimId,
      });
    });
    describe("400", () => {
      it("should return 400(invalid header)", async () => {
        const response = await request(app!.callback()).post(
          `/${apiDomain}/comment/confirm`,
        );

        // assert
        assert.equal(response.status, 400);
        const error = response.body;
        assert.equal(error.type, `${TAG_PREFIX}:InvalidHeader`);
        assert.isNotEmpty(error.title);
      });
    });
    describe("200", () => {
      it("should return 200", async () => {
        const response = await request(app!.callback())
          .post(`/${apiDomain}/comment/confirm`)
          .set("Cookie", cookies);

        // assert
        assert.equal(response.status, 200);
        const confirmed = response.body;
        assert.equal(confirmed.id, newClaimId);

        // check state
        const response2 = await request(app!.callback())
          .get(`/${apiDomain}/comment/states`)
          .set("Cookie", cookiesAtStartRequest);

        // assert
        assert.equal(response2.status, 200);
        const state = response2.body;
        assert.equal(state.value, "committed");
      });
    });
  });
  describe("/cancel-comment", () => {
    let requestId: string | undefined;
    let nonce: string | undefined;
    let definitionId: string | undefined;
    let cookiesAtStartRequest: any;
    let type: string | undefined;
    let responseCode: string | undefined;
    let cookies: any;
    let mockAgent: ReturnType<typeof initMockAgent>;
    beforeEach(async () => {
      /* ---------------- Start VP Flow ------------------ */
      const url = faker.internet.url();
      const comment = "test comment";
      const boolValue = 1;

      const response1 = await request(app!.callback())
        .post(`/${apiDomain}/auth-request`)
        .send({ url, comment, boolValue });
      const authRequest = response1.body;
      assert.isTrue(authRequest.value.startsWith(`${requestHost}?`));
      const __url = new URL(authRequest.value);
      const searchParams = new URLSearchParams(__url.search);
      nonce = searchParams.get("nonce")!;
      requestId = searchParams.get("state")!;
      definitionId = searchParams
        .get("presentation_definition_uri")!
        .split("id=")[1];
      cookiesAtStartRequest = getCookies(response1);

      /* ---------------- Receive Auth Response ------------------ */
      const path = new URL(responseUri).pathname;
      const payload = await postFixtures.response1({
        requestId,
        nonce,
        definitionId,
      });
      const response2 = await request(app!.callback()).post(path).send(payload);
      const authResponseResponse = response2.body;
      ({ type, responseCode } = handleResponseUriResponse(
        authResponseResponse.redirect_uri,
      ));

      mockAgent = initMockAgent();
      /* ---------------- Exchange Response Code ------------------ */
      const { memo } = postFixtures;
      mockAgent.getAccess(
        apiNodeHost,
        "/database/urls",
        [{ url: memo.response1.url }],
        {
          query: { filter: memo.response1.url },
        },
      );
      const response3 = await request(app!.callback()).post(
        `${redirectPath}?type=${type}&response_code=${responseCode}`,
      );
      cookies = getCookies(response3);

      /* ---------------- Mock up url accessed at put function ------------------ */
      // mockAgent = mockOgpAccess(postFixtures.memo.response1.url);
    });
    afterEach(async () => {
      // mockAgent.close();
    });
    describe("400", () => {
      it("should return 400(invalid header)", async () => {
        const response = await request(app!.callback())
          .post(`/${apiDomain}/comment/cancel`)
          .send({});

        // assert
        assert.equal(response.status, 400);
        const error = response.body;
        assert.equal(error.type, `${TAG_PREFIX}:InvalidHeader`);
        assert.isNotEmpty(error.title);
      });
    });
    describe("204", () => {
      it("should return 204", async () => {
        const response = await request(app!.callback())
          .post(`/${apiDomain}/comment/cancel`)
          .set("Cookie", cookies)
          .send({});

        // assert
        assert.equal(response.status, 204);
        const authResponse = response.body;

        // check state
        const response2 = await request(app!.callback())
          .get(`/${apiDomain}/comment/states`)
          .set("Cookie", cookiesAtStartRequest);

        // assert
        assert.equal(response2.status, 200);
        const state = response2.body;
        assert.equal(state.value, "canceled");
      });
    });
  });
});

const getCookies = (response: any) => {
  // @ts-ignore
  return response.headers["set-cookie"].filter((cookie) =>
    cookie.startsWith("koa.sess"),
  );
};

const handleResponseUriResponse = (frontUrl: string) => {
  // https://boolcheck.com/oid4vp/response-code/exchange?type=post_comment#response_code=8649d466-88cf-420c-8eb0-fd3675fc84f3
  const __url = new URL(frontUrl);
  const type = __url.searchParams.get("type")!;
  const responseCode = __url.hash.split("response_code=")[1];
  return { type, responseCode };
};
