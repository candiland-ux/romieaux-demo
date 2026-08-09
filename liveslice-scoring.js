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
  var TRIP_KEYS = ['destination', 'start', 'end', 'currency'];
  var ITEM_KEYS = [
    'id', 'module', 'name', 'est_price_usd', 'est_price_local', 'duration_hours',
    'transit_min_from_prev', 'attributes', 'alt_channel', 'flexibility',
    'advance_discount_pct', 'area_median_rate_usd', 'crowd_shift',
    'weather_sensitive', 'covers', 'tags', 'accessibility', 'notes',
    // engine-read, not yet listed in §4 — see the header block
    'tickets', 'min_age_years', 'pet_friendly'
  ];
  var STAY_KEYS = [
    'name', 'nightly_direct_usd', 'nightly_portal_usd', 'nights',
    'commute_min_to_anchors', 'flexibility', 'area_median_rate_usd',
    'locked_rate_usd', 'flexible_rate_at_decision_usd',
    // ruling S — the stay is scored and filtered like any other option
    'attributes', 'accessibility', 'tags',
    // ruling U — …and faces the same four hard constraints
    'pet_friendly', 'min_age_years'
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
      defaulted: []   // missing fields that fell back to zero attribution
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
      note(rep.errors, 'root', 'the generation is not a JSON object');
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
        currency: tripBlock ? text(tripBlock.currency, 8) : ''
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
      note(rep.errors, 'days', 'missing or not an array — there is no itinerary to score');
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

    // §3: DCC-exposed spend is a DISTINCT AND SMALLER quantity than total
    // foreign spend. Incoherence is clamped; being outside the 36–55% band is
    // only a warning, because the band is calibration, not a hard rule.
    var foreign = trip.foreign_card_spend_estimate_usd;
    var dcc = trip.dcc_exposed_spend_usd;
    if (foreign > 0 && dcc > foreign) {
      note(rep.clamped, 'dcc_exposed_spend_usd',
        'DCC-exposed spend ($' + dcc + ') exceeded total foreign spend ($' + foreign + ') — clamped to it (§3)');
      trip.dcc_exposed_spend_usd = foreign;
      dcc = foreign;
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
    if (!itemCount) note(rep.errors, 'days', 'no usable items survived validation');

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

  function haystack(item) {
    return [item && item.name, item && item.notes]
      .concat((item && item.tags) || []).join(' ').toLowerCase();
  }

  function matchedDietaryTerm(item, lines) {
    var hay = haystack(item);
    for (var i = 0; i < (lines || []).length; i++) {
      var line = String(lines[i] || '').trim().toLowerCase();
      if (line && hay.indexOf(line) !== -1) return line;
    }
    return null;
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
      var term = matchedDietaryTerm(item, engineInput.dietary_hard_lines);
      return 'conflicts with your dietary restriction "' + term + '"';
    }
    if (entry.reason === 'accessibility predicate') {
      var unmet = unmetAccessibilityKeys(item, engineInput.accessibility_needs);
      return 'not verified for: ' + unmet.join(', ') + ' — an unverified need removes the option';
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

    if (Engines.violatesDietary(stay, engineInput.dietary_hard_lines)) {
      return refusal('dietary hard line',
        'conflicts with your dietary restriction "' +
        matchedDietaryTerm(stay, engineInput.dietary_hard_lines) + '"');
    }

    if (Engines.violatesAccessibility(stay, engineInput.accessibility_needs)) {
      var unmet = unmetAccessibilityKeys(stay, engineInput.accessibility_needs);
      return refusal('accessibility predicate',
        stay._accessibility_declared
          ? 'not verified for: ' + unmet.join(', ') + ' — an unverified need refuses the booking'
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
        decisions: null
      };
    }

    var trip = validation.trip;

    /* --- work counters. Every one is incremented at the site of the real
     * work, never from the length of something the model sent (amendment 1),
     * and each evaluation increments exactly one of them (amendment 2). */
    var work = newWork();

    var hasKids = (engineInput.kid_ages_months || []).length > 0;
    var hasPet = !!engineInput.has_pet;
    var isCoordinated = partySize >= 3 || bp.trip_type === 'milestone';

    var removals = [];
    var suppressed = [];
    var stayCandidates = [];
    var days = [];

    trip.days.forEach(function (day, di) {
      // (2) hard-constraint post-filter, before anything is scored. An option
      // failing a hard predicate never appears at all (PDF rule 41).
      var filtered = filterItems(day.items, engineInput);
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
        var band = Engines.fitBand(fit);
        var category = candidateCategory(item);
        var entry = {
          item: item,
          fit: fit,
          band: band,
          category: category,
          roi: Engines.experienceROI(item, { identityFit: fit, hourlyRate: ctx.hourlyRate }),
          rows: []
        };

        // Work order §7: no item below IdentityFit 35 is rendered as a
        // recommendation. Suppressed items leave the pipeline here — they are
        // never packed, never priced on screen and never produce a ledger row.
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
      var packed = Engines.packDay(scored.map(function (e) { return e.item; }), {
        tasteVector: ctx.tasteVector,
        hourlyRate: ctx.hourlyRate,
        pace: ctx.pace
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

      days.push({
        index: di,
        date: day.date,
        scheduled: scheduled,
        skipped: skipped,
        stays: stays,
        hoursUsed: packed.hoursUsed,
        energyBudget: packed.energyBudget
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
      work: work,
      ledger: ledger,
      decisions: decisions,
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

    var rep = result.validation || {};
    (rep.errors || []).forEach(function (n) { warn('Live Slice: generation error at ' + n.path + ' — ' + n.detail); });
    (rep.dropped || []).forEach(function (n) { info('Live Slice: dropped ' + n.path + ' — ' + n.detail); });
    (rep.clamped || []).forEach(function (n) { warn('Live Slice: clamped ' + n.path + ' — ' + n.detail); });
    (rep.defaulted || []).forEach(function (n) { info('Live Slice: defaulted ' + n.path + ' — ' + n.detail); });
    (rep.warnings || []).forEach(function (n) { warn('Live Slice: ' + n.path + ' — ' + n.detail); });

    if (result.decisions && result.decisions.floorApplied) {
      warn('Live Slice: the decisions breakdown was withheld — the derived total (' +
        result.decisions.derivedTotal + ') fell below the intervention count (' +
        result.decisions.interventionCount + '), so no breakdown can both be honest and sum to its total.');
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
    _matchedDietaryTerm: matchedDietaryTerm
  };
})(typeof require === 'function' ? require('./engines.js')
   : (typeof window !== 'undefined' ? window.Engines : undefined),
   typeof require === 'function' ? require('./blueprint.js')
   : (typeof window !== 'undefined' ? window.Blueprint : undefined));

/* No-op in the browser; lets the test suite run under node without a build step. */
if (typeof module !== 'undefined' && module.exports) { module.exports = LiveSliceScoring; }
