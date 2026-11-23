/**
 * Affiliate & Associate Link Generator Utility for StockSense
 * Handles Amazon Associate tags and general affiliate network redirects (Commission Factory, Skimlinks, etc.)
 */

function extractAmazonAsin(url) {
  if (!url) return null;
  const matches = [
    url.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i),
    url.match(/\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i),
    url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/i)
  ];

  for (const match of matches) {
    if (match && match[1]) return match[1].toUpperCase();
  }

  return null;
}

function isAmazonUrl(url) {
  if (!url) return false;
  return /amazon\.(com\.au|com|co\.uk|de|co\.jp|ca|fr|es|it)/i.test(url) || /amzn\.(to|asia)/i.test(url);
}

/**
 * Builds an Amazon Add-to-Cart direct checkout link with associate tag.
 */
function buildAmazonCartLink(url, associateTag = '') {
  if (!url || !isAmazonUrl(url)) return null;

  const asin = extractAmazonAsin(url);
  if (!asin) return null;

  const tag = (associateTag || process.env.AMAZON_ASSOCIATE_TAG || process.env.AMAZON_AFFILIATE_TAG || '').trim();
  const domainMatch = url.match(/amazon\.([a-z\.]+)/i);
  const domain = domainMatch ? domainMatch[1] : 'com.au';

  const params = new URLSearchParams({
    'ASIN.1': asin,
    'Quantity.1': '1'
  });

  if (tag) {
    params.set('tag', tag);
  }

  return `https://www.amazon.${domain}/gp/aws/cart/add.html?${params.toString()}`;
}

/**
 * Attaches the appropriate affiliate tag or redirect prefix to a URL.
 * 
 * @param {string} url - Original destination URL
 * @param {string|object} settingsOrTag - Either settings object { amazonAssociateTag, affiliatePrefix } or a tag string
 * @param {string} [prefix] - Optional affiliate network prefix if first param is string tag
 * @returns {string} The monetized affiliate URL
 */
function buildAffiliateUrl(url, settingsOrTag = '', prefix = '') {
  if (!url) return url;

  let amazonTag = '';
  let affiliatePrefix = '';

  if (typeof settingsOrTag === 'object' && settingsOrTag !== null) {
    amazonTag = (settingsOrTag.amazonAssociateTag || process.env.AMAZON_ASSOCIATE_TAG || process.env.AMAZON_AFFILIATE_TAG || '').trim();
    affiliatePrefix = (settingsOrTag.affiliatePrefix || '').trim();
  } else {
    amazonTag = (settingsOrTag || process.env.AMAZON_ASSOCIATE_TAG || process.env.AMAZON_AFFILIATE_TAG || '').trim();
    affiliatePrefix = (prefix || '').trim();
  }

  // 1. Amazon URLs -> inject tag parameter
  if (isAmazonUrl(url)) {
    if (!amazonTag) return url;
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('tag', amazonTag);
      return parsed.toString();
    } catch (e) {
      // Fallback for malformed URLs
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}tag=${encodeURIComponent(amazonTag)}`;
    }
  }

  // 2. Non-Amazon URLs -> apply affiliate network prefix or redirect template if configured
  if (affiliatePrefix) {
    if (affiliatePrefix.includes('{url}')) {
      return affiliatePrefix.replace('{url}', url);
    }
    if (affiliatePrefix.includes('{encodedUrl}')) {
      return affiliatePrefix.replace('{encodedUrl}', encodeURIComponent(url));
    }
    // Prefix style like "https://t.cfjump.com/12345/t/67890?Url="
    if (affiliatePrefix.endsWith('=') || affiliatePrefix.endsWith('/')) {
      return `${affiliatePrefix}${encodeURIComponent(url)}`;
    }
    return `${affiliatePrefix}${encodeURIComponent(url)}`;
  }

  return url;
}

module.exports = {
  extractAmazonAsin,
  isAmazonUrl,
  buildAmazonCartLink,
  buildAffiliateUrl
};
