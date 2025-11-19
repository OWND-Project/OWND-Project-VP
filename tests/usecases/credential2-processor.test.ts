import { assert } from "chai";
import { faker } from "@faker-js/faker";

import { extractCredentialFromVpToken } from "../../src/usecases/internal/credential2-processor.js";
import { createKeyPair, createSdJwt } from "../test-utils.js";
import { issueJwt } from "../../src/helpers/jwt-helper.js";

describe("credential2-processor", () => {
  describe("#extractCredentialFromVpToken", () => {
    const credentialQueryId = "learning_credential";
    let nonce: string;
    let holderKeyPair: any;

    beforeEach(() => {
      nonce = faker.string.uuid();
      holderKeyPair = createKeyPair();
    });

    describe("正常系", () => {
      it("should extract SD-JWT credential from DCQL VP Token", async () => {
        // Prepare: Create SD-JWT with key binding (following post-comment.ts pattern)
        const claims = {
          vct: "urn:eu.europa.ec.eudi:learning:credential:1",
          issuing_authority: "Technical University of Munich",
          issuing_country: "DE",
          date_of_issuance: "2025-09-15",
          family_name: "Smith",
          given_name: "John",
          achievement_title: "Foundations of Applied AI in Business",
        };
        const disclosures = ["family_name", "given_name"];

        const sdJwt = await createSdJwt(claims, disclosures, {
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

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isTrue(result.ok);
        if (result.ok) {
          assert.isDefined(result.payload.learningCredential);
          assert.equal(result.payload.learningCredential, sdJwt + kbJwt);
        }
      });

      it("should return undefined when credential query ID not found", async () => {
        // Prepare: VP Token without the requested credential
        const vpToken = {
          other_credential: ["dummy-token"],
        };

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isTrue(result.ok);
        if (result.ok) {
          assert.isUndefined(result.payload.learningCredential);
        }
      });

      it("should return undefined when presentations array is empty", async () => {
        // Prepare: Empty presentations array
        const vpToken = {
          [credentialQueryId]: [],
        };

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isTrue(result.ok);
        if (result.ok) {
          assert.isUndefined(result.payload.learningCredential);
        }
      });
    });

    describe("異常系", () => {
      it("should fail when key binding JWT is missing", async () => {
        // Prepare: SD-JWT without key binding JWT
        const claims = {
          vct: "urn:eu.europa.ec.eudi:learning:credential:1",
          issuing_authority: "Test University",
          issuing_country: "DE",
          date_of_issuance: "2025-09-15",
          family_name: "Doe",
          given_name: "Jane",
          achievement_title: "Test Course",
        };
        const sdJwt = await createSdJwt(claims, ["family_name", "given_name"], {
          holderPublicJwk: holderKeyPair,
        });

        const vpToken = {
          [credentialQueryId]: [sdJwt], // No KB-JWT appended
        };

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isFalse(result.ok);
        if (!result.ok) {
          assert.equal(result.error.type, "INVALID_PARAMETER");
        }
      });

      it("should fail when nonce mismatch", async () => {
        // Prepare: SD-JWT with wrong nonce in KB-JWT
        const claims = {
          vct: "urn:eu.europa.ec.eudi:learning:credential:1",
          issuing_authority: "Test University",
          issuing_country: "DE",
          date_of_issuance: "2025-09-15",
          family_name: "Doe",
          given_name: "Jane",
          achievement_title: "Test Course",
        };
        const sdJwt = await createSdJwt(claims, ["family_name", "given_name"], {
          holderPublicJwk: holderKeyPair,
        });

        const wrongNonce = "wrong-nonce-value";
        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce: wrongNonce },
          holderKeyPair,
        );

        const vpToken = {
          [credentialQueryId]: [sdJwt + kbJwt],
        };

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce, // Different from wrongNonce
        );

        // Assert
        assert.isFalse(result.ok);
        if (!result.ok) {
          assert.equal(result.error.type, "INVALID_PARAMETER");
        }
      });

      it("should fail when SD-JWT signature verification fails", async () => {
        // Prepare: Invalid SD-JWT (tampered)
        const claims = {
          vct: "urn:eu.europa.ec.eudi:learning:credential:1",
          issuing_authority: "Test University",
          issuing_country: "DE",
          date_of_issuance: "2025-09-15",
          family_name: "Doe",
          given_name: "Jane",
          achievement_title: "Test Course",
        };
        const sdJwt = await createSdJwt(claims, ["family_name", "given_name"], {
          holderPublicJwk: holderKeyPair,
        });

        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce },
          holderKeyPair,
        );

        // Tamper with the SD-JWT (change a character in the middle)
        const tamperedSdJwt = sdJwt.slice(0, 50) + "X" + sdJwt.slice(51);

        const vpToken = {
          [credentialQueryId]: [tamperedSdJwt + kbJwt],
        };

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isFalse(result.ok);
        if (!result.ok) {
          assert.equal(result.error.type, "INVALID_PARAMETER");
        }
      });

      it("should fail when VP Token contains invalid SD-JWT format", async () => {
        // Prepare: Invalid token (not a valid SD-JWT)
        const vpToken = {
          [credentialQueryId]: ["not-a-valid-sd-jwt-token"],
        };

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isFalse(result.ok);
        if (!result.ok) {
          assert.equal(result.error.type, "INVALID_PARAMETER");
        }
      });
    });

    describe("エッジケース", () => {
      it("should handle multiple credentials in VP Token (extract first)", async () => {
        // Prepare: Multiple credentials
        const claims1 = { vct: "Credential1" };
        const claims2 = { vct: "Credential2" };

        const sdJwt1 = await createSdJwt(claims1, [], {
          holderPublicJwk: holderKeyPair,
        });
        const sdJwt2 = await createSdJwt(claims2, [], {
          holderPublicJwk: holderKeyPair,
        });

        const kbJwt1 = await issueJwt(
          { alg: "ES256" },
          { nonce },
          holderKeyPair,
        );
        const kbJwt2 = await issueJwt(
          { alg: "ES256" },
          { nonce },
          holderKeyPair,
        );

        const vpToken = {
          [credentialQueryId]: [sdJwt1 + kbJwt1, sdJwt2 + kbJwt2],
        };

        // Execute (should extract first credential)
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isTrue(result.ok);
        if (result.ok) {
          assert.equal(result.payload.learningCredential, sdJwt1 + kbJwt1);
        }
      });

      it("should handle empty VP Token object", async () => {
        // Prepare: Empty VP Token
        const vpToken = {};

        // Execute
        const result = await extractCredentialFromVpToken(
          vpToken,
          credentialQueryId,
          nonce,
        );

        // Assert
        assert.isTrue(result.ok);
        if (result.ok) {
          assert.isUndefined(result.payload.learningCredential);
        }
      });
    });
  });
});
