import { describe, expect, it } from 'vitest';
import {
  decryptWith,
  encryptWith,
  isEncrypted,
  type SafeStorageLike,
} from '../main/services/credentialCipher';

const fakeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value.split('').reverse().join('')),
  decryptString: (value) => value.toString('utf8').split('').reverse().join(''),
};

describe('credentialCipher', () => {
  it('encrypts and decrypts non-empty values', () => {
    const encrypted = encryptWith(fakeStorage, 'secret-token');
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptWith(fakeStorage, encrypted)).toBe('secret-token');
  });

  it('is idempotent for already encrypted values', () => {
    const encrypted = encryptWith(fakeStorage, 'secret-token');
    expect(encryptWith(fakeStorage, encrypted)).toBe(encrypted);
  });
});
