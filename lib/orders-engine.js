
/* ============================================================
   STB Orders — cloud engine
   Replaces the old Node server. Same rules, same data shape; the
   document now lives in Supabase (row stb_orders_v1) and is saved with
   compare-and-set, exactly like Change Orders (Cobros), so two people
   can work at once without overwriting each other.
   ============================================================ */
(function () {
'use strict';

const SUPABASE_URL = 'https://ttpkyepzzpxctajrhwvx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bnhfaLTxNe2ApJ94myqtIg_uHjo3_B1';
const SUPABASE_TABLE = 'stb_app_state';
const ROW_ID = 'stb_orders_v1';
const BOARD_ROWS = [['stb_board_v1', 'main'], ['stb_board_alice_v1', 'alice']];
const COBROS_ROW = 'stb_change_orders_v1';
const BUCKET = 'stb-project-renders';          // images live under ordenes/
const PDF_BUCKET = 'stb-blueprints';           // PDFs and other documents (the images-only bucket refuses them)
const DEFAULT_KEY = 'STB2026';
const ACCESS_LS = 'stbOrdenesAcceso';

// ============================================================
// STB Orders — Standard catalog
// ============================================================
// The categories South Texas Builders actually buys. Everything else in
// the client portal (paint, shingles, ceilings, cabinets) is picked by
// the client but not ordered by us, so it is not here.
//
// NO PRICES ARE PREFILLED. Every allowance is typed in per house off
// that house's signed contract. Older contracts are lighter on detail
// than the new ones, and the figures in the client portal do not always
// match the contract — so the tool never assumes a number. What each
// category carries is the *shape* of its allowance, not its value.
//
// BUDGET BASES — how a category's allowance is worked out
//   amount   → one dollar figure          (Cabinet hardware, full set)
//   percent  → a share of the contract    (Windows, Plumbing, Electrical)
//   perUnit  → a rate times a count       (Door handles/knobs, each)
//   perItem  → nothing at category level; each line carries its own
//   open     → not defined yet
// A category can ALSO carry lines with their own allowance on top of its
// base — that is how the contract handles plumbing: a percentage for the
// general fixtures, plus toilets and the water heater priced separately.
//
// ITEM BASES
//   category → comes out of the category allowance
//   sqft     → rate per square foot, optionally capped at so many feet
//   unit     → rate times a count
//   amount   → its own dollar figure
//
// TRACKING — how we prove what was spent
//   invoice  → vendor bills us, we upload the invoice (windows, doors)
//   links    → client picks products online, we keep the links
//   sqft     → measured off the plans
//   generic  → anything else
//
// ORDER RANK — the sequence the office buys things in.
// The shower heads are the exception: they live inside Plumbing Fixtures
// (same allowance) but go out as soon as the windows are ordered, which
// is what `triggerAfter` does.
//
// splittable: false marks a category that is always one whole budget —
// windows, cabinet hardware, light fixtures, mirrors. The allowance sheet
// does not even offer to break those down; you put in the one figure and
// everything in the category spends from it.
//
// clientSelects: false marks a category the client never picks — STB buys
// it for itself, so it is a plain reminder to order, never "waiting on
// the client".

const CATEGORIES = [
  {
    id: 'windows',
    name: 'Windows',
    icon: '\u{1FA9F}',
    phase: 2,                 // Framing / Dry-In
    leadDays: 45,
    orderRank: 1,
    budget: { type: 'percent' },
    splittable: false,        // always one whole budget, never broken down
    tracking: 'invoice',
    stores: ['windows-altitude'],
    note: 'Bought from Windows Altitude — upload their invoice to check it against the allowance. On the Saavedra contract this read "Allowance = 1.5% of sales price", with white included and black as an upgrade the client pays for. Confirm the wording on the contract you have.',
    items: [
      { name: 'Windows', type: 'category' }
    ]
  },
  {
    id: 'tile',
    name: 'Tile & Flooring',
    icon: '◻️',
    phase: 4,                 // Exterior / Floors
    leadDays: 21,
    orderRank: 2,
    budget: { type: 'perItem' },
    tracking: 'sqft',
    stores: ['rodriguez-brownsville', 'rodriguez-pharr', 'floor-decor'],
    note: 'Each line carries its own $/sqft rate off the contract. A line can also be capped — the Saavedra contract covered only 50 sqft of backsplash, so anything past that was on the client. Watch this category: the rates in the client portal did not match the signed contract on Saavedra, so take the numbers from the contract. The portal saves tile as showroom photos, so the pictures come from the PDF and the tile name is typed in.',
    items: [
      { name: 'Flooring – Living Area', type: 'sqft' },
      { name: 'Wall Tile – Showers', type: 'sqft' },
      { name: 'Floor Tile – Showers', type: 'sqft' },
      { name: 'Niche Tile – Showers', type: 'sqft' },
      { name: 'Tile Edge Trim', type: 'category' },
      { name: 'Backsplash – Kitchen Only', type: 'sqft' }
    ]
  },
  {
    id: 'frontdoor',
    name: 'Exterior Doors',
    icon: '\u{1F6AA}',
    phase: 5,                 // Interior
    leadDays: 30,
    orderRank: 3,
    budget: { type: 'perItem' },
    tracking: 'invoice',
    stores: ['joshuas-doors'],
    note: "Usually bought from Joshua's Doors — upload their invoice to check it against the allowance. The contract prices the main entrance door and the rear door separately, so each line carries its own allowance. The client brings inspiration (Google, Pinterest) and STB sources or quotes it — metal, wood or fiberglass.",
    items: [
      { name: 'Main Entrance Door', type: 'amount' },
      { name: 'Exterior Rear Door', type: 'amount' }
    ]
  },
  {
    id: 'hardware',
    driverDelivers: true,     // Robert carries it from the garage to the house
    name: 'Cabinet & Countertop Hardware',
    icon: '\u{1F529}',
    phase: 6,                 // Final
    leadDays: 14,
    orderRank: 4,
    budget: { type: 'amount' },
    splittable: false,        // one full set, shared by every line
    tracking: 'links',
    stores: ['amazon', 'lowes', 'homedepot'],
    note: 'The contract prices this as one full set. The client picks it online, so the product links come straight from the selections PDF.',
    items: [
      { name: 'Cabinet Handles / Pulls', type: 'category' },
      { name: 'Cabinet Knobs', type: 'category' },
      { name: 'Countertop Hardware', type: 'category' }
    ]
  },
  {
    id: 'doorhardware',
    driverDelivers: true,     // Robert carries it from the garage to the house
    name: 'Inside Door Hardware',
    icon: '\u{1F510}',
    phase: 6,
    leadDays: 14,
    orderRank: 5,
    budget: { type: 'perItem' },
    tracking: 'links',
    stores: ['amazon', 'lowes', 'homedepot'],
    note: 'Same lines as the Selections tool. The knobs carry the contract price by the piece — put the rate on each knob line; how many comes off the plan. Privacy = bedrooms and bathrooms; passage = closets, pantry, A/C, utility; dummy = double-door closets. Hinges: 3 per swinging interior door (none on pocket or sliding doors). One door stop per swinging door.',
    items: [
      { name: 'Privacy Door Knob', type: 'unit' },
      { name: 'Passage Door Knob', type: 'unit' },
      { name: 'Dummy Door Knob', type: 'unit' },
      { name: 'Main/Front Door Hardware', type: 'category', room: 'Entry' },
      { name: 'Back/Rear Door Hardware', type: 'category', room: 'Porch / Patio' },
      { name: 'Interior Hinges', type: 'category', room: 'Whole house' },
      { name: 'Door Stops', type: 'category', room: 'Whole house' }
    ]
  },
  {
    id: 'stone',
    name: 'Exterior Stone',
    icon: '\u{1F9F1}',
    phase: 4,
    leadDays: 21,
    orderRank: 6,
    budget: { type: 'perItem' },
    tracking: 'sqft',
    stores: ['southern-donna', 'southern-sanbenito'],
    note: 'Priced per square foot of material, as shown on the blueprint. Capture the sqft off the plans so the budget can be worked out. The stone type comes from the selections PDF.',
    items: [
      { name: 'Exterior Stone', type: 'sqft' }
    ]
  },
  {
    id: 'garage',
    name: 'Garage Door',
    icon: '\u{1F697}',
    phase: 4,
    leadDays: 30,
    orderRank: 7,
    budget: { type: 'open' },
    splittable: false,
    tracking: 'generic',
    stores: ['joshuas-doors'],
    note: 'Not every house has one, and a house without a garage will not have this line in its contract. If this house has no garage door, mark the category as "Does not apply".',
    items: [
      { name: 'Garage Door', type: 'category' }
    ]
  },
  {
    id: 'plumbing',
    driverDelivers: true,     // Robert carries it from the garage to the house
    name: 'Plumbing Fixtures',
    icon: '\u{1F6BF}',
    phase: 6,
    leadDays: 21,
    orderRank: 8,
    budget: { type: 'percent' },
    tracking: 'links',
    stores: ['central-showrooms', 'amazon', 'lowes', 'homedepot'],
    note: 'The contract splits this one up: a percentage of the contract price covers the general fixtures (sinks, faucets, shower kits, pot fillers, disposal, valves), while the toilets are priced by the piece and the water heater gets its own figure. Those two lines carry their own allowance on top of the percentage. Central Showrooms in Pharr is the first-choice vendor — ask for Ana or Silvia, reference South Texas Builders 1, LLC. The shower heads go out as soon as the windows are ordered.',
    items: [
      { name: 'Shower Kits / Shower Heads', type: 'category', triggerAfter: 'windows' },
      { name: 'Vanity Sink Faucets', type: 'category' },
      { name: 'Bath Accessories', type: 'category' },
      { name: 'Toilets', type: 'unit' },
      { name: 'Water Heater', type: 'amount' },
      { name: 'Shower Drain', type: 'category' },
      { name: 'Kitchen Sink Faucet', type: 'category' },
      { name: 'Garbage Disposal', type: 'category' },
      { name: 'Pot Filler', type: 'category' },
      { name: 'Kitchen Sink', type: 'category' },
      { name: 'Kitchen Sink Drain', type: 'category' },
      { name: 'Vanity Sink', type: 'category' },
      { name: 'Vanity Sink Drain', type: 'category' }
    ]
  },
  {
    id: 'lighting',
    driverDelivers: true,     // Robert carries it from the garage to the house
    name: 'Light Fixtures',
    icon: '\u{1F4A1}',
    phase: 6,
    leadDays: 21,
    orderRank: 9,
    budget: { type: 'percent' },
    splittable: false,        // one budget for the whole category; add it all up at the end
    tracking: 'links',
    stores: ['central-showrooms', 'amazon', 'lowes', 'homedepot'],
    note: 'The contract prices the electrical fixtures as a percentage of the contract price, covering bulbs, doorbell, flood lights, smoke/CO detectors, fan down rods and the electric fireplace. Central Showrooms in Pharr is the first-choice vendor.',
    items: [
      { name: 'Interior Ceiling Fans', type: 'category', room: 'Bedrooms' },
      { name: 'Living Room Ceiling Fan', type: 'category', room: 'Living room' },
      { name: 'Exterior Ceiling Fans', type: 'category', room: 'Porch / Patio' },
      { name: 'Vanity Light Fixtures', type: 'category', room: 'Bathrooms' },
      { name: 'Exterior Decorative Lights', type: 'category', room: 'Exterior' },
      { name: 'Dining Room Chandelier', type: 'category', room: 'Dining' },
      { name: 'Kitchen Island Pendant Lights', type: 'category', room: 'Kitchen' },
      { name: 'Foyer Light Fixture', type: 'category', room: 'Entry' },
      { name: 'Additional Light Fixtures', type: 'category' },
      { name: 'Fireplace', type: 'category', room: 'Living room' },
      { name: 'Bulbs', type: 'category', room: 'Whole house' }
    ]
  },
  {
    id: 'mirrors',
    driverDelivers: true,     // Robert carries it from the garage to the house
    name: 'Mirrors',
    icon: '\u{1FA9E}',
    phase: 6,
    leadDays: 14,
    orderRank: 10,
    budget: { type: 'amount' },
    splittable: false,
    tracking: 'links',
    stores: ['amazon', 'lowes', 'homedepot'],
    note: 'The contract gives the mirrors one figure for the whole house. Confirm where this belongs in the buying order.',
    // One line per mirror, so Robert knows which box goes to which bathroom
    items: [
      { name: 'Master Bath Mirror', type: 'category', room: 'Master bath' },
      { name: 'Second Bath Mirror', type: 'category', room: 'Bath 2' },
      { name: 'Third Bath Mirror', type: 'category', room: 'Bath 3' },
      { name: 'Half Bath Mirror', type: 'category', room: 'Half bath' }
    ]
  }
];

// ── Stores ───────────────────────────────────────────────────
// From the "STB - Store Selections Guide" the client receives, plus the
// two local vendors the office buys from directly. `categories` drives
// which stores are suggested where; a store with an empty list still
// shows up in the store directory.
const STORES = [
  {
    id: 'windows-altitude', name: 'Windows Altitude', categories: ['windows'],
    local: true, firstOption: true, guideCategory: 'Windows',
    notes: 'Vendor STB buys windows from. They invoice us directly.'
  },
  {
    id: 'joshuas-doors', name: "Joshua's Doors", categories: ['frontdoor', 'garage'],
    local: true, firstOption: true, guideCategory: 'Doors',
    notes: 'Vendor STB buys exterior doors from. They invoice us directly.'
  },
  {
    id: 'rodriguez-brownsville', name: 'Rodriguez Tile — Brownsville', categories: ['tile'],
    guideCategory: 'Tile', address: '3913 N Expressway, Brownsville, TX 78521',
    contact: 'Zully (personal tour) — +1 (936) 668-9775'
  },
  {
    id: 'rodriguez-pharr', name: 'Rodriguez Tile — Pharr', categories: ['tile'],
    guideCategory: 'Tile', address: '1120 E Expressway 83, Pharr, TX 78577',
    contact: 'Melecio (personal tour) — (956) 278-1586'
  },
  {
    id: 'floor-decor', name: 'Floor & Decor', categories: ['tile'], guideCategory: 'Tile'
  },
  {
    id: 'southern-donna', name: 'Southern Stone and Soil — Donna', categories: ['stone'],
    guideCategory: 'Exterior Stone', address: '3004 E Expressway 83, Donna, TX 78537'
  },
  {
    id: 'southern-sanbenito', name: 'Southern Stone and Soil — San Benito', categories: ['stone'],
    guideCategory: 'Exterior Stone', address: '2734 E Expressway 83, San Benito, TX 78586'
  },
  {
    id: 'central-showrooms', name: 'Central Showrooms — Pharr', categories: ['plumbing', 'lighting'],
    firstOption: true, guideCategory: 'Plumbing & Light Fixtures',
    address: '706 W Ferguson Ave, Pharr, TX 78577',
    contact: 'Ana & Silvia — reference South Texas Builders 1, LLC',
    notes: 'First-choice vendor for both plumbing and light fixtures.'
  },
  {
    id: 'amazon', name: 'Amazon',
    categories: ['hardware', 'doorhardware', 'plumbing', 'lighting', 'mirrors'],
    guideCategory: 'Online'
  },
  {
    id: 'lowes', name: "Lowe's",
    categories: ['hardware', 'doorhardware', 'plumbing', 'lighting', 'mirrors'],
    guideCategory: 'Online / Store'
  },
  {
    id: 'homedepot', name: 'The Home Depot',
    categories: ['hardware', 'doorhardware', 'plumbing', 'lighting', 'mirrors'],
    guideCategory: 'Online / Store'
  },
  {
    id: 'tajams-harlingen', name: 'Tajams Marble & Granite — Harlingen', categories: [],
    guideCategory: 'Granite / Countertops', address: '6701 W Expressway 83, Harlingen, TX 78552',
    notes: 'In the client store guide for countertops. STB does not order countertops through this tool.'
  },
  {
    id: 'tajams-palmview', name: 'Tajams Marble & Granite — Palmview', categories: [],
    guideCategory: 'Granite / Countertops', address: '1273 W Palma Vista Dr, Palmview, TX 78572',
    notes: 'In the client store guide for countertops. STB does not order countertops through this tool.'
  },
  {
    id: 'sherwin-williams', name: 'Sherwin-Williams', categories: [], guideCategory: 'Paint',
    notes: 'Paint selections are only accepted from Sherwin-Williams. STB does not order paint through this tool.'
  }
];

// Construction phases — same list as the weekly progress reports
const PHASES = [
  'Pre-Construction',
  'Foundation',
  'Framing / Dry-In',
  'Rough Trades',
  'Exterior / Floors',
  'Interior',
  'Final'
];

const STATUSES = [
  { id: 'awaiting-selection', name: 'Waiting on client selection', color: 'gray' },
  { id: 'ready',              name: 'Ready to order',              color: 'amber' },
  { id: 'ordered',            name: 'Ordered',                     color: 'blue' },
  { id: 'in-transit',         name: 'In transit',                  color: 'blue' },
  { id: 'received',           name: 'Received',                    color: 'green' },
  { id: 'installed',          name: 'Installed',                   color: 'green' },
  { id: 'not-applicable',     name: 'Does not apply',              color: 'gray' }
];

// Lines renamed to match the Selections tool (3 Oct 2026). Houses made
// before are moved over when the server starts.
const RENAMED = {
  doorhardware: { 'Interior Door Handles / Knobs': 'Privacy Door Knob' },
  mirrors: { 'Mirrors': 'Master Bath Mirror' }
};
// ============================================================
// STB Orders — Budget math and the alert engine
// ============================================================
// All the thinking lives here: what the allowance is, what we have
// actually spent, and what the office needs to be told about.



const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Today's date in local time, not UTC — otherwise after 6pm in Texas
// the tool thinks it is already tomorrow.
function today() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

// ── Spend ────────────────────────────────────────────────────
// A purchase is captured as one total, because the allowance already
// counts tax and shipping — there is nothing to break out. Entries made
// before that change stored subtotal + tax + shipping, so those still add up.
function purchaseTotal(p) {
  if (p.total !== undefined && p.total !== null && p.total !== '') return round2(p.total);
  return round2((Number(p.subtotal) || 0) + (Number(p.tax) || 0) + (Number(p.shipping) || 0));
}

function itemSpend(item) {
  return round2((item.purchases || []).reduce((s, p) => s + purchaseTotal(p), 0));
}

function categorySpend(cat) {
  return round2((cat.items || []).reduce((s, i) => s + itemSpend(i), 0));
}

// ── Allowance ────────────────────────────────────────────────
// The Exhibit A allowance schedule uses several different bases, so the
// tool has to as well:
//   amount   a flat figure            (Main Entrance Door — $2,500)
//   percent  a share of the contract  (Windows — 1.5% of the sales price)
//   perUnit  a rate times a count     (Door handles — $22 each)
//   perItem  each line has its own    (tile and stone, by the sq ft)
//   open     nothing captured yet
// A sq ft line can also carry a cap: the backsplash allowance covers
// 50 sq ft, so anything past that is on the client no matter what.
function itemAllowance(item) {
  const rate = Number(item.rate) || 0;

  if (item.type === 'sqft') {
    const cap = Number(item.cap) || 0;
    const sqft = Number(item.sqft) || 0;
    if (!rate) return null;
    if (cap) return round2(Math.min(sqft || cap, cap) * rate);
    if (!sqft) return null;               // not measured off the plans yet
    return round2(sqft * rate);
  }
  if (item.type === 'unit') {
    const qty = Number(item.qty) || 0;
    if (!rate || !qty) return null;
    return round2(rate * qty);
  }
  if (item.type === 'amount') return Number(item.amount) > 0 ? round2(item.amount) : null;
  return null;                            // 'category'
}

// What the category itself is worth, before any separately priced lines
function categoryBase(cat, contractPrice) {
  const budget = cat.budget || {};

  if (budget.type === 'amount') {
    const a = Number(budget.amount);
    return a > 0 ? round2(a) : null;
  }
  if (budget.type === 'percent') {
    const pct = Number(budget.percent);
    const price = Number(contractPrice);
    if (!pct || !price) return null;      // needs the contract price on the house
    return round2(price * pct / 100);
  }
  if (budget.type === 'perUnit') {
    const rate = Number(budget.rate), qty = Number(budget.qty);
    if (!rate || !qty) return null;
    return round2(rate * qty);
  }
  return null;                            // 'perItem' and 'open' carry no base
}

// A category's allowance is its own base PLUS any line that the contract
// prices separately. That is how plumbing reads: a percentage for the
// general fixtures, with the toilets and the water heater on top.
function categoryAllowance(cat, contractPrice) {
  const base = categoryBase(cat, contractPrice);
  let extras = 0, anyExtra = false;

  (cat.items || []).forEach(i => {
    const a = itemAllowance(i);
    if (a !== null) { extras += a; anyExtra = true; }
  });

  if (base === null && !anyExtra) return null;
  return round2((base || 0) + extras);
}

// ── Category summary ─────────────────────────────────────────
function categorySummary(cat, warnPct, contractPrice) {
  const allowance = categoryAllowance(cat, contractPrice);
  const spent = categorySpend(cat);
  const remaining = allowance === null ? null : round2(allowance - spent);
  const pct = allowance ? Math.round((spent / allowance) * 100) : null;

  let state = 'no-budget';
  if (cat.notApplicable) state = 'not-applicable';
  else if (allowance !== null) {
    if (spent > allowance) state = 'over';
    else if (pct >= (warnPct || 80)) state = 'close';
    else state = 'ok';
  }

  return {
    allowance, spent, remaining, pct, state,
    over: state === 'over' ? round2(spent - allowance) : 0
  };
}

// ── How urgent is this, given where the house is ──────────────
function urgencyByPhase(housePhase, categoryPhase) {
  if (!Number.isInteger(housePhase)) return 'normal';
  const away = categoryPhase - housePhase;
  if (away <= 0) return 'critical';   // the house is already at (or past) that phase
  if (away === 1) return 'urgent';    // next phase up
  if (away === 2) return 'soon';
  return 'normal';
}

const WEIGHT = { critical: 3, urgent: 2, soon: 1, normal: 0 };
const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Alert engine ─────────────────────────────────────────────
// Which categories have already been put on order for this house.
// Used by items that wait on another category — the shower heads go out
// as soon as the windows are ordered, even though the rest of the
// plumbing fixtures (same allowance) are bought much later.
function orderedCategories(project) {
  const done = new Set();
  (project.categories || []).forEach(cat => {
    const moving = (cat.items || []).some(i =>
      ['ordered', 'in-transit', 'received', 'installed'].includes(i.status));
    if (moving) done.add(cat.id);
  });
  return done;
}

function projectAlerts(project, config) {
  const warnPct = (config && config.warnPercent) || 80;
  const alerts = [];
  const housePhase = Number.isInteger(project.phase) ? project.phase : null;
  const ordered = orderedCategories(project);
  const price = project.contractPrice;

  (project.categories || []).forEach(cat => {
    if (cat.notApplicable) return;

    const base = CATEGORIES.find(c => c.id === cat.id) || {};
    const catPhase = Number.isInteger(cat.phase) ? cat.phase : base.phase;
    const urgency = urgencyByPhase(housePhase, catPhase);
    const sum = categorySummary(cat, warnPct, price);
    const phaseName = PHASES[catPhase] || ('Phase ' + catPhase);

    const items = cat.items || [];
    const baseItems = base.items || [];
    const waitsOnOf = i => i.triggerAfter || (baseItems.find(b => b.name === i.name) || {}).triggerAfter;

    // Items that wait on another category being ordered get their own alert
    // below, so they are kept out of the ordinary lists to avoid saying the
    // same thing twice.
    const triggered = items.filter(i => {
      const on = waitsOnOf(i);
      return on && ordered.has(on) &&
             ['awaiting-selection', 'ready'].includes(i.status) && !i.notApplicable;
    });
    const isTriggered = i => triggered.includes(i);

    // Some categories are never picked by the client — STB buys them for
    // itself (the security cameras watch the site). There is nothing to wait
    // for there, so anything not ordered simply counts as ready to order.
    const clientPicks = base.clientSelects !== false;

    const waiting = clientPicks
      ? items.filter(i => i.status === 'awaiting-selection' && !i.notApplicable && !isTriggered(i))
      : [];
    const ready = items.filter(i =>
      (i.status === 'ready' || (!clientPicks && i.status === 'awaiting-selection')) &&
      !i.notApplicable && !isTriggered(i));
    const moving = items.filter(i => ['ordered', 'in-transit'].includes(i.status) && !i.notApplicable);

    // 1. Client has not picked yet — nothing can be ordered
    if (waiting.length) {
      alerts.push({
        type: 'selection',
        level: urgency === 'normal' ? 'soon' : urgency,
        category: cat.id,
        categoryName: base.name || cat.id,
        title: 'Waiting on the client',
        detail: waiting.length + ' of ' + items.length + ' items still have no selection. Needed at ' + phaseName + '.',
        items: waiting.map(i => i.name)
      });
    }

    // 2. Picked but not ordered
    if (ready.length) {
      alerts.push({
        type: 'order',
        level: urgency === 'normal' ? 'soon' : urgency,
        category: cat.id,
        categoryName: base.name || cat.id,
        title: !clientPicks ? 'Reminder — we order this ourselves'
             : urgency === 'critical' ? 'Order this NOW' : 'Still to order',
        detail: ready.length + ' item(s) ready to order. Installed at ' + phaseName +
                '. Lead time about ' + (base.leadDays || 21) + ' days.' +
                (clientPicks ? '' : ' The client does not pick these — STB buys them.'),
        items: ready.map(i => i.name)
      });
    }

    // 3. Items whose turn came because another category was ordered
    if (triggered.length) {
      const trigger = CATEGORIES.find(c => c.id === waitsOnOf(triggered[0])) ||
                      { name: waitsOnOf(triggered[0]) };
      const stillWaiting = triggered.filter(i => i.status === 'awaiting-selection');
      alerts.push({
        type: 'order',
        level: 'critical',
        category: cat.id,
        categoryName: base.name || cat.id,
        title: 'The ' + trigger.name.toLowerCase() + ' are ordered — these go next',
        detail: 'These are bought right after the ' + trigger.name.toLowerCase() +
                ', and they still come out of the same ' + (base.name || cat.id) + ' allowance.' +
                (stillWaiting.length ? ' ' + stillWaiting.length + ' of them still need the client to pick.' : ''),
        items: triggered.map(i => i.name + (i.status === 'awaiting-selection' ? ' (no selection yet)' : ''))
      });
    }

    // 4. Ordered but past its ETA
    const late = moving.filter(i => i.etaDate && i.etaDate < today());
    if (late.length) {
      alerts.push({
        type: 'delivery',
        level: 'critical',
        category: cat.id,
        categoryName: base.name || cat.id,
        title: 'Delivery is late',
        detail: late.length + ' order(s) went past their estimated arrival.',
        items: late.map(i => i.name + (i.etaDate ? ' (expected ' + i.etaDate + ')' : ''))
      });
    }

    // 4. Budget
    if (sum.state === 'over') {
      alerts.push({
        type: 'budget',
        level: 'critical',
        category: cat.id,
        categoryName: base.name || cat.id,
        title: 'Over the allowance',
        detail: 'Allowance ' + money(sum.allowance) + ' · spent ' + money(sum.spent) +
                ' · over by ' + money(sum.over) + '. Needs a change order.',
        over: sum.over
      });
    } else if (sum.state === 'close') {
      alerts.push({
        type: 'budget',
        level: 'urgent',
        category: cat.id,
        categoryName: base.name || cat.id,
        title: 'Close to the allowance limit',
        detail: 'At ' + sum.pct + '% of the allowance. ' + money(sum.remaining) + ' left.'
      });
    }

    // 5. Money going out with no allowance on file
    if (sum.allowance === null && sum.spent > 0) {
      alerts.push({
        type: 'budget',
        level: 'soon',
        category: cat.id,
        categoryName: base.name || cat.id,
        title: 'No allowance on file',
        detail: money(sum.spent) + ' already spent and this category has no allowance captured, ' +
                'so there is no way to tell if it is over or under.'
      });
    }
  });

  alerts.sort((a, b) => (WEIGHT[b.level] || 0) - (WEIGHT[a.level] || 0));
  return alerts;
}

// ── Whole-project summary for the dashboard ──────────────────
function projectSummary(project, config) {
  const warnPct = (config && config.warnPercent) || 80;
  let allowanceTotal = 0, spentTotal = 0, overTotal = 0;
  let itemsTotal = 0, pending = 0, received = 0, awaitingSelection = 0;

  (project.categories || []).forEach(cat => {
    if (cat.notApplicable) return;
    const base = CATEGORIES.find(c => c.id === cat.id) || {};
    const clientPicks = base.clientSelects !== false;
    const s = categorySummary(cat, warnPct, project.contractPrice);
    if (s.allowance !== null) allowanceTotal += s.allowance;
    spentTotal += s.spent;
    overTotal += s.over;
    (cat.items || []).forEach(i => {
      if (i.notApplicable || i.status === 'not-applicable') return;
      itemsTotal++;
      // Nothing is "waiting on the client" in a category STB buys for itself
      if (i.status === 'awaiting-selection') { if (clientPicks) awaitingSelection++; pending++; }
      else if (i.status === 'ready') pending++;
      else if (['received', 'installed'].includes(i.status)) received++;
    });
  });

  const alerts = projectAlerts(project, config);
  return {
    allowanceTotal: round2(allowanceTotal),
    spentTotal: round2(spentTotal),
    overTotal: round2(overTotal),
    remainingTotal: round2(allowanceTotal - spentTotal),
    itemsTotal, pending, received, awaitingSelection,
    alerts,
    critical: alerts.filter(a => a.level === 'critical').length,
    urgent: alerts.filter(a => a.level === 'urgent').length
  };
}
// Normalize for comparison: odd dashes, spacing, case
function norm(s) {
  return String(s)
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// PDF label → our category and item. item:null means "keep it as a category note".
const MAP = {
  'WINDOW STYLE':                 { cat: 'windows',      item: 'Windows' },
  'WINDOW COLOR':                 { cat: 'windows',      item: 'Windows' },
  'WINDOW GRIDS':                 { cat: 'windows',      item: 'Windows' },
  'WINDOW VENDOR':                { cat: 'windows',      item: 'Windows' },

  'EXTERIOR STONE':               { cat: 'stone',        item: 'Exterior Stone' },
  'STONE TYPE':                   { cat: 'stone',        item: 'Exterior Stone' },

  'GARAGE DOOR':                  { cat: 'garage',       item: 'Garage Door' },

  'FLOORING - LIVING AREA':       { cat: 'tile',         item: 'Flooring – Living Area' },
  'WALL TILE - SHOWERS':          { cat: 'tile',         item: 'Wall Tile – Showers' },
  'FLOOR TILE - SHOWERS':         { cat: 'tile',         item: 'Floor Tile – Showers' },
  'NICHE TILE - SHOWERS':         { cat: 'tile',         item: 'Niche Tile – Showers' },
  'TILE EDGE TRIM':               { cat: 'tile',         item: 'Tile Edge Trim' },
  'BACKSPLASH - KITCHEN ONLY':    { cat: 'tile',         item: 'Backsplash – Kitchen Only' },
  'SHOWER TILE (PREVIOUS FORMAT)':{ cat: 'tile',         item: null },
  'SHOWER FLOOR FINISH':          { cat: 'tile',         item: null },

  'BORE TYPE':                    { cat: 'frontdoor',    item: 'Main Entrance Door' },
  'GLASS TYPE':                   { cat: 'frontdoor',    item: 'Main Entrance Door' },
  'HINGE / THRESHOLD':            { cat: 'frontdoor',    item: 'Main Entrance Door' },
  'FRONT DOOR STYLE':             { cat: 'frontdoor',    item: 'Main Entrance Door' },
  'DOOR TYPE':                    { cat: 'frontdoor',    item: 'Main Entrance Door' },
  'REAR / PATIO DOOR':            { cat: 'frontdoor',    item: 'Exterior Rear Door' },

  'CABINET HARDWARE':             { cat: 'hardware',     item: 'Cabinet Handles / Pulls' },
  'CABINET DIRECTION':            { cat: 'hardware',     item: 'Cabinet Handles / Pulls' },
  'CABINET PULLS':                { cat: 'hardware',     item: 'Cabinet Handles / Pulls' },
  'CABINET KNOBS':                { cat: 'hardware',     item: 'Cabinet Knobs' },
  'COUNTERTOP HARDWARE':          { cat: 'hardware',     item: 'Countertop Hardware' },

  // older packages had one knob section; the Selections tool splits it by type
  'DOOR HANDLES / KNOBS': { cat: 'doorhardware', item: 'Privacy Door Knob' },
  'DOOR HANDLES': { cat: 'doorhardware', item: 'Privacy Door Knob' },
  'DOOR KNOBS': { cat: 'doorhardware', item: 'Privacy Door Knob' },
  'INTERIOR DOOR HARDWARE': { cat: 'doorhardware', item: 'Privacy Door Knob' },
  'PRIVACY DOOR KNOB': { cat: 'doorhardware', item: 'Privacy Door Knob' },
  'PRIVACY DOOR KNOB LINK': { cat: 'doorhardware', item: 'Privacy Door Knob' },
  'PRIVACY DOOR KNOB NOTES': { cat: 'doorhardware', item: 'Privacy Door Knob' },
  'PASSAGE DOOR KNOB': { cat: 'doorhardware', item: 'Passage Door Knob' },
  'PASSAGE DOOR KNOB LINK': { cat: 'doorhardware', item: 'Passage Door Knob' },
  'PASSAGE DOOR KNOB NOTES': { cat: 'doorhardware', item: 'Passage Door Knob' },
  'DUMMY DOOR KNOB': { cat: 'doorhardware', item: 'Dummy Door Knob' },
  'DUMMY DOOR KNOB LINK': { cat: 'doorhardware', item: 'Dummy Door Knob' },
  'DUMMY DOOR KNOB NOTES': { cat: 'doorhardware', item: 'Dummy Door Knob' },
  'MAIN/FRONT DOOR HARDWARE': { cat: 'doorhardware', item: 'Main/Front Door Hardware' },
  'MAIN/FRONT DOOR HARDWARE LINK': { cat: 'doorhardware', item: 'Main/Front Door Hardware' },
  'MAIN/FRONT DOOR HARDWARE NOTES': { cat: 'doorhardware', item: 'Main/Front Door Hardware' },
  'BACK/REAR DOOR HARDWARE (IF APPLICABLE)': { cat: 'doorhardware', item: 'Back/Rear Door Hardware' },
  'BACK/REAR DOOR HARDWARE (IF APPLICABLE) LINK': { cat: 'doorhardware', item: 'Back/Rear Door Hardware' },
  'BACK/REAR DOOR HARDWARE (IF APPLICABLE) NOTES': { cat: 'doorhardware', item: 'Back/Rear Door Hardware' },
  'BACK/REAR DOOR HARDWARE': { cat: 'doorhardware', item: 'Back/Rear Door Hardware' },
  'BACK/REAR DOOR HARDWARE LINK': { cat: 'doorhardware', item: 'Back/Rear Door Hardware' },
  'BACK/REAR DOOR HARDWARE NOTES': { cat: 'doorhardware', item: 'Back/Rear Door Hardware' },
  'INTERIOR HINGE COLOR': { cat: 'doorhardware', item: 'Interior Hinges' },
  'INTERIOR HINGE FINISH': { cat: 'doorhardware', item: 'Interior Hinges' },
  'DOOR STOPS': { cat: 'doorhardware', item: 'Door Stops' },
  'DOOR STOPPER COLOR': { cat: 'doorhardware', item: 'Door Stops' },
  'DOOR STOPPER COLOR (ALL INTERIOR DOORS)': { cat: 'doorhardware', item: 'Door Stops' },
  'DOOR STOPPER COLOR (ALL INTERIOR DOORS):': { cat: 'doorhardware', item: 'Door Stops' },

  'WATER HEATER':                 { cat: 'plumbing',     item: 'Water Heater' },
  'SHOWER KITS':                  { cat: 'plumbing',     item: 'Shower Kits / Shower Heads' },
  'SHOWER HEADS':                 { cat: 'plumbing',     item: 'Shower Kits / Shower Heads' },
  'VANITY SINK FAUCETS':          { cat: 'plumbing',     item: 'Vanity Sink Faucets' },
  'BATH ACCESSORIES':             { cat: 'plumbing',     item: 'Bath Accessories' },
  'TOILETS':                      { cat: 'plumbing',     item: 'Toilets' },
  'SHOWER DRAIN':                 { cat: 'plumbing',     item: 'Shower Drain' },
  'KITCHEN SINK FAUCET':          { cat: 'plumbing',     item: 'Kitchen Sink Faucet' },
  'GARBAGE DISPOSAL':             { cat: 'plumbing',     item: 'Garbage Disposal' },
  'POT FILLER':                   { cat: 'plumbing',     item: 'Pot Filler' },
  'KITCHEN SINK':                 { cat: 'plumbing',     item: 'Kitchen Sink' },
  'KITCHEN SINK DRAIN':           { cat: 'plumbing',     item: 'Kitchen Sink Drain' },
  'VANITY SINK':                  { cat: 'plumbing',     item: 'Vanity Sink' },
  'VANITY SINK DRAIN':            { cat: 'plumbing',     item: 'Vanity Sink Drain' },
  'EXTRA ITEMS / NOTES':          { cat: 'plumbing',     item: null },

  'BULB COLOR TEMPERATURE':       { cat: 'lighting',     item: 'Bulbs' },
  'INTERIOR CEILING FANS':        { cat: 'lighting',     item: 'Interior Ceiling Fans' },
  'LIVING ROOM CEILING FAN':      { cat: 'lighting',     item: 'Living Room Ceiling Fan' },
  'VANITY LIGHT FIXTURES':        { cat: 'lighting',     item: 'Vanity Light Fixtures' },
  'EXTERIOR DECORATIVE LIGHTS':   { cat: 'lighting',     item: 'Exterior Decorative Lights' },
  'DINING ROOM CHANDELIER':       { cat: 'lighting',     item: 'Dining Room Chandelier' },

  'EXTERIOR DECORATIVE LIGHT FIXTURES': { cat: 'lighting', item: 'Exterior Decorative Lights' },
  'EXTERIOR FANS': { cat: 'lighting', item: 'Exterior Ceiling Fans' },
  'EXTERIOR CEILING FANS': { cat: 'lighting', item: 'Exterior Ceiling Fans' },
  'VANITY LIGHT FIXTURES FOR BATHROOMS': { cat: 'lighting', item: 'Vanity Light Fixtures' },
  'PENDANT LIGHT FIXTURES ABOVE KITCHEN ISLAND': { cat: 'lighting', item: 'Kitchen Island Pendant Lights' },
  'PENDANT LIGHTS': { cat: 'lighting', item: 'Kitchen Island Pendant Lights' },
  'FOYER LIGHT FIXTURES': { cat: 'lighting', item: 'Foyer Light Fixture' },
  'FOYER LIGHT FIXTURE': { cat: 'lighting', item: 'Foyer Light Fixture' },
  'ADDITIONAL LIGHT FIXTURES': { cat: 'lighting', item: 'Additional Light Fixtures' },
  'ADDITIONAL LIGHT FIXTURES IF ANY': { cat: 'lighting', item: 'Additional Light Fixtures' },
  'ADDITIONAL LIGHT FIXTURES (IF ANY)': { cat: 'lighting', item: 'Additional Light Fixtures' },
  'FIREPLACE': { cat: 'lighting', item: 'Fireplace' },
  'FIREPLACE IF ANY': { cat: 'lighting', item: 'Fireplace' },
  'FIREPLACE (IF ANY)': { cat: 'lighting', item: 'Fireplace' },
  // names exactly as the Selections tool's report prints them (checked 3 Oct 2026)
  'KITCHEN ISLAND PENDANTS': { cat: 'lighting', item: 'Kitchen Island Pendant Lights' },
  'FOYER LIGHTS': { cat: 'lighting', item: 'Foyer Light Fixture' },
  'ADDITIONAL LIGHTS': { cat: 'lighting', item: 'Additional Light Fixtures' },
  'OVERALL LIGHTING NOTES': { cat: 'lighting', item: null },
  'OVERALL PLUMBING NOTES': { cat: 'plumbing', item: null },
  'MIRROR NOTES': { cat: 'mirrors', item: null },
  'WINDOWS VENDOR': { cat: 'windows', item: 'Windows' },
  'FRONT DOOR DESCRIPTION': { cat: 'frontdoor', item: 'Main Entrance Door' },

  'MIRRORS': { cat: 'mirrors', item: 'Master Bath Mirror' },
  'BATHROOM MIRRORS': { cat: 'mirrors', item: 'Master Bath Mirror' },
  'MASTER BATH MIRROR': { cat: 'mirrors', item: 'Master Bath Mirror' },
  'SECOND BATH MIRROR': { cat: 'mirrors', item: 'Second Bath Mirror' },
  'THIRD BATH MIRROR': { cat: 'mirrors', item: 'Third Bath Mirror' },
  'HALF RESTROOM MIRROR': { cat: 'mirrors', item: 'Half Bath Mirror' },
  'HALF BATH MIRROR': { cat: 'mirrors', item: 'Half Bath Mirror' }
};

const HEADER = ['CLIENT', 'PROJECT', 'ADDRESS', 'SQUARE FOOTAGE', 'SELECTIONS CAPTURED', 'STATUS'];

// Page footer the portal stamps on every sheet
// (some PDF readers put a space before the page count: ".../package/abc 5/14")
const FOOTER_URL = /^https?:\/\/\S+\/package\/\S+(\s+\d+\/\d+)?$/i;

function isJunk(line) {
  const l = line.trim();
  if (!l) return true;
  if (/STB Client Portal/i.test(l)) return true;
  if (/^Doc ID:/i.test(l)) return true;          // stamped under every page footer
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4},/.test(l)) return true;
  if (/^Scan (for|the)/i.test(l)) return true;
  if (/^Field reference only/i.test(l)) return true;
  if (/^Confirm final products/i.test(l)) return true;
  if (/^selections team\.$/i.test(l)) return true;
  if (/^No client selections fall under/i.test(l)) return true;
  return false;
}

// Section titles. A label's value stops here, otherwise it would drag
// in the heading of whatever comes next.
const SECTIONS = [
  'SITE, FOUNDATION & PERMITS', 'FRAMING, ROOFING & WINDOWS', 'ROOF SHINGLES',
  'ROOFING - METAL', 'ROOF FRAMING - CEILING DESIGN', 'WINDOWS VENDOR',
  'EXTERIOR PAINT & MEP ROUGH-IN', 'EXTERIOR PAINTING',
  'EXTERIOR MATERIALS, FLOORING & TILE', 'EXTERIOR MATERIALS', 'FLOORING & TILE',
  'CABINETS, TRIM, PAINT, COUNTERTOPS & DOORS', 'CABINETS & VANITIES',
  'TRIM, DOORS & SHELVING', 'INTERIOR PAINT / STAIN', 'COUNTER TOPS', 'FRONT DOORS',
  'FINALS - FIXTURES, HARDWARE & CLEAN-UP', 'PLUMBING FINAL / FIXTURES',
  'ELECTRICAL FINAL / FIXTURES', 'HARDWARE / MIRRORS'
];

function isBreak(l) {
  const t = norm(l);
  if (/^PHASE \d/.test(t)) return true;
  if (/^PRE & PHASE/.test(t)) return true;
  return SECTIONS.includes(t);
}

// A LABEL is a short all-caps line. At least 3 letters, so a chopped
// piece of a link (like "B/315413218") is not mistaken for one.
function looksLikeLabel(l) {
  const t = l.trim();
  if (!t || t.length > 60) return false;
  if (/[a-z]/.test(t)) return false;
  return (t.match(/[A-Z]/g) || []).length >= 3;
}

// The PDF wraps long links across two lines. Glue them back together.
// Clients sometimes paste a link with its start cut off ("owes.com/pd/…")
const STORE_FIX = { owes: 'lowes', lowes: 'lowes', omedepot: 'homedepot', medepot: 'homedepot',
  homedepot: 'homedepot', mazon: 'amazon', amazon: 'amazon', ayfair: 'wayfair', wayfair: 'wayfair' };
function fixCutLink(v) {
  const m = String(v).match(/^(?:www\.)?([a-z]+)\.com\/(\S+)$/i);
  const store = m && STORE_FIX[m[1].toLowerCase()];
  return store ? 'https://www.' + store + '.com/' + m[2] : v;
}

function joinLinks(values) {
  const out = [];
  values.map(fixCutLink).forEach(v => {
    const prev = out[out.length - 1];
    const isContinuation = prev && /^https?:\/\//i.test(prev) &&
                           !/\s/.test(v) && !/^https?:\/\//i.test(v);
    if (isContinuation) out[out.length - 1] = prev + v;
    else out.push(v);
  });
  return out;
}

// Split the raw text into one chunk per printed page
function splitPages(text) {
  const pages = [];
  let current = [];
  text.split('\n').forEach(raw => {
    const line = raw.trim();
    if (FOOTER_URL.test(line)) { pages.push(current); current = []; return; }
    if (!isJunk(line)) current.push(line);
  });
  if (current.length) pages.push(current);
  return pages;
}

function parseText(text) {
  const pages = splitPages(text);
  const info = {};
  const selections = {};        // { catId: { items: {name: {text, links[]}}, notes: [] } }
  const notApplicable = [];
  const categoryPages = {};     // { catId: [page numbers] }

  function store(catId, itemName, label, values, pageNo) {
    const links = values.filter(v => /^https?:\/\//i.test(v));
    const texts = values.filter(v => !/^https?:\/\//i.test(v));
    const cat = selections[catId] || (selections[catId] = { items: {}, notes: [] });

    if (!categoryPages[catId]) categoryPages[catId] = [];
    if (!categoryPages[catId].includes(pageNo)) categoryPages[catId].push(pageNo);

    if (!itemName) {
      if (texts.length) cat.notes.push(label + ': ' + texts.join(' · '));
      links.forEach(l => cat.notes.push(l));
      return;
    }
    const it = cat.items[itemName] || (cat.items[itemName] = { parts: [], links: [], labels: [] });
    if (texts.length) it.parts.push({ label, text: texts.join(' · ') });
    it.links = it.links.concat(links);
    it.labels.push(label);
  }

  pages.forEach((lines, idx) => {
    const pageNo = idx + 1;
    for (let i = 0; i < lines.length; i++) {
      if (!looksLikeLabel(lines[i])) continue;
      const label = norm(lines[i]);

      const raw = [];
      let j = i + 1;
      while (j < lines.length && !looksLikeLabel(lines[j]) && !isBreak(lines[j])) {
        raw.push(lines[j]);
        j++;
      }
      const values = joinLinks(raw);

      // House details: take the next line even when it is all caps
      // ("25647 E BROWN TRACT RD, …" would otherwise look like a label)
      if (HEADER.includes(label)) { info[label] = values[0] || lines[i + 1] || ''; continue; }

      const target = MAP[label];
      if (!target) continue;

      // "No Garage Door" / "No Metal Roofing Applicable"
      if (/^no\s+(garage door|metal roofing)/i.test(values.join(' '))) {
        if (!notApplicable.includes(target.cat)) notApplicable.push(target.cat);
        continue;
      }
      store(target.cat, target.item, label, values, pageNo);
    }
  });

  // Build the final wording. One label reads on its own ("Stackstone brown");
  // several labels feeding the same item get named so it still makes sense
  // ("BORE TYPE: Double Bore · GLASS TYPE: Reflective Silver").
  Object.values(selections).forEach(cat => {
    Object.values(cat.items).forEach(it => {
      it.text = it.parts.length === 1
        ? it.parts[0].text
        : it.parts.map(p => p.label + ': ' + p.text).join(' · ');
      delete it.parts;
    });
  });

  const sqftText = info['SQUARE FOOTAGE'] || '';
  const sqft = Number((sqftText.match(/[\d,]+/) || ['0'])[0].replace(/,/g, '')) || null;

  return {
    client:  info['CLIENT'] || '',
    project: info['PROJECT'] || '',
    address: info['ADDRESS'] || '',
    sqft,
    captured: Number(info['SELECTIONS CAPTURED']) || null,
    status: info['STATUS'] || '',
    selections,
    notApplicable,
    categoryPages
  };
}


function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}


// Every store the office can pick from: the ones in the client store
// guide plus whatever has been added by hand.
function allStores(data) {
  return STORES.concat((data.config.customStores || []).map(s => ({ ...s, custom: true })));
}


// Builds the 10 standard categories for a new house
function newCategories() {
  return CATEGORIES.map(c => ({
    id: c.id,
    phase: c.phase,
    orderRank: c.orderRank,
    notApplicable: false,
    budget: JSON.parse(JSON.stringify(c.budget)),
    notes: '',
    photos: [],
    items: c.items.map(i => ({
      id: newId('i'),
      name: i.name,
      type: i.type,
      rate: i.rate || null,
      cap: i.cap || null,      // some sq ft allowances only cover so many feet
      sqft: null,
      qty: null,
      amount: null,
      orderRank: i.orderRank || null,
      triggerAfter: i.triggerAfter || null,   // e.g. shower heads follow the windows order
      selection: '',
      links: [],
      photos: [],
      room: i.room || '',
      // Categories the client never picks (security cameras) start ready to
      // order — there is no selection to wait for.
      status: c.clientSelects === false ? 'ready' : 'awaiting-selection',
      store: '',
      orderNo: '',
      tracking: '',
      orderDate: '',
      etaDate: '',
      receivedDate: '',
      notes: '',
      purchases: []
    }))
  }));
}


function blankItem(base, status) {
  return {
    id: newId('i'), name: base.name, type: base.type, rate: null, cap: null, sqft: null, qty: null,
    amount: null, orderRank: null, triggerAfter: base.triggerAfter || null, selection: '', links: [],
    photos: [], room: base.room || '', status, store: '', orderNo: '', tracking: '', orderDate: '',
    etaDate: '', receivedDate: '', notes: '', purchases: []
  };
}

function upgradeHouses(data) {
  let changed = false;
  data.projects.forEach(p => (p.categories || []).forEach(cat => {
    const base = CATEGORIES.find(c => c.id === cat.id);
    if (!base) return;
    const renames = RENAMED[cat.id] || {};
    (cat.items || []).forEach(i => {
      if (renames[i.name] && !cat.items.some(x => x.name === renames[i.name])) { i.name = renames[i.name]; changed = true; }
    });
    base.items.forEach(bi => {
      let item = cat.items.find(i => i.name === bi.name);
      if (!item) {
        item = blankItem(bi, base.clientSelects === false ? 'ready' : 'awaiting-selection');
        // the knob lines share one contract price by the piece
        if (cat.id === 'doorhardware' && bi.type === 'unit') {
          const priced = cat.items.find(i => i.type === 'unit' && i.rate);
          if (priced) item.rate = priced.rate;
        }
        cat.items.push(item);
        changed = true;
      }
      if (!item.room && bi.room) { item.room = bi.room; changed = true; }
    });
    // keep the catalog order; lines added by hand stay at the end
    const pos = i => { const k = base.items.findIndex(b => b.name === i.name); return k < 0 ? 999 : k; };
    const before = cat.items.map(i => i.id).join();
    cat.items.sort((a, b) => pos(a) - pos(b));
    if (cat.items.map(i => i.id).join() !== before) changed = true;
  }));
  return changed;
}


const findProject  = (data, id) => data.projects.find(p => p.id === id);
const findCategory = (proj, id) => (proj.categories || []).find(c => c.id === id);
const findItem     = (cat, id)  => (cat.items || []).find(i => i.id === id);


function sequence(data) {
  const saved = (data.config.sequence || []).filter(id => CATEGORIES.some(c => c.id === id));
  const rest = CATEGORIES.slice().sort((a, b) => a.orderRank - b.orderRank)
    .map(c => c.id).filter(id => !saved.includes(id));
  return saved.concat(rest);
}


// ── Applying what the PDFs said ──────────────────────────────
// Selections: fills in what the client picked, the links and the photos.
function applySelections(project, parsed) {
  let applied = 0;

  Object.entries(parsed.selections || {}).forEach(([catId, info]) => {
    const cat = findCategory(project, catId);
    if (!cat) return;

    if (info.notes && info.notes.length) {
      const extra = info.notes.join('\n');
      cat.notes = cat.notes ? cat.notes + '\n' + extra : extra;
    }

    Object.entries(info.items || {}).forEach(([itemName, sel]) => {
      const item = (cat.items || []).find(i => i.name === itemName);
      if (!item) return;
      const hasSomething = (sel.text && sel.text.trim()) || (sel.links && sel.links.length);
      if (!hasSomething) return;
      item.selection = sel.text || item.selection;
      item.links = Array.from(new Set((item.links || []).concat(sel.links || [])));
      if (item.status === 'awaiting-selection') item.status = 'ready';
      applied++;
    });
  });

  // Photos land on the category; they get pinned to an item from the screen
  Object.entries(parsed.photoUrls || {}).forEach(([catId, urls]) => {
    const cat = findCategory(project, catId);
    if (!cat) return;
    cat.photos = Array.from(new Set((cat.photos || []).concat(urls)));
  });

  (parsed.notApplicable || []).forEach(catId => {
    const cat = findCategory(project, catId);
    if (cat) cat.notApplicable = true;
  });

  if (parsed.fileUrl) {
    project.files = project.files || {};
    project.files.selections = parsed.fileUrl;
  }
  return applied;
}

// Allowances are captured by hand — Jacqueline checks every figure against
// the signed contract herself. This saves the whole sheet in one go.
function saveAllowances(project, categories) {
  let saved = 0;
  (categories || []).forEach(entry => {
    const cat = findCategory(project, entry.id);
    if (!cat) return;

    if (entry.type) cat.budget.type = entry.type;
    if (entry.type === 'amount') {
      cat.budget.amount = Number(entry.amount) || 0;
      if (cat.budget.amount) saved++;
    }
    if (entry.type === 'percent') {
      cat.budget.percent = Number(entry.percent) || 0;
      if (cat.budget.percent) saved++;
    }
    if (entry.type === 'perUnit') {
      cat.budget.rate = Number(entry.rate) || 0;
      cat.budget.qty = Number(entry.qty) || 0;
      if (cat.budget.rate && cat.budget.qty) saved++;
    }

    (entry.items || []).forEach(row => {
      const item = findItem(cat, row.id);
      if (!item) return;
      if (row.rate !== undefined) item.rate = row.rate === '' || row.rate === null ? null : Number(row.rate);
      if (row.sqft !== undefined) item.sqft = row.sqft === '' || row.sqft === null ? null : Number(row.sqft);
      if (row.cap !== undefined) item.cap = row.cap === '' || row.cap === null ? null : Number(row.cap);
      if (row.qty !== undefined) item.qty = row.qty === '' || row.qty === null ? null : Number(row.qty);
      if (row.amount !== undefined) item.amount = row.amount === '' || row.amount === null ? null : Number(row.amount);
      if (row.type) item.type = row.type;
      if (item.rate || item.amount) saved++;
    });
  });
  return saved;
}


const ITEM_TEXT = ['name', 'selection', 'status', 'store', 'orderNo', 'tracking',
                   'orderDate', 'etaDate', 'receivedDate', 'notes', 'type', 'room'];


// ── House plan ───────────────────────────────────────────────
// What each house needs, counted off its plan. Some counts come straight
// from the plan's schedules ('plan'); some are worked out from the rooms
// ('estimate' — e.g. one toilet per bathroom); fixtures drawn only as
// symbols are typed in by hand until the AI reader is connected.
// One count per line the office buys — same lines as the Selections tool.
// how: how the plan gives it ('plan' = read off a schedule; 'estimate' =
// worked out from the rooms; null = only drawn as a symbol, typed in).
const PLAN_COUNTS = [
  ['windows',      'Windows'],
  ['frontdoor',    'Main Entrance Door'],
  ['frontdoor',    'Exterior Rear Door'],
  ['doorhardware', 'Privacy Door Knob',            'bedrooms & bathrooms'],
  ['doorhardware', 'Passage Door Knob',            'closets, pantry, A/C, utility'],
  ['doorhardware', 'Dummy Door Knob',              'double-door closets'],
  ['doorhardware', 'Main/Front Door Hardware'],
  ['doorhardware', 'Back/Rear Door Hardware'],
  ['doorhardware', 'Interior Hinges',              '3 per swinging door'],
  ['doorhardware', 'Door Stops',                   '1 per swinging door'],
  ['plumbing',     'Toilets'],
  ['plumbing',     'Vanity Sink',                  'one per sink — two sinks can share a bath'],
  ['plumbing',     'Vanity Sink Faucets'],
  ['plumbing',     'Vanity Sink Drain'],
  ['plumbing',     'Bath Accessories',             'one set per bathroom'],
  ['plumbing',     'Shower Kits / Shower Heads'],
  ['plumbing',     'Shower Drain'],
  ['plumbing',     'Kitchen Sink'],
  ['plumbing',     'Kitchen Sink Faucet'],
  ['plumbing',     'Kitchen Sink Drain'],
  ['plumbing',     'Garbage Disposal'],
  ['plumbing',     'Pot Filler'],
  ['lighting',     'Interior Ceiling Fans',        'bedrooms'],
  ['lighting',     'Living Room Ceiling Fan'],
  ['lighting',     'Exterior Ceiling Fans',        'porch / patio'],
  ['lighting',     'Vanity Light Fixtures',        'one per bathroom'],
  ['lighting',     'Exterior Decorative Lights'],
  ['lighting',     'Dining Room Chandelier'],
  ['lighting',     'Kitchen Island Pendant Lights'],
  ['lighting',     'Foyer Light Fixture'],
  ['lighting',     'Additional Light Fixtures'],
  ['lighting',     'Fireplace'],
  ['mirrors',      'Master Bath Mirror'],
  ['mirrors',      'Second Bath Mirror'],
  ['mirrors',      'Third Bath Mirror'],
  ['mirrors',      'Half Bath Mirror']
].map(([cat, item, hint]) => ({ key: cat + '|' + item, cat, item, label: item, hint: hint || '' }));

function countsFromPlan(plan) {
  const c = {}, src = {};
  const set = (cat, item, v, how) => {
    if (Number.isFinite(v) && v >= 0) { c[cat + '|' + item] = v; src[cat + '|' + item] = how; }
  };
  const r = plan.rooms || {};
  const list = r.list || [];
  const has = re => list.some(n => re.test(n));
  const full = r.fullBaths || 0, half = r.halfBaths || 0, baths = full + half;
  const D = plan.doors;

  if (plan.windows) set('windows', 'Windows', plan.windows.total, 'plan');

  if (D) {
    const front = D.rows.filter(d => d.kind === 'exterior' && /FRONT|DECORATIVE|ENTRY/i.test(d.comments))
      .reduce((n, d) => n + d.count, 0) || (D.exterior ? 1 : 0);
    const rear = Math.max(0, D.exterior - front);
    set('frontdoor', 'Main Entrance Door', front, 'plan');
    set('frontdoor', 'Exterior Rear Door', rear, 'plan');
    set('doorhardware', 'Main/Front Door Hardware', front, 'plan');
    set('doorhardware', 'Back/Rear Door Hardware', rear, 'plan');

    // swinging leaves take hinges and a stop; pocket / sliding / barn do not
    const pairs = D.rows.filter(d => d.kind === 'double').reduce((n, d) => n + d.count, 0);
    const singles = D.interior + D.pantry;
    const leaves = singles + pairs * 2;
    set('doorhardware', 'Interior Hinges', leaves * 3, 'estimate');
    set('doorhardware', 'Door Stops', leaves, 'estimate');

    // privacy on bedroom and bathroom doors, dummy on double closets, passage the rest
    const latching = singles + D.pocket + D.barn;
    const privacy = Math.min(latching, (r.bedrooms || 0) + baths);
    set('doorhardware', 'Privacy Door Knob', privacy, 'estimate');
    set('doorhardware', 'Passage Door Knob', Math.max(0, latching - privacy), 'estimate');
    set('doorhardware', 'Dummy Door Knob', pairs * 2, 'estimate');
  }

  if (baths) {
    set('plumbing', 'Toilets', baths, 'estimate');
    ['Vanity Sink', 'Vanity Sink Faucets', 'Vanity Sink Drain'].forEach(n => set('plumbing', n, baths, 'estimate'));
    set('plumbing', 'Bath Accessories', baths, 'estimate');
    set('lighting', 'Vanity Light Fixtures', baths, 'estimate');
  }
  const showers = (D && D.shower) || full;
  if (showers) ['Shower Kits / Shower Heads', 'Shower Drain'].forEach(n => set('plumbing', n, showers, 'estimate'));
  if (has(/KITCHEN/)) ['Kitchen Sink', 'Kitchen Sink Faucet', 'Kitchen Sink Drain', 'Garbage Disposal']
    .forEach(n => set('plumbing', n, 1, 'estimate'));

  if (r.bedrooms) set('lighting', 'Interior Ceiling Fans', r.bedrooms, 'estimate');
  if (has(/LIVING/)) set('lighting', 'Living Room Ceiling Fan', 1, 'estimate');
  if (has(/DINING/)) set('lighting', 'Dining Room Chandelier', 1, 'estimate');
  if (has(/ENTRY|FOYER/)) set('lighting', 'Foyer Light Fixture', 1, 'estimate');

  if (has(/MASTER BATH|PRIMARY BATH/) || full) set('mirrors', 'Master Bath Mirror', 1, 'estimate');
  set('mirrors', 'Second Bath Mirror', full >= 2 ? 1 : 0, 'estimate');
  set('mirrors', 'Third Bath Mirror', full >= 3 ? 1 : 0, 'estimate');
  set('mirrors', 'Half Bath Mirror', half, 'estimate');
  return { counts: c, sources: src };
}

// Carry the counts onto their lines: what the house needs, and for lines
// priced by the piece (knobs, toilets) how many the contract rate covers
function applyCounts(project) {
  const counts = (project.plan && project.plan.counts) || {};
  PLAN_COUNTS.forEach(pc => {
    const v = counts[pc.key];
    if (v === undefined) return;
    const cat = findCategory(project, pc.cat);
    const item = cat && (cat.items || []).find(i => i.name === pc.item);
    if (!item) return;
    item.needQty = v;
    if (item.type === 'unit' && v != null) item.qty = v;
    // the plan says this house has none (no half bath, no third bath) → stop asking for it
    if (v === 0 && !item.notApplicable) { item.notApplicable = true; item.offByPlan = true; }
    if (v > 0 && item.offByPlan) { item.notApplicable = false; item.offByPlan = false; }
  });
}


const num = s => Number(String(s).replace(/,/g, ''));
// 3' - 0"  /  36"  /  36''  → inches
const DIM = `(?:\\d+'\\s*-\\s*\\d+(?:\\s\\d\\/\\d)?(?:"|'')|\\d+(?:"|''))`;
function inches(d) {
  const m = String(d).match(/(\d+)'\s*-\s*(\d+)/);
  return m ? Number(m[1]) * 12 + Number(m[2]) : Number(String(d).replace(/\D/g, ''));
}

function areas(all) {
  const out = {};
  const living = all.match(/LIVING(?: AREA)?\s+([\d,]+)\s*S\.?F/i);
  if (living) out.livingSqft = num(living[1]);
  const total = all.match(/BUILDING AREA.*?TOTAL\s+([\d,]+)\s*S\.?F/i);
  if (total) out.totalSqft = num(total[1]);
  out.outdoor = [];
  const re = /((?:FRONT|REAR|BACK|SIDE)\s+(?:PATIO|PORCH))\s+([\d,]+)\s*S\.?F/gi;
  let m; const seen = new Set();
  while ((m = re.exec(all))) {
    const k = m[1].toUpperCase();
    if (!seen.has(k)) { seen.add(k); out.outdoor.push({ name: k, sqft: num(m[2]) }); }
  }
  // "APPLIED STONE VENEER TOTAL SQFT: 214 SQFT" or "STONE SQFT LIME STONE WHITE 202 SF"
  const stone = all.match(/STONE[^0-9]{0,60}?(?:TOTAL\s+)?SQ\.?\s?FT:?\s*([^0-9]{0,30}?)([\d,]+)\s*(?:SQ\.?\s?FT|S\.?F)/i);
  if (stone) { out.stoneSqft = num(stone[2]); out.stoneName = stone[1].trim(); }
  return out;
}

function windowSchedule(page) {
  const start = page.indexOf('WINDOW SCHEDULE');
  if (start < 0) return null;
  let text = page.slice(start).replace(/^WINDOW SCHEDULE.*?Count(?:\s+Width\s+Height)?/i, '');
  const MARK = `[A-Z]{1,2}(?:-\\d+)?`;      // A, B … or D-01, D-02
  const re = new RegExp(`\\b(${MARK})\\s+(${DIM})\\s+(${DIM})\\s+([A-Z]+\\.?)\\s+(${DIM})\\s+(.+?)\\s+(\\d+)(?=\\s+${MARK}\\s+\\d|\\s+0'|\\s*$)`, 'g');
  const rows = [];
  let m;
  while ((m = re.exec(text))) {
    rows.push({
      mark: m[1], width: m[2], height: m[3], material: m[4],
      description: m[6].trim(), count: Number(m[7]),
      size: inches(m[2]) + '" x ' + inches(m[3]) + '"'
    });
  }
  if (!rows.length) return null;
  return { rows, total: rows.reduce((s, r) => s + r.count, 0) };
}

function doorKind(r) {
  const c = (r.material + ' ' + r.comments).toUpperCase();
  if (/SHOWER/.test(c)) return 'shower';
  if (/FRONT DOOR|REAR DOOR|ENTRY|EXTERIOR|PATIO|SLIDING GLASS|FRENCH/.test(c)) return 'exterior';
  if (/SOLID/.test(c) && !/HOLLOW/.test(c)) return 'exterior';  // pair front doors included
  // interior doors are 80" tall; 84"+ with no other note is an outside door
  const h = Number((r.size.match(/x\s*(\d+)/) || [])[1]);
  if (h >= 84 && !/HOLLOW|POCKET|DOUBLE/.test(c)) return 'exterior';
  if (/PANTRY/.test(c)) return 'pantry';
  if (/POCKET/.test(c)) return 'pocket';
  if (/BARN/.test(c)) return 'barn';
  if (/SLIDING|BI-?FOLD/.test(c)) return 'sliding';    // closet doors — no knob set
  if (r.pair || /DOUBLE/.test(c)) return 'double';
  if (/SOLID/.test(c)) return 'exterior';    // solid core with no other note = an outside door
  return 'interior';
}

function doorSchedule(page) {
  const start = page.indexOf('DOOR SCHEDULE');
  if (start < 0) return null;
  const end = page.indexOf('WINDOW SCHEDULE', start);
  let text = page.slice(start, end > 0 ? end : start + 3000)
    .replace(/^DOOR SCHEDULE.*?Count(?:\s+Door Swing)?/i, ' ');
  const rowStart = new RegExp(`\\s(\\d{1,2})\\s+((?:PAIR\\s+)?\\d+(?:"|'')\\s*[xX]\\s*\\d+(?:"|'')|<varies>)`, 'g');
  const starts = [];
  let m;
  while ((m = rowStart.exec(text))) starts.push({ i: m.index, mark: m[1], size: m[2], after: m.index + m[0].length });
  const rows = starts.map((s, k) => {
    const rest = text.slice(s.after, k + 1 < starts.length ? starts[k + 1].i : undefined).trim();
    const cm = rest.match(/^(.*?)\s+(\d+)\s*(LEFT|RIGHT)?\s*$/i) || rest.match(/^(.*?)\s+(\d+)\b/);
    const count = cm ? Number(cm[2]) : 1;
    // "PAIR" shows up before or after the size depending on the drafter
    const pairAfter = /^PAIR\s+/i.test(cm ? cm[1] : rest);
    const body = (cm ? cm[1] : rest).replace(/^PAIR\s+/i, '').replace(/^\.\s*/, '');
    const mat = (body.match(/^(WOOD|GLASS|METAL|STEEL|FIBERGLASS|ALUM\w*)/i) || [''])[0];
    const r = {
      mark: s.mark, size: s.size.replace(/''/g, '"').replace(/X/g, 'x').replace(/^PAIR\s+/i, ''),
      pair: /^PAIR/i.test(s.size) || pairAfter,
      material: mat, comments: body.slice(mat.length).trim(), count
    };
    r.kind = doorKind(r);
    return r;
  });
  if (!rows.length) return null;
  const sum = k => rows.filter(r => r.kind === k).reduce((s, r) => s + r.count, 0);
  return {
    rows,
    exterior: sum('exterior'),
    interior: sum('interior'),
    pantry: sum('pantry'), pocket: sum('pocket'), barn: sum('barn'), sliding: sum('sliding'),
    double: sum('double'), shower: sum('shower'),
    // every interior opening that takes a knob or handle set
    interiorOpenings: sum('interior') + sum('pantry') + sum('pocket') + sum('barn') + sum('double')
  };
}

// Rooms from the labels on the floor plan page
function rooms(page) {
  page = page.replace(/\d+(?:"|'')\s*PLUMBING WALL/gi, ' ');   // 'FULL BATH 6" PLUMBING WALL' is not bath 6
  const count = re => (page.match(re) || []).length;
  const uniq = re => new Set((page.match(re) || []).map(s => s.toUpperCase().replace(/\s+/g, ' '))).size;
  const bedrooms = uniq(/\b(?:MASTER BEDROOM|PRIMARY BEDROOM|BEDROOM \d|GUEST \d|GUEST ROOM)\b/gi)
    || count(/\bBEDROOM\b/gi);
  const fullBaths = uniq(/\b(?:MASTER BATH|PRIMARY BATH)\b/gi) + uniq(/\bFULL BATH \d\b/gi) +
    count(/\bFULL BATH\b(?! \d)/gi);
  const halfBaths = count(/\b(?:HALF BATH|POWDER(?: ROOM)?|1\/2 BATH)\b/gi);
  const list = Array.from(new Set((page.match(/\b(?:MASTER BEDROOM|PRIMARY BEDROOM|BEDROOM \d?|GUEST \d|MASTER BATH|FULL BATH \d?|HALF BATH|POWDER|KITCHEN|LIVING ROOM|DINING|PANTRY|HIDDEN PANTRY|LAUNDRY|UTILITY|W\.I\.C\.|LINEN|HALL ?WAY|ENTRY|FRONT PORCH|REAR PORCH|REAR PATIO|GARAGE|OFFICE|STUDY|GAME ROOM)\b/gi) || [])
    .map(s => s.toUpperCase().replace(/\s+/g, ' '))));
  return { bedrooms, fullBaths, halfBaths, list };
}



// Same rules as plans.js readPlanPDF, on the page texts that pdf.js gives us in the browser
function readPlanFromPages(pages) {
  const all = pages.join(' ');
  const out = { pages: pages.length, ...areas(all) };
  const schedPage = pages.find(p => p.includes('DOOR SCHEDULE') || p.includes('WINDOW SCHEDULE')) || '';
  out.windows = windowSchedule(schedPage);
  out.doors = doorSchedule(schedPage);
  out.warnings = [];
  if (out.doors && (out.doors.exterior > 6 || out.doors.interiorOpenings > 40 || out.doors.rows.some(r => r.count > 30))) {
    out.doors = null;
    out.warnings.push('The door schedule on this plan is laid out differently — type the door counts in.');
  }
  if (out.windows && (out.windows.total > 60 || out.windows.rows.some(r => r.count > 30))) {
    out.windows = null;
    out.warnings.push('The window schedule on this plan is laid out differently — type the window count in.');
  }
  out.rooms = rooms(schedPage || all);
  out.found = !!(out.windows || out.doors || out.livingSqft);
  return out;
}

const GARAGE = 'garage';
const DEFAULT_PLACES = [{ id: 'office', name: 'Office' }, { id: 'owners-house', name: "Owner's house" }];
const placeId = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';
const pickupPlaces = data => (data.config.pickupPlaces && data.config.pickupPlaces.length)
  ? data.config.pickupPlaces : DEFAULT_PLACES;
const garageName = data => data.config.garageName || 'Garage';
const DELIVERY_STAGES = ['', 'arrived', 'garage', 'delivered'];

// One flat list of everything that has been ordered, with where it is now
function deliveryList(data) {
  const out = [];
  data.projects.filter(p => p.active !== false).forEach(p => {
    (p.categories || []).forEach(cat => {
      if (cat.notApplicable) return;
      const base = CATEGORIES.find(c => c.id === cat.id) || {};
      const catPhase = Number.isInteger(cat.phase) ? cat.phase : base.phase;
      (cat.items || []).forEach(item => {
        if (item.notApplicable) return;
        if (!base.driverDelivers) return;      // the vendor delivers the rest to the house
        if (!['ordered', 'in-transit', 'received', 'installed'].includes(item.status)) return;
        const d = item.delivery || {};
        const stage = item.status === 'installed' ? 'delivered' : (d.stage || '');
        out.push({
          houseId: p.id, house: p.name, address: p.address || '',
          catId: cat.id, category: base.name || cat.id, icon: base.icon || '📦',
          itemId: item.id, item: item.name, selection: item.selection || '',
          room: item.room || '', pieces: item.pieces || null,
          photo: (item.photos || [])[0] || '',
          store: item.store || '', orderNo: item.orderNo || '', etaDate: item.etaDate || '',
          stage, location: d.location || '', log: d.log || [],
          // needed at the house now / next phase → it should not sit in the garage
          need: urgencyByPhase(Number.isInteger(p.phase) ? p.phase : null, catPhase)
        });
      });
    });
  });
  return out;
}


// ── Small helpers ────────────────────────────────────────────
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const hdr = extra => Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, extra || {});
const cleanName = s => String(s || 'file').replace(/[^a-zA-Z0-9._-]/g, '-');
const codeOf = s => (String(s || '').match(/\((\d+)\)\s*$/) || [])[1] || '';
const famOf = s => String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
const keyHashOf = k => sha256Hex('stb-orders:' + k);

// ── Cloud rows ───────────────────────────────────────────────
function emptyData() {
  return { config: { warnPercent: 80, company: 'South Texas Builders', customStores: [] }, projects: [] };
}
function normalize(d) {
  d = d && typeof d === 'object' ? d : emptyData();
  d.config = d.config && typeof d.config === 'object' ? d.config : {};
  d.config.customStores = Array.isArray(d.config.customStores) ? d.config.customStores : [];
  if (!d.config.warnPercent) d.config.warnPercent = 80;
  d.projects = Array.isArray(d.projects) ? d.projects : [];
  return d;
}
// Houses made before a line was renamed/added are brought up to the current list on first open
async function upgradeIfNeeded() {
  const probe = JSON.parse(JSON.stringify(await readData()));
  if (upgradeHouses(probe)) { await mutate(d => { upgradeHouses(d); }); }
}

async function readRow(id) {
  const url = SUPABASE_URL + '/rest/v1/' + SUPABASE_TABLE + '?id=eq.' + encodeURIComponent(id) + '&select=data,updated_at';
  const res = await fetch(url, { headers: hdr() });
  if (!res.ok) throw new HttpError(503, 'Could not read from the cloud (' + res.status + ')');
  const rows = await res.json();
  if (!rows || !rows[0]) return null;
  let obj = null;
  try { obj = JSON.parse((rows[0].data && rows[0].data.value) || ''); } catch (e) {}
  if (!obj || typeof obj !== 'object') return null;
  return { obj, updated_at: rows[0].updated_at };
}
async function createRow(id, obj) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + SUPABASE_TABLE, {
    method: 'POST',
    headers: hdr({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ id, data: { value: JSON.stringify(obj) }, updated_at: new Date().toISOString() })
  });
  if (res.status === 409) return null;                    // another device created it first
  if (!res.ok) throw new HttpError(503, 'Could not create the record in the cloud (' + res.status + ')');
  const rows = await res.json().catch(() => []);
  return rows[0] ? rows[0].updated_at : new Date().toISOString();
}
/* Always read the newest copy, apply the change, write with compare-and-set;
   if someone saved in between, retry on top of their copy. */
async function casSave(rowId, mutator, seed) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await readRow(rowId);
    if (!row) {
      if (!seed) throw new HttpError(404, 'That record does not exist in the cloud yet.');
      const obj = seed(); const result = mutator(obj);
      const tok = await createRow(rowId, obj);
      if (tok === null) continue;
      CACHE = null; return result;
    }
    const obj = row.obj; const result = mutator(obj);
    const cond = SUPABASE_URL + '/rest/v1/' + SUPABASE_TABLE + '?id=eq.' + encodeURIComponent(rowId) +
      '&updated_at=eq.' + encodeURIComponent(row.updated_at);
    const res = await fetch(cond, {
      method: 'PATCH',
      headers: hdr({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ data: { value: JSON.stringify(obj) }, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new HttpError(503, 'Could not save to the cloud (' + res.status + ')');
    const rows = await res.json().catch(() => []);
    if (rows && rows.length) { CACHE = null; return result; }
    // empty list = someone saved between our read and write → retry
  }
  throw new HttpError(503, 'The cloud is very busy — try again in a moment.');
}
const mutate = fn => casSave(ROW_ID, d => { normalize(d); return fn(d); }, emptyData);

let CACHE = null;                                          // reads are reused for 2 seconds
async function readData() {
  if (CACHE && Date.now() - CACHE.t < 2000) return CACHE.d;
  const row = await readRow(ROW_ID);
  const d = normalize(row ? row.obj : emptyData());
  CACHE = { t: Date.now(), d };
  return d;
}

// ── Files (Supabase Storage) ─────────────────────────────────
async function uploadFile(path, body, type) {
  const isImg = /^image\//i.test(type || '');
  const buckets = isImg ? [BUCKET, PDF_BUCKET] : [PDF_BUCKET, BUCKET];   // the other one is only a fallback
  let lastErr = '';
  for (const bucket of buckets) {
    const res = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, {
      method: 'POST', headers: hdr({ 'Content-Type': type, 'x-upsert': 'true' }), body
    });
    if (res.ok) return SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path;
    try { lastErr = await res.text(); } catch (e) {}
  }
  throw new HttpError(400, 'The file could not be uploaded. ' + lastErr);
}
function compressImage(fileOrBlob, max) {
  max = max || 1600;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > max || h > max) { const k = Math.min(max / w, max / h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('Could not process the image.')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image.')); };
    img.src = url;
  });
}
const isImageName = n => /\.(jpe?g|png|gif|webp)$/i.test(n || '');
async function uploadUserFile(file, folder) {
  const stamp = Date.now();
  if ((file.type || '').startsWith('image/') || isImageName(file.name)) {
    const blob = await compressImage(file);
    return uploadFile('ordenes/' + folder + '/' + stamp + '_' + cleanName(file.name.replace(/\.[^.]+$/, '')) + '.jpg', blob, 'image/jpeg');
  }
  return uploadFile('ordenes/' + folder + '/' + stamp + '_' + cleanName(file.name), file, file.type || 'application/octet-stream');
}

// ── Routes ───────────────────────────────────────────────────
const ROUTES = [];
function route(method, pattern, fn) {
  const names = (pattern.match(/:[a-zA-Z]+/g) || []).map(s => s.slice(1));
  ROUTES.push({ method, names, fn, re: new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, '([^/]+)') + '$') });
}
const need = (v, status, msg) => { if (!v) throw new HttpError(status, msg); return v; };

route('GET', '/api/catalog', async () => {
  const data = await readData();
  const order = sequence(data);
  const categories = CATEGORIES.map(c => ({ ...c, orderRank: order.indexOf(c.id) + 1 }));
  return { categories, stores: allStores(data), phases: PHASES, statuses: STATUSES, planCounts: PLAN_COUNTS };
});

route('POST', '/api/sequence', (_, b) => mutate(data => {
  const order = (b.order || []).filter(id => CATEGORIES.some(c => c.id === id));
  if (order.length !== CATEGORIES.length) throw new HttpError(400, 'The list is incomplete.');
  data.config.sequence = order;
  data.projects.forEach(p => (p.categories || []).forEach(cat => {
    const i = order.indexOf(cat.id);
    if (i >= 0) cat.orderRank = i + 1;
  }));
  return { ok: true };
}));

route('GET', '/api/data', async () => {
  const data = await readData();
  const projects = data.projects.map(p => ({
    ...p,
    summary: projectSummary(p, data.config),
    categories: (p.categories || []).map(c => ({ ...c, summary: categorySummary(c, data.config.warnPercent, p.contractPrice) }))
  }));
  const c = data.config;
  return { config: { warnPercent: c.warnPercent, company: c.company, customStores: c.customStores, sequence: c.sequence,
    pickupPlaces: c.pickupPlaces, garageName: c.garageName, pickupDay: c.pickupDay }, projects };
});

route('POST', '/api/config', async (_, b) => {
  const newHash = b.key && String(b.key).trim().length >= 4 ? await keyHashOf(String(b.key).trim()) : null;
  await mutate(data => {
    if (b.warnPercent) data.config.warnPercent = Math.max(1, Math.min(100, Number(b.warnPercent)));
    if (newHash) { data.config.keyHash = newHash; delete data.config.key; }
    if (Array.isArray(b.pickupPlaces)) {
      data.config.pickupPlaces = b.pickupPlaces.map(n => String(n).trim()).filter(Boolean).map(name => ({ id: placeId(name), name }));
    }
    if (b.garageName !== undefined) data.config.garageName = String(b.garageName).trim() || 'Garage';
    if (b.pickupDay !== undefined) data.config.pickupDay = String(b.pickupDay);
  });
  if (newHash) { try { localStorage.setItem(ACCESS_LS, newHash); } catch (e) {} }
  return { ok: true };
});

// Stores added by hand
route('POST', '/api/stores', (_, b) => mutate(data => {
  const name = String(b.name || '').trim();
  if (!name) throw new HttpError(400, 'The store needs a name.');
  if (allStores(data).some(s => s.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, 'That store is already on the list.');
  const store = {
    id: newId('store'), name, categories: Array.isArray(b.categories) ? b.categories : [],
    address: b.address || '', contact: b.contact || '', notes: b.notes || '',
    guideCategory: b.guideCategory || 'Added by the office'
  };
  data.config.customStores.push(store);
  return store;
}));
route('PUT', '/api/stores/:id', (p, b) => mutate(data => {
  const store = need(data.config.customStores.find(s => s.id === p.id), 404, 'Only stores added by hand can be edited.');
  ['name', 'address', 'contact', 'notes'].forEach(k => { if (b[k] !== undefined) store[k] = String(b[k]).trim(); });
  if (Array.isArray(b.categories)) store.categories = b.categories;
  return store;
}));
route('DELETE', '/api/stores/:id', (p) => mutate(data => {
  const before = data.config.customStores.length;
  data.config.customStores = data.config.customStores.filter(s => s.id !== p.id);
  if (data.config.customStores.length === before) throw new HttpError(404, 'Only stores added by hand can be removed.');
  return { ok: true };
}));

// Houses
route('POST', '/api/projects', (_, b) => mutate(data => {
  const parsed = b.selections || null;
  const name = String(b.name || (parsed && parsed.project) || '').replace(/\s*Residence\s*$/i, '').trim();
  if (!name) throw new HttpError(400, 'The house needs a name.');
  const project = {
    id: newId('proj'), name,
    client: b.client || (parsed && parsed.client) || '',
    address: b.address || (parsed && parsed.address) || '',
    sqft: Number(b.sqft) || (parsed && parsed.sqft) || null,
    contractPrice: Number(b.contractPrice) || null,
    phase: Number.isInteger(b.phase) ? b.phase : 0,
    reportsId: b.reportsId || '',
    active: true, created: new Date().toISOString(),
    files: {}, categories: newCategories(), changeOrders: []
  };
  const appliedSelections = parsed ? applySelections(project, parsed) : 0;
  if (b.contractUrl) { project.files = project.files || {}; project.files.contract = b.contractUrl; }
  data.projects.push(project);
  return { ...project, appliedSelections };
}));
route('PUT', '/api/projects/:id', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  ['name', 'client', 'address', 'reportsId'].forEach(k => { if (b[k] !== undefined) project[k] = b[k]; });
  if (b.sqft !== undefined) project.sqft = Number(b.sqft) || null;
  if (b.contractPrice !== undefined) project.contractPrice = Number(b.contractPrice) || null;
  if (b.phase !== undefined) project.phase = Number(b.phase);
  if (b.active !== undefined) project.active = !!b.active;
  if (b.contractUrl) { project.files = project.files || {}; project.files.contract = b.contractUrl; }
  return project;
}));
route('DELETE', '/api/projects/:id', (p) => mutate(data => {
  data.projects = data.projects.filter(x => x.id !== p.id);
  return { ok: true };
}));
route('POST', '/api/projects/:id/apply-selections', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  if (!b.selections) throw new HttpError(400, 'Nothing to apply.');
  const parsed = b.selections;
  if (parsed.client && !project.client) project.client = parsed.client;
  if (parsed.address && !project.address) project.address = parsed.address;
  if (parsed.sqft && !project.sqft) project.sqft = parsed.sqft;
  const applied = applySelections(project, parsed);
  return { ok: true, applied, notApplicable: parsed.notApplicable || [] };
}));
route('POST', '/api/projects/:id/allowances', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  if (b.contractPrice !== undefined) project.contractPrice = Number(b.contractPrice) || null;
  const saved = saveAllowances(project, b.categories);
  return {
    ok: true, saved, summary: projectSummary(project, data.config),
    categories: project.categories.map(c => ({ id: c.id, summary: categorySummary(c, data.config.warnPercent, project.contractPrice) }))
  };
}));

// Categories and items
route('PUT', '/api/projects/:id/categories/:catId', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  const cat = need(findCategory(project, p.catId), 404, 'Category not found.');
  if (b.notApplicable !== undefined) cat.notApplicable = !!b.notApplicable;
  if (b.notes !== undefined) cat.notes = b.notes;
  if (b.phase !== undefined) cat.phase = Number(b.phase);
  if (b.orderRank !== undefined) cat.orderRank = Number(b.orderRank) || null;
  if (b.budget) {
    if (b.budget.type) cat.budget.type = b.budget.type;
    if (b.budget.amount !== undefined) cat.budget.amount = Number(b.budget.amount) || 0;
  }
  if (Array.isArray(b.photos)) cat.photos = b.photos;
  return { ok: true, summary: categorySummary(cat, data.config.warnPercent, project.contractPrice) };
}));
route('PUT', '/api/projects/:id/categories/:catId/items/:itemId', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  const cat = need(findCategory(project, p.catId), 404, 'Category not found.');
  const item = need(findItem(cat, p.itemId), 404, 'Item not found.');
  ITEM_TEXT.forEach(k => { if (b[k] !== undefined) item[k] = b[k]; });
  ['sqft', 'qty', 'cap', 'rate', 'amount', 'orderRank', 'pieces', 'needQty'].forEach(k => {
    if (b[k] !== undefined) item[k] = (b[k] === '' || b[k] === null) ? null : Number(b[k]);
  });
  if (b.links !== undefined) item.links = (b.links || []).filter(Boolean);
  if (b.photos !== undefined) item.photos = (b.photos || []).filter(Boolean);
  if (b.notApplicable !== undefined) item.notApplicable = !!b.notApplicable;
  return { ok: true, item, summary: categorySummary(cat, data.config.warnPercent, project.contractPrice) };
}));
route('POST', '/api/projects/:id/categories/:catId/items', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  const cat = need(findCategory(project, p.catId), 404, 'Category not found.');
  if (!b.name) throw new HttpError(400, 'The item needs a name.');
  const item = {
    id: newId('i'), name: String(b.name).trim(), type: b.type || 'category',
    rate: b.rate ? Number(b.rate) : null, sqft: b.sqft ? Number(b.sqft) : null,
    amount: b.amount ? Number(b.amount) : null, orderRank: b.orderRank ? Number(b.orderRank) : null,
    selection: b.selection || '', links: b.links || [], photos: [],
    status: b.status || 'awaiting-selection',
    store: '', orderNo: '', tracking: '', orderDate: '', etaDate: '', receivedDate: '', notes: '', purchases: []
  };
  cat.items.push(item);
  return item;
}));
route('DELETE', '/api/projects/:id/categories/:catId/items/:itemId', (p) => mutate(data => {
  const project = findProject(data, p.id);
  const cat = need(project && findCategory(project, p.catId), 404, 'Not found.');
  cat.items = cat.items.filter(i => i.id !== p.itemId);
  return { ok: true };
}));

// Purchases and vendor invoices
route('POST', '/api/projects/:id/categories/:catId/items/:itemId/purchases', (p, b) => mutate(data => {
  const project = findProject(data, p.id);
  const cat = project && findCategory(project, p.catId);
  const item = need(cat && findItem(cat, p.itemId), 404, 'Item not found.');
  const perSqft = Number(b.pricePerSqft) || 0;
  const sqftBought = Number(b.sqftBought) || 0;
  const total = Number(b.total) || round2(perSqft * sqftBought);
  const purchase = {
    id: newId('pu'), date: b.date || today(), description: b.description || '',
    store: b.store || item.store || '', total: round2(total),
    pricePerSqft: perSqft || null, sqftBought: sqftBought || null,
    pieces: Number(b.pieces) || null,
    orderNo: b.orderNo || '', receipt: b.receipt || '', isInvoice: !!b.isInvoice
  };
  item.purchases.push(purchase);
  if (['awaiting-selection', 'ready'].includes(item.status)) {
    item.status = 'ordered';
    if (!item.orderDate) item.orderDate = purchase.date;
  }
  if (purchase.store && !item.store) item.store = purchase.store;
  if (purchase.orderNo && !item.orderNo) item.orderNo = purchase.orderNo;
  return { ok: true, purchase, summary: categorySummary(cat, data.config.warnPercent, project.contractPrice) };
}));
route('DELETE', '/api/projects/:id/categories/:catId/items/:itemId/purchases/:pid', (p) => mutate(data => {
  const project = findProject(data, p.id);
  const cat = project && findCategory(project, p.catId);
  const item = need(cat && findItem(cat, p.itemId), 404, 'Item not found.');
  item.purchases = item.purchases.filter(x => x.id !== p.pid);
  return { ok: true, summary: categorySummary(cat, data.config.warnPercent, project.contractPrice) };
}));


// One order, several lines (one cart, one total with tax) — split across the lines
route('POST', '/api/projects/:id/orders', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  const total = round2(Number(b.total) || 0);
  if (!total) throw new HttpError(400, 'Put the order total in (with tax and shipping).');
  const lines = (b.lines || []).map(l => {
    const cat = findCategory(project, l.catId);
    const item = cat && findItem(cat, l.itemId);
    return item ? { cat, item, price: Number(l.price) || 0, pieces: Number(l.pieces) || null } : null;
  }).filter(Boolean);
  if (!lines.length) throw new HttpError(400, 'Pick at least one line.');
  const priced = lines.filter(l => l.price > 0);
  if (priced.length && priced.length < lines.length) throw new HttpError(400, 'Put the price before tax on every line, or on none of them.');
  const pricedSum = priced.reduce((s, l) => s + l.price, 0);
  lines.forEach(l => { l.share = priced.length ? round2(total * l.price / pricedSum) : round2(total / lines.length); });
  const diff = round2(total - lines.reduce((s, l) => s + l.share, 0));
  lines[0].share = round2(lines[0].share + diff);
  const orderId = newId('ord');
  const names = lines.map(l => l.item.name + (l.pieces ? ' ×' + l.pieces : ''));
  lines.forEach(l => {
    l.item.purchases = l.item.purchases || [];
    l.item.purchases.push({
      id: newId('pu'), orderId, date: b.date || today(), description: b.description || names.join(', '),
      store: b.store || '', orderNo: b.orderNo || '', receipt: b.receipt || '', total: l.share,
      priceBeforeTax: l.price || null, pieces: l.pieces, orderTotal: total, orderLines: names
    });
    if (['awaiting-selection', 'ready'].includes(l.item.status)) l.item.status = 'ordered';
    if (b.store && !l.item.store) l.item.store = b.store;
    if (b.orderNo && !l.item.orderNo) l.item.orderNo = b.orderNo;
    if (!l.item.orderDate) l.item.orderDate = b.date || today();
  });
  return { ok: true, orderId, shares: lines.map(l => ({ item: l.item.name, share: l.share })) };
}));
route('DELETE', '/api/projects/:id/orders/:orderId', (p) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  let removed = 0;
  (project.categories || []).forEach(cat => (cat.items || []).forEach(item => {
    const before = (item.purchases || []).length;
    item.purchases = (item.purchases || []).filter(x => x.orderId !== p.orderId);
    removed += before - item.purchases.length;
  }));
  return { ok: true, removed };
}));

// House plan: the plan PDF is read here in the browser (pdf.js), the counts are Jackie's rules
route('POST', '/api/projects/:id/read-plan', async (p, fd) => {
  const file = fd.get && fd.get('pdf');
  if (!file || !file.name) throw new HttpError(400, 'No PDF came through.');
  if (file.size > 80 * 1024 * 1024) throw new HttpError(400, 'That plan is too big (80 MB max).');
  need(findProject(await readData(), p.id), 404, 'House not found.');
  let parsed;
  try { parsed = readPlanFromPages(await pdfPageTexts(file)); }
  catch (e) { throw new HttpError(400, 'Could not read that plan: ' + (e.message || e)); }
  let fileUrl = '';
  try { fileUrl = await uploadFile('ordenes/plans/' + Date.now().toString(36) + '_' + cleanName(file.name), file, 'application/pdf'); } catch (e) { /* too big for storage: the numbers still count */ }
  const { counts, sources } = countsFromPlan(parsed);
  return mutate(data => {
    const project = need(findProject(data, p.id), 404, 'House not found.');
    const old = project.plan || {};
    Object.keys(old.sources || {}).forEach(k => {                   // anything typed by hand before survives a re-read
      if (old.sources[k] === 'manual') { counts[k] = old.counts[k]; sources[k] = 'manual'; }
    });
    project.plan = { ...parsed, fileUrl, readAt: today(), counts, sources, confirmed: false };
    if (!fileUrl) project.plan.warnings = (project.plan.warnings || []).concat('The plan PDF itself could not be stored (file too large) — the numbers were read fine.');
    return { ok: true, plan: project.plan };
  });
});
route('PUT', '/api/projects/:id/plan', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  const plan = project.plan || (project.plan = { counts: {}, sources: {} });
  const counts = b.counts || {};
  PLAN_COUNTS.forEach(pc => {
    if (counts[pc.key] === undefined) return;
    const v = counts[pc.key] === '' || counts[pc.key] === null ? null : Number(counts[pc.key]);
    if (v !== plan.counts[pc.key]) plan.sources[pc.key] = 'manual';
    plan.counts[pc.key] = v;
  });
  if (b.livingSqft !== undefined) plan.livingSqft = Number(b.livingSqft) || null;
  if (b.stoneSqft !== undefined) plan.stoneSqft = Number(b.stoneSqft) || null;
  plan.confirmed = true;
  applyCounts(project);
  return { ok: true, plan };
}));

// Deliveries: office / owner's house → garage → the house (Robert ticks each step on his phone)
route('GET', '/api/deliveries', async () => {
  const data = await readData();
  return { places: pickupPlaces(data), garage: garageName(data), pickupDay: data.config.pickupDay || '', items: deliveryList(data) };
});
route('POST', '/api/deliveries/:id/:catId/:itemId', (p, b) => mutate(data => {
  const project = findProject(data, p.id);
  const cat = project && findCategory(project, p.catId);
  const item = need(cat && findItem(cat, p.itemId), 404, 'Item not found.');
  const stage = String(b.stage || '');
  if (!DELIVERY_STAGES.includes(stage)) throw new HttpError(400, 'Unknown step.');
  let location = String(b.location || '');
  if (stage === 'garage') location = GARAGE;
  if (stage === 'delivered') location = 'house';
  if (stage === '') location = '';
  const d = item.delivery || (item.delivery = { log: [] });
  d.stage = stage; d.location = location;
  d.log = (d.log || []).concat([{ stage, location, by: String(b.by || '').slice(0, 40), at: new Date().toISOString() }]);
  if (stage && ['ordered', 'in-transit'].includes(item.status)) item.status = 'received';
  if (stage && !item.receivedDate) item.receivedDate = today();
  return { ok: true };
}));

// Uploads (receipts, invoices, contract) — the form sends receipt / photo / contract
route('POST', '/api/upload', async (_, fd) => {
  const file = fd.get('receipt') || fd.get('photo') || fd.get('contract');
  if (!file || !file.name) throw new HttpError(400, 'No file came through.');
  const folder = fd.get('photo') ? 'photos' : fd.get('contract') ? 'contracts' : 'receipts';
  if (file.size > 25 * 1024 * 1024) throw new HttpError(400, 'That file is too big (25 MB max).');
  return { ok: true, url: await uploadUserFile(file, folder) };
});

// Change orders
route('POST', '/api/projects/:id/change-orders', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  const cat = need(findCategory(project, b.category), 404, 'Category not found.');
  const s = categorySummary(cat, data.config.warnPercent, project.contractPrice);
  const base = CATEGORIES.find(c => c.id === cat.id) || {};
  const co = {
    id: newId('co'), category: cat.id, categoryName: base.name || cat.id, date: today(),
    allowance: s.allowance, spent: s.spent, amount: s.over || round2(b.amount),
    description: b.description || '', status: 'pending'
  };
  project.changeOrders = project.changeOrders || [];
  project.changeOrders.push(co);
  return co;
}));
route('PUT', '/api/projects/:id/change-orders/:coId', (p, b) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  const co = need((project.changeOrders || []).find(c => c.id === p.coId), 404, 'Change order not found.');
  ['status', 'description'].forEach(k => { if (b[k] !== undefined) co[k] = b[k]; });
  if (b.amount !== undefined) co.amount = round2(b.amount);
  return co;
}));
route('DELETE', '/api/projects/:id/change-orders/:coId', (p) => mutate(data => {
  const project = need(findProject(data, p.id), 404, 'House not found.');
  project.changeOrders = (project.changeOrders || []).filter(c => c.id !== p.coId);
  return { ok: true };
}));

/* Send a change order to STB Cobros: it appears there as an unsigned single-payment
   change order (30 days after signing), linked back by id so it cannot be sent twice. */
route('POST', '/api/projects/:id/change-orders/:coId/send-to-cobros', async (p) => {
  const data = await readData();
  const proj = need(findProject(data, p.id), 404, 'House not found.');
  const co = need((proj.changeOrders || []).find(c => c.id === p.coId), 404, 'Change order not found.');
  if (co.cobrosCoId) throw new HttpError(400, 'This change order was already sent to Cobros.');
  const cobrosId = newId('co');
  const code = codeOf(proj.name), fam = famOf(proj.name);
  const due = new Date(); due.setDate(due.getDate() + 30);
  const dueIso = due.getFullYear() + '-' + String(due.getMonth() + 1).padStart(2, '0') + '-' + String(due.getDate()).padStart(2, '0');
  await casSave(COBROS_ROW, obj => {
    const list = Array.isArray(obj.proyectos) ? obj.proyectos : [];
    const cp = list.find(x => famOf(x.familia) === fam && (!code || !x.numero || String(x.numero) === code));
    if (!cp) throw new HttpError(404, 'STB Cobros has no project for ' + proj.name + '. Create it there first, then send again.');
    cp.changeOrders = cp.changeOrders || [];
    cp.changeOrders.push({
      id: cobrosId, descripcion: co.description || ('Over the allowance on ' + co.categoryName),
      monto: round2(co.amount), fechaFirma: '', invoiceFile: '',
      plan: { tipo: 'una', plazoDias: 30 }, cuotas: [{ num: 1, fecha: dueIso, monto: round2(co.amount) }], pagos: [],
      creadoPor: 'Orders', creado: new Date().toISOString(), origen: 'orders', ordenesCoId: co.id
    });
  });
  await mutate(d => {
    const pr = findProject(d, p.id); const c = pr && (pr.changeOrders || []).find(x => x.id === p.coId);
    if (c) { c.status = 'sent'; c.cobrosCoId = cobrosId; c.sentAt = new Date().toISOString(); }
  });
  return { ok: true };
});

// ── Construction phase from the scheduling board ─────────────
// The board's phases (Pre Phase … Phase 6) are the same seven steps as PHASES,
// so a house's phase is simply its position in that list.
const BOARD_PHASES = ['Pre Phase', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6'];
let BOARD_CACHE = null;
async function readBoards() {
  if (BOARD_CACHE && Date.now() - BOARD_CACHE.t < 60000) return BOARD_CACHE.list;
  const list = [];
  for (const [id, area] of BOARD_ROWS) {
    let row = null; try { row = await readRow(id); } catch (e) {}
    if (row && Array.isArray(row.obj.projects)) row.obj.projects.forEach(p => list.push({
      id: p.id, name: p.name || '', code: String(p.code || ''), address: p.address || '', area,
      phase: Math.max(0, BOARD_PHASES.indexOf(p.phase || 'Pre Phase'))
    }));
  }
  BOARD_CACHE = { t: Date.now(), list };
  return list;
}
route('GET', '/api/reports-clients', async () => {
  const list = await readBoards();
  return {
    ok: list.length > 0,
    clients: list.map(b => ({ id: b.id, name: b.name + (b.area === 'alice' ? ' · Alice' : ''), address: b.address, phase: b.phase, progress: null, active: true }))
  };
});
route('POST', '/api/sync-phases', async () => {
  BOARD_CACHE = null;
  const boards = await readBoards();
  if (!boards.length) throw new HttpError(400, 'Could not read the scheduling board right now. Phases can still be set by hand.');
  const res = await mutate(data => {
    let changed = 0, linked = 0; const conflicts = [], unmatched = [];
    data.projects.forEach(p => {
      let b = p.reportsId ? boards.find(x => x.id === p.reportsId) : null;
      if (!b) {
        const code = codeOf(p.name), fam = famOf(p.name);
        const cand = code ? boards.filter(x => x.code === code || codeOf(x.name) === code) : [];
        const exact = cand.find(x => famOf(x.name) === fam) || (!code ? boards.find(x => famOf(x.name) === fam) : null);
        if (exact) { b = exact; p.reportsId = exact.id; linked++; }
        else if (cand.length) conflicts.push(p.name + ' is #' + code + ' here, but #' + code + ' on the board is ' + cand[0].name);
        else unmatched.push(p.name);
      }
      if (b && Number.isInteger(b.phase) && b.phase !== p.phase) { p.phase = b.phase; changed++; }
    });
    return { changed, linked, conflicts, unmatched };
  });
  return { ok: true, ...res };
});

// ── Reading the client's selections PDF, right in the browser ─
// Same rules as the old server (parseText above); only the way the text and the
// pictures are pulled out of the PDF changed: pdf.js instead of Node libraries.
let PDFJS = null;
async function loadPdfJs() {
  if (PDFJS) return PDFJS;
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'lib/pdf.min.js';
      s.onload = res; s.onerror = () => rej(new HttpError(400, 'Could not load the PDF reader. Check the connection and try again.'));
      document.head.appendChild(s);
    });
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  PDFJS = window.pdfjsLib;
  return PDFJS;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}
function pdfObj(page, id) {
  return new Promise(res => {
    const store = String(id).startsWith('g_') ? page.commonObjs : page.objs;
    const t = setTimeout(() => res(null), 8000);
    try { store.get(id, o => { clearTimeout(t); res(o); }); } catch (e) { clearTimeout(t); res(null); }
  });
}
// A decoded PDF image (raw pixels or a bitmap) → a compressed JPEG blob
async function pdfImageToBlob(img, minSide) {
  const w = img && img.width, h = img && img.height;
  if (!w || !h || (w < minSide && h < minSide)) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const id = ctx.createImageData(w, h), d = id.data, s = img.data, px = w * h;
    if (s.length === px * 4) d.set(s);
    else if (s.length === px * 3) { for (let i = 0, j = 0; i < px; i++) { d[j++] = s[i * 3]; d[j++] = s[i * 3 + 1]; d[j++] = s[i * 3 + 2]; d[j++] = 255; } }
    else if (s.length === px) { for (let i = 0, j = 0; i < px; i++) { d[j++] = s[i]; d[j++] = s[i]; d[j++] = s[i]; d[j++] = 255; } }
    else {                                             // 1-bit packed rows
      const rb = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = ((s[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1) ? 255 : 0, j = (y * w + x) * 4;
        d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
  } else return null;
  let out = c;
  const MAX = 1400;
  if (w > MAX || h > MAX) {
    const k = Math.min(MAX / w, MAX / h); out = document.createElement('canvas');
    out.width = Math.round(w * k); out.height = Math.round(h * k);
    out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
  }
  return new Promise(res => out.toBlob(b => res(b), 'image/jpeg', 0.85));
}
async function pdfPageImages(pdfjs, page, minSide) {
  const ops = await page.getOperatorList(), OPS = pdfjs.OPS, out = [], seen = new Set();
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]; let img = null;
    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
      const id = ops.argsArray[i][0];
      if (seen.has(id)) continue; seen.add(id);
      img = await pdfObj(page, id);
    } else if (fn === OPS.paintInlineImageXObject) img = ops.argsArray[i][0];
    if (!img) continue;
    let blob = null; try { blob = await pdfImageToBlob(img, minSide); } catch (e) {}
    if (blob) out.push(blob);
  }
  return out;
}
async function pdfPageTexts(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    pages.push(tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' '));
  }
  return pages;
}
async function readPdf(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const texts = [], byPage = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    let lastY, text = '';
    for (const it of tc.items) {                       // a new line whenever the vertical position changes
      if (lastY === it.transform[5] || !lastY) text += it.str; else text += '\n' + it.str;
      lastY = it.transform[5];
    }
    texts.push(text);
    let imgs = []; try { imgs = await pdfPageImages(pdfjs, page, 200); } catch (e) {}
    byPage.push({ page: n, images: imgs });
  }
  const parsed = parseText(texts.join('\n\n'));
  parsed.pages = doc.numPages;
  return { parsed, byPage };
}
route('POST', '/api/read-selections', async (_, fd) => {
  const file = fd.get('pdf');
  if (!file || !file.name) throw new HttpError(400, 'No PDF came through.');
  if (file.size > 40 * 1024 * 1024) throw new HttpError(400, 'That PDF is too big (40 MB max).');
  let parsed, byPage;
  try { ({ parsed, byPage } = await readPdf(file)); }
  catch (e) { throw new HttpError(400, 'Could not read that PDF: ' + (e.message || e)); }

  // Photos for each category come from the pages that category appears on (page 1 is the cover)
  const batch = newId('sel').replace('sel_', '');
  const jobs = [];
  Object.entries(parsed.categoryPages).forEach(([catId, pageNos]) => {
    let i = 0;
    pageNos.filter(n => n > 1).forEach(n => {
      const pg = byPage.find(p => p.page === n);
      (pg ? pg.images : []).forEach(blob => jobs.push({ catId, blob, n: ++i }));
    });
  });
  const photoUrls = {};
  await pool(jobs, 4, async j => {
    try {
      const url = await uploadFile('ordenes/selections/' + batch + '/' + j.catId + '-' + j.n + '.jpg', j.blob, 'image/jpeg');
      (photoUrls[j.catId] = photoUrls[j.catId] || []).push({ n: j.n, url });
    } catch (e) { /* one photo failing should not lose the rest */ }
  });
  Object.keys(photoUrls).forEach(k => { photoUrls[k] = photoUrls[k].sort((a, b) => a.n - b.n).map(x => x.url); });

  let fileUrl = '';
  try { fileUrl = await uploadFile('ordenes/selections/' + batch + '_' + cleanName(file.name), file, 'application/pdf'); } catch (e) {}
  if (!parsed.client && !parsed.address && !Object.keys(parsed.selections).length) {
    window.toast && window.toast('That PDF did not look like a selections package. Nothing was recognized.');
  }
  return { ok: true, ...parsed, photoUrls, fileUrl };
});

// ── Reading a signed contract (needs the read-contract function) ──
// Pages with real text go as text (lines rebuilt by position, so the filled-in blanks land
// next to their labels); photographed pages go as small JPEGs. The e-signature audit pages
// (emails, IP addresses) are never sent.
const CONTRACT_URL_LS = 'stbContractFnUrl', CONTRACT_TOKEN_LS = 'stbContractFnToken';
const READER_DEFAULT_URL = 'https://krpylhnklvhanmztkgnp.supabase.co/functions/v1/rapid-worker';
// Set up a computer from a link:  ordenes.html#reader=<contract key>   (read once, then removed from the address bar)
window.readerJustSet = false;
(function () {
  const m = (location.hash || '').match(/[#&]reader=([^&]+)/);
  if (!m) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  try { localStorage.setItem(CONTRACT_TOKEN_LS, decodeURIComponent(m[1]).trim()); localStorage.removeItem(CONTRACT_URL_LS); window.readerJustSet = true; } catch (e) {}
})();
function contractConfig() {
  let url = '', token = '';
  try { url = localStorage.getItem(CONTRACT_URL_LS) || ''; token = localStorage.getItem(CONTRACT_TOKEN_LS) || ''; } catch (e) {}
  return { url: url || READER_DEFAULT_URL, token };
}
function linesFromItems(items) {
  const rows = [];
  items.forEach(it => {
    if (!it.str || !it.str.trim()) return;
    const y = it.transform[5], x = it.transform[4];
    let row = rows.find(r => Math.abs(r.y - y) <= 6);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, str: it.str });
  });
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => r.parts.sort((a, b) => a.x - b.x).map(q => q.str).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
}
const AUDIT_PAGE = /Sent for signature to|Viewed by [^\n]*\(|IP:\s*\d+\.\d+\.\d+\.\d+|The document has been completed/i;
async function pageJpegBase64(page, width) {
  const v1 = page.getViewport({ scale: 1 }), scale = Math.min(2.5, width / v1.width), vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c.toDataURL('image/jpeg', 0.8).split(',')[1];
}
window.contractConfig = contractConfig; window.CONTRACT_URL_LS = CONTRACT_URL_LS; window.CONTRACT_TOKEN_LS = CONTRACT_TOKEN_LS;
window.readContractPdf = async function (file, catalog, step) {
  const cfg = contractConfig();
  if (!cfg.token) throw new HttpError(400, 'The contract reader is not set up on this computer yet. Open Settings and enter the contract key.');
  const say = step || (() => {});
  say('Opening the PDF…');
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = []; let skipped = 0, photos = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    say('Reading page ' + n + ' of ' + doc.numPages + '…');
    const page = await doc.getPage(n);
    const text = linesFromItems((await page.getTextContent()).items);
    if (AUDIT_PAGE.test(text)) { skipped++; continue; }
    if (text.replace(/\s/g, '').length >= 80) pages.push({ n, text });
    else { pages.push({ n, image: await pageJpegBase64(page, 1500) }); photos++; }
  }
  if (!pages.length) throw new HttpError(400, 'Nothing readable was found in that PDF.');
  say('Sending ' + pages.length + ' pages to be read' + (photos ? ' (' + photos + ' photographed)' : '') + '… this takes about a minute.');
  let res;
  try {
    res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stb-token': cfg.token }, body: JSON.stringify({ pages, catalog }) });
  } catch (e) { throw new HttpError(0, 'Could not reach the contract reader. Check the address in Settings and the connection.'); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.result) throw new HttpError(res.status, out.error || ('The contract reader answered ' + res.status + '.'));
  out.result.skippedPages = skipped;
  return out.result;
};

// ── Moving the data over from the old desktop tool (one time) ──
// Choose the old STB-Ordenes folder; its houses and photos are copied to the cloud.
window.importOldTool = async function (fileList, progress, replace) {
  const files = Array.from(fileList);
  const byRel = {};
  files.forEach(f => { byRel[(f.webkitRelativePath || f.name).replace(/\\/g, '/')] = f; });
  const jsonRel = Object.keys(byRel).find(k => /(^|\/)data\/orders\.json$/.test(k));
  if (!jsonRel) throw new HttpError(400, 'Choose the STB-Ordenes folder (the one with data/orders.json inside).');
  const root = jsonRel.slice(0, jsonRel.length - 'data/orders.json'.length);
  let old;
  try { old = JSON.parse(await byRel[jsonRel].text()); } catch (e) { throw new HttpError(400, 'orders.json could not be read.'); }
  old.config = old.config || {}; old.projects = Array.isArray(old.projects) ? old.projects : [];

  // Houses that are already in the cloud are skipped, and so are their photos (no re-uploading)
  const have = await readData();
  const isDup = p => have.projects.some(x => x.id === p.id || (x.name === p.name && (x.address || '') === (p.address || '')));
  const fresh = replace ? old.projects.slice() : old.projects.filter(p => !isDup(p));
  const refs = new Set();
  (function walk(n) {
    if (typeof n === 'string') { if (n.startsWith('/uploads/')) refs.add(n); }
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') Object.values(n).forEach(walk);
  })(fresh);

  const list = Array.from(refs), map = {}; let done = 0, missing = 0;
  await pool(list, 4, async url => {
    const f = byRel[root + url.replace(/^\//, '')];
    if (!f) missing++;
    else {
      try {
        let body = f, name = url.replace(/^\/uploads\//, '');
        let type = f.type || (/\.png$/i.test(url) ? 'image/png' : /\.jpe?g$/i.test(url) ? 'image/jpeg' : /\.pdf$/i.test(url) ? 'application/pdf' : 'application/octet-stream');
        if (isImageName(url) && f.size > 300 * 1024) { body = await compressImage(f); type = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
        map[url] = await uploadFile('ordenes/' + name.split('/').map(cleanName).join('/'), body, type);
      } catch (e) { missing++; }
    }
    done++; if (progress) progress(done, list.length);
  });

  // Point every reference at the new cloud address; drop the ones whose file was not in the folder
  const isUp = s => typeof s === 'string' && s.startsWith('/uploads/');
  (function clean(n) {
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) {
        if (isUp(n[i])) { if (map[n[i]]) n[i] = map[n[i]]; else n.splice(i, 1); } else clean(n[i]);
      }
    } else if (n && typeof n === 'object') {
      Object.keys(n).forEach(k => { if (isUp(n[k])) n[k] = map[n[k]] || ''; else clean(n[k]); });
    }
  })(fresh);

  const keyHash = old.config.key ? await keyHashOf(String(old.config.key)) : null;   // the key is stored hashed, never as text
  const result = await mutate(data => {
    let added = 0, skipped = 0;
    if (!data.config.keyHash && keyHash) data.config.keyHash = keyHash;
    if (old.config.warnPercent) data.config.warnPercent = Number(old.config.warnPercent) || data.config.warnPercent;
    if (Array.isArray(old.config.sequence) && (replace || !data.config.sequence)) data.config.sequence = old.config.sequence;   // her buying order
    ['pickupPlaces', 'garageName', 'pickupDay'].forEach(k => { if (old.config[k] !== undefined && (replace || data.config[k] === undefined)) data.config[k] = old.config[k]; });
    (old.config.customStores || []).forEach(s => {
      if (!data.config.customStores.some(x => x.id === s.id || String(x.name).toLowerCase() === String(s.name).toLowerCase())) data.config.customStores.push(s);
    });
    let replaced = 0;
    old.projects.forEach(p => {
      const at = data.projects.findIndex(x => x.id === p.id || (x.name === p.name && (x.address || '') === (p.address || '')));
      if (at >= 0 && !replace) { skipped++; return; }
      const prev = at >= 0 ? data.projects[at] : null;
      p.reportsId = prev ? (prev.reportsId || '') : '';   // keep a link to the board that was already made; otherwise "Sync phases" makes it
      if (prev) { data.projects[at] = p; replaced++; } else { data.projects.push(p); added++; }
    });
    return { added, skipped, replaced };
  });
  return { ...result, uploaded: list.length - missing, missing };
};

window.downloadOrdersBackup = async function () {
  const d = await readData();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
  a.download = 'stb-orders-backup-' + today() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
};


// ── The api() the screens call ───────────────────────────────
async function api(url, options) {
  options = options || {};
  const method = (options.method || 'GET').toUpperCase();
  const path = String(url).split('?')[0];
  let body = options.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const r = ROUTES.find(x => x.method === method && x.re.test(path));
  if (!r) throw new Error('Unknown request ' + method + ' ' + path);
  const m = path.match(r.re); const params = {};
  r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
  try { return await r.fn(params, body || {}); }
  catch (e) { window.toast && window.toast(e.message || 'Something went wrong'); throw e; }
}
window.api = api;

// ── Access gate + start ──────────────────────────────────────
async function currentKeyHash() {
  const d = await readData();
  return d.config.keyHash || await keyHashOf(DEFAULT_KEY);
}
async function gateOk() {
  let saved = ''; try { saved = localStorage.getItem(ACCESS_LS) || ''; } catch (e) {}
  return saved && saved === await currentKeyHash();
}
window.orderGate = async function (e) {
  e.preventDefault();
  const el = document.getElementById('gateKey');
  const h = await keyHashOf(el.value);
  if (h === await currentKeyHash()) {
    try { localStorage.setItem(ACCESS_LS, h); } catch (err) {}
    document.getElementById('gate').style.display = 'none';
    try { await upgradeIfNeeded(); } catch (err) {}
    await window.load(); if (window.readerJustSet) window.toast('✅ Contract reader is set up on this computer');
  } else {
    document.getElementById('gateErr').style.display = 'block'; el.value = ''; el.focus();
  }
};
window.bootOrders = async function () {
  try {
    if (await gateOk()) { document.getElementById('gate').style.display = 'none'; try { await upgradeIfNeeded(); } catch (err) {} await window.load(); if (window.readerJustSet) window.toast('✅ Contract reader is set up on this computer'); }
    else { document.getElementById('gate').style.display = 'flex'; document.getElementById('gateKey').focus(); }
  } catch (e) {
    document.getElementById('gateMsg').textContent = '⚠ Could not connect to the cloud. Check the internet and reload.';
    document.getElementById('gateMsg').style.display = 'block';
  }
};
// The driver's phone page uses the same key: ask once, remember on that phone
window.ordersAccess = {
  ok: async () => { try { return await gateOk(); } catch (e) { return false; } },
  tryKey: async key => {
    const h = await keyHashOf(key);
    if (h === await currentKeyHash()) { try { localStorage.setItem(ACCESS_LS, h); } catch (e) {} return true; }
    return false;
  }
};
window.orderSignOut = function () { try { localStorage.removeItem(ACCESS_LS); } catch (e) {} location.reload(); };

window.OrdersEngine = { parseText, readData, casSave, mutate, api, uploadFile, compressImage, CATEGORIES, PHASES, keyHashOf };
})();

