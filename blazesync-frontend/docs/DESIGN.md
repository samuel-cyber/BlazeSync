# BlazeSync design notes

The brief (spec section 8): a financial trust product for Nigerian students,
read mostly on budget Android phones, sometimes mid-argument at a general
meeting. The balance has to win every screen it's on.

## Palette

Tokens live in `src/app/globals.css`, with a matched dark theme. Every text
colour was checked against its ground (WCAG AA: 4.5:1 text, 3:1 edges).

| Token | Light | Job |
|---|---|---|
| `ink` | `#141A3A` | Text. Biro blue-black, the colour dues were always written in. |
| `paper` | `#F1F3F7` | Page ground. Cool, like a bank statement, not a notebook. |
| `brand` | `#2843AA` | Actions, links, focus. A bright cobalt. |
| `slab` | `#2843AA` | The ledger head, the one solid block, in the same cobalt, so the balance sits alone. White text on it is 8.5:1. |
| `ember` | `#F0532B` | Exactly three jobs: live, just happened, and Blaze with no fee. On the cobalt panel the live dot wears a white ring, because orange on cobalt alone is only 2.4:1. |
| `credit` | `#0B7340` | Money in. Money out stays in ink: spending is normal, not alarming. |
| `warn` / `danger` | `#8A5A00` / `#B42318` | Always paired with an icon and words, never colour alone. |

## Type

One family: **Archivo**. It has a real ₦ glyph (many Google fonts don't; we
checked the ones we considered) and a width axis. Balances are set at 800
weight and 80% width, so ₦1,284,500 fits a 360px phone at a size readable across
a room. The ₦ is raised and set at half size, the way banks print balances.
Digits are tabular in columns and proportional in big standalone figures.

## Layout

- **Phones first.** Bottom tab bar, 48px touch targets, 16px body text.
- **The ledger is the hero.** The balance head is the first element on both
  dashboards. On a member's phone the order is balance, what you owe, then the
  statement, so Pay is visible without scrolling.
- **The statement shows its working.** Every row has the amount *and* the
  balance after it, so anyone can check each line follows from the one below.
- Content is left-aligned throughout. Numbers right-align in columns.
- Cards are used only where something is a unit (a dues item, a payout).
  Lists and statements are one surface with hairline rows.

## Motion

A small, fixed set of curves and durations. Everything is in the motion
section of `src/app/globals.css`.

| Token | Value | Used for |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Almost everything |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Reserved for things that move and return |
| `--t-press` | 120ms | Press feedback |
| `--t-ui` | 180ms | Rows, toasts, small state changes |
| `--t-enter` | 220ms | Screen entrance, dialogs |

**The authored moment:** a ledger entry arriving. It opens its own row,
washes ember, and fades while the balance counts up to the new total. That's
the product's whole argument, so it gets the budget.

**The second tier:** a payment succeeding (also claiming an invite and
joining). The check mark lands, then the words, then the receipt, so the
result is read before the detail.

**Everything else only stops things teleporting:**

| Class | What it does |
|---|---|
| `.view` | Each screen settles in (6px, 220ms) on every navigation |
| `.stagger` | List rows arrive in sequence, 35ms apart, capped at the 8th row. Rows that arrived live never replay it |
| `.press` | Buttons, cards, tabs settle to 98.5% while pressed |
| `.success` | The sequenced success moment above |
| `.land` | A result appearing: the receipt check, the tamper test |
| `.slot-land` | Payout signature slots fill in order |
| `.hero-seq` + `.hero-land` | The landing page's single page-load sequence |
| `.meter-fill` | Meters fill from empty once, then glide on change |
| `.bump` | The payouts badge bumps once when its count changes, never on first paint |
| `.toast` | Toasts are transitions, not keyframes, so they retarget; they leave the way they came |
| `dialog[open]` | Rises as a sheet on phones, settles in place on wider screens |
| `.guide-panel` | The demo guide rises as a sheet on phones and grows from its corner on desktop, and leaves the way it came |
| `.spark-path` / `.spark-end` | When a payment lands, the balance line rises to its new point in step with the figure counting up |

Hover styles only apply on devices that really hover (Tailwind 4's default),
so a tap never leaves a stuck hover state.

**Reduced motion** (`prefers-reduced-motion`) means less movement, not a dead
interface: fades that signal a change survive, travel and scaling don't. The
live pulse and the badge bump stop. A new ledger entry appears in place, and
its ember wash still fades, because that's colour, not movement.

## Copy

Written from the student's side: "You paid ₦2,000", not "Transaction
processed". Errors say what happened and what to do ("The account has
₦186,750 available. Lower the amount, or wait for more dues to come in").
Empty states say what will appear and what to do to make it appear.

## What we avoided on purpose

Generic SaaS cards with identical shadows, gradient washes, ALL-CAPS labels
above headings, and a monospace face for data. Monospace appears in one place:
receipt fingerprints, where comparing characters is the actual task.
