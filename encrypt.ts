import CryptoJS from "crypto-js";

const KEY = "iraqcore-supabase-key";

const supabaseUrl = "https://eboispangcayxxheoufy.supabase.co";
const anonKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVib2lzcGFuZ2NheXh4aGVvdWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MDM0MjMsImV4cCI6MjA4MzI3OTQyM30.lu57_UFDEtj36FjhQ4WZkbC3kcheWf9sdXqf6o58ORQ";

const encryptedUrl = CryptoJS.AES.encrypt(supabaseUrl, KEY).toString();
const encryptedAnon = CryptoJS.AES.encrypt(anonKey, KEY).toString();

console.log("ENCRYPTED_URL=", encryptedUrl);
console.log("ENCRYPTED_ANON_KEY=", encryptedAnon);
