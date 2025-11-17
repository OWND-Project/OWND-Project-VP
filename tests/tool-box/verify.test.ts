import { assert } from "chai";
import { createKeyPair } from "../test-utils.js";
import { publicJwkFromPrivate } from "elliptic-jwk";
import { issueJwt } from "../../src/helpers/jwt-helper.js";
import { verifyJwt } from "../../src/tool-box/verify.js";

interface TestCredential {
  foo: { bar: string };
}
describe("Verify@ToolBox", () => {
  const issuerKeyPair1 = createKeyPair();
  const issuerKeyPair2 = createKeyPair();
  const credential = {
    foo: { bar: "baz" },
  };
  describe("#verifyJwt", () => {
    const header = {
      alg: "ES256",
      jwk: publicJwkFromPrivate(issuerKeyPair1),
    };
    describe("valid key", () => {
      beforeEach(async () => {});
      it("should verify successfully", async () => {
        const jwt = await issueJwt(header, credential, issuerKeyPair1);
        const result = await verifyJwt<TestCredential>(jwt);
        if (result.ok) {
          const { foo } = result.payload;
          assert.equal(foo.bar, "baz");
        } else {
          assert.fail("should be verified");
        }
      });
    });
    describe("wrong key", () => {
      it("should verify successfully", async () => {
        const jwt = await issueJwt(header, credential, issuerKeyPair2);
        const result = await verifyJwt<TestCredential>(jwt);
        if (result.ok) {
          assert.fail("should not be verified");
        }
      });
    });
  });
});
