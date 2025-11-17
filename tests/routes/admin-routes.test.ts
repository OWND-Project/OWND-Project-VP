import { assert } from "chai";
import Koa from "koa";
import request from "supertest";

import {
  clearDir,
  createAffiliation,
  createClaim,
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
import { Docs, Node, setupNode, SyncArgs } from "../../src/orbit-db/index.js";
import { getLibp2pOptions } from "../../src/helpers/libp2p-helper.js";
import { generateAndSerializePeerId } from "../../src/helpers/get-peer-id.js";
import { onUpdate } from "../../src/local-data/on-update.js";
import { SqlClient, initClient } from "../../src/local-data/sqlite-client.js";
import {
  AffiliationDocument,
  ClaimDocument,
  UrlDocument,
} from "../../src/usecases/types.js";
import { initClaimRepository } from "../../src/usecases/claim-repository.js";
import {
  DecodeOk,
  extractClaimerSub,
} from "../../src/usecases/internal/internal-helpers.js";
import { syncers } from "../../src/local-data/syncer.js";
import { replication } from "../../src/local-data/replication.js";

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

  const node = await setupNode(libp2pOptions, {
    ...paths,
    identityKey: orbitdbRootIdKey,
  });
  return { peerId, node };
};

describe("Admin", () => {
  let sqliteClient: SqlClient;
  let sqliteClient2: SqlClient;
  let peerId1: Awaited<ReturnType<typeof generateAndSerializePeerId>>;
  let app1: Koa | undefined;
  let stopApp1: () => Promise<void>;
  let node1: Node | undefined;
  let node2: Node | undefined;
  let docs1: Docs | undefined;
  let docInfo: SyncArgs | undefined;

  let peerId2: Awaited<ReturnType<typeof generateAndSerializePeerId>>;
  let app2: Koa | undefined;
  let stopApp2: () => Promise<void>;

  const url1 = "https://example1.com";
  const url2 = "https://example2.com";

  beforeEach(async () => {
    console.log(
      "---------------------------- before each@Admin ----------------------------------",
    );

    await clearDir();

    console.log("------------ init peer1 ------------");
    const dbPath = "./test.sqlite";
    sqliteClient = await initClient(dbPath);
    await sqliteClient.destroy();
    await sqliteClient.init();

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

    ({ peerId: peerId1, node: node1 } = await initBoolNode("main_peer", [
      "/ip4/0.0.0.0/tcp/4001",
    ]));
    docs1 = await node1.openDocuments([
      docTypes.urls,
      docTypes.claimers,
      docTypes.claims,
      docTypes.affiliates,
    ]);

    process.env.DATABASE_FILEPATH = dbPath;
    const { app, stopApp } = await init("BOOL_NODE", {
      boolNode: {
        node: node1,
        docs: docs1,
      },
    });
    app1 = app;
    stopApp1 = stopApp;

    // add data to peer1
    const dt = new Date();
    const url = createUrl({ url: url1, created_at: dt.toISOString() });
    await docs1.documents["urls"].document.put<UrlDocument>(url);
    // await request(app1!.callback()).post(`/database/urls`).send({ url: url1 });
    // claimer1
    const idToken = await createIdToken();
    const sub = (extractClaimerSub(idToken) as DecodeOk).value;
    const repository = initClaimRepository(docs1);
    const claimer = await repository.putClaimer({
      idToken,
      sub,
      icon: "",
    });
    // affiliation1
    const affiliationJwt = await createSdJwt({}, []);
    const affiliation = createAffiliation({
      claimer_id: claimer.id,
      claimer_sub: sub,
      organization: affiliationJwt,
    });
    await docs1.documents["affiliations"].document.put<AffiliationDocument>(
      affiliation,
    );
    // claim1
    const claimJwt = await getClaimJwt(createClaimPayload({ boolValue: 1 }));
    const claim = createClaim({
      url: url.url,
      claimer_id: claimer.id,
      affiliation_id: affiliation.id,
      comment: claimJwt,
      created_at: dt.toISOString(),
    });
    await docs1.documents["claims"].document.put<ClaimDocument>(claim);

    docInfo = node1.getDocumentsInfo(docs1!.documents); // get doc info from main peer
  });

  afterEach(async () => {
    console.log(
      "---------------------------- after each@Admin ----------------------------------",
    );

    if (stopApp1) {
      await stopApp1();
    }
    await clearDir();
    await sqliteClient.destroy();
  });

  describe("/admin/db/info", () => {
    it("should return db info", async () => {
      // execute
      const response = await request(app1!.callback()).get(`/admin/db/info`);

      // assert
      const dbInfo = response.body;
      assert.equal(response.status, 200);
      let addrUrls = docs1!.documents["urls"].document.address;
      let addrClaimers = docs1!.documents["claimers"].document.address;
      let addrClaims = docs1!.documents["claims"].document.address;
      let addrAffiliates = docs1!.documents["affiliations"].document.address;
      assert.equal(dbInfo.documents.urls.address, addrUrls);
      assert.equal(dbInfo.documents.claimers.address, addrClaimers);
      assert.equal(dbInfo.documents.claims.address, addrClaims);
      assert.equal(dbInfo.documents.affiliations.address, addrAffiliates);
      assert.equal(dbInfo.peer.multiaddrs.length, 3);
      for (const addr of dbInfo.peer.multiaddrs) {
        assert.isTrue(addr.endsWith(peerId1.toString()));
      }
    });
  });
  describe("/admin/access-right/grant", () => {
    let peerInfo: any;
    beforeEach(async () => {
      console.log(
        "---------------------------- before each@access-right/grant ----------------------------------",
      );

      console.log("------------ init peer2 ------------");
      const dbPath2 = "./test2.sqlite";
      sqliteClient2 = await initClient(dbPath2);
      await sqliteClient2.destroy();
      await sqliteClient2.init();
      ({ peerId: peerId2, node: node2 } = await initBoolNode("sub_peer", [
        "/ip4/0.0.0.0/tcp/4002",
      ]));
      const __syncers2 = await syncers(dbPath2);
      const __replication = replication(__syncers2);
      const { setDocs, syncAllUrls, syncAllClaims, syncAllAffiliations } =
        __replication;
      const { onUpdateClaims: onUpdateClaims2, onUpdateUrls: onUpdateUrls2 } =
        await onUpdate({
          label: "Replica",
          syncUrl: __syncers2.syncUrl,
          syncClaim: __syncers2.syncClaim,
          syncAffiliation: __syncers2.syncAffiliation,
          syncAllUrls,
          syncAllClaims,
          syncAllAffiliations,
        });
      const synced = await node2.syncDocuments(docInfo!, {
        urls: onUpdateUrls2,
        claims: onUpdateClaims2,
      });
      if (!synced.ok) {
        assert.fail("should be ok");
      }
      const docs2 = synced.payload;
      setDocs(docs2);
      process.env.DATABASE_FILEPATH = dbPath2;
      const server2 = await init("API_NODE", {
        boolNode: {
          node: node2,
          docs: docs2,
        },
      });
      app2 = server2.app;
      stopApp2 = server2.stopApp;
      const response = await request(app2!.callback()).get(`/admin/peer/info`);
      peerInfo = response.body;
    });
    afterEach(async () => {
      console.log(
        "---------------------------- after each@access-right/grant ----------------------------------",
      );
      if (stopApp2) {
        await stopApp2();
      }
      await sqliteClient2.destroy();
      process.env.DATABASE_FILEPATH = "";
    });
    it("should be success", async () => {
      // wait syncing
      await delay(1000);

      // execute
      let response = await request(app1!.callback())
        .post(`/admin/access-right/grant`)
        .send(peerInfo);

      // assert
      assert.equal(response.status, 204);

      await delay(1000);
      // get data from peer2
      response = await request(app2!.callback()).get(`/database/urls`);
      assert.equal(response.status, 200);
      let urls = response.body;
      assert.equal(urls.length, 1);

      // todo The following test cases are blocked until we support nodes with write access
      // // add data to peer2
      // await request(app2!.callback())
      //   .post(`/database/urls`)
      //   .send({ url: url2 });
      //
      // await delay(1000);
      // // get data from peer1
      // response = await request(app1!.callback())
      //   .get(`/database/urls`)
      //   .query({ filter: "example2" });
      //
      // assert.equal(response.status, 200);
      // urls = response.body;
      // assert.equal(urls.length, 1);
      // assert.equal(urls[0].url, url2);
    }).timeout(5000);
  });
});
