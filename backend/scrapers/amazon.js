const { launchBrowser, safeCloseBrowser, withScraperLock } = require('./browserHelper');
const log = require('../logger');

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/114.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/114.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15"
];

function randomDelay(min, max) {
  return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));
}

async function scrapeAmazon(url) {
  return withScraperLock(() => doScrapeAmazon(url));
}

async function doScrapeAmazon(url) {
  let browser;
  log(`[Amazon] Starting scrape for URL: ${url}`);
  try {
    log(`[Amazon] Launching Puppeteer with stealth plugins...`);
    browser = await launchBrowser([
      "--disable-infobars",
      "--window-size=1920,1080"
    ]);
    
    log(`[Amazon] Browser launched. Creating new page...`);
    const page = await browser.newPage();
    
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    log(`[Amazon] Navigating to URL (Waiting for DOM)...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }).catch(() => {});
    
    log(`[Amazon] Page loaded. Simulating human-like delay...`);
    await randomDelay(1500, 3000);
    
    log(`[Amazon] Checking for Amazon Captcha block...`);
    const isCaptcha = await page.$('form[action="/errors/validateCaptcha"]');
    if (isCaptcha) {
      log(`[Amazon] CAPTCHA DETECTED! Direct scraping blocked for this request.`, 'ERROR');
      return null;
    }
    
    log(`[Amazon] Extracting product information from DOM...`);
    let result = {
      name: '',
      price: null,
      inStock: 'Unknown',
      imageUrl: null,
      shippingPrice: 0,
      isPrime: false,
      rawPrice: null
    };

    result.name = await page.$eval('#productTitle', el => el.textContent.trim()).catch(() => '');
    log(`[Amazon] Extracted name: ${result.name.substring(0, 30)}...`);
    
    // Check availability and buybox structure FIRST.
    const pageState = await page.evaluate(() => {
      const availEl = document.querySelector('#availability');
      const availText = availEl ? (availEl.innerText || '').trim().toLowerCase() : '';

      const buybox = document.querySelector('#buybox, #desktop_buybox, #unqualifiedBuyBox_feature_div');
      const buyboxText = buybox ? (buybox.innerText || '').trim().toLowerCase() : '';

      const hasSeeAllOptions = buyboxText.includes('see all buying options') ||
        buyboxText.includes('available from these sellers') ||
        !!document.querySelector('#buybox-see-all-buying-choices, #unqualifiedBuyBox_feature_div');

      const bodyText = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';

      // Common unavailable phrases
      const isUnavailable = availText.includes('currently unavailable') ||
        availText.includes('out of stock') ||
        availText.includes('temporarily unavailable') ||
        availText.includes('temporarily out of stock') ||
        availText.includes('unavailable') ||
        bodyText.includes("we don't know when or if this item will be back in stock") ||
        bodyText.includes('we do not know when or if this item will be back in stock');

      const isInStock = availText.includes('in stock');

      return { availText, buyboxText, hasSeeAllOptions, isUnavailable, isInStock, bodyText };
    });

    // Additional heuristics: some pages show a buybox but contain messaging
    // like "Temporarily out of stock" or "Order now and we'll deliver when
    // available" in the buybox text. Treat those as Out of Stock too.
    const buyboxIndicatesBackorder = pageState.buyboxText && (
      pageState.buyboxText.includes("temporarily out of stock") ||
      pageState.buyboxText.includes("order now and we'll deliver") ||
      (pageState.buyboxText.includes("order now and we") && pageState.buyboxText.includes('deliver')) ||
      pageState.bodyText && (pageState.bodyText.includes("we don't know when or if this item will be back in stock") || pageState.bodyText.includes('we do not know when or if this item will be back in stock'))
    );

    if (pageState.isUnavailable || buyboxIndicatesBackorder) {
      result.inStock = 'Out of Stock';
      result.status = 'Out of Stock';
      result.price = null; // Ensure we don't surface an incorrect price when OOS
      log(`[Amazon] Item treated as OUT OF STOCK (avail: "${pageState.availText.substring(0,60)}" buybox: "${pageState.buyboxText.substring(0,60)}").`);
    } else if (pageState.isInStock) {
      result.inStock = 'In Stock';
    } else {
      result.inStock = 'Unknown';
    }

    if (!pageState.isUnavailable) {
      let price = null;
      let candidates = [];

      try {
        const found = await page.evaluate(() => {
          // Explicitly exclude carousels, sponsored products, recommendation widgets,
          // and comparison tables. These frequently contain prices of OTHER products.
          const isExcluded = (el) => {
            return !!el.closest(
              '.a-carousel, .a-carousel-card, [id*="sp_detail"], [id*="sponsored"], ' +
              '[id*="similarities"], [id*="comparison"], [id*="bundle"], [id*="session-sims"], ' +
              '[class*="sims"], [id*="recs"], [id*="recommendation"], #HLCXComparisonWidget_feature_div, ' +
              '#desktop-dp-sims_purchase-similarities-sims-feature, #dp-ads-center-promo, .rhf-border'
            );
          };

          const parseWholeFraction = (priceEl) => {
            if (!priceEl || isExcluded(priceEl)) return null;
            const whole = priceEl.querySelector('.a-price-whole');
            if (!whole) return null;
            const wholeNum = (whole.textContent || '').replace(/[^0-9]/g, '');
            if (!wholeNum) return null;
            const frac = priceEl.querySelector('.a-price-fraction');
            const fracNum = frac ? (frac.textContent || '').replace(/[^0-9]/g, '') : '00';
            const parsed = parseFloat(wholeNum + '.' + fracNum);
            return isNaN(parsed) ? null : parsed;
          };

          const parseOffscreen = (priceEl) => {
            if (!priceEl || isExcluded(priceEl)) return null;
            const off = priceEl.querySelector('.a-offscreen');
            if (!off) return null;
            const match = (off.textContent || '').match(/[\d]+(?:[.,][\d]{2})?/);
            if (!match) return null;
            const parsed = parseFloat(match[0].replace(',', '.'));
            return isNaN(parsed) ? null : parsed;
          };

          // 1. Primary price containers in priority order
          const primaryContainers = [
            document.querySelector('#corePriceDisplay_desktop_feature_div'),
            document.querySelector('#corePrice_feature_div'),
            document.querySelector('#apex_desktop'),
            document.querySelector('#price_inside_buybox'),
            document.querySelector('#desktop_buybox #price_inside_buybox')
          ].filter(Boolean);

          for (const container of primaryContainers) {
            if (isExcluded(container)) continue;
            // Target the actual price element (note: .apex-pricetopay-value without hyphens)
            const priceToPay = container.querySelector('.priceToPay, .apex-pricetopay-value');
            if (priceToPay && !isExcluded(priceToPay)) {
              const v = parseWholeFraction(priceToPay) || parseOffscreen(priceToPay);
              if (v !== null && v >= 1) return { price: v, candidates: [v] };
            }
            // Fallback inside primary container
            const aPrice = container.querySelector('.a-price:not(.a-text-price):not(.apex-basis-price-value)');
            if (aPrice && !isExcluded(aPrice)) {
              const v = parseWholeFraction(aPrice) || parseOffscreen(aPrice);
              if (v !== null && v >= 1) return { price: v, candidates: [v] };
            }
          }

          // 2. Buybox container (scoped, excluding any embedded widgets)
          const buybox = document.querySelector('#buybox, #desktop_buybox');
          if (buybox && !isExcluded(buybox)) {
            const values = [];
            buybox.querySelectorAll('.a-price:not(.a-text-price):not(.apex-basis-price-value)').forEach(el => {
              if (!isExcluded(el)) {
                const v = parseWholeFraction(el) || parseOffscreen(el);
                if (v !== null && v >= 1) values.push(v);
              }
            });
            if (values.length) {
              const minPrice = Math.min(...values);
              return { price: minPrice, candidates: values };
            }
          }

          return { price: null, candidates: [] };
        });

        price = found.price;
        candidates = found.candidates || [];
        if (price !== null) {
          log(`[Amazon] Found price: $${price} (candidates: ${JSON.stringify(candidates)})`);
        }
      } catch (e) {
        candidates = [];
      }

      // If no buybox price was found and the item only has "See All Buying Options",
      // treat it as having no direct price (Out of Stock / No Buybox Offer).
      if ((price === null || isNaN(price)) && pageState.hasSeeAllOptions) {
        result.inStock = 'Out of Stock';
        log(`[Amazon] Item has 'See All Buying Options' and no direct buybox offer. Treating as Out of Stock.`);
      }

      result.price = price;
      // Detect Subscribe & Save price: look for SNS blocks offering a lower "subscribe" price
      try {
        const sns = await page.evaluate(() => {
          // Common SNS element contains 'Subscribe & Save' text and an associated price element
          const snsNode = Array.from(document.querySelectorAll('div, span')).find(el => (el.innerText || '').toLowerCase().includes('subscribe & save') || (el.innerText || '').toLowerCase().includes('subscribe & save price'));
          if (!snsNode) return null;
          // Search nearby for a price string
          const priceEl = snsNode.closest('div')?.querySelector('.a-price .a-offscreen') || snsNode.querySelector('.a-price .a-offscreen') || snsNode.querySelector('.a-price-whole');
          if (!priceEl) return null;
          const m = (priceEl.textContent || '').match(/[\d]+(?:[.,][\d]{2})?/);
          if (!m) return null;
          return parseFloat(m[0].replace(',', '.'));
        });

        if (sns && !isNaN(sns)) {
          result.subscribePrice = sns;
          result.subscribeSave = true;
          log(`[Amazon] Detected Subscribe & Save price: $${sns}`);
        }
      } catch (e) {
        // ignore
      }
      if (price !== null && !isNaN(price)) {
        log(`[Amazon] Final price: $${price}`);
      }
    }
    
    // Wait up to 6s for Amazon's dynamic delivery promise AJAX to populate inside buybox
    await page.waitForFunction(() => {
      const bb = document.querySelector('#buybox, #desktop_buybox');
      if (!bb) return false;
      return bb.querySelector('[data-csa-c-delivery-price]') || /\$\s*[\d,]+(?:\.\d{2})?\s+(?:[a-zA-Z]+\s+)?delivery/i.test(bb.innerText) || /free\s+delivery/i.test(bb.innerText);
    }, { timeout: 6000 }).catch(() => {});

    // Extract delivery / postage price and Prime eligibility
    try {
      const deliveryInfo = await page.evaluate(() => {
        const buybox = document.querySelector('#buybox, #desktop_buybox');
        if (!buybox) return { isPrime: false, shippingPrice: 0 };

        const buyboxText = buybox.innerText || '';

        // 1. Prime Detection inside buybox
        const primeSelectors = [
          'i.a-icon-prime',
          'span.a-icon-prime',
          '.a-icon-prime',
          '#prime-badge',
          '[aria-label*="Prime"]',
          '[alt*="Prime"]',
          '#primeExclusivePricingMessage',
          '#bbop-check-box'
        ];

        let isPrime = false;
        for (const sel of primeSelectors) {
          if (buybox.querySelector(sel)) { isPrime = true; break; }
        }
        if (!isPrime) {
          const primeTextRegex = /free\s+delivery\s+(?:with|for)\s+prime|prime\s+(?:free\s+)?delivery|free\s+delivery\s+on\s+(?:eligible\s+)?orders\s+over\s+\$\d+\s+for\s+prime/i;
          if (primeTextRegex.test(buyboxText)) {
            isPrime = true;
          }
        }

        // 2. Shipping / Delivery Cost Detection inside buybox
        let shippingPrice = null;

        // Check data-csa-c-delivery-price on buybox elements
        const priceAttrElements = buybox.querySelectorAll('[data-csa-c-delivery-price]');
        for (const el of priceAttrElements) {
          const val = (el.getAttribute('data-csa-c-delivery-price') || '').trim();
          if (/^free$/i.test(val)) {
            shippingPrice = 0;
            break;
          }
          if (val === 'fastest') continue; // Skip fastest delivery option
          const match = val.match(/\$?\s*([\d,]+(?:\.\d{2})?)/);
          if (match) {
            const parsed = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(parsed) && parsed > 0) {
              shippingPrice = parsed;
              break;
            }
          }
        }

        // If not found via attribute, scan buybox text for delivery patterns
        if (shippingPrice === null) {
          const patterns = [
            /\$\s*([\d,]+(?:\.\d{2})?)\s+(?:(?:international|standard|express)\s+)?delivery/i,
            /delivery\s*(?:charge|fee|cost)?\s*:\s*\$\s*([\d,]+(?:\.\d{2})?)/i,
            /\+\s*\$\s*([\d,]+(?:\.\d{2})?)\s+(?:delivery|postage|shipping)/i,
            /\$\s*([\d,]+(?:\.\d{2})?)\s+(?:postage|shipping)/i
          ];

          for (const pat of patterns) {
            const m = buyboxText.match(pat);
            if (m) {
              const parsed = parseFloat(m[1].replace(/,/g, ''));
              if (!isNaN(parsed) && parsed > 0) {
                shippingPrice = parsed;
                break;
              }
            }
          }

          if (shippingPrice === null && /free\s+delivery|free\s+shipping/i.test(buyboxText)) {
            shippingPrice = 0;
          }
        }

        return { isPrime, shippingPrice: shippingPrice !== null ? shippingPrice : 0 };
      });

      result.isPrime = deliveryInfo.isPrime;
      result.shippingPrice = deliveryInfo.shippingPrice !== null ? deliveryInfo.shippingPrice : 0;
      result.rawPrice = result.price;
      log(`[Amazon] Delivery info: shippingPrice=$${result.shippingPrice}, isPrime=${result.isPrime}`);
    } catch (e) {
      log(`[Amazon] Error extracting delivery info: ${e.message}`, 'WARN');
    }

    // Extract Used & Amazon Resale offers
    result.usedPrice = null;
    result.usedRawPrice = null;
    result.usedShippingPrice = 0;
    result.usedIsPrime = false;
    result.usedCondition = null;
    result.usedConditionNote = null;
    result.usedSeller = null;
    result.usedShipsFrom = null;
    result.usedOffers = [];

    try {
      log(`[Amazon] Checking for Used and Amazon Resale offers...`);
      const extractedUsed = await page.evaluate(async () => {
        const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');

        const parsePriceFromEl = (el) => {
          if (!el) return null;
          const off = el.querySelector('.aok-offscreen, .apex-pricetopay-accessibility-label, .a-price .a-offscreen');
          if (off) {
            const m = (off.textContent || '').match(/[\d]+(?:[.,][\d]{2})?/);
            if (m) return parseFloat(m[0].replace(',', '.'));
          }
          const whole = el.querySelector('.a-price-whole');
          if (whole) {
            const wholeNum = (whole.textContent || '').replace(/[^0-9]/g, '');
            const frac = el.querySelector('.a-price-fraction');
            const fracNum = frac ? (frac.textContent || '').replace(/[^0-9]/g, '') : '00';
            const p = parseFloat(wholeNum + '.' + fracNum);
            if (!isNaN(p)) return p;
          }
          const text = el.innerText || el.textContent || '';
          const m = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
          if (m) return parseFloat(m[1].replace(/,/g, ''));
          return null;
        };

        const parseDeliveryInfo = (text) => {
          const lower = (text || '').toLowerCase();
          let shippingPrice = 0;
          let isPrime = lower.includes('prime');
          if (lower.includes('free delivery') || lower.includes('free international delivery') || lower.includes('free shipping')) {
            shippingPrice = 0;
          } else {
            const m = lower.match(/\$\s*([\d,]+(?:\.\d{2})?)\s+(?:(?:international|standard|express)\s+)?delivery/i) ||
                      lower.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*(?:postage|shipping)?/i);
            if (m) {
              const p = parseFloat(m[1].replace(/,/g, ''));
              if (!isNaN(p) && p > 0) shippingPrice = p;
            }
          }
          return { shippingPrice, isPrime };
        };

        const offers = [];

        // 1. Direct usedAccordionRow / usedBuyBox on main page
        const usedRow = document.querySelector('#usedAccordionRow, #usedBuyBox');
        if (usedRow) {
          const p = parsePriceFromEl(usedRow);
          const condEl = document.querySelector('#usedAccordionCaption_feature_div, #usedAccordionRow .a-accordion-row-a11y');
          let cond = clean(condEl?.innerText || 'Used');
          if (cond.includes('$')) cond = cond.split('$')[0].trim();
          
          const noteEl = document.querySelector('#usedBuyBoxConditionNote_feature_div, #usedAccordionRow #usedBuyBoxConditionNote_feature_div');
          let conditionNote = clean(noteEl?.innerText || '');
          conditionNote = conditionNote.replace(/See more$/i, '').trim();

          const delEl = document.querySelector('#usedDeliveryBlockContainer, #usedAccordionRow [id*="delivery"]');
          const delText = clean(delEl?.innerText || '');
          const delInfo = parseDeliveryInfo(delText);

          const sellerEl = usedRow.querySelector('#merchant-info, [id*="soldBy"], .sfsb-header-text, #sfsb_accordion_head');
          let sellerText = clean(sellerEl?.innerText || '');
          let seller = 'Amazon Resale';
          if (sellerText.toLowerCase().includes('amazon resale')) seller = 'Amazon Resale';
          else if (sellerText) seller = sellerText;

          if (p !== null) {
            offers.push({
              condition: cond || 'Used',
              conditionNote,
              price: p,
              rawPrice: p,
              shippingPrice: delInfo.shippingPrice,
              isPrime: delInfo.isPrime || seller.toLowerCase().includes('amazon'),
              deliveryText: delText,
              seller,
              shipsFrom: 'Amazon AU',
              isUsed: true,
              isAmazonResale: seller.toLowerCase().includes('amazon resale')
            });
          }
        }

        // Check for AOD trigger link
        const aodEl = document.querySelector('#aod-ingress-link, a[href*="all-offers-display"], #olpLinkWidget_feature_div a, #buybox-see-all-buying-choices, #dynamic-aod-ingress-box a');
        const aodText = clean(aodEl?.innerText || document.querySelector('#olpLinkWidget_feature_div, #dynamic-aod-ingress-box')?.innerText || '');
        const mentionsUsed = /used/i.test(aodText);

        return {
          directOffers: offers,
          hasAodLink: !!aodEl,
          mentionsUsed
        };
      });

      let allOffers = [...(extractedUsed.directOffers || [])];

      // If AOD link exists and either mentions Used or we want to expand all options
      if (extractedUsed.hasAodLink && (extractedUsed.mentionsUsed || allOffers.length === 0)) {
        try {
          const aodLink = await page.$('#aod-ingress-link, a[href*="all-offers-display"], #olpLinkWidget_feature_div a, #buybox-see-all-buying-choices, #dynamic-aod-ingress-box a');
          if (aodLink) {
            log(`[Amazon] Opening All Offers Display to parse complete condition listings...`);
            await aodLink.click();
            await page.waitForSelector('#aod-offer-list, #aod-offer, [id^="aod-offer"]', { timeout: 4000 }).catch(() => {});
            await randomDelay(1000, 1500);

            const aodOffers = await page.evaluate(() => {
              const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');

              const parsePriceFromEl = (el) => {
                if (!el) return null;
                const off = el.querySelector('.aok-offscreen, .apex-pricetopay-accessibility-label, .a-price .a-offscreen');
                if (off) {
                  const m = (off.textContent || '').match(/[\d]+(?:[.,][\d]{2})?/);
                  if (m) return parseFloat(m[0].replace(',', '.'));
                }
                const whole = el.querySelector('.a-price-whole');
                if (whole) {
                  const wholeNum = (whole.textContent || '').replace(/[^0-9]/g, '');
                  const frac = el.querySelector('.a-price-fraction');
                  const fracNum = frac ? (frac.textContent || '').replace(/[^0-9]/g, '') : '00';
                  const p = parseFloat(wholeNum + '.' + fracNum);
                  if (!isNaN(p)) return p;
                }
                const text = el.innerText || el.textContent || '';
                const m = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
                if (m) return parseFloat(m[1].replace(/,/g, ''));
                return null;
              };

              const parseDeliveryInfo = (text) => {
                const lower = (text || '').toLowerCase();
                let shippingPrice = 0;
                let isPrime = lower.includes('prime');
                if (lower.includes('free delivery') || lower.includes('free international delivery') || lower.includes('free shipping')) {
                  shippingPrice = 0;
                } else {
                  const m = lower.match(/\$\s*([\d,]+(?:\.\d{2})?)\s+(?:(?:international|standard|express)\s+)?delivery/i) ||
                            lower.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*(?:postage|shipping)?/i);
                  if (m) {
                    const p = parseFloat(m[1].replace(/,/g, ''));
                    if (!isNaN(p) && p > 0) shippingPrice = p;
                  }
                }
                return { shippingPrice, isPrime };
              };

              const list = Array.from(document.querySelectorAll('#aod-offer-list > div, #aod-offer, [id^="aod-offer"], #aod-pinned-offer'));
              const res = [];
              for (const el of list) {
                const condEl = el.querySelector('#aod-offer-heading, [id*="condition"], [id*="heading"]');
                let cond = clean(condEl?.innerText || '');
                if (!cond) continue;

                const p = parsePriceFromEl(el);
                if (p === null) continue;

                const noteEl = el.querySelector('#aod-offer-condition-note, [id*="condition-note"], .aod-condition-details');
                let note = clean(noteEl?.innerText || '');
                if (!note) {
                  const fullText = el.innerText || '';
                  const matchNote = fullText.match(/Condition\s*\n\s*([^\n]+)/i);
                  if (matchNote) note = clean(matchNote[1]);
                }

                const sellerEl = el.querySelector('#aod-offer-soldBy, [id*="soldBy"], [id*="seller"]');
                let seller = clean(sellerEl?.innerText || '');
                seller = seller.replace(/^Sold by\s*/i, '').trim();

                const shipsEl = el.querySelector('#aod-offer-shipsFrom, [id*="shipsFrom"]');
                let shipsFrom = clean(shipsEl?.innerText || '');
                shipsFrom = shipsFrom.replace(/^Ships from\s*/i, '').trim();

                const delEl = el.querySelector('#aod-offer-delivery, [id*="delivery"], #aod-delivery-promise');
                const delText = clean(delEl?.innerText || '');
                const delInfo = parseDeliveryInfo(delText);

                const isPrime = delInfo.isPrime || seller.toLowerCase().includes('amazon') || shipsFrom.toLowerCase().includes('amazon');
                const isUsed = /used|refurbished|renewed|resale|warehouse|pre-owned/i.test(cond);

                res.push({
                  condition: cond,
                  conditionNote: note,
                  price: p,
                  rawPrice: p,
                  shippingPrice: delInfo.shippingPrice,
                  isPrime,
                  deliveryText: delText,
                  seller: seller || (isUsed ? 'Amazon Resale' : 'Amazon AU'),
                  shipsFrom: shipsFrom || 'Amazon AU',
                  isUsed,
                  isAmazonResale: seller.toLowerCase().includes('amazon resale') || seller.toLowerCase().includes('warehouse')
                });
              }
              return res;
            });

            if (aodOffers && aodOffers.length > 0) {
              allOffers = [...allOffers, ...aodOffers];
            }
          }
        } catch (aodErr) {
          log(`[Amazon] AOD inspection skipped: ${aodErr.message}`, 'WARN');
        }
      }

      // Deduplicate offers by condition, price, seller
      const dedupedOffers = [];
      const seenKeys = new Set();
      for (const off of allOffers) {
        const key = `${off.condition.toLowerCase()}_${off.price}_${off.seller.toLowerCase()}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          dedupedOffers.push(off);
        }
      }

      const usedOffers = dedupedOffers.filter(o => o.isUsed);
      if (usedOffers.length > 0) {
        // Sort lowest price first
        usedOffers.sort((a, b) => a.price - b.price);
        const bestUsed = usedOffers[0];
        result.usedPrice = bestUsed.price;
        result.usedRawPrice = bestUsed.rawPrice;
        result.usedShippingPrice = bestUsed.shippingPrice;
        result.usedIsPrime = bestUsed.isPrime;
        result.usedCondition = bestUsed.condition;
        result.usedConditionNote = bestUsed.conditionNote;
        result.usedSeller = bestUsed.seller;
        result.usedShipsFrom = bestUsed.shipsFrom;
        result.usedOffers = usedOffers;
        log(`[Amazon] Found ${usedOffers.length} Used/Resale offer(s). Best Used: $${result.usedPrice} (${result.usedCondition} · ${result.usedSeller})`);
      }
    } catch (usedErr) {
      log(`[Amazon] Used offer extraction error: ${usedErr.message}`, 'WARN');
    }

    result.imageUrl = await page.$eval('#landingImage', el => el.getAttribute('src')).catch(() => null);

    // Try to extract breadcrumb/category tags from the page for searching/sorting
    try {
      const breadcrumbs = await page.evaluate(() => {
        const crumbs = Array.from(document.querySelectorAll('#wayfinding-breadcrumbs_container ul.a-unordered-list a'))
          .map(a => (a.textContent || '').trim())
          .filter(Boolean);
        // Fallback: other breadcrumb selectors
        if (crumbs.length === 0) {
          const alt = Array.from(document.querySelectorAll('.a-breadcrumb, .breadcrumb, #nav-subnav a'))
            .map(a => (a.textContent || '').trim())
            .filter(Boolean);
          return alt;
        }
        return crumbs;
      });

      if (breadcrumbs && breadcrumbs.length > 0) {
        result.tags = breadcrumbs.map(s => s.replace(/\s+/g, ' ').toLowerCase());
        log(`[Amazon] Extracted tags: ${result.tags.join(', ')}`);
      }
    } catch (e) {
      // ignore breadcrumb parsing errors
    }

    // Extract product variations (colors, sizes, etc.) if available on the page
    try {
      result.variations = await page.evaluate((currUrl) => {
        const cleanStr = (s) => (s || '').trim().replace(/\s+/g, ' ');
        const res = {
          hasVariations: false,
          currentAsin: null,
          dimensions: [],
          dimensionOptions: {},
          allVariations: []
        };

        const matchAsin = currUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        if (matchAsin) res.currentAsin = matchAsin[1].toUpperCase();

        // 1. Modern Inline Twister (twister-plus)
        const inlineRows = Array.from(document.querySelectorAll('.inline-twister-row, [id^="inline-twister-row-"]'));
        if (inlineRows.length > 0) {
          for (const row of inlineRows) {
            const titleEl = row.querySelector('.dimension-heading, .dimension-text, .inline-twister-dim-title-value-truncate-expanded');
            let dimName = '';
            if (titleEl) {
              const raw = titleEl.innerText || '';
              dimName = cleanStr(raw.split(':')[0]);
            }
            if (!dimName) {
              const id = row.id.replace('inline-twister-row-', '').replace('_name', '');
              dimName = id.charAt(0).toUpperCase() + id.slice(1);
            }

            const options = [];
            row.querySelectorAll('li').forEach(li => {
              const asin = li.getAttribute('data-asin') || li.getAttribute('data-csa-c-item-id') || li.getAttribute('data-defaultasin');
              if (!asin) return;
              const img = li.querySelector('img');
              const alt = cleanStr(img?.getAttribute('alt'));
              const text = cleanStr(li.innerText);
              const name = alt || text;
              const imageUrl = img?.getAttribute('src') || null;
              const isSelected = li.classList.contains('swatchSelect') || li.getAttribute('data-is-selected') === 'true' || (asin.toUpperCase() === res.currentAsin);

              options.push({
                asin: asin.toUpperCase(),
                name: name || asin,
                imageUrl,
                isSelected,
                dimName
              });
            });

            if (options.length > 0) {
              res.dimensions.push(dimName);
              res.dimensionOptions[dimName] = options;
            }
          }
        }

        // 2. Classic Twister (fallback)
        if (res.dimensions.length === 0) {
          const classicRows = Array.from(document.querySelectorAll('#twister [id^="variation_"], #twisterContainer [id^="variation_"]'));
          for (const row of classicRows) {
            const labelEl = row.querySelector('label, .a-form-label');
            const dimName = cleanStr((labelEl?.innerText || '').replace(':', ''));
            const options = [];

            row.querySelectorAll('li').forEach(li => {
              const asin = li.getAttribute('data-defaultasin') || li.getAttribute('data-csa-c-item-id');
              if (!asin) return;
              const img = li.querySelector('img');
              const alt = cleanStr(img?.getAttribute('alt'));
              const text = cleanStr(li.innerText);
              const name = alt || text;
              const imageUrl = img?.getAttribute('src') || null;

              options.push({
                asin: asin.toUpperCase(),
                name: name || asin,
                imageUrl,
                dimName
              });
            });

            row.querySelectorAll('select option').forEach(opt => {
              const asin = opt.value ? opt.value.split(',')[0] : null;
              if (asin && asin.length === 10 && asin !== '-1') {
                options.push({
                  asin: asin.toUpperCase(),
                  name: cleanStr(opt.innerText),
                  imageUrl: null,
                  dimName
                });
              }
            });

            if (options.length > 0) {
              res.dimensions.push(dimName);
              res.dimensionOptions[dimName] = options;
            }
          }
        }

        res.hasVariations = res.dimensions.length > 0;

        const domainMatch = currUrl.match(/https?:\/\/(www\.)?amazon\.[a-z.]+/i);
        const baseUrl = domainMatch ? domainMatch[0] : 'https://www.amazon.com.au';

        const seenAsins = new Set();
        for (const dim of res.dimensions) {
          for (const opt of res.dimensionOptions[dim]) {
            if (!seenAsins.has(opt.asin)) {
              seenAsins.add(opt.asin);
              res.allVariations.push({
                asin: opt.asin,
                dimension: dim,
                value: opt.name,
                url: `${baseUrl}/dp/${opt.asin}`,
                imageUrl: opt.imageUrl,
                isCurrent: opt.asin === res.currentAsin
              });
            }
          }
        }

        return res;
      }, url);

      if (result.variations && result.variations.hasVariations) {
        log(`[Amazon] Detected variations: ${result.variations.dimensions.join(', ')} (${result.variations.allVariations.length} total options)`);
      }
    } catch (e) {
      log(`[Amazon] Variation extraction skipped: ${e.message}`, 'WARN');
    }

    const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const unitCountMatch = pageText.match(/Unit Count\s+(\d+(?:\.\d+)?)\s*count/i);
    if (unitCountMatch) {
      const unitCount = parseFloat(unitCountMatch[1]);
      if (!Number.isNaN(unitCount) && unitCount > 0) {
        result.packQuantity = unitCount;
        result.packQuantityExplicit = true;
        log(`[Amazon] Found explicit unit count from page details: ${unitCount}`);
      }
    }
    
    log(`[Amazon] Stock status: ${result.inStock}`);

    let domain = 'com';
    const match = url.match(/amazon\.([a-z.]+)/i);
    if (match && match[1]) domain = match[1];

    if (result.price !== null && !isNaN(result.price)) {
      if (domain === 'com') {
         const oldPrice = result.price;
         result.price = (result.price * 1.5 * 1.10) + 10;
         log(`[Amazon] Converted .com price from $${oldPrice} to estimated $${result.price.toFixed(2)} AUD`);
      } else if (domain === 'co.uk') {
         const oldPrice = result.price;
         result.price = (result.price * 1.9 * 1.10) + 10;
         log(`[Amazon] Converted .co.uk price from £${oldPrice} to estimated $${result.price.toFixed(2)} AUD`);
      }
    }

    if (result.usedPrice !== null && !isNaN(result.usedPrice)) {
      if (domain === 'com') {
        result.usedPrice = (result.usedPrice * 1.5 * 1.10) + 10;
        result.usedRawPrice = result.usedPrice;
      } else if (domain === 'co.uk') {
        result.usedPrice = (result.usedPrice * 1.9 * 1.10) + 10;
        result.usedRawPrice = result.usedPrice;
      }
    }

    if (result.price === null || isNaN(result.price)) {
       if (result.usedPrice !== null || result.inStock === 'Out of Stock' || (result.variations && result.variations.hasVariations)) {
         // Unavailable new items, used-only deals, or multi-variation items
         // legitimately have no single new buybox price on the landing page.
         log(`[Amazon] Returning item with used or alternative pricing (${result.usedPrice != null ? `Used: $${result.usedPrice}` : result.inStock}).`);
         return result;
       }
        log(`[Amazon] Failed to parse price directly from DOM. Selectors returned null.`, 'ERROR');
        return null;
     }

    log(`[Amazon] Scrape successful! Final Price: $${result.price}`);
    return result;
  } catch (err) {
    log(`[Amazon] CRITICAL ERROR during scrape: ${err.message}`, 'ERROR');
    return null;
  } finally {
    await safeCloseBrowser(browser);
  }
}

async function searchAmazon(query) {
  return withScraperLock(() => doSearchAmazon(query));
}

async function doSearchAmazon(query) {
  let browser;
  log(`[Amazon Search] Searching for: ${query}`);
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await page.setUserAgent(randomUA);
    
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    });

    const searchUrl = `https://www.amazon.com.au/s?k=${encodeURIComponent(query)}`;
    log(`[Amazon Search] Navigating to ${searchUrl}...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const isCaptcha = await page.$('form[action="/errors/validateCaptcha"]');
    if (isCaptcha) {
      log(`[Amazon Search] CAPTCHA DETECTED! Search blocked.`, 'ERROR');
      return [];
    }

    // Amazon renders search results asynchronously AFTER domcontentloaded.
    // Wait for the result cards to actually appear (like a human would), then
    // add a small human-like delay before reading the DOM.
    try {
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 12000 });
    } catch (e) {
      log(`[Amazon Search] Search results selector did not appear in time, continuing anyway...`, 'WARN');
    }
    await randomDelay(1500, 3000);

    let results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]')).slice(0, 10);
      return items.map(container => {
        const titleEl = container.querySelector('h2 a span') || container.querySelector('h2 span');
        const linkEl = container.querySelector('h2 a') || container.querySelector('a[href*="/dp/"]');
        const imgEl = container.querySelector('img.s-image');

        let price = null;

        // Attempt 1: split whole/fraction spans
        // Amazon includes a trailing '.' inside .a-price-whole (e.g. "32.").
        // Stripping ALL non-digits from it accidentally drops that dot, but we
        // need to also discard it so an empty whole + valid fraction doesn't
        // produce a price like $0.30.
        const priceWhole = container.querySelector('.a-price-whole');
        const priceFraction = container.querySelector('.a-price-fraction');
        if (priceWhole) {
          const wholeNum = priceWhole.textContent.replace(/[^0-9]/g, '');
          const fracNum = priceFraction ? priceFraction.textContent.replace(/[^0-9]/g, '') : '00';
          if (wholeNum) {
            price = parseFloat(wholeNum + '.' + (fracNum || '00'));
          }
        }

        // Attempt 2: full formatted price in the visually-hidden offscreen span.
        // IMPORTANT: The offscreen span sometimes has duplicated text (e.g.
        // "$114.65\n$114.65"). Using replace(/[^0-9.]/g,'') on that produces
        // "114.65114.65" → parseFloat gives 114.65114. Use a safe regex that
        // only captures the first valid decimal number instead.
        if (price === null || isNaN(price)) {
          const offscreenEl = container.querySelector('.a-price .a-offscreen');
          if (offscreenEl) {
            const m = (offscreenEl.textContent || '').match(/[\d]+(?:[.,][\d]{2})?/);
            if (m) {
              const parsed = parseFloat(m[0].replace(',', '.'));
              if (!isNaN(parsed)) price = parsed;
            }
          }
        }

        // Attempt 3: aria-label on the .a-price wrapper (e.g. "35.70 dollars")
        // Use the same safe regex to avoid multi-number concatenation.
        if (price === null || isNaN(price)) {
          const ariaEl = container.querySelector('.a-price[aria-label]');
          if (ariaEl) {
            const m = (ariaEl.getAttribute('aria-label') || '').match(/[\d]+(?:[.,][\d]{2})?/);
            if (m) {
              const parsed = parseFloat(m[0].replace(',', '.'));
              if (!isNaN(parsed)) price = parsed;
            }
          }
        }

        const isPrime = !!(container.querySelector('.a-icon-prime, [aria-label*="Prime"], [aria-label*="prime"]'));
        let shippingPrice = null;
        const containerText = container.innerText || '';
        const deliveryMatch = containerText.match(/\$\s*([\d,]+(?:\.\d{2})?)\s+(?:(?:international|standard|express)\s+)?delivery/i)
          || containerText.match(/\+\s*\$\s*([\d,]+(?:\.\d{2})?)\s+(?:delivery|postage|shipping)/i);
        if (deliveryMatch) {
          const parsedShip = parseFloat(deliveryMatch[1].replace(/,/g, ''));
          if (!isNaN(parsedShip)) shippingPrice = parsedShip;
        } else if (/free\s+delivery|free\s+shipping/i.test(containerText)) {
          shippingPrice = 0;
        }

        return {
          name: titleEl ? titleEl.textContent.trim() : '',
          price: price,
          rawPrice: price,
          shippingPrice: shippingPrice !== null ? shippingPrice : 0,
          isPrime: isPrime,
          url: linkEl ? linkEl.href : '',
          imageUrl: imgEl ? imgEl.src : null,
          inStock: 'In Stock'
        };
      }).filter(r => r.price !== null && !isNaN(r.price) && r.url);
    }).catch(() => []);

    // If the primary selector found nothing, log exactly what the page contains
    // (sampling the first result card) so a future Amazon DOM change is easy to spot.
    if (results.length === 0) {
      const pageState = await page.evaluate(() => {
        const resultCount = document.querySelectorAll('[data-component-type="s-search-result"]').length;
        const first = document.querySelector('[data-component-type="s-search-result"]');
        const noResultsTitle = document.querySelector('#noResultsTitle') ? true : false;

        const whole = first ? first.querySelector('.a-price-whole') : null;
        const offscreen = first ? first.querySelector('.a-price .a-offscreen') : null;
        const aria = first ? first.querySelector('.a-price[aria-label]') : null;
        const link = first ? (first.querySelector('h2 a') || first.querySelector('a[href*="/dp/"]')) : null;

        return {
          resultContainers: resultCount,
          noResultsTitle,
          wholeSample: whole ? whole.textContent : null,
          offscreenSample: offscreen ? offscreen.textContent : null,
          ariaLabelSample: aria ? aria.getAttribute('aria-label') : null,
          linkSample: link ? link.getAttribute('href') : null
        };
      }).catch(() => ({}));
      log(`[Amazon Search] 0 results. Page state: ${JSON.stringify(pageState)}`, 'WARN');
    }

    log(`[Amazon Search] Found ${results.length} results.`);
    return results;
  } catch (err) {
    log(`[Amazon Search] ERROR: ${err.message}`, 'ERROR');
    return [];
  } finally {
    await safeCloseBrowser(browser);
  }
}

module.exports = { scrapeAmazon, searchAmazon };
