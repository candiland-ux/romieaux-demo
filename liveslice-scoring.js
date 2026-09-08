/* Romieaux — Live Slice scoring pipeline (P4).
 *
 * The whole path from "an object the model returned" to "a scored, filtered,
 * reconciled Live Slice": deep §7 validation, the hard-constraint post-filter,
 * IdentityFit + Stays scoring + greedy day packing, intervention detection
 * against every Ledger Law formula, and the decisions_automated derivation.
 *
 * PURE. No DOM, no network, no globals beyond `LiveSliceScoring`. Loads as a
 * plain <script> (GitHub Pages, no build step) and under node for tests.js.
 * The render half lives in liveslice-results.js.
 *
 * NO DOLLAR FIGURE IS PRODUCED HERE. This file validates and clamps the
 * model's price ESTIMATES as engine inputs (work order §4) and hands them to
 * engines.js; every SAVES / EARNS / AVOIDED figure and every framework total
 * is computed by engines.js against a named baseline (CLAUDE.md).
 *
 * =====================================================================
 * P4 NOTES — read alongside RULINGS.md
 *
 * §7 UNTRUSTED INPUT (P3 deliberately deferred this — RULINGS §5b).
 *   parseGeneration() established only that the reply is a JSON object. This
 *   file is where "validate against the schema, clamp numeric ranges, drop
 *   unknown fields" happens, and where "a missing or malformed field defaults
 *   to a value that produces zero attribution — never a fabricated saving"
 *   is enforced field by field.
 *
 * §5b REPLAY. A replayed trip is scored against cachedGeneration().blueprint,
 *   never the live Blueprint. This file takes the Blueprint as an argument and
 *   never reads one from a global, so the caller cannot get that wrong by
 *   accident; liveslice-results.js passes the cached one on the Replay path.
 *
 * RULING Q. tags / accessibility / covers / notes are §4 fields because
 *   engines.js reads them. `accessibility: true` means VERIFIED; a key the
 *   model was unsure of is omitted, and omission leaves the predicate
 *   unsatisfied so the item is dropped. This validator therefore keeps ONLY
 *   `=== true` values and discards everything else on that object.
 *
 * RULING P. Dietary hard lines are forbidden TERMS. Over-removal is the
 *   intended direction; every removal is logged to the console for QA (§7).
 *
 * ENGINE-INPUT-ONLY (RULINGS §2). card_scenario / net_budget_usd / fees_usd /
 *   decisions_automated are never asked for. If the model supplies one anyway
 *   it is DROPPED here and logged — the P3 prompt promises the traveller that
 *   any value the model supplies is discarded, and this is where that promise
 *   is kept. net_budget_usd and fees_usd are then fixed at 0 for a generated
 *   trip; decisions_automated is derived below from countable engine work.
 *
 * FIELDS engines.js READS THAT §4 DOES NOT YET LIST — raised for ruling in
 *   the P4 conflict report, implemented conservatively here:
 *     item.min_age_years   read by violatesAgeGate()
 *     item.pet_friendly    read by violatesPetConstraint()
 *     item.tickets         read by buildLedger() for savesAdvancePurchase()
 *   All three are ACCEPTED and clamped rather than dropped: dropping them
 *   would disable two hard filters, and a disabled hard filter is the one
 *   failure mode §7 exists to prevent. They are not added to the P3 prompt —
 *   amending the schema the model is shown is a ruling, not a P4 decision.
 *
 * P5 ADDITIONS (the only changes this file has taken since P4):
 *   score() also returns `ledgerTrip`, the object buildLedger() was run
 *   against, and ledgerAtRate() rebuilds the ledger at a different hourly
 *   rate through engines.js. Both exist so the P5 panel can follow the
 *   canonical rate slider live without a single dollar being computed in
 *   render code. Nothing else in the pipeline moved.
 * ------------------------------------------------------------------- */
var LiveSliceScoring = (function (Engines, Blueprint) {
  'use strict';

  if (!Engines || !Blueprint) {
    throw new Error('Live Slice: liveslice-scoring.js requires engines.js and blueprint.js to be loaded first.');
  }

  var num = Engines._num;

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObject(v) { return !!v && typeof v === 'object' && !isArray(v); }

  /* ---------------------------------------------------------------------
   * §7 clamp bounds. Every one of these is a ceiling on an UNTRUSTED number,
   * not a business rule — the business rules (gates, thresholds, rates) all
   * live in engines.js. A value outside the bound is clamped and logged, so a
   * model that returns a nightly rate of 9e9 produces a bounded input rather
   * than an absurd saving.
   * ------------------------------------------------------------------- */

  var MONEY_MAX = 100000;        // any single price or rate
  var SPEND_MAX = 1000000;       // trip-level spend estimates
  var DURATION_MAX_HOURS = 24;
  var TRANSIT_MAX_MIN = 720;
  var COMMUTE_MAX_MIN = 600;
  var QUEUE_MAX_MIN = 600;
  var RIDES_MAX = 200;
  var DAYS_MAX = Blueprint.NIGHTS_MAX + 1;   // one day entry per night, plus departure
  var ITEMS_PER_DAY_MAX = 40;
  var SEGMENTS_MAX = 24;
  var TAGS_MAX = 12;
  /* Ruling AL. The vocabulary is ten tokens and a real venue rarely declares
   * more than three; the bound exists because `suits` is untrusted input like
   * every other array in §7, not because a legitimate value approaches it.
   * SUPERSEDES AJ's CONTAINS_MAX of 20, which was sized against a 51-token
   * ingredient vocabulary that no longer exists. */
  var SUITS_MAX = 12;
  var TAG_MAX_CHARS = 40;
  var TEXT_MAX = 400;
  var ID_MAX = 40;

  /* The plausibility bound on a booking fee or an advance discount. Above
   * half the price it is not a market fact, it is a bad estimate — and an
   * unbounded fee rate is a direct route to a fabricated AVOIDED figure, so
   * this is a clamp, not a warning. */
  var IMPLAUSIBLE_RATE = 0.5;

  var MODULES = ['stays', 'dining', 'activities', 'transportation'];
  var ALT_CHANNEL_TYPES = ['portal', 'platform', 'resale', 'none'];
  var FLEXIBILITIES = ['free', 'partial', 'prepaid'];

  /* Tags that make an item a wellness venue for the decisions derivation.
   * Kept here rather than in the Blueprint because it is a scoring-time
   * vocabulary, not a traveller answer. */
  var WELLNESS_TAGS = ['wellness', 'spa', 'yoga', 'thermal', 'hot spring', 'onsen',
                       'hammam', 'sauna', 'bathhouse', 'retreat', 'massage'];

  /* The four names the model must never supply (RULINGS §2). Read from the
   * API layer when it is present so there is one list, not two. */
  var ENGINE_INPUT_ONLY = (typeof LiveSliceAPI !== 'undefined' && LiveSliceAPI && LiveSliceAPI.ENGINE_INPUT_ONLY)
    ? LiveSliceAPI.ENGINE_INPUT_ONLY.slice()
    : ['card_scenario', 'net_budget_usd', 'fees_usd', 'decisions_automated'];

  /* Allow-lists. Anything not on one of these is an unknown field and is
   * dropped — the third clause of §7. */
  /* RULING AS ruling 1 — `arrival_time` and `departure_time` join the trip
   * block. Both optional, both local wall-clock `HH:MM`, and ABSENCE MEANS
   * DAY_START TO END OF DAY, NEVER ASSUMED — the verified-or-drop direction
   * rulings P, Q, R, U, AJ, AL, AN and AP all share, on a tenth field, and
   * here the safe direction is the same one it always is: a trip that says
   * nothing about when the traveller lands is packed exactly as it was packed
   * before AS rather than having a landing time guessed for it. */
  var TRIP_KEYS = ['destination', 'start', 'end', 'currency',
                   'arrival_time', 'departure_time'];
  var ITEM_KEYS = [
    'id', 'module', 'name', 'est_price_usd', 'est_price_local', 'duration_hours',
    'transit_min_from_prev', 'attributes', 'alt_channel', 'flexibility',
    'advance_discount_pct', 'area_median_rate_usd', 'crowd_shift',
    'weather_sensitive', 'covers', 'tags', 'accessibility', 'notes',
    // engine-read, not yet listed in §4 — see the header block
    'tickets', 'min_age_years', 'pet_friendly',
    // ruling AL — the venue-suitability claim (supersedes AJ's `contains`),
    // and ruling AJ's parent link, which is unchanged
    'suits', 'included_with',
    // ruling AP — which meal slot a dining item fills. PDF rule 6's own
    // structure, dropped by work order §5 and restored here.
    'meal',
    /* ruling AS — which leg of the trip a transportation item is. The model
     * marks it; the packer never infers it from a name, because reading `KIX`
     * out of free text is ruling AL's `contains` mistake a third time and it
     * fails SILENTLY on every airport code a pattern does not know. */
    'leg'
  ];
  var STAY_KEYS = [
    'name', 'nightly_direct_usd', 'nightly_portal_usd', 'nights',
    'commute_min_to_anchors', 'flexibility', 'area_median_rate_usd',
    'locked_rate_usd', 'flexible_rate_at_decision_usd',
    // ruling S — the stay is scored and filtered like any other option
    'attributes', 'accessibility', 'tags',
    /* ruling U — …and faces the hard constraints. RULING AL item 6 removes
     * the DIETARY one: AJ item 5 kept a declared-only `contains` check here,
     * and that balance does not survive the inversion. Under `contains`
     * silence was the dangerous value and a declaration was safe; under
     * `suits` a hotel with no restaurant honestly declares `[]` and a subset
     * test would refuse the booking. AJ item 5's own sentence names the
     * stakes — refusing every hotel on every restricted trip is the
     * hollowing-out failure at the worst possible place. The stay keeps
     * accessibility, age and pet; `suits` is not asked of it and not read. */
    'pet_friendly', 'min_age_years',
    /* RULING AP ruling 2 — whether the stay includes breakfast. It is asked
     * for, and ABSENCE MEANS NOT INCLUDED, never assumed. That is the
     * verified-or-drop direction rulings P, Q, R, U, AJ, AL and AN all share,
     * on an eighth field, and here it is the safe direction for the same
     * reason it always is: a day that says breakfast is included when it is
     * not sends the traveller down to an empty dining room. */
    'includes_breakfast'
  ];
  var SEGMENT_KEYS = ['name', 'direct_usd', 'portal_usd', 'tickets',
                      'single_fare_usd', 'planned_rides', 'pass_price_usd'];
  var PET_PAPERWORK_KEYS = ['expediter_quote_usd', 'official_fee_usd'];
  var ROOT_KEYS = ['trip', 'days', 'stay', 'transport_segments',
                   'foreign_card_spend_estimate_usd', 'dcc_exposed_spend_usd',
                   'pet_paperwork'];

  /* ---------------------------------------------------------------------
   * The validation report. Everything the validator did to the model's JSON
   * ends up here, and liveslice-results.js prints all of it to the console —
   * §7's QA requirement applies to the whole untrusted-input contract, not
   * only to the hard-filter removals.
   * ------------------------------------------------------------------- */

  function newReport() {
    return {
      errors: [],     // the shape is unusable — generation cannot be scored
      warnings: [],   // scored, but something is worth a human's attention
      dropped: [],    // unknown / forbidden fields and unusable rows
      clamped: [],    // numbers pulled back inside their bound
      defaulted: [],  // missing fields that fell back to zero attribution

      /* RULING AJ, founder addition 1 — KEPT BY RULING AL and renamed for the
       * new field. `suits` is REQUIRED on dining items, and absence means the
       * item is removed as unverified. That is the safe direction, but its own
       * failure mode is a model that drops the field wholesale and hollows the
       * itinerary out through a different door — which is exactly the defect
       * this chain exists to fix, arriving by another route. So the omission
       * is caught by a NUMBER rather than by a hollow itinerary: every dining
       * item that omitted it is counted here, reported to the console by
       * logResult(), and carried into the phase report.
       *
       * Counted on EVERY run, not only on restricted trips, so the signal is
       * available before a traveller with a need ever hits it. */
      diningWithoutSuits: 0,
      diningTotal: 0,
      /* RULING AP. Option (i)'s own failure mode, on AJ founder addition 1's
       * mechanism: a model that drops `meal` wholesale empties every slot on
       * every day, and the day cards would then read "no lunch is scheduled"
       * across the whole trip with nothing to point at. That is caught by a
       * NUMBER here rather than by a hollow itinerary. */
      mealsDeclared: 0,
      /* RULING AS ruling 6 — THE PLACEHOLDER NON-ITEM, and the count exists
       * because NOTHING IN THIS BUNDLE COULD SEE ONE.
       *
       * The model was emitting "Hotel arrival breakfast (in-flight/none)" and
       * "No dinner scheduled (departure day)" — items that answer "there is no
       * dinner" by supplying a dinner. `diningWithoutSuits` above counts an
       * UNDECLARED `suits`, so a declared EMPTY array is compliant by that
       * test; zero duration is not a violation of anything; and a name is free
       * text. So the departure-day placeholder passed validation with zero
       * warnings, was removed by AL's subset test, and reached the traveller
       * as a DIETARY removal on a day they had no dietary problem with.
       *
       * The prompt now asks for real items only and states the consequence on
       * ruling R's precedent. This is the number that says whether it worked —
       * AJ founder addition 1's mechanism, on a fourth field: a model ignoring
       * the instruction is caught by a count rather than by a traveller
       * reading a made-up removal. Console-only, per §5f. */
      placeholderDining: 0,
      /* RULING AT item 1 — THE ITEMS THAT DECLARED NO VECTOR AT ALL, counted
       * beside `diningWithoutSuits` above because it is the same failure on a
       * different field, and caught the same way: by a NUMBER, on every run.
       *
       * `cleanAttributes()` notes a MISSING `attributes` in `rep.defaulted`,
       * but an EMPTY OBJECT is an object — it passes `isObject`, normalises to
       * six zeros and says nothing. The post-deploy-15 capture sent `{}` on
       * fourteen of fifty-five items and produced not one note. An all-zero
       * vector scores IdentityFit 0 against any taste vector whatsoever, so a
       * model drifting toward empty vectors hollows a trip out silently — the
       * defect ruling AJ's count exists to catch, arriving on a fourth field.
       *
       * Counted on EVERY run including zero, on AJ's, AK's, AM's, AR's and
       * AS's shared reasoning: a number that appears only when it is
       * interesting cannot be read as a baseline. Console-only, per §5f. */
      itemsWithoutAttributes: 0,
      itemsTotal: 0,
      /* RULING AT item 2 — A DAY ITEM ARRIVING AS A STAY.
       *
       * A SIBLING of `placeholderDining`, deliberately not folded into it: AS
       * scoped that count to dining and built it on a three-signal
       * conjunction precisely so it could not fire on something else, and the
       * check-in row matches none of the three. It is a different shape with a
       * different cause and it gets its own number.
       *
       * The model sent "Check-in and settle at ryokan" as a day item with
       * `module: 'stays'`. The stay is not an event in a day and the traveller
       * has exactly one, so the day card no longer renders it (ruling AT item
       * 2) — but a day card that quietly drops something is the state this
       * count exists to make visible. */
      stayModuleDayItems: 0
    };
  }

  function note(list, path, detail) {
    list.push({ path: path, detail: detail });
  }

  /* ---------------------------------------------------------------------
   * Field-level cleaners. Each takes the raw value, its path (for the QA log)
   * and the report, and returns a value the engines can read.
   * ------------------------------------------------------------------- */

  function text(value, max) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    return String(value).trim().slice(0, max === undefined ? TEXT_MAX : max);
  }

  function oneOf(value, allowed, fallback) {
    var v = String(value === null || value === undefined ? '' : value).toLowerCase().trim();
    return allowed.indexOf(v) !== -1 ? v : fallback;
  }

  function isoDate(value) {
    var s = text(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  /* RULING AS ruling 1. A local wall-clock time, `HH:MM`, and nothing else.
   *
   * No timezone, no date, no `Date` object — PDF rule 39 asks for local
   * wall-clock and `engines.js` already treats a day as minutes since
   * midnight for exactly that reason, so a static bundle with no timezone
   * data is not being asked to pretend otherwise. Anything that is not the
   * shape returns '', which is §7's zero-attribution default expressed as a
   * schedule: the day falls back to DAY_START, which is where it was before
   * AS. */
  function clockTime(value) {
    var s = text(value, 5);
    var m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return '';
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return '';
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }

  /* The reporting half of clockTime(). Absence is silent, because absence is
   * the ruled default and a note on every trip that did not state a landing
   * time would be noise. A value that was SENT and is not a time is a model
   * that tried and failed, and that is worth a line. */
  function tripTime(value, path, rep) {
    if (value === null || value === undefined || value === '') return '';
    var t = clockTime(value);
    if (!t) {
      note(rep.dropped, path,
        JSON.stringify(String(value).slice(0, 20)) +
        ' is not a local HH:MM time — dropped, and the day runs from its usual start (ruling AS)');
    }
    return t;
  }

  function bool(value) { return value === true; }

  /* A number that is missing, non-numeric or negative becomes 0 — the §7
   * zero-attribution default. A number above its bound is clamped, never
   * discarded, because discarding it would also produce 0 and hide the
   * problem. Both cases are logged. */
  function bounded(value, path, rep, max, fallback) {
    var base = fallback === undefined ? 0 : fallback;
    if (value === null || value === undefined) return base;
    var n = num(value, NaN);
    if (!isFinite(n)) {
      note(rep.defaulted, path, 'not a number (' + JSON.stringify(value) + ') — defaulted to ' + base);
      return base;
    }
    if (n < 0) {
      note(rep.clamped, path, 'negative (' + n + ') — clamped to 0');
      return 0;
    }
    if (n > max) {
      note(rep.clamped, path, n + ' exceeds the bound ' + max + ' — clamped');
      return max;
    }
    return n;
  }

  function boundedInt(value, path, rep, max) {
    return Math.round(bounded(value, path, rep, max));
  }

  /* Rates are normalised to a decimal HERE, not in engines.js, so the engine's
   * own `if (rate > 1) rate /= 100` branch is unreachable. That branch is
   * ambiguous at exactly 1 — "1" could mean 1% or 100% — and the expensive
   * reading is the one that fabricates a saving. Normalising upstream removes
   * the ambiguity, and each rate is normalised the way its own field is
   * DOCUMENTED to the model, so a model that follows the prompt is read
   * correctly and a model that does not under-claims rather than over-claims.
   *
   * Both are then capped at IMPLAUSIBLE_RATE. A booking fee or an advance
   * discount above half the price is not a market fact, it is a bad estimate,
   * and §7 says an untrusted number gets a bound. */
  function rateFloor(value, path, rep) {
    if (value === null || value === undefined) return { ok: false, n: 0 };
    var n = num(value, NaN);
    if (!isFinite(n)) {
      note(rep.defaulted, path, 'not a number (' + JSON.stringify(value) + ') — defaulted to 0');
      return { ok: false, n: 0 };
    }
    if (n < 0) {
      note(rep.clamped, path, 'negative rate (' + n + ') — clamped to 0');
      return { ok: false, n: 0 };
    }
    return { ok: true, n: n };
  }

  function capRate(n, raw, path, rep) {
    if (n > IMPLAUSIBLE_RATE) {
      note(rep.clamped, path, JSON.stringify(raw) + ' resolves to ' + Math.round(n * 100) +
        '% — clamped to the ' + Math.round(IMPLAUSIBLE_RATE * 100) + '% plausibility bound');
      return IMPLAUSIBLE_RATE;
    }
    return n;
  }

  /* alt_channel.fee_rate — the prompt documents this as a DECIMAL
   * ("0.15 = 15%"). A value above 1 can only be a percent, so it is folded. */
  function decimalRate(value, path, rep) {
    var parsed = rateFloor(value, path, rep);
    if (!parsed.ok) return 0;
    var n = parsed.n;
    if (n > 1) n = n / 100;
    return capRate(n, value, path, rep);
  }

  /* advance_discount_pct — the prompt documents this as a WHOLE PERCENT
   * ("12 means 12%"), so every value is read as a percent. A model that sends
   * 0.12 meaning 12% is read as 0.12%, falls under the 8% gate and produces no
   * row: the zero-attribution direction §7 requires. */
  function percentRate(value, path, rep) {
    var parsed = rateFloor(value, path, rep);
    if (!parsed.ok) return 0;
    return capRate(parsed.n / 100, value, path, rep);
  }

  /* Unknown fields (§7, third clause) and the four engine-input-only names
   * (RULINGS §2) are both dropped here, and the forbidden four are called out
   * by name so the QA log says WHY. */
  function dropUnknown(raw, allowed, path, rep) {
    Object.keys(raw).forEach(function (key) {
      if (allowed.indexOf(key) !== -1) return;
      if (ENGINE_INPUT_ONLY.indexOf(key) !== -1) {
        note(rep.dropped, path + '.' + key,
          'engine-input-only — the model was told this is computed downstream and any value it supplies is discarded');
      } else {
        note(rep.dropped, path + '.' + key, 'not in the §4 schema — dropped as unknown');
      }
    });
  }

  function cleanAttributes(raw, path, rep) {
    var out = {};
    var dims = Engines.TASTE_DIMS;
    var supplied = isObject(raw) ? raw : null;
    if (!supplied) {
      // No attributes at all -> a zero vector -> IdentityFit 0 -> suppressed.
      // Suppression, not fabrication (ruling H).
      note(rep.defaulted, path, 'missing — zero taste vector, so the item scores IdentityFit 0 and is suppressed');
    }
    for (var i = 0; i < dims.length; i++) {
      var dim = dims[i];
      var value = supplied ? supplied[dim] : undefined;
      if (value === undefined || value === null) { out[dim] = 0; continue; }
      var n = num(value, NaN);
      if (!isFinite(n)) { out[dim] = 0; note(rep.defaulted, path + '.' + dim, 'not a number — defaulted to 0'); continue; }
      if (n < 0 || n > 1) { note(rep.clamped, path + '.' + dim, n + ' outside 0–1 — clamped'); }
      out[dim] = clamp(n, 0, 1);
    }
    if (supplied) dropUnknown(supplied, dims, path, rep);
    return out;
  }

  function cleanAltChannel(raw, path, rep) {
    if (!isObject(raw)) {
      // No alternative channel -> type 'none' -> no platform-fee row. Zero
      // attribution, not an invented channel.
      return { type: 'none', price_usd: 0, fee_rate: 0 };
    }
    dropUnknown(raw, ['type', 'price_usd', 'fee_rate'], path, rep);
    var type = oneOf(raw.type, ALT_CHANNEL_TYPES, null);
    if (type === null) {
      note(rep.defaulted, path + '.type', 'unrecognised channel (' + JSON.stringify(raw.type) + ') — treated as "none"');
      type = 'none';
    }
    return {
      type: type,
      price_usd: bounded(raw.price_usd, path + '.price_usd', rep, MONEY_MAX),
      fee_rate: decimalRate(raw.fee_rate, path + '.fee_rate', rep)
    };
  }

  /* Ruling Q: `true` means VERIFIED. Anything that is not exactly true is
   * dropped, which leaves the predicate unsatisfied and removes the item —
   * the same over-removal direction ruling P established as the safe one. */
  function cleanAccessibility(raw, path, rep) {
    var out = {};
    if (!isObject(raw)) return out;
    var keys = Blueprint.ACCESSIBILITY_KEYS;
    Object.keys(raw).forEach(function (key) {
      if (keys.indexOf(key) === -1) {
        note(rep.dropped, path + '.' + key, 'not a Blueprint accessibility key — dropped');
        return;
      }
      if (raw[key] === true) { out[key] = true; return; }
      note(rep.dropped, path + '.' + key,
        'not exactly true (' + JSON.stringify(raw[key]) + ') — ruling Q: only a verified need counts, so this is treated as unverified');
    });
    return out;
  }

  function cleanTags(raw, path, rep) {
    if (!isArray(raw)) {
      if (raw !== undefined && raw !== null) note(rep.dropped, path, 'not an array — dropped');
      return [];
    }
    var out = [];
    for (var i = 0; i < raw.length && out.length < TAGS_MAX; i++) {
      var tag = text(raw[i], TAG_MAX_CHARS).toLowerCase();
      if (tag && out.indexOf(tag) === -1) out.push(tag);
    }
    if (raw.length > TAGS_MAX) {
      note(rep.clamped, path, raw.length + ' tags supplied — kept the first ' + TAGS_MAX);
    }
    return out;
  }

  /* RULING AL — the venue-suitability claim. SUPERSEDES AJ's cleanContains().
   *
   * The SHAPE is AJ's, kept deliberately: lowercased, deduped, capped, unknown
   * tokens dropped, and { list, declared } returned so the absent/empty
   * distinction survives validation — same convention as rulings S and U's
   * `_accessibility_declared` / `_pet_friendly_declared` / `_min_age_declared`.
   *
   * WHAT INVERTS IS THE MEANING OF `[]`. Under `contains` an empty array was
   * an affirmative "none of these" and was KEPT; under `suits` it is an
   * affirmative "suits none of these" and is REMOVED on a trip with any
   * stated need. `declared` is therefore no longer what decides the verdict —
   * both dispositions remove the item — and is retained for the TRAVELLER'S
   * WORDING, because §5f requires they be told which of the two it was.
   *
   * The vocabulary is CLOSED to Blueprint.SUITS_VOCAB, the ten preset keys,
   * which is the same token set the traveller's needs are expressed in. A
   * token outside it names no need any traveller can state, so it is dropped
   * with a note rather than kept as decoration.
   *
   * NOTE THE DIRECTION OF THAT DROP, because it reverses too. Under AJ,
   * dropping an unknown token could not turn a conflict into a pass. Under AL
   * it can only make a claim SMALLER, so it can only turn a pass into a
   * removal — the over-removal direction rulings P, Q, R and U all chose.
   * A model inventing a token cannot talk a venue onto the itinerary. */
  function cleanSuits(raw, path, rep) {
    if (raw === undefined || raw === null) return { list: [], declared: false };
    if (!isArray(raw)) {
      note(rep.dropped, path, 'not an array — dropped, and the item is treated as unstated');
      return { list: [], declared: false };
    }
    var vocab = Blueprint.SUITS_VOCAB || [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < SUITS_MAX; i++) {
      var token = text(raw[i], TAG_MAX_CHARS).toLowerCase();
      if (!token) continue;
      if (vocab.indexOf(token) === -1) {
        note(rep.dropped, path,
          JSON.stringify(token) + ' is not one of the ' + vocab.length +
          ' dietary need tokens — dropped');
        continue;
      }
      if (out.indexOf(token) === -1) out.push(token);
    }
    if (raw.length > SUITS_MAX) {
      note(rep.clamped, path,
        raw.length + ' tokens supplied — kept the first ' + SUITS_MAX);
    }
    return { list: out, declared: true };
  }

  function cleanCrowdShift(raw, path, rep) {
    if (!isObject(raw)) return { suggested_start: '', queue_min_saved: 0 };
    dropUnknown(raw, ['suggested_start', 'queue_min_saved'], path, rep);
    return {
      suggested_start: text(raw.suggested_start, 20),
      queue_min_saved: bounded(raw.queue_min_saved, path + '.queue_min_saved', rep, QUEUE_MAX_MIN)
    };
  }

  /* ---------------------------------------------------------------------
   * Item, stay, segment
   * ------------------------------------------------------------------- */

  function cleanItem(raw, path, rep, opts) {
    if (!isObject(raw)) {
      note(rep.dropped, path, 'not an object — item dropped');
      return null;
    }
    dropUnknown(raw, ITEM_KEYS, path, rep);

    var module = oneOf(raw.module, MODULES, null);
    if (!module) {
      // Without a module the engines cannot tell a dinner from a train, so
      // neither the ledger nor the day packer can place it. Dropped, loudly.
      note(rep.dropped, path, 'module ' + JSON.stringify(raw.module) + ' is not one of ' +
        MODULES.join('|') + ' — item dropped');
      return null;
    }

    var name = text(raw.name);
    if (!name) note(rep.warnings, path + '.name', 'missing — the item renders unnamed');

    var flexibility = oneOf(raw.flexibility, FLEXIBILITIES, null);
    if (flexibility === null && raw.flexibility !== undefined && raw.flexibility !== null) {
      note(rep.defaulted, path + '.flexibility',
        JSON.stringify(raw.flexibility) + ' is not free|partial|prepaid — scored as 0, the zero-attribution default');
    }

    var partyMax = Math.max(1, num(opts.partySize, 1));

    var item = {
      id: text(raw.id, ID_MAX) || (path.replace(/[^a-z0-9]+/gi, '-')),
      module: module,
      name: name,
      est_price_usd: bounded(raw.est_price_usd, path + '.est_price_usd', rep, MONEY_MAX),
      est_price_local: bounded(raw.est_price_local, path + '.est_price_local', rep, SPEND_MAX),
      duration_hours: bounded(raw.duration_hours, path + '.duration_hours', rep, DURATION_MAX_HOURS),
      transit_min_from_prev: bounded(raw.transit_min_from_prev, path + '.transit_min_from_prev', rep, TRANSIT_MAX_MIN),
      attributes: cleanAttributes(raw.attributes, path + '.attributes', rep),
      alt_channel: cleanAltChannel(raw.alt_channel, path + '.alt_channel', rep),
      flexibility: flexibility === null ? '' : flexibility,
      advance_discount_pct: percentRate(raw.advance_discount_pct, path + '.advance_discount_pct', rep),
      area_median_rate_usd: bounded(raw.area_median_rate_usd, path + '.area_median_rate_usd', rep, MONEY_MAX),
      crowd_shift: cleanCrowdShift(raw.crowd_shift, path + '.crowd_shift', rep),
      weather_sensitive: bool(raw.weather_sensitive),
      // Ruling Q: covers feeds avoidedPlatformFees(); a party cannot dine with
      // more covers than it has people, so party size is the ceiling as well
      // as the fallback.
      covers: raw.covers === undefined || raw.covers === null
        ? 0
        : boundedInt(raw.covers, path + '.covers', rep, partyMax),
      tags: cleanTags(raw.tags, path + '.tags', rep),
      accessibility: cleanAccessibility(raw.accessibility, path + '.accessibility', rep),
      notes: text(raw.notes)
    };

    /* RULING AL — the venue-suitability claim, and AJ founder addition 1's
     * count that catches a model dropping it wholesale. */
    var suits = cleanSuits(raw.suits, path + '.suits', rep);
    item.suits = suits.list;
    item._suits_declared = suits.declared;

    /* RULING AP — the meal slot. PDF rule 6 organises dining by slot; work
     * order §5 dropped the whole Dining algorithm and this restores its
     * structure. Scoped to dining, on ruling AJ's module scoping: a boat is
     * not a meal and must never be routed into one.
     *
     * A dining item that is NOT a meal is ordinary and stays ordinary — a
     * cooking class, a gelato stop, a wine tasting. The slot is asked for
     * rather than inferred, and an undeclared one is never GUESSED, which is
     * the same discipline rulings Q, R, U, AJ, AL and AN share on their own
     * fields: what the model did not state, the bundle does not invent. */
    if (module === 'dining') {
      var meal = oneOf(raw.meal, Engines.MEAL_SLOTS, null);
      if (meal) {
        item.meal = meal;
        item._meal_declared = true;
      } else if (raw.meal !== undefined && raw.meal !== null) {
        note(rep.dropped, path + '.meal',
          JSON.stringify(raw.meal) + ' is not one of ' + Engines.MEAL_SLOTS.join('|') +
          ' — the item is kept and scheduled as an ordinary dining item (ruling AP)');
      }
    } else if (raw.meal !== undefined && raw.meal !== null) {
      /* Dropped BY NAME rather than by the generic unknown-field rule, so the
       * console says which rule fired — ruling AO's own reason for dropping
       * money keys by name in the intel validator. */
      note(rep.dropped, path + '.meal',
        'only a dining item can fill a meal slot — dropped (ruling AP)');
    }

    /* RULING AS ruling 1 — the trip leg, on ruling AP's exact shape one letter
     * later. Scoped to transportation the way `meal` is scoped to dining, and
     * dropped BY NAME off a non-transport item so the console says which rule
     * fired: a museum is not an arrival, whatever it declares.
     *
     * Asked for rather than inferred. The only other signal is the item's
     * NAME, and reading a leg out of "Airport limousine bus KIX to Kyoto
     * Station" would be the mistake ruling AL unpicked and ruling AP refused —
     * a field asked one question and answered with another — a third time,
     * failing silently on every airport code a pattern does not know. */
    if (module === 'transportation') {
      var leg = oneOf(raw.leg, Engines.TRIP_LEGS, null);
      if (leg) {
        /* NO `_leg_declared` STAMP, deliberately, and it is worth a line
         * because the field beside it has one. Rulings S, U, AJ and AL each
         * added a `_*_declared` stamp to carry a DECLARED-versus-ABSENT
         * distinction past validation, and each has a reader that needs it.
         * Nothing needs it here: absent means ordinary transport, declared
         * means a leg, and `item.leg` already says which. Adding a second
         * unread stamp beside AP's `_meal_declared` would be a thing that
         * looks like coverage — rulings AH, AJ and AR each deleted one. */
        item.leg = leg;
      } else if (raw.leg !== undefined && raw.leg !== null) {
        note(rep.dropped, path + '.leg',
          JSON.stringify(raw.leg) + ' is not one of ' + Engines.TRIP_LEGS.join('|') +
          ' — the item is kept and placed as ordinary transport (ruling AS)');
      }
    } else if (raw.leg !== undefined && raw.leg !== null) {
      note(rep.dropped, path + '.leg',
        'only a transportation item can be a trip leg — dropped (ruling AS)');
    }

    /* RULING AT items 1 and 2 — the two counts, taken here because this is the
     * one place every day item passes through exactly once.
     *
     * NEITHER DROPS ANYTHING AND NO BEHAVIOUR HANGS ON EITHER. They are counts
     * and nothing else, on ruling AS's own words for the count beside them:
     * what was missing was any way to KNOW. */
    rep.itemsTotal++;

    /* Both shapes of "declared no vector" together, because both produce the
     * same all-zero result and neither is visible downstream: `attributes`
     * absent (already noted by cleanAttributes) and `attributes` present but
     * carrying nothing — `{}`, or six explicit zeros. Read off the CLEANED
     * vector rather than the raw one, so a model sending `{"cultural": 0}`
     * counts the same as one sending `{}`. */
    var declaredFit = false;
    for (var ai = 0; ai < Engines.TASTE_DIMS.length; ai++) {
      if (item.attributes[Engines.TASTE_DIMS[ai]] > 0) { declaredFit = true; break; }
    }
    if (!declaredFit) rep.itemsWithoutAttributes++;

    if (module === 'stays') rep.stayModuleDayItems++;

    if (module === 'dining') {
      rep.diningTotal++;
      if (item.meal) rep.mealsDeclared++;
      /* RULING AS ruling 6. THREE SIGNALS TOGETHER, never one alone, and the
       * conjunction is what keeps this from firing on honest items: a real
       * hotel breakfast at no price still has a duration, a real venue that
       * suits nobody still has a duration, and a restaurant genuinely called
       * "No. 5" has both a duration and a suits claim. All three at once is a
       * non-item.
       *
       * "at no price" rather than the figure, and that is deliberate: §9.13's
       * Ledger Law scan is a RAW-SOURCE grep and correctly cannot tell a
       * comment from code, so the first draft of this sentence failed it. The
       * grep is not being taught to skip comments — it only ever over-reports,
       * which is the safe direction, and accommodating one sentence is how a
       * Ledger Law check stops being one. Ruling AP took the identical
       * decision on the identical scan.
       *
       * It is a COUNT and nothing else. The item is not dropped here and no
       * behaviour hangs on it — AL's subset test already removes it on a
       * restricted trip, and on an unrestricted one it is the model's own
       * answer to leave standing. What was missing was any way to KNOW. */
      if (!item.duration_hours && suits.declared && !suits.list.length &&
          /^no\s/i.test(item.name || '')) {
        rep.placeholderDining++;
        note(rep.warnings, path,
          'a dining item with no duration, no suitability and a name that ' +
          'begins by saying there is none — the prompt asks for real items ' +
          'only and states the gap itself (ruling AS)');
      }
      if (!suits.declared) {
        rep.diningWithoutSuits++;
        /* Not an error and not a drop: on a trip with no dietary need this
         * changes nothing at all, and on one that has a need the removal
         * itself is already reported by name in the day note and the
         * trip-level audit trail. What the count adds is the wholesale case,
         * which no single removal makes visible. */
        note(rep.warnings, path + '.suits',
          'a dining item did not say who it suits — it is unverified, so ' +
          'a declared dietary need removes it (ruling AL)');
      }
    }

    /* RULING AJ item 6 — the parent link. Held as a plain id; the cascade that
     * reads it runs trip-wide in score(), because the model may place a parent
     * and its child on different days. */
    var includedWith = text(raw.included_with, ID_MAX);
    if (includedWith) item.included_with = includedWith;

    // Engine-read fields §4 does not yet list — see the header block.
    if (raw.tickets !== undefined && raw.tickets !== null) {
      item.tickets = boundedInt(raw.tickets, path + '.tickets', rep, partyMax);
    }
    if (raw.min_age_years !== undefined && raw.min_age_years !== null) {
      item.min_age_years = bounded(raw.min_age_years, path + '.min_age_years', rep,
        Blueprint.KID_AGE_MAX_MONTHS / 12);
    }
    if (raw.pet_friendly !== undefined) item.pet_friendly = raw.pet_friendly === true;

    return item;
  }

  function cleanStay(raw, path, rep) {
    if (!isObject(raw)) {
      if (raw !== undefined && raw !== null) note(rep.dropped, path, 'not an object — no stay scored');
      else note(rep.defaulted, path, 'missing — no stay rows in the ledger');
      return null;
    }
    dropUnknown(raw, STAY_KEYS, path, rep);
    var flexibility = oneOf(raw.flexibility, FLEXIBILITIES, null);
    /* RULING AL item 6. AJ item 5 cleaned a `contains` claim here so a DECLARED
     * conflict could refuse the booking on ruling S's convention, while absence
     * could not — verified-or-drop on absence was scoped to dining, and a hotel
     * is not a meal.
     *
     * That balance does not survive the inversion, so the field is GONE from
     * the stay entirely. Under `contains` silence was the dangerous value and a
     * declaration was safe. Under `suits` it is the other way round: a hotel
     * with no restaurant honestly declares `[]`, and a subset test against any
     * stated need refuses the booking. AJ item 5's own sentence names what that
     * costs — the hollowing-out failure at the worst possible place, the
     * traveller with nowhere to sleep.
     *
     * The stay keeps accessibility, age and pet below, all three unchanged.
     * The narrowing is real and is recorded as a cost in ruling AL, not hidden:
     * the prompt still states the need as an absolute for the stay as well. */
    return {
      name: text(raw.name),
      nightly_direct_usd: bounded(raw.nightly_direct_usd, path + '.nightly_direct_usd', rep, MONEY_MAX),
      nightly_portal_usd: bounded(raw.nightly_portal_usd, path + '.nightly_portal_usd', rep, MONEY_MAX),
      nights: boundedInt(raw.nights, path + '.nights', rep, Blueprint.NIGHTS_MAX),
      commute_min_to_anchors: bounded(raw.commute_min_to_anchors, path + '.commute_min_to_anchors', rep, COMMUTE_MAX_MIN),
      flexibility: flexibility === null ? '' : flexibility,
      area_median_rate_usd: bounded(raw.area_median_rate_usd, path + '.area_median_rate_usd', rep, MONEY_MAX),
      locked_rate_usd: bounded(raw.locked_rate_usd, path + '.locked_rate_usd', rep, MONEY_MAX),
      flexible_rate_at_decision_usd: bounded(raw.flexible_rate_at_decision_usd, path + '.flexible_rate_at_decision_usd', rep, MONEY_MAX),
      /* Ruling S — on exactly the same terms as an item: ruling H's vector
       * semantics, ruling Q's verified-only accessibility, and tags so the
       * dietary reader set is complete. Before S the stay had none of these,
       * so its IdentityFit was structurally 0 and no accessibility predicate
       * could reach it. */
      attributes: cleanAttributes(raw.attributes, path + '.attributes', rep),
      accessibility: cleanAccessibility(raw.accessibility, path + '.accessibility', rep),
      tags: cleanTags(raw.tags, path + '.tags', rep),

      /* Ruling U — the stay faces the age and pet gates too, on ruling R's
       * terms. Left UNDEFINED when the model said nothing, because absence is
       * the signal both gates read: coercing it to a value here would answer
       * a question nobody asked. */
      pet_friendly: raw.pet_friendly === undefined ? undefined : raw.pet_friendly === true,
      min_age_years: raw.min_age_years === undefined || raw.min_age_years === null
        ? undefined
        : bounded(raw.min_age_years, path + '.min_age_years', rep, Blueprint.KID_AGE_MAX_MONTHS / 12),

      /* RULING AP ruling 2 — breakfast. `bool()` is `value === true`, so
       * every other value, and absence, mean NOT INCLUDED. That is the
       * ruling's own words and it is the safe direction: telling a traveller
       * breakfast is included when it is not sends them down to an empty
       * dining room, and the opposite error costs them one search.
       *
       * `_includes_breakfast_declared` is the AK/AL legacy signal on a ninth
       * field: a trip cached before AP declared nothing, and ruling S's
       * convention says the wording must place that on the TRIP's age rather
       * than on the hotel. */
      includes_breakfast: bool(raw.includes_breakfast),
      _includes_breakfast_declared: raw.includes_breakfast !== undefined,

      /* Which of the three were DECLARED at all. An empty answer and a
       * missing one both refuse the booking, but they are different facts
       * about the world — one is a stay nobody checked, the other is a trip
       * generated before the field existed — and ruling S requires the
       * traveller be told which. Only the wording differs. */
      _accessibility_declared: isObject(raw.accessibility),
      _pet_friendly_declared: raw.pet_friendly !== undefined,
      _min_age_declared: raw.min_age_years !== undefined && raw.min_age_years !== null
    };
  }

  function cleanSegment(raw, path, rep, opts) {
    if (!isObject(raw)) {
      note(rep.dropped, path, 'not an object — segment dropped');
      return null;
    }
    dropUnknown(raw, SEGMENT_KEYS, path, rep);
    var partyMax = Math.max(1, num(opts.partySize, 1));
    return {
      name: text(raw.name),
      direct_usd: bounded(raw.direct_usd, path + '.direct_usd', rep, MONEY_MAX),
      portal_usd: bounded(raw.portal_usd, path + '.portal_usd', rep, MONEY_MAX),
      tickets: boundedInt(raw.tickets, path + '.tickets', rep, partyMax),
      single_fare_usd: bounded(raw.single_fare_usd, path + '.single_fare_usd', rep, MONEY_MAX),
      planned_rides: boundedInt(raw.planned_rides, path + '.planned_rides', rep, RIDES_MAX),
      pass_price_usd: bounded(raw.pass_price_usd, path + '.pass_price_usd', rep, MONEY_MAX)
    };
  }

  /* ---------------------------------------------------------------------
   * validateGeneration(raw, opts) -> { ok, trip, report }
   *
   * The §7 contract in one function. `opts.partySize` bounds per-person
   * counts; `opts.hasPet` gates the ruling-A pet_paperwork block.
   * ------------------------------------------------------------------- */

  function validateGeneration(raw, options) {
    var opts = options || {};
    var rep = newReport();

    if (!isObject(raw)) {
      /* RULING AK. The `errors` channel is the ONE validator channel a
       * traveller reads — liveslice-results.js prints errors[0].detail through
       * stageError(). The ~50 dropped/clamped/defaulted/warning notes in this
       * file are console-only and keep their build-side vocabulary per §5f.
       * These three are the exception and are written for the screen. */
      note(rep.errors, 'root', 'the reply was not in a form this demo could read');
      return { ok: false, trip: null, report: rep };
    }
    dropUnknown(raw, ROOT_KEYS, 'root', rep);

    var tripBlock = isObject(raw.trip) ? raw.trip : null;
    if (!tripBlock) note(rep.defaulted, 'trip', 'missing — the itinerary renders without a destination header');
    else dropUnknown(tripBlock, TRIP_KEYS, 'trip', rep);

    var trip = {
      trip: {
        destination: tripBlock ? text(tripBlock.destination) : '',
        start: tripBlock ? isoDate(tripBlock.start) : '',
        end: tripBlock ? isoDate(tripBlock.end) : '',
        currency: tripBlock ? text(tripBlock.currency, 8) : '',
        // RULING AS ruling 1. A malformed time is DROPPED BY NAME rather than
        // by the generic unknown-field rule, so the console says which rule
        // fired — ruling AO's own reason for dropping money keys by name.
        arrival_time: tripBlock ? tripTime(tripBlock.arrival_time, 'trip.arrival_time', rep) : '',
        departure_time: tripBlock ? tripTime(tripBlock.departure_time, 'trip.departure_time', rep) : ''
      },
      days: [],
      stay: cleanStay(raw.stay, 'stay', rep),
      transport_segments: [],
      foreign_card_spend_estimate_usd: bounded(raw.foreign_card_spend_estimate_usd,
        'foreign_card_spend_estimate_usd', rep, SPEND_MAX),
      dcc_exposed_spend_usd: bounded(raw.dcc_exposed_spend_usd, 'dcc_exposed_spend_usd', rep, SPEND_MAX),
      // Engine-input-only, fixed for a generated trip (RULINGS §2). Set here
      // rather than left undefined so buildLedger() shows the zero-valued lines rather
      // than hiding them (ruling C).
      net_budget_usd: 0,
      fees_usd: 0
    };

    // days
    var rawDays = isArray(raw.days) ? raw.days : [];
    if (!isArray(raw.days)) {
      note(rep.errors, 'days', 'the reply carried no days, so there is no trip to build');
    }
    if (rawDays.length > DAYS_MAX) {
      note(rep.clamped, 'days', rawDays.length + ' days supplied — kept the first ' + DAYS_MAX);
    }
    rawDays.slice(0, DAYS_MAX).forEach(function (rawDay, di) {
      var path = 'days[' + di + ']';
      if (!isObject(rawDay)) { note(rep.dropped, path, 'not an object — day dropped'); return; }
      dropUnknown(rawDay, ['date', 'items'], path, rep);
      var rawItems = isArray(rawDay.items) ? rawDay.items : [];
      if (!isArray(rawDay.items)) note(rep.defaulted, path + '.items', 'missing — day has no items');
      if (rawItems.length > ITEMS_PER_DAY_MAX) {
        note(rep.clamped, path + '.items', rawItems.length + ' items supplied — kept the first ' + ITEMS_PER_DAY_MAX);
      }
      var items = [];
      rawItems.slice(0, ITEMS_PER_DAY_MAX).forEach(function (rawItem, ii) {
        var item = cleanItem(rawItem, path + '.items[' + ii + ']', rep, opts);
        if (item) items.push(item);
      });
      trip.days.push({ date: isoDate(rawDay.date), items: items });
    });

    // transport segments
    var rawSegments = isArray(raw.transport_segments) ? raw.transport_segments : [];
    if (raw.transport_segments !== undefined && !isArray(raw.transport_segments)) {
      note(rep.dropped, 'transport_segments', 'not an array — dropped');
    }
    if (rawSegments.length > SEGMENTS_MAX) {
      note(rep.clamped, 'transport_segments', rawSegments.length + ' segments supplied — kept the first ' + SEGMENTS_MAX);
    }
    rawSegments.slice(0, SEGMENTS_MAX).forEach(function (rawSeg, si) {
      var seg = cleanSegment(rawSeg, 'transport_segments[' + si + ']', rep, opts);
      if (seg) trip.transport_segments.push(seg);
    });

    // ruling A: pet_paperwork only when the pet toggle is on
    if (raw.pet_paperwork !== undefined && raw.pet_paperwork !== null) {
      if (!opts.hasPet) {
        note(rep.dropped, 'pet_paperwork',
          'supplied for a trip with no pet — dropped (ruling A: the expediter row fires only when the pet toggle is on)');
      } else if (!isObject(raw.pet_paperwork)) {
        note(rep.dropped, 'pet_paperwork', 'not an object — dropped');
      } else {
        dropUnknown(raw.pet_paperwork, PET_PAPERWORK_KEYS, 'pet_paperwork', rep);
        trip.pet_paperwork = {
          expediter_quote_usd: bounded(raw.pet_paperwork.expediter_quote_usd, 'pet_paperwork.expediter_quote_usd', rep, MONEY_MAX),
          official_fee_usd: bounded(raw.pet_paperwork.official_fee_usd, 'pet_paperwork.official_fee_usd', rep, MONEY_MAX)
        };
      }
    }

    /* §3: DCC-exposed spend is a DISTINCT AND SMALLER quantity than total
     * foreign spend. Being outside the 36-55% band is only a warning, because
     * the band is calibration, not a hard rule.
     *
     * RULING AN — THE SUBSET IS STRICT, AND `>=` IS THE WHOLE POINT.
     *
     * This clamped on `dcc > foreign` and let EQUALITY through with a console
     * warning. §3's prompt forbids it in terms ("must never be set equal to
     * it"), but a prompt is not an enforcement: a model that sent the two
     * equal put BOTH payment rows on the SAME dollars, and the ledger
     * attributed 3% + 3.5% = 6.5% against one dollar of spend, twice. The
     * founder's own trip passed on the model's good manners, not on a
     * guarantee.
     *
     * Ruled (i): equality is not a smaller quantity, so there is no exposed
     * spend to attribute against. The field goes to zero, avoidedDcc() then
     * returns null on `spend <= 0`, and the row is WITHHELD. That is work
     * order §7's own default — a malformed field defaults to a value that
     * produces zero attribution, never a fabricated saving — and it is the
     * verified-or-drop direction rulings P, Q, R, U, AJ and AL all share,
     * applied to a sixth field.
     *
     * Readings (ii) keep-and-warn and (iii) clamp to DCC_RATIO_HIGH_PCT were
     * both put and REJECTED. (iii) is the tempting one, because the band
     * constant already exists so it invents no constant — but it invents the
     * FIGURE, and a Romieaux-chosen ratio underneath an attributed dollar is
     * exactly what the Ledger Law exists to prevent.
     *
     * The FX row is untouched by this. Total foreign spend is still a real
     * estimate of real spending; it is the SUBSET that could not be verified.
     */
    var foreign = trip.foreign_card_spend_estimate_usd;
    var dcc = trip.dcc_exposed_spend_usd;
    if (foreign > 0 && dcc >= foreign) {
      note(rep.dropped, 'dcc_exposed_spend_usd',
        'DCC-exposed spend ($' + dcc + ') is not smaller than total foreign spend ($' + foreign +
        ') — §3 requires a distinct, smaller quantity, so it cannot be told apart from the foreign ' +
        'spend the FX row already claims. Dropped to zero attribution (work order §7); the DCC row ' +
        'is withheld rather than counted against dollars twice (ruling AN)');
      trip.dcc_exposed_spend_usd = 0;
      dcc = 0;
    }
    if (foreign > 0 && dcc > 0) {
      var ratioPct = Math.round((dcc / foreign) * 100);
      var low = (typeof LiveSliceAPI !== 'undefined' && LiveSliceAPI) ? LiveSliceAPI.DCC_RATIO_LOW_PCT : 36;
      var high = (typeof LiveSliceAPI !== 'undefined' && LiveSliceAPI) ? LiveSliceAPI.DCC_RATIO_HIGH_PCT : 55;
      if (ratioPct < low || ratioPct > high) {
        note(rep.warnings, 'dcc_exposed_spend_usd',
          'is ' + ratioPct + '% of foreign spend, outside the ' + low + '–' + high + '% calibration band (§3)');
      }
    }

    var itemCount = trip.days.reduce(function (n, d) { return n + d.items.length; }, 0);
    if (!itemCount) note(rep.errors, 'days', 'nothing in the reply could be used');

    return { ok: rep.errors.length === 0, trip: trip, report: rep };
  }

  /* ---------------------------------------------------------------------
   * Hard-constraint post-filter (work order §7)
   *
   * engines.applyHardFilters() decides; this wrapper names the specific hard
   * line or accessibility key that fired, because "removed for a dietary hard
   * line" is not actionable in a QA log and "removed: 'nut' matched 'coconut
   * tart'" is. Ruling P's over-removal is meant to be visible.
   * ------------------------------------------------------------------- */

  /* RULING AL. SUPERSEDES AJ's three-armed `contains` verdict, which itself
   * superseded ruling P's join of name + notes + tags.
   *
   * It must agree with engines.violatesDietary() on every input, because the
   * predicate DECIDES and this EXPLAINS — a divergence would show up as a
   * removal with no explanation rather than as a wrong one. The two return
   * shapes below are the two ways a need goes unmet, and both are removals:
   *
   *   'unstated'  — the dining item never said who it suits
   *   'unsuited'  — it said, and the stated need is not among them
   *
   * `term` is the FIRST unmet need in the traveller's own list. AJ named the
   * one restriction token that fired and AL keeps that convention: one venue,
   * one sentence, and the console keeps the full list. AJ's third arm,
   * 'unintelligible', is retired with the family rule it enforced — see the
   * block above engines.violatesDietary() for why it has nothing to bite on.
   *
   * Returns null when every stated need is met. */
  function dietaryConflict(item, needs) {
    if (!(needs || []).length) return null;
    var it = item || {};

    /* AJ's module scoping, unchanged — and under AL item 6 this is also what
     * keeps the booked stay out, since a stay carries no `module`. */
    if (it.module !== 'dining') return null;

    var declared = it._suits_declared !== undefined
      ? it._suits_declared === true
      : isArray(it.suits);

    var tokens = (isArray(it.suits) ? it.suits : []).map(function (t) {
      return String(t === null || t === undefined ? '' : t).trim().toLowerCase();
    }).filter(function (t) { return !!t; });

    for (var i = 0; i < needs.length; i++) {
      var need = String(needs[i] || '').trim().toLowerCase();
      if (!need || tokens.indexOf(need) !== -1) continue;
      return { kind: declared ? 'unsuited' : 'unstated', term: need };
    }
    return null;
  }

  /* Kept as a named helper because the ledger-side callers and the harness
   * both read "which need fired" rather than the whole verdict. RULING AL
   * widens it from AJ's 'conflict'-only arm: under AL both dispositions are a
   * named need going unmet, and neither is more of a match than the other. */
  function matchedDietaryTerm(item, needs) {
    var verdict = dietaryConflict(item, needs);
    return verdict ? verdict.term : null;
  }

  function unmetAccessibilityKeys(item, needs) {
    var provided = (item && item.accessibility) || {};
    return (needs || []).filter(function (key) { return provided[key] !== true; });
  }

  /* VOCABULARY. `entry.reason` is an INTERNAL token — it is a branch key here
   * and in the day loop, and it is what `logResult()` prints for QA, so "hard
   * line" survives in code and console exactly as it always has. `detail` is
   * the opposite: it is prose the traveller reads on the results screen. Since
   * amendment AA the intake calls these "dietary restrictions", so the detail
   * says that too. One term everywhere the user reads, the internal token
   * untouched. The render layer maps the token for display; see REMOVAL_LABEL
   * in liveslice-results.js. */
  function explainRemoval(entry, engineInput) {
    var item = entry.item;
    if (entry.reason === 'dietary hard line') {
      /* RULING AL. Two removals wear this reason now, down from AJ's three,
       * and they are two different facts about the world, so the traveller is
       * told which. Both sentences are per-need and come from the preset the
       * traveller chose, so a kosher removal reads "is not kosher-certified"
       * rather than a generic conflict — which is the whole point of asking
       * the suitability question instead of the ingredient one.
       *
       * The phrases live in Blueprint.DIETARY_PRESETS beside the keys, so the
       * chip the traveller tapped and the sentence they read afterwards have
       * one definition. */
      var verdict = dietaryConflict(item, engineInput.dietary_needs);
      var preset = verdict ? Blueprint.presetFor(verdict.term) : null;
      if (verdict && verdict.kind === 'unstated') {
        /* RULING AK item 6, on ruling S's convention, CARRIED BY AL with its
         * wording amended: dishes are no longer what is checked. Same removal,
         * two different facts about the world, so the traveller is told which:
         * a venue that did not say, or a trip that predates the check. */
        return engineInput._legacy_dietary
          ? 'was saved before Romieaux started checking which venues suit you, so it cannot be checked against your dietary needs now'
          : (preset ? preset.unstated : 'does not say who it suits');
      }
      return preset ? preset.unsuited : 'does not suit your dietary needs';
    }
    /* RULING AJ item 6. The child names its parent, because "removed" with no
     * parent named reads as a second independent failure rather than as the
     * consequence of the one above it. */
    if (entry.reason === 'included with a removed item') {
      return 'included with "' + (entry.parentName || entry.parentId) +
        '", which was removed';
    }
    if (entry.reason === 'accessibility predicate') {
      var unmet = unmetAccessibilityKeys(item, engineInput.accessibility_needs);
      // RULING AK: em dash out, and "unverified" said in the traveller's words.
      return 'not confirmed for: ' + unmet.join(', ') + '. Anything not confirmed is left out';
    }
    if (entry.reason === 'kids age gate') {
      return 'minimum age ' + num(item.min_age_years, 0) + ' excludes a child on this trip';
    }
    if (entry.reason === 'pet constraint') {
      return 'explicitly not pet-friendly';
    }
    return entry.reason;
  }

  /* RULING S — the booked stay is filtered like any other option, with one
   * refinement that exists because it is not like any other option: there is
   * exactly one of it, and the traveller sleeps there every night.
   *
   *   - Silently KEEPING a stay that fails a declared hard predicate is the
   *     failure ruling S was written to end. Not an option.
   *   - Silently DELETING it takes the stay's ledger rows with it and leaves
   *     the traveller staring at an itinerary with nowhere to sleep and no
   *     explanation. Also not an option.
   *   - So it is REFUSED AS BOOKED: no stay rows reach the ledger, and the
   *     results screen says so, naming the predicate that failed.
   *
   * RULING U completes it: the stay now carries `pet_friendly` and
   * `min_age_years` too, so ALL FOUR predicates run against it, in the same
   * order engines.applyHardFilters() uses for an item — dietary,
   * accessibility, age, pet. Before U the last two were skipped because the
   * stay had no fields to satisfy them, which left the hotel the pet actually
   * sleeps in checked by the prompt alone.
   *
   * A trip cached before S or U carries none of these fields. For a traveller
   * who declared the matching constraint that is a refusal too — unverified is
   * unverified — but the wording says the trip predates the check rather than
   * implying the hotel was found wanting. Refused, never deleted. */
  function filterStay(stay, engineInput) {
    if (!stay) return null;

    function refusal(reason, detail) {
      return { stay: stay, reason: reason, detail: detail };
    }

    /* RULING AL item 6 — THE DIETARY ARM IS GONE FROM HERE, and its absence is
     * deliberate rather than an oversight.
     *
     * AJ item 5 ran a declared-only `contains` check on the stay: a declared
     * conflict refused the booking on ruling S's convention, absence did not.
     * Under `suits` that inverts. A hotel with no restaurant honestly declares
     * `[]`, and a subset test against any stated need would refuse it — so the
     * check would fire on ordinary hotels rather than on unsuitable ones. AJ
     * item 5's own reasoning is what rules it out: refusing every hotel on
     * every restricted trip is the hollowing-out failure at the worst possible
     * place, the traveller with nowhere to sleep.
     *
     * `suits` is therefore neither asked of the stay (STAY_KEYS, SCHEMA_TEXT)
     * nor read from it, and engines.violatesDietary()'s module arm returns
     * false for a stay in any case, since a stay carries no `module`. The
     * three gates below are unchanged; rulings S and U are otherwise intact.
     * The narrowing is recorded as a cost in ruling AL, not hidden. */

    if (Engines.violatesAccessibility(stay, engineInput.accessibility_needs)) {
      var unmet = unmetAccessibilityKeys(stay, engineInput.accessibility_needs);
      return refusal('accessibility predicate',
        stay._accessibility_declared
          ? 'not confirmed for: ' + unmet.join(', ') + '. Anything not confirmed is not booked'
          : 'this trip was generated before the stay carried accessibility details, so ' +
            unmet.join(', ') + ' was never verified');
    }

    // Ruling U + R: a declared minimum is read as a minimum; an absent one is
    // read through the same plausibility signal an item gets, so an
    // adults-only resort is refused and an unsignalled hotel is not.
    if (Engines.violatesAgeGate(stay, engineInput.kid_ages_months)) {
      return refusal('kids age gate',
        stay._min_age_declared
          ? 'minimum age ' + num(stay.min_age_years, 0) + ' excludes a child on this trip'
          : 'its name or tags mark it as age-restricted and no minimum age was stated, ' +
            'so it is unverified for the children on this trip');
    }

    // Ruling U + R: verified-or-drop, with no plausibility limiter — every
    // stay either does or does not take the pet.
    if (Engines.violatesPetConstraint(stay, engineInput.has_pet)) {
      return refusal('pet constraint',
        stay._pet_friendly_declared
          ? 'verified as not accepting pets'
          : 'pet acceptance was never stated for this stay, so it is unverified ' +
            'for the pet on this trip');
    }

    return null;
  }

  function filterItems(items, engineInput) {
    var result = Engines.applyHardFilters(items, engineInput);
    var removed = result.removed.map(function (entry) {
      return {
        item: entry.item,
        reason: entry.reason,
        detail: explainRemoval(entry, engineInput)
      };
    });
    return { kept: result.kept, removed: removed };
  }

  /* ---------------------------------------------------------------------
   * Scoring
   * ------------------------------------------------------------------- */

  /* A stay CANDIDATE arrives as a day item (module 'stays'); the Stays score
   * reads the top-level stay shape. This adapter maps one onto the other so
   * both go through the same engines.staysScore(), which is what makes "stay
   * options compared" a real, countable number rather than a guess. */
  function stayShapeFromItem(item) {
    var alt = item.alt_channel || {};
    return {
      name: item.name,
      nightly_direct_usd: item.est_price_usd,
      nightly_portal_usd: alt.type === 'portal' ? alt.price_usd : 0,
      nights: 0,
      commute_min_to_anchors: item.transit_min_from_prev,
      flexibility: item.flexibility,
      area_median_rate_usd: item.area_median_rate_usd
    };
  }

  function hasWellnessTag(item) {
    var tags = (item && item.tags) || [];
    for (var i = 0; i < tags.length; i++) {
      for (var j = 0; j < WELLNESS_TAGS.length; j++) {
        if (tags[i].indexOf(WELLNESS_TAGS[j]) !== -1) return true;
      }
    }
    return false;
  }

  /* The two item-level Ledger Law detectors, called with exactly the
   * arguments buildLedger() uses. Same functions, same inputs, so the rows
   * attached to an item for its tooltip ARE the rows the ledger carries —
   * attribution by construction rather than by matching after the fact. */
  function itemRows(item, partySize) {
    var rows = [];
    if (item.module === 'activities') {
      var advance = Engines.savesAdvancePurchase(item, num(item.tickets, partySize));
      if (advance) rows.push(advance);
    }
    if (item.module === 'dining') {
      var platform = Engines.avoidedPlatformFees(item, num(item.covers, partySize));
      if (platform) rows.push(platform);
    }
    return rows;
  }

  /* ---------------------------------------------------------------------
   * decisions_automated — RULINGS §4, rulings 1–4 and amendments 1–2
   *
   * 1. Mirror the canonical da-* taxonomy exactly: same category vocabulary,
   *    same reconciling law (stated count === sum of tooltip rows).
   * 2. Structurally-zero rows are OMITTED, not shown as zero.
   * 3. The honestly-smaller count is correct. Do not inflate it.
   * 4. Every count comes from real countable engine work; a category that
   *    cannot be derived is omitted.
   *
   * AMENDMENT 1 — MODEL-CLAIMED WORK IS NOT COUNTABLE WORK.
   *   No count is ever the length of something the model sent. "Stay options
   *   compared" counts staysScore() CALLS, incremented on the line after the
   *   call; six alternates in the JSON of which the pipeline scores none
   *   contribute nothing, and the category is then omitted entirely. The same
   *   discipline applies to every counter below: each is incremented at the
   *   site of the work, never derived from an array length.
   *
   * AMENDMENT 2 — ONE EVALUATION, ONE CATEGORY.
   *   Every evaluated decision belongs to exactly one category. Two rules
   *   keep that true:
   *
   *   (a) CANDIDATE PRECEDENCE. Scoring a candidate is ONE decision, so it is
   *       claimed by exactly one category, first match wins:
   *
   *           stays  >  dining  >  wellness-tagged  >  transportation  >
   *           everything else (the pacing bucket)
   *
   *       A spa hotel is a stay decision, not a wellness one. A wellness-
   *       tagged restaurant is a restaurant decision. An activity is a pacing
   *       decision. candidateCategory() is the single place this is decided.
   *
   *   (b) NON-CANDIDATE EVALUATIONS are distinct decisions about something
   *       other than a candidate's fit, and each belongs to one category:
   *
   *           dietary hard-line removal   -> Restaurant vetting
   *           priced-channel comparison   -> Transport routes   (a segment,
   *                                          not a candidate)
   *           age-gate evaluation         -> Family pacing & kid protocols
   *           pet-constraint evaluation   -> Pet travel logistics
   *           covers / tickets resolution -> Group & milestone coordination
   *
   *       A removed candidate is never scored, so a dietary removal cannot
   *       also appear as a scored candidate. The gate evaluations are counted
   *       only where engines.applyHardFilters() actually reaches them: its
   *       predicate chain short-circuits, so an item removed for a dietary
   *       line never had its age gate run and is not counted as though it had.
   *
   *   Consequences worth stating: a candidate's weather sensitivity is
   *   examined as part of the same pacing decision and is NOT counted again;
   *   a day-pack placement is that same pacing decision and is NOT counted
   *   again; and a suppressed stay alternate is counted nowhere, because
   *   staysScore() never weighed it (amendment 1).
   *
   * OMITTED IN v1, with the reason:
   *   Card-routing decisions   ruling 2 — no card facts in the Blueprint, so
   *                            no payment records are routed. Zero, omitted.
   *   Safety & cultural prep   ruling 4 — this build evaluates no safety
   *                            predicate (engines.alertFires() is never
   *                            reached: nothing generates alerts in v1), so
   *                            there is nothing real to count.
   * ------------------------------------------------------------------- */

  var CATEGORY_LABELS = {
    stays: 'Stay options compared',
    dining: 'Restaurant vetting',
    wellness: 'Wellness venue vetting',
    transport: 'Transport routes',
    weather: 'Weather & pacing checks',
    family: 'Family pacing & kid protocols',
    pet: 'Pet travel logistics',
    group: 'Group & milestone coordination'
  };

  /* Order mirrors the canonical lifetime tooltip: the biggest buckets first,
   * the trip-shape-dependent ones last. It is also the candidate precedence
   * order of amendment 2(a) for the first five. */
  var CATEGORY_ORDER = ['stays', 'dining', 'wellness', 'transport', 'weather', 'family', 'pet', 'group'];

  /* The counter each category reads. One counter per category for candidate
   * work, so a candidate counted into one can never be counted into another. */
  var CANDIDATE_COUNTER = {
    stays: 'staysScored',
    dining: 'diningScored',
    wellness: 'wellnessScored',
    transport: 'transportScored',
    weather: 'pacingScored'
  };

  /* Amendment 2(a). The single place a scored candidate is assigned to a
   * category. First match wins, and there is no second match. */
  function candidateCategory(item) {
    if (item.module === 'stays') return 'stays';
    if (item.module === 'dining') return 'dining';
    if (hasWellnessTag(item)) return 'wellness';
    if (item.module === 'transportation') return 'transport';
    return 'weather';                     // activities: the pacing bucket
  }

  function newWork() {
    return {
      // candidate work — exactly one of these per scored candidate
      staysScored: 0,          // staysScore() CALLS (amendment 1)
      diningScored: 0,
      wellnessScored: 0,
      transportScored: 0,
      pacingScored: 0,
      // non-candidate evaluations — each owned by one category
      dietaryRemovals: 0,
      transportChannelsCompared: 0,
      ageGateEvaluations: 0,
      petEvaluations: 0,
      coordinationChecks: 0
    };
  }

  function deriveDecisions(work, interventionCount) {
    var counts = {};
    CATEGORY_ORDER.forEach(function (key) { counts[key] = 0; });

    counts.stays = work.staysScored;
    counts.dining = work.diningScored + work.dietaryRemovals;
    counts.wellness = work.wellnessScored;
    counts.transport = work.transportScored + work.transportChannelsCompared;
    counts.weather = work.pacingScored;
    counts.family = work.ageGateEvaluations;
    counts.pet = work.petEvaluations;
    counts.group = work.coordinationChecks;

    var rows = [];
    CATEGORY_ORDER.forEach(function (key) {
      // Ruling 2: a structurally-zero category is omitted, never shown as 0.
      if (counts[key] > 0) rows.push({ key: key, label: CATEGORY_LABELS[key], count: counts[key] });
    });

    var sum = rows.reduce(function (n, r) { return n + r.count; }, 0);

    /* The floor. Each intervention took at least one decision, so the count
     * can never honestly be below the intervention count.
     *
     * When the floor binds, the breakdown is INCOMPLETE — some intervention
     * was detected from work no canonical category covers (in practice only
     * the two payment rows, AVOIDED FX and AVOIDED DCC, which belong to the
     * card-routing category ruling 2 omits). Inflating a category to close
     * the gap would violate ruling 4, and publishing a breakdown that does
     * not sum to its own total would violate ruling 1. So the breakdown is
     * withheld and only the floor is stated — and it is logged, because a
     * withheld breakdown is a question for the founder, not a silent
     * degradation. See the P4 conflict report, ruling R(c). */
    var floorApplied = sum < interventionCount;
    return {
      rows: floorApplied ? [] : rows,
      counts: counts,
      total: floorApplied ? interventionCount : sum,
      derivedTotal: sum,
      interventionCount: interventionCount,
      floorApplied: floorApplied
    };
  }

  /* ---------------------------------------------------------------------
   * score(rawTrip, blueprint, options) -> the whole P4 pipeline
   *
   * The order is the work order's: schema validation -> hard filters ->
   * scoring -> intervention detection -> (render, in liveslice-results.js).
   * ------------------------------------------------------------------- */

  function score(rawTrip, blueprint, options) {
    var opts = options || {};
    var bp = blueprint || {};
    var engineInput = Blueprint.toEngineInput(bp);
    var ctx = Blueprint.toScoringContext(bp);
    var partySize = Math.max(1, num(engineInput.party_size, 1));

    var validation = validateGeneration(rawTrip, {
      partySize: partySize,
      hasPet: !!engineInput.has_pet
    });

    if (!validation.ok) {
      return {
        ok: false,
        validation: validation.report,
        trip: validation.trip,
        blueprint: bp,
        days: [],
        removals: [],
        suppressed: [],
        ledger: null,
        decisions: null,
        legacyDietary: false
      };
    }

    var trip = validation.trip;

    /* RULING AK item 6 — the §5a item ruling AJ recorded and did not fix.
     * CARRIED BY RULING AL, and it now covers a SECOND schema generation.
     *
     * A generation cached before AJ carries no dietary claim at all; one
     * cached between AJ and AL carries `contains`, which AL's validator does
     * not accept, so it is dropped as an unknown field and the item is
     * unstated just the same. BOTH are pre-AL caches and both are correctly
     * removed — the dining items genuinely are unverified against a question
     * nobody asked them. What AK fixed, and AL keeps, is the wording: the trip
     * predates the check, rather than the restaurant having been found
     * wanting. Ruling S drew exactly this distinction for legacy STAY caches.
     *
     * The test is deliberately narrow, and all four clauses are load-bearing:
     * it is a REPLAY (so this is a statement about the cache, not about the
     * model), a need is declared (so the wording is reached at all), there are
     * dining items to judge, and EVERY one of them omitted the field. A fresh
     * generation that dropped the field, or a cached trip that declared it on
     * some items, is a different fact and keeps AL's wording — which is also
     * what stops this becoming an excuse a non-compliant model can hide
     * behind.
     *
     * Carried on engineInput under the `_` convention the validator already
     * uses for `_suits_declared` and `_accessibility_declared`, so
     * explainRemoval() reads it without a second parameter threaded through
     * four call sites. engineInput is built fresh per score() call. */
    var rep = validation.report;
    engineInput._legacy_dietary = opts.source === 'replay' &&
      (engineInput.dietary_needs || []).length > 0 &&
      rep.diningTotal > 0 &&
      rep.diningWithoutSuits === rep.diningTotal;

    /* --- work counters. Every one is incremented at the site of the real
     * work, never from the length of something the model sent (amendment 1),
     * and each evaluation increments exactly one of them (amendment 2). */
    var work = newWork();

    var hasKids = (engineInput.kid_ages_months || []).length > 0;
    var hasPet = !!engineInput.has_pet;
    var isCoordinated = partySize >= 3 || bp.trip_type === 'milestone';

    var removals = [];
    var suppressed = [];
    /* RULING AR. The meal slots the floor WOULD have emptied, counted
     * separately from `suppressed` and never folded into it.
     *
     * This is AJ founder addition 1's mechanism on a fourth field, and AO's on
     * its ungrounded tracks: ruling AR's own failure mode is a model that
     * describes every meal honestly and low, and the answer is that it is
     * caught by a NUMBER rather than by a hollow itinerary. Ten identical
     * breakfasts at fit 18 is a fact somebody should be able to read off one
     * console line, not reconstruct from a screenshot.
     *
     * Kept OUT of `suppressed` deliberately: these items ARE on the trip, and
     * the results footer counts `suppressed` to tell the traveller what is
     * not. Folding them in would say a scheduled breakfast was removed. */
    var mealSlotsHeld = [];
    var stayCandidates = [];
    var days = [];

    /* (1b) RULING AJ item 6 — the parent/child cascade.
     *
     * Run TRIP-WIDE and BEFORE the per-day loop, for two reasons. The model
     * may place a parent and its child on different days, so a per-day pass
     * would miss exactly the case that produced the defect. And the cascade
     * must settle before anything is scored: an item that will be removed
     * must never reach identityFit(), packDay() or a ledger row, which is the
     * same rule §5c states for every hard-filter removal.
     *
     * The pass is a fixpoint with a hard iteration bound. `included_with` is
     * untrusted input like every other field, so a cycle (a -> b -> a) or a
     * self-reference is assumed possible; the bound is the number of items,
     * which is strictly more passes than any acyclic chain can need, and a
     * cycle simply stops adding.
     *
     * COUNTED IN NO DECISIONS CATEGORY. A cascade removal is not a dietary
     * evaluation, and inflating dietaryRemovals with it would break ruling 4.
     * §5c's "accessibility-predicate evaluations are counted in no category"
     * is the precedent. This is also what keeps `reachedAgeGate` correct
     * below: a cascade-removed item DID reach the age and pet gates, because
     * applyHardFilters() kept it. */
    var predicateFiltered = trip.days.map(function (day) {
      return filterItems(day.items, engineInput);
    });

    var removedIds = {};
    var itemsById = {};
    predicateFiltered.forEach(function (f) {
      f.removed.forEach(function (entry) {
        if (entry.item && entry.item.id) removedIds[entry.item.id] = entry.item;
      });
      f.kept.forEach(function (item) { if (item.id) itemsById[item.id] = item; });
    });
    trip.days.forEach(function (day) {
      (day.items || []).forEach(function (item) {
        if (item && item.id && !itemsById[item.id]) itemsById[item.id] = item;
      });
    });

    var cascadeRemovals = {};
    var totalItems = trip.days.reduce(function (n, d) { return n + d.items.length; }, 0);
    for (var pass = 0; pass < totalItems; pass++) {
      var addedThisPass = 0;
      predicateFiltered.forEach(function (f) {
        f.kept.forEach(function (item) {
          if (!item.included_with || cascadeRemovals[item.id]) return;
          var parentId = item.included_with;
          /* A self-reference needs no special case, and a line guarding
           * against one would be UNREACHABLE — which is worse than absent,
           * because it reads as coverage. Proven by biting: removing such a
           * guard changed nothing. An item pointing at itself is either in
           * `kept`, in which case its own id is by definition not in
           * `removedIds` and the test below is simply false, or it was removed
           * by a predicate, in which case it is not in `kept` and this loop
           * never sees it. Mutual cycles are handled by the fixpoint instead:
           * a pass that adds nothing ends it. */
          if (removedIds[parentId] || cascadeRemovals[parentId]) {
            var parent = removedIds[parentId] || itemsById[parentId];
            cascadeRemovals[item.id] = {
              parentId: parentId,
              parentName: (parent && parent.name) || parentId
            };
            addedThisPass++;
          }
        });
      });
      if (!addedThisPass) break;
    }

    trip.days.forEach(function (day, di) {
      // (2) hard-constraint post-filter, before anything is scored. An option
      // failing a hard predicate never appears at all (PDF rule 41).
      var filtered = predicateFiltered[di];

      /* Ruling AJ item 6: move the cascaded children out of `kept` and into
       * `removed`, with the parent named, so every downstream reader — the
       * day note, the trip-level audit trail, the packer and the ledger —
       * sees exactly one removal set and needs no knowledge of the cascade. */
      var cascaded = [];
      filtered.kept = filtered.kept.filter(function (item) {
        var hit = cascadeRemovals[item.id];
        if (!hit) return true;
        var entry = {
          item: item,
          reason: 'included with a removed item',
          parentId: hit.parentId,
          parentName: hit.parentName
        };
        entry.detail = explainRemoval(entry, engineInput);
        cascaded.push(entry);
        return false;
      });
      filtered.removed = filtered.removed.concat(cascaded);

      var removedBy = { dietary: 0, accessibility: 0, age: 0, pet: 0 };
      filtered.removed.forEach(function (entry) {
        entry.day = di;
        removals.push(entry);
        if (entry.reason === 'dietary hard line') { removedBy.dietary++; work.dietaryRemovals++; }
        else if (entry.reason === 'accessibility predicate') removedBy.accessibility++;
        else if (entry.reason === 'kids age gate') removedBy.age++;
        else if (entry.reason === 'pet constraint') removedBy.pet++;
      });

      /* Amendment 2(b): count the gate evaluations that actually RAN.
       * engines.applyHardFilters() is an else-if chain — dietary, then
       * accessibility, then the age gate, then the pet gate — so an item
       * removed by an earlier predicate never reached the later ones and is
       * not counted as though it had. The dietary removals themselves belong
       * to Restaurant vetting, not to either gate category. */
      var reachedAgeGate = day.items.length - removedBy.dietary - removedBy.accessibility;
      var reachedPetGate = reachedAgeGate - removedBy.age;
      if (hasKids) work.ageGateEvaluations += reachedAgeGate;
      if (hasPet) work.petEvaluations += reachedPetGate;

      // (3) scoring
      var scored = [], stays = [];
      filtered.kept.forEach(function (item) {
        var fit = Engines.identityFit(item, ctx.tasteVector);
        /* RULING AR. bandFor() knows which module's rule reaches the item;
         * fitBand() only knows the two thresholds. A meal slot is ranked by
         * PDF rule 6 and rule 6 has no suppression step, so a meal slot never
         * comes back 'suppress'. Everything else is fitBand() unchanged. */
        var band = Engines.bandFor(item, fit);
        if (band !== 'suppress' && Engines.fitBand(fit) === 'suppress') {
          mealSlotsHeld.push({ item: item, fit: fit, day: di, meal: Engines.mealSlot(item) });
        }
        var category = candidateCategory(item);
        var entry = {
          item: item,
          fit: fit,
          band: band,
          category: category,
          roi: Engines.experienceROI(item, { identityFit: fit, hourlyRate: ctx.hourlyRate }),
          rows: []
        };

        /* Work order §7: no item below IdentityFit 35 is rendered as a
         * recommendation. Suppressed items leave the pipeline here — they are
         * never packed, never priced on screen and never produce a ledger row.
         *
         * RULING AR SCOPES §7's SENTENCE, and does not amend it. §7 states the
         * floor globally; PDF rule 6 ranks a meal slot and names no
         * suppression step. `band` is now bandFor()'s, so a meal slot cannot
         * reach this branch and the slot is decided by REDUCED RULE 6 in
         * packDay() — which is where AP put that decision and where it stays.
         * FIT_SUPPRESS is unmoved at 35 and still gates rule 11 here. */
        if (band === 'suppress') {
          // The fit score was real work, so it still counts once, in the one
          // category that owns it — except for a stay, whose decision is the
          // staysScore() comparison below, which never ran (amendment 1).
          if (category !== 'stays') work[CANDIDATE_COUNTER[category]]++;
          suppressed.push({ item: item, fit: fit, day: di });
          return;
        }

        if (category !== 'stays') work[CANDIDATE_COUNTER[category]]++;

        if (item.module === 'stays') {
          var stayScore = Engines.staysScore(stayShapeFromItem(item), {
            identityFit: fit,
            tasteVector: ctx.tasteVector
          });
          work.staysScored++;
          entry.stayScore = stayScore;
          stays.push(entry);
          stayCandidates.push(entry);
          return;                       // a stay candidate is not scheduled time
        }

        scored.push(entry);
      });

      /* Greedy day packing by ExperienceROI within the pace energy budget.
       * The placement is not counted again: for an activity it IS the pacing
       * decision already counted above, and for anything else it belongs to
       * that candidate's own category (amendment 2). */
      /* RULING AS ruling 1 — THE DAY WINDOW, resolved HERE and not in the
       * packer, because the packer is a pure function of one day and only this
       * loop knows which day is the first and which is the last.
       *
       * The arrival time belongs to the FIRST day and the departure time to
       * the LAST, which is ruling 1's own sentence: the arrival day begins
       * when the traveller arrives, the departure day ends when they leave. On
       * a one-day trip both apply to the same day, which is correct and needs
       * no special case. A trip that states neither hands the packer two
       * nulls, and the packer runs exactly as it ran before AS. */
      var isFirstDay = di === 0;
      var isLastDay = di === trip.days.length - 1;
      var arrivalMin = isFirstDay ? Engines.minutesOf(trip.trip.arrival_time) : null;
      var departureMin = isLastDay ? Engines.minutesOf(trip.trip.departure_time) : null;

      var packed = Engines.packDay(scored.map(function (e) { return e.item; }), {
        tasteVector: ctx.tasteVector,
        hourlyRate: ctx.hourlyRate,
        pace: ctx.pace,
        arrivalMin: arrivalMin,
        departureMin: departureMin
      });

      function entryFor(item) {
        for (var i = 0; i < scored.length; i++) if (scored[i].item === item) return scored[i];
        return null;
      }
      var scheduled = packed.scheduled.map(entryFor).filter(Boolean);
      var skipped = packed.skipped.map(entryFor).filter(Boolean);

      // (4) intervention detection, item level. Only SCHEDULED items produce
      // rows: a saving attributed to an item that is not in the itinerary
      // would be a dollar the traveller can never collect.
      scheduled.forEach(function (entry) {
        entry.rows = itemRows(entry.item, partySize);
        /* itemRows() resolves a per-person quantity — covers for a dining
         * item, tickets for an activity — against the party size. That is a
         * coordination decision, distinct from the candidate's own fit score
         * and owned only by this category (amendment 2b). */
        if (isCoordinated && (entry.item.module === 'dining' || entry.item.module === 'activities')) {
          work.coordinationChecks++;
        }
      });

      /* RULING AP ruling 1. The clock times ride BESIDE the entries, keyed by
       * id, rather than being written onto the model's own item objects: §7's
       * untrusted-input contract owns that shape, and a Romieaux-computed
       * value inside a validated field is the kind of blurring rulings Q and
       * AL each had to unpick later. `entry.time` is the render's channel. */
      var timeById = {};
      (packed.times || []).forEach(function (t) { timeById[t.id] = t; });
      scheduled.forEach(function (entry) {
        entry.time = timeById[entry.item.id] || null;
      });

      days.push({
        index: di,
        date: day.date,
        scheduled: scheduled,
        skipped: skipped,
        stays: stays,
        times: packed.times || [],
        hoursUsed: packed.hoursUsed,
        // RULING AP ruling 3. Meals sit OUTSIDE the pace budget, so their
        // hours are reported beside it rather than inside it. hoursUsed keeps
        // its meaning and logResult()'s OVER BUDGET branch still means what
        // it says — ruling AM item 1's one console-only signal.
        mealHours: packed.mealHours || 0,
        energyBudget: packed.energyBudget,
        /* RULING AS. Three additive channels off the packer, none of which any
         * pre-AS caller reads. `outside` is the slots the day window shut, and
         * it is kept SEPARATE from `skipped` deliberately: "you arrive at
         * 10:00" is not "held back by your pace budget", and rendering one as
         * the other is the mislabelling ruling AK exists to stop. `orphaned`
         * and `displaced` are console-bound diagnostics on AK class (a). */
        outside: packed.outside || [],
        orphaned: packed.orphaned || [],
        displaced: packed.displaced || [],
        anchorHours: packed.anchorHours || 0,
        dayOpen: packed.dayOpen,
        dayClose: packed.dayClose
      });
    });

    /* Ruling S: the booked stay faces the hard filters before it is weighed.
     * A refused stay is not scored, contributes no counted decision, and — see
     * ledgerTrip below — contributes no ledger row. It is still handed to the
     * render, which names the predicate that failed. */
    var stayRefusal = filterStay(trip.stay, engineInput);

    /* The booked stay is weighed by the same function as the alternates, so
     * it is one more staysScore() call and one more counted decision. Since
     * ruling S it carries `attributes`, so its IdentityFit is a real score
     * rather than the structural 0 that used to cap it at 62. */
    var stayScore = null;
    if (trip.stay && !stayRefusal) {
      stayScore = Engines.staysScore(trip.stay, { tasteVector: ctx.tasteVector });
      work.staysScored++;
    }

    /* Transport: one decision per priced channel the engine actually compared
     * on a segment. A segment is not a candidate, so this never collides with
     * the transportation-candidate count (amendment 2b). */
    trip.transport_segments.forEach(function (seg) {
      var channels = 0;
      if (seg.direct_usd > 0) channels++;
      if (seg.portal_usd > 0) channels++;
      if (seg.pass_price_usd > 0 && seg.single_fare_usd > 0) channels++;
      work.transportChannelsCompared += channels;
    });

    /* (4) intervention detection, whole-trip. buildLedger() runs every Ledger
     * Law formula against the validated data — but only against what is
     * actually rendered: the scheduled items, the booked stay, the segments
     * and the payment estimates. */
    var ledgerTrip = {
      // Ruling S: a refused stay is not a booking, so it earns nothing.
      stay: stayRefusal ? null : trip.stay,
      transport_segments: trip.transport_segments,
      days: days.map(function (d) {
        return { items: d.scheduled.map(function (e) { return e.item; }) };
      }),
      foreign_card_spend_estimate_usd: trip.foreign_card_spend_estimate_usd,
      dcc_exposed_spend_usd: trip.dcc_exposed_spend_usd,
      pet_paperwork: trip.pet_paperwork,
      net_budget_usd: trip.net_budget_usd,
      fees_usd: trip.fees_usd
    };

    /* Two passes, deliberately. The ledger's hours come from
     * decisions_automated, and the decisions floor is the intervention count,
     * which only the ledger knows. Pass 1 establishes the rows; the
     * derivation runs against that count; pass 2 rebuilds with the derived
     * figure. Both passes see identical inputs, so the rows are identical and
     * only the time half moves. */
    var firstPass = Engines.buildLedger(ledgerTrip, engineInput);
    var decisions = deriveDecisions(work, firstPass.interventionCount);
    ledgerTrip.decisions_automated = decisions.total;
    var ledger = Engines.buildLedger(ledgerTrip, engineInput);

    return {
      ok: true,
      validation: validation.report,
      trip: trip,
      blueprint: bp,
      engineInput: engineInput,
      context: ctx,
      /* P5: the exact object buildLedger() was run against, kept so the panel
       * can re-price Time Value at a new hourly rate through engines.js rather
       * than doing arithmetic on money in render code. It carries the derived
       * decisions_automated, so a re-price reproduces this ledger exactly when
       * handed the same rate. */
      ledgerTrip: ledgerTrip,
      days: days,
      stay: trip.stay,
      stayScore: stayScore,
      stayRefusal: stayRefusal,
      stayCandidates: stayCandidates,
      removals: removals,
      suppressed: suppressed,
      mealSlotsHeld: mealSlotsHeld,          // ruling AR
      work: work,
      ledger: ledger,
      decisions: decisions,
      // RULING AK item 6: the trip-level half, so five identical per-item
      // sentences are explained once by their one shared cause.
      legacyDietary: !!engineInput._legacy_dietary,
      source: opts.source || 'generate'
    };
  }

  /* ---------------------------------------------------------------------
   * ledgerAtRate(result, hourlyRate) -> a ledger priced at a different rate
   *
   * P5. The hourly rate is the one Blueprint field the traveller keeps moving
   * AFTER the trip is planned — work order §6 requires the ledger panel's Time
   * Value to follow the slider live, exactly as the canonical Profile
   * dashboard does. This is how it follows it: the whole ledger is REBUILT by
   * engines.js at the new rate, so no dollar is ever recomputed in render code
   * (CLAUDE.md). Only the time half can move — buildLedger()'s rows do not
   * read hourly_rate at all — so the intervention rows, the intervention count
   * and Cash Savings are byte-identical to the ones already reconciled.
   *
   * The rate is NOT re-run through the pipeline, and that is deliberate. It is
   * also an ExperienceROI input, so re-scoring would re-pack the days and move
   * the ledger ROWS underneath a traveller who only dragged a slider — and on
   * a replayed trip it would score against a Blueprint field the cached trip
   * never had (§5b). Raised for ruling as V; the conservative reading is
   * implemented here: the slider re-prices, it never re-plans.
   * ------------------------------------------------------------------- */

  function ledgerAtRate(result, hourlyRate) {
    if (!result || !result.ok || !result.ledgerTrip || !result.engineInput) return null;
    var input = {};
    Object.keys(result.engineInput).forEach(function (key) { input[key] = result.engineInput[key]; });
    input.hourly_rate = clamp(
      Math.round(num(hourlyRate, input.hourly_rate)),
      Blueprint.HOURLY_RATE_MIN,
      Blueprint.HOURLY_RATE_MAX
    );
    return Engines.buildLedger(result.ledgerTrip, input);
  }

  /* ---------------------------------------------------------------------
   * QA logging (work order §7: "Log any post-filter removal to console")
   *
   * Kept here rather than in the render so the pipeline is auditable from the
   * console with no screen open, and so a replayed trip logs identically.
   * ------------------------------------------------------------------- */

  function logResult(result, consoleRef) {
    var c = consoleRef || (typeof console !== 'undefined' ? console : null);
    if (!c || !result) return 0;
    var lines = 0;

    function warn(message, payload) {
      if (c.warn) { payload === undefined ? c.warn(message) : c.warn(message, payload); lines++; }
    }
    function info(message, payload) {
      if (c.info) { payload === undefined ? c.info(message) : c.info(message, payload); lines++; }
    }

    (result.removals || []).forEach(function (entry) {
      warn('Live Slice: removed "' + (entry.item.name || entry.item.id) + '" — ' +
        entry.reason + ': ' + entry.detail);
    });

    if (result.stayRefusal) {
      warn('Live Slice: REFUSED the booked stay "' +
        (result.stayRefusal.stay.name || 'unnamed') + '" — ' +
        result.stayRefusal.reason + ': ' + result.stayRefusal.detail +
        ' (ruling S: no stay rows reach the ledger, and the traveller is told why).');
    }

    (result.suppressed || []).forEach(function (entry) {
      info('Live Slice: suppressed "' + (entry.item.name || entry.item.id) + '" — IdentityFit ' +
        Math.round(entry.fit) + ' is below the ' + Engines.FIT_SUPPRESS + ' floor, so it is not shown.');
    });

    /* RULING AR. The meal slots the floor would have emptied, stated on every
     * run including zero, on the same reasoning AM gave the day hours and AJ
     * gave the omission count: a number that appears only when it is
     * interesting cannot be read as a baseline.
     *
     * The console keeps the build-side vocabulary — IdentityFit, the floor,
     * rule 6 — per §5f. Nothing here reaches a traveller. */
    var held = result.mealSlotsHeld || [];
    info('Live Slice: ' + held.length + ' meal-slot candidate(s) scored below the ' +
      Engines.FIT_SUPPRESS + ' IdentityFit floor and HELD THEIR SLOT anyway ' +
      '(ruling AR: PDF rule 6 ranks within a slot and has no suppression step, ' +
      'so the floor decides which candidate holds a slot, never whether it is filled).');
    held.forEach(function (entry) {
      info('Live Slice: ' + entry.meal + ' "' + (entry.item.name || entry.item.id) +
        '" — IdentityFit ' + Math.round(entry.fit) + ' is below ' + Engines.FIT_SUPPRESS +
        ', and it holds day ' + (entry.day + 1) + '\'s ' + entry.meal +
        ' slot on reduced rule 6. Before ruling AR this was deleted.');
    });

    /* RULING AM item 1. THE DAY-CARD HOURS MOVE HERE, they are not lost.
     *
     * The badge printed `3.9 h of 9 h scheduled` on every day card — correct,
     * reconciled, and addressed to whoever wanted to know how the packer
     * decided. AK's rule governs: traveller copy says what happened to their
     * trip, never how the software decided, and every diagnostic still goes to
     * the console at the same detail. This is AK class (a)'s disposition —
     * nothing is lost; it moves.
     *
     * Printed on EVERY run including a fully packed one, because a number that
     * appears only when it is interesting cannot be read as a baseline — the
     * same reasoning AJ applied to the omission count and AK to the field-drop
     * count.
     *
     * It also carries the ONE signal that left the badge with the hours: a day
     * OVER its energy budget. packDay() holds items back to stay under, so it
     * is near-unreachable, but where the badge used to show it in the warning
     * style this is now the only place it is stated. */
    (result.days || []).forEach(function (day, i) {
      var over = Engines._num(day.hoursUsed, 0) > Engines._num(day.energyBudget, 0);
      /* RULING AP ruling 3. `hoursUsed` is the PACE-CONSUMING half and keeps
       * its meaning, so the OVER BUDGET branch ruling AM item 1 moved here is
       * unchanged. The meal hours are stated BESIDE it, not folded into it —
       * folding them in would make every slow day read as over budget the day
       * meals stopped spending it. */
      var line = 'Live Slice: day ' + (i + 1) + (day.date ? ' (' + day.date + ')' : '') +
        ' packed ' + day.hoursUsed + ' h of a ' + day.energyBudget + ' h pace budget, ' +
        'plus ' + Engines._num(day.mealHours, 0) + ' h of meals outside it, ' +
        day.scheduled.length + ' item' + (day.scheduled.length === 1 ? '' : 's') +
        ' scheduled, ' + day.skipped.length + ' held back.';
      over ? warn(line + ' OVER BUDGET — packDay() should have held this back.') : info(line);

      /* The schedule itself, at the same detail the badge never carried. */
      (day.times || []).forEach(function (t) {
        info('Live Slice: day ' + (i + 1) + ' ' + t.start + ' to ' + t.end + '  ' +
          (t.slot || 'activity') + '  ' + t.id);
      });

      /* Ruling AP's `late` flag — a meal pushed past the hour its own name
       * stops meaning anything. Reachable only when the model sends a wildly
       * overlong item, which is why it is a console line and not traveller
       * copy: AK class (a), the diagnostic goes where the build side reads
       * it, and nothing is invented for the traveller. */
      (day.times || []).filter(function (t) { return t.late; }).forEach(function (t) {
        warn('Live Slice: day ' + (i + 1) + ' ' + t.slot + ' slid to ' + t.start +
          ', past the ' + Engines.MEAL_WINDOWS[t.slot].latest +
          ' end of its window — the day ahead of it ran long.');
      });

      /* Ruling AP ruling 2. Every day accounts for all three slots, so the
       * count is stated on EVERY run including a complete one — a number that
       * appears only when it is interesting cannot be read as a baseline,
       * which is AJ's reasoning for the omission count and AK's for the
       * field-drop count. */
      var filled = (day.times || []).filter(function (t) { return t.slot; })
        .map(function (t) { return t.slot; });
      var missing = Engines.MEAL_SLOTS.filter(function (s) { return filled.indexOf(s) === -1; });
      (missing.length ? warn : info)('Live Slice: day ' + (i + 1) + ' meal coverage ' +
        filled.length + ' of 3' +
        (filled.length ? ' (' + filled.join(', ') + ')' : '') +
        (missing.length ? ', no item for ' + missing.join(', ') + '.' : '.'));

      /* RULING AS ruling 1. The day window, stated whenever it is not the
       * default, so a missing breakfast can be read as an arrival rather than
       * as a model that skipped one. */
      if (day.dayOpen !== Engines.DAY_START || day.dayClose) {
        info('Live Slice: day ' + (i + 1) + ' window ' + day.dayOpen +
          (day.dayClose ? ' to ' + day.dayClose : ' to end of day') +
          ' (ruling AS: the arrival day begins when the traveller arrives and ' +
          'the departure day ends when they leave).');
      }
      (day.outside || []).forEach(function (o) {
        info('Live Slice: day ' + (i + 1) + ' ' + o.slot + ' falls outside the day window — ' +
          'the traveller ' + (o.reason === 'arrival' ? 'arrives' : 'leaves') + ' at ' + o.at +
          '. The slot is STATED on the card, never filled (§5f ruling 5)' +
          (o.item ? ', and the model\'s "' + (o.item.name || o.item.id) + '" is not placed.' : '.'));
      });

      /* RULING AS ruling 2, THE FOUNDER'S OWN RIDER. An anchored leg or
       * transfer is not a candidate rule 11 ranks, so it takes its position
       * and SPENDS the budget, which can cost a ranked activity its place.
       * The displacement is reported BY NAME — AK class (a): the diagnostic
       * goes where the build side reads it, and no traveller copy is invented
       * for it, because the day card already says the item was held back. */
      var anchorHours = Engines._num(day.anchorHours, 0);
      if (anchorHours > 0 && (day.displaced || []).length) {
        warn('Live Slice: day ' + (i + 1) + ' — ' + anchorHours +
          ' h of the ' + day.energyBudget + ' h pace budget went to anchored transport, ' +
          'and ' + day.displaced.length + ' activity(ies) would have fitted without it: ' +
          day.displaced.map(function (item) {
            return '"' + (item.name || item.id) + '"';
          }).join(', ') +
          '. Ruling AS ruling 2: an arrival or departure leg is not a candidate ' +
          'rule 11 ranks, so it is anchored and allowed to spend. PDF rule 16 and ' +
          'the transport budget question are §5a, not this.');
      } else if (anchorHours > 0) {
        info('Live Slice: day ' + (i + 1) + ' — ' + anchorHours +
          ' h of anchored transport, displacing nothing.');
      }

      /* RULING AS ruling 3. The orphan, named as a PAIR, which is the founder's
       * own wording. AJ's cascade fires on hard-filter removals; this is its
       * extension to a pace-budget skip, and the child is counted as neither a
       * dietary nor a fit removal because it is neither. */
      (day.orphaned || []).forEach(function (o) {
        warn('Live Slice: day ' + (i + 1) + ' — "' + (o.item.name || o.item.id) +
          '" is included with "' + (o.parent.name || o.parent.id) +
          '", which the pace budget held back, so the child is held back with it ' +
          '(ruling AS ruling 3: AJ\'s cascade extends to a pace-budget skip). ' +
          'It is counted in no removal category.');
      });
    });

    /* RULING AP — option (i)'s wholesale failure mode, caught by a number.
     * AJ founder addition 1's mechanism on a second field: a model that drops
     * `meal` everywhere leaves every day saying nothing is scheduled for any
     * slot, and only a count makes that visible as a MODEL failure rather
     * than as a trip with no restaurants in it. */
    var mrep = result.validation || {};
    if (mrep.diningTotal > 0) {
      var withSlot = mrep.mealsDeclared || 0;
      (withSlot === 0 ? warn : info)('Live Slice: ' + withSlot + ' of ' +
        mrep.diningTotal + ' dining items named a meal slot' +
        (withSlot === 0
          ? ' — NONE did, so no day can account for a single meal. A trip cached before ruling AP looks exactly like this; so does a model that ignored the field.'
          : '.'));
    }

    var rep = result.validation || {};
    (rep.errors || []).forEach(function (n) { warn('Live Slice: generation error at ' + n.path + ' — ' + n.detail); });
    (rep.dropped || []).forEach(function (n) { info('Live Slice: dropped ' + n.path + ' — ' + n.detail); });
    (rep.clamped || []).forEach(function (n) { warn('Live Slice: clamped ' + n.path + ' — ' + n.detail); });

    /* RULING AK, class (a). The results screen used to print
     * `N fields in the generated JSON were dropped or clamped by the schema
     * validator. The full list is in the console.` — a fact about this file's
     * handling of an untrusted payload, addressed to a traveller who can do
     * nothing with it, and §5a had already queued it for its own phase.
     *
     * It MOVES rather than disappears. The per-field lines above have always
     * been here; what the screen carried and this did not is the COUNT, so the
     * count is stated here now. Printed on every run, including zero, because
     * a number that only appears when it is non-zero cannot be read as a
     * baseline — the same reasoning AJ applied to the omission count. */
    var noisy = (rep.dropped || []).length + (rep.clamped || []).length;
    (noisy ? warn : info)('Live Slice: ' + noisy + ' field' + (noisy === 1 ? '' : 's') +
      ' in the generated JSON were dropped or clamped by the schema validator' +
      (noisy ? ' — each one is listed above.' : '.'));
    (rep.defaulted || []).forEach(function (n) { info('Live Slice: defaulted ' + n.path + ' — ' + n.detail); });
    (rep.warnings || []).forEach(function (n) { warn('Live Slice: ' + n.path + ' — ' + n.detail); });

    if (result.decisions && result.decisions.floorApplied) {
      warn('Live Slice: the decisions breakdown was withheld — the derived total (' +
        result.decisions.derivedTotal + ') fell below the intervention count (' +
        result.decisions.interventionCount + '), so no breakdown can both be honest and sum to its total.');
    }

    /* RULING AJ founder addition 1, KEPT BY RULING AL on the new field. The
     * wholesale case: a model that drops `suits` from every dining item
     * hollows the itinerary out through a different door from the one AL
     * closed. One removal does not make that visible — the count does, and it
     * is stated on every run rather than only when it bites, so the signal
     * exists before a traveller with a need ever hits it. */
    if (rep.diningTotal > 0) {
      var missing = rep.diningWithoutSuits || 0;
      if (missing > 0) {
        warn('Live Slice: ' + missing + ' of ' + rep.diningTotal +
          ' dining items did not say who they suit. Each is unverified, so a ' +
          'declared dietary need removes it (ruling AL). All ' + rep.diningTotal +
          ' would be removed on a restricted trip if this reads ' + rep.diningTotal + '.');
      } else {
        info('Live Slice: all ' + rep.diningTotal +
          ' dining items said who they suit (ruling AL).');
      }

      /* RULING AS ruling 6. THE PLACEHOLDER COUNT, on AJ founder addition 1's
       * mechanism and stated on EVERY run including zero, because a number
       * that appears only when it is interesting cannot be read as a baseline
       * — AJ's reasoning for the omission count, AK's for the field-drop
       * count, AM's for the day hours and AR's for the meal-slot count.
       *
       * Before AS nothing in this bundle could see one: `diningWithoutSuits`
       * above counts an UNDECLARED claim, so a declared EMPTY one is compliant
       * by that test, and "No dinner scheduled (departure day)" passed with no
       * warning at all before AL's subset test removed it and the traveller
       * read a dietary removal on a day they had no dietary problem with. */
      var placeholders = rep.placeholderDining || 0;
      if (placeholders > 0) {
        warn('Live Slice: ' + placeholders + ' of ' + rep.diningTotal +
          ' dining items are PLACEHOLDER NON-ITEMS — no duration, no ' +
          'suitability, and a name that begins by saying there is none. The ' +
          'prompt asks for real items only and states that Romieaux says so ' +
          'itself (ruling AS ruling 6). Each is then removed by the dietary ' +
          'subset test on a restricted trip and reads to the traveller as a ' +
          'dietary removal, which is what this count exists to catch.');
      } else {
        info('Live Slice: no placeholder dining items in the reply (ruling AS ruling 6).');
      }
    }

    /* RULING AT items 1 and 2. OUTSIDE the dining guard above, deliberately:
     * both counts are trip-wide, and a reply carrying no dining item at all is
     * exactly when a hollow one most needs reporting. Stated on every run
     * including zero, on the same reasoning as every count above it. */
    if (rep.itemsTotal > 0) {
      var noVector = rep.itemsWithoutAttributes || 0;
      if (noVector > 0) {
        warn('Live Slice: ' + noVector + ' of ' + rep.itemsTotal +
          ' items declared no taste vector — absent, empty, or all zeroes. ' +
          'Each scores IdentityFit 0 against ANY traveller, so each loses its ' +
          'fit badge (ruling AT item 1) and every one that is not holding a ' +
          'meal slot is suppressed. If this reads close to ' + rep.itemsTotal +
          ', the reply is hollow and the trip is being scored on nothing.');
      } else {
        info('Live Slice: every one of the ' + rep.itemsTotal +
          ' items declared a taste vector (ruling AT item 1).');
      }

      var stayItems = rep.stayModuleDayItems || 0;
      if (stayItems > 0) {
        warn('Live Slice: ' + stayItems + ' day item(s) arrived with module ' +
          '"stays". The traveller has one stay and it has its own block, so ' +
          'no day card renders these (ruling AT item 2). They are still ' +
          'scored and still carried as stay candidates — but a check-in is ' +
          'not something that happens at a time, and the prompt asks for day ' +
          'items the traveller does.');
      } else {
        info('Live Slice: no day item arrived as a stay (ruling AT item 2).');
      }
    }

    // §5a: weather_fit still has no source, so weather-sensitive items are
    // evaluated but never penalised. Stated every run rather than buried.
    if (result.work && result.work.weatherSensitiveEvaluated > 0) {
      info('Live Slice: ' + result.work.weatherSensitiveEvaluated +
        ' weather-sensitive items evaluated. weather_fit has no forecast source in this build, so none is penalised (RULINGS §5a).');
    }

    return lines;
  }

  /* ---------------------------------------------------------------------
   * Public surface
   * ------------------------------------------------------------------- */

  return {
    // bounds, exposed so the suite asserts the real ones
    MONEY_MAX: MONEY_MAX,
    SPEND_MAX: SPEND_MAX,
    DURATION_MAX_HOURS: DURATION_MAX_HOURS,
    TRANSIT_MAX_MIN: TRANSIT_MAX_MIN,
    DAYS_MAX: DAYS_MAX,
    ITEMS_PER_DAY_MAX: ITEMS_PER_DAY_MAX,
    SEGMENTS_MAX: SEGMENTS_MAX,
    TAGS_MAX: TAGS_MAX,
    IMPLAUSIBLE_RATE: IMPLAUSIBLE_RATE,
    MODULES: MODULES,
    ENGINE_INPUT_ONLY: ENGINE_INPUT_ONLY,
    WELLNESS_TAGS: WELLNESS_TAGS,
    CATEGORY_LABELS: CATEGORY_LABELS,
    CATEGORY_ORDER: CATEGORY_ORDER,

    // the pipeline
    validateGeneration: validateGeneration,
    filterItems: filterItems,
    filterStay: filterStay,
    deriveDecisions: deriveDecisions,
    score: score,
    ledgerAtRate: ledgerAtRate,
    logResult: logResult,

    // internals worth asserting directly
    _stayShapeFromItem: stayShapeFromItem,
    _hasWellnessTag: hasWellnessTag,
    _itemRows: itemRows,
    _matchedDietaryTerm: matchedDietaryTerm,
    _dietaryConflict: dietaryConflict,   // ruling AL (was ruling AJ)
    SUITS_MAX: SUITS_MAX
  };
})(typeof require === 'function' ? require('./engines.js')
   : (typeof window !== 'undefined' ? window.Engines : undefined),
   typeof require === 'function' ? require('./blueprint.js')
   : (typeof window !== 'undefined' ? window.Blueprint : undefined));

/* No-op in the browser; lets the test suite run under node without a build step. */
if (typeof module !== 'undefined' && module.exports) { module.exports = LiveSliceScoring; }
