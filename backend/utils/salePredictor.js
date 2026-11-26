/**
 * Sale Cycle Predictor ("Wait or Buy Now?")
 * Analyzes historical price troughs to detect supermarket sale cadences
 * (typically 3-5 week discount cycles for Australian retailers like Coles, Woolies, Amazon).
 */

function predictSaleCycle(priceHistory = [], currentPrice = null, targetPrice = null) {
  if (!Array.isArray(priceHistory) || priceHistory.length < 3) {
    const isCurrentlyDiscounted = targetPrice && currentPrice && currentPrice <= targetPrice;
    return {
      status: isCurrentlyDiscounted ? 'ON_SALE_NOW' : 'INSUFFICIENT_DATA',
      recommendation: isCurrentlyDiscounted ? 'BUY_NOW' : 'BUY_IF_NEEDED',
      badgeText: isCurrentlyDiscounted ? '🔥 Good Price' : null,
      explanation: isCurrentlyDiscounted 
        ? 'Price is currently at or below your target price.' 
        : 'Gathering price history to calculate expected discount cycles.',
      averageCycleWeeks: null,
      daysUntilPredictedSale: null,
      confidence: 'low'
    };
  }

  // Sort chronologically ascending
  const sorted = [...priceHistory].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const prices = sorted.map(p => Number(p.price)).filter(p => !isNaN(p) && p > 0);
  if (prices.length === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      recommendation: 'BUY_IF_NEEDED',
      badgeText: null,
      explanation: 'Insufficient price data.',
      averageCycleWeeks: null,
      daysUntilPredictedSale: null,
      confidence: 'low'
    };
  }

  const highest = Math.max(...prices);
  const lowest = Math.min(...prices);
  const effectiveCurrent = currentPrice || prices[prices.length - 1];

  // If price rarely changes (e.g. constant ALDI price or non-discounting staple)
  if (highest - lowest < 0.50 || (highest > 0 && (highest - lowest) / highest < 0.15)) {
    return {
      status: 'STABLE_PRICE',
      recommendation: 'BUY_NOW',
      badgeText: '✓ Everyday Flat Price',
      explanation: 'Price has remained steady with no promotional discounting cycles.',
      averageCycleWeeks: null,
      daysUntilPredictedSale: null,
      confidence: 'high'
    };
  }

  // Define a sale threshold: at least 25% below the maximum observed price
  const saleThreshold = highest * 0.75;
  const isCurrentlyOnSale = effectiveCurrent <= saleThreshold;

  // Identify distinct sale events (troughs) separated by at least 5 days
  const saleEvents = [];
  let inSale = false;
  let currentTrough = null;

  sorted.forEach(entry => {
    const p = Number(entry.price);
    const date = new Date(entry.timestamp);

    if (p <= saleThreshold) {
      if (!inSale) {
        inSale = true;
        currentTrough = { date, price: p };
      } else if (currentTrough && p < currentTrough.price) {
        currentTrough.price = p;
        currentTrough.date = date;
      }
    } else {
      if (inSale && currentTrough) {
        saleEvents.push(currentTrough);
        inSale = false;
        currentTrough = null;
      }
    }
  });

  if (inSale && currentTrough) {
    saleEvents.push(currentTrough);
  }

  const now = new Date();

  // If item is currently on sale
  if (isCurrentlyOnSale) {
    const discountPct = Math.round(((highest - effectiveCurrent) / highest) * 100);
    return {
      status: 'ON_SALE_NOW',
      recommendation: 'BUY_NOW',
      badgeText: `🔥 On Sale (${discountPct}% off)`,
      explanation: `Great time to stock up! Currently discounted by ${discountPct}% off its regular price of $${highest.toFixed(2)}.`,
      averageCycleWeeks: null,
      daysUntilPredictedSale: 0,
      confidence: 'high'
    };
  }

  // If we have at least 2 past sales, calculate the average cycle length
  if (saleEvents.length >= 2) {
    const intervalsInDays = [];
    for (let i = 1; i < saleEvents.length; i++) {
      const diffMs = saleEvents[i].date - saleEvents[i - 1].date;
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays >= 7 && diffDays <= 90) { // filter out noise
        intervalsInDays.push(diffDays);
      }
    }

    if (intervalsInDays.length > 0) {
      const avgIntervalDays = Math.round(intervalsInDays.reduce((a, b) => a + b, 0) / intervalsInDays.length);
      const avgWeeks = Math.max(1, Math.round(avgIntervalDays / 7));
      const lastSaleDate = saleEvents[saleEvents.length - 1].date;
      const daysSinceLastSale = Math.max(0, Math.round((now - lastSaleDate) / (1000 * 60 * 60 * 24)));
      const daysUntilNextSale = Math.max(0, avgIntervalDays - daysSinceLastSale);

      if (daysUntilNextSale <= 7) {
        return {
          status: 'WAIT_SALE_SOON',
          recommendation: 'WAIT',
          badgeText: `⏳ Sale Due (~${daysUntilNextSale === 0 ? 'now' : `${daysUntilNextSale}d`})`,
          explanation: `Wait if possible! Typically goes on ~30-50% off sale every ~${avgWeeks} weeks. Next discount is expected within ${daysUntilNextSale} days.`,
          averageCycleWeeks: avgWeeks,
          daysUntilPredictedSale: daysUntilNextSale,
          confidence: intervalsInDays.length >= 2 ? 'high' : 'medium'
        };
      } else {
        return {
          status: 'RECENT_SALE_PASSED',
          recommendation: 'BUY_IF_NEEDED',
          badgeText: `🔄 Next Sale in ~${Math.round(daysUntilNextSale / 7)}w`,
          explanation: `Full price ($${effectiveCurrent.toFixed(2)}). Typical discount cycle is every ~${avgWeeks} weeks; next sale expected in ~${Math.round(daysUntilNextSale / 7)} weeks.`,
          averageCycleWeeks: avgWeeks,
          daysUntilPredictedSale: daysUntilNextSale,
          confidence: 'medium'
        };
      }
    }
  }

  // Default fallback for single-sale or sparse history
  return {
    status: 'FULL_PRICE',
    recommendation: 'BUY_IF_NEEDED',
    badgeText: null,
    explanation: `Currently full price ($${effectiveCurrent.toFixed(2)}).`,
    averageCycleWeeks: null,
    daysUntilPredictedSale: null,
    confidence: 'low'
  };
}

module.exports = {
  predictSaleCycle
};
