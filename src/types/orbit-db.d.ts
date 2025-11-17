declare module "@orbitdb/core" {
  import EventEmitter = NodeJS.EventEmitter;

  export function Documents({ indexBy: string }): {};
  export function KeyValueIndexed(): {};

  type DocumentPut = <T>(doc: T) => Promise<string>;
  type KeyValuePut = <T>(key: string, value: T) => Promise<string>;
  export type DocumentValue<T> = { value: T };

  interface IteratorInput {
    amount?: number;
  }
  interface IteratorOutput<T> {
    hash: string;
    key: string;
    value?: T;
  }

  export interface DatabaseReturnType {
    name: string;
    address: string;
    close: () => Promise<void>;
    access: any;
    events: EventEmitter;
    all: <T>() => Promise<{ value: T }[]>;
    iterator: <T>(options?: IteratorInput) => AsyncGenerator<IteratorOutput<T>>;
    put: DocumentPut & KeyValuePut;
    get: <T>(key: string) => Promise<T | null>;
    query: <T>(findFn: (value: T) => boolean) => Promise<T[]>;
  }
  export interface CreateOrbitDBReturnType {
    open: (
      address: string,
      opt?: {
        type?: string;
        AccessController?: OrbitDBAccessController;
        Database?: any;
      },
    ) => Promise<DatabaseReturnType>;
    stop: () => Promise<void>;
  }
  // createOrbitDB function
  export function createOrbitDB(
    identity: any,
    options?: any,
  ): Promise<CreateOrbitDBReturnType>;

  // Identity-related types
  export interface Identity {
    id: string;
    publicKey: string;
    signatures: {
      id: string;
      publicKey: string;
    };
    type: string;
    sign: (identity: Identity, data: string) => Promise<string>;
    verify: (
      signature: string,
      publicKey: string,
      data: string,
    ) => Promise<boolean>;
    hash: string;
    bytes: Uint8Array;
  }

  // Keystore-related types
  export interface KeyStoreReturnType {
    getKey(id: string): Promise<string | undefined>;
    createKey(id: string): Promise<string>;
    getPublic(privateKey: string): string;
  }
  export function KeyStore({ path: string }): Promise<KeyStoreReturnType>;

  // Storage types
  export interface Storage {
    get(hash: string): Promise<Uint8Array | undefined>;
    put(hash: string, bytes: Uint8Array): Promise<void>;
  }

  export interface IdentitiesReturnType {
    createIdentity: (options?: {
      provider?: any;
      id?: string;
    }) => Promise<Identity>;
    verifyIdentity: (identity: Identity) => Promise<boolean>;
    getIdentity: (hash: string) => Promise<Identity | undefined>;
    sign: (identity: Identity, data: string) => Promise<string>;
    verify: (
      signature: string,
      publicKey: string,
      data: string,
    ) => Promise<boolean>;
    keystore: KeyStoreReturnType;
  }
  // Identities function
  export function Identities(params: {
    keystore?: KeyStoreReturnType;
    path?: string;
    storage?: Storage;
    ipfs?: any;
  }): Promise<IdentitiesReturnType>;

  // Helper functions for signing and verifying
  export function signMessage(
    privateKey: string,
    data: string,
  ): Promise<string>;
  export function verifyMessage(
    signature: string,
    publicKey: string,
    data: string,
  ): Promise<boolean>;

  // getIdentityProvider function
  export function getIdentityProvider(type: string): any;

  export interface OrbitDBAccessController {
    canAppend: (entry: any, identity: Identity) => Promise<boolean>;
    get: (permission: string) => string[];
    grant: (permission: string, identity: string) => Promise<void>;
    revoke: (permission: string, identity: string) => Promise<void>;
  }
  // // OrbitDBAccessController class
  // export class OrbitDBAccessController {
  //   constructor();
  //   static create: (
  //     orbitdb: any,
  //     options: { type: string; [key: string]: any },
  //   ) => Promise<any>;
  // }

  export function OrbitDBAccessController(
    params: OrbitDBAccessControllerParams,
  ): OrbitDBAccessController;
  // parseAddress function
  export function parseAddress(address: string): {
    root: string;
    path: string;
    hash: string;
  };
}
