import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import {
  initResponseEndpoint,
  VpRequest,
  AuthResponse,
  ResponseEndpointDatastore,
} from "../../src/oid4vp/response-endpoint.js";
import { CompactEncrypt, importJWK } from "jose";
import { generateEphemeralKeyPair } from "../../src/helpers/jwt-helper.js";

describe("Response Endpoint - Encryption Error Handling", () => {
  let responseEndpoint: ReturnType<typeof initResponseEndpoint>;
  let mockDatastore: ResponseEndpointDatastore;
  let savedRequests: Map<string, VpRequest>;

  beforeEach(async () => {
    savedRequests = new Map();

    mockDatastore = {
      saveRequest: async (request: VpRequest) => {
        savedRequests.set(request.id, request);
      },
      getRequest: async (requestId: string): Promise<VpRequest | null> => {
        return savedRequests.get(requestId) || null;
      },
      saveResponse: async (response: AuthResponse) => {
        // Mock implementation
      },
      getResponse: async (responseCode: string): Promise<AuthResponse | null> => {
        return null;
      },
    };

    responseEndpoint = initResponseEndpoint(mockDatastore);
  });

  describe("Encrypted response with invalid kid", () => {
    it("should reject encrypted response when request not found", async () => {
      const { publicJwk } = await generateEphemeralKeyPair();
      const publicKey = await importJWK(publicJwk, "ECDH-ES");

      const payload = { vp_token: { test: ["data"] } };
      const jwe = await new CompactEncrypt(
        new TextEncoder().encode(JSON.stringify(payload)),
      )
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A128GCM",
          kid: publicJwk.kid,
        })
        .encrypt(publicKey);

      const result = await responseEndpoint.receiveAuthResponse({
        response: jwe,
        state: "non-existent-request-id",
      });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.error.type).to.equal("REQUEST_ID_IS_NOT_FOUND");
      }
    });
  });

  describe("Encrypted response without encryption key", () => {
    it("should reject encrypted response when request has no encryption key", async () => {
      // Create request without encryption
      const request = await responseEndpoint.initiateTransaction({
        responseType: "vp_token",
        enableEncryption: false, // No encryption key generated
      });

      const { publicJwk } = await generateEphemeralKeyPair();
      const publicKey = await importJWK(publicJwk, "ECDH-ES");

      const payload = { vp_token: { test: ["data"] } };
      const jwe = await new CompactEncrypt(
        new TextEncoder().encode(JSON.stringify(payload)),
      )
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A128GCM",
          kid: publicJwk.kid,
        })
        .encrypt(publicKey);

      const result = await responseEndpoint.receiveAuthResponse({
        response: jwe,
        state: request.id,
      });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.error.type).to.equal("INVALID_AUTH_RESPONSE_PAYLOAD");
      }
    });
  });

  describe("Malformed JWE", () => {
    it("should reject malformed JWE string", async () => {
      const request = await responseEndpoint.initiateTransaction({
        responseType: "vp_token",
        enableEncryption: true,
      });

      const malformedJwe = "not.a.valid.jwe.string";

      const result = await responseEndpoint.receiveAuthResponse({
        response: malformedJwe,
        state: request.id,
      });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.error.type).to.equal("INVALID_AUTH_RESPONSE_PAYLOAD");
      }
    });
  });

  describe("Missing state parameter", () => {
    it("should reject encrypted response without state parameter", async () => {
      const { publicJwk } = await generateEphemeralKeyPair();
      const publicKey = await importJWK(publicJwk, "ECDH-ES");

      const payload = { vp_token: { test: ["data"] } };
      const jwe = await new CompactEncrypt(
        new TextEncoder().encode(JSON.stringify(payload)),
      )
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A128GCM",
          kid: publicJwk.kid,
        })
        .encrypt(publicKey);

      const result = await responseEndpoint.receiveAuthResponse({
        response: jwe,
        // state is missing
      });

      expect(result.ok).to.be.false;
      if (!result.ok) {
        expect(result.error.type).to.equal("INVALID_AUTH_RESPONSE_PAYLOAD");
      }
    });
  });

  describe("Successful encrypted response", () => {
    it("should successfully decrypt and process encrypted response", async () => {
      // Create request with encryption enabled
      const request = await responseEndpoint.initiateTransaction({
        responseType: "vp_token",
        enableEncryption: true,
      });

      // Get the public key and encrypt the response
      const publicJwk = JSON.parse(request.encryptionPublicJwk!);
      const publicKey = await importJWK(publicJwk, "ECDH-ES");

      const payload = {
        vp_token: {
          test_credential: ["eyJhbGci...test-sd-jwt"],
        },
      };

      const jwe = await new CompactEncrypt(
        new TextEncoder().encode(JSON.stringify(payload)),
      )
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A128GCM",
          kid: publicJwk.kid,
        })
        .encrypt(publicKey);

      const result = await responseEndpoint.receiveAuthResponse({
        response: jwe,
        state: request.id,
      });

      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.payload.responseCode).to.exist;
      }
    });
  });
});
