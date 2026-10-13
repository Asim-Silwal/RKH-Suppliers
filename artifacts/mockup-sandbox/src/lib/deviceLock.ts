export type DeviceCredential = { id: string; publicKey: string };
export const encode = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value instanceof Uint8Array ? value : value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
const challenge = () => crypto.getRandomValues(new Uint8Array(32));

// WebAuthn uses ASN.1 DER ECDSA signatures; Web Crypto expects 32-byte r || s.
export function rawSignature(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2 || der[2] !== 2) throw new Error("Invalid verification signature.");
  const rLength = der[3];
  const sStart = 4 + rLength;
  if (der[sStart] !== 2 || sStart + 2 + der[sStart + 1] !== der.length) throw new Error("Invalid verification signature.");
  const result = new Uint8Array(64);
  [der.slice(4, sStart), der.slice(sStart + 2)].forEach((part, index) => {
    const value = part.length === 33 && part[0] === 0 ? part.slice(1) : part;
    if (!value.length || value.length > 32) throw new Error("Invalid verification signature.");
    result.set(value, index * 32 + 32 - value.length);
  });
  return result;
}
export function verifyClientData(buffer: ArrayBuffer, nonce: Uint8Array, type: string, origin: string) {
  const client = JSON.parse(new TextDecoder().decode(buffer));
  if (client.type !== type || client.challenge !== encode(nonce) || client.origin !== origin || client.crossOrigin === true) throw new Error("Device verification did not match this app.");
}
export async function verifyAuthenticatorData(buffer: ArrayBuffer, hostname: string) {
  const data = new Uint8Array(buffer);
  const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hostname)));
  if (data.length < 37 || !expected.every((byte, index) => data[index] === byte) || (data[32] & 5) !== 5) throw new Error("Face ID or device passcode verification is required.");
}
export async function enrollDevice(id: string, email: string): Promise<DeviceCredential> {
  const nonce = challenge();
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: nonce,
    rp: { id: location.hostname, name: "RKH Ledger" },
    user: { id: new TextEncoder().encode(id), name: email, displayName: "RKH Ledger app lock" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
    attestation: "none", timeout: 60000,
  } }) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey setup was cancelled.");
  const response = credential.response as AuthenticatorAttestationResponse;
  verifyClientData(response.clientDataJSON, nonce, "webauthn.create", location.origin);
  await verifyAuthenticatorData(response.getAuthenticatorData(), location.hostname);
  const key = response.getPublicKey();
  if (!key || response.getPublicKeyAlgorithm() !== -7) throw new Error("This device does not support app-lock verification. Use your account password.");
  return { id: credential.id, publicKey: encode(key) };
}
export async function unlockDevice(saved: DeviceCredential) {
  const nonce = challenge();
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: nonce, rpId: location.hostname, userVerification: "required", timeout: 60000,
    allowCredentials: [{ id: decode(saved.id), type: "public-key" }],
  } }) as PublicKeyCredential | null;
  if (!credential || credential.id !== saved.id) throw new Error("Please use the passkey registered for this account.");
  const response = credential.response as AuthenticatorAssertionResponse;
  verifyClientData(response.clientDataJSON, nonce, "webauthn.get", location.origin);
  await verifyAuthenticatorData(response.authenticatorData, location.hostname);
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", response.clientDataJSON));
  const signed = new Uint8Array(response.authenticatorData.byteLength + clientHash.length);
  signed.set(new Uint8Array(response.authenticatorData)); signed.set(clientHash, response.authenticatorData.byteLength);
  const key = await crypto.subtle.importKey("spki", decode(saved.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, rawSignature(new Uint8Array(response.signature)), signed);
  if (!valid) throw new Error("Device verification failed. Please try again.");
}
