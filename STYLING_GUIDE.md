# Maleq Styling Guide

## Color System

Our site uses a comprehensive color system built with Tailwind CSS v4 and CSS custom properties for seamless dark/light mode support.

### Brand Colors

**Primary Color: #FF3939 (Red)**
- Use for: Primary CTAs, brand accents, important actions, cart badges
- Classes: `bg-primary`, `text-primary`, `border-primary`
- Variants:
  - `primary-hover` - Hover state (#e62e2e)
  - `primary-light` - Lighter variant (#ff5c5c / #ff7070 dark)
  - `primary-dark` - Darker variant (#cc2e2e)
  - `primary-foreground` - Text on primary backgrounds (white)

**Accent Color: Orange**
- Use for: Secondary highlights, special offers, featured items
- Classes: `bg-accent`, `text-accent`, `border-accent`
- Variants: `accent-hover`, `accent-foreground`

**Secondary Color: Indigo**
- Use for: Alternative actions, informational elements
- Classes: `bg-secondary`, `text-secondary`, `border-secondary`
- Variants: `secondary-hover`, `secondary-foreground`

### Base Colors

**Background & Foreground**
- `bg-background` / `text-foreground` - Main page background and text
- `bg-card` / `text-card-foreground` - Card backgrounds
- `text-muted` / `text-muted-foreground` - Subtle/secondary text
- Light: white background (#ffffff), dark text (#0a0a0a)
- Dark: dark background (#0a0a0a), light text (#ededed)

**Borders & Inputs**
- `border-border` - Standard borders
- `bg-input` - Input field backgrounds

### Semantic Colors

**Success** (Green)
- Use for: Success messages, confirmations, available status
- Classes: `bg-success`, `text-success`

**Warning** (Amber)
- Use for: Warning messages, low stock alerts
- Classes: `bg-warning`, `text-warning`

**Destructive** (Red)
- Use for: Errors, delete actions, critical alerts
- Classes: `bg-destructive`, `text-destructive`

## Border Radius Tokens

Use consistent border radius across the site:
- `rounded-sm` - 0.375rem
- `rounded` or `rounded-md` - 0.5rem (default)
- `rounded-lg` - 0.75rem
- `rounded-xl` - 1rem

## Dark Mode

Dark mode is automatically handled by the theme system. All color tokens automatically switch between light and dark variants.

### Using Dark Mode in Components
Simply use the semantic color classes, and they'll automatically adapt:
```tsx
<div className="bg-background text-foreground">
  This adapts to dark/light mode automatically
</div>
```

### Toggling Theme
Users can toggle between light and dark mode using the ThemeToggle component in the header. Theme preference is saved to localStorage.

## Component Patterns

### Buttons
```tsx
// Primary button
<button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary-hover transition-colors">
  Click me
</button>

// Secondary button
<button className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary-hover transition-colors">
  Secondary
</button>

// Outline button
<button className="px-4 py-2 border border-border text-foreground rounded-md hover:bg-input transition-colors">
  Outline
</button>
```

### Cards
```tsx
<div className="bg-card text-card-foreground border border-border rounded-lg p-6 shadow-sm">
  <h3 className="text-foreground font-semibold mb-2">Card Title</h3>
  <p className="text-muted-foreground">Card description</p>
</div>
```

### Links
```tsx
<Link href="/path" className="text-foreground hover:text-primary transition-colors">
  Link text
</Link>
```

### Forms
```tsx
<input
  type="text"
  className="px-3 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
/>
```

## Typography

### Headings
Use standard HTML heading tags (h1-h6) - they're already styled globally in globals.css.

### Body Text
- Regular: `text-foreground`
- Muted/secondary: `text-muted` or `text-muted-foreground`

## Transitions

Always add smooth transitions for interactive elements:
```tsx
className="transition-colors" // For color changes
className="transition-all" // For multiple properties
```

## Accessibility

- Always include proper contrast ratios between text and backgrounds
- All interactive elements have visible focus states (focus:ring-2 focus:ring-primary)
- Theme toggle has proper aria-label
- All images have alt text

## Best Practices

1. **Use semantic color names** - Use `bg-primary` instead of `bg-red-500`
2. **Always add transitions** - Makes interactions feel smooth
3. **Test both themes** - Always check components in both light and dark mode
4. **Use consistent spacing** - Stick to Tailwind's spacing scale
5. **Mobile-first** - Design for mobile, then add responsive classes
6. **Keep it simple** - Don't over-complicate with too many variants

## Example Component

```tsx
export default function ProductCard({ product }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all">
      <Image src={product.image} alt={product.name} />
      <div className="p-4">
        <h3 className="text-foreground font-semibold mb-2">{product.name}</h3>
        <p className="text-muted-foreground text-sm mb-4">{product.description}</p>
        <div className="flex justify-between items-center">
          <span className="text-foreground font-bold">${product.price}</span>
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary-hover transition-colors">
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
```
