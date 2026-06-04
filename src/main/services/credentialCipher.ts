const ENC_PREFIX = '__mail_auto_enc_v1__';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function encryptWith(storage: SafeStorageLike, plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  if (!storage.isEncryptionAvailable()) return plain;
  return ENC_PREFIX + storage.encryptString(plain).toString('base64');
}

export function decryptWith(storage: SafeStorageLike, stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored;
  if (!storage.isEncryptionAvailable()) return '';
  try {
    return storage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}
