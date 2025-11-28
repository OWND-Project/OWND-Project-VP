import { assert } from "chai";
import { faker } from "@faker-js/faker";

import {
  AuthResponse,
  initResponseEndpoint,
  ResponseEndpointDatastore,
  VpRequest,
  VpTokenVerificationCallback,
} from "../../src/oid4vp/index.js";
import { createKeyPair, createSdJwt } from "../test-utils.js";
import { issueJwt } from "../../src/helpers/jwt-helper.js";

describe("ResponseEndpoint - Verification Callback", () => {
  let datastore: ResponseEndpointDatastore;
  let holderKeyPair: any;

  beforeEach(() => {
    holderKeyPair = createKeyPair();
    datastore = {
      saveRequest: async () => {},
      getRequest: async () => null,
      getResponse: async () => null,
      saveResponse: async () => {},
    };
  });

  /**
   * Create a mock verification callback for testing
   */
  const createMockVerificationCallback = (
    shouldSucceed: boolean = true,
    errorMessage?: string,
  ): VpTokenVerificationCallback => ({
    verifyCredential: async (credential, _nonce) => {
      if (shouldSucceed) {
        return {
          ok: true,
          payload: {
            verified: true,
            decodedPayload: { test: "decoded-payload" },
          },
        };
      }
      return { ok: false, error: errorMessage || "Verification failed" };
    },
  });

  describe("#receiveAuthResponse with verificationCallback", () => {
    const credentialQueryId = "learning_credential";

    describe("正常系", () => {
      it("should return verified status when nonce and callback verification succeed", async () => {
        const requestId = faker.string.uuid();
        const nonce = faker.string.uuid();

        // Create valid SD-JWT with correct nonce in KB-JWT
        const claims = {
          vct: "urn:eu.europa.ec.eudi:learning:credential:1",
          issuing_authority: "Test University",
        };
        const sdJwt = await createSdJwt(claims, [], {
          holderPublicJwk: holderKeyPair,
        });
        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce, aud: "https://verifier.example.com" },
          holderKeyPair,
        );
        const vpToken = {
          [credentialQueryId]: [sdJwt + kbJwt],
        };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce, // Important: nonce must be set for verification
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          { verificationCallback: createMockVerificationCallback(true) },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          assert.isDefined(result.payload.verificationResult);
          const verificationResult = result.payload.verificationResult!;
          assert.isDefined(verificationResult.credentials[credentialQueryId]);
          const credentials = verificationResult.credentials[credentialQueryId];
          assert.equal(credentials.length, 1);
          assert.equal(credentials[0].status, "verified");
        }
      });

      it("should handle multiple credentials and verify all", async () => {
        const requestId = faker.string.uuid();
        const nonce = faker.string.uuid();

        // Create two valid SD-JWTs
        const sdJwt1 = await createSdJwt({ vct: "Credential1" }, [], {
          holderPublicJwk: holderKeyPair,
        });
        const sdJwt2 = await createSdJwt({ vct: "Credential2" }, [], {
          holderPublicJwk: holderKeyPair,
        });
        const kbJwt1 = await issueJwt({ alg: "ES256" }, { nonce }, holderKeyPair);
        const kbJwt2 = await issueJwt({ alg: "ES256" }, { nonce }, holderKeyPair);

        const vpToken = {
          [credentialQueryId]: [sdJwt1 + kbJwt1, sdJwt2 + kbJwt2],
        };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce,
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          { verificationCallback: createMockVerificationCallback(true) },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          const credentials =
            result.payload.verificationResult!.credentials[credentialQueryId];
          assert.equal(credentials.length, 2);
          assert.equal(credentials[0].status, "verified");
          assert.equal(credentials[1].status, "verified");
        }
      });
    });

    describe("異常系", () => {
      it("should return invalid status when key binding JWT is missing", async () => {
        const requestId = faker.string.uuid();
        const nonce = faker.string.uuid();

        // Create SD-JWT without KB-JWT
        const sdJwt = await createSdJwt(
          { vct: "TestCredential" },
          [],
          { holderPublicJwk: holderKeyPair },
        );

        const vpToken = {
          [credentialQueryId]: [sdJwt], // No KB-JWT appended
        };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce,
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          { verificationCallback: createMockVerificationCallback(true) },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          const credentials =
            result.payload.verificationResult!.credentials[credentialQueryId];
          assert.equal(credentials.length, 1);
          assert.equal(credentials[0].status, "invalid");
          if (credentials[0].status === "invalid") {
            assert.equal(credentials[0].error, "nonce_mismatch");
          }
        }
      });

      it("should return invalid status when nonce mismatch", async () => {
        const requestId = faker.string.uuid();
        const expectedNonce = faker.string.uuid();
        const wrongNonce = "wrong-nonce-value";

        const sdJwt = await createSdJwt(
          { vct: "TestCredential" },
          [],
          { holderPublicJwk: holderKeyPair },
        );
        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce: wrongNonce }, // Wrong nonce
          holderKeyPair,
        );

        const vpToken = {
          [credentialQueryId]: [sdJwt + kbJwt],
        };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce: expectedNonce, // Different from KB-JWT nonce
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          { verificationCallback: createMockVerificationCallback(true) },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          const credentials =
            result.payload.verificationResult!.credentials[credentialQueryId];
          assert.equal(credentials.length, 1);
          assert.equal(credentials[0].status, "invalid");
          if (credentials[0].status === "invalid") {
            assert.equal(credentials[0].error, "nonce_mismatch");
          }
        }
      });

      it("should return invalid status when callback verification fails", async () => {
        const requestId = faker.string.uuid();
        const nonce = faker.string.uuid();

        const sdJwt = await createSdJwt(
          { vct: "TestCredential" },
          [],
          { holderPublicJwk: holderKeyPair },
        );
        const kbJwt = await issueJwt({ alg: "ES256" }, { nonce }, holderKeyPair);

        const vpToken = {
          [credentialQueryId]: [sdJwt + kbJwt],
        };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce,
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          {
            verificationCallback: createMockVerificationCallback(
              false,
              "SD-JWT signature verification failed",
            ),
          },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          const credentials =
            result.payload.verificationResult!.credentials[credentialQueryId];
          assert.equal(credentials.length, 1);
          assert.equal(credentials[0].status, "invalid");
          if (credentials[0].status === "invalid") {
            assert.equal(
              credentials[0].error,
              "SD-JWT signature verification failed",
            );
          }
        }
      });

      it("should return not_found status when credential array is empty", async () => {
        const requestId = faker.string.uuid();
        const nonce = faker.string.uuid();

        const vpToken = {
          [credentialQueryId]: [], // Empty array
        };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce,
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          { verificationCallback: createMockVerificationCallback(true) },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          const credentials =
            result.payload.verificationResult!.credentials[credentialQueryId];
          assert.equal(credentials.length, 1);
          assert.equal(credentials[0].status, "not_found");
        }
      });
    });

    describe("エッジケース", () => {
      it("should not perform verification when verificationCallback is not provided", async () => {
        const requestId = faker.string.uuid();
        const vpToken = { [credentialQueryId]: ["dummy-token"] };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce: faker.string.uuid(),
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          // No verificationCallback provided
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          // verificationResult should be undefined when no callback is provided
          assert.isUndefined(result.payload.verificationResult);
        }
      });

      it("should not perform verification when nonce is not set in request", async () => {
        const requestId = faker.string.uuid();

        const sdJwt = await createSdJwt({ vct: "Test" }, [], {
          holderPublicJwk: holderKeyPair,
        });
        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce: "some-nonce" },
          holderKeyPair,
        );
        const vpToken = { [credentialQueryId]: [sdJwt + kbJwt] };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            // nonce is not set
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          { verificationCallback: createMockVerificationCallback(true) },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          // verificationResult should be undefined when nonce is not set
          assert.isUndefined(result.payload.verificationResult);
        }
      });

      it("should handle mixed verification results (some verified, some invalid)", async () => {
        const requestId = faker.string.uuid();
        const nonce = faker.string.uuid();
        const wrongNonce = "wrong-nonce";

        // First credential with correct nonce
        const sdJwt1 = await createSdJwt({ vct: "Valid" }, [], {
          holderPublicJwk: holderKeyPair,
        });
        const kbJwt1 = await issueJwt({ alg: "ES256" }, { nonce }, holderKeyPair);

        // Second credential with wrong nonce
        const sdJwt2 = await createSdJwt({ vct: "Invalid" }, [], {
          holderPublicJwk: holderKeyPair,
        });
        const kbJwt2 = await issueJwt(
          { alg: "ES256" },
          { nonce: wrongNonce },
          holderKeyPair,
        );

        const vpToken = {
          [credentialQueryId]: [sdJwt1 + kbJwt1, sdJwt2 + kbJwt2],
        };

        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async () => ({
            id: requestId,
            nonce,
            responseType: "vp_token",
            issuedAt: Date.now() / 1000,
            expiredIn: 600,
          }),
          saveResponse: async () => {},
        };

        const responseEndpoint = initResponseEndpoint(ds);
        const result = await responseEndpoint.receiveAuthResponse(
          { state: requestId, vp_token: vpToken },
          { verificationCallback: createMockVerificationCallback(true) },
        );

        assert.isTrue(result.ok);
        if (result.ok) {
          const credentials =
            result.payload.verificationResult!.credentials[credentialQueryId];
          assert.equal(credentials.length, 2);
          assert.equal(credentials[0].status, "verified");
          assert.equal(credentials[1].status, "invalid");
          if (credentials[1].status === "invalid") {
            assert.equal(credentials[1].error, "nonce_mismatch");
          }
        }
      });
    });
  });
});
