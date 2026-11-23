const crypto = require('crypto');

const algorithm = 'aes-256-gcm';
// Ensure key is exactly 32 bytes (256 bits) long. If it's shorter, pad it. If longer, slice it.
const rawKey = process.env.ENCRYPTION_KEY || 'default-insecure-key-do-not-use-in-prod';
const key = crypto.scryptSync(rawKey, 'salt', 32);

function encrypt(text) {
  if (!text) return text;
  
  // Create a random initialization vector
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(text) {
  if (!text) return text;
  
  try {
    const parts = text.split(':');
    if (parts.length !== 3) return text; // Probably not encrypted
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('Failed to decrypt data:', err.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };
