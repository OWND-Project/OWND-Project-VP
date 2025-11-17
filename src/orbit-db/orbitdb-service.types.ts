import {
  CreateOrbitDBReturnType,
  DatabaseReturnType,
  Identity,
} from "@orbitdb/core";
import { Libp2p } from "libp2p";
import { ServiceMap } from "@libp2p/interface";
import { HeliaLibp2p } from "helia";

export interface SetUpOption {
  ipfsPath: string;
  orbitdbPath: string;
  identityKey: string;
  keystorePath?: string;
}

// export interface Node {
//   libp2p: Libp2p<ServiceMap>;
//   ipfs: HeliaLibp2p<Libp2p<ServiceMap>>;
//   orbitdb: CreateOrbitDBReturnType;
//   rootIdentity: Identity;
//   createIdentity: (identityKey: string) => Promise<Identity>;
//   getIdentity: (hash: string) => Promise<Identity | undefined>;
//   close: () => Promise<void>;
// }

export interface SyncArgsDocument {
  indexBy: string;
  address: string;
}

export interface SyncArgs {
  peer: {
    multiaddrs: string[];
  };
  documents: Record<string, SyncArgsDocument>;
}

export interface OpenedDocument {
  indexBy: string;
  document: DatabaseReturnType;
}

export interface OpenedKeyValue {
  db: DatabaseReturnType;
}

export interface Docs {
  documents: Record<string, OpenedDocument>;
  closeDocuments: () => Promise<void>;
}

// export type RESULT_TYPE_CREATE_LIB_P2P_ERROR = "CREATE_LIB_P2P_ERROR";
export interface CreateLibP2PError {
  type: "CREATE_LIB_P2P_ERROR";
}

export interface CreateKeyStoreError {
  type: "CREATE_KEYSTORE_ERROR";
}

export type SetupNodeNgResult = CreateLibP2PError | CreateKeyStoreError;

export interface LibP2PDialError {
  type: "LIB_P2P_DIAL_ERROR";
}

export interface IdentityNotFound {
  type: "IDENTITY_NOT_FOUND";
}

export type GrantNgResult = LibP2PDialError | IdentityNotFound;
export type SyncDocumentsOkResult = {
  documents: Record<string, OpenedDocument>;
  closeDocuments: () => Promise<void>;
};
export type SyncDocumentsNgResult = LibP2PDialError;

export interface PeerInfo {
  identity: {
    hash: string;
  };
  multiaddrs: string[];
}

export interface KeyValues {
  keyValues: Record<string, OpenedKeyValue>;
  closeKeyValues: () => Promise<void>;
}
