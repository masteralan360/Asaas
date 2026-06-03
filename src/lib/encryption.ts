import CryptoJS from 'crypto-js';

const AES_PREFIX = 'U2FsdGVkX1';
const LEGACY_ENCRYPTION_KEY = 'iraqcore-supabase-key';

export class EncryptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EncryptionError';
    }
}

const getPrimaryEncryptionKey = (): string | null => {
    const key = import.meta.env.VITE_ENCRYPTION_KEY;
    return typeof key === 'string' && key.trim().length > 0 ? key.trim() : null;
};

export const isEncryptedValue = (value: string | null | undefined): boolean => {
    return Boolean(value && String(value).trim().startsWith(AES_PREFIX));
};

const getDecryptionKeys = (): string[] => {
    const primaryKey = getPrimaryEncryptionKey();
    return primaryKey && primaryKey !== LEGACY_ENCRYPTION_KEY
        ? [primaryKey, LEGACY_ENCRYPTION_KEY]
        : [LEGACY_ENCRYPTION_KEY];
};

const decryptWithKey = (ciphertext: string, key: string): string | null => {
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, key);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        return originalText || null;
    } catch {
        return null;
    }
};

const decryptEncryptedValue = (ciphertext: string): { plaintext: string; key: string } | null => {
    for (const key of getDecryptionKeys()) {
        const plaintext = decryptWithKey(ciphertext, key);
        if (plaintext !== null) {
            return { plaintext, key };
        }
    }

    return null;
};

const encryptWithPrimaryKey = (plaintext: string): string => {
    const key = getPrimaryEncryptionKey();
    if (!key) {
        throw new EncryptionError('VITE_ENCRYPTION_KEY is required to encrypt local sensitive data.');
    }

    try {
        const encrypted = CryptoJS.AES.encrypt(plaintext, key).toString();
        if (!isEncryptedValue(encrypted) || decryptWithKey(encrypted, key) !== plaintext) {
            throw new EncryptionError('Encrypted value failed verification.');
        }

        return encrypted;
    } catch (error) {
        if (error instanceof EncryptionError) {
            throw error;
        }

        throw new EncryptionError('Encryption failed.');
    }
};

/**
 * Encrypts a string using AES
 */
export const encrypt = (text: string | null | undefined): string => {
    if (!text) return '';
    const str = String(text).trim();
    if (!str) return '';

    if (isEncryptedValue(str)) {
        return str;
    }

    return encryptWithPrimaryKey(str);
};

/**
 * Decrypts a string using AES. 
 * Legacy ciphertext encrypted with the former hard-coded key is still readable.
 * If decryption fails or the input is not encrypted, returns the original input.
 */
export const decrypt = (ciphertext: string | null | undefined): string => {
    if (!ciphertext) return '';
    const str = String(ciphertext).trim();
    if (!isEncryptedValue(str)) {
        return str;
    }

    return decryptEncryptedValue(str)?.plaintext ?? str;
};

export const encryptSensitiveValue = (value: string | null | undefined): string => {
    if (!value) return '';
    const str = String(value).trim();
    if (!str) return '';

    if (!isEncryptedValue(str)) {
        return encryptWithPrimaryKey(str);
    }

    const decrypted = decryptEncryptedValue(str);
    if (!decrypted) {
        throw new EncryptionError('Sensitive setting is encrypted but could not be decrypted.');
    }

    const primaryKey = getPrimaryEncryptionKey();
    if (primaryKey && decrypted.key !== primaryKey) {
        return encryptWithPrimaryKey(decrypted.plaintext);
    }

    return str;
};

export const decryptSensitiveValue = (value: string | null | undefined): string | undefined => {
    if (!value) return '';
    const str = String(value).trim();
    if (!str) return '';

    if (!isEncryptedValue(str)) {
        return undefined;
    }

    return decryptEncryptedValue(str)?.plaintext;
};
