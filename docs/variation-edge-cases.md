# Variation Detection Edge Cases

This document tracks product patterns that should be grouped as variations but may be missed by the current detection algorithms.

## Summary of Current Detection Strategies

The `xml-parser.ts` uses multiple strategies:
1. **Last Word Pattern** - Groups products differing only in their last word (e.g., colors, flavors)
2. **Last Two Words Pattern** - Groups products differing in last two words
3. **Common Prefix Pattern** - Groups products sharing a significant prefix
4. **Keyword Pattern** - Groups products containing variant keywords (colors, sizes, zodiac signs)
5. **Size Variations Across Prices** - Merges size variants even with different prices
6. **Product Line Variations** - Special handling for themed product lines

---

## Edge Case Categories

### 1. Flavor Variations (Same Price)

Products that should be grouped by flavor but have complex naming patterns.

| Base Product | Variants | Price | Issue |
|-------------|----------|-------|-------|
| Nipple Nibblers Sour Pleasure Balm 3g | Giddy Grape, Peach Pizazz, Berry Blast, Wacky Watermelon, Rockin Raspberry, Sassy Strawberry | $8.78 | Multi-word flavor names not detected |
| Nipple Nibblers Cool Tingle Balm 3g | Raspberry Rave, Melon Madness, Strawberry Sensation | $8.78 | Multi-word flavor names |
| Goodhead Juicy Head Cocktails Spray 2oz | Pina Colada, Blue Raspberry, Dry Martini, Sex on the Beach | $22.63 | Cocktail names as variants |
| Goodhead Warming Head Oral Delight Gel 4oz | Chocolate, Cinnamon, Strawberry, Watermelon, Mint, Cherry | $18.39 | Standard flavors should be caught |

**Pattern Theme**: Multi-word flavor names (two+ words) are harder to detect than single-word flavors.

---

### 2. Color Variations

Products differing by color name.

| Base Product | Variants | Price | Issue |
|-------------|----------|-------|-------|
| Addiction Cocktails 5.5 Silicone Dong | Blue Lagoon, Purple Haze, Peach Bellini, Sangria | $40.26 | Cocktail names as colors |
| The 9's Booty Call Silicone Butt Plug Set | Blue, Purple, Black, Pink | $17.95 | Should be caught |
| Enhancements Prolong Silicone Nubbed Cockring | Blue, Purple, Clear, Grey | $8.78 | Should be caught |
| Lace Mask | Black, White, Red, Purple | Various | Standard colors |

**Pattern Theme**: Color names that are also other words (cocktail names, compound colors) may be missed.

---

### 3. Size Variations (Same Price)

Products with size indicators at same price point.

| Base Product | Variants | Price | Issue |
|-------------|----------|-------|-------|
| Booty Call Fishbowl | 48 pieces 3 sizes, 36 pieces 4 sizes, 24 pieces, 12 pieces | $482.63 | Complex size descriptors |
| Mood Naughty Silicone Anal Trainer Set | 3 piece sets in various colors | Various | Set descriptions |

**Pattern Theme**: Size expressed as quantities or complex descriptors rather than S/M/L/XL.

---

### 4. Size Variations (Different Prices)

Products with size variations at different price points - these need special handling.

| Base Product | Variants | Prices | Issue |
|-------------|----------|--------|-------|
| Tom of Finland Anal Plug | Medium, Extra Large | $49.09, $58.39 | Different prices for sizes |
| Dr Skin Cock Vibe Series | #1 through #12 (various sizes) | Various | Numbered variants |
| Crystal Jellies Realistic Cock | Various inch sizes | Various | Size in product name |

**Pattern Theme**: Size variants often have legitimately different prices, requiring cross-price grouping.

---

### 5. Model/Character/Series Variations

Products that are part of a character or model series.

| Base Product | Variants | Issue |
|-------------|----------|-------|
| Dr Skin Cock Vibe | #1, #2, #3, #5, #7, #10, #11, #12 | Numbered series |
| All Star Porn Stars | Various performer names | Name-based variants |
| Lord of the Cock Rings | The Return of the King, Two Towers, Fellowship, Hobbit, Smaug, King Dong | Themed names |
| Zodiac Mini Vibe | 12 zodiac signs | ✅ Now detected |

**Pattern Theme**: Series/collection products where each variant has a unique thematic name.

---

### 6. Scent Variations

Candles and massage products with scent variants.

| Base Product | Variants | Price | Issue |
|-------------|----------|-------|-------|
| Hemp Seed 3-in-1 Massage Candle 6oz | Dreamsicle, Guavalava, High Tide, Skinny Dip, Sunsational | $25.65 | Single-word scent names |
| Kama Sutra Massage Candle | Various scents | Various | Multi-word scent names |

**Pattern Theme**: Scent names are similar to flavor names - single words easier to detect.

---

### 7. Bundle/Kit Variations

Products sold as kits or bundles with different configurations.

| Base Product | Variants | Issue |
|-------------|----------|-------|
| Anal Training Set | Different piece counts | Number-based variants |
| Starter Kit | Different included items | Configuration variants |

**Pattern Theme**: Kit configurations expressed as counts or included items.

---

### 8. Texture/Material Variations

Products with different textures or material finishes.

| Base Product | Variants | Issue |
|-------------|----------|-------|
| Silicone products | Smooth, Ribbed, Nubbed | Texture descriptors |
| Leather/Faux Leather | Material variants | Material names |

**Pattern Theme**: Texture words may not be in the variant word list.

---

## Recommended Improvements

### High Priority

1. **Add multi-word flavor patterns**: Create a dictionary of common multi-word flavors
   - "Giddy Grape", "Berry Blast", "Sex on the Beach", etc.

2. **Add cocktail names as colors/variants**:
   - "Blue Lagoon", "Purple Haze", "Pina Colada", etc.

3. **Improve numbered series detection**:
   - Detect "#1", "#2", "No. 1", "No. 2" patterns
   - Detect "Series 1", "Series 2" patterns

### Medium Priority

4. **Add texture words to variant list**:
   - "Smooth", "Ribbed", "Nubbed", "Beaded", "Curved"

5. **Add scent names dictionary**:
   - Common scent descriptors like "Dreamsicle", "Guavalava"

6. **Improve Lord of the Rings style detection**:
   - Thematic names within a collection

### Lower Priority

7. **Bundle configuration detection**:
   - Detect "X pieces", "X pc", "X pack" patterns

8. **Material variants**:
   - "Silicone", "TPE", "Glass", "Metal", "Leather"

### 9. Numbered Series (Different Models)

Products in numbered series like #1, #2, #3, etc.

| Base Product | Variants | Prices | Issue |
|-------------|----------|--------|-------|
| Dr Skin Cock Vibe | #1, #3, #8, #10, #12, #14 | $35-40 | Numbered with different sizes/prices |
| Dr Skin Cockvibe | #1, #3, #4, #6, #8, #9, #14 | $35-40 | Spelling variant of above |
| B Yours Cockvibe | #1, #2, #3, #4 | $37-40 | Numbered series |
| B Yours Vibe | #2, #6, #7 | $37-40 | Numbered series |
| Icicles | #31, #38, #44 | $40-92 | Wide price range numbered |
| Anal-ese Vibrating Alpha Plug | #1, #3 | $63-70 | Numbered series |
| Xact Fit Silicone Rings | #14, #15, #16, #17, etc. | $31 | Ring size numbers |

**Pattern Theme**: Products with `#N` pattern where N is a number, often representing different sizes/models.

---

### 10. Cocktail/Themed Names as Variants

Products where variant names are cocktail names or themed descriptors.

| Base Product | Variants | Price | Issue |
|-------------|----------|-------|-------|
| Addiction Cocktails 5.5 Silicone Dong | Blue Lagoon, Mint Mojito, Peach Bellini, Purple Cosmo | $40.26 | Cocktail names |
| Coochy Shave Cream Foil Display | Floral Haze, Frosted Cake, Island Paradise, Peachy Keen, Sweet Nectar | $73.17 | Fancy scent names |
| Goodhead Juicy Head Cocktails Spray | Lemon Drop, Mojito, Sex on the Beach, Strawb & Champagne | $22.63 | Cocktail names |

**Pattern Theme**: Creative multi-word variant names that don't fit standard patterns.

---

### 11. Products with Quote Marks in Name

Some products have quote marks (") in their names indicating size, which may interfere with parsing.

| Base Product | Issue |
|-------------|-------|
| Addiction Cocktails 5.5 Silicone Dong Blue Lagoon " | Trailing quote mark |
| Dr Skin Cock Vibe #14 8 Mocha " | Quote mark after size |
| Real Cocks Dual Layered " | Quote indicates inches |

**Pattern Theme**: Quote marks used to indicate inches may cause parsing issues.

---

## Specific Products to Review

### From Database Analysis (Currently Simple, Should Be Variations)

**Nipple Nibblers Sour Pleasure Balm (6 at $8.78)**
```
Nipple Nibblers Sour Pleasure Balm Giddy Grape 3g
Nipple Nibblers Sour Pleasure Balm Peach Pizazz 3g
Nipple Nibblers Sour Pleasure Balm Pineapple Pucker 3g
Nipple Nibblers Sour Pleasure Balm Rockin' Raspberry 3g
Nipple Nibblers Sour Pleasure Balm Spun Sugar 3g
Nipple Nibblers Sour Pleasure Balm Wicked Watermelon 3g
```

**Hemp Seed 3-in-1 Candles (7 at $25.65)**
```
Hemp Seed 3-in-1 Candle Kashmir Musk 6oz
Hemp Seed 3-in-1 Candle Zen Berry Rose 6oz
Hemp Seed 3-in-1 Massage Candl Mistletoe Mischief 6oz
Hemp Seed 3-in-1 Massage Candl Tinsel Tease 6oz
Hemp Seed 3-in-1 Massage Candl Yule Be Begging 6oz
Hemp Seed 3-in-1 Massage Candle Oh Oh Oh 6oz
Hemp Seed 3-in-1 Massage Candle Stuff My Stocking 6oz
```

**Coochy Shave Cream Foil Display (5 at $73.17)**
```
Coochy Shave Cream Floral Haze Foil 15 Ml 24pc Display
Coochy Shave Cream Frosted Cake Foil 15 Ml 24pc Display
Coochy Shave Cream Island Paradise Foil 15 Ml 24pc Display
Coochy Shave Cream Peachy Keen Foil 15ml 24pc Display
Coochy Shave Cream Sweet Nectar Foil 15 Ml 24pc Display
```

**Addiction Cocktails 5.5 Silicone Dong (4 at $40.26)**
```
Addiction Cocktails 5.5 Silicone Dong Blue Lagoon "
Addiction Cocktails 5.5 Silicone Dong Mint Mojito "
Addiction Cocktails 5.5 Silicone Dong Peach Bellini "
Addiction Cocktails 5.5 Silicone Dong Purple Cosmo "
```

**Goodhead Juicy Head Cocktails Spray (4 at $22.63)**
```
Goodhead Juicy Head Cocktails Spray Lemon Drop 2oz
Goodhead Juicy Head Cocktails Spray Mojito 2oz
Goodhead Juicy Head Cocktails Spray Sex on the Beach 2oz
Goodhead Juicy Head Cocktails Spray Strawb & Champagne 2oz
```

**The 9's Booty Call Silicone Butt Plug (4 at $17.95)**
```
The 9's Booty Call Butt Plug Yellow Don't Stop
The 9's Booty Call Silicone Butt Plug Black Bad Girl
The 9's Booty Call Silicone Butt Plug Orange Hit It Hard
The 9's Booty Call Silicone Butt Plug Red Fuck Yeah
```

**Booty Call Fishbowl 65 Pillow Packs (4 at $482.63)**
```
Booty Call Fishbowl 65 Pillow Packs Cherry
Booty Call Fishbowl 65 Pillow Packs Cooling
Booty Call Fishbowl 65 Pillow Packs Mint
Booty Call Fishbowl 65 Pillow Packs Unflavored
```

**Orange Is the New Black (4 at $17.95)**
```
Orange Is the New Black L Cuffs Ankle
Orange Is the New Black Love Cuffs Wrist
Orange Is the New Black Riding Crop & Tickler
Orange Is the New Black Tie Me Ups
```

**Lord of the Cock Rings (6 with different prices)**
```
Lord of the Cock Rings Bilbo ($29.86)
Lord of the Cock Rings Elendil 3 Pack ($39.31)
Lord of the Cock Rings Elrond Cock Gate ($29.86)
Lord of the Cock Rings Frodo Single ($3.46)
Lord of the Cock Rings Gandalf Black ($6.45)
Lord of the Cock Rings Lurtz ($5.56)
```

**Xact Fit Silicone Rings (4 at $31.05)**
```
Xact Fit Silicone Rings #14 #15 #16 Black
Xact Fit Silicone Rings #14 #17 #20 Black
Xact Fit Silicone Rings #17 #18 #19
Xact Fit Silicone Rings #20 #21 #22
```

---

## Testing Checklist

After implementing improvements, verify these groups are detected:

### High Priority (Same Price, Clear Patterns)
- [ ] Nipple Nibblers Sour Pleasure Balm (6 variants at $8.78)
- [ ] Nipple Nibblers Cool Tingle Balm (3 variants at $8.78)
- [ ] Hemp Seed 3-in-1 Candle/Massage Candle (7 variants at $25.65)
- [ ] Goodhead Juicy Head Cocktails Spray (4 variants at $22.63)
- [ ] Addiction Cocktails 5.5 Silicone Dong (4 variants at $40.26)
- [ ] Coochy Shave Cream Foil Display (5 variants at $73.17)
- [ ] Booty Call Fishbowl 65 Pillow Packs (4 variants at $482.63)
- [ ] The 9's Booty Call Silicone Butt Plug (4 variants at $17.95)
- [ ] Orange Is the New Black (4 variants at $17.95)
- [ ] Xact Fit Silicone Rings (4 variants at $31.05)

### Medium Priority (Different Prices, Related Products)
- [ ] Lord of the Cock Rings (6 variants, $3-$40 range)
- [ ] Dr Skin Cock Vibe series (6+ variants)
- [ ] Dr Skin Cockvibe series (7+ variants)
- [ ] B Yours Cockvibe series (4+ variants)
- [ ] B Yours Vibe series (3+ variants)

### Lower Priority (Complex Patterns)
- [ ] Icicles numbered series
- [ ] Products with inch sizes in names

---

## Appendix: Current Variant Words

The following words are currently recognized as variant indicators in `xml-parser.ts`:

### Colors
black, white, red, blue, green, yellow, purple, pink, orange, brown, gray, grey, silver, gold, clear, nude, tan, ivory, beige, cream, natural

### Sizes
small, medium, large, xl, xxl, mini, regular, plus, petite

### Zodiac Signs
aries, taurus, gemini, cancer, leo, virgo, libra, scorpio, sagittarius, capricorn, aquarius, pisces

### Other
light, bx (suffix pattern)
