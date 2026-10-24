# Mobile UI overhaul: design system and plan

Status: **final. Phase A approved 2026-10-24 with the decisions in §10; slices U1, U2 and U3
built 2026-10-24.** Where the build differs from the text below, "Built in U1", "Built in U2"
and "Built in U3" say so, and the text of §6 and §7 has been brought to the built state.
This is a restyle and restructure of `apps/mobile`: no financial calculation
changes, and the UI language stays English. The one new figure (the chart's period return,
§6.1) is a combination of figures core already computes; it is defined in `docs/kpis.md`
§4.1 and computed in `packages/core`, like every other number.

Contents: 1 principles · 2 colour tokens · 3 typography · 4 spacing, radii, motion ·
5 icons · 6 shared components · 7 screens (text wireframes) · 8 slices U1–U3 · 9 risks and
checks · 10 decisions.

## Built in U1 (2026-10-24)

Everything in §8 U1 is built. Where the build differs from the text of this document:

- **Drawer content.** The drawer holds the controls of the old Settings screen (Appearance,
  Privacy, Security, Data, Certificados, Sign out, version) under the section titles of §6.2;
  U3 added the New transaction options. The content is built the first time the drawer opens
  (the job runs are not fetched before). Its privacy switch is labelled "Hide amounts" and is
  the eye's switch.
- **Closed positions** is no longer a route of its own: it was the same list as Positions ›
  Closed, which stays.
- **Pushed screens** show the header in back mode plus a `title2` title in the content (the
  old stack title); each screen's own restyle is U2.
- **`Badge`** text is `muted` on `pressed`, not `faint`: `faint` on `pressed` is 4.3:1 in the
  light theme. The contrast test checks `faint` on `background`, `surface` and `raised`, and
  `muted` on `pressed`.
- **Segment changes and re-pressing a tab** were not animated / did not scroll in U1; both
  arrived in U3 (see "Built in U3").
- **The "+" button**: 56 dp circle with a 4 dp ring in the screen colour; the ring's edge is
  12 dp above the bar, so 48 dp of the circle is inside the bar, which is where Android
  delivers touches.
- **Settings**: a new install starts in Dark; settings stored without an Appearance read as
  System (no migration). (`newTxTypes`, parsed but unused in U1, became `newTxOptions` in U3.)
- **Tests added**: formatter, theme contrast (all three grounds), header, drawer, Android back
  order, tab bar, one dashboard build, top movers layout, chart return, privacy on every
  screen, and two source scans (no colour value outside `theme.ts`, no amount formatter outside
  `ui/Amount.tsx`).

## Built in U2 (2026-10-24)

Everything in §8 U2 is built: Positions (All, By broker, By type, Closed), Position detail,
Broker detail, Asset transactions, Allocation, Performance, Activity and Transaction detail.
No figure, sort order, filter or search rule changed. Where the build differs from the text
below:

- **Sticky controls are outside the list.** React Native can pin only one level of sticky
  headers, so Positions keeps its segments and search row fixed above the list, and the list
  pins its own group headers (the type names in By type, the months in Activity). Activity's
  one control row (Filter, Clear filters) is fixed the same way. Both lists are `SectionList`s
  that scroll themselves (`PortfolioScreen` takes `list`); the "as of" line, scope note and
  the Sort / Filter panels are the top of the list, and opening a panel scrolls to it.
- **Activity filters stay a Filter button and a panel** (asset search, broker, type, date as
  chips), not the row of drop-down chips of §7.4: that would change how the filters work.
- **Activity amounts carry a sign**: − on a purchase, subscription or fee, + on a sale,
  redemption, dividend or interest (`listedTotal`), in the normal text colour: a purchase is
  not a loss. The figure is the row's `totalEur`; only its sign is chosen for display.
- **Performance order**: the Monthly / Yearly switch, the bar chart, best and worst month,
  then the table (a long table would otherwise push the summary out of sight).
- **Charts**: `ChartFrame` takes `xLabels` (the first and last date, faint, under the chart;
  no y labels, which would be amounts). The price chart is the value line over its area, like
  the Dashboard's. Bars have 12 dp bars and a 50 dp pair pitch so "Oct 2026" fits, four dashed
  rules in `chart.axis`, a zero line in `faint`, and labels at `caption` size in `faint`
  (they were 9 pt). The donut has a ground-coloured gap between arcs so neighbouring hues stay
  apart in dark; on Allocation it is a thinner ring with the largest group's % in the centre.
  Chart data and tooltip configs are memoized (core already thins every series to 300
  points), and the tooltip is one component (`ChartTooltip`) for both line charts.
- **`ui/Badge`** has `warning` and `danger` tints for the screens that used them (the
  certificados "over 35 days" badge); everywhere else it is the quiet default.
- **Empty and loading states**: `NothingInScope` is an `EmptyState`; each screen's skeleton
  mirrors its layout; lists show "No positions match." / "No transactions match" with a
  search icon; `FigureLine` (the Dashboard's label-and-figures row) moved to `ui/` and is
  used by the detail screens.
- **Lists render 20 (Positions) and 30 (Activity, whose month headers count as cells) rows
  before virtualizing**, so a normal ledger paints without blank rows.
- **Tests**: the Allocation row tests read the row's label at index 0 instead of 1 (the
  colour dot is now a view, not a text). New: masked and unmasked list row and chart tooltip,
  the lists' states and pull to refresh, signed Activity totals, distinct chart colours.

## Built in U3 (2026-10-24)

Everything in §8 U3 is built; no figure, validation rule or calculation changed. Where the
build differs from the text below:

- **New transaction options are three switches: Dividend, Interest and Fee** (settings key
  `newTxOptions`, all off by default, saved with the other toggles so they survive a restart).
  This **replaces D5's "Fee field hidden always"** (§10): Fee is still not a transaction type;
  its switch shows the Fee field on Buy and Sell. Hidden, a typed fee is not sent (the row is
  saved with fee 0, as an empty field is). Edit shows the field when the switch is on **or**
  the row being edited already has a fee, so saving never drops a stored fee.
- **The form** is a `SegmentedControl` (Buy, Sell, and Dividend / Interest when on; each
  segment keeps its `Type …` accessibility label), then asset, date, broker, quantity, total
  value, fee and Review in the order of §7.5. A type switched off in the drawer while selected
  falls back to Buy. The form sits in a `KeyboardAvoidingView` (padding) under the header;
  the tab bar already hides with the keyboard. Validation, the confirm screen, the client UUID
  and double-submit protection are untouched. Add asset, the asset picker, Confirm and the
  Resulting position use `Section`, `T` and `Amount`.
- **Calculator** (tab): restyled only. The result starts with the ending value as a `title1`
  hero; the year table is rows with hairlines; the chart stays a `BarChart` in a section
  (its labels are `caption` size, bar gap widened to fit them). Behaviour, defaults, the
  certificados switch and the masked inputs are as before.
- **Certificados and Monthly factors**: restyled only (sections, `T`, `Amount`; the month
  stepper uses 48 dp chevron buttons; Save sits in a keyboard-avoiding scroll view).
- **Sign in, MFA, lock, start-up error**: wordmark, `title1` title, `body` text, 48 dp inputs
  and buttons; MFA's code field has 28 sp tabular digits. aal1 handling and the biometric / PIN
  behaviour are the same code.
- **Segment changes animate**: the selected tint of every `SegmentedControl` slides to the new
  segment in 160 ms (a native-driver `translateX`), and jumps when the phone's "Remove
  animations" is on. Until the track has been measured (and in tests) the selected segment
  carries the tint itself.
- **Re-pressing the current tab scrolls it to the top** on Dashboard, Positions, Activity,
  Calculator and New transaction (`useScrollToTop`; pushed screens are unaffected).
- **Removed**: `ui/Money.tsx` (`Money`, `Units`, `Pct`), `Card` and `Segmented` in `ui/parts`;
  the "More" button and its state in the form. `Field`, `Button`, `Banner`, `Line` stay in
  `ui/parts`, restyled with tokens and the type scale.
- **Tests added**: the three options show and hide their option, are the defaults (Buy and
  Sell only), persist across a restart and fall back to Buy; the drawer's appearance, privacy
  and security switches persist and apply; no More route and the Calculator tab is reachable;
  privacy masks the Calculator, Certificados, Monthly factors and the New transaction form.
  The existing New transaction tests run with the three options on, because they exercise
  Dividend, Interest and Fee; one line in them (opening "More types") went with the button.

## 1. Principles

1. **Numbers first.** The figure is the hero: large, tabular numerals, and nothing competing
   with it. Labels are small and quiet.
2. **Whitespace and thin dividers instead of cards.** Sections are separated by space and an
   overline title; rows by a hairline divider. No drop shadows; elevation is a slightly lighter
   surface (dark) or a hairline border (light).
3. **One restrained accent.** The accent marks what is interactive or selected (the "+" button,
   the selected segment, links, the value line). Gain and loss colours are reserved for gains
   and losses. Everything else is greyscale.
4. **Dark first.** The dark theme is designed first and is the default; light is derived from
   it token by token (§2), not designed separately.
5. **Never colour alone.** Every gain or loss keeps its sign (+ / −), so it reads in greyscale,
   for colour-blind users and with privacy on.
6. **One of each thing.** One formatter (`format.ts`), one `Amount` component for every amount,
   one header, one tab bar, one empty/error/loading pattern. Screens compose them and add no
   colour values (`noHardCodedColors.test.ts` keeps enforcing that).
7. **Calm states.** Skeletons while loading (no spinners on content), friendly empty states
   with a next step, errors in place with a code and "Pull down to retry", never an amount in
   an error.
8. **Quiet freshness.** "as of 14:05 · prices 22/10" as a small faint line at the top of each
   screen with figures, not a banner.

## 2. Colour tokens

All values live in `apps/mobile/src/ui/theme.ts` (the only file allowed to hold colours). The
existing `Colors` interface is **extended**, not replaced: current token names keep working,
so screens migrate one slice at a time. New tokens are marked **new**.

### 2.1 Neutrals and surfaces

| Token              | Role                                                    | Dark              | Light                |
| ------------------ | ------------------------------------------------------- | ----------------- | -------------------- |
| `background`       | App background (near-black, not pure black)             | `#0C0E11`         | `#F6F7F9`            |
| `surface`          | Header, tab bar, list sections that need a surface      | `#15181D`         | `#FFFFFF`            |
| `raised` **new**   | Drawer, expanded header, sheets, dialogs, tooltips      | `#1C2026`         | `#FFFFFF`            |
| `pressed` **new**  | Row / button pressed state, skeleton base               | `#23282F`         | `#ECEEF1`            |
| `divider` **new**  | Hairline rows and section rules                         | `#262B32`         | `#E3E6EA`            |
| `border`           | (kept) outlines of chips and the light theme's raised   | `#2C313A`         | `#E3E6EA`            |
| `text`             | Primary text and figures                                | `#ECEFF3`         | `#111418`            |
| `muted`            | Secondary text: labels, names under tickers             | `#A0A8B4`         | `#56606C`            |
| `faint` **new**    | Tertiary: "as of", captions, axis labels, disabled      | `#858E9A`         | `#67707C`            |
| `skeleton` **new** | Skeleton highlight (pulses between `pressed` and this)  | `#2C323A`         | `#E0E3E8`            |
| `scrim` **new**    | Behind the drawer (replaces `modal.backdrop` over time) | `rgba(0,0,0,0.6)` | `rgba(17,20,24,0.4)` |

### 2.2 Accent and semantic

| Token                | Role                                             | Dark      | Light     |
| -------------------- | ------------------------------------------------ | --------- | --------- |
| `accent`             | Desaturated blue: interactive, selected, "+"     | `#8FADE6` | `#2E59BF` |
| `onAccent`           | Text/icon on an accent fill                      | `#0C0E11` | `#FFFFFF` |
| `accentSoft` **new** | Selected segment / chip background               | `#1F2A3D` | `#E6ECF8` |
| `gain`               | Gains (always with a "+")                        | `#5DC28F` | `#11764A` |
| `loss`               | Losses (always with a "−")                       | `#F2827A` | `#BF3329` |
| `gainSoft` **new**   | Tint behind a gain pill (top movers, day change) | `#15281F` | `#E5F3EC` |
| `lossSoft` **new**   | Tint behind a loss pill                          | `#2E1A19` | `#FBE9E7` |
| `onLoss`             | Text on a loss fill (Delete button)              | `#0C0E11` | `#FFFFFF` |
| `warningBg`          | "Excluding certificados", stale notes            | `#2B2514` | `#FFF4D6` |
| `warningText`        |                                                  | `#E6C47E` | `#7A5600` |
| `errorBg`            | Error states                                     | `#2E1A19` | `#FBE9E7` |

### 2.3 Charts, inputs, controls

| Token                | Dark                                                 | Light                                                |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `value` (value line) | = `accent` `#8FADE6`                                 | = `accent` `#2E59BF`                                 |
| `valueFill` **new**  | `#8FADE6` at 18% → 0% (area gradient)                | `#2E59BF` at 12% → 0%                                |
| `invested` (dashed)  | `#858E9A`                                            | `#67707C`                                            |
| `chart.axis`         | `#262B32`                                            | `#E3E6EA`                                            |
| `chart.pointer`      | `#A0A8B4`                                            | `#56606C`                                            |
| `chart.tooltipBg`    | = `raised`                                           | = `raised` + `border`                                |
| `input.background`   | `#15181D`                                            | `#FFFFFF`                                            |
| `input.border`       | `#5F6874`                                            | `#848D99`                                            |
| `tabBar.background`  | = `surface`                                          | = `surface`                                          |
| `tabBar.active`      | `text` (icon + label; accent only on "+")            | `text`                                               |
| `tabBar.inactive`    | `faint`                                              | `faint`                                              |
| `switch.*`           | track off `#3A414B`, on `#3B4F78`, thumb on `accent` | track off `#C5CBD3`, on `#A9BCE6`, thumb on `accent` |

Allocation colours (`types`, `palette`) keep their current hues, desaturated by about 15% in
dark so they sit with the accent; they are checked against `raised` and `background` with the
same script as below.

### 2.4 Contrast (WCAG 2.1, computed)

| Pair (on `background` / `surface` / `raised`) | Dark               | Light              |
| --------------------------------------------- | ------------------ | ------------------ |
| `text`                                        | 16.8 / 15.4 / 14.2 | 17.2 / 18.5 / 18.5 |
| `muted`                                       | 8.1 / 7.4 / 6.8    | 6.0 / 6.4 / 6.4    |
| `faint` (small text, ≥ 4.5 needed)            | 5.8 / 5.4 / 4.9    | 4.7 / 5.0 / 5.0    |
| `accent`                                      | 8.6 / 7.9 / 7.2    | 5.9 / 6.4 / 6.4    |
| `gain`                                        | 8.8 / 8.1 / 7.5    | 5.3 / 5.7 / 5.7    |
| `loss`                                        | 7.6 / 7.0 / 6.4    | 5.3 / 5.6 / 5.6    |
| `onAccent` on `accent`                        | 8.6                | 6.4                |
| `warningText` on `warningBg`                  | 9.1                | 6.1                |
| `input.border` on `input.background` (≥ 3)    | 3.2                | 3.4                |

All text pairs pass AA (4.5:1); `text`, `muted`, `accent`, `gain` and `loss` pass AAA in dark.
Gain and loss are close in luminance (1.2:1 in dark), which is why the sign is mandatory
(principle 5). U1 adds the ratios as a unit test over `themes`, so a later colour tweak that
breaks AA fails `pnpm check`.

## 3. Typography

System font (Roboto on Android): no font loading, no flash, nothing to bundle. Every figure
uses `fontVariant: ['tabular-nums']` so digits line up in columns and do not jitter while
values update. Weights are 400 and 600 only (700 for the expanded total).

| Token      | Size / line | Weight | Use                                                          |
| ---------- | ----------- | ------ | ------------------------------------------------------------ |
| `display`  | 34 / 40     | 700    | Expanded header: portfolio value                             |
| `title1`   | 28 / 34     | 600    | Screen hero figure (position value, calculator ending value) |
| `title2`   | 20 / 26     | 600    | Collapsed header value; in-content screen titles             |
| `headline` | 16 / 22     | 600    | Row primary (ticker, amount), section hero numbers           |
| `body`     | 15 / 20     | 400    | Body text, form inputs (16 inside inputs to avoid tiny text) |
| `sub`      | 13 / 18     | 400    | Secondary row line (name, % under an amount)                 |
| `caption`  | 12 / 16     | 400    | "as of", hints, chart labels                                 |
| `overline` | 11 / 14     | 600    | Section titles, uppercase, letter spacing 0.6                |

Exported from `theme.ts` as `type` (a plain object of text styles, colour-free), used through
a `<T variant="headline">` text component so no screen sets `fontSize` directly. Android
font scaling is respected; figures in the header use `maxFontSizeMultiplier={1.3}` so a large
system font cannot push the slim header past its height.

## 4. Spacing, radii, motion

- **Grid: 4 dp.** `space` keeps its names and adds two: `xs 4 · sm 8 · md 12 · lg 16 · xl 24
· xxl 32 (new) · xxxl 48 (new)`. Screen side gutter `lg` (16). Between sections `xl` (24).
  Row vertical padding `md` (12), so a two-line row is ≥ 56 dp.
- **Touch targets** ≥ 48 dp (icons are 24 dp with `hitSlop` to 48).
- **Radii** (new `radius`): `sm 8` (inputs, buttons), `md 12` (sheets, tooltip), `lg 16`
  (drawer edge), `pill 999` (chips, segments, the "+" button).
- **Dividers**: `StyleSheet.hairlineWidth` in `divider`, inset by the gutter.
- **Motion**: 180 ms ease-out for the header expand/collapse and segment changes; the drawer
  uses the library's spring. Everything animates `transform`/`opacity` on the native driver
  (no animated `height`), so nothing re-lays out mid-animation. Respect "Remove animations"
  (`AccessibilityInfo.isReduceMotionEnabled`): jump instead of animating.

## 5. Icons

**Ionicons** from `@expo/vector-icons` (already a dependency, works in Expo Go), outline style
everywhere, 24 dp, one stroke weight. No brand icons or assets.

| Use                  | Icon                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu / back          | `menu-outline` / `chevron-back`                                                                                                                                                                                         |
| Privacy off / on     | `eye-outline` / `eye-off-outline`                                                                                                                                                                                       |
| Tabs                 | `grid-outline` Dashboard, `layers-outline` Positions, `add` (in the accent circle) New, `time-outline` Activity, `calculator-outline` Calculator                                                                        |
| Expand / collapse    | `chevron-down` / `chevron-up` (small, beside the header value)                                                                                                                                                          |
| Row navigation       | `chevron-forward` (faint)                                                                                                                                                                                               |
| Drawer sections      | `contrast-outline` Appearance, `eye-outline` Privacy, `add-circle-outline` New transaction, `lock-closed-outline` Security, `cloud-done-outline` Data, `document-text-outline` Certificados, `log-out-outline` Sign out |
| Empty / error states | `leaf-outline` (empty), `cloud-offline-outline` (error), `search-outline` (no match)                                                                                                                                    |
| Transaction types    | `arrow-down` buy, `arrow-up` sell, `cash-outline` dividend/interest, `swap-horizontal` other (listed in Activity only)                                                                                                  |

## 6. Shared components

All in `apps/mobile/src/ui/`. Each takes no colour props; they read tokens from the theme.

### 6.1 `TopBar` with `ExpandableHeader`

One component, mounted **once in the navigation layout** above the tab navigator (not per
screen, not via each tab's `header` option, which would mount five copies and compute the
figures five times). The stack's detail screens use the same component in `back` mode as
their stack header.

```
collapsed, 56 dp (surface, hairline divider below)
┌──────────────────────────────────────────────┐
│ ☰            14.250,50 €  ▾               👁 │
│             Excluding certificados           │  ← only when the toggle is off (caption,
└──────────────────────────────────────────────┘     warning colour, inside the 56 dp)

expanded (overlay sliding down from under the bar, `raised`, 180 ms)
┌──────────────────────────────────────────────┐
│ ☰            14.250,50 €  ▴               👁 │
├──────────────────────────────────────────────┤
│  PORTFOLIO VALUE                             │
│  14.250,50 €                       (display) │
│                                              │
│  TODAY'S RESULT          TOTAL RESULT        │
│  +85,10 €                +2.031,77 €         │
│  +0,60%                  +16,63%             │
│                                              │
│  Excluding certificados · as of 14:05        │
└──────────────────────────────────────────────┘
          content below stays where it was
```

- Props: `mode: 'menu' | 'back'`. Left: menu (opens the drawer) or back (pops the stack).
  Center: the value, a single pressable area with `accessibilityRole="button"`,
  `accessibilityState={{ expanded }}` and the label "Portfolio value, show details". Right:
  the eye.
- **Figures** come from one `PortfolioSummary` context at the layout level that runs
  `useDashboard()` once; the Dashboard screen reads the same context instead of building its
  own (so the core build runs once, not twice). Portfolio value = _V(T)_; Today's result =
  day change € and % (`kpis.md` §2); Total result = total gain _G_ (`kpis.md` §1) and the TWR
  Since start, cumulative (`kpis.md` §3; §10 D1). All in the current asset scope, with the "Excluding certificados"
  indicator when the toggle is off.
- **States**: loading → a skeleton bar in place of the value; error or unvalued (no FX rate)
  → "—" and the expand shows the reason in one line; privacy on → every figure is `•••••`.
- **Expanded state**: a small `HeaderState` context (not persisted), so it is shared by all
  tabs and starts collapsed on launch. **Overlay, not push**: the panel is absolutely
  positioned under the bar and animates `translateY` + `opacity`, so the screen below never
  re-lays out (no jank, no lost scroll position).
- **Android back**: a `BackHandler` subscription in the TopBar: drawer open → let the drawer
  close (return false so React Navigation handles it); else expanded → collapse and consume;
  else fall through to normal back. Tested with a fake back press.

### 6.2 `Drawer`

`@react-navigation/drawer` (with `react-native-gesture-handler` and `react-native-reanimated`)
as a single-route drawer wrapping the tabs, with `drawerContent` = the settings panel. Slides
in from the left over the content with the `scrim`, closes on backdrop tap, swipe, or back;
swipe-to-open from the left edge is on for tab screens only. Width `min(320, 85%)`, `raised`
background, `radius.lg` on the trailing edge. **All of these run in Expo Go** (they ship in it
for SDK 58; installed with `npx expo install` so the versions match). **No native build
needed.** Alternative if you prefer no new dependency: a hand-rolled drawer on `Animated` +
`PanResponder`, which is less smooth and needs its own back handling; I do not recommend it.

Content (final):

```
┌────────────────────────────┐
│ Ledgr                      │
│                            │
│ APPEARANCE                 │
│ [ System | Light | Dark● ] │
│ ────────────────────────── │
│ PRIVACY                    │
│ Hide amounts          [●]  │  ← the same switch as the eye
│ ────────────────────────── │
│ NEW TRANSACTION OPTIONS    │
│ Dividend              [ ]  │
│ Interest              [ ]  │
│ Fee                   [ ]  │
│ ────────────────────────── │
│ SECURITY                   │
│ App lock              [●]  │
│ Lock after  [0|1●|5|15 min]│
│ Block screenshots     [●]  │
│ ────────────────────────── │
│ DATA                       │
│ Last price update  24/10 05:31 ok │
│ Last snapshot      24/10 05:44 ok │
│ ────────────────────────── │
│ Certificados             › │
│ Sign out                   │
│                            │
│ Ledgr 0.1.0 · project abcd │
└────────────────────────────┘
```

### 6.3 `TabBar` with the center button

A custom `tabBar` for the bottom tabs: five slots of equal width, 56 dp tall plus the
navigation bar inset, `surface` with a hairline top divider. Inactive icons `faint`, active
icon and label `text` (the accent is kept for the "+"). The **New transaction** slot renders a
**56 dp accent circle** with a 28 dp `add` icon in `onAccent`, raised 12 dp above the bar's
top edge (by translation, not a shadow; a 4 dp ring in `background` separates it from the
bar), no label, `accessibilityLabel="New transaction"`, `accessibilityRole="button"`, a 56 dp
touch target. Labels: Dashboard, Positions, Activity, Calculator. `tabBarHideOnKeyboard` so
the keyboard gets the room on the form. Re-pressing the current tab scrolls its list to the
top (built in U3).

### 6.4 `Amount` (and the formatter)

**One component for every amount**, replacing `Money`, `Amount`, `Units` and the hand-masked
strings in the chart tooltips and calculator inputs:

```ts
<Amount value={d} />                       // 14.250,50 €
<Amount value={d} sign tone />             // +85,10 € in gain colour
<Amount value={d} currency="USD" dp={2} /> // 412,37 USD
<Amount value={d} kind="units" />          // 3,5
<Amount value={d} kind="pct" sign tone />  // +0,60%
```

- Masked with `•••••` whenever privacy is on, **percentages included** (§10 D2; today's
  `Pct` stays visible while hidden, U1 changes that). Masked amounts keep
  their sign hidden too, and the tone is dropped, so nothing about the amount leaks.
- `useMaskedText()` from the same module for the few places that need a string (chart
  tooltip, the calculator's text inputs, accessibility labels).
- `accessibilityLabel` reads "hidden" when masked.
- **Leak guard (test)**: a source scan like `noHardCodedColors.test.ts` fails if `formatEur`,
  `formatAmount`, `formatUnits` or `formatPct` is imported anywhere but `ui/Amount.tsx`; and a
  render test mounts each screen with privacy on and asserts no `\d` appears next to `€` or a
  currency code.
- **Formatter** (`format.ts`, still one module, still string arithmetic on `Decimal` with
  `toFixed`, never `Intl` or JS numbers; see §9 R3): pt-PT separators, `.` for thousands and
  `,` for decimals, grouping from 4 digits (1.250,50). Currency after the amount with a no-break space (`14.250,50 €`, other currencies by code: `412,37 USD`; §10 D3). Minus
  stays `−` (U+2212), plus `+`. Percent `+1,23%`. Dates `24/10/2026`, `24/10` within the
  current year, times `14:05` (24 h). Month names stay English (`Oct 2026` in Performance):
  the UI language does not change, only separators and the numeric date order do.

### 6.5 `Section`

Replaces `Card` on restyled screens: an overline title, optional right-side action (a link or
a segmented control), content, and `xl` space after. No background, no border, no shadow.

```
OVERLINE TITLE                    Action ›
content…
```

### 6.6 `ListRow`

The one row: left (primary `headline` + secondary `sub`), right (primary figure + secondary
figure, right-aligned, tabular), optional leading icon/badge and trailing chevron; hairline
divider between rows; pressed state `pressed`; min height 56 dp.

```
AAPL                                   1.230,40 €
Apple Inc. · 5 units                       +3,21%
───────────────────────────────────────────────
```

### 6.7 `SegmentedControl`

Replaces `Segmented`: a pill track in `pressed`, the selected segment as `accentSoft` with
`text` label 600; 36 dp tall (48 dp touch area), equal-width segments, `accessibilityRole
="tab"`. Used for ranges, periods, Positions views, Appearance and the transaction type. The
tint slides to the chosen segment in 160 ms (it jumps with "Remove animations").

### 6.8 `Chip`

Filters and small toggles (€/%, asset/broker filters): outline `border`, selected =
`accentSoft` fill; 32 dp tall with 48 dp touch area. A non-interactive `Badge` variant
("stale", "price pending", "approx.", "month only") in `faint` on `pressed`.

### 6.9 `ChartFrame`

Wraps every chart: fixed height (so loading/empty states don't jump), the range
`SegmentedControl` under the chart, a one-line legend, and the empty state ("Not enough
history for a chart yet"). Charts are simplified: no y-axis labels, no grid, a hairline
baseline, value as an accent line with a faint area gradient, net invested as a dashed
`invested` line; scrubbing shows a `raised` tooltip (masked with privacy on).

### 6.10 Skeletons, empty and error states

- `Skeleton` (`width`, `height`, `radius`): a block pulsing `pressed` ↔ `skeleton` (opacity
  loop on the native driver; static when reduce-motion is on). Screen skeletons mirror the
  final layout (`SkeletonRows n={6}`, `SkeletonChart`), so content swaps in without a shift.
- `EmptyState` (icon, title, one line, optional action button), e.g. "No transactions yet ·
  Add your first one with +".
- `ErrorState` (icon, "Could not load the positions", code in `faint`, "Pull down to
  retry"); never an amount.
- `PortfolioScreen` (existing frame) is kept and restyled: it already centralises
  pull-to-refresh, "as of", the scope note and the unvalued state; it gains the skeleton and
  the new states. Pull-to-refresh tints the spinner with `accent` on `raised`.

## 7. Screens (text wireframes)

Common to every tab screen: the TopBar above, the TabBar below, a faint "as of" line first,
then sections. Detail screens: TopBar in back mode, then an in-content `title2` title.

### 7.1 Dashboard

```
as of 14:05 · prices 22/10
[ Include certificados de aforro      ( ●) ]     ← kept here, restyled as a row
⚠ 2 prices stale ▾                               ← freshness (only when it applies)

GAIN
Total gain                          +2.031,77 €
  Realized                            +412,00 €
  Unrealized              +1.401,22 €   +11,02%
  Income                              +260,55 €
  Other costs                          −42,00 €
──────────────────────────────────────────────
Net invested                        12.218,73 €

RETURNS                [ Since start | YTD | 1Y ]
XIRR                    TWR
+9,84%                  +16,63%
a year                  +7,10% a year
Monthly and yearly returns ›

VALUE VS NET INVESTED
   ╱‾‾╲__╱‾‾‾‾  (value, accent, area)
  ─ ─ ─ ─ ─ ─   (net invested, dashed)
[ 1M | 3M | YTD | 1Y● | All ]
Return 1Y      +1.104,30 € · +8,42%         ← only this (kpis §4.1)
●Value  ┄Net invested

ALLOCATION BY TYPE
(donut)  ● Stocks   52,10%  7.424,51 €
         ● ETFs     30,00%  4.275,15 € …
By broker, currency and asset ›

TOP MOVERS          [ Day | Total ]  [ € | % ]
AAPL                            +42,10 €     ← € selected: € main (headline)
Apple Inc.                         +1,20%    ← % under it (sub)
…
```

- The old header card's total and day change move to the TopBar (not duplicated); its
  freshness notes stay on the Dashboard.
- **Chart**: "value change" and "net invested change" lines are removed; one line shows the
  period's market gain € and its TWR % (§10 D4 for the "All" window).
- **Top movers**: with € selected the € amount is the main figure (`headline`) and the % sits
  under it (`sub`); with % selected, the % is the main figure and € under it. Ranking is
  unchanged (`kpis.md` §7).
- Allocation and Performance remain reachable from their section links (they were also under
  More, which goes away).

### 7.2 Positions (U2)

```
as of 14:05 · prices 22/10
[ All | By broker | By type | Closed ]     ← sticky with the search row
🔍 Search ticker, name, ISIN      Sort ▾  Filter
AAPL                         1.230,40 €
Apple Inc. · 5 units  stale      +3,21%
──────────────────────────────────────
…   (FlatList, virtualized)
```

By broker / by type: an overline per group with subtotal and weight, then rows. Closed: the
"Performance, not tax" note as a faint line, then rows (realized €, %). Position detail:
title (ticker + name), hero value `title1` with day change under it, the price chart in a
`ChartFrame`, figure rows (units, average cost, cost basis, unrealized, realized, income),
"By broker" and "Open lots" as compact tables with dividers, "Transactions ›". Broker
detail: same pattern.

### 7.3 Allocation, Performance (U2)

Allocation: `SegmentedControl` Type / Broker / Currency / Asset, donut (thinner ring, centre
label = the largest group's %), rows with a colour dot, €, %. Top 5 / Top 10 as a section.
Performance: Monthly / Yearly as a segmented switch over one table (period, return %,
contributions, market gain, income) with dividers, "approx." badges, MTD/YTD row on top;
the contributions vs market gain bar chart in a `ChartFrame`; best/worst month as two rows.

### 7.4 Activity (U2)

```
as of 14:05
[ Asset ▾ ] [ Broker ▾ ] [ Type ▾ ] [ Dates ▾ ]   ← chips, horizontal scroll
OCTOBER 2026                                       ← sticky section header
↓ AAPL · Buy                         −1.000,00 €
  24/10 · Degiro · 5 units
↑ VWCE · Sell                         +550,00 €
…   (SectionList, virtualized)
```

Transaction detail: rows, then Edit (primary) and Delete (text button in `loss`); dialogs
restyled on `raised`. Behaviour unchanged.

### 7.5 New transaction

```
as of 14:05
[  Buy  |  Sell  ]                      ← default: only these two
[  Buy  |  Sell  |  Dividend  |  Interest  ]   ← with both switched on
ASSET           AAPL · Apple Inc.            Change
DATE            24/10/2026        [Today] [− 1 day]
BROKER          [Degiro] [IBKR]
QUANTITY        [ 5            ]
TOTAL VALUE (€) [ 1.000,00     ]   = 200,00 € per unit
FEE (€, optional) [          ]        ← only with the Fee switch on
[            Review            ]        ← disabled until valid
```

There is no "More" button: Dividend and Interest appear only when switched on in the drawer,
and the Fee field only with the Fee switch (each persisted, all off by default). There is no
Fee type (§10 D5). If a type is switched off while selected, the form falls back to Buy.
Validation (no sale above what the chosen broker holds at the date, positive quantity and
value, no future dates), the confirm screen (summary + resulting position) and double-submit
protection (client UUID, disabled Save with spinner) are exactly as before; only their styling
changed. Hidden, the Fee is saved as 0, as an empty field is. Edit shows the Fee field for a
row that already has a fee even when the switch is off, so editing never drops a stored fee.
The form is a `ScrollView` (`keyboardShouldPersistTaps`) in a `KeyboardAvoidingView`, with the
tab bar hidden while the keyboard is up, so every field stays reachable under the header.

### 7.6 Calculator

The Return calculator, the fifth tab (it appears nowhere else). Its own "Include
certificados" switch on top, the "Your numbers" form (starting value, years and extra months,
expected return with its XIRR / TWR / Custom source, monthly contribution and timing,
inflation, Reset), then the result with the ending value as a `title1` hero and the result
rows, the stacked chart and the year table. Amount inputs and results go through `Amount` and
mask with privacy (the masked inputs are read-only).

### 7.7 Certificados, Factor update

Reached from the drawer link. Rows per subscription (series · month, value, units, factor,
gain, factor age with a `loss` badge when over 35 days); "Update factors". Factor update:
a month stepper (this month, earlier months), one input row per subscription with last
month's factor and the live change, Save as a full-width button. A month already recorded is
read-only.

### 7.8 Sign in, MFA, lock, startup error

Centered single column on `background`: wordmark "Ledgr" in the accent, `title1` title,
fields, primary button; errors inline. MFA: one 6-digit field with large tabular digits.
Lock: the wordmark, "Ledgr is locked", "Unlock" and "Sign out", the reason line after an
attempt. The aal1 gate (every aal1 session lands on the code prompt) and the biometric / PIN
behaviour are unchanged.

### 7.9 Long lists and small phones

- The collapsed TopBar stays fixed and slim (56 dp); it does **not** auto-hide on scroll
  (that fights the expandable header and causes jank). Instead: Positions and Activity move
  from `ScrollView` to virtualized `FlatList` / `SectionList`; their control rows
  (segments, search, filter chips) are sticky; month headers in Activity are sticky;
  re-tapping the tab scrolls to top.
- Budget on a 360×640 dp phone: status bar 24 + TopBar 56 + tab bar 56 + navigation bar 48
  leaves 456 dp of content. With the keyboard open on New transaction the tab bar hides, the
  TopBar stays 56 dp, and the focused field is scrolled into view; checked on the smallest
  emulator profile (§9 R5).

## 8. Slices

Each slice: short plan, implement, tests, `pnpm check`, commit and push, summary, then stop
for review. Screens not yet restyled keep working with the new tokens (old names kept), so
the app is usable between slices.

### U1 — design system, header, drawer shell, footer, Dashboard

- `theme.ts`: new tokens (§2), `type`, `radius`, `space.xxl/xxxl`; contrast test.
- Settings: default appearance **Dark** for new installs (§10 D6); new `newTxTypes { dividend, interest }` (both
  false), parsed defensively like the others; Privacy = the existing `hideValues` (one switch).
- `format.ts`: pt-PT separators and numeric dates (§6.4); its tests updated.
- `ui/`: `T`, `Amount` (+ `useMaskedText`, `MASK = '•••••'`), `Section`, `ListRow`,
  `SegmentedControl`, `Chip`/`Badge`, `ChartFrame`, `Skeleton`, `EmptyState`, `ErrorState`;
  `PortfolioScreen` restyled; old `Money`/`Units` became thin wrappers until U3 migrated
  their last callers and deleted them.
- Navigation: Root stack → Drawer (one route) → layout (`TopBar` + Tabs); custom `TabBar`
  with the center "+"; tabs Dashboard, Positions, New, Activity, Calculator; `MoreScreen` and
  the `ReturnCalculator` stack route removed; `Settings` route removed (its content moves to
  the drawer shell as is); detail screens get `TopBar mode="back"`.
- `PortfolioSummary` and `HeaderState` contexts; Android back order.
- Core (`packages/core`, with tests): the chart's period return per range,
  `marketGainEur` and `twr` on each series range (`kpis.md` §4.1). No existing figure changes.
- Dashboard restyled (§7.1): chart line, top movers layout, header card removed.
- Tests: header (collapsed/expanded, shared across tabs, starts collapsed, masked, scope
  note), eye persists across a restart (settings reload), back order (drawer → header →
  screen), tab bar (5 tabs, "+" label and size), leak guard, contrast, formatter, the new
  core figure; existing tests updated for the new navigation.

### U2 — Positions, Allocation, Performance, Closed positions, Activity

Restyle with `Section`, `ListRow`, `SegmentedControl`, `ChartFrame`, skeletons and states;
`FlatList`/`SectionList` with sticky controls; all amounts through `Amount`. Position and
Broker detail, Asset transactions and Transaction detail restyled with them. Behaviour,
filters, sorting and figures unchanged; existing tests kept green.

### U3 — drawer content, New transaction, Calculator, Certificados, sign-in, MFA, lock (built)

Drawer content in its final sections (§6.2) with the three New transaction switches;
New transaction type selector and Fee field driven by them; Calculator restyled as a tab;
Certificados and Factor update; sign-in, MFA, no-authenticator, lock and startup error
screens; animated segment changes; scroll-to-top on re-pressing a tab. `Money`/`Units`/`Pct`
and `Card`/`Segmented` deleted. `docs/app-plan.md` §1 updated.

## 9. Risks and how each is checked

| #   | Risk                                                                                                                                                                                                                                   | Mitigation and check                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Chart performance**: gifted-charts redraws SVG; area gradients and scrubbing on 300 points can drop frames on a mid-range phone.                                                                                                     | Keep the existing ≤ 300-point thinning (core); memoise chart data per range; one gradient, no data points, no rules. Check on the device with the Perf Monitor while scrubbing 1Y/All; target no visible stutter. Fallback: drop the gradient.                                                 |
| R2  | **Fonts**: a custom font would need loading (flash, Expo Go assets).                                                                                                                                                                   | System Roboto only, `tabular-nums` (supported by Roboto through RN's `fontVariant` on Android). Check in a render test that figures carry the variant, and on device that columns align.                                                                                                       |
| R3  | **Intl on Android**: Hermes' `Intl` with `pt-PT` uses a narrow no-break space for thousands and does not group 4-digit numbers (1250,50), unlike the example; and `Intl.NumberFormat` takes a JS number, which the money rules forbid. | No `Intl`: `format.ts` stays deterministic string formatting from `Decimal.toFixed` with pt-PT separators. Unit tests cover grouping (999, 1.000, 14.250,50, 1.234.567,89), negatives, rounding half-up, zero, masks; on device, check the `−`, `•` and `€` glyphs render in Roboto.           |
| R4  | **Gesture libraries in Expo Go**: version mismatch between `react-native-gesture-handler`/`reanimated`/`worklets` and the Expo Go binary crashes at startup; Jest needs mocks.                                                         | Install with `npx expo install` (SDK-pinned versions), confirm with `npx expo-doctor`; run in Expo Go on the phone before building on it; Jest: `react-native-gesture-handler/jestSetup` and Reanimated's mock in `jest.setup.js`. If Expo Go's versions lag, fall back to §6.2's alternative. |
| R5  | **Vertical space on small phones**: header + tab bar + keyboard on New transaction.                                                                                                                                                    | Slim 56 dp header, `maxFontSizeMultiplier` on header figures, tab bar hidden with the keyboard, expanded header as an overlay (no layout push). Check on a 360×640 emulator with font scale 1.3: every form field reachable with the keyboard open, header never wraps.                        |
| R6  | **Amount leaks**: a figure formatted outside `Amount` would show with privacy on.                                                                                                                                                      | The source scan and the privacy render test (§6.4) in `pnpm check`.                                                                                                                                                                                                                            |
| R7  | **Back-button order** depends on listener order between our `BackHandler` and the navigator's.                                                                                                                                         | The TopBar checks the drawer status explicitly instead of relying on order; a test fires a hardware back three times and asserts drawer closes, then header collapses, then the screen leaves.                                                                                                 |
| R8  | **Double build of the dashboard** (header + Dashboard).                                                                                                                                                                                | One `PortfolioSummary` provider; a test asserts `buildDashboard` runs once per data change.                                                                                                                                                                                                    |

## 10. Decisions (confirmed 2026-10-24)

- **D1 Total result %** in the expanded header = the **TWR Since start**, cumulative
  (`kpis.md` §3), which core already computes. The € figure is the total gain _G_ (§1).
- **D2 Privacy masks percentages too**, everywhere: every amount, unit count and percentage
  shows `•••••` while privacy is on (header, lists, charts' tooltips, calculator). Signs and
  gain/loss colours are hidden with them. Replaces the earlier rule "percentages stay"
  (`docs/app-plan.md` §6).
- **D3 Currency in pt-PT order**: `14.250,50 €`, `+85,10 €`, `−1.000,00 €` (no-break space
  before the symbol); other currencies by code after the amount, `412,37 USD`.
- **D4 The chart's "All" range** starts the day before the first row in scope (as Since
  start); the other ranges start at their first chart point. `docs/kpis.md` §4.1, approved.
- **D5 No Fee type; the Fee field is optional.** A filled Fee field is saved
  (`transactions.fees`) and changes the buy's cost, the sell's proceeds, net invested,
  realized gain and the returns; left empty it is saved as 0.
  - Originally (Phase A) the field was hidden for good. **Revised in U3** at the owner's
    request: the drawer's New transaction options are **Dividend, Interest and Fee** (all off
    by default, persisted), and the Fee switch shows the field on Buy and Sell.
  - With the switch off, new Buy and Sell rows are saved with fee 0, the same row an empty
    field produces. Core validation is unchanged (an empty fee is already valid).
  - Edit shows the field when the switch is on or the row already has a non-zero fee (imported
    rows can), so an edit never silently drops a stored fee.
  - There is still no fee transaction type in the form.
- **D6 Dark is the default for new installs only.** A phone with saved settings keeps its
  saved Appearance (no migration); the owner picks Dark in the drawer.
