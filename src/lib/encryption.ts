import CryptoJS from 'crypto-js';

const KEY = 'iraqcore-supabase-key';

/**
 * Encrypts a string using AES
 */
export const encrypt = (text: string | null | undefined): string => {
    if (!text) return '';
    try {
        const str = String(text).trim();
        // If it starts with this prefix, it's likely already encrypted.
        if (str.startsWith('U2FsdGVkX1')) {
            return str;
        }
        return CryptoJS.AES.encrypt(str, KEY).toString();
    } catch (error) {
        console.error('Encryption failed:', error);
        return String(text || '');
    }
};

/**
 * Decrypts a string using AES. 
 * If decryption fails or the input is not encrypted, returns the original input.
 */
export const decrypt = (ciphertext: string | null | undefined): string => {
    if (!ciphertext) return '';
    const str = String(ciphertext).trim();
    try {
        // Simple check to see if it looks like an AES encrypted string (starts with U2FsdGVkX1)
        if (!str.startsWith('U2FsdGVkX1')) {
            return str;
        }

        const bytes = CryptoJS.AES.decrypt(str, KEY);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);

        // If decryption result is empty, it might have failed or input was invalid
        return originalText || str;
    } catch (error) {
        // Fallback to original string if decryption fails
        return str;
    }
};
