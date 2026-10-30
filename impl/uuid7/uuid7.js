/**
 * UUID version 7, RFC 9562.
 * Spec: unispec.uuid7/java. This file is the TypeScript code link.
 */
let lastTimestamp = -1;
function writeTimestamp(bytes, timestamp) {
    let value = Math.floor(timestamp);
    for (let i = 5; i >= 0; i--) {
        bytes[i] = value % 256;
        value = Math.floor(value / 256);
    }
}
function toHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function bytesOf(id) {
    const hex = id.replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/.test(hex)) {
        throw new Error('Expected a UUID.');
    }
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
/** A new UUID version 7. A later call is never older than an earlier one. */
export function generate() {
    let timestamp = Date.now();
    if (timestamp < lastTimestamp)
        timestamp = lastTimestamp;
    lastTimestamp = timestamp;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    writeTimestamp(bytes, timestamp);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = toHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Timestamp in Unix milliseconds, version nibble, and the remaining random bits. */
export function parts(id) {
    const bytes = bytesOf(id);
    let timestamp = 0;
    for (let i = 0; i < 6; i++)
        timestamp = timestamp * 256 + bytes[i];
    const version = bytes[6] >> 4;
    const randomBytes = bytes.slice(6);
    randomBytes[0] = randomBytes[0] & 0x0f;
    randomBytes[2] = randomBytes[2] & 0x3f;
    return { timestamp, version, random: toHex(randomBytes) };
}
