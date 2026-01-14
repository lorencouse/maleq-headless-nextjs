# Blog Post Custom CSS Guide

This guide explains how to use the custom CSS classes migrated from your WordPress site in your Next.js blog posts.

## Table of Contents
1. [Typography & Headings](#typography--headings)
2. [Images & Media](#images--media)
3. [Tables](#tables)
4. [Pros & Cons Lists](#pros--cons-lists)
5. [Product Reviews](#product-reviews)
6. [Content Blocks](#content-blocks)
7. [Schema Markup](#schema-markup)

---

## Typography & Headings

### Headings with Bottom Borders
Your blog post headings automatically get styled with bottom borders:
- **H2**: 5px solid black border
- **H3, H4, H5**: 1px solid black border

```html
<h2>Main Section Title</h2>
<h3>Subsection Title</h3>
```

### Paragraph Links
Links inside paragraphs get special styling with bottom border and bold text:

```html
<p>Check out this <a href="/link">important resource</a> for more info.</p>
```

---

## Images & Media

### Centered Images
All images in `.entry-content` are automatically centered:

```html
<div class="wp-block-image">
  <img src="/image.jpg" alt="Description" />
</div>
```

### Image Captions
Figure captions get dark backgrounds with white text:

```html
<figure class="wp-block-image">
  <img src="/image.jpg" alt="Description" />
  <figcaption>This is the image caption</figcaption>
</figure>
```

### Video Captions
Same styling applies to video blocks:

```html
<figure class="wp-block-video">
  <video src="/video.mp4"></video>
  <figcaption>Video description</figcaption>
</figure>
```

---

## Tables

### WordPress Tables
Tables automatically get alternating row colors:

```html
<div class="wp-block-table">
  <table>
    <thead>
      <tr>
        <th>Header 1</th>
        <th>Header 2</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Row 1, Cell 1</td>
        <td>Row 1, Cell 2</td>
      </tr>
      <tr>
        <td>Row 2, Cell 1</td>
        <td>Row 2, Cell 2</td>
      </tr>
    </tbody>
  </table>
</div>
```

---

## Pros & Cons Lists

### Pros List
Create a pros list with checkmarks:

```html
<ul class="pros-list">
  <li>Great battery life</li>
  <li>Fast performance</li>
  <li>Excellent camera quality</li>
</ul>
```

**Output:**
- **Pros**
- ✅ Great battery life
- ✅ Fast performance
- ✅ Excellent camera quality

### Cons List
Create a cons list with X marks:

```html
<ul class="cons-list">
  <li>Expensive price point</li>
  <li>No headphone jack</li>
  <li>Heavy weight</li>
</ul>
```

**Output:**
- **Cons**
- ❌ Expensive price point
- ❌ No headphone jack
- ❌ Heavy weight

---

## Product Reviews

### Product Rating
Display a total score out of 10:

```html
<div class="product-rating">8.5</div>
```

**Output:**
```
┌─────────────────────┐
│ Total Score: 8.5/10 │
└─────────────────────┘
```

### Product Name (Numbered)
Create numbered product sections:

```html
<div class="product-name">iPhone 15 Pro Max</div>
<div class="product-name">Samsung Galaxy S24 Ultra</div>
<div class="product-name">Google Pixel 8 Pro</div>
```

Each product automatically gets a numbered badge (1, 2, 3, etc.)

### Product Specs
Create a product specifications section:

```html
<div class="product-specs">
  <p><strong>Screen Size:</strong> 6.7 inches</p>
  <p><strong>Processor:</strong> A17 Pro</p>
  <p><strong>RAM:</strong> 8GB</p>
  <p><strong>Storage:</strong> 256GB</p>
</div>
```

**For Chinese/Traditional Chinese:**
```html
<div class="product-specs-cn">
  <p><strong>螢幕尺寸:</strong> 6.7 英寸</p>
  <p><strong>處理器:</strong> A17 Pro</p>
</div>
```

### Product Table
Create a comparison table:

```html
<div class="product-table">
  <table>
    <tr>
      <td>Feature</td>
      <td>Value</td>
    </tr>
  </table>
</div>
```

---

## Content Blocks

### Review/Quote Block
Highlight important reviews or quotes:

```html
<div class="review">
  "This product exceeded all my expectations. Highly recommended!"
  - John Doe, Tech Reviewer
</div>
```

### Rounded Content Block
Create a card-style content block:

```html
<div class="rounded-block">
  <h3>Important Information</h3>
  <p>This is some important content that deserves special attention.</p>
</div>
```

### Read More Section
Create a "read more" divider:

```html
<div class="read-more">
  <a href="/full-article">Continue reading...</a>
</div>
```

---

## Schema Markup

### FAQ Section
Create structured FAQ content:

```html
<div class="schema-faq-section">
  <div class="schema-faq-question">What is the warranty period?</div>
  <p>The standard warranty is 1 year from date of purchase.</p>
</div>
```

### How-To Steps
Create step-by-step instructions:

```html
<div class="schema-how-to-description">
  <h2>How to Set Up Your Device</h2>
</div>

<div class="schema-how-to-step">
  <span class="schema-how-to-step-name">Step 1: Unbox the device</span>
  <div class="rank-math-step-content">
    <p>Carefully remove all packaging materials...</p>
  </div>
</div>

<div class="schema-how-to-step">
  <span class="schema-how-to-step-name">Step 2: Charge the battery</span>
  <div class="rank-math-step-content">
    <p>Connect the charger and wait for...</p>
  </div>
</div>
```

---

## Complete Example

Here's a complete example combining multiple elements:

```html
<article class="entry-content">
  <h2>iPhone 15 Pro Review</h2>

  <div class="product-name">iPhone 15 Pro</div>

  <div class="product-specs">
    <p><strong>Screen:</strong> 6.1" OLED</p>
    <p><strong>Chip:</strong> A17 Pro</p>
    <p><strong>Camera:</strong> 48MP Main</p>
  </div>

  <h3>Performance Analysis</h3>
  <p>The new A17 Pro chip delivers <a href="/benchmarks">incredible performance</a>.</p>

  <ul class="pros-list">
    <li>Outstanding performance</li>
    <li>Excellent camera system</li>
    <li>Premium build quality</li>
  </ul>

  <ul class="cons-list">
    <li>High price</li>
    <li>No USB-C (yet)</li>
  </ul>

  <div class="product-rating">9.2</div>

  <div class="review">
    "One of the best smartphones of 2024. The camera improvements alone make it worth the upgrade."
  </div>
</article>
```

---

## Dark Mode Support

All custom classes include dark mode variants that automatically activate when your site is in dark mode. No additional classes needed!

---

## Tips & Best Practices

1. **Use semantic HTML**: Always use proper heading hierarchy (h2, h3, h4)
2. **Product counters**: The numbered product badges reset on each page load
3. **Accessibility**: Always include alt text for images
4. **Responsive**: All styles are mobile-responsive by default
5. **Variable support**: Use CSS variables like `var(--primary)` for consistency

---

## CSS Variables Used

These are defined in your `globals.css`:
- `--primary`: Primary brand color (#FF3939)
- `--foreground`: Text color
- `--background`: Background color
- `--card`: Card background
- `--border`: Border color
- `--muted-foreground`: Muted text color

---

## Need Help?

If you need additional custom classes or modifications, refer to:
- Main CSS file: `/app/blog/[slug]/blog-post.css`
- Global styles: `/app/globals.css`
- Blog post page: `/app/blog/[slug]/page.tsx`
