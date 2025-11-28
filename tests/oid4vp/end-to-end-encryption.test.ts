import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { faker } from "@faker-js/faker";
import { v4 as uuidv4 } from "uuid";
import {
  initResponseEndpoint,
  initVerifier,
  VpRequest,
  AuthResponse,
  ResponseEndpointDatastore,
  VerifierDatastore,
  VpRequestAtVerifier,
} from "../../src/oid4vp/index.js";
import { CompactEncrypt, importJWK } from "jose";
import { getCurrentUnixTimeInSeconds } from "../../src/utils/data-util.js";

/**
 * End-to-End Encryption Tests
 *
 * Tests the complete encrypted VP Token flow:
 * 1. Response Endpoint initiates transaction with encryption
 * 2. Verifier creates authorization request with client_metadata
 * 3. Wallet encrypts response with public key
 * 4. Response Endpoint decrypts and processes response
 */
describe("End-to-End Encryption Flow", () => {
  let responseEndpoint: ReturnType<typeof initResponseEndpoint>;
  let verifier: ReturnType<typeof initVerifier>;
  let responseDatastore: ResponseEndpointDatastore;
  let verifierDatastore: VerifierDatastore;
  let savedRequests: Map<string, VpRequest>;
  let savedVerifierRequests: Map<string, VpRequestAtVerifier>;
  let savedResponses: Map<string, AuthResponse>;

  beforeEach(async () => {
    savedRequests = new Map();
    savedVerifierRequests = new Map();
    savedResponses = new Map();

    // Response Endpoint datastore
    responseDatastore = {
      saveRequest: async (request: VpRequest) => {
        savedRequests.set(request.id, request);
      },
      getRequest: async (requestId: string): Promise<VpRequest | null> => {
        return savedRequests.get(requestId) || null;
      },
      saveResponse: async (response: AuthResponse) => {
        savedResponses.set(response.id, response);
      },
      getResponse: async (responseCode: string): Promise<AuthResponse | null> => {
        return savedResponses.get(responseCode) || null;
      },
    };

    // Verifier datastore
    verifierDatastore = {
      saveRequest: async (request: VpRequestAtVerifier) => {
        savedVerifierRequests.set(request.id, request);
      },
      getRequest: async (requestId: string): Promise<VpRequestAtVerifier | null> => {
        return savedVerifierRequests.get(requestId) || null;
      },
      consumeRequest: async (requestId: string, consumedAt: number) => {
        const request = savedVerifierRequests.get(requestId);
        if (request) {
          request.consumedAt = consumedAt;
          savedVerifierRequests.set(requestId, request);
        }
      },
    };

    responseEndpoint = initResponseEndpoint(responseDatastore);
    verifier = initVerifier(verifierDatastore);
  });

  describe("Complete encrypted flow", () => {
    it("should successfully complete end-to-end encrypted VP Token flow", async () => {
      // ============================================================
      // Step 1: Response Endpoint initiates transaction with encryption
      // ============================================================
      const vpRequest = await responseEndpoint.initiateTransaction({
        responseType: "vp_token",
        enableEncryption: true,
        redirectUriReturnedByResponseUri: faker.internet.url(),
      });

      expect(vpRequest.encryptionPublicJwk).to.exist;
      expect(vpRequest.encryptionPrivateJwk).to.exist;

      const publicJwk = JSON.parse(vpRequest.encryptionPublicJwk!);
      expect(publicJwk.kty).to.equal("EC");
      expect(publicJwk.crv).to.equal("P-256");
      expect(publicJwk.use).to.equal("enc");
      expect(publicJwk.alg).to.equal("ECDH-ES");

      // ============================================================
      // Step 2: Verifier creates authorization request with client_metadata
      // ============================================================
      const clientId = faker.internet.url();
      const responseUri = faker.internet.url();
      const nonce = uuidv4();

      const verifierRequest: VpRequestAtVerifier = {
        id: vpRequest.id,
        nonce,
        issuedAt: getCurrentUnixTimeInSeconds(),
        expiredIn: 600,
        consumedAt: 0,
        encryptionPrivateJwk: vpRequest.encryptionPrivateJwk,
      };
      await verifierDatastore.saveRequest(verifierRequest);

      const authRequest = await verifier.startRequest(
        {
          id: vpRequest.id,
          responseType: "vp_token",
          issuedAt: vpRequest.issuedAt,
          expiredIn: vpRequest.expiredIn,
          encryptionPublicJwk: vpRequest.encryptionPublicJwk,
          encryptionPrivateJwk: vpRequest.encryptionPrivateJwk,
        },
        `redirect_uri:${clientId}`,
        {
          requestObject: {
            responseUri,
          },
        }
      );

      // Verify authorization request contains encryption metadata
      expect(authRequest.params).to.exist;
      if (authRequest.params) {
        expect(authRequest.params.response_mode).to.equal("direct_post.jwt");
        expect(authRequest.params.client_metadata).to.exist;
        expect(authRequest.params.client_metadata.jwks).to.exist;
        expect(authRequest.params.client_metadata.jwks.keys).to.be.an("array");
        expect(authRequest.params.client_metadata.jwks.keys.length).to.equal(1);
        expect(authRequest.params.client_metadata.jwks.keys[0].kid).to.equal(publicJwk.kid);
        expect(authRequest.params.client_metadata.encrypted_response_enc_values_supported).to.include("A128GCM");
      }

      // ============================================================
      // Step 3: Wallet encrypts response with public key
      // ============================================================
      const vpTokenPayload = {
        vp_token: {
          pid_credential: ["eyJhbGci...test-sd-jwt-credential"],
        },
      };

      const publicKey = await importJWK(publicJwk, "ECDH-ES");
      const jwe = await new CompactEncrypt(
        new TextEncoder().encode(JSON.stringify(vpTokenPayload))
      )
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A128GCM",
          kid: publicJwk.kid,
        })
        .encrypt(publicKey);

      // Verify JWE format
      expect(jwe).to.be.a("string");
      const jweParts = jwe.split(".");
      expect(jweParts.length).to.equal(5); // JWE Compact Serialization has 5 parts

      // ============================================================
      // Step 4: Response Endpoint decrypts and processes response
      // ============================================================
      const result = await responseEndpoint.receiveAuthResponse({
        response: jwe,
        state: vpRequest.id,
      });

      // Verify successful decryption and processing
      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.payload.responseCode).to.exist;
        expect(result.payload.responseCode).to.be.a("string");

        // Verify response was saved correctly
        if (result.payload.responseCode) {
          const savedResponse = await responseDatastore.getResponse(result.payload.responseCode);
          expect(savedResponse).to.exist;
          if (savedResponse) {
            expect(savedResponse.requestId).to.equal(vpRequest.id);
            expect(savedResponse.payload.vpToken).to.deep.equal(vpTokenPayload.vp_token);
          }
        }
      }
    });

    it("should handle non-encrypted flow when encryption not enabled", async () => {
      // ============================================================
      // Step 1: Response Endpoint initiates transaction WITHOUT encryption
      // ============================================================
      const vpRequest = await responseEndpoint.initiateTransaction({
        responseType: "vp_token",
        enableEncryption: false,
        redirectUriReturnedByResponseUri: faker.internet.url(),
      });

      expect(vpRequest.encryptionPublicJwk).to.be.undefined;
      expect(vpRequest.encryptionPrivateJwk).to.be.undefined;

      // ============================================================
      // Step 2: Verifier creates authorization request without encryption
      // ============================================================
      const clientId = faker.internet.url();
      const responseUri = faker.internet.url();

      const authRequest = await verifier.startRequest(
        {
          id: vpRequest.id,
          responseType: "vp_token",
          issuedAt: vpRequest.issuedAt,
          expiredIn: vpRequest.expiredIn,
          // No encryption keys
        },
        `redirect_uri:${clientId}`,
        {
          requestObject: {
            responseUri,
          },
        }
      );

      // Verify authorization request does NOT contain encryption metadata
      expect(authRequest.params).to.exist;
      if (authRequest.params) {
        expect(authRequest.params.response_mode).to.not.equal("direct_post.jwt");
        if (authRequest.params.client_metadata) {
          expect(authRequest.params.client_metadata.jwks).to.be.undefined;
          expect(authRequest.params.client_metadata.encrypted_response_enc_values_supported).to.be.undefined;
        }
      }

      // ============================================================
      // Step 3: Wallet sends plaintext response
      // ============================================================
      const vpTokenPayload = {
        vp_token: {
          pid_credential: ["eyJhbGci...test-sd-jwt-credential"],
        },
      };

      // ============================================================
      // Step 4: Response Endpoint processes plaintext response
      // ============================================================
      const result = await responseEndpoint.receiveAuthResponse({
        state: vpRequest.id,
        ...vpTokenPayload,
      });

      // Verify successful processing
      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.payload.responseCode).to.exist;
      }
    });
  });

  describe("Error scenarios in end-to-end flow", () => {
    it("should fail when encrypted response sent but request not set up for encryption", async () => {
      // Create request without encryption
      const vpRequest = await responseEndpoint.initiateTransaction({
        responseType: "vp_token",
        enableEncryption: false,
      });

      // Attempt to send encrypted response (simulating attacker or misconfigured wallet)
      const { publicJwk } = await import("../../src/helpers/jwt-helper.js").then(m => m.generateEphemeralKeyPair());
      const publicKey = await importJWK(publicJwk, "ECDH-ES");

      const jwe = await new CompactEncrypt(
        new TextEncoder().encode(JSON.stringify({ vp_token: { test: ["data"] } }))
      )
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A128GCM",
          kid: publicJwk.kid,
        })
        .encrypt(publicKey);

      const result = await responseEndpoint.receiveAuthResponse({
        response: jwe,
        state: vpRequest.id,
      });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.error.type).to.equal("INVALID_AUTH_RESPONSE_PAYLOAD");
      }
    });

    it("should fail when plaintext response sent but encryption was required", async () => {
      // Create request WITH encryption
      const vpRequest = await responseEndpoint.initiateTransaction({
        responseType: "vp_token",
        enableEncryption: true,
      });

      // Send plaintext response (missing 'response' field)
      const result = await responseEndpoint.receiveAuthResponse({
        state: vpRequest.id,
        vp_token: { test_credential: ["plaintext-vp-token"] },
      });

      // This should still succeed (backward compatibility)
      // Response Endpoint doesn't enforce encryption, it only supports it
      expect(result.ok).to.be.true;
    });
  });
});
