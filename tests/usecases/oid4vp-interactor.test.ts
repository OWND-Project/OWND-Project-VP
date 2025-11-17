import { assert } from "chai";
import { faker } from "@faker-js/faker";

import {
  initOID4VPInteractor,
  KeyValueType,
  OID4VPInteractor,
} from "../../src/usecases/oid4vp-interactor.js";
import {
  AuthorizationRequest,
  Verifier,
  ResponseEndpoint,
  InputDescriptor,
  initVerifier,
  initResponseEndpoint,
  getKeyAlgorithm,
} from "../../src/oid4vp/index.js";
import {
  clearDir,
  createIdToken,
  createKeyPair,
  extractPublicKeyFromX5c,
  generateTemporaryPath,
} from "../test-utils.js";
import { initOrbitdb4Verifier } from "../../src/api.js";
import {
  initResponseEndpointDatastore,
  initVerifierDatastore,
  initPostStateRepository,
  initSessionRepository,
  PostStateRepository,
} from "../../src/usecases/oid4vp-repository.js";
import {
  AuthRequestPresenter,
  AuthResponsePresenter,
  ExchangeResponseCodePresenter,
  WaitCommitData,
} from "../../src/usecases/types.js";
import {
  DeleteFixture,
  PostFixtureHandler,
  initDeleteFixture,
  initPostFixtureHandler,
} from "../fixtures/index.js";
import {
  INPUT_DESCRIPTOR_AFFILIATION,
  inputDescriptorClaim,
  submissionRequirementAffiliation,
  submissionRequirementClaim,
} from "../../src/usecases/internal/input-descriptor.js";
import { KeyValues, Node, OpenedKeyValue } from "../../src/orbit-db/index.js";
import { initMockAgent } from "../helpers/mock-request.js";
import { generateCert } from "../oid4vp/test-utils.js";
import {
  CERT_PEM_POSTAMBLE,
  CERT_PEM_PREAMBLE,
} from "../../src/tool-box/x509/constant.js";
import * as jose from "jose";

const clientId = faker.internet.url();
const clientName = faker.string.alpha();
const requestUri = `${clientId}/request`;
const responseUri = `${clientId}/response`;
const redirectUri = `${clientId}/redirect`;

const mainNodeHost = "https://node.boolcheck.com";
const apiNodeHost = "https://api.boolcheck.com";
const frontendHost = "https://boolcheck.com";

describe("oid4vp-interactor", () => {
  let verifier: Verifier | null = null;
  let responseEndpoint: ResponseEndpoint | null = null;
  let node: Node | null = null;
  let openedKeyValues: KeyValues | null = null;
  let presentationDefinitionsKeyValue: OpenedKeyValue | null = null;
  let interactor: OID4VPInteractor;
  let stateRepository: PostStateRepository;
  let postFixture: PostFixtureHandler;

  beforeEach(async () => {
    await clearDir();

    process.env.OID4VP_CLIENT_ID = clientId;
    process.env.OID4VP_CLIENT_METADATA_NAME = clientName;
    process.env.OID4VP_RESPONSE_URI = responseUri;
    process.env.SIOP_V2_REDIRECT_URI = redirectUri;

    process.env.OID4VP_IPFS_PATH = generateTemporaryPath("ipfs", "blocks");
    process.env.OID4VP_ORBITDB_PATH = generateTemporaryPath("orbitdb");
    process.env.OID4VP_KEYSTORE_PATH = generateTemporaryPath("keystore");

    process.env.MAIN_NODE_HOST = mainNodeHost;
    process.env.API_HOST = apiNodeHost;
    process.env.OID4VP_REDIRECT_URI_RETURNED_BY_RESPONSE_URI = `${frontendHost}/oid4vp/response-code/exchange`;

    const { node: __node, openedKeyValues: __openedKeyValues } =
      await initOrbitdb4Verifier();
    node = __node;
    openedKeyValues = __openedKeyValues;

    const stateKeyValue = openedKeyValues.keyValues[KeyValueType.states.name];
    stateRepository = initPostStateRepository(stateKeyValue);

    const sessionKeyValue =
      openedKeyValues.keyValues[KeyValueType.sessions.name];
    const sessionRepository = initSessionRepository(sessionKeyValue);

    const verifierDatastore = initVerifierDatastore(openedKeyValues);
    verifier = initVerifier(verifierDatastore);

    const responseEndpointDatastore =
      initResponseEndpointDatastore(openedKeyValues);
    responseEndpoint = initResponseEndpoint(responseEndpointDatastore);

    presentationDefinitionsKeyValue =
      openedKeyValues.keyValues[KeyValueType.presentationDefinitions.name];

    interactor = initOID4VPInteractor(
      verifier,
      responseEndpoint,
      stateRepository,
      sessionRepository,
    );
    postFixture = initPostFixtureHandler(interactor);
  });

  afterEach(async () => {
    if (openedKeyValues) {
      openedKeyValues.closeKeyValues;
    }
    if (node) {
      await node.close();
    }
  });

  describe("#generateAuthRequest", async () => {
    type Ret = {
      clientId: string;
      params: Record<string, any>;
    };
    const presenter: AuthRequestPresenter<Ret> = (
      authRequest: AuthorizationRequest,
    ) => {
      const { clientId, params } = authRequest;
      return { clientId, params: params! };
    };
    describe("client error", async () => {
      it("should be invalid parameters", async () => {
        const result = await interactor.generateAuthRequest<Ret>(
          { url: "", comment: "", boolValue: 0 },
          presenter,
        );
        if (result.ok) {
          assert.fail("should not be ok");
        } else {
          const { type } = result.error;
          assert.equal(type, "INVALID_PARAMETER");
        }
      });
    });
    describe("bool value test", async () => {
      it("should be valid", async () => {
        const common = { url: "https://example.com", comment: "comment" };
        const boolValueFalse = await interactor.generateAuthRequest<Ret>(
          { ...common, boolValue: 0 },
          presenter,
        );
        const boolValueTrue = await interactor.generateAuthRequest<Ret>(
          { ...common, boolValue: 1 },
          presenter,
        );
        const boolValueElse = await interactor.generateAuthRequest<Ret>(
          { ...common, boolValue: 2 },
          presenter,
        );
        assert.isTrue(boolValueFalse.ok);
        assert.isTrue(boolValueTrue.ok);
        assert.isTrue(boolValueElse.ok);
      });
      it("should be invalid", async () => {
        const result = await interactor.generateAuthRequest<Ret>(
          { url: "https://example.com", comment: "comment", boolValue: -1 },
          presenter,
        );
        assert.isFalse(result.ok);
      });
    });
    describe("unsigned request", async () => {
      it("should return valid auth request", async () => {
        const url = faker.internet.url();
        const comment = "test comment";
        const boolValue = 1;
        const result = await interactor.generateAuthRequest<Ret>(
          { url, comment, boolValue },
          presenter,
        );

        if (result.ok) {
          const { clientId, params } = result.payload;
          assert.isString(params.state);
          assert.isString(params.nonce);
          assert.equal(params.client_id, clientId);
          assert.equal(params.client_id_scheme, "redirect_uri");
          assert.equal(params.response_uri, responseUri);
          assert.equal(params.client_metadata.client_name, clientName);
          assert.equal(params.client_metadata.client_id, clientId);
          assert.isString(params.presentation_definition_uri);
        } else {
          assert.fail("generateAuthRequest should be ok");
        }
      });
    });
  });
  describe("#generateAuthRequest4Delete", async () => {
    type Ret = {
      clientId: string;
      params: Record<string, any>;
    };
    const presenter: AuthRequestPresenter<Ret> = (
      authRequest: AuthorizationRequest,
    ) => {
      const { clientId, params } = authRequest;
      return { clientId, params: params! };
    };
    describe("client error", async () => {
      it("should be invalid parameters", async () => {
        const result = await interactor.generateAuthRequest4Delete<Ret>(
          { id: "" },
          presenter,
        );
        if (result.ok) {
          assert.fail("should not be ok");
        } else {
          const { type } = result.error;
          assert.equal(type, "INVALID_PARAMETER");
        }
      });
    });
    describe("unsigned request", async () => {
      it("should return valid auth request", async () => {
        const id = faker.string.uuid();
        const result = await interactor.generateAuthRequest4Delete<Ret>(
          { id },
          presenter,
        );

        if (result.ok) {
          const { clientId, params } = result.payload;
          assert.isString(params.state);
          assert.isString(params.nonce);
          assert.equal(params.client_id, clientId);
          assert.equal(params.client_id_scheme, "redirect_uri");
          assert.equal(params.response_uri, responseUri);
          assert.equal(params.client_metadata.client_name, clientName);
          assert.equal(params.client_metadata.client_id, clientId);
        } else {
          assert.fail("generateAuthRequest should be ok");
        }
      });
    });
  });
  describe("#getgetRequestObject", async () => {
    let _requestUri: string | undefined;
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

      const presenter: AuthRequestPresenter<string> = (
        authRequest: AuthorizationRequest,
      ) => {
        assert.isTrue(authRequest.requestUri!.startsWith(requestUri));
        return encodeURIComponent(authRequest.requestUri!);
      };
      const result = await interactor.generateAuthRequest<string>(
        { url: faker.internet.url(), comment: "test comment", boolValue: 1 },
        presenter,
      );
      if (result.ok) {
        _requestUri = result.payload;
      }
    });
    afterEach(async () => {
      process.env.OID4VP_CLIENT_ID_SCHEME = "redirect_uri";
    });
    it("should return valid auth request", async () => {
      const decodedUri = decodeURIComponent(_requestUri!);
      const params = new URL(decodedUri).searchParams;
      const result = await interactor.getRequestObject(
        params.get("id")!,
        params.get("presentationDefinitionId")!,
      );
      if (result.ok) {
        const request = result.payload!;
        try {
          const alg = getKeyAlgorithm(keypair);
          const ecPublicKey = await extractPublicKeyFromX5c(request, alg);

          const verifyResult = await jose.jwtVerify(request, ecPublicKey);
          console.debug(verifyResult);
          const { payload } = verifyResult;
          assert.isString(payload.state);
          assert.isString(payload.nonce);
          assert.equal(payload.client_id, clientId);
          assert.equal(payload.client_id_scheme, "x509_san_dns");
          assert.equal(payload.response_uri, responseUri);
          const { client_metadata } = payload;
          // @ts-ignore
          assert.equal(client_metadata!.client_name, clientName);
          // @ts-ignore
          assert.equal(client_metadata!.client_id, clientId);
          assert.isObject(payload.presentation_definition);
        } catch (err) {
          assert.fail("failed to verify request object", err);
        }
      } else {
        assert.fail("generateAuthRequest should be ok");
      }
    });
    it("should return presentation definition", async () => {});
  });
  describe("#getgetRequestObject4Delete", async () => {
    let _requestUri: string | undefined;
    const keypair = createKeyPair();
    beforeEach(async () => {
      const subject =
        "/C=JP/ST=Tokyo/L=Chiyoda-ku/O=Example Company/CN=example.jp";
      const cert = await generateCert(subject, keypair);
      process.env.OID4VP_REQUEST_URI = requestUri;
      const leafKeyX509 = `${CERT_PEM_PREAMBLE}\\n${cert}\\n${CERT_PEM_POSTAMBLE}`;
      process.env.OID4VP_CLIENT_ID_SCHEME = "x509_san_dns";
      process.env.OID4VP_VERIFIER_JWK = JSON.stringify(keypair);
      process.env.OID4VP_VERIFIER_X5C = leafKeyX509;

      const presenter: AuthRequestPresenter<string> = (
        authRequest: AuthorizationRequest,
      ) => {
        assert.isTrue(authRequest.requestUri!.startsWith(requestUri));
        return encodeURIComponent(authRequest.requestUri!);
      };
      const id = faker.string.uuid();
      const result = await interactor.generateAuthRequest4Delete<string>(
        { id },
        presenter,
      );
      if (result.ok) {
        _requestUri = result.payload;
      }
    });
    afterEach(async () => {
      process.env.OID4VP_CLIENT_ID_SCHEME = "redirect_uri";
    });
    it("should return valid auth request", async () => {
      const decodedUri = decodeURIComponent(_requestUri!);
      const params = new URL(decodedUri).searchParams;
      const result = await interactor.getRequestObject4Delete(
        params.get("id")!,
      );

      if (result.ok) {
        const request = result.payload!;
        const alg = getKeyAlgorithm(keypair);
        const ecPublicKey = await extractPublicKeyFromX5c(request, alg);

        const verifyResult = await jose.jwtVerify(request, ecPublicKey);
        console.debug(verifyResult);
        const { payload } = verifyResult;
        assert.isString(payload.state);
        assert.isString(payload.nonce);
        assert.equal(payload.client_id, clientId);
        assert.equal(payload.client_id_scheme, "x509_san_dns");
        assert.equal(payload.response_uri, responseUri);
        const { client_metadata } = payload;
        // @ts-ignore
        assert.equal(client_metadata!.client_name, clientName);
        // @ts-ignore
        assert.equal(client_metadata!.client_id, clientId);
      } else {
        assert.fail("generateAuthRequest should be ok");
      }
    });
  });
  describe("#getPresentationDefinition", async () => {
    it("should return presentation definition", async () => {
      if (!verifier) {
        assert.fail("verifier should be initialized");
      }
      const url = faker.internet.url();
      const comment = "test comment";
      const boolValue = 1;
      const id1 = inputDescriptorClaim(url, comment, boolValue);
      const id2 = INPUT_DESCRIPTOR_AFFILIATION;
      const pd = await verifier.generatePresentationDefinition(
        [id1, id2],
        [submissionRequirementClaim, submissionRequirementAffiliation],
        "真偽コメントに署名します",
        "投稿に信頼性を持たせるために身元を証明するクレデンシャルと共に真偽表明を行います",
      );

      const presentationDefinition = await verifier?.getPresentationDefinition(
        pd.id,
      );
      if (!presentationDefinition) {
        assert.fail("presentation definition should be got");
      }
      assert.equal(presentationDefinition.id, pd.id);

      const assertInputDescriptor = (
        actual: InputDescriptor,
        expected: InputDescriptor,
      ) => {
        assert.equal(actual.id, expected.id);
        assert.equal(actual.name, expected.name);
        assert.equal(actual.purpose, expected.purpose);
      };

      assertInputDescriptor(presentationDefinition.inputDescriptors[0], id1);
      assertInputDescriptor(presentationDefinition.inputDescriptors[1], id2);
      const fields =
        presentationDefinition.inputDescriptors[0].constraints.fields;
      // $.vc.type
      assert.equal(fields[0].path[0], "$.vc.type");
      assert.equal(fields[0].filter.type, "array");
      assert.equal(fields[0].filter.contains.const, "CommentCredential");
      // $.vc.credentialSubject.url
      assert.equal(fields[1].path[0], "$.vc.credentialSubject.url");
      assert.equal(fields[1].filter.type, "string");
      assert.equal(fields[1].filter.const, url);
      // $.vc.credentialSubject.comment
      assert.equal(fields[2].path[0], "$.vc.credentialSubject.comment");
      assert.equal(fields[2].filter.type, "string");
      assert.equal(fields[2].filter.const, comment);
      // $.vc.credentialSubject.bool_value
      assert.equal(fields[3].path[0], "$.vc.credentialSubject.bool_value");
      assert.equal(fields[3].filter.type, "number");
      assert.equal(fields[3].filter.minimum, boolValue);
      assert.equal(fields[3].filter.maximum, boolValue);
    });
  });
  describe("#receiveAuthResponse", async () => {
    let requestId: string | undefined;
    beforeEach(async () => {
      const presenter: AuthRequestPresenter<string> = (
        authRequest: AuthorizationRequest,
      ) => {
        const { params } = authRequest;
        return params!.state;
      };
      const result = await interactor.generateAuthRequest<string>(
        { url: faker.internet.url(), comment: "test comment", boolValue: 1 },
        presenter,
      );
      if (result.ok) {
        requestId = result.payload;
      }
    });
    describe("client error", async () => {
      it("should be invalid parameters", async () => {
        const payload = {};
        const result = await interactor.receiveAuthResponse(
          payload,
          (redirectUri, responseCode) => {},
        );
        if (result.ok) {
          assert.fail("should not be ok");
        } else {
          const { type } = result.error;
          assert.equal(type, "INVALID_PARAMETER");
        }
      });
      it("should be not found", async () => {
        const payload = {
          state: "no-such-request-id",
          vp_token: "dummy value",
          presentation_submission: "dummy value",
        };
        const result = await interactor.receiveAuthResponse(
          payload,
          (redirectUri, responseCode) => {},
        );
        if (result.ok) {
          assert.fail("should not be ok");
        } else {
          const { type } = result.error;
          assert.equal(type, "NOT_FOUND");
        }
      });
      it("should be expired", async () => {
        // todo
      });
    });
    describe("success", async () => {
      const presenter: AuthResponsePresenter<{
        redirectUri: string;
        responseCode: string;
      }> = (redirectUri, responseCode) => {
        return { redirectUri, responseCode };
      };
      it("should be success", async () => {
        const payload = {
          state: requestId,
          vp_token: "dummy value",
          presentation_submission: "dummy value",
          id_token: "dummy value",
        };

        // execute
        const result = await interactor.receiveAuthResponse(payload, presenter);

        // assert
        if (result.ok) {
          assert.isTrue(
            result.payload.redirectUri.startsWith(
              process.env.OID4VP_REDIRECT_URI_RETURNED_BY_RESPONSE_URI!,
            ),
          );
          assert.isNotEmpty(result.payload.redirectUri);
        } else {
          assert.fail("should not be ng");
        }
      });
    });
  });
  describe("#exchangeAuthResponse", async () => {
    let requestId: string | undefined;
    let responseCode: string | undefined;
    type Ret = {
      requestId: string;
      comment: string;
      url: any;
      claimer: {
        sub: string;
        id_token: string;
        organization?: string;
        icon?: string;
      };
    };
    const presenter: ExchangeResponseCodePresenter<Ret> = (
      requestId,
      comment,
      url,
      claimer,
    ) => {
      return { requestId, comment, url, claimer };
    };
    beforeEach(async () => {
      /* ---------------- Start VP Flow ------------------ */
      const request = await postFixture.startFlow();
      requestId = request.requestId;

      /* ---------------- Receive Auth Response ------------------ */
      const response = await postFixture.authResponse2(request);
      responseCode = await postFixture.receiveAuthResponse(request, response);
    });
    describe("ng case", () => {
      it("should return not found error", async () => {
        // prepare
        const responseCode = faker.string.uuid();

        // execute
        const result = await interactor.exchangeAuthResponse(
          responseCode,
          undefined,
          presenter,
        );

        // assert
        if (result.ok) {
          assert.fail("should not be ng");
        } else {
          const { type } = result.error;
          assert.equal(type, "NOT_FOUND");
        }
      });
    });
    describe("ok case", () => {
      let mockAgent: ReturnType<typeof initMockAgent>;
      beforeEach(async () => {
        const { response2 } = postFixture.memo;
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
      it("should be success", async () => {
        const result = await interactor.exchangeAuthResponse(
          responseCode!,
          undefined,
          presenter,
        );

        // assert
        if (result.ok) {
          const {
            requestId: __requestId,
            comment,
            url,
            claimer,
          } = result.payload;
          const { response2 } = postFixture.memo;
          assert.equal(__requestId, requestId);
          assert.equal(comment, response2.comment);
          assert.equal(url.url, response2.url);
          assert.equal(claimer.id_token, response2.claim.idToken);
          assert.equal(claimer.icon, response2.claim.icon);
          assert.equal(claimer.organization, response2.claim.organization);
        } else {
          assert.fail("should not be ng");
        }
      });
    });
  });

  describe("#exchangeAuthResponse4Delete", async () => {
    const id = faker.string.uuid();
    const __path = `/database/claims/${id}`;
    let requestId: string | undefined;
    let responseCode: string | undefined;
    let idToken: string | undefined;
    let deleteFixture: DeleteFixture;
    type DeleteRequest = Awaited<ReturnType<typeof deleteFixture.startFlow>>;
    let request: DeleteRequest;
    let mockAgent: ReturnType<typeof initMockAgent>;

    beforeEach(async () => {
      deleteFixture = initDeleteFixture(interactor);
      /* -----------=----- Start VP Flow ------------------ */
      request = await deleteFixture.startFlow(id);
      requestId = request.requestId;

      /* ---------------- Receive Auth Response ------------------ */
      idToken = await createIdToken({ nonce: request.nonce });
      responseCode = await deleteFixture.receiveAuthResponse(request, {
        state: requestId,
        id_token: idToken,
      });
    });
    describe("ng case", () => {
      describe("fake response code", () => {
        it("should return not found error", async () => {
          // prepare
          const responseCode = faker.string.uuid();

          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type } = result.error;
            assert.equal(type, "NOT_FOUND");
          }
        });
      });
      describe("already consumed vp request", () => {
        beforeEach(async () => {
          const consumeRequest = await verifier!.consumeRequest(requestId!);
        });
        it("should return conflict error", async () => {
          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode!,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type, message } = result.error;
            assert.equal(type, "CONFLICT");
            const state = await stateRepository.getState(requestId!);
            assert.equal(state?.value, "started");
          }
        });
      });
      describe("expired vp request", () => {
        beforeEach(async () => {
          process.env.OID4VP_REQUEST_EXPIRED_IN_AT_VERIFIER = "-1";
          /* -----------=----- Start VP Flow ------------------ */
          request = await deleteFixture.startFlow(id);
          requestId = request.requestId;

          /* ---------------- Receive Auth Response ------------------ */
          responseCode = await deleteFixture.receiveAuthResponse(request);
        });
        afterEach(async () => {
          process.env.OID4VP_REQUEST_EXPIRED_IN_AT_VERIFIER = "600";
        });
        it("should return expired error", async () => {
          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode!,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type, message } = result.error;
            assert.equal(type, "EXPIRED");
            const state = await stateRepository.getState(requestId!);
            assert.equal(state?.value, "started");
          }
        });
      });
      describe("expired flow state", () => {
        beforeEach(async () => {
          process.env.POST_STATE_EXPIRED_IN = "-1";
          /* -----------=----- Start VP Flow ------------------ */
          request = await deleteFixture.startFlow(id);
          requestId = request.requestId;

          /* ---------------- Receive Auth Response ------------------ */
          responseCode = await deleteFixture.receiveAuthResponse(request);
        });
        afterEach(async () => {
          process.env.POST_STATE_EXPIRED_IN = "600";
        });
        it("should return expired error", async () => {
          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode!,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type, message } = result.error;
            assert.equal(type, "EXPIRED");
            const state = await stateRepository.getState(requestId!);
            assert.equal(state?.value, "expired");
          }
        });
      });
      describe("invalid format id_token", () => {
        beforeEach(async () => {
          /* -----------=----- Start VP Flow ------------------ */
          request = await deleteFixture.startFlow(id);
          requestId = request.requestId;

          /* ---------------- Receive Auth Response ------------------ */
          responseCode = await deleteFixture.receiveAuthResponse(request, {
            state: requestId,
            id_token: "invalid-format-token",
          });
        });
        it("should return invalid parameters", async () => {
          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode!,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type, message } = result.error;
            assert.equal(type, "INVALID_PARAMETER");
            assert.equal(message, "id_token can not be validated.");
            const state = await stateRepository.getState(requestId!);
            assert.equal(state?.value, "invalid_submission");
          }
        });
      });
      describe("invalid nonce", () => {
        beforeEach(async () => {
          /* -----------=----- Start VP Flow ------------------ */
          request = await deleteFixture.startFlow(id);
          requestId = request.requestId;

          /* ---------------- Receive Auth Response ------------------ */
          responseCode = await deleteFixture.receiveAuthResponse({
            ...request,
            nonce: "bad nonce",
          });
        });
        it("should return invalid parameters", async () => {
          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode!,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type, message } = result.error;
            assert.equal(type, "INVALID_PARAMETER");
            assert.equal(message, "mismatch nonce error");
            const state = await stateRepository.getState(requestId!);
            assert.equal(state?.value, "invalid_submission");
          }
        });
      });
      describe("delete api call returns 400 error", () => {
        beforeEach(async () => {
          /* ---------------- Mock up url access ------------------ */
          mockAgent = initMockAgent();
          mockAgent.deleteAccess(mainNodeHost, __path, {
            statusCode: 400,
          });
        });
        afterEach(async () => {
          if (mockAgent) {
            await mockAgent.close();
          }
        });
        it("should return not found error", async () => {
          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode!,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type, message } = result.error;
            assert.equal(type, "INVALID_PARAMETER");
            assert.equal(message, "failed delete call.");
            const state = await stateRepository.getState(requestId!);
            assert.equal(state?.value, "invalid_submission");
          }
        });
      });
      describe("delete api call returns 500 error", () => {
        beforeEach(async () => {
          /* ---------------- Mock up url access ------------------ */
          mockAgent = initMockAgent();
          mockAgent.deleteAccess(mainNodeHost, __path, {
            statusCode: 500,
          });
        });
        afterEach(async () => {
          if (mockAgent) {
            await mockAgent.close();
          }
        });
        it("should return unexpected error", async () => {
          // execute
          const result = await interactor.exchangeAuthResponse4Delete(
            responseCode!,
            undefined,
          );

          // assert
          if (result.ok) {
            assert.fail("should not be ok");
          } else {
            const { type, message } = result.error;
            assert.equal(type, "UNEXPECTED_ERROR");
            assert.equal(message, "failed delete call.");
            const state = await stateRepository.getState(requestId!);
            assert.equal(state?.value, "started");
          }
        });
      });
    });
    describe("ok case", () => {
      beforeEach(async () => {
        /* ---------------- Mock up url access ------------------ */
        mockAgent = initMockAgent();
        mockAgent.deleteAccess(mainNodeHost, __path, {
          inspectRequestHeader: (headers) => {
            console.log("headers", headers);
            // @ts-ignore
            assert.equal(headers["Authorization"], `Bearer ${idToken}`);
          },
          inspectRequestPath: (path) => {
            assert.equal(path, __path);
          },
        });
      });
      afterEach(async () => {
        if (mockAgent) {
          await mockAgent.close();
        }
      });
      it("should be success", async () => {
        const result = await interactor.exchangeAuthResponse4Delete(
          responseCode!,
          undefined,
        );

        // assert
        if (!result.ok) {
          assert.fail("should not be ng");
        }
        const state = await stateRepository.getState(requestId!);
        assert.equal(state?.value, "committed");
      });
    });
  });

  describe("#confirmComment", () => {
    let mockAgent: ReturnType<typeof initMockAgent>;
    let requestId: string | undefined;
    let responseCode: string | undefined;

    const newClaimId = faker.string.uuid();
    const idToken = faker.string.alpha(10);
    const claimJwt = faker.string.alpha(10);
    const affiliateJwt = faker.string.alpha(10);

    beforeEach(async () => {
      /* ---------------- Start VP Flow ------------------ */
      const request = await postFixture.startFlow();
      requestId = request.requestId;
      /* ---------------- Receive Auth Response ------------------ */
      responseCode = await postFixture.receiveAuthResponse(request);
      /* ---------------- Consume Auth Response ------------------ */
      const presenter: ExchangeResponseCodePresenter<{ requestId: string }> = (
        requestId: string,
      ) => {
        return { requestId };
      };
      let newId = faker.string.uuid();
      const path = "/database/urls";

      mockAgent = initMockAgent();
      mockAgent.getAccess(apiNodeHost, path, [], {
        query: { filter: postFixture.memo.response1.url },
      });
      mockAgent.postAccess(
        mainNodeHost,
        path,
        { id: newId },
        { statusCode: 200 },
      );
      await interactor.exchangeAuthResponse(
        responseCode!,
        undefined,
        presenter,
      );
      process.env.NEW_CLAIM_ENDPOINT_HOST = mainNodeHost;
      mockAgent.postAccess(mainNodeHost, "/database/claims", {
        id: newClaimId,
      });
    });
    afterEach(async () => {
      await mockAgent.close();
    });
    const confirmCommentPresenter = (newClaimId: string) => {
      return { id: newClaimId };
    };
    describe("ng case", () => {
      describe("invalid header", () => {
        it("should return invalid header error", async () => {
          const result = await interactor.confirmComment(
            undefined,
            confirmCommentPresenter,
          );

          // assertion
          if (result.ok) {
            assert.fail("should not be ng");
          }
          assert.equal(result.error.type, "INVALID_HEADER");
        });
      });
      describe("not found", () => {
        it("should return not found error", async () => {
          const result = await interactor.confirmComment(
            "no-such-id",
            confirmCommentPresenter,
          );

          // assertion
          if (result.ok) {
            assert.fail("should be ng");
          }
          assert.equal(result.error.type, "NOT_FOUND");
        });
      });
      describe("expired", () => {
        beforeEach(async () => {
          const sessionKeyValue =
            openedKeyValues!.keyValues[KeyValueType.sessions.name];
          const repository = initSessionRepository(sessionKeyValue);
          await repository.putWaitCommitData(
            requestId!,
            idToken,
            claimJwt,
            affiliateJwt,
            { expiredIn: -1 },
          );
        });
        it("should return expired error", async () => {
          const result = await interactor.confirmComment(
            requestId,
            confirmCommentPresenter,
          );

          // assertion
          if (result.ok) {
            assert.fail("should not be ng");
          }
          assert.equal(result.error.type, "EXPIRED");
        });
      });
    });
    describe("ok case", () => {
      beforeEach(async () => {
        const sessionKeyValue =
          openedKeyValues!.keyValues[KeyValueType.sessions.name];
        const repository = initSessionRepository(sessionKeyValue);
        await repository.putWaitCommitData(
          requestId!,
          idToken,
          claimJwt,
          affiliateJwt,
        );
      });
      it("should return ok", async () => {
        const confirmCommentPresenter = (newClaimId: string) => {
          return { id: newClaimId };
        };

        // execute
        const result = await interactor.confirmComment(
          requestId,
          confirmCommentPresenter,
        );

        // assertion
        if (result.ok) {
          const { id } = result.payload;
          assert.equal(id, newClaimId);

          const stateKeyValue =
            openedKeyValues!.keyValues[KeyValueType.states.name];
          const stateRepository = initPostStateRepository(stateKeyValue);
          const state = await stateRepository.getState(requestId!);
          if (state) {
            assert.equal(state.value, "committed");
          } else {
            assert.fail("should not be ok");
          }
        } else {
          assert.fail("should not be ok");
        }
      });
    });
  });
  describe("#cancelComment", () => {
    let requestId: string | undefined;
    let responseCode: string | undefined;

    const sessionId = faker.string.uuid();
    const idToken = faker.string.alpha(10);
    const claimJwt = faker.string.alpha(10);
    const affiliateJwt = faker.string.alpha(10);
    let mockAgent: ReturnType<typeof initMockAgent>;

    beforeEach(async () => {
      /* ---------------- Start VP Flow ------------------ */
      const request = await postFixture.startFlow();
      requestId = request.requestId;
      /* ---------------- Receive Auth Response ------------------ */
      responseCode = await postFixture.receiveAuthResponse(request);
      /* ---------------- Consume Auth Response ------------------ */
      const presenter: ExchangeResponseCodePresenter<{ requestId: string }> = (
        requestId: string,
      ) => {
        return { requestId };
      };
      mockAgent = initMockAgent();
      mockAgent.getAccess(
        apiNodeHost,
        "/database/urls",
        [{ url: postFixture.memo.response1.url }],
        {
          query: { filter: postFixture.memo.response1.url },
        },
      );
      await interactor.exchangeAuthResponse(
        responseCode!,
        undefined,
        presenter,
      );
    });
    afterEach(async () => {
      await mockAgent.close();
    });
    describe("ng case", () => {
      describe("invalid header", () => {
        it("should return invalid header error", async () => {
          // execute
          const sessionId = undefined;
          const result = await interactor.cancelComment(sessionId);

          // assertion
          if (result.ok) {
            assert.fail("should not be ng");
          }
          assert.equal(result.error.type, "INVALID_HEADER");
        });
      });
      describe("not found", () => {
        it("should return not found error", async () => {
          // prepare
          const sessionKeyValue =
            openedKeyValues!.keyValues[KeyValueType.sessions.name];
          const repository = initSessionRepository(sessionKeyValue);

          // execute
          const result = await interactor.cancelComment(sessionId);

          // assertion
          if (result.ok) {
            assert.fail("should not be ng");
          }
          assert.equal(result.error.type, "NOT_FOUND");
        });
      });
      describe("expired", () => {
        beforeEach(async () => {
          const sessionKeyValue =
            openedKeyValues!.keyValues[KeyValueType.sessions.name];
          const repository = initSessionRepository(sessionKeyValue);
          await repository.putWaitCommitData(
            requestId!,
            idToken,
            claimJwt,
            affiliateJwt,
            { expiredIn: -1 },
          );
        });
        it("should return expired error", async () => {
          const result = await interactor.cancelComment(requestId);

          // assertion
          if (result.ok) {
            assert.fail("should not be ng");
          }
          assert.equal(result.error.type, "EXPIRED");
        });
      });
    });
    describe("ok case", () => {
      beforeEach(async () => {
        const sessionKeyValue =
          openedKeyValues!.keyValues[KeyValueType.sessions.name];
        const repository = initSessionRepository(sessionKeyValue);
        await repository.putWaitCommitData(
          requestId!,
          idToken,
          claimJwt,
          affiliateJwt,
        );
      });
      it("should return ok", async () => {
        const result = await interactor.cancelComment(requestId);

        // assertion
        if (result.ok) {
          const stateKeyValue =
            openedKeyValues!.keyValues[KeyValueType.states.name];
          const stateRepository = initPostStateRepository(stateKeyValue);
          const state = await stateRepository.getState(requestId!);
          if (state) {
            assert.equal(state.value, "canceled");
          } else {
            assert.fail("should not be ok");
          }
        } else {
          assert.fail("should not be ok");
        }
      });
    });
  });
});
