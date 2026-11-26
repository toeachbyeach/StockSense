/**
 * Australian Supermarket Department & Aisle Categorizer
 * Automatically categorizes products into store aisles / departments
 * matching standard layout walking order:
 * Produce -> Bakery -> Meat & Seafood -> Dairy & Chilled -> Pantry -> Snacks & Drinks -> Household & Cleaning -> Health & Beauty -> Pet Care
 */

const DEPARTMENTS = [
  {
    id: 'produce',
    name: 'Fresh Produce',
    icon: '🥦',
    order: 1,
    keywords: [
      'apple', 'banana', 'orange', 'citrus', 'lemon', 'lime', 'berry', 'berries', 'strawberry', 'blueberry',
      'raspberry', 'grape', 'watermelon', 'melon', 'mango', 'avocado', 'tomato', 'potato', 'onion', 'garlic',
      'ginger', 'carrot', 'broccoli', 'cauliflower', 'lettuce', 'salad', 'spinach', 'kale', 'cucumber', 'capsicum',
      'pepper', 'zucchini', 'mushroom', 'celery', 'corn', 'herbs', 'parsley', 'coriander', 'basil', 'mint',
      'pumpkin', 'sweet potato', 'beans', 'asparagus', 'cabbage', 'fresh fruit', 'fresh veg'
    ]
  },
  {
    id: 'bakery',
    name: 'Bakery & Deli',
    icon: '🍞',
    order: 2,
    keywords: [
      'bread', 'sourdough', 'loaf', 'toast', 'rolls', 'buns', 'bagel', 'croissant', 'crumpet', 'muffin',
      'pita', 'wrap', 'tortilla', 'naan', 'flatbread', 'deli', 'ham', 'salami', 'prosciutto', 'roast beef',
      'pastry', 'brioche', 'focaccia', 'ciabatta', 'baguette', 'bakery'
    ]
  },
  {
    id: 'meat_seafood',
    name: 'Meat & Seafood',
    icon: '🥩',
    order: 3,
    keywords: [
      'beef', 'steak', 'mince', 'chicken', 'breast', 'thigh', 'pork', 'lamb', 'bacon', 'sausage',
      'snag', 'prawn', 'salmon', 'fish', 'tuna fresh', 'barramundi', 'calamari', 'kangaroo', 'turkey',
      'meatballs', 'fillet', 'roast meat', 'cutlet', 'chop', 'ribs', 'seafood'
    ]
  },
  {
    id: 'dairy_eggs',
    name: 'Dairy, Eggs & Chilled',
    icon: '🥛',
    order: 4,
    keywords: [
      'milk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'butter', 'margarine', 'yoghurt',
      'yogurt', 'cream', 'sour cream', 'eggs', 'egg', 'custard', 'cottage cheese', 'ricotta', 'dip',
      'hummus', 'tofu', 'soy milk', 'almond milk', 'oat milk', 'chilled juice', 'brie', 'camembert'
    ]
  },
  {
    id: 'pantry',
    name: 'Pantry Staples',
    icon: '🥫',
    order: 5,
    keywords: [
      'pasta', 'spaghetti', 'rice', 'jasmine', 'basmati', 'flour', 'sugar', 'oats', 'porridge', 'cereal',
      'weet-bix', 'cornflakes', 'muesli', 'oil', 'olive oil', 'canola oil', 'sauce', 'tomato sauce', 'passata',
      'pasta sauce', 'soy sauce', 'canned', 'beans', 'chickpeas', 'lentils', 'tuna', 'canned fish', 'soup',
      'stock', 'spices', 'salt', 'pepper spice', 'honey', 'jam', 'peanut butter', 'spread', 'vegemite',
      'nutella', 'coffee', 'coffee beans', 'instant coffee', 'tea', 'tea bags', 'noodles', 'ramen', 'mayo',
      'mayonnaise', 'mustard', 'vinegar', 'baking', 'baking powder', 'yeast', 'husks', 'psyllium', 'curry paste'
    ]
  },
  {
    id: 'snacks_drinks',
    name: 'Snacks & Beverages',
    icon: '🍿',
    order: 6,
    keywords: [
      'chips', 'crisps', 'smiths', 'doritos', 'pretzels', 'popcorn', 'crackers', 'biscuits', 'cookies',
      'tim tam', 'chocolate', 'cadbury', 'lollies', 'candy', 'nuts', 'almonds', 'cashews', 'peanuts',
      'soft drink', 'coca-cola', 'coke', 'pepsi', 'sprite', 'water', 'sparkling water', 'juice', 'soda',
      'energy drink', 'kombucha', 'cordial', 'ice tea', 'snack'
    ]
  },
  {
    id: 'household_cleaning',
    name: 'Cleaning & Household',
    icon: '🧼',
    order: 7,
    keywords: [
      'detergent', 'laundry', 'washing powder', 'fabric softener', 'dishwashing', 'dishwasher', 'finish',
      'fairy', 'morning fresh', 'disinfectant', 'bleach', 'wipes', 'cleaning wipes', 'toilet paper', 'tissues',
      'paper towel', 'bin bags', 'garbage bags', 'foil', 'aluminium foil', 'baking paper', 'cling wrap',
      'glad wrap', 'spray wipe', 'cleaner', 'sponge', 'scrub', 'air freshener', 'stain remover', 'sard',
      'vanish', 'toilet cleaner', 'power force', 'multipurpose'
    ]
  },
  {
    id: 'health_beauty',
    name: 'Health & Personal Care',
    icon: '🧴',
    order: 8,
    keywords: [
      'shampoo', 'conditioner', 'body wash', 'soap bar', 'hand wash', 'deodorant', 'antiperspirant',
      'toothpaste', 'toothbrush', 'mouthwash', 'dental floss', 'sunscreen', 'sun cream', 'moisturiser',
      'moisturizer', 'lotion', 'face wash', 'cleanser', 'shaving', 'razor', 'lip balm', 'vitamins',
      'supplements', 'fish oil', 'multivitamin', 'panadol', 'nurofen', 'pain relief', 'paracetamol',
      'ibuprofen', 'band-aid', 'plaster', 'pads', 'tampons', 'cotton pads', 'aveeno', 'dettol soap'
    ]
  },
  {
    id: 'pet',
    name: 'Pet Supplies',
    icon: '🐾',
    order: 9,
    keywords: [
      'dog', 'puppy', 'cat', 'kitten', 'pet food', 'dog food', 'cat food', 'kibble', 'pet treats',
      'dog treats', 'chew', 'flea', 'tick', 'worm', 'nexgard', 'spectra', 'bravecto', 'simparica',
      'cat litter', 'litter tray', 'poop bags', 'pet shampoo', 'rawhide'
    ]
  },
  {
    id: 'other',
    name: 'General & Other',
    icon: '🛒',
    order: 10,
    keywords: []
  }
];

function categorizeItem(productName, tags = '') {
  if (!productName) {
    return {
      id: 'other',
      name: 'General & Other',
      icon: '🛒',
      order: 10
    };
  }

  const combined = `${productName} ${tags || ''}`.toLowerCase();

  for (const dept of DEPARTMENTS) {
    if (dept.id === 'other') continue;
    for (const kw of dept.keywords) {
      // Word boundary or substring matching
      if (combined.includes(kw)) {
        return {
          id: dept.id,
          name: dept.name,
          icon: dept.icon,
          order: dept.order
        };
      }
    }
  }

  return {
    id: 'other',
    name: 'General & Other',
    icon: '🛒',
    order: 10
  };
}

module.exports = {
  DEPARTMENTS,
  categorizeItem
};
