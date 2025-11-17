import { assert } from "chai";
import {
  createClaim,
  createClaimer,
  createClaimPayload,
  createUrl,
  getClaimJwt,
} from "../test-utils.js";
import { ClaimDocument } from "../../src/usecases/types.js";
import {
  aggregateClaims,
  sortUrls,
} from "../../src/usecases/internal/internal-helpers.js";

const _getClaim = (claimJwt: string) => {
  return createClaim({ comment: claimJwt });
};

const getPayload = (boolValue: number) => {
  return createClaimPayload({ boolValue });
};

describe("Helpers", () => {
  describe("#aggregateClaims", () => {
    describe("single data", () => {
      it("should count up true value", async () => {
        const claimJwt = await getClaimJwt(getPayload(1));
        const claim: ClaimDocument = _getClaim(claimJwt);
        const ret = aggregateClaims([claim]);

        assert.equal(ret.true_count, 1);
        assert.equal(ret.false_count, 0);
        assert.equal(ret.else_count, 0);
      });
      it("should count up false value", async () => {
        const claimJwt = await getClaimJwt(getPayload(0));
        const claim: ClaimDocument = _getClaim(claimJwt);
        const ret = aggregateClaims([claim]);

        assert.equal(ret.true_count, 0);
        assert.equal(ret.false_count, 1);
        assert.equal(ret.else_count, 0);
      });
      it("should count up else value", async () => {
        const claimJwt = await getClaimJwt(getPayload(2));
        const claim: ClaimDocument = _getClaim(claimJwt);
        const ret = aggregateClaims([claim]);

        assert.equal(ret.true_count, 0);
        assert.equal(ret.false_count, 0);
        assert.equal(ret.else_count, 1);
      });
      it("should not count up any value", async () => {
        const notHavingMeaningValue = 3;
        const claimJwt = await getClaimJwt(getPayload(notHavingMeaningValue));
        const claim: ClaimDocument = _getClaim(claimJwt);
        const ret = aggregateClaims([claim]);

        assert.equal(ret.true_count, 0);
        assert.equal(ret.false_count, 0);
        assert.equal(ret.else_count, 0);
      });
    });
    describe("multiple data", () => {
      it("should count up true value", async () => {
        const claimJwt1 = await getClaimJwt(getPayload(1));
        const claim1: ClaimDocument = _getClaim(claimJwt1);

        const claimJwt2 = await getClaimJwt(getPayload(1));
        const claim2: ClaimDocument = _getClaim(claimJwt2);

        const claimJwt3 = await getClaimJwt(getPayload(1));
        const claim3: ClaimDocument = _getClaim(claimJwt3);

        const claimJwt4 = await getClaimJwt(getPayload(0));
        const claim4: ClaimDocument = _getClaim(claimJwt4);

        const claimJwt5 = await getClaimJwt(getPayload(0));
        const claim5: ClaimDocument = _getClaim(claimJwt5);

        const claimJwt6 = await getClaimJwt(getPayload(2));
        const claim6: ClaimDocument = _getClaim(claimJwt6);

        const ret = aggregateClaims([
          claim1,
          claim2,
          claim3,
          claim4,
          claim5,
          claim6,
        ]);

        assert.equal(ret.true_count, 3);
        assert.equal(ret.false_count, 2);
        assert.equal(ret.else_count, 1);
      });
    });
  });
  describe("#sortUrls", () => {
    const dt = new Date();
    const dt2 = new Date(dt.getTime() + 1000);
    const newUrl = createUrl({ created_at: dt.toISOString() });
    const newUrl2 = createUrl({ created_at: dt2.toISOString() });
    const newClaimer = createClaimer();
    describe("sort key is created_at", () => {
      it("should sort by created_at (default)", async () => {
        const urls = [newUrl, newUrl2];
        sortUrls(urls, [], {});
        assert.equal(urls[0].id, newUrl2.id);
        assert.equal(urls[1].id, newUrl.id);
      });
      it("should sort by created_at (asc)", async () => {
        const urls = [newUrl, newUrl2];
        sortUrls(urls, [], { sortKey: "created_at" });
        assert.equal(urls[0].id, newUrl.id);
        assert.equal(urls[1].id, newUrl2.id);
      });
      it("should sort by created_at (desc)", async () => {
        const urls = [newUrl, newUrl2];
        sortUrls(urls, [], { sortKey: "created_at", desc: true });
        assert.equal(urls[0].id, newUrl2.id);
        assert.equal(urls[1].id, newUrl.id);
      });
    });
    describe("sort key is true count", () => {
      let newClaim11: ClaimDocument;
      let newClaim21: ClaimDocument;
      describe("data pattern 1", () => {
        /*
                /urls
                  /url1(old)
                    /claim11(true)
                  /url2(new)
                    /claim21(false)
               */
        beforeEach(async () => {
          const claimJwt = await getClaimJwt(getPayload(1));
          newClaim11 = createClaim({
            url: newUrl.url,
            claimer_id: newClaimer.id,
            comment: claimJwt,
          });
          const claimJwt2 = await getClaimJwt(getPayload(0));
          newClaim21 = createClaim({
            url: newUrl2.url,
            claimer_id: newClaimer.id,
            comment: claimJwt2,
          });
        });
        it("should sort by true_count (desc)", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "true_count",
            desc: true,
          });
          assert.equal(urls[0].id, newUrl.id);
          assert.equal(urls[1].id, newUrl2.id);
        });
        it("should sort by true_count (asc)", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "true_count",
          });
          assert.equal(urls[0].id, newUrl2.id);
          assert.equal(urls[1].id, newUrl.id);
        });
      });
      describe("data pattern 1", () => {
        /*
                /urls
                  /url1(old)
                    /claim11(false)
                  /url2(new)
                    /claim21(true)
               */
        beforeEach(async () => {
          const claimJwt = await getClaimJwt(getPayload(0));
          newClaim11 = createClaim({
            url: newUrl.url,
            claimer_id: newClaimer.id,
            comment: claimJwt,
          });
          const claimJwt2 = await getClaimJwt(getPayload(1));
          newClaim21 = createClaim({
            url: newUrl2.url,
            claimer_id: newClaimer.id,
            comment: claimJwt2,
          });
        });
        it("should sort by true_count (desc) 2", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "true_count",
            desc: true,
          });
          assert.equal(urls[0].id, newUrl2.id);
          assert.equal(urls[1].id, newUrl.id);
        });
        it("should sort by true_count (asc) 2", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "true_count",
          });
          assert.equal(urls[0].id, newUrl.id);
          assert.equal(urls[1].id, newUrl2.id);
        });
      });
      /*
            /urls
              /url1(old)
                /claim11(else)
              /url2(new)
                /claim21(else)
           */
      it("should sort by secondary key", async () => {
        const claimJwt = await getClaimJwt(getPayload(2));
        const newClaim11 = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          comment: claimJwt,
        });
        const claimJwt2 = await getClaimJwt(getPayload(2));
        const newClaim21 = createClaim({
          url: newUrl2.url,
          claimer_id: newClaimer.id,
          comment: claimJwt2,
        });
        const urls = [newUrl, newUrl2];
        const claims = [newClaim11, newClaim21];
        sortUrls(urls, claims, {
          sortKey: "true_count",
        });
        assert.equal(urls[0].id, newUrl2.id);
        assert.equal(urls[1].id, newUrl.id);
      });
    });
    describe("sort key is false count", () => {
      let newClaim11: ClaimDocument;
      let newClaim21: ClaimDocument;
      describe("data pattern 1", () => {
        /*
                /urls
                  /url1(old)
                    /claim11(true)
                  /url2(new)
                    /claim21(false)
               */
        beforeEach(async () => {
          const claimJwt = await getClaimJwt(getPayload(1));
          newClaim11 = createClaim({
            url: newUrl.url,
            claimer_id: newClaimer.id,
            comment: claimJwt,
          });
          const claimJwt2 = await getClaimJwt(getPayload(0));
          newClaim21 = createClaim({
            url: newUrl2.url,
            claimer_id: newClaimer.id,
            comment: claimJwt2,
          });
        });
        it("should sort by false_count (desc)", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "false_count",
            desc: true,
          });
          assert.equal(urls[0].id, newUrl2.id);
          assert.equal(urls[1].id, newUrl.id);
        });
        it("should sort by false_count (asc)", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "false_count",
          });
          assert.equal(urls[0].id, newUrl.id);
          assert.equal(urls[1].id, newUrl2.id);
        });
      });
      describe("data pattern 2", () => {
        /*
                /urls
                  /url1(old)
                    /claim11(false)
                  /url2(new)
                    /claim21(true)
               */
        beforeEach(async () => {
          const claimJwt = await getClaimJwt(getPayload(0));
          newClaim11 = createClaim({
            url: newUrl.url,
            claimer_id: newClaimer.id,
            comment: claimJwt,
          });
          const claimJwt2 = await getClaimJwt(getPayload(1));
          newClaim21 = createClaim({
            url: newUrl2.url,
            claimer_id: newClaimer.id,
            comment: claimJwt2,
          });
        });
        it("should sort by true_count (desc)", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "false_count",
            desc: true,
          });
          assert.equal(urls[0].id, newUrl.id);
          assert.equal(urls[1].id, newUrl2.id);
        });
        it("should sort by true_count (asc)", async () => {
          const urls = [newUrl, newUrl2];
          const claims = [newClaim11, newClaim21];
          sortUrls(urls, claims, {
            sortKey: "false_count",
          });
          assert.equal(urls[0].id, newUrl2.id);
          assert.equal(urls[1].id, newUrl.id);
        });
      });
      /*
            /urls
              /url1(old)
                /claim11(else)
              /url2(new)
                /claim21(else)
           */
      it("should sort by secondary key", async () => {
        const claimJwt = await getClaimJwt(getPayload(2));
        const newClaim11 = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          comment: claimJwt,
        });
        const claimJwt2 = await getClaimJwt(getPayload(2));
        const newClaim21 = createClaim({
          url: newUrl2.url,
          claimer_id: newClaimer.id,
          comment: claimJwt2,
        });
        const urls = [newUrl, newUrl2];
        const claims = [newClaim11, newClaim21];
        sortUrls(urls, claims, {
          sortKey: "false_count",
        });
        assert.equal(urls[0].id, newUrl2.id);
        assert.equal(urls[1].id, newUrl.id);
      });
    });
  });
});
