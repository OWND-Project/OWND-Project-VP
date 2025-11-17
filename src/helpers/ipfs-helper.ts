import { HeliaLibp2p } from "helia";
import { Libp2p } from "libp2p";
import { ServiceMap } from "@libp2p/interface";
import { CID } from "multiformats/cid";
import { base58btc } from "multiformats/bases/base58";
import * as dagCbor from "@ipld/dag-cbor";
import { sha256 } from "multiformats/hashes/sha2";
import * as Block from "multiformats/block";

export const parseCIDAndDecode = async (
  ipfs: HeliaLibp2p<Libp2p<ServiceMap>>,
  hash: string,
) => {
  const cid = CID.parse(hash, base58btc);
  const bytes = await ipfs.blockstore.get(cid);
  const codec = dagCbor;
  const hasher = sha256;
  const { value } = await Block.decode({ bytes, codec, hasher });
  return value;
};
