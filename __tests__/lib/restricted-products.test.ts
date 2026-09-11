/**
 * Calibrated against real titles from the production catalog (2026-09-11).
 * If one of the "allowed" cases starts failing, fix the rule's `unless` guard —
 * do not delete the case.
 */
import {
  checkRestrictedProduct,
  describeRestriction,
  partitionRestricted,
  type RestrictedAllowlist,
  type RestrictedCategory,
} from '../../lib/import/restricted-products';

const restrictedCases: Array<[string, Partial<Parameters<typeof checkRestrictedProduct>[0]>, RestrictedCategory]> = [
  ['CBD Daily Intensive Cream', { brand: 'Earthly Body' }, 'cannabinoid'],
  ['Waterslide Hemp Seed CBD Infused Moisturizer 2oz', {}, 'cannabinoid'],
  ['Kush Queen Watermelon Female Gummies Delta 8', {}, 'cannabinoid'],
  ['CBD Edibles 25mg Froggies Sourz on the Go', {}, 'cannabinoid'],
  ['Terpenes Oil Blueberry Og 100mg', {}, 'cannabinoid'],
  ['THC Game', {}, 'cannabinoid'],
  // description-only mention still blocks
  ['Relaxing Massage & Body Oil', { description: '<p>Infused with 1000&nbsp;mg of hemp-based CBD.</p>' }, 'cannabinoid'],
  ['Higher Control Climax Control Gel w/ Hemp Seed Oil 2 oz', { description: 'Infused with hemp CBD and Cannabis Sativa Seed Oil' }, 'cannabinoid'],
  // brand blocklist wins even with a bland title
  ['Candle 3 in 1 Snow Angel 6 Candle', { brand: 'Assorted CBD Vendors' }, 'cannabinoid'],
  ['Kush Queen Bath Bomb', { brand: 'Doc Johnson Novelties' }, 'cannabinoid'],
  ['Kush Bath Bomb Relax', { description: '<p>Lavender bath bomb infused with cannabinoids for deep relaxation.</p>' }, 'cannabinoid'],
  ['Mochi Magic Mushroom Vape Ice Mint 6pack Display', {}, 'vape-tobacco'],
  ['Cool Mint Nicotine Pouches 20ct', {}, 'vape-tobacco'],
  ['Amanita Muscaria Gummies 5ct', {}, 'psychedelic'],
  ['Glass Water Pipe 8in Blue', {}, 'drug-paraphernalia'],
  ['Mini Beaker Bong 6in', {}, 'drug-paraphernalia'],
  ['Let the Good Times Roll One Hitter Kard', {}, 'drug-paraphernalia'],
  ['X Stream Fetish Urine 3 oz', { description: 'Laboratory-grade synthetic urine with heating pad.' }, 'drug-test-evasion'],
  ['Bullet Proof X2 3 oz Fetish Urine Kit', {}, 'drug-test-evasion'],
  ['Jungle Juice Max', {}, 'poppers'],
  ['Locker Room', {}, 'poppers'],
  ['Rush Black', {}, 'poppers'],
  ['Amsterdam', {}, 'poppers'],
  ['Premium Leather Cleaner 30ml', { description: 'isobutyl nitrite room odorizer' }, 'poppers'],
  ['The Whizzinator Touch!', {}, 'drug-test-evasion'],
  ['Rescue Detox Blueberry Ice 17 oz', { brand: 'Empire Smoke Distributor' }, 'drug-test-evasion'],
  ['Rhino 69 Male Enhancement Pills 24ct', {}, 'supplement'],
];

const allowedCases: Array<[string, Partial<Parameters<typeof checkRestrictedProduct>[0]>]> = [
  ['Male Power Kaleidickscope Bong Thong Sky Blue', {}],
  ['Fantasy C-Ringz Cock Pipe w/ Ball Stretcher', {}],
  ['Cheap Thrills Cherry Poppers Sorority Girl', {}],
  ['Frisky Booty Poppers Curved Silicone Anal Trainer 3pc Set', {}],
  ['Vaporator Vibrating Silicone Rechargeable Vape', {}],
  ['Bliss Magic Mushroom Pink Wand Massager', {}],
  ['Tantus Amsterdam - True Blood', {}],
  ['Satisfyer Sugar Rush Blue', {}],
  ['Jimmyjane Natural Massage Oil Candle 4.5 oz Red Tobacco', {}],
  ['Tastease Sweet Cream Edible Nipple Pasties & Pecker Wraps', {}],
  ['Rize the Pill Mini Stroker 12 Pack Dsp', {}],
  ['Bong Water Sticker - Pack of 3', {}],
  ['Leif 7 in 420 Pot Leaf Print Silicone Dong', {}],
  // hemp seed oil cosmetics without cannabinoids are fine
  ['Hemp Seed 3-in-1 Massage Candle Dreamsicle 6 oz', { brand: 'Earthly Body', description: 'Made with hemp seed oil. Vegan, cruelty-free.' }],
  ['Butt Eze Anal Desensitizer W/ Hemp Seed Oil 2 oz Bottle', { brand: 'Body Action Products' }],
  ['Stud 100 Delay Spray', { brand: 'Assorted Pill Vendors' }],
  ['Pipedream Extreme Fuck Me Silly', { brand: 'Pipedream Products', description: 'Includes a pipe cleaner style brush.' }],
  // calibration round 2 (live catalog, 2026-09-11)
  ['Pico Bong Transformer Bla', {}],
  ['The Dickheads Beer Bong', {}],
  ['Bong Key Chain', {}],
  ['Alien Stash Jar', {}],                       // storage, not "equipment for using drugs"
  ['Blue Pot Leaf Ashtray', { description: 'Holds four cigarettes.' }],
  ['Tantus Hookah Textured Dildo Bubble Gum', {}],
  ['Stash Cockring W/ Capsule Insert Black', {}],
  ['Smoxy Candle Orange Soda 1', { brand: 'Empire Smoke Distributor' }],
  ['Hemp Seed 3-in-1 Massage Candle 6oz', { brand: 'Earthly Body', description: '<p>Made with hemp seed oil. THC-free and contains 0% THC. No CBD.</p>' }],
  ['Versa Easy Lab 6-Panel Drugs of Abuse Cup Test 1-Pack', { description: 'Detects THC, COC, OPI, AMP, MET, BZO. 6-panel drug test cup.' }],
  ['Dame Sex Oil 2 Oz.', { description: 'Botanical blend with kava and ginger.' }],
  ['Maia Vaporator', { description: 'Discreet rechargeable vibrator styled like a vape cartridge. Silicone tip, 10 functions.' }],
];

describe('checkRestrictedProduct', () => {
  test.each(restrictedCases)('blocks "%s"', (name, extra, category) => {
    const r = checkRestrictedProduct({ name, ...extra });
    expect(r.restricted).toBe(true);
    expect(r.category).toBe(category);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  test.each(allowedCases)('allows "%s"', (name, extra) => {
    const r = checkRestrictedProduct({ name, ...extra });
    expect(describeRestriction(r)).toBe('not restricted');
    expect(r.restricted).toBe(false);
  });

  test('allowlist overrides a rule match by barcode or exact name', () => {
    const allowlist: RestrictedAllowlist = {
      ids: new Set(['012345678905']),
      names: new Set(['thc game']),
    };
    const byId = checkRestrictedProduct({ name: 'CBD Soothing Serum', barcode: '012345678905' }, { allowlist });
    expect(byId.restricted).toBe(false);
    expect(byId.allowlisted).toBe(true);
    expect(byId.category).toBe('cannabinoid'); // still reported so the log shows why it was reviewed

    const byName = checkRestrictedProduct({ name: 'THC Game' }, { allowlist });
    expect(byName.restricted).toBe(false);
    expect(byName.allowlisted).toBe(true);

    const notListed = checkRestrictedProduct({ name: 'CBD Soothing Serum', barcode: '999' }, { allowlist });
    expect(notListed.restricted).toBe(true);
  });

  test('category names count as strong fields', () => {
    const r = checkRestrictedProduct({ name: 'Blueberry 100mg', categories: ['Health & Beauty', 'CBD'] });
    expect(r.restricted).toBe(true);
    expect(r.field).toBe('category');
  });

  test('describeRestriction is log-friendly', () => {
    const r = checkRestrictedProduct({ name: 'Kush Queen Watermelon Female Gummies Delta 8' });
    expect(describeRestriction(r)).toMatch(/^cannabinoid via name: /);
  });
});

describe('partitionRestricted', () => {
  test('splits a feed into kept and dropped with reasons', () => {
    const feed = [
      { title: 'Satisfyer Pro 2', upc: '1' },
      { title: 'CBD Daily Massage Lotion 8oz', upc: '2' },
      { title: 'Jungle Juice Max', upc: '3' },
    ];
    const { kept, dropped } = partitionRestricted(feed, (p) => ({ name: p.title, barcode: p.upc }));
    expect(kept.map((p) => p.upc)).toEqual(['1']);
    expect(dropped.map((d) => [d.item.upc, d.result.category])).toEqual([
      ['2', 'cannabinoid'],
      ['3', 'poppers'],
    ]);
  });
});
