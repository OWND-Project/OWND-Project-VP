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
});
