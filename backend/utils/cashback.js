/**
 * Australian Cashback Portals & Rates Helper
 * Provides real-time and fallback cashback affiliate and portal links for Australian retailers
 * (ShopBack and Cashrewards).
 */

const CASHBACK_RATES = {
  amazon: {
    name: 'Amazon Australia',
    domain: 'amazon.com.au',
    shopback: { rate: 'Up to 7%', url: 'https://www.shopback.com.au/amazon' },
    cashrewards: { rate: 'Up to 5%', url: 'https://www.cashrewards.com.au/store/amazon-australia' }
  },
  coles: {
    name: 'Coles Online',
    domain: 'coles.com.au',
    shopback: { rate: 'Up to $10', url: 'https://www.shopback.com.au/coles' },
    cashrewards: { rate: 'Up to $15', url: 'https://www.cashrewards.com.au/store/coles' }
  },
  woolworths: {
    name: 'Woolworths Online',
    domain: 'woolworths.com.au',
    shopback: { rate: 'Up to 3.5%', url: 'https://www.shopback.com.au/woolworths' },
    cashrewards: { rate: 'Up to 4%', url: 'https://www.cashrewards.com.au/store/woolworths' }
  },
  chemistwarehouse: {
    name: 'Chemist Warehouse',
    domain: 'chemistwarehouse.com.au',
    shopback: { rate: 'Up to 6%', url: 'https://www.shopback.com.au/chemist-warehouse' },
    cashrewards: { rate: 'Up to 5.5%', url: 'https://www.cashrewards.com.au/store/chemist-warehouse' }
  },
  petcircle: {
    name: 'Pet Circle',
    domain: 'petcircle.com.au',
    shopback: { rate: 'Up to 8%', url: 'https://www.shopback.com.au/pet-circle' },
    cashrewards: { rate: 'Up to 9%', url: 'https://www.cashrewards.com.au/store/pet-circle' }
  },
  jbhifi: {
    name: 'JB Hi-Fi',
    domain: 'jbhifi.com.au',
    shopback: { rate: 'Up to 3%', url: 'https://www.shopback.com.au/jb-hi-fi' },
    cashrewards: { rate: 'Up to 3.5%', url: 'https://www.cashrewards.com.au/store/jb-hi-fi' }
  },
  thegoodguys: {
    name: 'The Good Guys',
    domain: 'thegoodguys.com.au',
    shopback: { rate: 'Up to 3.5%', url: 'https://www.shopback.com.au/the-good-guys' },
    cashrewards: { rate: 'Up to 4%', url: 'https://www.cashrewards.com.au/store/the-good-guys' }
  },
  officeworks: {
    name: 'Officeworks',
    domain: 'officeworks.com.au',
    shopback: { rate: 'Up to 4%', url: 'https://www.shopback.com.au/officeworks' },
    cashrewards: { rate: 'Up to 4.5%', url: 'https://www.cashrewards.com.au/store/officeworks' }
  },
  theiconic: {
    name: 'The Iconic',
    domain: 'theiconic.com.au',
    shopback: { rate: 'Up to 10%', url: 'https://www.shopback.com.au/the-iconic' },
    cashrewards: { rate: 'Up to 12%', url: 'https://www.cashrewards.com.au/store/the-iconic' }
  },
  danmurphys: {
    name: "Dan Murphy's",
    domain: 'danmurphys.com.au',
    shopback: { rate: 'Up to 4%', url: 'https://www.shopback.com.au/dan-murphys' },
    cashrewards: { rate: 'Up to 4.5%', url: 'https://www.cashrewards.com.au/store/dan-murphys' }
  },
  priceline: {
    name: 'Priceline Pharmacy',
    domain: 'priceline.com.au',
    shopback: { rate: 'Up to 5%', url: 'https://www.shopback.com.au/priceline-pharmacy' },
    cashrewards: { rate: 'Up to 6%', url: 'https://www.cashrewards.com.au/store/priceline-pharmacy' }
  },
  terrywhite: {
    name: 'TerryWhite Chemmart',
    domain: 'terrywhitechemmart.com.au',
    shopback: null,
    cashrewards: { rate: 'Up to 4%', url: 'https://www.cashrewards.com.au/store/terrywhite-chemmart' }
  },
  cincotta: {
    name: 'Cincotta Chemist',
    domain: 'cincottachemist.com.au',
    shopback: null,
    cashrewards: null
  },
  bloomsthechemist: {
    name: 'Blooms The Chemist',
    domain: 'bloomsthechemist.com.au',
    shopback: null,
    cashrewards: null
  },
  petbarn: {
    name: 'Petbarn',
    domain: 'petbarn.com.au',
    shopback: { rate: 'Up to 5%', url: 'https://www.shopback.com.au/petbarn' },
    cashrewards: { rate: 'Up to 6%', url: 'https://www.cashrewards.com.au/store/petbarn' }
  },
  petstock: {
    name: 'Petstock',
    domain: 'petstock.com.au',
    shopback: { rate: 'Up to 6%', url: 'https://www.shopback.com.au/petstock' },
    cashrewards: { rate: 'Up to 7%', url: 'https://www.cashrewards.com.au/store/petstock' }
  },
  budgetpetproducts: {
    name: 'Budget Pet Products',
    domain: 'budgetpetproducts.com.au',
    shopback: { rate: 'Up to 4%', url: 'https://www.shopback.com.au/budget-pet-products' },
    cashrewards: { rate: 'Up to 4.5%', url: 'https://www.cashrewards.com.au/store/budget-pet-products' }
  },
  petchemist: {
    name: 'Pet Chemist',
    domain: 'petchemist.com.au',
    shopback: null,
    cashrewards: { rate: 'Up to 3.5%', url: 'https://www.cashrewards.com.au/store/pet-chemist' }
  },
  bunnings: {
    name: 'Bunnings',
    domain: 'bunnings.com.au',
    shopback: null,
    cashrewards: null
  }
};

function getCashbackInfo(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  for (const [key, info] of Object.entries(CASHBACK_RATES)) {
    if (lower.includes(info.domain)) {
      return { retailer: key, ...info };
    }
  }
  return null;
}

module.exports = {
  CASHBACK_RATES,
  getCashbackInfo
};
