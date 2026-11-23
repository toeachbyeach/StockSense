/**
 * Affiliate & Associate Link Generator Utility for Frontend
 * Ensures all outbound product and cart clicks attach monetization tags.
 */

export function extractAmazonAsin(url) {
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

export function isAmazonUrl(url) {
  if (!url) return false;
  return /amazon\.(com\.au|com|co\.uk|de|co\.jp|ca|fr|es|it)/i.test(url) || /amzn\.(to|asia)/i.test(url);
}

/**
 * Builds an Amazon Add-to-Cart direct checkout link with associate tag.
 */
export function buildAmazonCartLink(url, associateTag = '') {
  if (!url || !isAmazonUrl(url)) return null;

  const asin = extractAmazonAsin(url);
  if (!asin) return null;

  const tag = (associateTag || '').trim();
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
 * Attaches the configured affiliate tag or redirect prefix to an outgoing store URL.
 * 
 * @param {string} url - Destination product URL
 * @param {string|object} settingsOrTag - Either settings object or Amazon associate tag string
 * @param {string} [prefix] - Optional affiliate network prefix template
 * @returns {string} The monetized affiliate URL
 */
export function buildAffiliateUrl(url, settingsOrTag = '', prefix = '') {
  if (!url) return url;

  let amazonTag = '';
  let affiliatePrefix = '';

  if (typeof settingsOrTag === 'object' && settingsOrTag !== null) {
    amazonTag = (settingsOrTag.amazonAssociateTag || '').trim();
    affiliatePrefix = (settingsOrTag.affiliatePrefix || '').trim();
  } else {
    amazonTag = (settingsOrTag || '').trim();
    affiliatePrefix = (prefix || '').trim();
  }

  // Fallback to cached local settings if not explicitly passed
  if (!amazonTag && !affiliatePrefix && typeof window !== 'undefined') {
    try {
      const cached = JSON.parse(localStorage.getItem('stocksense_affiliate_settings') || '{}');
      if (cached.amazonAssociateTag) amazonTag = cached.amazonAssociateTag;
      if (cached.affiliatePrefix) affiliatePrefix = cached.affiliatePrefix;
    } catch (e) {
      // ignore
    }
  }

  // 1. Amazon URLs -> inject tag parameter
  if (isAmazonUrl(url)) {
    if (!amazonTag) return url;
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('tag', amazonTag);
      return parsed.toString();
    } catch (e) {
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
    if (affiliatePrefix.endsWith('=') || affiliatePrefix.endsWith('/')) {
      return `${affiliatePrefix}${encodeURIComponent(url)}`;
    }
    return `${affiliatePrefix}${encodeURIComponent(url)}`;
  }

  return url;
}
