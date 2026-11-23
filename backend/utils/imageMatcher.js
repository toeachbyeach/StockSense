const { Jimp, compareHashes: jimpCompareHashes } = require('jimp');

/**
 * Calculates the perceptual hash of an image from a URL.
 */
async function getImageHash(url) {
  if (!url) return null;
  try {
    const image = await Jimp.read(url);
    // Use Jimp's built-in 64-bit pHash
    return image.hash();
  } catch (err) {
    console.error(`[ImageMatcher] Failed to hash image at ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Compares two perceptual hashes and returns the difference distance (0 to 1).
 * 0 means identical, 1 means completely different.
 */
function compareHashes(hash1, hash2) {
  if (!hash1 || !hash2) return 1; // max distance
  try {
     return jimpCompareHashes(hash1, hash2); // returns a float 0 to 1
  } catch (e) {
     return 1;
  }
}

/**
 * Calculates a basic dominant color signature.
 */
async function getColorSignature(url) {
  if (!url) return [];
  try {
    const image = await Jimp.read(url);
    // Resize aggressively for performance
    image.resize(32, 32);
    const { width, height } = image.bitmap;
    
    const colors = {};
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const color = image.getPixelColor(x, y);
        // Using intToRGBA properly for Jimp 1.x (constructor method or instance method)
        // Usually Jimp.intToRGBA(color) works in all versions
        const { r, g, b, a } = Jimp.intToRGBA(color);
        
        // Ignore transparent
        if (a < 50) continue;
        
        // Ignore near-white (background)
        if (r > 240 && g > 240 && b > 240) continue;
        
        // Bin colors broadly to ignore slight lighting differences (64 wide bins)
        const binR = Math.round(r / 64) * 64;
        const binG = Math.round(g / 64) * 64;
        const binB = Math.round(b / 64) * 64;
        
        const key = `${binR},${binG},${binB}`;
        colors[key] = (colors[key] || 0) + 1;
      }
    }
    
    // Sort by most frequent
    const sorted = Object.entries(colors).sort((a, b) => b[1] - a[1]);
    // Return top 3 colors
    return sorted.slice(0, 3).map(s => s[0]);
  } catch (err) {
    console.error(`[ImageMatcher] Failed to extract colors at ${url}: ${err.message}`);
    return [];
  }
}

/**
 * Compares two color signatures. Returns 0 if there's a match, 1 if complete mismatch.
 */
function compareColors(colors1, colors2) {
  if (!colors1 || !colors2 || colors1.length === 0 || colors2.length === 0) return 0; // Ignore if we couldn't extract
  
  // See if there's at least one common color bin between the two
  const hasIntersection = colors1.some(c => colors2.includes(c));
  return hasIntersection ? 0 : 1; // 0 distance if match, 1 distance if complete mismatch
}

module.exports = {
  getImageHash,
  compareHashes,
  getColorSignature,
  compareColors
};
