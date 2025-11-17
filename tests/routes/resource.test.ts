import { assert, expect } from "chai";
import Koa from "koa";
import request from "supertest";

import {
  clearDir,
  createAffiliation,
  createClaim,
  createClaimer,
  createClaimPayload,
  createIdToken,
  createSdJwt,
  createUrl,
  delay,
  generatePaths,
  generateTemporaryPath,
  getClaimJwt,
} from "../test-utils.js";
import { getDocType, init } from "../../src/api.js";
import { buildListOption } from "../../src/routes/main-routes.js";
import {
  DecodeOk,
  extractClaimerSub,
} from "../../src/usecases/internal/internal-helpers.js";
import {
  AffiliationDocument,
  ClaimDocument,
  ClaimerDocument,
  UrlDocument,
} from "../../src/usecases/types.js";
import { initMockAgent, mockHtml } from "../helpers/mock-request.js";
import { UrlHandler } from "../../src/usecases/internal/select-url.js";
import { TAG_PREFIX } from "../../src/routes/error-handler.js";
import { Docs, OpenedDocument, setupNode } from "../../src/orbit-db/index.js";
import { getLibp2pOptions } from "../../src/helpers/libp2p-helper.js";
import { generateAndSerializePeerId } from "../../src/helpers/get-peer-id.js";
import { onUpdate } from "../../src/local-data/on-update.js";
import { initClient, SqlClient } from "../../src/local-data/sqlite-client.js";
import { syncers } from "../../src/local-data/syncer.js";

const getPayload = (boolValue: number) => {
  return createClaimPayload({ boolValue });
};

const API_DOMAIN = "database";

const initBoolNode = async (
  orbitdbRootIdKey: string,
  listenAddresses: string[],
) => {
  let peerPath = generateTemporaryPath("peer", "id.bin");
  const peerId = await generateAndSerializePeerId(peerPath);

  const paths = generatePaths();
  const libp2pOptions = getLibp2pOptions({
    listenAddresses,
    peerId,
  });

  return await setupNode(libp2pOptions, {
    ...paths,
    identityKey: orbitdbRootIdKey,
  });
};

describe("Resource", () => {
  let sqliteClient: SqlClient;
  let app: Koa | undefined;
  let stopApp: () => Promise<void>;
  let docs: Docs | undefined;
  let urlDocuments: OpenedDocument;
  let claimerDocuments: OpenedDocument;
  let claimDocuments: OpenedDocument;
  let affiliationDocuments: OpenedDocument;

  const dt = new Date();
  const dt2 = new Date(dt.getTime() + 1000);
  const newUrl = createUrl({ created_at: dt.toISOString() });
  const newUrl2 = createUrl({ created_at: dt2.toISOString() });
  let newClaimer: ClaimerDocument;
  let newClaimer2: ClaimerDocument;
  let newAffiliation: AffiliationDocument;
  let newAffiliation2: AffiliationDocument;

  beforeEach(async () => {
    console.log(
      "------------------------ before@Resource ------------------------",
    );
    await clearDir();
    const dbPath = "./test.sqlite";
    process.env.DATABASE_FILEPATH = dbPath;
    sqliteClient = await initClient(dbPath);
    await sqliteClient.destroy();
    await sqliteClient.init();

    const orbitdbRootIdKey1 = "main_peer";
    const node = await initBoolNode(orbitdbRootIdKey1, [
      "/ip4/0.0.0.0/tcp/4001",
    ]);
    const __syncers = await syncers(dbPath);
    const { syncUrl, syncClaim, syncAffiliation } = __syncers;
    const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations } =
      await onUpdate({
        label: "Test",
        syncUrl,
        syncClaim,
        syncAffiliation,
      });
    const docTypes = getDocType({
      onUpdateUrls,
      onUpdateClaims,
      onUpdateAffiliations,
    });
    docs = await node.openDocuments([
      docTypes.urls,
      docTypes.claimers,
      docTypes.claims,
      docTypes.affiliates,
    ]);

    ({ app, stopApp } = await init("BOOL_NODE", { boolNode: { node, docs } }));

    urlDocuments = docs!.documents["urls"];
    claimerDocuments = docs!.documents["claimers"];
    claimDocuments = docs!.documents["claims"];
    affiliationDocuments = docs!.documents["affiliations"];

    // claimer1
    const idToken = await createIdToken();
    const sub = (extractClaimerSub(idToken) as DecodeOk).value;
    newClaimer = createClaimer({ id_token: idToken, sub });
    await claimerDocuments.document.put<ClaimerDocument>(newClaimer);

    const affiliationJwt = await createSdJwt({}, []);
    newAffiliation = createAffiliation({
      claimer_id: newClaimer.id,
      claimer_sub: sub,
      organization: affiliationJwt,
    });
    await affiliationDocuments.document.put<AffiliationDocument>(
      newAffiliation,
    );

    // claimer2
    const idToken2 = await createIdToken();
    const sub2 = (extractClaimerSub(idToken2) as DecodeOk).value;
    newClaimer2 = createClaimer({ id_token: idToken2, sub: sub2 });
    await claimerDocuments.document.put<ClaimerDocument>(newClaimer2);

    const affiliationJwt2 = await createSdJwt({}, []);
    newAffiliation2 = createAffiliation({
      claimer_id: newClaimer2.id,
      claimer_sub: sub2,
      organization: affiliationJwt2,
    });
    await affiliationDocuments.document.put<AffiliationDocument>(
      newAffiliation2,
    );
  });

  afterEach(async () => {
    console.log(
      "------------------------ after@Resource ------------------------",
    );
    if (stopApp) {
      await stopApp();
    }
    await clearDir();
    await sqliteClient.destroy();
  });

  describe("/urls", () => {
    describe("/post", () => {
      let mockAgent: ReturnType<typeof initMockAgent>;
      const url = "https://example.com";
      const newUrl = "https://new-example.com";
      let urlId = "";
      describe("conflict", () => {
        beforeEach(async () => {
          mockAgent = initMockAgent();
          mockAgent.getAccess(url, "/", mockHtml, {
            headers: { "content-type": "text/html" },
          });
          const urlHandler = UrlHandler(docs!, sqliteClient.db);
          const result = await urlHandler.newUrl(url); // for conflict test
          if (result.ok) {
            urlId = result.payload.urlDoc.id;
          }
        });
        afterEach(async () => {
          await mockAgent.close();
        });
        it("should return conflict error", async () => {
          // execute
          const response = await request(app!.callback())
            .post(`/${API_DOMAIN}/urls`)
            .send({ url });

          // assert
          assert.equal(response.status, 409);
          const error = response.body;
          assert.equal(error.type, `${TAG_PREFIX}:Conflict`);
          assert.equal(error.instance, `/database/urls/${urlId}`);
        });
      });
      describe("not found", () => {
        beforeEach(async () => {
          mockAgent = initMockAgent();
          mockAgent.getAccess(newUrl, "/", "Not Found", { statusCode: 404 });
        });
        afterEach(async () => {
          await mockAgent.close();
        });
        it("should return not found error", async () => {
          // execute
          const response = await request(app!.callback())
            .post(`/${API_DOMAIN}/urls`)
            .send({ url: newUrl });

          // assert
          assert.equal(response.status, 404);
          const error = response.body;
          assert.equal(error.type, `${TAG_PREFIX}:NotFound`);
        });
      });
      describe("bad request", () => {
        beforeEach(async () => {
          mockAgent = initMockAgent();
          mockAgent.getAccess(newUrl, "/", "Bad Request", { statusCode: 400 });
        });
        afterEach(async () => {
          await mockAgent.close();
        });
        it("should return client error -> return with no error(spec was changed)", async () => {
          const response = await request(app!.callback())
            .post(`/${API_DOMAIN}/urls`)
            .send({ url: newUrl });

          assert.equal(response.status, 200);
          // assert.equal(response.status, 400);
          // const error = response.body;
          // assert.equal(error.type, `${TAG_PREFIX}:BadRequest`);
        });
      });
      describe("server error", () => {
        beforeEach(async () => {
          mockAgent = initMockAgent();
          mockAgent.getAccess(newUrl, "/", "Internal Server Error", {
            statusCode: 500,
          });
        });
        afterEach(async () => {
          await mockAgent.close();
        });
        it("should return server error", async () => {
          mockAgent.getAccess(newUrl, "/", undefined, { statusCode: 500 });
          const response = await request(app!.callback())
            .post(`/${API_DOMAIN}/urls`)
            .send({ url: newUrl });

          // assert
          assert.equal(response.status, 500);
          const error = response.body;
          assert.equal(error.type, `${TAG_PREFIX}:UnexpectedError`);
        });
      });
      describe("ok", () => {
        beforeEach(async () => {
          mockAgent = initMockAgent();
          mockAgent.getAccess(newUrl, "/", mockHtml, {
            statusCode: 200,
            headers: { "content-type": "text/html" },
          });
        });
        afterEach(async () => {
          await mockAgent.close();
        });
        it("should return 1 url", async () => {
          const response = await request(app!.callback())
            .post(`/${API_DOMAIN}/urls`)
            .send({ url: newUrl });

          // assert
          const url = response.body;
          assert.equal(response.status, 200);
          assert.equal(url.title, "Open Graph protocol");
          assert.equal(url.true_count, 0);
          assert.equal(url.false_count, 0);
          assert.equal(url.else_count, 0);
        });
      });
    });
    describe("/get", () => {
      it("should return 2 urls", async () => {
        await urlDocuments.document.put<UrlDocument>(newUrl);
        await urlDocuments.document.put<UrlDocument>(newUrl2);
        // claim1
        const claimJwt = await getClaimJwt(getPayload(1));
        const newClaim = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt,
          created_at: dt.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim);
        // claim2
        const claimJwt2 = await getClaimJwt(getPayload(0));
        const newClaim2 = createClaim({
          url: newUrl2.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt2,
          created_at: dt2.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim2);
        await delay(100);

        // execute
        const response = await request(app!.callback()).get(
          `/${API_DOMAIN}/urls`,
        );

        // assert
        const urls = response.body;
        assert.equal(response.status, 200);
        assert.equal(urls.length, 2);
        const url = urls[0];
        assert.equal(url.id, newUrl2.id);
        assert.equal(url.true_count, 0);
        assert.equal(url.false_count, 1);
        assert.equal(url.else_count, 0);
        assert.equal(url.verified_true_count, 0);
        assert.equal(url.verified_false_count, 1);
        assert.equal(url.verified_else_count, 0);

        const url2 = urls[1];
        assert.equal(url2.id, newUrl.id);
        assert.equal(url2.verified_true_count, 1);
        assert.equal(url2.verified_false_count, 0);
        assert.equal(url2.verified_else_count, 0);
      });
    });
  });

  describe("/urls/:id/metadata", () => {
    beforeEach(async () => {
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
      await delay(100);
    });
    it("should return 404 error", async () => {
      const response = await request(app!.callback()).get(
        `/${API_DOMAIN}/urls/no-such-url.com/metadata`,
      );

      // assert
      const urls = response.body;
      assert.equal(response.status, 404);
    });
    it("should return 1 url", async () => {
      const response = await request(app!.callback()).get(
        `/${API_DOMAIN}/urls/${newUrl.id}/metadata`,
      );

      // assert
      const url = response.body;
      assert.equal(response.status, 200);
      assert.equal(url.id, newUrl.id);
    });
  });

  describe("/urls/:id", () => {
    it("should return 1 url", async () => {
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
      // claim1
      const claimJwt = await getClaimJwt(getPayload(1));
      const newClaim = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt,
        created_at: dt.toISOString(),
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim);
      // claim2
      const claimJwt2 = await getClaimJwt(getPayload(0));
      const newClaim2 = createClaim({
        url: newUrl2.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt2,
        created_at: dt2.toISOString(),
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim2);
      await delay(100);

      // execute
      const response = await request(app!.callback()).get(
        `/${API_DOMAIN}/urls/${newUrl.id}`,
      );

      // assert
      const url = response.body;
      assert.equal(response.status, 200);
      assert.equal(url.id, newUrl.id);
      assert.equal(url.url, newUrl.url);
      assert.equal(url.title, newUrl.title);
      assert.equal(url.description, newUrl.description);
      assert.equal(url.domain, newUrl.domain);
      assert.equal(url.content_type, newUrl.content_type);
      assert.equal(url.created_at, newClaim.created_at);
      assert.equal(url.true_count, 1);
      assert.equal(url.false_count, 0);
      assert.equal(url.else_count, 0);
      assert.equal(url.verified_true_count, 1);
      assert.equal(url.verified_false_count, 0);
      assert.equal(url.verified_else_count, 0);
    });
  });
  describe("/urls/:id/claims", () => {
    it("should return 2 claims", async () => {
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
      // claim1
      const claimJwt = await getClaimJwt(getPayload(1));
      const newClaim = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt,
        created_at: dt.toISOString(),
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim);
      // claim2
      const claimJwt2 = await getClaimJwt(getPayload(0));
      const newClaim2 = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer2.id,
        affiliation_id: newAffiliation2.id,
        comment: claimJwt2,
        created_at: dt2.toISOString(),
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim2);

      // execute
      const response = await request(app!.callback()).get(
        `/${API_DOMAIN}/urls/${newUrl.id}/claims`,
      );

      // assert
      const claims = response.body;
      assert.equal(response.status, 200);
      assert.equal(claims.length, 2);

      const claim1 = claims[0];
      assert.equal(claim1.id, newClaim2.id);
      assert.equal(claim1.comment, newClaim2.comment);
      assert.equal(claim1.claimer.id, newClaimer2.id);
      assert.equal(claim1.claimer.organization, newAffiliation2.organization);
      assert.equal(claim1.url.id, newUrl.id);

      const claim2 = claims[1];
      assert.equal(claim2.id, newClaim.id);
      assert.equal(claim2.comment, newClaim.comment);
      assert.equal(claim2.claimer.id, newClaimer.id);
      assert.equal(claim2.claimer.organization, newAffiliation.organization);
      assert.equal(claim2.url.id, newUrl.id);
    });
  });
  describe("/claims", () => {
    let mockAgent: ReturnType<typeof initMockAgent>;
    const newUrl = "https://new-example.com";
    describe("post", () => {
      beforeEach(async () => {
        console.log("--------------- before each@/claims/post ------------");
        mockAgent = initMockAgent();
        mockAgent.getAccess(newUrl, "/", mockHtml, {
          statusCode: 200,
          headers: { "content-type": "text/html" },
        });
      });
      afterEach(async () => {
        console.log("--------------- after each@/claims/post ------------");
        await mockAgent.close();
      });
      it("should return client error", async () => {
        // execute
        const wrongPayload = {};
        const response = await request(app!.callback())
          .post(`/${API_DOMAIN}/claims`)
          .send(wrongPayload);

        // assert
        assert.equal(response.status, 400);
        const error = response.body;
        assert.equal(error.type, `${TAG_PREFIX}:BadRequest`);
      });
      it("should return 1 url", async () => {
        // generate test data
        const id_token = await createIdToken();
        const comment = await getClaimJwt(
          createClaimPayload({ url: newUrl, boolValue: 1 }),
        );
        const affiliation = await createSdJwt({}, []);

        // execute
        const payload = { id_token, comment, affiliation };
        // execute
        let response = await request(app!.callback())
          .post(`/${API_DOMAIN}/claims`)
          .send(payload);

        // assert
        assert.equal(response.status, 201);
        let claim = response.body;
        const claimId = claim.id;
        const location = getLocation(response);
        assert.isTrue(location.endsWith(claimId));

        response = await request(app!.callback()).get(
          `/${API_DOMAIN}/claims/${claimId}`,
        );
        claim = response.body;
        assert.equal(response.status, 200);
        assert.equal(claim.comment, comment);
        assert.equal(claim.claimer.organization, affiliation);
        assert.equal(claim.url.true_count, 1);
        assert.equal(claim.url.false_count, 0);
        assert.equal(claim.url.else_count, 0);
      });
    });
  });
  describe("/claims/:id", () => {
    let id = "";
    let comment = "";
    beforeEach(async () => {
      const claimJwt = await getClaimJwt(getPayload(1));
      const newClaim = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt,
      });
      id = newClaim.id;
      comment = newClaim.comment;

      await urlDocuments.document.put<UrlDocument>(newUrl);
      await claimDocuments.document.put<ClaimDocument>(newClaim);
    });
    describe("get", () => {
      it("should return 1 claim", async () => {
        // execute
        const response = await request(app!.callback()).get(
          `/${API_DOMAIN}/claims/${id}`,
        );

        // assert
        const claim = response.body;
        assert.equal(response.status, 200);

        assert.equal(claim.id, id);
        assert.equal(claim.comment, comment);
        assert.equal(claim.claimer.id, newClaimer.id);
        assert.equal(claim.claimer.organization, newAffiliation.organization);
        assert.equal(claim.url.id, newUrl.id);
        assert.equal(claim.url.true_count, 1);
        assert.equal(claim.url.false_count, 0);
        assert.equal(claim.url.else_count, 0);
      });
    });
    describe("delete", () => {
      it("should return 401", async () => {
        // execute
        const response = await request(app!.callback()).delete(
          `/${API_DOMAIN}/claims/no-such-id`,
        );

        // assert
        assert.equal(response.status, 401);
      });
      it("should return 404", async () => {
        // execute
        const response = await request(app!.callback())
          .delete(`/${API_DOMAIN}/claims/no-such-id`)
          .set("Authorization", `Bearer ${newClaimer.id_token}`);

        // assert
        assert.equal(response.status, 404);
      });
      it("should return 204", async () => {
        // execute
        const response = await request(app!.callback())
          .delete(`/${API_DOMAIN}/claims/${id}`)
          .set("Authorization", `Bearer ${newClaimer.id_token}`);

        // assert
        assert.equal(response.status, 204);
      });
    });
  });
  describe("/claimers/:id", () => {
    it("should return 1 claim", async () => {
      // execute
      const response = await request(app!.callback()).get(
        `/${API_DOMAIN}/claimers/${newClaimer.id}`,
      );

      // assert
      const claimer = response.body;
      assert.equal(response.status, 200);

      assert.equal(claimer.id, newClaimer.id);
      assert.equal(claimer.id_token, newClaimer.id_token);
      assert.isDefined(newClaimer.sub);
      assert.isUndefined(claimer.sub);
      assert.equal(claimer.icon, newClaimer.icon);
      assert.equal(claimer.organization, newAffiliation.organization);
      assert.equal(claimer.created_at, newClaimer.created_at);
    });
  });
  describe("/claimers/:id/claims", () => {
    it("should return 2 claims", async () => {
      // generate test data
      const claimJwt = await getClaimJwt(getPayload(1));
      const newClaim = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt,
        created_at: dt.toISOString(),
      });
      const claimJwt2 = await getClaimJwt(getPayload(0));
      const newClaim2 = createClaim({
        url: newUrl2.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt2,
        created_at: dt2.toISOString(),
      });

      // register test data
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
      await claimDocuments.document.put<ClaimDocument>(newClaim);
      await claimDocuments.document.put<ClaimDocument>(newClaim2);
      await delay(100);

      // execute
      const response = await request(app!.callback()).get(
        `/${API_DOMAIN}/claimers/${newClaimer.id}/claims`,
      );

      // assert
      const claims = response.body;
      assert.equal(response.status, 200);
      assert.equal(claims.length, 2);

      const claim1 = claims[0];
      assert.equal(claim1.id, newClaim2.id);
      assert.equal(claim1.comment, newClaim2.comment);
      assert.equal(claim1.claimer.id, newClaimer.id);
      assert.equal(claim1.claimer.organization, newAffiliation.organization);
      assert.equal(claim1.url.id, newUrl2.id);

      const claim2 = claims[1];
      assert.equal(claim2.id, newClaim.id);
      assert.equal(claim2.comment, newClaim.comment);
      assert.equal(claim2.claimer.id, newClaimer.id);
      assert.equal(claim2.claimer.organization, newAffiliation.organization);
      assert.equal(claim2.url.id, newUrl.id);
    });
  });

  describe("/backup and /restore", () => {
    let id = "";
    let id2 = "";
    beforeEach(async () => {
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);

      const claimJwt = await getClaimJwt(getPayload(1));
      const newClaim = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt,
      });
      id = newClaim.id;
      await claimDocuments.document.put<ClaimDocument>(newClaim);

      const claimJwt2 = await getClaimJwt(getPayload(0));
      const newClaim2 = createClaim({
        url: newUrl2.url,
        claimer_id: newClaimer2.id,
        affiliation_id: newAffiliation2.id,
        comment: claimJwt2,
      });
      id2 = newClaim2.id;
      await claimDocuments.document.put<ClaimDocument>(newClaim2);
    });
    describe("/backup", () => {
      it("should return all data", async () => {
        const response = await request(app!.callback()).get(
          `/${API_DOMAIN}/backup`,
        );
        const data = response.body;
        assert.equal(data.urls.length, 2);
        assert.equal(data.urls[0].id, newUrl.id);
        assert.equal(data.urls[1].id, newUrl2.id);

        assert.equal(data.claimers.length, 2);
        assert.equal(data.claimers[0].id, newClaimer.id);
        assert.equal(data.claimers[1].id, newClaimer2.id);

        assert.equal(data.affiliations.length, 2);
        assert.equal(data.affiliations[0].id, newAffiliation.id);
        assert.equal(data.affiliations[1].id, newAffiliation2.id);

        assert.equal(data.claims.length, 2);
        assert.equal(data.claims[0].id, id);
        assert.equal(data.claims[1].id, id2);
      });
    });
    describe("/restore", () => {
      let sqliteClient2: SqlClient;
      let app2: Koa | undefined;
      let stopApp2: () => Promise<void>;
      let docs2: Docs | undefined;
      let backup = undefined;
      beforeEach(async () => {
        const response = await request(app!.callback()).get(
          `/${API_DOMAIN}/backup`,
        );
        backup = response.body;

        await clearDir();
        const dbPath = "./test.sqlite";
        process.env.DATABASE_FILEPATH = dbPath;
        sqliteClient2 = await initClient(dbPath);
        await sqliteClient2.destroy();
        await sqliteClient2.init();

        const orbitdbRootIdKey1 = "main_peer";
        const node = await initBoolNode(orbitdbRootIdKey1, [
          "/ip4/0.0.0.0/tcp/5001",
        ]);
        const __syncers = await syncers(dbPath);
        const { syncUrl, syncClaim, syncAffiliation } = __syncers;
        const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations } =
          await onUpdate({
            label: "Test",
            syncUrl,
            syncClaim,
            syncAffiliation,
          });
        const docTypes = getDocType({
          onUpdateUrls,
          onUpdateClaims,
          onUpdateAffiliations,
        });
        docs2 = await node.openDocuments([
          docTypes.urls,
          docTypes.claimers,
          docTypes.claims,
          docTypes.affiliates,
        ]);

        ({ app: app2, stopApp: stopApp2 } = await init("BOOL_NODE", {
          boolNode: { node, docs: docs2 },
        }));
      });
      afterEach(async () => {
        if (stopApp2) {
          await stopApp2();
        }
        await clearDir();
        await sqliteClient2.destroy();
      });
      it("should restore all data", async () => {
        let response = await request(app2!.callback())
          .post(`/${API_DOMAIN}/restore`)
          .send(backup!!);

        const data = response.body;
        assert.equal(response.status, 200);
        assert.equal(data.urlCount, 2);
        assert.equal(data.claimerCount, 2);
        assert.equal(data.affiliationCount, 2);
        assert.equal(data.claimCount, 2);
      });
    });
  });

  describe("buildListOption", () => {
    it("should return correct object when valid params are passed", () => {
      const params = {
        filter: "some_filter",
        start_date: "2023-09-01T12:00:00Z",
        sort: "-created_at",
      };

      const result = buildListOption(params);

      expect(result).to.deep.equal({
        filter: "some_filter",
        startDate: new Date("2023-09-01T12:00:00Z"),
        sortKey: "created_at",
        desc: true,
      });
    });

    it("should return undefined startDate when start_date is invalid", () => {
      const params = {
        filter: "some_filter",
        start_date: "invalid-date",
        sort: "-created_at",
      };

      const result = buildListOption(params);

      expect(result).to.deep.equal({
        filter: "some_filter",
        startDate: undefined,
        sortKey: "created_at",
        desc: true,
      });
    });

    it("should return correct object with asc sorting when sort does not start with hyphen", () => {
      const params = {
        filter: "another_filter",
        start_date: "2023-08-01T10:00:00Z",
        sort: "true_count",
      };

      const result = buildListOption(params);

      expect(result).to.deep.equal({
        filter: "another_filter",
        startDate: new Date("2023-08-01T10:00:00Z"),
        sortKey: "true_count",
        desc: false,
      });
    });

    it("should handle missing filter and sort params", () => {
      const params = {
        start_date: "2023-09-01T12:00:00Z",
      };

      const result = buildListOption(params);

      expect(result).to.deep.equal({
        filter: undefined,
        startDate: new Date("2023-09-01T12:00:00Z"),
        sortKey: undefined,
        desc: false,
      });
    });

    it("should return undefined sortKey when sort is invalid", () => {
      const params = {
        filter: "some_filter",
        start_date: "2023-09-01T12:00:00Z",
        sort: "-invalid_key",
      };

      const result = buildListOption(params);

      expect(result).to.deep.equal({
        filter: "some_filter",
        startDate: new Date("2023-09-01T12:00:00Z"),
        sortKey: undefined,
        desc: true,
      });
    });
  });
});
const getLocation = (response: any) => {
  return response.headers["location"];
};
