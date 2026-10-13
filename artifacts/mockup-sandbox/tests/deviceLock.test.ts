import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, rawSignature, verifyClientData, verifyAuthenticatorData, unlockDevice, enrollDevice } from '../src/lib/deviceLock.ts';

const origin = 'https://ledger.example.com';
const hostname = 'ledger.example.com';
Object.defineProperty(globalThis, 'location', { value: { origin, hostname }, configurable: true });
const clientData = (nonce: Uint8Array, extras = {}) => new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: encode(nonce), origin, ...extras })).buffer;
async function authData(flags = 5) {
  const result = new Uint8Array(37);
  result.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hostname))));
  result[32] = flags;
  return result;
}
function derSignature(raw: Uint8Array) {
  const parts = [raw.slice(0, 32), raw.slice(32)].map(value => {
    while (value.length > 1 && value[0] === 0) value = value.slice(1);
    if (value[0] & 128) value = Uint8Array.from([0, ...value]);
    return Uint8Array.from([2, value.length, ...value]);
  });
  return Uint8Array.from([48, parts[0].length + parts[1].length, ...parts[0], ...parts[1]]);
}
function credentials(value: object) { Object.defineProperty(navigator, 'credentials', { value, configurable: true }); }

test('challenge, origin, operation and cross-origin responses must match', () => {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  assert.doesNotThrow(() => verifyClientData(clientData(nonce), nonce, 'webauthn.get', origin));
  for (const extras of [{origin: 'https://other.example.com'}, {challenge: 'wrong'}, {type: 'webauthn.create'}, {crossOrigin: true}]) {
    assert.throws(() => verifyClientData(clientData(nonce, extras), nonce, 'webauthn.get', origin));
  }
});
test('requires both user presence and device verification, for the correct site', async () => {
  await verifyAuthenticatorData((await authData()).buffer, hostname);
  for (const flags of [0,1,4]) await assert.rejects(verifyAuthenticatorData((await authData(flags)).buffer, hostname));
  await assert.rejects(verifyAuthenticatorData((await authData()).buffer, 'other.example.com'));
});
test('malformed signatures are rejected', () => {
  for (const value of [[], [48,1,2], [48,6,2,1,1,2,1,1,0]]) assert.throws(() => rawSignature(Uint8Array.from(value)));
});
test('signed passkey assertion unlocks; tampering and wrong credential are rejected', async () => {
  const keys = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify']);
  const saved = { id: encode(new Uint8Array([1,2,3])), publicKey: encode(await crypto.subtle.exportKey('spki', keys.publicKey)) };
  let tamper = false;
  let wrongId = false;
  credentials({ get: async ({publicKey}: {publicKey: PublicKeyCredentialRequestOptions}) => {
    assert.equal(publicKey.userVerification, 'required');
    const client = clientData(new Uint8Array(publicKey.challenge as ArrayBuffer));
    const auth = await authData();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', client));
    const signed = Uint8Array.from([...auth, ...hash]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, keys.privateKey, signed));
    if (tamper) raw[15] ^= 1;
    return { id: wrongId ? 'other' : saved.id, response: { clientDataJSON: client, authenticatorData: auth.buffer, signature: derSignature(raw).buffer } };
  }});
  await unlockDevice(saved);
  tamper = true; await assert.rejects(unlockDevice(saved));
  tamper = false; wrongId = true; await assert.rejects(unlockDevice(saved));
  credentials({ get: async () => null }); await assert.rejects(unlockDevice(saved));
});
test('enrollment requests platform passkey with required user verification', async () => {
  const keys = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'},true,['sign','verify']);
  const spki = await crypto.subtle.exportKey('spki', keys.publicKey);
  credentials({ create: async ({publicKey}: {publicKey: PublicKeyCredentialCreationOptions}) => {
    assert.equal(publicKey.authenticatorSelection?.userVerification,'required');
    assert.equal(publicKey.authenticatorSelection?.authenticatorAttachment,'platform');
    const auth = await authData();
    return {id:'credential',response:{clientDataJSON:clientData(new Uint8Array(publicKey.challenge as ArrayBuffer),{type:'webauthn.create'}),getPublicKey:()=>spki,getPublicKeyAlgorithm:()=>-7,getAuthenticatorData:()=>auth.buffer}};
  }});
  assert.equal((await enrollDevice('user-id','user@example.com')).publicKey,encode(spki));
});
