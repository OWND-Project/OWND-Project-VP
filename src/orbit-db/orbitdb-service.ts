import { multiaddr } from "@multiformats/multiaddr";
import { createLibp2p, Libp2p, Libp2pOptions } from "libp2p";
import { ServiceMap } from "@libp2p/interface";
import { createHelia, HeliaLibp2p } from "helia";
import {
  createOrbitDB,
  Documents,
  Identities,
  KeyStore,
  KeyValueIndexed,
  OrbitDBAccessController,
  parseAddress,
} from "@orbitdb/core";
import { LevelBlockstore } from "blockstore-level";
import { parseCIDAndDecode } from "../helpers/ipfs-helper.js";
import { Result, VoidResult } from "../tool-box/index.js";
import {
  GrantNgResult,
  KeyValues,
  OpenedDocument,
  OpenedKeyValue,
  PeerInfo,
  SetUpOption,
  SyncArgs,
  SyncArgsDocument,
  SyncDocumentsNgResult,
  SyncDocumentsOkResult,
} from "./orbitdb-service.types.js";
import getLogger from "../services/logging-service.js";

export type Node = Awaited<ReturnType<typeof setupNode>>;

const logger = getLogger();

/**
 *
 * @param libP2POptions
 * @param opt
 */
export const setupNode = async (
  libP2POptions: Libp2pOptions,
  opt: SetUpOption,
) => {
  const { ipfsPath, orbitdbPath, identityKey, keystorePath } = opt;
  logger.info(`setup for ${identityKey}`);
  // Create an IPFS instance.
  let libp2p: Libp2p<ServiceMap>;
  try {
    logger.info("createLibp2p");
    libp2p = await createLibp2p(libP2POptions);
  } catch (err) {
    console.error(err);
    throw new Error("CREATE_LIB_P2P_ERROR");
  }
  logger.info("createHelia");
  const blockstore = new LevelBlockstore(ipfsPath);
  const ipfs = await createHelia({ libp2p, blockstore });

  logger.info("Identities");
  let identitiesParams: Parameters<typeof Identities>[0] = { ipfs };
  if (keystorePath) {
    logger.info(`Keystore path: ${keystorePath}`);
    try {
      const keystore = await KeyStore({ path: keystorePath });
      identitiesParams = { ipfs, keystore };
    } catch (err) {
      console.error(err);
      await libp2p.stop();
      throw new Error("CREATE_KEYSTORE_ERROR");
    }
  }
  const identities = await Identities(identitiesParams);
  logger.info("createIdentity");
  const identity = await identities.createIdentity({ id: identityKey });

  logger.info("createOrbitDB");
  const orbitdb = await createOrbitDB({
    ipfs,
    directory: orbitdbPath,
    identity,
    identities,
  });

  /**
   *
   * @param documentTypes
   */
  const openDocuments = async (
    documentTypes: {
      name: string;
      indexBy: string;
      onUpdate?: (entry: any) => Promise<void>;
    }[],
  ) => {
    const documents: Record<string, OpenedDocument> = {};
    // // https://github.com/orbitdb/orbitdb/blob/main/docs/ACCESS_CONTROLLERS.md
    // const write = [identity.id];
    // const AccessController = OrbitDBAccessController({ write });
    // const AccessController = IPFSAccessController({ write })

    logger.info(`identity: ${identity.id}`);
    // https://github.com/orbitdb/orbitdb/blob/main/docs/ACCESS_CONTROLLERS.md
    const write = [identity.id];
    const AccessController = OrbitDBAccessController({ write });
    for (const docType of documentTypes) {
      logger.debug(`open ${docType}`);
      const Database = Documents({ indexBy: docType.indexBy });
      /// const opt = { type: "documents", AccessController };
      const opt = { type: "documents", AccessController, Database };
      const doc = await orbitdb.open(docType.name, opt);
      // documents[docType.name] = doc;
      documents[docType.name] = { indexBy: docType.indexBy, document: doc };
      logger.debug(`Opened database: ${doc.name}(${doc.address})`);
      if (docType.onUpdate) {
        const onUpdate = docType.onUpdate;
        doc.events.on("update", async (entry) => {
          onUpdate(entry);
        });
        doc.events.on("error", async (err) => {
          logger.error("Caught EventEmitter error");
          logger.error(err);
        });
      }

      const manifest = await parseAddressAndDecode(ipfs, doc.address);
      // console.log("manifest", manifest);

      // @ts-ignore
      const { accessController } = manifest;
      const accessController1 = await parseAddressAndDecode(
        ipfs,
        accessController,
      );
      console.log("accessController1", JSON.stringify(accessController1));

      // @ts-ignore
      const hash = accessController1.accessController
        .replace("/ipfs/", "")
        .replace("\\ipfs\\", "");
      const accessController2 = await parseCIDAndDecode(ipfs, hash);
      console.log("accessController2", JSON.stringify(accessController2));
    }
    const closeDocuments = async () => {
      for (const doc of Object.values(documents)) {
        console.log("close document:", doc.document.name);
        doc.document.close;
        // console.log("close document:", doc.type.name);
        // doc.document.close;
      }
    };
    return { documents, closeDocuments };
  };

  /**
   *
   * @param keyValueTypes
   */
  const openKeyValueIndexed = async (
    keyValueTypes: { name: string }[],
  ): Promise<KeyValues> => {
    const openedKeyValues: Record<string, OpenedKeyValue> = {};
    for (const keyValueType of keyValueTypes) {
      console.log("open ", keyValueType);
      const Database = KeyValueIndexed();
      const opt = { Database };
      const db = await orbitdb.open(keyValueType.name, opt);
      console.log(`Opened database: ${db}`);
      openedKeyValues[keyValueType.name] = { db };
      db.events.on("update", async (entry) => {
        // what has been updated.
        // console.debug("update", entry);
      });

      // const manifest = await parseAddressAndDecode(ipfs, keyValue.address);
      // console.log("manifest", manifest);
    }
    const closeKeyValues = async () => {
      for (const opened of Object.values(openedKeyValues)) {
        console.log("close document:", opened.db.name);
        opened.db.close;
        // console.log("close document:", doc.type.name);
        // doc.document.close;
      }
    };
    return { keyValues: openedKeyValues, closeKeyValues };
  };

  /**
   *
   * @param documents
   * @param requester
   */
  const grant = async (
    documents: Record<string, OpenedDocument>,
    requester: PeerInfo,
  ): Promise<VoidResult<GrantNgResult>> => {
    if (!(await dial2(libp2p, requester.multiaddrs))) {
      return {
        ok: false,
        error: { type: "LIB_P2P_DIAL_ERROR" },
      };
    }

    console.log("get remote identity");
    const identity = await identities.getIdentity(requester.identity.hash);
    if (identity) {
      // https://github.com/orbitdb/orbitdb/blob/main/docs/ACCESS_CONTROLLERS.md#orbitdb-access-controller
      for (const doc of Object.values(documents)) {
        await doc.document.access.grant("write", identity.id);
      }
      return {
        ok: true,
      };
    } else {
      return {
        ok: false,
        error: { type: "IDENTITY_NOT_FOUND" },
      };
    }
  };

  /**
   *
   * @param args
   * @param onUpdates
   */
  const syncDocuments = async (
    args: SyncArgs,
    onUpdates: Record<string, (entry: any) => Promise<void> | undefined>,
  ): Promise<Result<SyncDocumentsOkResult, SyncDocumentsNgResult>> => {
    const { documents, peer } = args;
    if (!(await dial2(libp2p, peer.multiaddrs))) {
      return {
        ok: false,
        error: { type: "LIB_P2P_DIAL_ERROR" },
      };
    }

    console.log("open db");
    // const address = "/orbitdb/zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz"
    const syncedDocuments: Record<string, OpenedDocument> = {};
    for (const docType of Object.keys(documents)) {
      const syncDoc = documents[docType];
      const { indexBy } = syncDoc;
      const Database = Documents({ indexBy });
      const opt = { Database };
      // const address = documents[docType];
      // const doc = await orbitdb.open(syncDoc.address);
      // const doc = await orbitdb.open(syncDoc.address);
      const doc = await orbitdb.open(syncDoc.address, opt);
      // syncedDocuments[docType] = doc;
      syncedDocuments[docType] = { indexBy, document: doc };

      const onUpdate = onUpdates[docType];
      if (onUpdate) {
        doc.events.on("update", async (entry) => {
          onUpdate(entry);
        });
        doc.events.on("error", async (err) => {
          logger.error("Caught EventEmitter error");
          logger.error(err);
        });
      }
      const manifest = await parseAddressAndDecode(ipfs, doc.address);
      console.log("manifest", JSON.stringify(manifest));
    }

    const closeDocuments = async () => {
      for (const doc of Object.values(syncedDocuments)) {
        console.debug("close document:", doc.document.name);
        doc.document.close;
      }
    };
    const opened = {
      documents: syncedDocuments,
      closeDocuments,
    };
    return { ok: true, payload: opened };
  };

  /**
   *
   */
  const getPeerInfo = () => {
    const peerInfo: PeerInfo = {
      identity: {
        hash: identity.hash,
      },
      multiaddrs: libp2p.getMultiaddrs().map((addr) => addr.toString()),
    };
    return peerInfo;
  };

  /**
   *
   * @param documents
   */
  const getDocumentsInfo = (documents: Record<string, OpenedDocument>) => {
    const docmentAddresses: Record<string, SyncArgsDocument> = {};

    for (const doc of Object.values(documents)) {
      docmentAddresses[doc.document.name] = {
        address: doc.document.address,
        indexBy: doc.indexBy,
      };
    }
    const info: SyncArgs = {
      documents: docmentAddresses,
      peer: {
        multiaddrs: libp2p.getMultiaddrs().map((addr) => addr.toString()),
      },
    };
    return info;
  };

  /**
   *
   */
  const close = async () => {
    console.log("stop orbitdb");
    orbitdb.stop;
    console.log("stop ipfs node");
    await ipfs.stop();
  };

  return {
    openDocuments,
    openKeyValueIndexed,
    grant,
    syncDocuments,
    getPeerInfo,
    getDocumentsInfo,
    close,
  };
};

const dial2 = async (libp2p: Libp2p<ServiceMap>, multiaddrs: string[]) => {
  /*
        "multiaddrs": [
          "/ip4/127.0.0.1/tcp/4003/p2p/12D3KooWQecqt7GuK3NGvFaPPkGGu5UctugTjGTSe9BByAJve5m8",
          "/ip4/192.168.10.105/tcp/4003/p2p/12D3KooWQecqt7GuK3NGvFaPPkGGu5UctugTjGTSe9BByAJve5m8",
          "/ip4/192.168.64.1/tcp/4003/p2p/12D3KooWQecqt7GuK3NGvFaPPkGGu5UctugTjGTSe9BByAJve5m8"
        ]
     */
  for (const addr of multiaddrs) {
    try {
      const knownAddress = multiaddr(addr);
      console.log("Dialing to", knownAddress);
      await libp2p.dial(knownAddress);
      console.log("Successfully connected to", knownAddress);
      return true; // Success
    } catch (err) {
      console.error("Failed to dial", addr, err);
      // Continue to the next address
    }
  }
  console.error("Failed to connect to any provided address.");
  return false; // All addresses failed
};

const parseAddressAndDecode = async (
  ipfs: HeliaLibp2p<Libp2p<ServiceMap>>,
  address: string,
) => {
  const addr = parseAddress(address);
  return await parseCIDAndDecode(ipfs, addr.hash);
};
