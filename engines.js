/* Romieaux — Live Slice scoring engines.
 *
 * Every dollar the Live Slice displays is produced here, against a named
 * baseline. No dollar figure comes from the LLM or from render code.
 *
 * Source of truth for formulas: Romieaux Module Algorithms.pdf (v1),
 * as amended by the founder's rulings recorded in AMENDMENTS below.
 *
 * Pure functions only — no DOM, no network, no globals beyond `Engines`.
 * Loads as a plain <script> (GitHub Pages, no build step) and under node
 * for the test suite.
 */
var Engines = (function () {
  'use strict';

  /* ---------------------------------------------------------------------
   * AMENDMENTS to the work order, ruled by the founder 2026-08-08
   *
   * A. Ledger Law gains two rows the PDF carries but the work order's §5
   *    table omitted, plus the schema fields to feed them:
   *      SAVES rate-timing     = flexible_rate_at_decision - locked_rate
   *      AVOIDED expediter     = expediter_quote - official_fee  (pet only)
   * B. Total Romieaux Value = Cash Savings + Time Value. Fees are a separate
   *    line and a return multiple — never subtracted from the headline.
   * C. Cash Savings = Intelligence Savings + Net Budget. Net Budget shows at
   *    $0 for a generated trip rather than being hidden.
   * D. Gates from the PDF that §5 dropped: transport direct-channel fires
   *    only at >= $5/ticket; AVOIDED FX only when a 0-FX card exists.
   * E. Reconciliation asserts both sum equality and row-count equality.
   * F. Engagement mode maps the existing 3-option canonical screen plus the
   *    free "I'll plan it" tier onto the PDF's 4 proactivity multipliers.
   * H. Mindset -> taste vector weights (see MINDSET_WEIGHTS), including the
   *    couples flip on `connect` and the kids family floor.
   * R. (2026-08-08, P4 addendum) The age and pet gates move to
   *    VERIFIED-OR-DROP and R SUPERSEDES their original keep-on-absent
   *    behaviour. An absent `pet_friendly` now fails on a pet trip; an absent
   *    `min_age_years` fails on a trip with kids wherever an age gate is
   *    plausible. All four hard filters (P, Q, R) now share one direction:
   *    unverified is removed. See the block above violatesAgeGate().
   * AL. (2026-09-07) The dietary predicate asks whether the VENUE SUITS THE
   *    NEED. See the block above violatesDietary().
   * AN. (2026-09-07) Every percentage row's `baseline` states BASE, RATE and
   *    RESULT, so a traveller can reproduce the figure from the row's own
   *    visible subline instead of only from the formula behind the tooltip.
   *    The two percentage-of-SPEND rows multiply DIFFERENT bases on purpose
   *    (§3: DCC-exposed spend is a documented subset of foreign spend at
   *    36-55%), and the DCC baseline now NAMES its parent, because the subset
   *    is the whole reason the two rows read as inconsistent to anyone who
   *    divides. Vocabulary is the canonical corpus's own: `card spend` and
   *    `eligible`. avoidedDcc() takes the foreign spend as a SECOND argument
   *    for naming only; it takes no part in the arithmetic.
   *
   *    AN ALSO PUT THIS FILE INSIDE THE TRAVELLER CORPUS. Labels, formulas
   *    and baselines are rendered verbatim, so `harness.js` §20.5/§20.6 now
   *    lex this file too: no em dash and no banned developer term in a
   *    rendered literal. The one reconciliation-verdict em dash below is
   *    ruling AH's named exemption. See `harness.js` §22.
   *
   * Engine-input-only fields — the generation schema must NOT ask the model
   * for these, and the model never supplies them:
   *   card_scenario      EARNS rows. The Blueprint captures no card facts, so
   *                      in Live Slice v1 these rows are simply omitted (§5:
   *                      omit rather than invent). Reserved for future use.
   *   net_budget_usd     Fixed at 0 for a generated trip (no actuals exist).
   *   fees_usd           Fixed at 0 for a generated trip.
   *   decisions_automated Derived from countable engine work at P4.
   * ------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------
   * Constants — every threshold and rate the PDF names, in one place.
   * ------------------------------------------------------------------- */

  var TASTE_DIMS = ['romantic', 'adventurous', 'cultural', 'restful', 'family', 'luxury'];

  // PDF rule 11: pace profile sets max scheduled hours/day.
  var PACE_HOURS = { slow: 5, moderate: 7, full: 9 };

  // PDF shared constants: engagement-mode proactivity multiplier P.
  // Ruling F maps the canonical onboarding's three paid tiers plus the free
  // "I'll plan it" tier onto these, so no canonical screen changes.
  var ENGAGEMENT_P = { essential: 0.25, lightly: 0.5, curated: 1.0, concierge: 1.3 };

  // PDF shared constants: IdentityFit bands.
  var FIT_SUPPRESS = 35;   // below this, never rendered at all
  var FIT_RECOMMEND = 60;  // above this, recommendable; between, "alternative"

  // PDF shared constants: alert gating.
  var ALERT_THRESHOLD = 40;

  // PDF Payment Checklist: AVOIDED FX / DCC rates.
  var FX_FEE_RATE = 0.03;
  var DCC_MARKUP_RATE = 0.035;

  // PDF shared constants: 12-min DIY baseline per decision.
  var MINUTES_PER_DECISION = 12;

  // Work order §5: ROAMquality is stubbed until ROAM exists.
  var ROAM_QUALITY_STUB = 70;

  // PDF rule 13 / rule 19 / rule 17: intervention gates.
  var ADVANCE_DISCOUNT_MIN = 0.08;          // d% >= 8%
  var PASS_ARBITRAGE_FACTOR = 0.9;          // rides x fare > pass x 0.9
  var DIRECT_CHANNEL_MIN_PER_TICKET = 5;    // ruling D: >= $5/ticket

  // PDF rule 2: direct-below-portal bonus caps at +15.
  var CHANNEL_ADVANTAGE_MAX = 15;

  // PDF shared constants: points valuation. Displayed only when a card
  // scenario is supplied; never invented (work order §5).
  var POINTS_BASELINE_CENTS = 1.5;
  var POINTS_CROSS_PROGRAM_CENTS = 1.0;

  var FLEXIBILITY_SCORE = { free: 100, partial: 50, prepaid: 0 };

  /* ---------------------------------------------------------------------
   * Numeric hygiene
   *
   * Work order §4: "If the model omits a field, default it to a value that
   * produces zero attribution (never a fabricated saving)." Every read of
   * untrusted JSON goes through num().
   * ------------------------------------------------------------------- */

  function num(value, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback === undefined ? 0 : fallback;
    return n;
  }

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }

  /* Money is rounded to whole dollars at the moment a ledger row is created,
   * and the headline is the sum of those already-rounded rows. This is what
   * makes ruling E's equality exact rather than approximate — summing raw
   * cents and rounding the total can disagree with the sum of rounded rows
   * (17.50 + 17.50 -> 35, but 18 + 18 -> 36). Rows are the source of truth. */
  function roundMoney(n) {
    return Math.round(num(n, 0));
  }

  /* ---------------------------------------------------------------------
   * Taste vector — ruling H
   *
   * Each selected mindset contributes its weights; the vector is normalized
   * to unit length at the end so cosine similarity is well-defined.
   * ------------------------------------------------------------------- */

  var MINDSET_WEIGHTS = {
    slow:      { restful: 1.0 },
    adventure: { adventurous: 1.0 },
    cultural:  { cultural: 1.0 },
    indulgent: { luxury: 1.0 },
    celebrate: { romantic: 0.6, luxury: 0.4 },
    purpose:   { restful: 0.6, cultural: 0.4 },
    connect:   { family: 0.7, romantic: 0.3 }   // flipped for couples, see below
  };

  /* `connect` is the one context-dependent mindset: travelling as a couple
   * with no kids along flips its emphasis from family to romantic. */
  var CONNECT_COUPLE_WEIGHTS = { romantic: 0.7, family: 0.3 };

  /* Kids on the trip force a family floor after normalization. */
  var KIDS_FAMILY_FLOOR = 0.8;

  /* Trip intent re-weighting. The PDF says IdentityFit is "re-weighted by
   * trip intent" but publishes no weights; the ruled convention is a
   * half-unit boost to the trip type's own dimension, applied before
   * normalization. Keys match the prototype's existing ttk() vocabulary so no
   * canonical mapping code changes. */
  var TRIP_TYPE_BOOST = {
    romantic:   { romantic: 0.5 },
    honeymoon:  { romantic: 0.5 },
    reset:      { restful: 0.5 },
    cultural:   { cultural: 0.5 },
    friends:    { adventurous: 0.25, cultural: 0.25 },
    milestone:  { romantic: 0.3, luxury: 0.2 },
    adventure:  { adventurous: 0.5 },
    workcation: { restful: 0.3, cultural: 0.2 },
    family:     { family: 0.5 }
  };

  function zeroVector() {
    var v = {};
    for (var i = 0; i < TASTE_DIMS.length; i++) v[TASTE_DIMS[i]] = 0;
    return v;
  }

  function addWeights(vector, weights) {
    if (!weights) return;
    for (var dim in weights) {
      if (Object.prototype.hasOwnProperty.call(weights, dim) && vector[dim] !== undefined) {
        vector[dim] += num(weights[dim], 0);
      }
    }
  }

  function normalize(vector) {
    var sumSquares = 0, i, dim;
    for (i = 0; i < TASTE_DIMS.length; i++) sumSquares += Math.pow(vector[TASTE_DIMS[i]], 2);
    var magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) return vector;
    var out = {};
    for (i = 0; i < TASTE_DIMS.length; i++) {
      dim = TASTE_DIMS[i];
      out[dim] = vector[dim] / magnitude;
    }
    return out;
  }

  function hasKidsOnTrip(bp) {
    return ((bp && bp.kid_ages_months) || []).length > 0;
  }

  /* §3 travel_mode is "Just Me / With My Partner / With a Group"; the
   * prototype's own group vocabulary uses 'partner'. Accept either. */
  function isCoupleMode(bp) {
    var mode = String((bp && bp.travel_mode) || '').toLowerCase();
    return mode.indexOf('partner') !== -1 || mode === 'couple';
  }

  function mindsetWeights(key, bp) {
    if (key === 'connect' && isCoupleMode(bp) && !hasKidsOnTrip(bp)) {
      return CONNECT_COUPLE_WEIGHTS;
    }
    return MINDSET_WEIGHTS[key];
  }

  /* buildTasteVector(blueprint) -> vector over TASTE_DIMS.
   *
   * Ruling H: each selected mindset adds its weights; trip intent adds its
   * half-unit boost; normalize; then, if kids are on the trip, force
   * family >= 0.8. The kids floor is applied after normalization, so the
   * result is not strictly unit length — which is harmless, because cosine
   * similarity is scale-invariant.
   *
   * blueprint.mindset         : array of mindset keys (multi-select)
   * blueprint.trip_type       : single trip-type key
   * blueprint.travel_mode     : party context (flips `connect` for couples)
   * blueprint.kid_ages_months : ages, non-empty when kids are along
   */
  function buildTasteVector(blueprint) {
    var bp = blueprint || {};
    var vector = zeroVector();
    var mindset = bp.mindset || [];
    for (var i = 0; i < mindset.length; i++) {
      addWeights(vector, mindsetWeights(mindset[i], bp));
    }
    addWeights(vector, TRIP_TYPE_BOOST[bp.trip_type]);

    var normalized = normalize(vector);

    if (hasKidsOnTrip(bp) && normalized.family < KIDS_FAMILY_FLOOR) {
      normalized.family = KIDS_FAMILY_FLOOR;
    }
    return normalized;
  }

  /* Cosine similarity over TASTE_DIMS. Both vectors are non-negative, so the
   * result lands in [0,1] and scales cleanly to the PDF's [0,100] band. */
  function cosineSimilarity(a, b) {
    var dot = 0, magA = 0, magB = 0, i, dim, x, y;
    for (i = 0; i < TASTE_DIMS.length; i++) {
      dim = TASTE_DIMS[i];
      x = num(a && a[dim], 0);
      y = num(b && b[dim], 0);
      dot += x * y;
      magA += x * x;
      magB += y * y;
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  /* identityFit(item, tasteVector) -> [0,100].
   * A missing or empty attributes vector yields 0, which suppresses the item
   * rather than inventing a fit for it. */
  function identityFit(item, tasteVector) {
    var attrs = (item && item.attributes) || {};
    return clamp(cosineSimilarity(attrs, tasteVector) * 100, 0, 100);
  }

  function fitBand(fit) {
    if (fit < FIT_SUPPRESS) return 'suppress';
    if (fit <= FIT_RECOMMEND) return 'alternative';
    return 'recommend';
  }

  /* ---------------------------------------------------------------------
   * Stays score — PDF rules 1-3
   *
   * S = 0.35*IdentityFit + 0.25*LocationTimeCost + 0.20*PriceValue
   *   + 0.10*Flexibility + 0.10*ROAMquality
   * ------------------------------------------------------------------- */

  function locationTimeCost(commuteMinutes) {
    return 100 - Math.min(100, num(commuteMinutes, 0) * 1.5);
  }

  function priceValue(rate, areaMedian, directRate, portalRate) {
    var r = num(rate, 0);
    var median = num(areaMedian, 0);
    var overage = median > 0 ? Math.max(0, (r - median) / median) : 0;
    var base = 100 - 50 * overage;

    // PDF rule 2: "direct rate below portal rate adds up to +15".
    // Scaled by how much cheaper direct is, relative to the portal rate.
    var direct = num(directRate, 0);
    var portal = num(portalRate, 0);
    var bonus = 0;
    if (portal > 0 && direct > 0 && direct < portal) {
      bonus = clamp(((portal - direct) / portal) * 100, 0, CHANNEL_ADVANTAGE_MAX);
    }
    return clamp(base + bonus, 0, 100);
  }

  function flexibilityScore(flexibility) {
    var score = FLEXIBILITY_SCORE[flexibility];
    return score === undefined ? 0 : score;
  }

  /* staysScore(stay, ctx) -> { score, components }
   * Components are returned so the UI can show the commute math rather than
   * hiding it (PDF Stays guardrail: "commute math shown, not hidden"). */
  function staysScore(stay, ctx) {
    var s = stay || {};
    var context = ctx || {};
    var fit = context.identityFit !== undefined
      ? clamp(num(context.identityFit, 0), 0, 100)
      : identityFit(s, context.tasteVector);

    var components = {
      identityFit: fit,
      locationTimeCost: locationTimeCost(s.commute_min_to_anchors),
      priceValue: priceValue(
        s.nightly_direct_usd,
        s.area_median_rate_usd,
        s.nightly_direct_usd,
        s.nightly_portal_usd
      ),
      flexibility: flexibilityScore(s.flexibility),
      roamQuality: context.roamQuality === undefined ? ROAM_QUALITY_STUB : num(context.roamQuality, ROAM_QUALITY_STUB)
    };

    var score = 0.35 * components.identityFit
      + 0.25 * components.locationTimeCost
      + 0.20 * components.priceValue
      + 0.10 * components.flexibility
      + 0.10 * components.roamQuality;

    return { score: clamp(score, 0, 100), components: components };
  }

  /* ---------------------------------------------------------------------
   * ExperienceROI and day packing — PDF rule 11
   * ------------------------------------------------------------------- */

  /* weatherFit defaults to 1.0. A weather-sensitive item with no forecast
   * supplied is not penalised — the engine never invents a forecast. */
  function experienceROI(item, ctx) {
    var it = item || {};
    var context = ctx || {};
    var fit = context.identityFit !== undefined
      ? clamp(num(context.identityFit, 0), 0, 100)
      : identityFit(it, context.tasteVector);

    var durationHours = num(it.duration_hours, 0);
    var transitHours = num(it.transit_min_from_prev, 0) / 60;
    var hourlyRate = num(context.hourlyRate, 0);
    var weatherFit = context.weatherFit === undefined ? 1 : clamp(num(context.weatherFit, 1), 0, 1);

    var denominator = num(it.est_price_usd, 0) + (durationHours + transitHours) * hourlyRate;
    if (denominator <= 0) return 0;
    return (fit * durationHours * weatherFit) / denominator;
  }

  /* Greedy day packing: highest ROI first, respecting the pace energy budget.
   * Scheduled hours count duration plus transit, matching rule 11's
   * "max scheduled hours/day". */
  function packDay(items, ctx) {
    var context = ctx || {};
    var budget = PACE_HOURS[context.pace];
    if (budget === undefined) budget = PACE_HOURS.moderate;

    var ranked = (items || []).map(function (item) {
      return { item: item, roi: experienceROI(item, context) };
    }).sort(function (a, b) { return b.roi - a.roi; });

    var scheduled = [], skipped = [], used = 0;
    for (var i = 0; i < ranked.length; i++) {
      var entry = ranked[i];
      var cost = num(entry.item.duration_hours, 0) + num(entry.item.transit_min_from_prev, 0) / 60;
      if (used + cost <= budget) {
        scheduled.push(entry.item);
        used += cost;
      } else {
        skipped.push(entry.item);
      }
    }
    return { scheduled: scheduled, skipped: skipped, hoursUsed: used, energyBudget: budget };
  }

  /* ---------------------------------------------------------------------
   * Alert gating — PDF shared constants
   * ------------------------------------------------------------------- */

  function proactivityMultiplier(engagementMode) {
    var p = ENGAGEMENT_P[engagementMode];
    return p === undefined ? ENGAGEMENT_P.curated : p;
  }

  /* "Any alert with urgency U (0-100) fires when U x P >= 40; safety-class
   * alerts ignore P and always fire." */
  function alertFires(urgency, engagementMode, isSafetyClass) {
    if (isSafetyClass) return true;
    return num(urgency, 0) * proactivityMultiplier(engagementMode) >= ALERT_THRESHOLD;
  }

  /* ---------------------------------------------------------------------
   * Ledger Law — every SAVES / EARNS / AVOIDED figure the demo can show.
   *
   * Each detector returns a row or null. Null means the gate did not fire;
   * a gate that does not fire produces no row at all, never a $0 padding row
   * (work order §7: "never pad").
   * ------------------------------------------------------------------- */

  /* RULING AN — the baseline is a SENTENCE A TRAVELLER CAN CHECK.
   *
   * `formula` and `baseline` are both rendered verbatim: `formula` behind the
   * tooltip trigger, `baseline` on the row's own visible subline
   * (`liveslice-ledger.js` cashBlock(), `liveslice-results.js`
   * interventionTooltip()). The founder read two rows off that subline, did
   * the division, and got two different spend bases with nothing on screen to
   * say why — because the base reached the page ONLY inside the formula, as
   * the raw schema field name.
   *
   * So every percentage row's baseline now states BASE, RATE and RESULT. The
   * two are deliberately different registers and that is not an oversight:
   *
   *   formula   the mechanical trace, in the schema's own terms. Work order
   *             §6 asks for it and AK ruled it class (c) keep.
   *   baseline  the traveller's sentence. Reproducible with a calculator.
   *
   * The result printed in a baseline is the ROUNDED amount, computed once and
   * handed to both this function and the string, so the sentence can never
   * disagree with the figure beside it. `row()` re-rounds, which is
   * idempotent.
   *
   * NOTE FOR WHOEVER EDITS A STRING HERE: since ruling AN this file is inside
   * the §20.5/§20.6 traveller corpus. An em dash or a banned developer term in
   * a label or a baseline fails `harness.js` §20. */
  function usd(n) {
    return '$' + roundMoney(n).toLocaleString('en-US');
  }

  function row(kind, label, amount, formula, baseline, inputs) {
    var rounded = roundMoney(amount);
    if (rounded <= 0) return null;
    return {
      kind: kind,               // 'SAVES' | 'AVOIDED' | 'EARNS'
      label: label,
      amount: rounded,
      formula: formula,         // shown in the traceability tooltip
      baseline: baseline,       // the named baseline the figure is measured against
      inputs: inputs || {}
    };
  }

  /* SAVES direct-vs-portal (stay) = (portal - direct) x nights */
  function savesStayDirectVsPortal(stay) {
    var s = stay || {};
    var portal = num(s.nightly_portal_usd, 0);
    var direct = num(s.nightly_direct_usd, 0);
    var nights = num(s.nights, 0);
    if (portal <= 0 || direct <= 0 || nights <= 0 || direct >= portal) return null;
    return row(
      'SAVES',
      'Direct booking vs portal rate' + (s.name ? ' (' + s.name + ')' : ''),
      (portal - direct) * nights,
      '(portal_rate − direct_rate) × nights = ($' + portal + ' − $' + direct + ') × ' + nights,
      'Portal nightly rate $' + portal,
      { portal: portal, direct: direct, nights: nights }
    );
  }

  /* SAVES rate-timing = flexible_rate_at_decision - locked_rate  (ruling A) */
  function savesRateTiming(stay) {
    var s = stay || {};
    var flexible = num(s.flexible_rate_at_decision_usd, 0);
    var locked = num(s.locked_rate_usd, 0);
    if (flexible <= 0 || locked <= 0 || locked >= flexible) return null;
    return row(
      'SAVES',
      'Rate locked before the flexible rate climbed' + (s.name ? ' (' + s.name + ')' : ''),
      flexible - locked,
      'flexible_rate_at_decision − locked_rate = $' + flexible + ' − $' + locked,
      'Flexible rate at decision time $' + flexible,
      { flexible: flexible, locked: locked }
    );
  }

  /* SAVES direct-channel (transport) = (portal - direct) x tickets
   * Ruling D gate: only when direct is cheaper by >= $5/ticket. */
  function savesTransportDirectChannel(segment) {
    var seg = segment || {};
    var portal = num(seg.portal_usd, 0);
    var direct = num(seg.direct_usd, 0);
    var tickets = num(seg.tickets, 0);
    if (portal <= 0 || direct <= 0 || tickets <= 0) return null;
    var perTicket = portal - direct;
    if (perTicket < DIRECT_CHANNEL_MIN_PER_TICKET) return null;
    return row(
      'SAVES',
      'Operator-direct vs portal fare' + (seg.name ? ' (' + seg.name + ')' : ''),
      perTicket * tickets,
      '(portal − direct) × tickets = ($' + portal + ' − $' + direct + ') × ' + tickets,
      'Portal fare $' + portal + '/ticket',
      { portal: portal, direct: direct, tickets: tickets, perTicket: perTicket }
    );
  }

  /* SAVES pass arbitrage = sum(singles) - pass_price
   * Gate: planned_rides x single_fare > pass_price x 0.9 */
  function savesPassArbitrage(segment) {
    var seg = segment || {};
    var rides = num(seg.planned_rides, 0);
    var fare = num(seg.single_fare_usd, 0);
    var pass = num(seg.pass_price_usd, 0);
    if (rides <= 0 || fare <= 0 || pass <= 0) return null;
    var singles = rides * fare;
    if (!(singles > pass * PASS_ARBITRAGE_FACTOR)) return null;
    if (singles <= pass) return null;
    /* RULING AN: the subline carried the singles side only, so a traveller
     * could see $18 × 6 rides and $13 saved and had no way to reach the $95
     * that closes the arithmetic. It was in the formula and nowhere else. */
    var passSaved = roundMoney(singles - pass);
    return row(
      'SAVES',
      'Day-pass vs single fares' + (seg.name ? ' (' + seg.name + ')' : ''),
      passSaved,
      'Σ singles − pass_price = (' + rides + ' × $' + fare + ') − $' + pass,
      'Single fares ' + usd(fare) + ' × ' + rides + ' rides = ' + usd(singles) +
        ', less the ' + usd(pass) + ' Day-pass = ' + usd(passSaved),
      { rides: rides, fare: fare, pass: pass, singles: singles }
    );
  }

  /* SAVES advance-purchase = list x d% x tickets, only if d >= 8% */
  function savesAdvancePurchase(item, tickets) {
    var it = item || {};
    var list = num(it.est_price_usd, 0);
    var discount = num(it.advance_discount_pct, 0);
    // Accept either 0.10 or 10 as "10%".
    if (discount > 1) discount = discount / 100;
    var count = num(tickets, 1);
    if (list <= 0 || count <= 0 || discount < ADVANCE_DISCOUNT_MIN) return null;
    // RULING AN: the base was already named here; the rate and the result were not.
    var advSaved = roundMoney(list * discount * count);
    return row(
      'SAVES',
      'Advance-purchase discount' + (it.name ? ' (' + it.name + ')' : ''),
      advSaved,
      'list × d% × tickets = $' + list + ' × ' + (discount * 100).toFixed(0) + '% × ' + count,
      'List price ' + usd(list) + ' at ' + (discount * 100).toFixed(0) + '% off × ' +
        count + (count === 1 ? ' ticket = ' : ' tickets = ') + usd(advSaved),
      { list: list, discount: discount, tickets: count }
    );
  }

  /* AVOIDED platform fees (dining) = fee_rate x covers x price */
  function avoidedPlatformFees(item, covers) {
    var it = item || {};
    var channel = it.alt_channel || {};
    var feeRate = num(channel.fee_rate, 0);
    if (feeRate > 1) feeRate = feeRate / 100;
    var price = num(it.est_price_usd, 0);
    var count = num(covers, 0);
    if (channel.type !== 'platform' || feeRate <= 0 || price <= 0 || count <= 0) return null;
    // RULING AN: the rate was named, the price it applies to was not.
    var platSaved = roundMoney(feeRate * count * price);
    return row(
      'AVOIDED',
      'Booking platform per-cover fee' + (it.name ? ' (' + it.name + ')' : ''),
      platSaved,
      'fee_rate × covers × price = ' + (feeRate * 100).toFixed(0) + '% × ' + count + ' × $' + price,
      'Platform channel at ' + (feeRate * 100).toFixed(0) + '% of ' + usd(price) + ' × ' +
        count + (count === 1 ? ' cover = ' : ' covers = ') + usd(platSaved),
      { feeRate: feeRate, covers: count, price: price }
    );
  }

  /* AVOIDED FX = foreign_spend x 3%
   * Ruling D gate: only when the traveler holds a 0-FX card.
   *
   * RULING AN: this row and avoidedDcc() below are the two percentage-of-SPEND
   * rows, and they multiply DIFFERENT bases on purpose (§3). The baseline says
   * which base, in the canonical corpus's own words — the seven shipped trips
   * already read `FX fees avoided (~$2,800 group spend)`. */
  function avoidedFxFees(foreignSpendUsd, hasNoFxCard) {
    var spend = num(foreignSpendUsd, 0);
    if (spend <= 0 || !hasNoFxCard) return null;
    var fxSaved = roundMoney(spend * FX_FEE_RATE);
    return row(
      'AVOIDED',
      'Foreign transaction fees',
      fxSaved,
      'foreign_spend × 3% = $' + spend + ' × 3%',
      'Wrong-card FX fee at 3% of ' + usd(spend) + ' in card spend = ' + usd(fxSaved),
      { spend: spend, rate: FX_FEE_RATE }
    );
  }

  /* AVOIDED DCC = exposed_spend x 3.5%
   *
   * `dcc_exposed_spend_usd` is a schema field the model estimates, distinct
   * from and smaller than total foreign spend — across the canonical corpus
   * it runs 36-55% of it (Iceland $500 of $1,400; Amalfi $900 of $1,800;
   * Rio $1,500 of $2,800). The P3 prompt must say so explicitly.
   *
   * Note the rate: the work order pins 3.5% and the PDF's bullet says 3-4%,
   * but the canonical corpus actually varies (3.0% Amalfi, 3.6% Iceland,
   * 3.75% Lisbon, 4.5% Paris and Tulum). This engine uses the pinned 3.5%,
   * so it reproduces Iceland exactly but not every canonical DCC row. FX, by
   * contrast, is uniformly 3.0% across all seven trips and matches exactly.
   *
   * RULING AN — THE BASELINE NAMES ITS PARENT, because the subset is the whole
   * reason the two payment rows look inconsistent to anyone who divides. The
   * canonical corpus's word for this quantity is `eligible`
   * (`DCC declined (~$900 eligible)`), so that is the word used rather than a
   * new one.
   *
   * `foreignSpendUsd` is passed only so the sentence can name the parent. It
   * takes no part in the arithmetic, and when it is absent or not larger than
   * the exposed spend the clause is simply omitted rather than guessed at —
   * the strict-subset check in liveslice-scoring.js is what guarantees the two
   * are distinct before either row is built. */
  function avoidedDcc(exposedSpendUsd, foreignSpendUsd) {
    var spend = num(exposedSpendUsd, 0);
    if (spend <= 0) return null;
    var foreign = num(foreignSpendUsd, 0);
    var dccSaved = roundMoney(spend * DCC_MARKUP_RATE);
    var ofWhich = foreign > spend ? ', part of ' + usd(foreign) + ' in card spend' : '';
    return row(
      'AVOIDED',
      'Dynamic currency conversion declined',
      dccSaved,
      'exposed_spend × 3.5% = $' + spend + ' × 3.5%',
      'DCC markup at 3.5% of ' + usd(spend) + ' eligible' + ofWhich + ' = ' + usd(dccSaved),
      { spend: spend, rate: DCC_MARKUP_RATE, foreignSpend: foreign }
    );
  }

  /* AVOIDED expediter = expediter_quote - official_fee  (ruling A, pet only) */
  function avoidedExpediterFees(petPaperwork, hasPet) {
    var pp = petPaperwork || {};
    var quote = num(pp.expediter_quote_usd, 0);
    var official = num(pp.official_fee_usd, 0);
    if (!hasPet || quote <= 0 || official <= 0 || official >= quote) return null;
    return row(
      'AVOIDED',
      'Pet paperwork filed through official channel',
      quote - official,
      'expediter_quote − official_fee = $' + quote + ' − $' + official,
      'Expediter quote $' + quote,
      { quote: quote, official: official }
    );
  }

  /* ---------------------------------------------------------------------
   * Hours and time value
   * ------------------------------------------------------------------- */

  function hoursSaved(decisions) {
    return num(decisions, 0) * MINUTES_PER_DECISION / 60;
  }

  function timeValue(hours, hourlyRate) {
    return roundMoney(num(hours, 0) * num(hourlyRate, 0));
  }

  /* ---------------------------------------------------------------------
   * Points valuation
   *
   * Work order §5: displayed only if a card scenario is included, otherwise
   * the EARNS rows are omitted entirely rather than invented.
   * ------------------------------------------------------------------- */

  function earnsPointsValue(points, centsPerPoint, label) {
    var pts = num(points, 0);
    var cents = num(centsPerPoint, POINTS_BASELINE_CENTS);
    if (pts <= 0 || cents <= 0) return null;
    return row(
      'EARNS',
      label || 'Points earned on this booking',
      pts * cents / 100,
      'points × ¢/pt = ' + pts + ' × ' + cents + '¢',
      cents === POINTS_BASELINE_CENTS
        ? 'Baseline cash-out at ' + POINTS_BASELINE_CENTS + '¢/pt'
        : 'Cross-program transfer at ' + cents + '¢/pt',
      { points: pts, centsPerPoint: cents }
    );
  }

  /* ---------------------------------------------------------------------
   * Hard-constraint predicates — work order §7
   *
   * Belt and suspenders: the prompt instructs the model to honour these, and
   * these predicates drop anything that slipped through. An option failing a
   * hard predicate is removed, never rendered crossed-out (PDF rule 41).
   * ------------------------------------------------------------------- */

  /* RULING AL — the dietary predicate asks whether the VENUE SUITS THE NEED.
   *
   * SUPERSEDES ruling AJ's `contains` intersection, which superseded ruling
   * P's substring scan over name + notes + tags. TWO reversals in one chain,
   * and they reversed different things: P ruled the substrate, AJ replaced the
   * substrate and KEPT P's question, AL replaces the question. Recorded as an
   * amendment in RULINGS §5 with the argument as evidence.
   *
   * WHY AJ HAD TO GO, and it is not the defect AJ itself fixed. AJ's move onto
   * a structured claim was right and survives. What did not survive is what
   * the claim was ABOUT. A venue's food CONTAINING meat is not what a
   * vegetarian needs to know:
   *
   *   - an honest model marks nearly every Italian restaurant
   *     `contains ["meat","fish"]`, because they do serve them, and AJ's
   *     intersection removes every one of them for a vegetarian. The trip
   *     hollows out again, by a different route than P's;
   *   - a "vegetarian-friendly ristorante" is exactly the venue a vegetarian
   *     wants and exactly the venue AJ deletes if the model tells the truth;
   *   - AJ's live test passed because the model happened to emit `[]` on
   *     vegetarian-leaning venues — a SUITABILITY answer in an INGREDIENT
   *     field. AJ's own prompt asked for it in those words. The field and the
   *     instruction had already diverged; AL closes the gap by moving the
   *     field to where the instruction was.
   *
   * THE PREDICATE INVERTS WITH THE FIELD. AJ asked "does the claim MEET the
   * restriction anywhere" — an INTERSECTION. AL asks "does the claim COVER
   * every stated need" — a SUBSET TEST. That is why the two cannot share a
   * field, and why `contains` is replaced rather than reinterpreted.
   *
   * VERIFIED-OR-DROP IS NOT RELAXED, and AJ's scoping is kept verbatim. The
   * two arms below are the whole of the rule:
   *
   *   1. NOT `module === 'dining'` -> never evaluated for diet. AJ's module
   *      scoping, unchanged, and still the thing that stops the cure
   *      recreating the disease: a boat, a museum and a train can never be
   *      removed by a food filter, whether they state anything or not. The
   *      BOOKED STAY is non-dining too and therefore leaves this predicate
   *      entirely under ruling AL item 6 — a narrowing of AJ item 5, because
   *      a hotel with no restaurant honestly emits `suits: []` and a subset
   *      test would refuse the booking. Refusing every such hotel on every
   *      restricted trip is the hollowing-out failure at the worst possible
   *      place, which is AJ item 5's own sentence.
   *   2. dining -> removed unless EVERY stated need appears in `suits`.
   *      Absence of the field is the empty claim, so a dining item that says
   *      nothing is removed — AJ option (i), unchanged, moved onto the new
   *      field. `suits: []` is an affirmative "suits none of these" and is
   *      removed for the same reason, which is the one place the inversion
   *      changes what an empty array MEANS: under `contains` it was the safe
   *      value, under `suits` it is the unsafe one.
   *
   * NOTE what is NOT here. AJ item 4's family-token rule is RETIRED, and
   * DIETARY_FAMILIES with it. It existed because `contains:["crab"]` was an
   * unintelligible ingredient claim — `crab` sat inside the 51-token
   * vocabulary and outside the vegetarian preset, so intersection alone let it
   * through. `suits` is TEN FLAT NEED LABELS with no family/specific
   * structure, so there is no specific that could arrive without its family
   * and nothing for the rule to bite on. It is deleted rather than left
   * looking like coverage — ruling AH's precedent, and AJ's own removal of its
   * unreachable self-reference guard.
   *
   * The declared/absent distinction still survives validation, because
   * `cleanItem()` always emits an array and stamps `_suits_declared`, exactly
   * as rulings S and U stamp `_accessibility_declared`. It is retained for the
   * TRAVELLER'S WORDING rather than for the verdict — both dispositions remove
   * the item, and §5f requires the traveller be told which it was. On a raw
   * object that never met the validator the presence of the array is the
   * signal instead, so this predicate behaves correctly whether it is handed
   * pipeline output or a hand-built fixture. */

  function suitsTokens(item) {
    var raw = Object.prototype.toString.call(item && item.suits) === '[object Array]'
      ? item.suits : [];
    var tokens = [];
    for (var i = 0; i < raw.length; i++) {
      var t = String(raw[i] === null || raw[i] === undefined ? '' : raw[i])
        .trim().toLowerCase();
      if (t && tokens.indexOf(t) === -1) tokens.push(t);
    }
    return tokens;
  }

  function violatesDietary(item, dietaryNeeds) {
    var needs = dietaryNeeds || [];
    if (!needs.length) return false;                 // nothing declared: never runs

    var it = item || {};

    // Arm 1 — module scoping. Non-dining is never evaluated for diet.
    if (it.module !== 'dining') return false;

    // Arm 2 — every stated need must be present in the claim.
    var tokens = suitsTokens(it);
    for (var i = 0; i < needs.length; i++) {
      var need = String(needs[i] || '').trim().toLowerCase();
      if (need && tokens.indexOf(need) === -1) return true;
    }
    return false;
  }

  function violatesAccessibility(item, accessibilityNeeds) {
    var needs = accessibilityNeeds || [];
    if (!needs.length) return false;
    var provided = (item && item.accessibility) || {};
    for (var i = 0; i < needs.length; i++) {
      if (provided[needs[i]] !== true) return true;
    }
    return false;
  }

  /* RULING R — verified-or-drop, for the age and pet gates too.
   *
   * SUPERSEDES the original keep-on-absent behaviour of both predicates.
   * Until R, a missing `min_age_years` or `pet_friendly` meant "keep", so a
   * model that simply omitted the field walked an age-restricted bar past a
   * four-year-old. Rulings P and Q had already put the dietary and
   * accessibility predicates on the opposite footing — unverified means
   * removed — and R aligns all four.
   *
   * Both changes are scoped so they only ever fire where the traveller has
   * declared the constraint: a trip with no kids never reaches the age gate,
   * and a trip with no pet never reaches the pet gate. Nothing about a
   * childless, petless trip changes.
   *
   * The age gate carries one extra limiter, and it is load-bearing. §4 tells
   * the model to supply `min_age_years` only "when it has one", so a compliant
   * model omits it on every all-ages venue. Treating every absence as failing
   * would therefore delete every museum and family restaurant on exactly the
   * trips that have children. So absence fails only where an age gate is
   * PLAUSIBLE — where the venue's own name, notes or tags mark it as
   * age-restricted. A declared value always wins; the signal test below runs
   * only when the field is missing entirely.
   */
  var AGE_GATE_SIGNALS = [
    'bar', 'pub', 'nightclub', 'nightlife', 'brewery', 'distillery', 'winery',
    'wine tasting', 'tasting room', 'cocktail', 'speakeasy', 'casino', 'cigar',
    'adults only', 'adults-only', '18\\+', '21\\+', 'burlesque'
  ];

  /* Word-boundary matched. An age-gate signal is a venue CATEGORY, and a
   * substring 'bar' would remove "Barcelona walking tour" from every family
   * trip. This comment used to draw the contrast with violatesDietary()'s
   * deliberate substring over-removal; RULING AJ removed that scan and RULING
   * AL removed the whole notion of a term that must not appear, so the
   * contrast is gone and only the rule for THIS predicate remains. The age
   * gate is untouched by either amendment. */
  function hasAgeGateSignal(item) {
    var haystack = [item && item.name, item && item.notes]
      .concat((item && item.tags) || []).join(' ').toLowerCase();
    for (var i = 0; i < AGE_GATE_SIGNALS.length; i++) {
      if (new RegExp('(^|[^a-z0-9])' + AGE_GATE_SIGNALS[i] + '([^a-z0-9]|$)').test(haystack)) {
        return true;
      }
    }
    return false;
  }

  function violatesAgeGate(item, kidAgesMonths) {
    var ages = kidAgesMonths || [];
    if (!ages.length) return false;                    // no kids: never runs

    var declared = item ? item.min_age_years : undefined;
    if (declared === undefined || declared === null || declared === '') {
      return hasAgeGateSignal(item);                   // ruling R
    }

    var minAgeYears = num(declared, 0);
    if (minAgeYears <= 0) return false;                // verified all-ages
    for (var i = 0; i < ages.length; i++) {
      if (num(ages[i], 0) / 12 < minAgeYears) return true;
    }
    return false;
  }

  /* Ruling R: on a pet trip every venue must be VERIFIED to accept the pet.
   * `true` is the only value that keeps an option; `false` and absent both
   * remove it. No plausibility limiter here — unlike an age minimum, which
   * most venues genuinely do not have, pet acceptance is a fact about every
   * venue on the itinerary, and §4 asks the model to state it on each one. */
  function violatesPetConstraint(item, hasPet) {
    if (!hasPet) return false;                         // no pet: never runs
    return !item || item.pet_friendly !== true;
  }

  /* applyHardFilters(items, blueprint) -> { kept, removed }
   * `removed` carries the reason so P4 can log every post-filter drop to the
   * console for QA, as §7 requires. */
  function applyHardFilters(items, blueprint) {
    var bp = blueprint || {};
    var kept = [], removed = [];
    (items || []).forEach(function (item) {
      var reason = null;
      if (violatesDietary(item, bp.dietary_needs)) reason = 'dietary hard line';
      else if (violatesAccessibility(item, bp.accessibility_needs)) reason = 'accessibility predicate';
      else if (violatesAgeGate(item, bp.kid_ages_months)) reason = 'kids age gate';
      else if (violatesPetConstraint(item, bp.has_pet)) reason = 'pet constraint';
      if (reason) removed.push({ item: item, reason: reason });
      else kept.push(item);
    });
    return { kept: kept, removed: removed };
  }

  /* ---------------------------------------------------------------------
   * Ledger assembly and reconciliation
   * ------------------------------------------------------------------- */

  /* buildLedger(trip, blueprint) -> the complete value framework.
   *
   * Rulings B and C shape the totals:
   *   Cash Savings          = Intelligence Savings + Net Budget
   *   Total Romieaux Value  = Cash Savings + Time Value      (fees NOT subtracted)
   *   Fees                  = separate line + return multiple
   */
  function buildLedger(trip, blueprint) {
    var t = trip || {};
    var bp = blueprint || {};
    var rows = [];

    function push(r) { if (r) rows.push(r); }

    // Stay-level interventions
    push(savesStayDirectVsPortal(t.stay));
    push(savesRateTiming(t.stay));

    // Transport-level interventions
    (t.transport_segments || []).forEach(function (seg) {
      push(savesTransportDirectChannel(seg));
      push(savesPassArbitrage(seg));
    });

    // Item-level interventions
    (t.days || []).forEach(function (day) {
      (day.items || []).forEach(function (item) {
        if (item && item.module === 'activities') {
          push(savesAdvancePurchase(item, num(item.tickets, bp.party_size || 1)));
        }
        if (item && item.module === 'dining') {
          push(avoidedPlatformFees(item, num(item.covers, bp.party_size || 1)));
        }
      });
    });

    // Payment-level interventions
    push(avoidedFxFees(t.foreign_card_spend_estimate_usd, bp.has_no_fx_card !== false));
    // RULING AN: the DCC row is handed the foreign spend so its baseline can
    // name the quantity it is a part of. It is a naming input, not a term.
    push(avoidedDcc(t.dcc_exposed_spend_usd, t.foreign_card_spend_estimate_usd));
    push(avoidedExpediterFees(t.pet_paperwork, !!bp.has_pet));

    // EARNS — engine-input-only. `card_scenario` is deliberately absent from
    // the generation schema: the model never populates it, and the Blueprint
    // captures no card facts. In Live Slice v1 this loop therefore does
    // nothing and the EARNS rows are omitted entirely rather than invented
    // (§5). Kept wired so a future card-aware Blueprint can feed it.
    (t.card_scenario || []).forEach(function (earn) {
      push(earnsPointsValue(earn.points, earn.cents_per_point, earn.label));
    });

    // Cash Savings = Intelligence Savings + Net Budget  (ruling C)
    //
    // Intelligence Savings is the sum of ALL rows — SAVES, AVOIDED and EARNS
    // alike. EARNS is a row kind with its own badge, not a separate framework
    // line: the canonical Iceland card's $968 includes its two card-earn rows
    // ($95 Capital One 10×, $63 Sapphire 4×) and counts them among its "9
    // interventions". Tulum behaves the same way.
    var intelligenceSavings = rows.reduce(function (sum, r) { return sum + r.amount; }, 0);
    // A generated demo trip has no actuals, so Net Budget is $0 — shown, not hidden.
    var netBudget = roundMoney(t.net_budget_usd);
    var cashSavings = intelligenceSavings + netBudget;

    // Time. Decisions and interventions are different quantities (canonical
    // Iceland: 47 decisions, 9 interventions). With no decision count supplied
    // we fall back to the intervention count — a conservative floor, since
    // each intervention took at least one decision — rather than inventing a
    // larger number that would inflate Time Value.
    var decisions = num(t.decisions_automated, rows.length);
    var hours = hoursSaved(decisions);
    var hourlyRate = num(bp.hourly_rate, 50);
    var timeVal = timeValue(hours, hourlyRate);

    // Fees: separate line, never subtracted (ruling B). $0 for a demo trip.
    var fees = roundMoney(t.fees_usd);
    var totalRomieauxValue = cashSavings + timeVal;

    return {
      rows: rows,
      // What the headline advertises: "$X saved across N interventions".
      interventionCount: rows.length,
      intelligenceSavings: intelligenceSavings,
      netBudget: netBudget,
      cashSavings: cashSavings,
      decisions: decisions,
      hoursSaved: Math.round(hours),
      hoursSavedExact: hours,
      hourlyRate: hourlyRate,
      timeValue: timeVal,
      fees: fees,
      returnMultiple: fees > 0 ? totalRomieauxValue / fees : null,
      totalRomieauxValue: totalRomieauxValue,
      isEmpty: rows.length === 0
    };
  }

  /* reconcile(ledger, rendered) -> { ok, sumOk, countOk, ... }   (ruling E)
   *
   * Asserts BOTH, exactly as the canonical trips already satisfy:
   *   headline dollar figure === sum of tooltip rows
   *   advertised intervention count === tooltip row count
   * (Verified against the shipped data: every canonical tooltip sums to its
   * headline, and the Paris card's "10 interventions" matches its 10 rows.)
   *
   * `rendered` is what the render code is about to put on screen — pass it so
   * this catches drift between the engine and the DOM, which is the whole
   * point of a render-time assertion. Omit it for a pure self-consistency
   * check of the ledger object.
   */
  function reconcile(ledger, rendered) {
    var l = ledger || {};
    var r = rendered || {};
    // Every row counts, EARNS included — that is the canonical convention
    // (Iceland's $968 headline contains its $95 and $63 card-earn rows, and
    // its advertised "9 interventions" counts them).
    var rows = (l.rows || []).slice();

    var rowSum = rows.reduce(function (acc, x) { return acc + x.amount; }, 0);
    var rowCount = rows.length;

    var headline = r.headline === undefined ? l.intelligenceSavings : num(r.headline, NaN);
    var count = r.count === undefined ? l.interventionCount : num(r.count, NaN);

    var sumOk = headline === rowSum;
    var countOk = count === rowCount;

    return {
      ok: sumOk && countOk,
      sumOk: sumOk,
      countOk: countOk,
      headline: headline,
      rowSum: rowSum,
      advertisedCount: count,
      rowCount: rowCount,
      message: sumOk && countOk
        ? 'Live Slice ledger reconciled: $' + rowSum + ' across ' + rowCount + ' interventions.'
        : 'Live Slice ledger FAILED reconciliation — ' +
          (sumOk ? '' : 'headline $' + headline + ' vs row sum $' + rowSum + '; ') +
          (countOk ? '' : 'advertised ' + count + ' interventions vs ' + rowCount + ' rows.')
    };
  }

  /* ---------------------------------------------------------------------
   * Public surface
   * ------------------------------------------------------------------- */

  return {
    // constants
    TASTE_DIMS: TASTE_DIMS,
    PACE_HOURS: PACE_HOURS,
    ENGAGEMENT_P: ENGAGEMENT_P,
    FIT_SUPPRESS: FIT_SUPPRESS,
    FIT_RECOMMEND: FIT_RECOMMEND,
    ALERT_THRESHOLD: ALERT_THRESHOLD,
    FX_FEE_RATE: FX_FEE_RATE,
    DCC_MARKUP_RATE: DCC_MARKUP_RATE,
    MINUTES_PER_DECISION: MINUTES_PER_DECISION,
    ROAM_QUALITY_STUB: ROAM_QUALITY_STUB,
    POINTS_BASELINE_CENTS: POINTS_BASELINE_CENTS,
    POINTS_CROSS_PROGRAM_CENTS: POINTS_CROSS_PROGRAM_CENTS,
    MINDSET_WEIGHTS: MINDSET_WEIGHTS,
    CONNECT_COUPLE_WEIGHTS: CONNECT_COUPLE_WEIGHTS,
    KIDS_FAMILY_FLOOR: KIDS_FAMILY_FLOOR,
    TRIP_TYPE_BOOST: TRIP_TYPE_BOOST,

    // identity
    buildTasteVector: buildTasteVector,
    cosineSimilarity: cosineSimilarity,
    identityFit: identityFit,
    fitBand: fitBand,

    // stays
    locationTimeCost: locationTimeCost,
    priceValue: priceValue,
    flexibilityScore: flexibilityScore,
    staysScore: staysScore,

    // activities
    experienceROI: experienceROI,
    packDay: packDay,

    // alerts
    proactivityMultiplier: proactivityMultiplier,
    alertFires: alertFires,

    // ledger law
    savesStayDirectVsPortal: savesStayDirectVsPortal,
    savesRateTiming: savesRateTiming,
    savesTransportDirectChannel: savesTransportDirectChannel,
    savesPassArbitrage: savesPassArbitrage,
    savesAdvancePurchase: savesAdvancePurchase,
    avoidedPlatformFees: avoidedPlatformFees,
    avoidedFxFees: avoidedFxFees,
    avoidedDcc: avoidedDcc,
    avoidedExpediterFees: avoidedExpediterFees,
    earnsPointsValue: earnsPointsValue,
    hoursSaved: hoursSaved,
    timeValue: timeValue,
    buildLedger: buildLedger,
    reconcile: reconcile,

    // guardrails
    violatesDietary: violatesDietary,
    violatesAccessibility: violatesAccessibility,
    violatesAgeGate: violatesAgeGate,
    violatesPetConstraint: violatesPetConstraint,
    applyHardFilters: applyHardFilters,

    // internals exposed for tests
    _num: num,
    _roundMoney: roundMoney
  };
})();

/* No-op in the browser; lets the test suite run under node without a build step. */
if (typeof module !== 'undefined' && module.exports) { module.exports = Engines; }
