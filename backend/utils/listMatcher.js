/**
 * List Matcher & Normalization Engine
 * Normalizes voice/external list item text and finds candidate product groups in StockSense.
 */

/**
 * Normalizes raw input text from external lists/voice assistants.
 * Extracts quantity and cleans common grocery filler words.
 */
function normalizeText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { normalizedText: '', quantity: 1 };
  }

  let text = rawText.trim().toLowerCase();

  // Strip conversational voice command prefixes
  text = text.replace(/^(please\s+|can\s+you\s+add\s+|add\s+|buy\s+|get\s+|need\s+)/i, '');
  text = text.replace(/\s+(to\s+(my\s+)?(shopping\s+)?list|to\s+cart)$/i, '');

  let quantity = 1;

  // Pattern: "3x item" or "3 x item"
  const multiplierMatch = text.match(/^(\d+)\s*[xX]\s+(.*)$/);
  if (multiplierMatch) {
    quantity = parseInt(multiplierMatch[1], 10) || 1;
    text = multiplierMatch[2];
  } else {
    // Pattern: "2 cans of tuna", "3 boxes of cereal", "2 cartons of milk", "4 packs of eggs"
    const containerMatch = text.match(/^(\d+)\s+(?:cans?|tins?|packs?|boxes?|cartons?|bottles?|bags?|loaves|tubes?|jars?)\s+(?:of\s+)?(.*)$/i);
    if (containerMatch) {
      quantity = parseInt(containerMatch[1], 10) || 1;
      text = containerMatch[2];
    } else {
      // Pattern: "2 milk", "3 bananas"
      const leadingNumberMatch = text.match(/^(\d+)\s+([a-zA-Z].*)$/);
      if (leadingNumberMatch) {
        quantity = parseInt(leadingNumberMatch[1], 10) || 1;
        text = leadingNumberMatch[2];
      }
    }
  }

  // Remove common filler words
  text = text
    .replace(/\b(can|tin|pack|box|carton|bottle|bag|jar|of|the|a|an)\b/gi, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    normalizedText: text || rawText.trim().toLowerCase(),
    quantity: Math.max(1, quantity)
  };
}

/**
 * Tokenize a string into alphanumeric words, ignoring common stop words.
 */
function tokenize(str) {
  if (!str) return [];
  const stopWords = new Set(['and', 'or', 'with', 'for', 'in', 'on', 'at', 'to', 'from', 'a', 'an', 'the']);
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
}

/**
 * Computes word overlap / similarity score between two strings (0.0 to 1.0).
 */
function computeSimilarity(query, target) {
  if (!query || !target) return 0;
  const qLower = query.toLowerCase();
  const tLower = target.toLowerCase();

  // Exact match
  if (qLower === tLower) return 1.0;
  // Substring inclusion
  if (tLower.includes(qLower)) return 0.9;
  if (qLower.includes(tLower)) return 0.85;

  const qTokens = tokenize(qLower);
  const tTokens = tokenize(tLower);

  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  const targetSet = new Set(tTokens);
  let matches = 0;

  for (const token of qTokens) {
    if (targetSet.has(token)) {
      matches++;
    } else {
      // Partial prefix/stem match (e.g. "kangaroo" vs "kangaroos", "mince" vs "minced")
      const hasPrefix = tTokens.some(t => t.startsWith(token) || token.startsWith(t));
      if (hasPrefix) matches += 0.8;
    }
  }

  // Jaccard-like score with query bias
  const recall = matches / qTokens.length;
  const precision = matches / tTokens.length;
  return (recall * 0.7) + (precision * 0.3);
}

function getRetailerName(url) {
  if (!url) return 'Unknown';
  const lower = url.toLowerCase();
  if (lower.includes('coles.com.au')) return 'Coles';
  if (lower.includes('woolworths.com.au')) return 'Woolworths';
  if (lower.includes('amazon.')) return 'Amazon';
  if (lower.includes('chemistwarehouse.com.au')) return 'Chemist Warehouse';
  if (lower.includes('petcircle.com.au')) return 'Pet Circle';
  if (lower.includes('bunnings.com.au')) return 'Bunnings';
  if (lower.includes('jbhifi.com.au')) return 'JB Hi-Fi';
  if (lower.includes('thegoodguys.com.au')) return 'The Good Guys';
  if (lower.includes('petbarn.com.au')) return 'Petbarn';
  if (lower.includes('petstock.com.au')) return 'Petstock';
  if (lower.includes('petchemist.com.au')) return 'Pet Chemist';
  if (lower.includes('budgetpetproducts.com.au')) return 'Budget Pet Products';
  return 'Online Store';
}

/**
 * Find candidate product groups in StockSense for a given raw text.
 * @param {string} rawText Raw voice/list item text (e.g. "kangaroo mince")
 * @param {object} db SQLite database instance
 * @returns {Promise<{ mapping: object|null, normalizedText: string, quantity: number, candidates: Array }>}
 */
function findCandidates(rawText, db) {
  return new Promise((resolve, reject) => {
    const { normalizedText, quantity } = normalizeText(rawText);

    // 1. Check if an explicit mapping exists in list_mappings
    db.get(
      `SELECT lm.*, pg.name as groupName, pg.currentPrice, pg.lowestPrice, pg.isOnSale
       FROM list_mappings lm
       JOIN product_groups pg ON lm.group_id = pg.id
       WHERE lm.raw_text = ? OR lm.normalized_text = ?`,
      [rawText.trim().toLowerCase(), normalizedText],
      (err, mapping) => {
        if (err) return reject(err);

        // Fetch all product groups and their items
        db.all(
          `SELECT 
             pg.id as groupId,
             pg.name as groupName,
             pg.currentPrice as groupPrice,
             pg.lowestPrice as groupLowestPrice,
             pg.isOnSale as groupOnSale,
             pg.unitPriceDisplay,
             i.id as itemId,
             i.name as itemName,
             i.url as itemUrl,
             i.currentPrice as itemPrice,
             i.rawPrice as itemRawPrice,
             i.lowestPrice as itemLowestPrice,
             i.isOnSale as itemOnSale,
             i.imageUrl as itemImageUrl
           FROM product_groups pg
           LEFT JOIN items i ON i.group_id = pg.id
           ORDER BY pg.name ASC`,
          [],
          (err, rows) => {
            if (err) return reject(err);

            // Group rows by groupId
            const groupsMap = new Map();
            for (const row of rows) {
              if (!groupsMap.has(row.groupId)) {
                groupsMap.set(row.groupId, {
                  id: row.groupId,
                  name: row.groupName,
                  lowestPrice: row.groupLowestPrice || row.groupPrice || null,
                  isOnSale: !!row.groupOnSale,
                  unitPriceDisplay: row.unitPriceDisplay || null,
                  imageUrl: null,
                  items: []
                });
              }
              const g = groupsMap.get(row.groupId);
              if (row.itemId) {
                if (!g.imageUrl && row.itemImageUrl) {
                  g.imageUrl = row.itemImageUrl;
                }
                const retailerName = getRetailerName(row.itemUrl);
                g.items.push({
                  id: row.itemId,
                  name: row.itemName,
                  retailer: retailerName,
                  currentPrice: row.itemPrice,
                  rawPrice: row.itemRawPrice,
                  lowestPrice: row.itemLowestPrice,
                  isOnSale: !!row.itemOnSale,
                  url: row.itemUrl,
                  imageUrl: row.itemImageUrl
                });
              }
            }

            const candidateList = [];

            for (const group of groupsMap.values()) {
              // Score against group name
              let groupScore = computeSimilarity(normalizedText, group.name);

              // Also score against individual item names under this group
              let maxItemScore = 0;
              let bestItem = null;
              for (const it of group.items) {
                const itScore = computeSimilarity(normalizedText, it.name);
                if (itScore > maxItemScore) {
                  maxItemScore = itScore;
                  bestItem = it;
                }
              }

              const bestScore = Math.max(groupScore, maxItemScore);
              if (bestScore >= 0.25 || (mapping && mapping.group_id === group.id)) {
                // Determine lowest price and store across items
                let cheapestPrice = null;
                let cheapestRetailer = null;
                for (const it of group.items) {
                  if (it.currentPrice != null && (cheapestPrice == null || it.currentPrice < cheapestPrice)) {
                    cheapestPrice = it.currentPrice;
                    cheapestRetailer = it.retailer;
                  }
                }

                candidateList.push({
                  id: group.id,
                  name: group.name,
                  score: Math.round(bestScore * 100) / 100,
                  lowestPrice: cheapestPrice ?? group.lowestPrice,
                  lowestRetailer: cheapestRetailer,
                  unitPriceDisplay: group.unitPriceDisplay,
                  imageUrl: group.imageUrl,
                  itemCount: group.items.length,
                  items: group.items.map(it => ({
                    id: it.id,
                    retailer: it.retailer,
                    name: it.name,
                    price: it.currentPrice,
                    isOnSale: it.isOnSale,
                    url: it.url
                  }))
                });
              }
            }

            // Sort candidates by match score descending
            candidateList.sort((a, b) => b.score - a.score);

            resolve({
              rawText,
              normalizedText,
              quantity,
              isMapped: !!mapping,
              mapping: mapping || null,
              candidates: candidateList.slice(0, 5)
            });
          }
        );
      }
    );
  });
}

module.exports = {
  normalizeText,
  tokenize,
  computeSimilarity,
  findCandidates
};
