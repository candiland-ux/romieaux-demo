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
   * AP. (2026-09-07) THE DAY HAS MEAL SLOTS AND CLOCK TIMES, and AP
   *    SUPERSEDES packDay()'s single-ranking behaviour.
   *
   *    The PDF specifies TWO ranking algorithms in two structures, and this
   *    file implemented one of them and applied it to both. Rule 11 is the
   *    ACTIVITIES module: ExperienceROI, ranked descending, packed against
   *    the pace budget. Rule 6 is the DINING module: `For each meal slot`,
   *    ranked by 0.5*IdentityFit + 0.2*BudgetFit + 0.2*ROAMsignal +
   *    0.1*Novelty. Work order §5 carried rule 11 and DROPPED rule 6, so
   *    packDay() ranked meals by the Activities formula and charged them to
   *    the Activities budget. Because ExperienceROI divides by price, and a
   *    meal is the one item that always has one, meals lost every day:
   *    a FREE rest block at fit 50 cannot be beaten by any $95 dinner at any
   *    fit up to 100. Work order §5 is amended; see RULINGS.md AP.
   *
   *    - Meals are placed FIRST, in MEAL_WINDOWS, and are OUTSIDE the pace
   *      budget. `hoursUsed` stays the pace-consuming figure so the OVER
   *      BUDGET signal ruling AM item 1 moved to the console keeps its
   *      meaning; `mealHours` is reported beside it.
   *    - Two meals claiming one slot are decided by REDUCED RULE 6, which is
   *      IdentityFit ALONE. BudgetFit, ROAMsignal and Novelty have no source
   *      in this bundle and are NOT approximated - see §5a for the route back
   *      to each. Approximating one would put a Romieaux-chosen number under
   *      a scheduling decision, which is ruling AN's rejected reading (iii).
   *    - Activities keep RULE 11 UNCHANGED, by founder ruling. The provisional
   *      fit tie-break was withdrawn on the trace: the fault was never a tie.
   *    - Every scheduled item gets a start and an end. DAY_START opens the
   *      day and each next item starts at the previous end plus its transit.
   *    - A meal never competes with a rest block for anything, so there is no
   *      rest-block vocabulary to invent. Rulings AJ and AL both refused an
   *      invented taxonomy on this reasoning.
   *
   * AR. (2026-09-07) THE FLOOR DECIDES WHICH CANDIDATE HOLDS A MEAL SLOT,
   *    NEVER WHETHER THE SLOT IS FILLED. AR SUPERSEDES the unconditional use
   *    of fitBand() as a gate. See bandFor() below.
   *
   *    This is AP's defect one layer down. AP found that work order §5 carried
   *    rule 11 and dropped rule 6, so packDay() charged meals to the
   *    ACTIVITIES pace budget. AP fixed the budget half. The SUPPRESSION half
   *    survived, because work order §7 states the floor globally - "No item
   *    below IdentityFit 35 is rendered as a recommendation" - and nobody
   *    re-read rule 6 against it. PDF rule 6 is a RANK WITHIN A SLOT and
   *    names NO suppression step, and a rank cannot leave a slot empty. So
   *    the Activities module's GATE stayed applied to a module the PDF ranks
   *    by a different formula, exactly as its BUDGET had.
   *
   *    Traced against a real cached generation, not a fixture: a Kyoto trip
   *    for a traveller whose one mindset chip made the taste vector one-hot
   *    cultural. Of 55 candidates 16 were suppressed, 12 of them dining, 12
   *    carrying a meal slot, and TEN OF THOSE TWELVE WERE THE SAME HOTEL
   *    BREAKFAST at fit 18 on ten different days:
   *
   *      {romantic .1, adventurous 0, cultural .1, restful .4, family .2,
   *       luxury .3}   ->  cultural .1 over a norm of .56  ->  fit 18
   *
   *    A hotel breakfast is not a cultural experience and the model correctly
   *    said so. THE INPUT IS NOT WRONG; THE RULE APPLIED TO IT IS. Eleven of
   *    eleven days had no breakfast. Scoping the floor takes the removal rate
   *    from 29.1% to 7.3% and puts breakfast back on ten days.
   *
   *    - FIT_SUPPRESS STAYS 35 and governs activities under rule 11 UNCHANGED.
   *      Work order §7's sentence is SCOPED, not amended, on AP's precedent.
   *    - fitBand() is BYTE-UNCHANGED. It is the PDF's band function over a
   *      number, tests.js locks all four of its boundaries, and AR has no
   *      quarrel with it. What AR adds is bandFor(), which knows which
   *      module's rule reaches the item.
   *    - There is NO SUPPRESS TIER FOR A MEAL SLOT, because rule 6 has none.
   *      A meal slot's band is drawn from {recommend, alternative}, which the
   *      shipped badge vocabulary already covers, so AR adds no traveller
   *      string. Without this, liveslice-results.js's BAND_BADGE - which has
   *      no `suppress` key - would have fallen back to `Alternative` SILENTLY
   *      on a path AR made reachable for the first time. Ruling AI's class.
   *    - TRANSPORTATION IS NOT IN SCOPE, and it is a separate phase rather
   *      than an oversight. PDF rule 16 gives Transportation its own ranking,
   *      0.35*CostFit + 0.30*TimeFit + 0.15*ComfortFit + 0.10*CO2Fit +
   *      0.10*Reliability, and IdentityFit appears NOWHERE in it - so work
   *      order §5 dropped rule 16 as well, the third algorithm it lost. But a
   *      bus has no slot and no rank, so there is nothing for `which
   *      candidate` to attach to, and unsuppressing one would put it into
   *      rule 11's budget with no rule 16 behind it. See RULINGS.md §5a.
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
  //
  // RULING AP. This is the ACTIVITIES budget and nothing else. PDF rule 11
  // names it inside the Activities module; the Dining module has its own
  // envelope (rule 6's daily_food_envelope) and its own slots. Meals do not
  // spend it. The prompt says so too - `liveslice-api.js` scopes the pace
  // sentence to activities, which is what stops the model squeezing meals out
  // in the request and the packer squeezing them out again afterwards.
  var PACE_HOURS = { slow: 5, moderate: 7, full: 9 };

  /* RULING AP ruling 4 — INVENTED CONVENTIONS OF RECORD (RULINGS.md §5c).
   *
   * The PDF's support for meal SLOTS is explicit and its support for meal
   * TIMES is thinner, and the difference is stated rather than blurred: rule
   * 6's "that slot's anchor" is GEOGRAPHIC ("shortlist by geography, <=15 min
   * from that slot's anchor"), and the only temporal meal rule in the
   * document is 94, "Meal windows locked to home meal-times +/-45 min",
   * scoped to under-8s in the Family module. So the times below are OURS.
   *
   * They join IMPLAUSIBLE_RATE, WELLNESS_TAGS, AGE_GATE_SIGNALS, the
   * coordinated-trip rule and DEFAULT_LEAD_DAYS as invented conventions, and
   * like all five they ATTRIBUTE NO DOLLAR: they shape the schedule, never a
   * ledger row, so the Ledger Law is untouched.
   *
   * Named MEAL_WINDOWS and not MEAL_ANCHORS for RULING I's reason: "anchor"
   * already means the geographic one inside rule 6, and "window" is the PDF's
   * own word for a time range in rule 94. Two meanings for one word inside
   * one module is the collision ruling I exists to stop.
   *
   * DERIVATION, so none of these reads as a preference:
   *   DAY_START            founder ruling, AP Gate 0 (ii).
   *   breakfast.earliest   IS DAY_START. One value, not two, so the day's
   *                        opening and breakfast's window cannot drift apart.
   *   breakfast.latest     the outer edge of a hotel breakfast service, and
   *                        the latest the word still means breakfast.
   *   lunch                14:30 because the canonical corpus is
   *                        Mediterranean-weighted - Amalfi, Lisbon, Paris,
   *                        Rio - where a 14:00 lunch is ordinary.
   *   dinner               DERIVED FROM SHIPPED CANONICAL CONTENT:
   *                        index.html:1438 "the anniversary dinner snuck in
   *                        at 8:00" and index.html:793 "a dinner reservation
   *                        at golden hour". 20:00 sits inside the window.
   *                        Ruling AM took the badge word off the intake
   *                        labels and ruling AN took the subline vocabulary
   *                        off the canonical corpus by the same method.
   */
  var DAY_START = '08:00';
  var MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
  var MEAL_WINDOWS = {
    breakfast: { earliest: DAY_START, latest: '10:00' },
    lunch:     { earliest: '12:00',   latest: '14:30' },
    dinner:    { earliest: '19:00',   latest: '21:00' }
  };

  /* RULING AS ruling 1 — THE DAY WINDOW, and it is an INVENTED CONVENTION OF
   * RECORD in the same family as MEAL_WINDOWS above (RULINGS.md §5c).
   *
   * The TIMES are model output: `trip.arrival_time` and `trip.departure_time`.
   * The RULE that reads them is ours - nothing is placed before the arrival
   * leg ends on the arrival day, and nothing after the departure leg begins on
   * the departure day - and like DAY_START, MEAL_WINDOWS, IMPLAUSIBLE_RATE,
   * WELLNESS_TAGS, AGE_GATE_SIGNALS, the coordinated-trip rule and
   * DEFAULT_LEAD_DAYS it ATTRIBUTES NO DOLLAR. It shapes the schedule, never a
   * ledger row, so the Ledger Law is untouched.
   *
   * ABSENCE MEANS DAY_START TO END OF DAY, AS BEFORE AS, NEVER ASSUMED. That
   * is ruling 1's own wording and the verified-or-drop direction rulings P, Q,
   * R, U, AJ, AL, AN and AP all share, on a tenth field: a trip that states no
   * arrival time is packed exactly as it was packed yesterday. */
  var TRIP_LEGS = ['arrival', 'departure'];

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

  /* The PDF's band function over a NUMBER, and nothing else. It knows the two
   * thresholds and does not know what kind of item it is looking at. RULING AR
   * leaves it byte-unchanged deliberately: tests.js locks all four of its
   * boundaries, the PDF owns it, and AR's quarrel is with where it was USED as
   * a gate, not with what it computes. */
  function fitBand(fit) {
    if (fit < FIT_SUPPRESS) return 'suppress';
    if (fit <= FIT_RECOMMEND) return 'alternative';
    return 'recommend';
  }

  /* bandFor(item, fit) -> the band under the rule that actually governs the
   * item. RULING AR.
   *
   * PDF rule 11 gives Activities three tiers and the bottom one is a gate:
   * below FIT_SUPPRESS an item is never rendered. PDF rule 6 gives Dining a
   * RANK WITHIN A MEAL SLOT and names no suppression step at all, so a meal
   * slot has two outcomes - held, or not held - and which one is decided by
   * REDUCED RULE 6 in packDay(), never by the floor.
   *
   * So: a meal slot cannot return 'suppress'. Everything else is fitBand().
   *
   * THIS IS THE WHOLE OF AR IN ONE FUNCTION, and it is one function on purpose
   * - the packer and the scoring pipeline read ONE definition of which rule
   * reaches an item, on the same reasoning ruling AJ gave for deriving the
   * dietary vocabulary in one place: two definitions are two definitions that
   * drift apart.
   *
   * A meal slot at fit 18 therefore renders as an `alternative`, which is what
   * it is: shown, and not a strong match. It is not padding and it is not a
   * substitution - §5f is untouched - because the model offered exactly this
   * item for exactly this slot and Romieaux is not putting anything in its
   * place. It is the traveller's breakfast. */
  function bandFor(item, fit) {
    var band = fitBand(fit);
    if (band === 'suppress' && mealSlot(item) !== null) return 'alternative';
    return band;
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

  /* ---------------------------------------------------------------------
   * Clock arithmetic. Minutes since midnight, so a day is a number line and
   * nothing depends on a Date object or a timezone — the schedule is local
   * wall-clock by construction, which is what PDF rule 39 asks for and what
   * a static bundle with no timezone data can honestly provide.
   * ------------------------------------------------------------------- */

  function minutesOf(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function clockOf(minutes) {
    var t = Math.round(num(minutes, 0));
    // A day that runs past midnight keeps counting rather than wrapping to a
    // smaller number, which would make an end time read as before its start.
    var h = Math.floor(t / 60), m = t - h * 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* RULING AP. A meal is a dining item that declared which slot it fills.
   * `module` alone is not enough: a cooking class and a gelato stop are both
   * dining and neither is a meal, which is why AP asks the model for the slot
   * rather than inferring one. An undeclared dining item is not a meal and is
   * packed as an ordinary candidate — it is never GUESSED into a slot. */
  function mealSlot(item) {
    var it = item || {};
    if (it.module !== 'dining') return null;
    return MEAL_SLOTS.indexOf(it.meal) === -1 ? null : it.meal;
  }

  /* RULING AS. Which leg of the trip a transportation item is, if it is one.
   *
   * The same shape as mealSlot() one letter earlier, and for the same reason:
   * `module` alone cannot tell an airport transfer from a local train, and the
   * ONLY other signal the model emits is the item's NAME. Reading a leg out of
   * "Airport limousine bus KIX to Kyoto Station" would be ruling AL's mistake a
   * third time - a field asked one question and answered with another - and it
   * would fail SILENTLY on every airport code a pattern does not know. So AS
   * asks for the leg and never infers one.
   *
   * Scoped to transportation the way mealSlot() is scoped to dining. A museum
   * is not an arrival, whatever it declares. */
  function legOf(item) {
    var it = item || {};
    if (it.module !== 'transportation') return null;
    return TRIP_LEGS.indexOf(it.leg) === -1 ? null : it.leg;
  }

  /* RULING AS. Is this a transport item the packer ANCHORS rather than ranks?
   *
   * Every transportation item is anchored, legs included. Ruling 2 reads the
   * model's own day order as the intended sequence for transport, so a
   * transport item never competes on ExperienceROI for a position - it takes
   * the position its own itinerary already gave it. It still SPENDS the pace
   * budget, which is rule 11's arithmetic and is deliberately unchanged. */
  function isTransport(item) {
    return !!item && item.module === 'transportation';
  }

  /* Greedy day packing — PDF rule 11 for activities, PDF rule 6 for meals.
   *
   * RULING AP SUPERSEDES the single-ranking version of this function. It
   * ranked EVERY module by ExperienceROI and charged EVERY module to the pace
   * budget, which is rule 11 applied to a module rule 11 does not govern. See
   * the AP block in the AMENDMENTS header for why that emptied the day of
   * meals, and RULINGS.md AP for the trace.
   *
   * Three things happen here, in this order, and the order is the ruling:
   *
   *   1. MEALS ARE PLACED FIRST, in MEAL_WINDOWS, OUTSIDE the pace budget.
   *      Two meals claiming one slot are decided by REDUCED RULE 6 — which is
   *      IdentityFit ALONE, by founder ruling, because BudgetFit, ROAMsignal
   *      and Novelty have no source in this bundle and approximating one
   *      would put a Romieaux-chosen number under a scheduling decision.
   *   2. EVERYTHING ELSE RANKS BY ExperienceROI — rule 11, UNCHANGED.
   *   3. The day is walked from DAY_START and each item gets a start and an
   *      end. An activity that would overrun the next meal's window is HELD
   *      BACK rather than pushing the meal out of it.
   *
   * A meal therefore never competes with a rest block for anything, so ruling
   * 4's "a meal outranks a rest block" holds BY CONSTRUCTION and no
   * rest-block vocabulary has to be invented to enforce it.
   */
  function packDay(items, ctx) {
    var context = ctx || {};
    var budget = PACE_HOURS[context.pace];
    if (budget === undefined) budget = PACE_HOURS.moderate;

    var fitOf = function (item) {
      return context.identityFit !== undefined
        ? clamp(num(context.identityFit, 0), 0, 100)
        : identityFit(item, context.tasteVector);
    };
    var costOf = function (item) {
      return num(item.duration_hours, 0) + num(item.transit_min_from_prev, 0) / 60;
    };

    var all = (items || []).slice();

    /* RULING AS. THE MODEL'S OWN DAY ORDER, captured before anything reorders
     * it. Before AS this array's order survived NOWHERE in this function: it
     * was split, ROI-sorted and walked, and a control that reversed it
     * produced a byte-identical schedule. Ruling 2 makes it the intended
     * sequence for transport, so it has to be read before it is lost. */
    var modelIndex = {};
    all.forEach(function (item, i) { if (item && item.id) modelIndex[item.id] = i; });

    /* (1) Meals into slots. Reduced rule 6: IdentityFit alone. A loser does
     * not vanish — it rejoins the ordinary pool and competes on rule 11 like
     * any other candidate, which is what keeps a second good restaurant on
     * the day instead of deleting it for arriving second.
     *
     * RULING AS: a leg is transportation, so mealSlot() already returns null
     * for it and no extra guard is needed here. Stated rather than left to be
     * rediscovered — a guard that cannot fire is the thing rulings AH, AJ and
     * AR each removed rather than leave looking like coverage. */
    var claimed = {}, rest = [];
    all.forEach(function (item) {
      var slot = mealSlot(item);
      if (!slot) { rest.push(item); return; }
      var held = claimed[slot];
      if (!held) { claimed[slot] = item; return; }
      if (fitOf(item) > fitOf(held)) { claimed[slot] = item; rest.push(held); }
      else rest.push(item);
    });

    /* RULING AS ruling 2 + ruling 3 — THE ATTACHMENTS, and this is the layer
     * that did not exist.
     *
     * An attachment binds one item to another and says which side of it to
     * sit on. Two rules build the map, and neither invents an order: both read
     * something the model already stated.
     *
     *   TRANSPORT (ruling 2) is bound to the next NON-TRANSPORT item after it
     *   in the model's own day order, on the `before` side. A transport item
     *   with no non-transport item after it is a RETURN LEG, and is bound to
     *   the last non-transport item BEFORE it, on the `after` side. Those are
     *   ruling 2's two sentences, in that order.
     *
     *   AN INCLUDED ITEM (ruling 3) is bound to the parent its own
     *   `included_with` names, on the `after` side, and its start is the
     *   parent's end. `included_with: "stay"` names no item on this day, so it
     *   resolves to nothing, no attachment is made, and the meal goes to its
     *   window exactly as it did before AS — which is ruling 3's own wording.
     *
     * Ruling 3 wins where both could apply, because a stated parent is a
     * stronger claim than a positional inference: the model said THIS item
     * comes with THAT one. */
    var byId = {};
    all.forEach(function (item) { if (item && item.id) byId[item.id] = item; });

    var attach = {};
    all.forEach(function (item, i) {
      /* A LEG IS EXCLUDED HERE, and the exclusion is load-bearing rather than
       * tidy: a leg is transportation, so without it the arrival bus would be
       * bound "before breakfast" by the positional rule and then placed a
       * second time by ruling 1's own anchor. Ruling 1 owns the legs; ruling 2
       * owns every other transport item. */
      if (!item || !item.id || !isTransport(item) || legOf(item) !== null) return;

      /* Ruling 2's two sentences, and the SECOND one is the hard half.
       *
       *   "placed immediately before the next non-transport item in the
       *    model's own day order"                                  — forward
       *   "and its return leg immediately after the last item it serves"
       *                                                            — backward
       *
       * WHAT MAKES A RETURN LEG A RETURN LEG is the question, and adjacency
       * alone cannot answer it: on `breakfast, train-out, temple, train-back,
       * lunch` the train back is immediately followed by a non-transport item
       * exactly as the train out is, so a forward-only rule binds it before
       * LUNCH and the packer then runs lunch ahead of the temple. That was the
       * first build, and §26.3 caught it: the day came out `breakfast,
       * train-back, lunch, train-out, temple` — a return from a place the
       * traveller had not been to yet.
       *
       * The answer is in the ruling's own words. "The last item it serves" is
       * the thing it brings them back FROM, and the thing it brings them back
       * from is the thing they were TAKEN to. So:
       *
       *   A TRANSPORT ITEM IS A RETURN LEG WHEN THE NON-TRANSPORT ITEM BEFORE
       *   IT WAS ITSELF REACHED BY TRANSPORT.
       *
       * The train back follows the temple because the temple was reached by
       * the train out. A single transfer with nothing but a meal behind it is
       * not a return, and binds forward. No pairing table, no vocabulary, no
       * inference from a name — one look at the model's own order. */
      var j, prevNonTransport = -1;
      for (j = i - 1; j >= 0; j--) {
        if (!isTransport(all[j])) { prevNonTransport = j; break; }
      }
      var isReturn = prevNonTransport > 0 && isTransport(all[prevNonTransport - 1]);

      var target = null, side = 'before';
      if (!isReturn) {
        for (j = i + 1; j < all.length; j++) {
          if (!isTransport(all[j])) { target = all[j]; break; }
        }
      }
      /* Either a return leg, or a forward one with nothing left to serve —
       * the last transfer of the day. Both go after what came before them. */
      if (!target) {
        side = 'after';
        target = prevNonTransport === -1 ? null : all[prevNonTransport];
      }
      if (target && target.id) attach[item.id] = { toId: target.id, side: side };
    });
    all.forEach(function (item) {
      if (!item || !item.id || !item.included_with) return;
      var parent = byId[item.included_with];
      // A self-reference resolves to the item itself and would attach it to
      // its own placement, so it is refused here rather than looping.
      if (!parent || parent.id === item.id) return;
      attach[item.id] = { toId: parent.id, side: 'after' };
    });

    /* Attachments never rank. A transport item takes the position the model's
     * own order gave it, and an included child takes its parent's end, so
     * neither is a candidate competing on ExperienceROI for a slot. */
    var attachedTo = {};
    Object.keys(attach).forEach(function (id) {
      var toId = attach[id].toId;
      if (!attachedTo[toId]) attachedTo[toId] = { before: [], after: [] };
      attachedTo[toId][attach[id].side].push(byId[id]);
    });
    // Within one side, the model's own order again — two trains before one
    // museum come out in the order the model listed them.
    Object.keys(attachedTo).forEach(function (toId) {
      ['before', 'after'].forEach(function (side) {
        attachedTo[toId][side].sort(function (a, b) {
          return (modelIndex[a.id] || 0) - (modelIndex[b.id] || 0);
        });
      });
    });

    /* (2) Rule 11, untouched: rank the rest by ExperienceROI descending.
     *
     * RULING AS narrows WHAT is ranked and changes NOTHING about how. An
     * attached item is not a candidate, and neither is a leg — ruling 2 states
     * that plainly: an arrival or departure leg is not a candidate rule 11
     * ranks. Everything still in `ranked` is exactly what rule 11 governed
     * before AS, ranked by exactly the formula it was ranked by before AS. */
    var ranked = rest.filter(function (item) {
      return !attach[item.id] && legOf(item) === null;
    }).map(function (item) {
      return { item: item, roi: experienceROI(item, context) };
    }).sort(function (a, b) { return b.roi - a.roi; });

    /* (3) THE DAY WINDOW — RULING AS ruling 1.
     *
     * The arrival day begins when the traveller arrives and the departure day
     * ends when they leave. `arrivalMin` and `departureMin` are the trip's own
     * stated times in minutes since midnight, handed in by the caller for the
     * first and last day only; a null on either side means the day is open at
     * that end, WHICH IS EXACTLY THE BEHAVIOUR BEFORE AS.
     *
     * The arrival leg BEGINS at the stated arrival time, because that is when
     * the traveller is there to board it. The departure leg ENDS at the stated
     * departure time, because that is when they leave. Those two sentences are
     * the whole of the arithmetic below. */
    var arrivalMin = context.arrivalMin === null || context.arrivalMin === undefined
      ? null : Math.round(num(context.arrivalMin, 0));
    var departureMin = context.departureMin === null || context.departureMin === undefined
      ? null : Math.round(num(context.departureMin, 0));

    var arrivalLeg = null, departureLeg = null;
    all.forEach(function (item) {
      var leg = legOf(item);
      // First wins. A model sending two arrival legs has sent one arrival leg
      // and one transport item, and the second is packed as ordinary transport.
      if (leg === 'arrival' && !arrivalLeg) arrivalLeg = item;
      else if (leg === 'departure' && !departureLeg) departureLeg = item;
    });

    var lengthOf = function (item) {
      return Math.round(num(item.duration_hours, 0) * 60);
    };

    var dayOpen = minutesOf(DAY_START);
    var dayClose = null;
    var legPlaced = [];

    if (arrivalLeg) {
      var aStart = arrivalMin === null ? minutesOf(DAY_START) : arrivalMin;
      legPlaced.push({ item: arrivalLeg, slot: null, leg: 'arrival',
        start: aStart, end: aStart + lengthOf(arrivalLeg) });
      dayOpen = aStart + lengthOf(arrivalLeg);
    } else if (arrivalMin !== null) {
      dayOpen = arrivalMin;
    }

    /* A departure leg with NO stated time has no anchor to hang on, so it is
     * placed LAST by the walk instead and imposes no close — which is honest:
     * without a time there is nothing to say the day ends before. */
    if (departureLeg && departureMin !== null) {
      var dEnd = departureMin;
      legPlaced.push({ item: departureLeg, slot: null, leg: 'departure',
        start: dEnd - lengthOf(departureLeg), end: dEnd });
      dayClose = dEnd - lengthOf(departureLeg);
    } else if (!departureLeg && departureMin !== null) {
      dayClose = departureMin;
    }

    /* (4) Meals into their windows, CLAMPED TO THE DAY WINDOW.
     *
     * A slot whose window falls outside the day is STATED, NEVER FILLED —
     * §5f ruling 5's rule on a new cause. It is reported separately from
     * `skipped`, because "you arrive at 10:00" is not "held back by your pace
     * budget" and rendering one as the other would be the mislabelling ruling
     * AK exists to stop. */
    var outside = [];
    var placed = [];
    MEAL_SLOTS.forEach(function (slot) {
      var window = MEAL_WINDOWS[slot];
      var earliest = minutesOf(window.earliest);
      var latest = minutesOf(window.latest);
      var shutByArrival = latest <= dayOpen;
      var shutByDeparture = dayClose !== null && earliest >= dayClose;
      if (shutByArrival || shutByDeparture) {
        /* `at` IS THE TRAVELLER'S OWN TIME, NOT THE PACKER'S EDGE, and the
         * difference is the whole sentence. A traveller who lands at 10:00 and
         * rides a ninety-minute transfer has a day that OPENS at 11:30, and
         * "No breakfast: you arrive at 11:30" would be false — they arrived at
         * ten. The stated time is what the traveller stated it by; the edge is
         * how the packer used it, and only one of the two is a fact about
         * their morning. Ruling 1's own example says 10:00. */
        outside.push({ item: claimed[slot] || null, slot: slot,
          reason: shutByArrival ? 'arrival' : 'departure',
          at: clockOf(shutByArrival
            ? (arrivalMin === null ? dayOpen : arrivalMin)
            : (departureMin === null ? dayClose : departureMin)) });
        return;
      }
      var item = claimed[slot];
      if (!item) return;
      /* RULING AS ruling 3 WINS OVER THE WINDOW, and it has to. The wagashi
       * tasting is `meal: "lunch"` AND `included_with` the class, so it is
       * both a slot holder and an attachment; placing it here as well would
       * put it on the day twice. A stated parent is a stronger claim than a
       * window, so it rides with its parent and still holds its slot. */
      if (attach[item.id]) return;
      var start = Math.max(earliest, dayOpen);
      placed.push({ item: item, slot: slot, start: start, end: start + lengthOf(item) });
    });
    placed.sort(function (a, b) { return a.start - b.start; });

    var scheduled = [], skipped = [], orphaned = [], used = 0, mealHours = 0;
    var anchorSpend = 0;
    var cursor = dayOpen;
    var queue = ranked.slice();
    /* RULING AP ruling 1, exactly as worded: "the first item starts at the
     * day's start time, each NEXT item starts at the previous end plus
     * transit." Transit is the gap BETWEEN two items, so there is none before
     * the first one — charging it would make every day start late by however
     * long the model guessed it takes to reach the first stop from nowhere.
     * It still costs the pace budget, which is rule 11's own arithmetic and
     * is unchanged. */
    var first = true;

    /* RULING AS. Meals stay OUTSIDE the pace budget however they are placed —
     * AP ruling 2, unchanged, and now stated as one predicate rather than as
     * a property of which loop happened to place the item. A meal that rides
     * in as an included child is still a meal. */
    /* `times[].slot` MEANS "THIS ITEM HOLDS THIS SLOT", NOT "THIS ITEM DECLARES
     * THIS MEAL", and the distinction is the contract AP shipped. Reduced rule
     * 6's LOSER rejoins the ordinary pool and can still be scheduled by rule
     * 11 — it just does not hold the slot, and it DOES spend the budget,
     * because it is competing as an ordinary candidate. Keying either fact off
     * `mealSlot()` would have put both dinners in the dinner slot and exempted
     * the loser from the budget, which is exactly what `tests.js` §16's
     * two-direction lock caught here. */
    var holderSlot = {};
    MEAL_SLOTS.forEach(function (slot) {
      if (claimed[slot] && claimed[slot].id) holderSlot[claimed[slot].id] = slot;
    });

    function holdsSlot(item) { return !!holderSlot[item.id]; }
    function spendOf(item) { return holdsSlot(item) ? 0 : costOf(item); }

    var placedIds = {};

    function put(item, startAt) {
      var end = startAt + lengthOf(item);
      scheduled.push({ item: item, slot: holderSlot[item.id] || null, leg: legOf(item),
        start: startAt, end: end });
      placedIds[item.id] = true;
      if (holdsSlot(item)) mealHours += num(item.duration_hours, 0);
      else used += costOf(item);
      cursor = end;
      first = false;
      return end;
    }

    function attachmentsOf(item, side) {
      var a = attachedTo[item.id];
      return (a && a[side]) || [];
    }

    /* RULING AS ruling 3: an included item's START IS ITS PARENT'S END. No
     * transit is charged between them, because they are the same place — the
     * tasting at the end of the class is not a journey. Transport attached by
     * ruling 2 keeps its own transit, because it is one. */
    function gapBefore(att, anchorItem) {
      if (first) return 0;
      if (att.included_with && att.included_with === anchorItem.id) return 0;
      return Math.round(num(att.transit_min_from_prev, 0));
    }

    /* How much earlier a block must start for its anchor to land on time.
     * Mirrors placeBlock() exactly, including its `first` handling, because a
     * lead that disagrees with the placement is a meal that misses its own
     * window by the width of its transfer. */
    function leadOf(item) {
      var lead = 0, isFirst = first;
      attachmentsOf(item, 'before').forEach(function (att) {
        if (!isFirst) lead += Math.round(num(att.transit_min_from_prev, 0));
        lead += lengthOf(att);
        isFirst = false;
      });
      if (!isFirst) lead += Math.round(num(item.transit_min_from_prev, 0));
      return lead;
    }

    function trailOf(item) {
      var trail = 0;
      attachmentsOf(item, 'after').forEach(function (att) {
        trail += gapBefore(att, item) + lengthOf(att);
      });
      return trail;
    }

    function blockSpend(item) {
      var cost = spendOf(item);
      attachmentsOf(item, 'before').concat(attachmentsOf(item, 'after'))
        .forEach(function (att) { cost += spendOf(att); });
      return cost;
    }

    /* The block emitter. It ranks nothing and decides nothing: ruling 1, ruling
     * 2 and ruling 3 have already fixed every position by the time it runs, and
     * all it does is turn a decided order into a clock. */
    function placeBlock(item, blockStartAt, anchored, absolute) {
      var t = blockStartAt;
      attachmentsOf(item, 'before').forEach(function (att) {
        if (!first && !absolute) t += Math.round(num(att.transit_min_from_prev, 0));
        /* AN ATTACHMENT IS ALWAYS ANCHORED, whatever its host is. It never
         * entered `ranked`, so it never competed on ExperienceROI for its
         * place — which is the definition ruling 2 gives. Gating this on the
         * host's own flag counted only the legs, and §26.3c then measured
         * zero anchored hours on a day carrying two anchored trains. */
        anchorSpend += spendOf(att);
        t = put(att, t);
        absolute = false;
      });
      /* `absolute` is RULING 1's anchor, and it is not a convenience: a leg
       * placed at a stated time starts AT that time. Charging its own transit
       * on top would put the departure bus ten minutes past the flight it is
       * catching — which is what the first build did, and what reading the
       * schedule rather than an assertion caught. Transit is the gap BETWEEN
       * two items, and there is no item before a stated clock time. */
      if (!first && !absolute) t += Math.round(num(item.transit_min_from_prev, 0));
      if (anchored) anchorSpend += spendOf(item);
      var end = put(item, t);
      attachmentsOf(item, 'after').forEach(function (att) {
        anchorSpend += spendOf(att);          // as above: always anchored
        end = put(att, end + gapBefore(att, item));
      });
      return end;
    }

    /* THE GAP IS A START WINDOW, NOT AN END WINDOW, and the difference is a
     * real defect this was built with first — §26.3 caught it.
     *
     * AP's rule was `blockEnd > earliest -> skip`: an activity had to FINISH
     * before the next meal's window opened. That is exactly right for
     * breakfast, whose window opens at DAY_START, and it is what stops the
     * walk taking 08:00-10:00 and pushing breakfast to ten. It is wrong for
     * every later meal, because a block that overruns lunch's opening by five
     * minutes was deferred past lunch ENTIRELY — and with ruling 2 attaching a
     * return leg to the far side of an activity, the Uji trip grew by its
     * return train and fell off the far side of lunch. The day came out
     * `breakfast, lunch, train, temple, return` : lunch in Uji before going
     * there.
     *
     * So the test is split in two, and both halves are honest:
     *
     *   startBefore — the item must be able to BEGIN in the gap. Nothing can
     *                 begin before the day begins, which is why breakfast
     *                 still cannot be displaced: its gap has zero width.
     *   endBefore   — it may OVERRUN the gap, and the meal slides, but never
     *                 so far that the meal leaves its own window. The activity
     *                 yields to the meal; the meal does not leave its hour.
     *
     * AP's defect stays fixed BY CONSTRUCTION rather than by a limit that
     * happens to be tight enough, which is the stronger form. */
    function fillUntil(startBefore, endBefore) {
      for (var i = 0; i < queue.length; i++) {
        var item = queue[i].item;
        var blockEnd = cursor + leadOf(item) + lengthOf(item) + trailOf(item);
        // Rule 11's budget is unchanged and is still hard. The budget test
        // spans the WHOLE block, so an activity is never scheduled on the
        // strength of a transfer that will not fit.
        if (used + blockSpend(item) > budget) continue;
        if (startBefore !== null && cursor >= startBefore) continue;
        if (endBefore !== null && blockEnd > endBefore) continue;
        if (dayClose !== null && blockEnd > dayClose) continue;
        queue.splice(i--, 1);
        placeBlock(item, cursor, false);
      }
    }

    /* RULING AS ruling 1. The arrival leg opens the day, at the time the
     * traveller actually arrives. Nothing above it in ROI can precede it,
     * because it is not a candidate rule 11 ranks. */
    legPlaced.forEach(function (lp) {
      if (lp.leg !== 'arrival') return;
      // `absolute`: the leg starts AT the stated arrival time, not at that
      // time plus its own transit. See placeBlock().
      placeBlock(lp.item, lp.start, true, true);
    });

    placed.forEach(function (meal) {
      /* THE FILL LIMIT IS THE MEAL'S `earliest`, NOT ITS `latest`, and the
       * difference is a real defect this was built with first: with `latest`
       * as the limit, the highest-ROI activity took 08:00 to 10:00 and pushed
       * BREAKFAST to 10:00 — the walk before the coffee. `earliest` is when
       * the meal wants to start, so it is the wall the gap fills up to.
       *
       * RULING AS: the wall is the meal's BLOCK, not the meal. Filling up to
       * the meal itself would let the highest-ROI activity take the transfer's
       * own slot and push the transfer past the thing it serves — the same
       * defect one layer along, which is why the lead is subtracted here. */
      var window = MEAL_WINDOWS[meal.slot];
      var earliest = Math.max(minutesOf(window.earliest), dayOpen);
      var lead = leadOf(meal.item);
      fillUntil(earliest - lead, minutesOf(window.latest) - lead);
      var blockStart = Math.max(cursor, earliest - lead);
      var end = placeBlock(meal.item, blockStart, false);
      /* The day ran long — a previous meal or a long activity overran. The
       * meal KEEPS ITS SLOT and slides rather than being dropped: AP ruling 2
       * says every day accounts for three meals, and a meal moved is still a
       * meal. `latest` is what makes the slide visible instead of silent, and
       * it goes to the console on AK class (a) rather than inventing traveller
       * copy for an edge only a wildly overlong item can reach. */
      var entry = null;
      scheduled.forEach(function (e) { if (e.item.id === meal.item.id) entry = e; });
      if (entry) entry.late = entry.start > minutesOf(window.latest);
      cursor = end;
    });
    // No meal left to make room for, so the day's own close is the only bound
    // and fillUntil() applies it itself.
    fillUntil(null, null);

    /* RULING AS ruling 1. The departure leg closes the day. With a stated time
     * it sits at that time; without one it is simply last, which is the
     * honest reading — there is nothing to say the day ends before. */
    legPlaced.forEach(function (lp) {
      if (lp.leg !== 'departure') return;
      // `absolute`, as above: the leg ENDS at the stated departure time, so
      // it starts exactly one duration before it.
      placeBlock(lp.item, lp.start, true, true);
    });
    if (departureLeg && departureMin === null) {
      placeBlock(departureLeg, cursor + (first ? 0
        : Math.round(num(departureLeg.transit_min_from_prev, 0))), true);
    }

    queue.forEach(function (entry) { skipped.push(entry.item); });

    /* RULING AS ruling 3, THE ORPHAN, and the founder ruled it at the gate.
     *
     * An attachment is emitted with its anchor, so an attachment whose anchor
     * never reached the day was never placed at all. AJ's cascade fires only
     * on hard-filter REMOVALS and has never seen a pace-budget skip, so before
     * AS a $0 "class inclusion" stayed on the card at 12:00 with no class —
     * §5f's orphaned meal on Day 8, arriving through the budget rather than
     * through a filter.
     *
     * Ruled: THE CHILD IS DROPPED WITH ITS PARENT. It joins `skipped`, so the
     * day's existing held-back block names it beside the parent and NO NEW
     * TRAVELLER STRING IS INVENTED — which is also why it is counted as
     * neither a dietary nor a fit removal: it is neither, and inflating either
     * counter would break decisions ruling 4, on §5c's own precedent that an
     * accessibility evaluation is counted in no category. `orphaned` carries
     * the pair out for a caller to log.
     *
     * That last sentence is worded around a lock rather than through it.
     * §20.6's AN exemption asserts `engines.js` makes no logging call of its
     * own, and it scans RAW SOURCE, so it cannot tell a comment from code —
     * a sentence ending in the word followed by a full stop failed it. The
     * scan was NOT taught to skip comments: it only ever over-reports, which
     * is the safe direction, and teaching it to accommodate one sentence is
     * how a lock stops being one. Ruling AP took the identical decision when
     * §9.13's Ledger Law grep bit one of its own comments. */
    Object.keys(attach).forEach(function (id) {
      if (placedIds[id]) return;
      var child = byId[id];
      var parent = byId[attach[id].toId];
      if (!child) return;
      skipped.push(child);
      if (child.included_with && parent && parent.id === child.included_with) {
        orphaned.push({ item: child, parent: parent });
      }
    });

    scheduled.sort(function (a, b) { return a.start - b.start || a.end - b.end; });

    /* RULING AS ruling 2. An anchored leg or transfer is not a candidate rule
     * 11 ranks, so it takes its position and SPENDS the budget — which can
     * cost a ranked activity its place. The founder ruled that displacement is
     * reported BY NAME to the console, on AK class (a): the diagnostic goes
     * where the build side reads it, and no traveller copy is invented.
     *
     * "Displaced" means exactly this and says so: the item would have fitted
     * had the anchors spent nothing. It is not a claim about greedy ordering. */
    var displaced = skipped.filter(function (item) {
      return (used - anchorSpend) + spendOf(item) <= budget;
    });

    /* The times ride ALONGSIDE the item, never on it. Writing start/end onto
     * the model's own object would put a Romieaux-computed value inside a
     * field the validator governs, and §7's untrusted-input contract owns
     * that shape. `scheduled` keeps its array-of-items contract for every
     * existing caller; `times` is the new, additive channel. */
    var times = scheduled.map(function (e) {
      return { id: e.item.id, slot: e.slot, leg: e.leg, start: clockOf(e.start),
        end: clockOf(e.end), startMin: e.start, endMin: e.end, late: !!e.late };
    });

    return {
      scheduled: scheduled.map(function (e) { return e.item; }),
      skipped: skipped,
      times: times,
      // RULING AP. hoursUsed stays the PACE-CONSUMING figure, so
      // logResult()'s OVER BUDGET branch - the one signal ruling AM item 1
      // moved off the badge and into the console - still means what it says.
      hoursUsed: used,
      mealHours: mealHours,
      energyBudget: budget,
      // RULING AS. Three additive channels, none of which any existing caller
      // has to read: the slots the day window shut, the children dropped with
      // their parents, and the activities an anchor cost a place.
      outside: outside,
      orphaned: orphaned,
      displaced: displaced,
      anchorHours: anchorSpend,
      dayOpen: clockOf(dayOpen),
      dayClose: dayClose === null ? null : clockOf(dayClose)
    };
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
    // RULING AP — §5c invented conventions. None attributes a dollar.
    DAY_START: DAY_START,
    MEAL_SLOTS: MEAL_SLOTS,
    MEAL_WINDOWS: MEAL_WINDOWS,
    mealSlot: mealSlot,
    // RULING AS — the leg vocabulary and the two readers that decide which of
    // ruling 1, ruling 2 and rule 11 reaches an item.
    TRIP_LEGS: TRIP_LEGS,
    legOf: legOf,
    isTransport: isTransport,
    minutesOf: minutesOf,
    clockOf: clockOf,
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
    bandFor: bandFor,                        // ruling AR

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
