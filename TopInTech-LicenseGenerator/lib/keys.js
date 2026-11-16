'use strict';
/* Key pair management for the license generator.

   The Ed25519 key pair is created once, on the owner's computer, and kept in
   the application's private data folder:
     <userData>/keys/private.pem   (0600, owner only, never shipped)
     <userData>/keys/public.pem    (safe to copy into customer applications)

   The public key alone can verify a serial; only the private key can create
   one. Nothing in this module ever puts the private key into the renderer.  */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { keyId } = require('./serial');

const PRIVATE_FILE = 'private.pem';
const PUBLIC_FILE = 'public.pem';

function createKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' })
  };
}

function writePrivate(file, pem) {
  fs.writeFileSync(file, pem, { mode: 0o600, encoding: 'utf8' });
  // Windows ignores the POSIX mode, so tighten it again where the platform
  // supports ACLs. A failure here must not stop the app from working.
  try { fs.chmodSync(file, 0o600); } catch {}
}

function paths(keyDir) {
  return { directory: keyDir, privateKey: path.join(keyDir, PRIVATE_FILE), publicKey: path.join(keyDir, PUBLIC_FILE) };
}

// Creates the pair the first time the app runs; returns what already exists.
function ensureKeyPair(keyDir) {
  fs.mkdirSync(keyDir, { recursive: true });
  const files = paths(keyDir);
  const hasPrivate = fs.existsSync(files.privateKey);
  const hasPublic = fs.existsSync(files.publicKey);
  if (!hasPrivate && !hasPublic) {
    const pair = createKeyPair();
    writePrivate(files.privateKey, pair.privatePem);
    fs.writeFileSync(files.publicKey, pair.publicPem, { encoding: 'utf8' });
    return { created: true, ...files };
  }
  if (hasPrivate && !hasPublic) {
    const publicPem = crypto.createPublicKey(fs.readFileSync(files.privateKey, 'utf8')).export({ type: 'spki', format: 'pem' });
    fs.writeFileSync(files.publicKey, publicPem, { encoding: 'utf8' });
    return { created: false, repaired: true, ...files };
  }
  if (!hasPrivate && hasPublic) throw new Error('The private key is missing but the public key exists. Restore private.pem from your backup before generating new licenses.');
  return { created: false, ...files };
}

function readPrivate(keyDir) {
  const file = path.join(keyDir, PRIVATE_FILE);
  if (!fs.existsSync(file)) throw new Error('The private key is missing. Restore it from your backup first.');
  const pem = fs.readFileSync(file, 'utf8');
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The private key is not an Ed25519 key.');
  return pem;
}

function readPublic(keyDir) {
  const file = path.join(keyDir, PUBLIC_FILE);
  if (!fs.existsSync(file)) throw new Error('The public key is missing.');
  return fs.readFileSync(file, 'utf8');
}

// Everything the window is allowed to know about the keys: the public part,
// its id and where the files live. Never the private bytes.
function describe(keyDir) {
  const publicPem = readPublic(keyDir);
  const files = paths(keyDir);
  return {
    keyId: keyId(publicPem),
    publicKey: publicPem,
    folder: keyDir,
    privateKeyFile: files.privateKey,
    publicKeyFile: files.publicKey,
    createdAt: fs.statSync(files.privateKey).mtime.toISOString()
  };
}

module.exports = { PRIVATE_FILE, PUBLIC_FILE, createKeyPair, ensureKeyPair, readPrivate, readPublic, describe, paths };
