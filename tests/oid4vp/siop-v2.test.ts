import { createIdToken, createKeyPair } from "../test-utils.js";
import siopv2 from "../../src/oid4vp/siop-v2.js";
import { toJwkThumbprintUri } from "../../src/oid4vp/jwk-util.js";
import { assert } from "chai";
import { publicJwkFromPrivate } from "elliptic-jwk";

describe("SIOP-V2", () => {
  describe("#getIdToken", () => {
    it("should be success", async () => {
      // prepare
      const keyPair = createKeyPair("secp256k1");
      const idToken = await createIdToken({ privateJwk: keyPair });
      const jwk = publicJwkFromPrivate(keyPair);
      const sub = await toJwkThumbprintUri(jwk);

      // execute
      const getIdToken = await siopv2.getIdToken(idToken);

      // assert
      if (getIdToken.ok) {
        const { idToken: __idToken } = getIdToken.payload;
        assert.equal(__idToken.sub, sub);
      } else {
        assert.fail("should be ok");
      }
    });
  });
});
