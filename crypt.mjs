import CryptoJS from 'crypto-js';

// The "Superkey" requested by the user
const KEY = 'iraqcore-supabase-key';

const args = process.argv.slice(2);
const mode = args[0]; // 'encrypt' or 'decrypt'
const text = args[1];

if (!mode || !text) {
    console.log('Usage: node crypt.mjs [encrypt|decrypt] "your-text"');
    console.log(`\n[Info] Currently using fixed Superkey: ${KEY}`);
    process.exit(1);
}

try {
    console.log(`[Info] Mode: ${mode}`);
    console.log(`[Info] Key:  ${KEY}`);

    if (mode === 'encrypt') {
        const encrypted = CryptoJS.AES.encrypt(text, KEY).toString();
        console.log('\n--- Encrypted Value ---');
        console.log(encrypted);
        console.log('-----------------------\n');
    } else if (mode === 'decrypt') {
        const bytes = CryptoJS.AES.decrypt(text, KEY);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);

        if (!decrypted) {
            console.error('\n[Error] Decryption failed! The text might not be encrypted with this key, or the input is invalid.');
        } else {
            console.log('\n--- Decrypted Value ---');
            console.log(decrypted);
            console.log('-----------------------\n');
        }
    } else {
        console.error('Invalid mode. Use "encrypt" or "decrypt".');
    }
} catch (e) {
    console.error('An error occurred:', e.message);
}
