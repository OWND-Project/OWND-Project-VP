import { faker } from "@faker-js/faker";
import { assert } from "chai";
import { v4 as uuidv4 } from "uuid";
import * as jose from "jose";

import {
  DescriptorMap,
  PresentationDefinition,
  PresentationSubmission,
  Verifier,
  VerifierDatastore,
  VpRequestAtVerifier,
  AuthResponsePayload,
  VpRequest,
  MissingUriError,
  initVerifier,
  camelToSnake,
  getKeyAlgorithm,
} from "../../src/oid4vp/index.js";
import { getCurrentUnixTimeInSeconds } from "../../src/utils/data-util.js";
import { createKeyPair, extractPublicKeyFromX5c } from "../test-utils.js";
import { issueJwt } from "../../src/helpers/jwt-helper.js";
import {
  verifyVcForW3CVcDataV1,
  verifyVpForW3CVcDataV1,
} from "../../src/tool-box/index.js";
import { generateCert } from "./test-utils.js";
import { publicJwkFromPrivate } from "elliptic-jwk";

describe("Verifier", () => {
  let saveRequestCalled = false;
  let savePresentationDefinitionCalled = false;
  let verifierDatastore: VerifierDatastore;
  let verifier: Verifier;
  beforeEach(async () => {
    saveRequestCalled = false;
    savePresentationDefinitionCalled = false;
    verifierDatastore = {
      getRequest(requestId: string): Promise<VpRequestAtVerifier | null> {
        return Promise.resolve(null);
      },
      saveRequest: async (request: VpRequestAtVerifier) => {
        saveRequestCalled = true;
      },
      savePresentationDefinition: async (
        presentationDefinition: PresentationDefinition,
      ) => {
        savePresentationDefinitionCalled = true;
      },
      getPresentationDefinition: async (presentationDefinitionId: string) => {
        return {
          id: presentationDefinitionId,
          inputDescriptors: [],
          submissionRequirements: [],
        };
      },
    };
    verifier = initVerifier(verifierDatastore);
  });

  describe("#startRequest", () => {
    const id = uuidv4();
    const transactionId = uuidv4();
    const issuedAt = new Date().getTime() / 1000;
    const expiredIn = 60;
    const clientId = faker.internet.url();
    describe("MissingUriError", () => {
      it("should fail to generate vp request", async () => {
        const responseType = "vp_token id_token";
        const request: VpRequest = {
          id,
          responseType,
          transactionId,
          issuedAt,
          expiredIn,
        };
        try {
          await verifier.startRequest(request, clientId, {
            requestObject: {
              clientIdScheme: "redirect_uri",
            },
            expiredIn,
          });
          assert.fail("startRequest should be return missing uri error");
        } catch (err) {
          assert.isTrue(err instanceof MissingUriError);
        }
      });
    });
    describe("not signed", () => {
      it("should generate vp request", async () => {
        const responseType = "vp_token id_token";
        const request: VpRequest = {
          id,
          responseType,
          transactionId,
          issuedAt,
          expiredIn,
        };
        const clientIdScheme = "redirect_uri";
        const responseMode = "direct_post";
        const responseUri = faker.internet.url();
        const ret = await verifier.startRequest(request, clientId, {
          requestObject: {
            clientIdScheme,
            responseMode,
            responseUri,
          },
          expiredIn,
        });
        assert.isTrue(saveRequestCalled, "saveRequest should be called");
        if (ret.params) {
          const { params } = ret;
          assert.equal(params.state, request.id);
          assert.isString(params.nonce);
          assert.equal(params.client_id, clientId);
          assert.equal(params.client_id_scheme, clientIdScheme);
          assert.equal(params.response_mode, responseMode);
          assert.equal(params.response_uri, responseUri);
          // assert.equal(requestAtVerifier.transactionId, request.transactionId);
          // assert.isNumber(requestAtVerifier.issuedAt);
          // assert.equal(requestAtVerifier.expiredIn, expiredIn);
        } else {
          assert.fail(
            "startRequest should be return query params encoded value",
          );
        }
      });
    });
    describe("signed", () => {
      it("should generate vp request", async () => {
        const subject =
          "/C=JP/ST=Tokyo/L=Chiyoda-ku/O=Example Company/CN=example.jp";
        const keypair = createKeyPair();
        const cert = await generateCert(subject, keypair);
        const x5c = [cert];
        const responseType = "vp_token id_token";
        const request: VpRequest = {
          id,
          responseType,
          transactionId,
          issuedAt,
          expiredIn,
        };
        const responseMode = "direct_post";
        const responseUri = faker.internet.url();
        const authRequest = await verifier.startRequest(request, clientId, {
          requestObject: {
            clientIdScheme: "x509_san_dns",
            responseType,
            responseMode,
            responseUri,
          },
          issuerJwk: keypair,
          x5c,
          expiredIn,
        });
        console.log(authRequest);
        if (authRequest.request) {
          const { request } = authRequest;
          try {
            const alg = getKeyAlgorithm(keypair);
            const ecPublicKey = await extractPublicKeyFromX5c(request, alg);

            const verifyResult = await jose.jwtVerify(request, ecPublicKey);
            console.debug(verifyResult);
            assert.equal(verifyResult.payload.client_id_scheme, "x509_san_dns");
          } catch (err) {
            assert.fail("failed to generate request object", err);
          }
        } else {
          assert.fail("request should be signed");
        }
      });
    });
  });

  describe("#generatePresentationDefinition", () => {
    it("should generate presentation definition", async () => {
      const verifier = initVerifier(verifierDatastore);
      const pd = await verifier.generatePresentationDefinition([], []);
      assert.isTrue(
        savePresentationDefinitionCalled,
        "savePresentationDefinition should be called",
      );
      assert.isString(pd.id);
    });
  });

  describe("#getPresentationDefinition", () => {
    it("should get presentation definition", async () => {
      const id = uuidv4();
      const verifier = initVerifier(verifierDatastore);
      const pd = await verifier.getPresentationDefinition(id);
      if (pd) {
        assert.equal(pd.id, id);
      } else {
        assert.fail(
          "getPresentationDefinition should return presentation definition object",
        );
      }
    });
  });

  describe("#getRequest", () => {
    it("should be not found error", async () => {
      verifierDatastore = {
        ...verifierDatastore,
        getRequest(requestId: string): Promise<VpRequestAtVerifier | null> {
          return Promise.resolve(null);
        },
      };
      const id = uuidv4();
      const verifier = initVerifier(verifierDatastore);
      const getRequest = await verifier.getRequest(id);
      if (getRequest.ok) {
        assert.fail("should be ng");
      } else {
        const { type } = getRequest.error;
        assert.equal(type, "NOT_FOUND");
      }
    });
    it("should be expired error", async () => {
      const id = uuidv4();
      verifierDatastore = {
        ...verifierDatastore,
        getRequest(requestId: string): Promise<VpRequestAtVerifier | null> {
          return Promise.resolve({
            id,
            nonce: faker.string.uuid(),
            issuedAt: getCurrentUnixTimeInSeconds() - 1,
            expiredIn: 0,
            consumedAt: 0,
          });
        },
      };
      const verifier = initVerifier(verifierDatastore);
      const getRequest = await verifier.getRequest(id);
      if (getRequest.ok) {
        assert.fail("should be ng");
      } else {
        const { type } = getRequest.error;
        assert.equal(type, "EXPIRED");
      }
    });
    it("should be already consumed error", async () => {
      const id = uuidv4();
      verifierDatastore = {
        ...verifierDatastore,
        getRequest(requestId: string): Promise<VpRequestAtVerifier | null> {
          return Promise.resolve({
            id,
            nonce: faker.string.uuid(),
            issuedAt: getCurrentUnixTimeInSeconds() - 10,
            expiredIn: 600,
            consumedAt: getCurrentUnixTimeInSeconds(),
          });
        },
      };
      const verifier = initVerifier(verifierDatastore);
      const getRequest = await verifier.getRequest(id);
      if (getRequest.ok) {
        assert.fail("should be ng");
      } else {
        const { type } = getRequest.error;
        assert.equal(type, "CONSUMED");
      }
    });
    it("should be unexpected error", async () => {
      const id = uuidv4();
      verifierDatastore = {
        ...verifierDatastore,
        getRequest(requestId: string): Promise<VpRequestAtVerifier | null> {
          return Promise.reject(new Error("dummy error"));
        },
      };
      const verifier = initVerifier(verifierDatastore);
      const getRequest = await verifier.getRequest(id);
      if (getRequest.ok) {
        assert.fail("should be ng");
      } else {
        const { type } = getRequest.error;
        assert.equal(type, "UNEXPECTED_ERROR");
      }
    });
  });
  describe("#consumeRequest", () => {
    it("should update consumed_at successfully", async () => {
      const nonce = faker.string.uuid();
      verifierDatastore = {
        ...verifierDatastore,
        getRequest(requestId: string): Promise<VpRequestAtVerifier | null> {
          return Promise.resolve({
            id,
            nonce,
            issuedAt: getCurrentUnixTimeInSeconds() - 1,
            expiredIn: 600,
            consumedAt: 0,
          });
        },
        saveRequest: async (request: VpRequestAtVerifier) => {
          assert.isAbove(request.consumedAt, 0);
          saveRequestCalled = true;
        },
      };
      const id = uuidv4();
      const verifier = initVerifier(verifierDatastore);
      const getRequest = await verifier.consumeRequest(id);
      if (getRequest.ok) {
        assert.isTrue(saveRequestCalled);
      } else {
        assert.fail("should be ok");
      }
    });
  });

  describe("#getDescriptor", () => {
    const definitionId = faker.string.uuid();
    const inputDescId = faker.string.uuid();
    const __mapId = faker.string.uuid();
    const map1 = { id: __mapId, path: "$", format: "jwt_vp_json" };
    const submission: PresentationSubmission = {
      id: faker.string.uuid(),
      definitionId: definitionId,
      descriptorMap: [map1],
    };

    const authResponse: AuthResponsePayload = {
      vpToken: "dummy-token",
      idToken: "dummy-token",
      presentationSubmission: JSON.stringify(camelToSnake(submission)),
    };

    it("should be not found error", async () => {
      // prepare
      verifierDatastore = {
        ...verifierDatastore,
        getPresentationDefinition: async (presentationDefinitionId: string) => {
          return null;
        },
      };

      // execute
      const verifier = initVerifier(verifierDatastore);
      const result = await verifier.getDescriptor(inputDescId, authResponse);

      // assert
      if (result.ok) {
        assert.fail("should be ng");
      } else {
        const { type } = result.error;
        assert.equal(type, "NOT_FOUND");
      }
    });

    it("should be invalid submission error", async () => {
      // prepare
      verifierDatastore = {
        ...verifierDatastore,
        getPresentationDefinition: async (presentationDefinitionId: string) => {
          return {
            id: presentationDefinitionId,
            inputDescriptors: [{ id: inputDescId, constraints: {} }],
            submissionRequirements: [],
          };
        },
      };

      // execute
      const verifier = initVerifier(verifierDatastore);
      const result = await verifier.getDescriptor("no-such-id", authResponse);

      // assert
      if (result.ok) {
        assert.fail("should be ng");
      } else {
        const { type } = result.error;
        assert.equal(type, "INVALID_SUBMISSION");
      }
    });

    it("should be no submission error", async () => {
      // prepare
      const __mapId1 = faker.string.uuid(); // doesn't match with any input descriptor.
      const __mapId2 = faker.string.uuid(); // doesn't match with any input descriptor.
      const map1 = { id: __mapId1, path: "$[0]", format: "jwt_vp_json" };
      const map2 = { id: __mapId2, path: "$[1]", format: "jwt_vp_json" };
      const submission: PresentationSubmission = {
        id: faker.string.uuid(),
        definitionId: definitionId,
        descriptorMap: [map1, map2],
      };

      const authResponse: AuthResponsePayload = {
        vpToken: "dummy-token",
        idToken: "dummy-token",
        presentationSubmission: JSON.stringify(camelToSnake(submission)),
      };
      verifierDatastore = {
        ...verifierDatastore,
        getPresentationDefinition: async (presentationDefinitionId: string) => {
          return {
            id: presentationDefinitionId,
            inputDescriptors: [{ id: inputDescId, constraints: {} }],
            submissionRequirements: [],
          };
        },
      };

      // execute
      const verifier = initVerifier(verifierDatastore);
      const result = await verifier.getDescriptor(inputDescId, authResponse);

      // assert
      if (result.ok) {
        assert.fail("should be ng");
      } else {
        const { type } = result.error;
        assert.equal(type, "NO_SUBMISSION");
      }
    });

    it("should be success", async () => {
      // prepare
      const __mapId1 = faker.string.uuid();
      const __mapId2 = inputDescId;
      const map1 = { id: __mapId1, path: "$[0]", format: "jwt_vp_json" };
      const map2 = { id: __mapId2, path: "$[1]", format: "jwt_vp_json" };
      const submission: PresentationSubmission = {
        id: faker.string.uuid(),
        definitionId: definitionId,
        descriptorMap: [map1, map2],
      };

      const authResponse: AuthResponsePayload = {
        vpToken: "dummy-token",
        idToken: "dummy-token",
        presentationSubmission: JSON.stringify(camelToSnake(submission)),
      };
      verifierDatastore = {
        ...verifierDatastore,
        getPresentationDefinition: async (presentationDefinitionId: string) => {
          return {
            id: presentationDefinitionId,
            inputDescriptors: [{ id: inputDescId, constraints: {} }],
            submissionRequirements: [],
          };
        },
      };

      // execute
      const verifier = initVerifier(verifierDatastore);
      const result = await verifier.getDescriptor(inputDescId, authResponse);

      // assert
      if (result.ok) {
        const { descriptorMap } = result.payload;
        const ar = verifier.getAuthResponse();
        assert.equal(descriptorMap.id, __mapId2);
      } else {
        const { type } = result.error;
        assert.fail("should be ok");
      }
    });
  });

  describe("#getPresentation", () => {
    const definitionId = faker.string.uuid();
    const inputDescId = faker.string.uuid();
    it("should be invalid submission(unmatched path)", async () => {
      // prepare
      const map1 = { id: inputDescId, path: "$[1]", format: "jwt_vp_json" };
      const submission: PresentationSubmission = {
        id: faker.string.uuid(),
        definitionId: definitionId,
        descriptorMap: [map1],
      };

      const authResponse: AuthResponsePayload = {
        vpToken: ["dummy-token"],
        idToken: "dummy-token",
        presentationSubmission: JSON.stringify(camelToSnake(submission)),
      };

      const verifier = initVerifier(verifierDatastore);
      verifier.setAuthResponse(authResponse);

      // execute
      const result = await verifier.getPresentation(map1);

      // assert
      if (result.ok) {
        assert.fail("should be ng");
      }
      const { type } = result.error;
      assert.equal(type, "INVALID_SUBMISSION");
    });
    it("should be invalid submission(unsupported format)", async () => {
      // prepare
      const map1 = {
        id: inputDescId,
        path: "$[0]",
        format: "unsupported-format",
      };
      const submission: PresentationSubmission = {
        id: faker.string.uuid(),
        definitionId: definitionId,
        descriptorMap: [map1],
      };

      const authResponse: AuthResponsePayload = {
        vpToken: ["dummy-token"],
        idToken: "dummy-token",
        presentationSubmission: JSON.stringify(camelToSnake(submission)),
      };

      const verifier = initVerifier(verifierDatastore);
      verifier.setAuthResponse(authResponse);

      // execute
      const result = await verifier.getPresentation(map1);

      // assert
      if (result.ok) {
        assert.fail("should be ng");
      }
      const { type } = result.error;
      assert.equal(type, "INVALID_SUBMISSION");
    });
    it("should be success", async () => {
      // prepare
      const map1 = {
        id: inputDescId,
        path: "$",
        format: "jwt_vp_json",
      };
      const submission: PresentationSubmission = {
        id: faker.string.uuid(),
        definitionId: definitionId,
        descriptorMap: [map1],
      };
      const keyPair = createKeyPair();
      const header = { alg: "ES256", jwk: publicJwkFromPrivate(keyPair) };
      const holderKeyPair = createKeyPair();
      const credential = {
        vc: { credentialSubject: { claim1: "foo" } },
      };
      const vc = await issueJwt(header, credential, keyPair);
      const presentation = {
        vp: { verifiableCredential: [vc] },
      };
      const vpToken = await issueJwt(header, presentation, holderKeyPair);
      const authResponse: AuthResponsePayload = {
        vpToken,
        idToken: "dummy-token",
        presentationSubmission: JSON.stringify(camelToSnake(submission)),
      };

      const verifyFunction = async (credential: string) => {
        return await verifyVpForW3CVcDataV1<string>(credential, {
          jwk: holderKeyPair,
          alg: "ES256",
        });
      };

      const verifier = initVerifier(verifierDatastore);
      verifier.setAuthResponse(authResponse);

      // execute
      const result = await verifier.getPresentation(map1, verifyFunction);

      // assert
      if (!result.ok) {
        assert.fail("should be ok");
      }
      const { decoded, raw } = result.payload.vp;
      assert.equal(decoded.vp.verifiableCredential[0], vc);
      assert.equal(raw, vpToken);
    });
  });

  describe("#getCredential", () => {
    type Cred1 = { claim1: string };
    const definitionId = faker.string.uuid();
    const inputDescId = faker.string.uuid();
    const w3cVpPath = "$.vp.verifiableCredential[0]";
    const map1: DescriptorMap = {
      id: inputDescId,
      path: "$",
      format: "jwt_vp_json",
      pathNested: {
        path: w3cVpPath,
        format: "jwt_vc_json",
      },
    };
    const keyPair = createKeyPair();
    const header = { alg: "ES256", jwk: publicJwkFromPrivate(keyPair) };
    const holderKeyPair = createKeyPair();
    const credential = {
      vc: { credentialSubject: { claim1: "foo" } },
    };
    it("should be invalid submission(unmatched path)", async () => {
      // prepare
      const vc = await issueJwt(header, credential, keyPair);
      const presentation = {
        vp: { noSuchPath: [vc] },
      };

      const verifyFunction = async (credential: string) => {
        return await verifyVcForW3CVcDataV1<Cred1>(credential);
      };

      const verifier = initVerifier(verifierDatastore);

      // execute
      const result = await verifier.getCredential(
        { vp: { decoded: presentation, raw: "dummy" }, descriptorMap: map1 },
        verifyFunction,
      );

      // assert
      if (result.ok) {
        assert.fail("should be ng");
      }
      const { type } = result.error;
      assert.equal(type, "INVALID_SUBMISSION");
    });
    it("should be invalid submission(unsupported format)", async () => {
      // prepare
      const map1: DescriptorMap = {
        id: inputDescId,
        path: "$",
        format: "jwt_vp_json",
        pathNested: {
          path: w3cVpPath,
          format: "unsupported-format",
        },
      };
      const vc = await issueJwt(header, credential, keyPair);
      const presentation = {
        vp: { verifiableCredential: [vc] },
      };

      const verifyFunction = async (credential: string) => {
        return await verifyVcForW3CVcDataV1<Cred1>(credential);
      };

      const verifier = initVerifier(verifierDatastore);

      // execute
      const result = await verifier.getCredential(
        { vp: { decoded: presentation, raw: "dummy" }, descriptorMap: map1 },
        verifyFunction,
      );

      // assert
      if (result.ok) {
        assert.fail("should be ng");
      }
      const { type } = result.error;
      assert.equal(type, "INVALID_SUBMISSION");
    });

    it("should be success", async () => {
      // prepare
      const vc = await issueJwt(header, credential, keyPair);
      const presentation = {
        vp: { verifiableCredential: [vc] },
      };

      const verifyFunction = async (credential: string) => {
        return await verifyVcForW3CVcDataV1<Cred1>(credential);
      };

      const verifier = initVerifier(verifierDatastore);

      // execute
      const result = await verifier.getCredential(
        { vp: { decoded: presentation, raw: "dummy" }, descriptorMap: map1 },
        verifyFunction,
      );

      // assert
      if (!result.ok) {
        assert.fail("should be ok");
      }
      const { decoded, raw } = result.payload;
      assert.equal(decoded.vc.credentialSubject.claim1, "foo");
      assert.equal(raw, vc);
    });
  });
});
