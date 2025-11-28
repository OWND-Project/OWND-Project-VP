import { faker } from "@faker-js/faker";
import { assert } from "chai";
import { v4 as uuidv4 } from "uuid";
import * as jose from "jose";

import {
  Verifier,
  VerifierDatastore,
  VpRequestAtVerifier,
  VpRequest,
  MissingUriError,
  initVerifier,
  getKeyAlgorithm,
} from "../../src/oid4vp/index.js";

import { getCurrentUnixTimeInSeconds } from "../../src/utils/data-util.js";
import { createKeyPair, extractPublicKeyFromX5c } from "../test-utils.js";
import { generateCert } from "./test-utils.js";

describe("Verifier", () => {
  let saveRequestCalled = false;
  let verifierDatastore: VerifierDatastore;
  let verifier: Verifier;
  beforeEach(async () => {
    saveRequestCalled = false;
    verifierDatastore = {
      getRequest(_requestId: string): Promise<VpRequestAtVerifier | null> {
        return Promise.resolve(null);
      },
      saveRequest: async (_request: VpRequestAtVerifier) => {
        saveRequestCalled = true;
      },
      consumeRequest: async (_requestId: string, _consumedAt: number) => {
        // no-op for tests
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
          const clientIdWithPrefix = `redirect_uri:${clientId}`;
          await verifier.startRequest(request, clientIdWithPrefix, {
            requestObject: {},
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
        const responseMode = "direct_post";
        const responseUri = faker.internet.url();
        const clientIdWithPrefix = `redirect_uri:${clientId}`;
        const ret = await verifier.startRequest(request, clientIdWithPrefix, {
          requestObject: {
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
          assert.equal(params.client_id, clientIdWithPrefix);
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
        const clientIdWithPrefix = `x509_san_dns:${clientId}`;
        const authRequest = await verifier.startRequest(
          request,
          clientIdWithPrefix,
          {
            requestObject: {
              responseType,
              responseMode,
              responseUri,
            },
            issuerJwk: keypair,
            x5c,
            expiredIn,
          },
        );
        console.log(authRequest);
        if (authRequest.request) {
          const { request } = authRequest;
          try {
            const alg = getKeyAlgorithm(keypair);
            const ecPublicKey = await extractPublicKeyFromX5c(request, alg);

            const verifyResult = await jose.jwtVerify(request, ecPublicKey);
            console.debug(verifyResult);
            // OID4VP 1.0: client_id contains the prefix, no client_id_scheme parameter
            assert.equal(verifyResult.payload.client_id, clientIdWithPrefix);
            assert.isTrue(
              (verifyResult.payload.client_id as string).startsWith(
                "x509_san_dns:",
              ),
            );
          } catch (err) {
            assert.fail("failed to generate request object", err);
          }
        } else {
          assert.fail("request should be signed");
        }
      });
    });
  });

  // Removed: #generatePresentationDefinition and #getPresentationDefinition tests (PEX deprecated)

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

  // Removed: #getDescriptor tests (PEX deprecated)
  // Removed: #getPresentation tests (PEX deprecated)
  // Removed: #getCredential tests (PEX deprecated)

  describe("#startRequest with encryption", () => {
    it("should include encryption public key in client_metadata when provided", async () => {
      const id = uuidv4();
      const responseType = "vp_token";
      const issuedAt = getCurrentUnixTimeInSeconds();
      const expiredIn = 60;
      const clientId = faker.internet.url();
      const responseUri = faker.internet.url();

      // Mock encryption keys (simulating Response Endpoint generated keys)
      const mockPublicJwk = {
        kty: "EC",
        crv: "P-256",
        x: "test-x-coordinate",
        y: "test-y-coordinate",
        kid: "test-kid-123",
        use: "enc",
        alg: "ECDH-ES",
      };

      const request: VpRequest = {
        id,
        responseType,
        issuedAt,
        expiredIn,
        encryptionPublicJwk: JSON.stringify(mockPublicJwk),
        encryptionPrivateJwk: JSON.stringify({ ...mockPublicJwk, d: "test-private" }),
      };

      const clientIdWithPrefix = `redirect_uri:${clientId}`;
      const result = await verifier.startRequest(request, clientIdWithPrefix, {
        requestObject: {
          responseUri,
        },
      });

      // Verify request object contains client_metadata with encryption info
      assert.isDefined(result.params);
      if (result.params) {
        assert.isDefined(result.params.client_metadata);
        const clientMetadata = result.params.client_metadata;

        // Check jwks
        assert.isDefined(clientMetadata.jwks);
        assert.isArray(clientMetadata.jwks.keys);
        assert.equal(clientMetadata.jwks.keys.length, 1);
        assert.equal(clientMetadata.jwks.keys[0].kid, mockPublicJwk.kid);
        assert.equal(clientMetadata.jwks.keys[0].use, "enc");
        assert.equal(clientMetadata.jwks.keys[0].alg, "ECDH-ES");

        // Check encrypted_response_enc_values_supported
        assert.isDefined(clientMetadata.encrypted_response_enc_values_supported);
        assert.include(clientMetadata.encrypted_response_enc_values_supported, "A128GCM");

        // Check response_mode
        assert.equal(result.params.response_mode, "direct_post.jwt");
      }
    });

    it("should not include encryption metadata when encryption keys not provided", async () => {
      const id = uuidv4();
      const responseType = "vp_token";
      const issuedAt = getCurrentUnixTimeInSeconds();
      const expiredIn = 60;
      const clientId = faker.internet.url();
      const responseUri = faker.internet.url();

      const request: VpRequest = {
        id,
        responseType,
        issuedAt,
        expiredIn,
        // No encryption keys
      };

      const clientIdWithPrefix = `redirect_uri:${clientId}`;
      const result = await verifier.startRequest(request, clientIdWithPrefix, {
        requestObject: {
          responseUri,
        },
      });

      // Verify request object does NOT contain encryption metadata
      assert.isDefined(result.params);
      if (result.params) {
        // response_mode should be default (not direct_post.jwt)
        assert.notEqual(result.params.response_mode, "direct_post.jwt");

        // client_metadata should not have encryption fields (or be undefined)
        if (result.params.client_metadata) {
          assert.isUndefined(result.params.client_metadata.jwks);
          assert.isUndefined(result.params.client_metadata.encrypted_response_enc_values_supported);
        }
      }
    });
  });
});
