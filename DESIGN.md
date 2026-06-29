# Design System Inspired by Maddie

## 1. Visual Theme & Atmosphere

Maddie's design system embodies a modern, conversational AI aesthetic with a strong emphasis on efficiency and trustworthiness. The visual identity balances enterprise sophistication with approachable humanity—reflecting the brand's position as a "remarkably human" AI agent. High contrast between deep blacks and vibrant accent colors creates visual hierarchy, while a restrained accent palette in electric blue and luminous lime-green signals innovation and positive momentum. The typography is clean and geometric, using the Aeonik Pro typeface throughout for consistency. The overall atmosphere is professional yet energetic, suggesting both reliability and cutting-edge technology. Generous whitespace and subtle shadows maintain clarity while the bold color choices (particularly the electric blue CTA and lime-green success states) convey confidence and forward motion.

**Key Characteristics**
- Bold, high-contrast color palette with electric blues and vibrant accents
- Clean, geometric sans-serif typography throughout
- Enterprise-focused but approachable visual tone
- Generous whitespace with minimal, refined shadows
- iMessage integration messaging with conversational UI elements
- Modern card-based component architecture
- Green accents signaling growth, success, and forward momentum

## 2. Color Palette & Roles

### Primary
- **Brand Black** (`#171717`): Dominant text color across all UI elements; primary foreground for body copy, headings, and interface text
- **Midnight** (`#061F00`): Deep, near-black used for highest contrast overlays and premium brand moments
- **Pure Black** (`#000000`): Absolute black for maximum contrast in critical UI; used sparingly in navigation and borders

### Accent Colors
- **Electric Blue** (`#007AFF`): Primary call-to-action accent; primary button fill and active link states
- **Deep Blue** (`#0078FF`): Alternative blue for secondary emphasis and accent elements
- **Sky Blue** (`#0072F3`): Tertiary blue option for subtle interaction states
- **Luminous Lime** (`#86FC6F`): Vibrant success accent; used for positive growth indicators and achievement moments
- **Bright Green** (`#85FC6E`): Near-identical to luminous lime; subtle variation for micro-interactions

### Interactive
- **Forest Green** (`#007A5A`): Hover and interactive state for green-themed elements; slightly deeper than pure lime
- **Teal Green** (`#061F00`): Deep interactive state for premium interactions

### Neutral Scale
- **Charcoal Dark** (`#1D1C1D`): Near-black for elevated surfaces and secondary containers
- **Graphite** (`#1A1A1A`): Deep neutral for elevated content backgrounds
- **Medium Gray** (`#616061`): Mid-tone gray for secondary text and disabled states
- **Standard Gray** (`#666666`): Tertiary gray for hints, placeholders, and de-emphasized content
- **Light Gray** (`#F0F0F0`): Near-white neutral for light backgrounds and subtle borders
- **Pure White** (`#FFFFFF`): Clean white for primary backgrounds and contrast surfaces

### Surface & Borders
- **Card Background** (`#FFFFFF`): Default card and container fill
- **Elevated Surface** (`#1D1C1D`): Dark elevated surface for dark mode and premium containers
- **Border Subtle** (`#F0F0F0`): Light border for subtle dividers and light-mode edges
- **Border Medium** (`#616061`): Medium-emphasis borders and dividers

### Semantic / Status
- **Success** (`#34C759`): Positive action completion and success messaging
- **Warning** (`#F59E0B`): Alert, warning, and cautionary states; use sparingly for attention

## 3. Typography Rules

### Font Family
**Primary Font:** Aeonik Pro, sans-serif  
**Fallback Stack:** `'Aeonik Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

**Secondary Font:** Same as primary; no secondary typeface differentiation in this system.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display / H1 | Aeonik Pro | 56px | 400 | 69px | 0px | Hero headline; maximum visual prominence |
| Heading H2 | Aeonik Pro | 32px | 400 | 44px | 0px | Section heading; strong visual hierarchy |
| Heading H3 | Aeonik Pro | 21px | 400 | 35px | 0px | Card heading; feature title |
| Heading H4 | Aeonik Pro | 22px | 400 | 26px | 0px | Minor heading; list title |
| Body Text | Aeonik Pro | 14px | 400 | 20px | 0px | Standard paragraph text; default copy |
| Body Small | Aeonik Pro | 13px | 400 | 19px | 0px | Secondary body text; fine print and captions |
| Link / CTA | Aeonik Pro | 16px | 400 | 24px | 0px | Interactive text links and button labels |
| Button Text | Aeonik Pro | 13px | 400 | 20px | 0px | Button interior labels; compact interaction text |
| Caption / Microcopy | Aeonik Pro | 12px | 400 | 18px | 0px | Helper text; error messages; metadata |
| Code / Monospace | Aeonik Pro | 13px | 400 | 19px | 0px | Technical content (fallback to system monospace preferred) |

### Principles
- All text uses Aeonik Pro with 400 weight (regular); no bold or italic variants in primary design
- Hierarchy relies exclusively on size and color, not weight variation
- Line height consistently set to ~1.5× font size for readability
- Letter spacing remains at 0px (default) across all sizes
- Contrast ratios strictly maintained at WCAG AA minimum (4.5:1 for body, 3:1 for large text)
- Link text always underlined or distinctly colored to meet accessibility requirements

## 4. Component Stylings

### Buttons

#### Primary Button
- **Background:** `#007AFF`
- **Text Color:** `#FFFFFF`
- **Font Size:** `13px`
- **Font Weight:** `400`
- **Font Family:** `Aeonik Pro`
- **Padding:** `12px 24px`
- **Border Radius:** `8px`
- **Border:** `0px solid transparent`
- **Box Shadow:** `0px 4px 12px rgba(0, 122, 255, 0.25)`
- **Height:** `44px`
- **Line Height:** `20px`
- **Hover State:** Background `#0066CC`, shadow `0px 6px 16px rgba(0, 122, 255, 0.35)`
- **Active State:** Background `#0052A3`, shadow `0px 2px 8px rgba(0, 122, 255, 0.2)`
- **Disabled State:** Background `#B3D9FF`, text color `#FFFFFF`, cursor `not-allowed`

#### Secondary Button
- **Background:** `#F0F0F0`
- **Text Color:** `#171717`
- **Font Size:** `13px`
- **Font Weight:** `400`
- **Font Family:** `Aeonik Pro`
- **Padding:** `12px 24px`
- **Border Radius:** `8px`
- **Border:** `1px solid #D1D1D1`
- **Box Shadow:** `0px 2px 8px rgba(0, 0, 0, 0.08)`
- **Height:** `44px`
- **Line Height:** `20px`
- **Hover State:** Background `#E8E8E8`, border `#B8B8B8`
- **Active State:** Background `#DCDCDC`, border `#A8A8A8`
- **Disabled State:** Background `#F7F7F7`, text color `#BFBFBF`

#### Ghost Button
- **Background:** `transparent`
- **Text Color:** `#171717`
- **Font Size:** `13px`
- **Font Weight:** `400`
- **Font Family:** `Aeonik Pro`
- **Padding:** `12px 24px`
- **Border Radius:** `8px`
- **Border:** `1px solid #171717`
- **Box Shadow:** `none`
- **Height:** `44px`
- **Line Height:** `20px`
- **Hover State:** Background `#F7F7F7`, border `#1D1C1D`
- **Active State:** Background `#EFEFEF`, text color `#000000`
- **Disabled State:** Border `#D1D1D1`, text color `#BFBFBF`

### Cards & Containers

#### Default Card
- **Background:** `#FFFFFF`
- **Border:** `1px solid #F0F0F0`
- **Border Radius:** `12px`
- **Padding:** `24px`
- **Box Shadow:** `0px 1px 3px rgba(0, 0, 0, 0.08)`
- **Gap (internal grid):** `16px`

#### Elevated Card
- **Background:** `#FFFFFF`
- **Border:** `1px solid #E8E8E8`
- **Border Radius:** `12px`
- **Padding:** `28px`
- **Box Shadow:** `0px 4px 13.9px rgba(135, 135, 135, 0.25)`
- **Gap (internal grid):** `20px`

#### Feature Card (with Icon)
- **Background:** `#FFFFFF`
- **Border:** `1px solid #F0F0F0`
- **Border Radius:** `12px`
- **Padding:** `24px`
- **Box Shadow:** `0px 1px 3px rgba(0, 0, 0, 0.08)`
- **Icon Background:** `#E8F5FF` (light blue tint)
- **Icon Size:** `32px`
- **Icon Border Radius:** `8px`

### Inputs & Forms

#### Text Input - Default
- **Background:** `#FFFFFF`
- **Text Color:** `#171717`
- **Placeholder Color:** `#999999`
- **Border:** `1px solid #D1D1D1`
- **Border Radius:** `8px`
- **Padding:** `12px 16px`
- **Font Size:** `14px`
- **Font Weight:** `400`
- **Line Height:** `20px`
- **Height:** `44px`
- **Box Shadow:** `none`

#### Text Input - Focus
- **Border:** `2px solid #007AFF`
- **Box Shadow:** `0px 0px 0px 3px rgba(0, 122, 255, 0.1)`

#### Text Input - Error
- **Border:** `2px solid #F59E0B`
- **Box Shadow:** `0px 0px 0px 3px rgba(245, 158, 11, 0.1)`

#### Text Input - Success
- **Border:** `2px solid #34C759`
- **Box Shadow:** `0px 0px 0px 3px rgba(52, 199, 89, 0.1)`

#### Text Input - Disabled
- **Background:** `#F7F7F7`
- **Text Color:** `#BFBFBF`
- **Border:** `1px solid #E8E8E8`
- **Cursor:** `not-allowed`

#### Textarea
- **All properties as Text Input - Default**
- **Min Height:** `120px`
- **Resize:** `vertical`
- **Padding:** `16px`

#### Select / Dropdown
- **All properties as Text Input - Default**
- **Appearance:** `none` (custom styling)
- **Background Image:** SVG chevron icon
- **Padding Right:** `40px`

### Navigation

#### Top Navigation Bar
- **Background:** `#000000`
- **Height:** `58px`
- **Padding:** `0px 24px`
- **Border Radius:** `10px` (if contained)
- **Box Shadow:** `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(135, 135, 135, 0.25) 0px 4px 13.9px 0px`
- **Text Color:** `#FFFFFF`
- **Font Size:** `16px`
- **Font Weight:** `400`
- **Display:** `flex`
- **Align Items:** `center`
- **Justify Content:** `space-between`
- **Gap:** `32px`

#### Nav Link - Default
- **Color:** `#CCCCCC`
- **Font Size:** `14px`
- **Font Weight:** `400`
- **Text Decoration:** `none`
- **Padding:** `8px 0px`

#### Nav Link - Hover
- **Color:** `#FFFFFF`
- **Text Decoration:** `underline`

#### Nav Link - Active
- **Color:** `#007AFF`
- **Text Decoration:** `none`
- **Border Bottom:** `2px solid #007AFF`
- **Padding Bottom:** `6px`

#### Mobile Menu Toggle
- **Background:** `transparent`
- **Border:** `none`
- **Color:** `#FFFFFF`
- **Font Size:** `24px`
- **Display:** `none` (show on mobile)
- **Cursor:** `pointer`

### Badges & Labels

#### Success Badge
- **Background:** `#E8F5E9`
- **Text Color:** `#34C759`
- **Border:** `1px solid #34C759`
- **Border Radius:** `16px`
- **Padding:** `4px 12px`
- **Font Size:** `12px`
- **Font Weight:** `400`
- **Line Height:** `18px`

#### Warning Badge
- **Background:** `#FEF3E2`
- **Text Color:** `#F59E0B`
- **Border:** `1px solid #F59E0B`
- **Border Radius:** `16px`
- **Padding:** `4px 12px`
- **Font Size:** `12px`
- **Font Weight:** `400`
- **Line Height:** `18px`

#### Info Badge
- **Background:** `#E3F2FD`
- **Text Color:** `#007AFF`
- **Border:** `1px solid #007AFF`
- **Border Radius:** `16px`
- **Padding:** `4px 12px`
- **Font Size:** `12px`
- **Font Weight:** `400`
- **Line Height:** `18px`

### Tabs

#### Tab Container
- **Border Bottom:** `1px solid #E8E8E8`
- **Display:** `flex`
- **Gap:** `32px`

#### Tab Item - Default
- **Padding:** `12px 0px`
- **Color:** `#999999`
- **Font Size:** `14px`
- **Font Weight:** `400`
- **Border Bottom:** `2px solid transparent`
- **Cursor:** `pointer`
- **Transition:** `all 0.2s ease`

#### Tab Item - Active
- **Color:** `#171717`
- **Border Bottom:** `2px solid #007AFF`

#### Tab Item - Hover
- **Color:** `#616061`

## 5. Layout Principles

### Spacing System
**Base Unit:** `4px`

**Spacing Scale:**
- `4px`: Micro-spacing; component internal gaps
- `8px`: Extra small; compact component padding
- `12px`: Small; component gaps and minimal section padding
- `16px`: Base spacing; standard padding and gap throughout
- `20px`: Medium; section spacing and larger component padding
- `24px`: Large; card padding and major spacing
- `28px`: Extra large; content sections
- `32px`: Extra extra large; major section spacing
- `36px`: XXL; hero section spacing
- `48px`: Massive; page section breaks
- `52px`: Ultra; special emphasis spacing
- `56px`: Maximum; hero and full-width section margins

**Usage Context:**
- `4px-8px`: Button internal spacing, icon margins
- `12px-16px`: Form field gaps, component padding
- `20px-24px`: Card padding, feature spacing
- `32px-48px`: Section spacing, major layout spacing
- `52px-56px`: Full-page layout margins, hero sections

### Grid & Container
- **Max Width:** `1280px` (centered container for full-width layouts)
- **Column Strategy:** 12-column grid system for desktop; responsive reduction to 6 columns on tablet; single column on mobile
- **Container Padding:** `24px` on desktop, `20px` on tablet, `16px` on mobile
- **Section Pattern:** Full-width sections with centered max-width containers inside
- **Gutter Width:** `16px` between grid columns

### Whitespace Philosophy
Maddie's design emphasizes generous whitespace to support clarity and focus. Spacing scales logarithmically from tight micro-spacing in components to expansive breathing room between major sections. White space is intentional and purposeful—never cramped or compressed. Every section breathes independently; container padding ensures content never touches viewport edges. Between card elements and sections, consistent `32px–48px` gaps prevent visual congestion and allow user attention to rest.

### Border Radius Scale
- `0px`: Stark, hard-cornered elements; rarely used
- `3px`: Micro-radius; very subtle rounding on small elements
- `6px`: Small radius; buttons, badges, small components
- `8px`: Standard radius; inputs, dropdowns, compact cards
- `12px`: Large radius; default cards and containers
- `16px`: Extra large radius; premium elevated cards, modals
- `20px`: Rounded corners; pill-shaped buttons, large badges
- `24px`: Bold rounding; hero feature cards
- `32px`: Extreme rounding; accent overlays and special moments
- `9999px` / `50%`: Fully circular; avatars, circular badges, icon buttons

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat / L0 | No shadow; `box-shadow: none` | Backgrounds, secondary content, disabled states |
| Raised / L1 | `0px 1px 3px rgba(0, 0, 0, 0.08)` | Default cards, containers, subtle elevation |
| Floating / L2 | `0px 4px 13.9px rgba(135, 135, 135, 0.25)` | Navigation bar, elevated cards, emphasized content |
| Modal / L3 | `0px 12px 24px rgba(0, 0, 0, 0.15)` | Modals, overlays, dropdowns (use when layering over content) |
| Overlay / L4 | `0px 20px 40px rgba(0, 0, 0, 0.2)` | Full-screen overlays, top-level modals, system alerts |

**Shadow Philosophy:**
Maddie's shadow system uses subtle, refined elevation to create depth without visual noise. Shadows are minimal and restrained, primarily used to distinguish interactive surfaces from flat backgrounds. Primary navigation employs a soft floating shadow (`L2`) to establish its presence; cards use light shadows (`L1`) for gentle separation. Modal and overlay shadows are reserved for critical moments where strong visual hierarchy is essential. All shadows use dark gray opacity rather than pure black, creating a softer, more approachable depth model. Shadows never overwhelm; they enhance clarity and guide attention.

## 7. Do's and Don'ts

### Do
- **Use Electric Blue (`#007AFF`) for all primary CTAs** — it's Maddie's energetic, trusted action color and drives user engagement
- **Apply Luminous Lime (`#86FC6F`) exclusively for success states and growth indicators** — it conveys positive momentum and achievement
- **Maintain generous whitespace around cards and sections** — minimum `24px` internal padding, `32px–48px` between sections
- **Pair dark text (`#171717`) on light backgrounds and white text on dark navigation/overlays** — ensures accessible contrast
- **Use Aeonik Pro 400 weight exclusively** — no bold, italic, or weight variation; rely on size and color for hierarchy
- **Apply `12px` border radius as the default** for cards and standard containers
- **Keep button heights consistent at `44px`** for touch-friendly interactions across all device types
- **Stack shadows in order** — L1 for cards, L2 for nav, L3 for modals; never mix shadow levels
- **Use semantic badges** (`Success`, `Warning`, `Info`) to communicate state clearly
- **Test all color combinations for WCAG AA contrast** — minimum 4.5:1 for normal text, 3:1 for large text

### Don't
- **Don't use pure black (`#000000`) as primary text** — use `#171717` for softer, more sophisticated appearance
- **Don't apply multiple shadow layers to a single element** — use one shadow level consistently
- **Don't reduce button padding below `12px`** — maintain touch-friendly sizing
- **Don't mix font families or weights** — Aeonik Pro 400 throughout; achieve hierarchy through size and color only
- **Don't use lime green for warnings or errors** — reserve it exclusively for success and positive growth states
- **Don't apply border radius smaller than `8px` on interactive elements** — keep touchpoints spacious
- **Don't stack more than two accent colors in a single component** — avoid visual clutter
- **Don't use gray text (`#616061`, `#999999`) for critical information** — ensure sufficient contrast
- **Don't apply less than `24px` padding inside cards** — maintain internal breathing room
- **Don't use transparency on text labels** — keep text solid color for legibility
- **Don't create buttons smaller than `44px` height** — maintain mobile accessibility
- **Don't mix L1 and L2 shadows in adjacent components** — maintain consistent depth language

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|------------|
| Mobile | `0px–639px` | Single column layout; `16px` container padding; collapsed navigation menu; full-width cards; `28px–32px` section spacing; button text size `13px` |
| Tablet | `640px–1023px` | 6-column grid; `20px` container padding; sticky top nav; `24px–36px` section spacing; card grid 2 columns; button text size `13px` |
| Desktop | `1024px–1919px` | 12-column grid; `24px` container padding; full navigation; `32px–48px` section spacing; card grid 3–4 columns; max-width `1280px` container |
| Wide / 4K | `1920px+` | Same as desktop; centered layout with fixed max-width; increased horizontal margins |

### Touch Targets
- **Minimum Touch Target Size:** `44px × 44px` for all interactive elements (buttons, links, form inputs, menu items)
- **Spacing Between Touch Targets:** Minimum `8px` between adjacent interactive elements to prevent accidental taps
- **Icon Button Size:** `40px × 40px` for circular icon buttons; `44px` minimum for any clickable target
- **Link Underline Height:** `2px` for visibility; positioned `2px` below baseline

### Collapsing Strategy
- **Navigation:** On mobile (`<640px`), convert horizontal nav to hamburger menu with off-canvas drawer; show/hide via toggle button (`24px` icon in `44px` touch target)
- **Cards:** On tablet and below, stack cards in single column or 2-column grid; never force 4-column layout on screens below `1024px`
- **Hero Section:** On mobile, reduce display heading from `56px` to `36px`; maintain `32px` on tablet; full `56px` on desktop and wider
- **Feature Grid:** Desktop: 4 columns; Tablet: 2 columns; Mobile: 1 column; adjust gap from `32px` to `20px` on tablet, `16px` on mobile
- **Modals:** On mobile, modals occupy `90vw` width with `16px` margin; on tablet+, constrain to `520px` max-width
- **Form Fields:** On mobile, stack inputs vertically with `16px` gap; full-width (`100%`); on desktop, permit 2-column layout with `16px` gutter

## 9. Agent Prompt Guide

### Quick Color Reference
- **Primary CTA Button:** Electric Blue (`#007AFF`)
- **Primary Text:** Brand Black (`#171717`)
- **Background / Surface:** Pure White (`#FFFFFF`)
- **Navigation Background:** Midnight (`#000000`)
- **Success State:** Luminous Lime (`#86FC6F`)
- **Warning / Alert:** Amber (`#F59E0B`)
- **Heading Text:** Brand Black (`#171717`)
- **Secondary Text / Disabled:** Medium Gray (`#616061`)
- **Card Background:** Pure White (`#FFFFFF`)
- **Card Border:** Light Gray (`#F0F0F0`)
- **Accent / Hover:** Deep Blue (`#0078FF`)

### Iteration Guide

1. **All text uses Aeonik Pro font-weight 400 exclusively** — never apply bold or italic; achieve hierarchy through font size and color only (H1: `56px`, H3: `21px`, Body: `14px`, Buttons: `13px`)

2. **Primary Call-to-Action buttons are always Electric Blue (`#007AFF`) with `12px 24px` padding, `8px` border-radius, `44px` height** — shadow `0px 4px 12px rgba(0, 122, 255, 0.25)`

3. **Card padding is minimum `24px` with `12px` border-radius and light shadow (`0px 1px 3px rgba(0, 0, 0, 0.08)`)** — maintain generous internal whitespace

4. **Navigation bar is solid black (`#000000`) with `58px` height, white text, and floating shadow** — `rgba(135, 135, 135, 0.25) 0px 4px 13.9px 0px`

5. **Success states use Luminous Lime (`#86FC6F`) as background tint; Warning states use Amber (`#F59E0B`)** — never reverse these semantic colors

6. **All interactive elements (buttons, inputs, links) maintain minimum `44px` height for touch accessibility** — spacing between targets minimum `8px`

7. **Section spacing follows: mobile `20px`, tablet `28px`, desktop `32px–48px`** — use maximum spacing for hero and major section breaks

8. **Form inputs have `1px solid #D1D1D1` border, `8px` border-radius, `12px 16px` padding, and focus state with `2px #007AFF` border and `rgba(0, 122, 255, 0.1)` shadow**

9. **Brand Black (`#171717`) is primary text color for all UI; Pure Black (`#000000`) is reserved for navigation and high-contrast overlays** — never use pure black for body copy

10. **Heading hierarchy: H1 `56px` display, H2 `32px` section, H3 `21px` card title, H4 `22px` minor heading** — line heights set to approximately 1.5× font size; body text `14px` with `20px` line-height