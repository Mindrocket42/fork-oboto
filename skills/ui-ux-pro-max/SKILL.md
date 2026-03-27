---
name: ui-ux-pro-max
description: "Design intelligence skill providing UI styles, color palettes, font pairings, chart types, and UX guidelines for building professional interfaces. Based on the open-source UI UX Pro Max project (github.com/nextlevelbuilder/ui-ux-pro-max-skill)."
---

# UI UX Pro Max — Design Intelligence

Searchable design intelligence for building professional UI/UX. Covers 67+ UI styles, 95+ color palettes, 56+ font pairings, 24+ chart types, 29+ landing patterns, and comprehensive UX guidelines.

## When to Apply

Use this skill when the task involves **UI structure, visual design decisions, interaction patterns, or user experience quality control**.

### Must Use
- Designing new pages (Landing Page, Dashboard, Admin, SaaS, Mobile App)
- Creating or refactoring UI components (buttons, modals, forms, tables, charts)
- Choosing color schemes, typography systems, spacing, or layout systems
- Reviewing UI code for UX, accessibility, or visual consistency
- Implementing navigation, animations, or responsive behavior
- Making product-level design decisions (style, hierarchy, branding)
- Improving perceived quality, clarity, or usability

### Skip
- Pure backend logic
- API or database design only
- Non-UI performance optimization
- Infrastructure or DevOps
- Non-visual scripting or automation

**Rule of thumb**: If the task changes how something **looks, feels, moves, or is interacted with**, use this skill.

---

## How to Use This Skill

| Scenario | Trigger Examples | Action |
|----------|-----------------|--------|
| **New project / page** | "Build a landing page", "Create a dashboard" | Full design system recommendation |
| **New component** | "Create a pricing card", "Add a modal" | Style + UX domain guidance |
| **Choose style / color / font** | "What style fits a fintech app?" | Design system recommendation |
| **Review existing UI** | "Review this page for UX issues" | Quick Reference checklist |
| **Fix a UI bug** | "Button hover is broken" | Relevant Quick Reference section |
| **Improve / optimize** | "Make this faster", "Improve mobile UX" | UX + Performance guidelines |
| **Dark mode** | "Add dark mode support" | Dark mode style guidelines |
| **Charts / data viz** | "Add analytics charts" | Chart type recommendations |

### Workflow

#### Step 1: Analyze User Requirements
Extract from the user request:
- **Product type**: SaaS, E-commerce, Portfolio, Healthcare, Fintech, Entertainment, etc.
- **Target audience**: Consumer, Enterprise, Developer, etc.
- **Style keywords**: playful, vibrant, minimal, dark mode, content-first, immersive, etc.
- **Tech stack**: React, Next.js, Vue, Svelte, React Native, etc.

#### Step 2: Select Design System
Match the product type to a recommended style, color palette, typography, and layout pattern using the databases below.

#### Step 3: Apply Quality Rules
Use the Quick Reference checklist (Priority 1-10) to ensure professional quality.

#### Step 4: Deliver with Checklist
Run through the Pre-Delivery Checklist before presenting the final result.

---

## Design Style Database (67+ Styles)

### Core Styles

| Style | Best For | Key CSS Properties | Colors |
|-------|----------|-------------------|--------|
| **Glassmorphism** | SaaS, Dashboards, Modern apps | `backdrop-filter: blur(12-20px)`, `background: rgba(255,255,255,0.1)`, `border: 1px solid rgba(255,255,255,0.2)` | Semi-transparent whites/blacks, vibrant accent |
| **Neumorphism** | Settings, Controls, Calculators | `box-shadow: 8px 8px 16px #d1d1d1, -8px -8px 16px #ffffff` | Soft grays, muted pastels |
| **Minimalism** | Portfolios, Blogs, Landing pages | Clean whitespace, `max-width`, limited color palette | Monochrome + 1 accent |
| **Brutalism** | Creative agencies, Art portfolios | Raw borders, system fonts, high contrast | Black, white, 1 bold accent |
| **Aurora UI** | AI products, Creative tools | Gradient meshes, `background: conic-gradient(...)`, blur overlays | Purple-blue-teal gradients |
| **Flat Design** | Mobile apps, Dashboards | No shadows, solid colors, clean edges | Bold, saturated palette |
| **Material Design 3** | Android apps, Cross-platform | Dynamic color, elevation system, rounded corners (28px) | Tonal palettes from seed color |
| **Liquid Glass** | Premium products, Apple-style | `backdrop-filter: blur(40px)`, refraction effects, layered transparency | Translucent layers |
| **Dark Mode (OLED)** | Fintech, Gaming, Dev tools | `background: #000000`, careful contrast, accent glow | Pure black + neon accents |
| **Claymorphism** | Kids apps, Playful products | `border-radius: 24-32px`, inner shadow, soft 3D feel | Pastel, vibrant |
| **Retro/Pixel** | Gaming, Nostalgia products | Pixel fonts, 8-bit color palette, sharp edges | Limited retro palette |
| **Skeuomorphism** | Music apps, Instrument UIs | Realistic textures, gradients, depth | Natural, realistic |
| **Micro-interactions** | Any modern UI | CSS transitions 150-300ms, spring physics, state feedback | Any palette |
| **AI-Native UI** | AI/ML products, Chatbots | Streaming text, thinking indicators, confidence viz | Dark + accent glow |
| **Motion-Driven** | Storytelling, Marketing | Scroll-triggered, parallax, GSAP/Framer Motion | Any palette |

### Style-Product Matching

| Product Type | Recommended Styles | Avoid |
|-------------|-------------------|-------|
| **SaaS / Dashboard** | Glassmorphism, Flat Design, Material 3 | Brutalism, Skeuomorphism |
| **E-commerce** | Minimalism, Flat Design, Clean Modern | Brutalism, Neumorphism |
| **Fintech / Crypto** | Dark Mode OLED, Glassmorphism, AI-Native | Claymorphism, Retro |
| **Healthcare** | Minimalism, Clean, Material 3 | Brutalism, Dark OLED |
| **Portfolio / Creative** | Brutalism, Minimalism, Motion-Driven | Corporate flat |
| **AI / ML Product** | AI-Native UI, Aurora, Dark Mode | Skeuomorphism, Retro |
| **Kids / Education** | Claymorphism, Vibrant Flat, Micro-interactions | Minimalism, Brutalism |
| **Gaming** | Dark OLED, Retro/Pixel, Motion-Driven | Corporate, Healthcare |
| **Food / Restaurant** | Warm Minimalism, Photo-centric, Clean | Brutalism, Tech-heavy |
| **Real Estate** | Clean Modern, Photo-centric, Glassmorphism | Retro, Pixel |
| **Beauty / Spa** | Soft Minimalism, Liquid Glass, Elegant | Brutalism, Tech |
| **Developer Tools** | Dark Mode, Terminal-aesthetic, Flat | Claymorphism, Pastel |

---

## Color Palette Database (95+ Palettes)

### By Product Type

| Product Type | Primary | Secondary | CTA | Background | Text | Border |
|-------------|---------|-----------|-----|------------|------|--------|
| **SaaS** | `#3B82F6` | `#60A5FA` | `#F97316` | `#F8FAFC` | `#1E293B` | `#E2E8F0` |
| **E-commerce** | `#7C3AED` | `#A78BFA` | `#F59E0B` | `#FFFFFF` | `#111827` | `#E5E7EB` |
| **Fintech** | `#10B981` | `#34D399` | `#3B82F6` | `#0F172A` | `#F1F5F9` | `#1E293B` |
| **Healthcare** | `#0EA5E9` | `#38BDF8` | `#22C55E` | `#F0F9FF` | `#0C4A6E` | `#BAE6FD` |
| **Education** | `#8B5CF6` | `#A78BFA` | `#F97316` | `#FAF5FF` | `#1E1B4B` | `#DDD6FE` |
| **Portfolio** | `#000000` | `#404040` | `#FF4500` | `#FFFFFF` | `#171717` | `#E5E5E5` |
| **AI/ML** | `#6366F1` | `#818CF8` | `#06B6D4` | `#020617` | `#E2E8F0` | `#1E293B` |
| **Gaming** | `#EF4444` | `#F87171` | `#FBBF24` | `#0A0A0A` | `#FAFAFA` | `#262626` |
| **Food/Restaurant** | `#DC2626` | `#F87171` | `#F59E0B` | `#FFF7ED` | `#431407` | `#FED7AA` |
| **Real Estate** | `#0D9488` | `#2DD4BF` | `#F97316` | `#F0FDFA` | `#134E4A` | `#99F6E4` |
| **Beauty/Spa** | `#EC4899` | `#F9A8D4` | `#A855F7` | `#FDF2F8` | `#831843` | `#FBCFE8` |
| **Crypto/DeFi** | `#F59E0B` | `#FBBF24` | `#10B981` | `#0C0A09` | `#FAFAF9` | `#292524` |

### Dark Mode Palette Rules
- Use **desaturated/lighter tonal variants**, not inverted colors
- Background: `#000000` (OLED) or `#0F172A` (soft dark)
- Surface: `#1E293B` or `#18181B`
- Text: `#E2E8F0` (primary), `#94A3B8` (secondary)
- Borders: `rgba(255,255,255,0.1)` or `#2D3748`
- Test contrast separately from light mode

---

## Typography Database (56+ Pairings)

### Recommended Pairings

| Mood | Heading Font | Body Font | Google Import |
|------|-------------|-----------|---------------|
| **Modern Tech** | Space Grotesk (700) | Inter (400) | `family=Space+Grotesk:wght@700&family=Inter:wght@400;500;600` |
| **Elegant Luxury** | Playfair Display (700) | Lato (400) | `family=Playfair+Display:wght@700&family=Lato:wght@400;700` |
| **Clean Professional** | Plus Jakarta Sans (700) | Plus Jakarta Sans (400) | `family=Plus+Jakarta+Sans:wght@400;500;600;700` |
| **Playful Friendly** | Fredoka (600) | Nunito (400) | `family=Fredoka:wght@600&family=Nunito:wght@400;600` |
| **Developer** | JetBrains Mono (700) | Inter (400) | `family=JetBrains+Mono:wght@700&family=Inter:wght@400;500` |
| **Editorial** | Fraunces (700) | Source Serif 4 (400) | `family=Fraunces:wght@700&family=Source+Serif+4:wght@400;600` |
| **Startup** | Outfit (700) | DM Sans (400) | `family=Outfit:wght@700&family=DM+Sans:wght@400;500;700` |
| **Creative Bold** | Clash Display (700) | Satoshi (400) | Use CDN: `api.fontshare.com` |
| **Warm Organic** | Libre Baskerville (700) | Source Sans 3 (400) | `family=Libre+Baskerville:wght@700&family=Source+Sans+3:wght@400;600` |
| **Minimal Swiss** | Helvetica Neue / Inter (700) | Inter (400) | `family=Inter:wght@400;500;600;700` |

### Type Scale
```
xs: 12px | sm: 14px | base: 16px | lg: 18px | xl: 20px
2xl: 24px | 3xl: 30px | 4xl: 36px | 5xl: 48px | 6xl: 60px
```

### Typography Rules
- Body text minimum **16px** on mobile (avoids iOS auto-zoom)
- Line height: **1.5–1.75** for body, **1.1–1.3** for headings
- Line length: **35–60 chars** mobile, **60–75 chars** desktop
- Font weight hierarchy: Bold headings (600–700), Regular body (400), Medium labels (500)
- Use `font-display: swap` to avoid FOIT

---

## Chart Type Database (24+ Types)

| Chart Type | Best For | Recommended Library | Accessibility |
|-----------|---------|-------------------|---------------|
| **Line** | Trends over time | Recharts, Chart.js | Add data point markers |
| **Bar** | Comparisons | Recharts, Chart.js | Use patterns + color |
| **Stacked Bar** | Part-to-whole comparison | Recharts | Label segments |
| **Pie/Donut** | Proportions (≤6 segments) | Recharts, D3 | Add labels, not color-only |
| **Area** | Volume over time | Recharts | Use gradient fill |
| **Scatter** | Correlation | D3, Recharts | Size + color encoding |
| **Heatmap** | Density/frequency | D3, Nivo | Sequential color scale |
| **Treemap** | Hierarchical proportions | Recharts, D3 | Label all segments |
| **Funnel** | Conversion flows | Custom, Recharts | Show percentages |
| **Sparkline** | Inline trends | Recharts | Minimal, contextual |
| **Radar** | Multi-variable comparison | Recharts | ≤8 axes |
| **Candlestick** | Financial data | Lightweight Charts | OHLC tooltips |
| **Sankey** | Flow/transfer | D3 | Label all nodes |
| **Gauge** | Single KPI | Custom | Show value + label |

---

## Landing Page Patterns (29+ Patterns)

| Pattern | Structure | Best For | CTA Strategy |
|---------|-----------|---------|-------------|
| **Hero + Features** | Hero → Features grid → CTA | SaaS, Tools | Primary CTA in hero, repeat at bottom |
| **Hero + Social Proof** | Hero → Logos → Testimonials → CTA | B2B SaaS | Trust-first, CTA after proof |
| **Video-First** | Video hero → Benefits → CTA | Products needing demos | CTA overlay on video |
| **Pricing-Centric** | Hero → Pricing table → FAQ → CTA | SaaS, Subscriptions | Highlight recommended plan |
| **Storytelling** | Narrative scroll → Problem → Solution → CTA | Brand, Cause | Emotional CTA at climax |
| **Product Hunt** | Hero → Demo GIF → Features → Testimonials | Launches | "Get Started" + "See Demo" |
| **Comparison** | Hero → Comparison table → Benefits → CTA | Competitive products | "Switch Now" positioning |
| **Interactive Demo** | Hero → Live demo → Features → CTA | Dev tools, SaaS | "Try it Now" inline |

---

## Quick Reference — Quality Rules by Priority

### §1. Accessibility (CRITICAL)
- `color-contrast` — Minimum 4.5:1 for normal text (3:1 for large text)
- `focus-states` — Visible focus rings (2–4px) on all interactive elements
- `alt-text` — Descriptive alt text for meaningful images
- `aria-labels` — aria-label for icon-only buttons
- `keyboard-nav` — Tab order matches visual order; full keyboard support
- `heading-hierarchy` — Sequential h1→h6, no level skipping
- `color-not-only` — Don't convey info by color alone (add icon/text)
- `reduced-motion` — Respect `prefers-reduced-motion`
- `dynamic-type` — Support system text scaling

### §2. Touch & Interaction (CRITICAL)
- `touch-target-size` — Min 44×44pt (Apple) / 48×48dp (Material)
- `touch-spacing` — Minimum 8px gap between touch targets
- `hover-vs-tap` — Don't rely on hover alone; use click/tap
- `loading-buttons` — Disable button during async; show spinner
- `error-feedback` — Clear error messages near the problem
- `press-feedback` — Visual feedback on press (ripple/highlight)
- `safe-area-awareness` — Keep targets away from notch, gesture bar, screen edges

### §3. Performance (HIGH)
- `image-optimization` — Use WebP/AVIF, srcset, lazy load non-critical
- `image-dimension` — Declare width/height to prevent layout shift (CLS)
- `font-loading` — `font-display: swap` to avoid invisible text
- `lazy-loading` — Lazy load below-fold components
- `bundle-splitting` — Split code by route/feature
- `virtualize-lists` — Virtualize lists with 50+ items
- `progressive-loading` — Skeleton screens instead of spinners for >1s ops
- `debounce-throttle` — Debounce/throttle high-frequency events

### §4. Style Selection (HIGH)
- `style-match` — Match style to product type
- `consistency` — Same style across all pages
- `no-emoji-icons` — Use SVG icons (Lucide, Heroicons, Phosphor), NOT emojis
- `effects-match-style` — Shadows, blur, radius aligned with chosen style
- `elevation-consistent` — Consistent shadow scale for cards, sheets, modals
- `dark-mode-pairing` — Design light/dark variants together
- `icon-style-consistent` — One icon set with consistent stroke/corner style
- `primary-action` — One primary CTA per screen; secondary actions subordinate

### §5. Layout & Responsive (HIGH)
- `mobile-first` — Design mobile-first, then scale up
- `breakpoint-consistency` — Systematic breakpoints (375 / 768 / 1024 / 1440)
- `readable-font-size` — Min 16px body on mobile
- `horizontal-scroll` — No horizontal scroll on mobile
- `spacing-scale` — 4pt/8dp incremental spacing system
- `z-index-management` — Defined z-index scale (0/10/20/40/100/1000)
- `viewport-units` — Prefer `min-h-dvh` over `100vh` on mobile

### §6. Typography & Color (MEDIUM)
- `line-height` — 1.5–1.75 for body text
- `line-length` — 65–75 characters per line
- `font-scale` — Consistent type scale (12/14/16/18/24/32)
- `color-semantic` — Semantic color tokens, not raw hex in components
- `color-dark-mode` — Desaturated/lighter variants, not inverted
- `weight-hierarchy` — Bold headings (600-700), Regular body (400)

### §7. Animation (MEDIUM)
- `duration` — 150–300ms for micro-interactions
- `easing` — `ease-out` for entrances, `ease-in` for exits
- `spring-physics` — Use spring for natural feel (mass, stiffness, damping)
- `exit-faster-than-enter` — Exit animations ~30% faster
- `spatial-continuity` — Elements animate from/to logical positions
- `no-decorative-only` — Animation must convey meaning or aid navigation
- `reduced-motion-fallback` — Provide instant alternatives

### §8. Forms & Feedback (MEDIUM)
- `visible-labels` — Always use visible labels (not placeholder-only)
- `inline-validation` — Validate on blur, show error near field
- `error-clarity` — Specific error messages ("Email must include @")
- `progressive-disclosure` — Show fields progressively, don't overwhelm
- `focus-management` — Auto-focus first field; move focus to errors

### §9. Navigation (HIGH)
- `nav-hierarchy` — Clear primary/secondary/utility navigation
- `bottom-nav-limit` — Max 5 items in bottom navigation
- `back-behavior` — Predictable back navigation
- `deep-linking` — Support deep links to all major screens
- `breadcrumbs` — Show location in complex hierarchies

### §10. Charts & Data (LOW)
- `legends` — Always include legends for multi-series
- `tooltips` — Interactive tooltips with formatted values
- `accessible-colors` — Don't rely on color alone; use patterns/labels
- `responsive-charts` — Charts must resize with container

---

## Common Professional UI Rules

### Icons & Visual Elements
| Rule | Standard | Avoid |
|------|----------|-------|
| **No Emoji as Icons** | Use SVG icons (Lucide, Heroicons, Phosphor) | 🏠 ⚙️ 📊 as UI icons |
| **Consistent stroke** | Same weight/style across all icons | Mixing outlined + filled |
| **Icon sizing** | 16/20/24px with consistent optical alignment | Random sizes |
| **Icon + label** | Pair icons with text labels for clarity | Icon-only navigation |

### Shadows & Elevation
| Level | Usage | CSS |
|-------|-------|-----|
| **Level 0** | Flat elements | `none` |
| **Level 1** | Cards, buttons | `0 1px 3px rgba(0,0,0,0.1)` |
| **Level 2** | Dropdowns, popovers | `0 4px 12px rgba(0,0,0,0.15)` |
| **Level 3** | Modals, dialogs | `0 12px 40px rgba(0,0,0,0.2)` |
| **Level 4** | Toast, notifications | `0 20px 60px rgba(0,0,0,0.3)` |

### Spacing System (8px grid)
```
4px  — tight (icon padding)
8px  — compact (inline spacing)
12px — default (element gaps)
16px — comfortable (section padding)
24px — spacious (card padding)
32px — section gaps
48px — major section separation
64px — page section separation
```

### Border Radius Scale
| Usage | Radius | Tailwind |
|-------|--------|----------|
| Buttons, inputs | 6-8px | `rounded-md` / `rounded-lg` |
| Cards | 8-12px | `rounded-lg` / `rounded-xl` |
| Modals | 12-16px | `rounded-xl` / `rounded-2xl` |
| Avatars, pills | 9999px | `rounded-full` |
| Images | 8-12px | `rounded-lg` / `rounded-xl` |

---

## Pre-Delivery Checklist

Before presenting any UI work, verify:

- [ ] **Contrast**: All text meets 4.5:1 ratio
- [ ] **Touch targets**: All interactive elements ≥ 44×44pt
- [ ] **Focus states**: Visible focus rings on all interactive elements
- [ ] **SVG icons**: No emoji used as structural icons
- [ ] **Hover feedback**: All clickable elements have hover states
- [ ] **Dark mode**: Contrast tested independently
- [ ] **Responsive**: Tested at 375px (small phone) and landscape
- [ ] **Loading states**: Skeleton/spinner for async operations
- [ ] **Error states**: Clear, contextual error messages
- [ ] **Reduced motion**: Animations respect `prefers-reduced-motion`
- [ ] **Consistent style**: Same design language across all components
- [ ] **Typography**: 16px+ body, proper line-height, readable line-length
- [ ] **Spacing**: Consistent spacing scale (4/8px grid)
- [ ] **Elevation**: Consistent shadow scale
- [ ] **Primary CTA**: One clear primary action per screen

---

## Tips for Better Design Decisions

| Problem | Solution |
|---------|----------|
| Can't decide on style/color | Match to product type using Style-Product table above |
| Dark mode contrast issues | Use desaturated tonal variants; test contrast separately |
| Animations feel unnatural | Use spring physics; exit 30% faster than enter |
| Form UX is poor | Inline validation, visible labels, progressive disclosure |
| Navigation feels confusing | Clear hierarchy, max 5 bottom nav items, predictable back |
| Layout breaks on small screens | Mobile-first, systematic breakpoints, no horizontal scroll |
| Performance/jank | Virtualize lists, lazy load, skeleton screens, debounce |
| UI looks "unprofessional" | Check icon consistency, spacing scale, shadow system, typography |
