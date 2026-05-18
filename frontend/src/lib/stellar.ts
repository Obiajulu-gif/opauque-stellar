/**
 * Stellar / Soroban RPC helpers.
 */

import {
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
  Address,
} from "@stellar/stellar-sdk";
import { getHorizonUrl, getNetworkPassphrase, getRpcUrl } from "./chain";

export function getSorobanServer(): rpc.Server {
  return new rpc.Server(getRpcUrl(), { allowHttp: getRpcUrl().startsWith("http://") });
}

export function getHorizonServer(): Horizon.Server {
  return new Horizon.Server(getHorizonUrl());
}

export async function loadAccount(publicKey: string) {
  return getHorizonServer().loadAccount(publicKey);
}

export async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await loadAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

export type SignTxFn = (xdr: string) => Promise<string>;

export async function invokeContractMethod(opts: {
  sourcePublicKey: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  signTransaction: SignTxFn;
}): Promise<string> {
  const server = getSorobanServer();
  const passphrase = getNetworkPassphrase();
  const source = await server.getAccount(opts.sourcePublicKey);
  const contract = new Contract(opts.contractId);
  let tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(contract.call(opts.method, ...opts.args))
    .setTimeout(180)
    .build();
  tx = await server.prepareTransaction(tx);
  const signedXdr = await opts.signTransaction(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, passphrase);
  const send = await server.sendTransaction(signed);
  if (send.status === "ERROR") {
    throw new Error(`Transaction failed: ${JSON.stringify(send)}`);
  }
  let txResponse = await server.getTransaction(send.hash);
  while (txResponse.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1000));
    txResponse = await server.getTransaction(send.hash);
  }
  if (txResponse.status !== "SUCCESS") {
    throw new Error(`Transaction ${send.status}: ${JSON.stringify(txResponse)}`);
  }
  return send.hash;
}

export function addressToScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

export function bytesToScVal(bytes: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

export function u64ToScVal(n: bigint | number): xdr.ScVal {
  return nativeToScVal(n, { type: "u64" });
}

export async function sendNativePayment(opts: {
  sourceKeypair: Keypair;
  destination: string;
  amountStroops: bigint;
  signTransaction?: SignTxFn;
}): Promise<string> {
  const horizon = getHorizonServer();
  const passphrase = getNetworkPassphrase();
  const sourceAccount = await horizon.loadAccount(opts.sourceKeypair.publicKey());
  const destExists = await accountExists(opts.destination);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  });

  if (!destExists) {
    const minReserve = 10_000_000n; // 1 XLM in stroops
    const createAmount =
      opts.amountStroops > minReserve ? opts.amountStroops : minReserve;
    builder.addOperation(
      Operation.createAccount({
        destination: opts.destination,
        startingBalance: (Number(createAmount) / 1e7).toFixed(7),
      }),
    );
  } else {
    builder.addOperation(
      Operation.payment({
        destination: opts.destination,
        asset: Asset.native(),
        amount: (Number(opts.amountStroops) / 1e7).toFixed(7),
      }),
    );
  }

  let tx = builder.setTimeout(180).build();

  if (opts.signTransaction) {
    const server = getSorobanServer();
    const prepared = await server.prepareTransaction(tx);
    const signedXdr = await opts.signTransaction(prepared.toXDR());
    tx = TransactionBuilder.fromXDR(signedXdr, passphrase) as typeof tx;
  }

  tx.sign(opts.sourceKeypair);
  const result = await horizon.submitTransaction(tx);
  return result.hash;
}

export async function invokeContractWithKeypair(opts: {
  keypair: Keypair;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}): Promise<string> {
  const server = getSorobanServer();
  const passphrase = getNetworkPassphrase();
  const source = await server.getAccount(opts.keypair.publicKey());
  const contract = new Contract(opts.contractId);
  let tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(contract.call(opts.method, ...opts.args))
    .setTimeout(180)
    .build();
  tx = await server.prepareTransaction(tx);
  tx.sign(opts.keypair);
  const send = await server.sendTransaction(tx);
  if (send.status === "ERROR") {
    throw new Error(`Transaction failed: ${JSON.stringify(send)}`);
  }
  let txResponse = await server.getTransaction(send.hash);
  while (txResponse.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1000));
    txResponse = await server.getTransaction(send.hash);
  }
  if (txResponse.status !== "SUCCESS") {
    throw new Error(`Transaction failed: ${JSON.stringify(txResponse)}`);
  }
  return send.hash;
}

export function formatXlm(stroops: bigint): string {
  const xlm = Number(stroops) / 1e7;
  return xlm.toFixed(7).replace(/\.?0+$/, "");
}

export function parseXlmToStroops(val: string): bigint {
  return BigInt(Math.round(parseFloat(val) * 1e7));
}
