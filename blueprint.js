/* Romieaux — Live Slice Blueprint state (P2).
 *
 * ONE state object holding every field in work order §3, plus the fields the
 * rulings added. Pure functions, no DOM, no network — the DOM wiring lives in
 * liveslice-intake.js. Loads as a plain <script> (GitHub Pages, no build step)
 * and under node for the test suite.
 *
 * The Blueprint is kept SEPARATE from the prototype's canonical `S` object.
 * `S` drives the canonical 65-screen demo and its 7 untouchable trips; the
 * Blueprint drives the Live Slice only. Intake mirrors S -> Blueprint in one
 * direction. Nothing here ever writes back into S.
 *
 * Field names at the top level match the flat contract engines.js already
 * reads (`mindset`, `trip_type`, `travel_mode`, `kid_ages_months`,
 * `dietary_needs`, `accessibility_needs`, `has_pet`, `party_size`,
 * `has_no_fx_card`, `hourly_rate`), so a Blueprint can be handed straight to
 * buildTasteVector(), applyHardFilters() and buildLedger() with no adapter.
 */
var Blueprint = (function (Engines) {
  'use strict';

  if (!Engines) {
    throw new Error('Live Slice: blueprint.js requires engines.js to be loaded first.');
  }

  /* ---------------------------------------------------------------------
   * P2 NOTES — read alongside RULINGS.md
   *
   * G. The supplemental Live Slice screen captures pace, dietary hard lines
   *    and accessibility detail. Luxury threshold is DERIVED, not asked.
   * F. The canonical engagement screen's free "I'll plan it" card calls
   *    selectMode(this,'lightly'), but ruling F maps that free tier to
   *    Essential (P = 0.25); the name `lightly` (P = 0.5) belongs to a tier
   *    the canonical screen does not offer. The intake layer therefore maps by
   *    WHICH CARD was clicked, not by the string the canonical code stores.
   *    `lightly` stays reachable in this schema for a future screen.
   * H. An unmapped mindset or trip type contributes nothing to the taste
   *    vector — suppressing fit rather than fabricating it. The canonical
   *    trip-type screen offers `sabbatical` and `pilgrimage`, which the ruled
   *    TRIP_TYPE_BOOST table does not carry; they validate as warnings, not
   *    errors, and contribute no boost.
   * §7 Untrusted input: every setter clamps and normalizes. A missing or
   *    malformed field falls back to a value that produces zero attribution.
   * ------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------
   * Vocabularies. Where a vocabulary already exists in engines.js (the PDF's
   * constants), it is read from there rather than restated.
   * ------------------------------------------------------------------- */

  var PACES = Object.keys(Engines.PACE_HOURS);                 // slow / moderate / full
  var ENGAGEMENT_MODES = Object.keys(Engines.ENGAGEMENT_P);    // essential / lightly / curated / concierge
  var MINDSET_KEYS = Object.keys(Engines.MINDSET_WEIGHTS);     // ruling H
  var BOOSTED_TRIP_TYPES = Object.keys(Engines.TRIP_TYPE_BOOST);

  var TRAVEL_MODES = ['solo', 'partner', 'group'];             // §3 Just Me / With My Partner / With a Group
  var PET_SIZES = ['small', 'medium', 'large'];                // §3: S/M/L, not pounds
  var PET_TYPES = ['dog', 'cat', 'other'];
  var DESTINATION_MODES = ['own', 'suggested', 'surprise'];
  var BUDGET_MODES = ['unset', 'set', 'agnostic'];
  var DINING_ADVENTUROUSNESS = ['familiar', 'balanced', 'adventurous'];

  /* The ten trip types the canonical screen actually offers (renderTripTypes).
   * `workcation` is in the work order and in TRIP_TYPE_BOOST but has no
   * canonical button; it is accepted here so a future screen can set it. */
  var TRIP_TYPES_UI = [
    'romantic', 'cultural', 'reset', 'milestone', 'honeymoon',
    'friends', 'adventure', 'sabbatical', 'pilgrimage', 'family'
  ];
  var TRIP_TYPES = TRIP_TYPES_UI.slice();
  BOOSTED_TRIP_TYPES.forEach(function (k) {
    if (TRIP_TYPES.indexOf(k) === -1) TRIP_TYPES.push(k);
  });

  /* Accessibility need keys. These are the keys engines.js
   * violatesAccessibility() looks up on item.accessibility, so the vocabulary
   * is a contract with the generation schema, not free text. Labels mirror the
   * canonical chips on s-bp-who. */
  var ACCESSIBILITY_NEEDS = [
    { key: 'wheelchair',       label: 'Wheelchair / mobility device' },
    { key: 'limited_mobility', label: 'Limited mobility — needs accommodations' },
    { key: 'visual',           label: 'Visual impairment' },
    { key: 'hearing',          label: 'Hearing impairment' },
    { key: 'sensory',          label: 'Sensory sensitivities' }
  ];
  var ACCESSIBILITY_KEYS = ACCESSIBILITY_NEEDS.map(function (n) { return n.key; });

  /* Dietary presets — RULING AL. A preset is a NEED THE VENUE MUST SUIT.
   *
   * SUPERSEDES ruling P's forbidden-term expansion and ruling AJ's re-targeting
   * of it. P ruled that a hard line is a forbidden TERM and not a diet label,
   * because "vegetarian" as a literal line would have matched the very items a
   * vegetarian wants — sound reasoning for a substring scan over prose, which
   * is what P had. AJ moved the scan onto a structured `contains` claim and
   * kept P's question. AL rules the QUESTION wrong: a venue's food containing
   * meat is not what a vegetarian needs to know, because nearly every Italian
   * restaurant honestly contains meat and fish, and removing all of them
   * hollows the trip out exactly as P's scan did.
   *
   * So "vegetarian" IS the right token after all — not as a term that must not
   * appear, but as a need the venue declares it SUITS. The ten keys below are
   * the whole vocabulary: the traveller's needs are drawn from it and so is
   * the model's `suits` array, which is what keeps the predicate a plain set
   * operation with no mapping layer to drift.
   *
   * THE EXPANSIONS ARE GONE, and the kosher preset is why they had to go
   * rather than merely go unused. It read `pork, ham, bacon, prosciutto,
   * shellfish, shrimp, lobster, crab` — an ingredient list standing in for a
   * rule that is RABBINIC CERTIFICATION. An unsupervised vegetarian restaurant
   * contains none of those and is not kosher; a certified deli serves none of
   * them and is. Leaving the data in the file as unread decoration would leave
   * the next reader a definition of kosher this record has ruled wrong.
   *
   * `unstated` and `unsuited` are the traveller's words for the two ways a
   * need goes unmet (§5f: only prose the traveller reads lives here; the
   * internal reason token is untouched). They are held BESIDE the keys so
   * there is one definition, and harness §21 asserts every key carries both —
   * which is what makes this a closed map rather than the specific-to-family
   * TAXONOMY ruling AJ refused. AJ's objection was that such a map "would need
   * an entry for every ingredient on earth to be sound, and its gaps would
   * fail silently". This one cannot have a gap: its keys ARE the vocabulary. */
  var DIETARY_PRESETS = [
    { key: 'vegetarian', label: 'Vegetarian',
      unstated: 'does not say whether it suits a vegetarian',
      unsuited: 'does not offer vegetarian dishes' },
    { key: 'vegan', label: 'Vegan',
      unstated: 'does not say whether it suits a vegan',
      unsuited: 'does not offer vegan dishes' },
    { key: 'gluten_free', label: 'Gluten-free',
      unstated: 'does not say whether it has gluten-free dishes',
      unsuited: 'does not offer gluten-free dishes' },
    { key: 'dairy_free', label: 'Dairy-free',
      unstated: 'does not say whether it has dairy-free dishes',
      unsuited: 'does not offer dairy-free dishes' },
    { key: 'nut_allergy', label: 'Tree nut allergy',
      unstated: 'does not say whether it can handle a tree nut allergy',
      unsuited: 'does not say it can handle a tree nut allergy safely' },
    { key: 'peanut_allergy', label: 'Peanut allergy',
      unstated: 'does not say whether it can handle a peanut allergy',
      unsuited: 'does not say it can handle a peanut allergy safely' },
    { key: 'shellfish_allergy', label: 'Shellfish allergy',
      unstated: 'does not say whether it can handle a shellfish allergy',
      unsuited: 'does not say it can handle a shellfish allergy safely' },
    { key: 'halal', label: 'Halal',
      unstated: 'does not say whether it is halal',
      unsuited: 'is not halal' },
    { key: 'kosher', label: 'Kosher',
      unstated: 'does not say whether it is kosher',
      unsuited: 'is not kosher-certified' },
    { key: 'no_alcohol', label: 'No alcohol',
      unstated: 'does not say whether it serves an alcohol-free menu',
      unsuited: 'does not offer an alcohol-free option' }
  ];
  var DIETARY_KEYS = DIETARY_PRESETS.map(function (p) { return p.key; });

  /* RULING AL — the closed vocabulary the model's `suits` field is drawn from,
   * and the same one the traveller's needs are expressed in.
   *
   * DERIVED from DIETARY_PRESETS rather than re-typed, on ruling AJ's own
   * reasoning for DIETARY_VOCAB — one definition, so the request and the
   * filter cannot drift apart. What changed is WHICH set it is: AJ derived 51
   * ingredient tokens from the preset expansions, AL derives the ten preset
   * KEYS, because a venue can suit `vegetarian` and cannot suit `pork`.
   *
   * DIETARY_VOCAB and DIETARY_FAMILIES are DELETED, not left unread. See the
   * preset block above for the expansions, and RULINGS AL items 3 and 5 for
   * why an unread constant is worse than a missing one. */
  var SUITS_VOCAB = DIETARY_KEYS.slice();

  /* ---------------------------------------------------------------------
   * Bounds
   * ------------------------------------------------------------------- */

  var HOURLY_RATE_MIN = 15;      // §3 slider $15–$500 — matches the canonical
  var HOURLY_RATE_MAX = 500;     // #rate-slider min/max exactly.
  var HOURLY_RATE_DEFAULT = 50;  // §3 default.

  var NIGHTS_MIN = 1;
  var NIGHTS_MAX = 90;           // matches the canonical #dur-custom-input max.
  var KID_AGE_MAX_MONTHS = 204;  // matches the canonical adjKid() clamp (17 yrs).
  var PARTY_SIZE_MAX = 24;
  var BUDGET_MAX_USD = 1000000;

  /* Ruling G: "Luxury threshold is derived, not asked — top quartile of the
   * budget envelope."
   *
   * CONVENTION (P2, surfaced for ruling — see the P2 conflict report):
   * the envelope is the per-person budget spread across the nights of the
   * trip, and the threshold is the top-quartile boundary of one night of it:
   *
   *     nightly_envelope = budget_total_usd / nights
   *     luxury_threshold = 0.75 x nightly_envelope
   *
   * An item at or above the threshold consumes a top-quartile share of a
   * single day's envelope, which is what makes it a splurge. Defining it
   * against the nightly envelope keeps it scale-correct: $500 is a luxury
   * decision on a $200/night budget and an ordinary one on a $2,000/night
   * budget. With no budget set the threshold is null and nothing is penalised
   * — the §7 zero-attribution default. */
  var LUXURY_QUARTILE = 0.75;

  /* ---------------------------------------------------------------------
   * Small helpers. Numeric hygiene reuses engines.js so there is one
   * definition of "what a missing number means".
   * ------------------------------------------------------------------- */

  var num = Engines._num;

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  function str(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function oneOf(value, allowed, fallback) {
    var v = String(value === undefined || value === null ? '' : value).toLowerCase().trim();
    return allowed.indexOf(v) !== -1 ? v : fallback;
  }

  function uniqueStrings(list) {
    var out = [], seen = {};
    (list || []).forEach(function (item) {
      var s = str(item).toLowerCase();
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out;
  }

  /* An ISO yyyy-mm-dd date, or null. The canonical date inputs emit exactly
   * this format; anything else is untrusted and dropped. */
  function isoDate(value) {
    var s = str(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    return s;
  }

  function nightsBetween(start, end) {
    if (!start || !end) return null;
    var diff = Math.round(
      (new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000
    );
    return diff > 0 ? diff : null;
  }

  /* ---------------------------------------------------------------------
   * create() — the single Blueprint state object.
   *
   * Every field in the work order §3 table is present from the start, at its
   * zero-attribution default. Fields marked "derived" are recomputed by
   * derive() after every mutation and must never be set by hand.
   * ------------------------------------------------------------------- */

  function create() {
    return {
      schema_version: 2,

      // §3 destination + dates ------------------------------------------
      destination_name: null,
      destination_key: null,               // the prototype's ttk()/ntk() key
      destination_mode: null,              // own | suggested | surprise
      start_date: null,
      end_date: null,
      nights: null,

      // §3 trip_type ----------------------------------------------------
      trip_type: null,                     // primary, feeds TRIP_TYPE_BOOST
      trip_types: [],                      // the canonical screen is multi-select

      // §3 travel_mode + party ------------------------------------------
      travel_mode: null,                   // solo | partner | group
      adults: 1,
      party_size: 1,                       // derived: adults + kids

      // §3 toggles ------------------------------------------------------
      has_kids: false,
      kid_ages_months: [],
      has_pet: false,
      pet_size: null,                      // small | medium | large  (§3: S/M/L)
      pet_type: null,
      pet_name: '',
      pet_service_animal: false,
      has_accessibility_needs: false,
      accessibility_needs: [],             // ruling G screen
      accessibility_notes: '',             // ruling G screen

      // §3 mindset ------------------------------------------------------
      mindset: [],

      // §3 pace ---------------------------------------------------------
      pace: null,                          // ruling G screen
      pace_hours: null,                    // derived: 5 / 7 / 9

      // §3 budget -------------------------------------------------------
      budget_mode: 'unset',                // unset | set | agnostic
      budget_total_usd: null,              // per person, all-in
      currency: 'USD',
      luxury_threshold_usd: null,          // derived, ruling G

      // §3 dining -------------------------------------------------------
      cuisine_loves: [],
      dining_adventurousness: null,        // familiar | balanced | adventurous
      dietary_selections: [],              // preset keys, for UI restore
      dietary_notes: '',                   // free text, ruling G screen — RULING AL:
                                           //   prompt guidance ONLY, never tokenised
      dietary_needs: [],                   // derived: the need tokens fed to engines

      // §3 engagement_mode ----------------------------------------------
      engagement_mode: 'curated',          // ruling F; canonical S.mode default
      proactivity_p: null,                 // derived: 0.25 / 0.5 / 1.0 / 1.3

      // §3 hourly_rate --------------------------------------------------
      hourly_rate: HOURLY_RATE_DEFAULT,

      // Ruling D --------------------------------------------------------
      has_no_fx_card: true                 // default true for the demo
    };
  }

  /* ---------------------------------------------------------------------
   * Derived fields. Idempotent — safe to call after every mutation.
   * ------------------------------------------------------------------- */

  function paceHours(bp) {
    var hours = Engines.PACE_HOURS[bp && bp.pace];
    return hours === undefined ? null : hours;
  }

  function proactivityP(bp) {
    // An unset engagement mode is not "unknown" — create() seeds it from the
    // canonical default, so there is always a real tier here.
    return Engines.proactivityMultiplier(bp && bp.engagement_mode);
  }

  /* Ruling G — see LUXURY_QUARTILE above for the convention. */
  function luxuryThreshold(budgetTotalUsd, nights) {
    var total = num(budgetTotalUsd, 0);
    var n = num(nights, 0);
    if (total <= 0 || n <= 0) return null;
    return Math.round(LUXURY_QUARTILE * (total / n));
  }

  /* RULING AL — the traveller's stated needs. The selected preset keys, and
   * NOTHING ELSE.
   *
   * SUPERSEDES dietaryHardLines(), which returned every forbidden term the
   * presets expanded to PLUS the free-text box split on commas. Both halves
   * are retired, and the second half is the one that had to be ruled rather
   * than dropped in passing.
   *
   * FREE TEXT IS NEVER TOKENISED — RULING AL item 8, and it is the one place
   * this amendment could have recreated the very defect it fixes. Under AJ a
   * free-text token outside the 51-token vocabulary was INERT: `cleanContains`
   * dropped it from the model's array, so it never intersected and nothing was
   * removed. Under AL's SUBSET test the same token can never appear in
   * `suits`, so it would remove EVERY DINING ITEM ON THE TRIP — a traveller
   * typing "no restrictions" would empty their own itinerary. The direction
   * flips from inert to catastrophic on exactly the input a real traveller
   * types.
   *
   * So `dietary_notes` is carried into the prompt VERBATIM as guidance and
   * never reaches this function. The intake screen says so under the box, so
   * a traveller who types an allergy there is told it is not what gets
   * enforced. See index.html 9133. */
  function dietaryNeeds(selections) {
    var needs = [];
    (selections || []).forEach(function (key) {
      var preset = presetFor(key);
      if (preset) needs.push(preset.key);
    });
    return uniqueStrings(needs);
  }

  function presetFor(key) {
    var k = str(key).toLowerCase();
    for (var i = 0; i < DIETARY_PRESETS.length; i++) {
      if (DIETARY_PRESETS[i].key === k) return DIETARY_PRESETS[i];
    }
    return null;
  }

  function derive(bp) {
    if (!bp) return bp;
    bp.nights = nightsBetween(bp.start_date, bp.end_date) || bp.nights || null;
    bp.pace_hours = paceHours(bp);
    bp.proactivity_p = proactivityP(bp);
    bp.luxury_threshold_usd = luxuryThreshold(bp.budget_total_usd, bp.nights);
    bp.dietary_needs = dietaryNeeds(bp.dietary_selections);
    bp.party_size = clamp(
      Math.max(1, num(bp.adults, 1)) + (bp.kid_ages_months || []).length,
      1, PARTY_SIZE_MAX
    );
    return bp;
  }

  /* ---------------------------------------------------------------------
   * Setters. Each one clamps, normalizes and re-derives, so the Blueprint is
   * never left in a shape the engines cannot read (§7).
   * ------------------------------------------------------------------- */

  function setDestination(bp, name, key, mode) {
    bp.destination_name = str(name) || null;
    bp.destination_key = str(key) || null;
    bp.destination_mode = oneOf(mode, DESTINATION_MODES, bp.destination_mode);
    return derive(bp);
  }

  function setDates(bp, start, end) {
    bp.start_date = isoDate(start);
    bp.end_date = isoDate(end);
    return derive(bp);
  }

  /* Nights can arrive before dates do — the canonical budget screen asks
   * "how many nights?" two screens ahead of the date pickers. */
  function setNights(bp, nights) {
    var n = Math.round(num(nights, 0));
    bp.nights = n >= NIGHTS_MIN && n <= NIGHTS_MAX ? n : null;
    return derive(bp);
  }

  function setTripTypes(bp, types) {
    var list = [];
    (types || []).forEach(function (t) {
      var k = oneOf(t, TRIP_TYPES, null);
      if (k && list.indexOf(k) === -1) list.push(k);
    });
    bp.trip_types = list;
    bp.trip_type = list[0] || null;
    return derive(bp);
  }

  function setTravelMode(bp, mode, adults) {
    bp.travel_mode = oneOf(mode, TRAVEL_MODES, null);
    var a = Math.round(num(adults, 0));
    if (a >= 1) bp.adults = clamp(a, 1, PARTY_SIZE_MAX);
    else if (bp.travel_mode === 'solo') bp.adults = 1;
    else if (bp.travel_mode === 'partner') bp.adults = 2;
    else if (bp.travel_mode === 'group') bp.adults = Math.max(2, num(bp.adults, 2));
    return derive(bp);
  }

  function setKids(bp, enabled, agesMonths) {
    bp.has_kids = !!enabled;
    if (!bp.has_kids) {
      bp.kid_ages_months = [];
      return derive(bp);
    }
    bp.kid_ages_months = (agesMonths || [])
      .map(function (m) { return clamp(Math.round(num(m, 0)), 0, KID_AGE_MAX_MONTHS); })
      .slice(0, PARTY_SIZE_MAX);
    return derive(bp);
  }

  function setPet(bp, enabled, pet) {
    bp.has_pet = !!enabled;
    if (!bp.has_pet) {
      bp.pet_size = null;
      bp.pet_type = null;
      bp.pet_name = '';
      bp.pet_service_animal = false;
      return derive(bp);
    }
    var p = pet || {};
    bp.pet_size = oneOf(p.size, PET_SIZES, bp.pet_size);
    bp.pet_type = oneOf(p.type, PET_TYPES, bp.pet_type);
    bp.pet_name = str(p.name);
    bp.pet_service_animal = !!p.service_animal;
    return derive(bp);
  }

  /* Ruling G: accessibility detail is captured only when the canonical toggle
   * on s-bp-who was already set. Clearing the toggle clears the detail. */
  function setAccessibility(bp, enabled, needs, notes) {
    bp.has_accessibility_needs = !!enabled;
    if (!bp.has_accessibility_needs) {
      bp.accessibility_needs = [];
      bp.accessibility_notes = '';
      return derive(bp);
    }
    var list = [];
    (needs || []).forEach(function (n) {
      var k = oneOf(n, ACCESSIBILITY_KEYS, null);
      if (k && list.indexOf(k) === -1) list.push(k);
    });
    bp.accessibility_needs = list;
    if (notes !== undefined) bp.accessibility_notes = str(notes);
    return derive(bp);
  }

  function setMindset(bp, keys) {
    var list = [];
    (keys || []).forEach(function (k) {
      var key = oneOf(k, MINDSET_KEYS, null);
      if (key && list.indexOf(key) === -1) list.push(key);
    });
    bp.mindset = list;
    return derive(bp);
  }

  function setPace(bp, pace) {
    bp.pace = oneOf(pace, PACES, null);
    return derive(bp);
  }

  function setBudget(bp, mode, totalUsd) {
    bp.budget_mode = oneOf(mode, BUDGET_MODES, 'unset');
    if (bp.budget_mode === 'set') {
      var amount = Math.round(num(totalUsd, 0));
      bp.budget_total_usd = amount > 0 ? clamp(amount, 1, BUDGET_MAX_USD) : null;
    } else {
      bp.budget_total_usd = null;
    }
    return derive(bp);
  }

  function setDining(bp, dining) {
    var d = dining || {};
    if (d.cuisine_loves !== undefined) bp.cuisine_loves = uniqueStrings(d.cuisine_loves);
    if (d.adventurousness !== undefined) {
      bp.dining_adventurousness = oneOf(d.adventurousness, DINING_ADVENTUROUSNESS, null);
    }
    if (d.selections !== undefined) {
      var list = [];
      (d.selections || []).forEach(function (k) {
        var key = oneOf(k, DIETARY_KEYS, null);
        if (key && list.indexOf(key) === -1) list.push(key);
      });
      bp.dietary_selections = list;
    }
    if (d.notes !== undefined) bp.dietary_notes = str(d.notes);
    return derive(bp);
  }

  function setEngagementMode(bp, mode) {
    bp.engagement_mode = oneOf(mode, ENGAGEMENT_MODES, bp.engagement_mode);
    return derive(bp);
  }

  function setHourlyRate(bp, rate) {
    var r = Math.round(num(rate, HOURLY_RATE_DEFAULT));
    bp.hourly_rate = clamp(r, HOURLY_RATE_MIN, HOURLY_RATE_MAX);
    return derive(bp);
  }

  function setHasNoFxCard(bp, value) {
    bp.has_no_fx_card = value !== false;
    return derive(bp);
  }

  /* ---------------------------------------------------------------------
   * validate(bp) -> { ok, errors, warnings, missing }
   *
   * `errors` block generation. `warnings` do not — they record where the
   * Blueprint will produce zero attribution rather than a wrong one.
   * `missing` lists the field keys still needed, so intake UI can point at
   * the right screen without re-deriving the rules.
   * ------------------------------------------------------------------- */

  function validate(blueprint) {
    var bp = blueprint || {};
    var errors = [], warnings = [], missing = [];

    function err(field, message, screen) {
      errors.push({ field: field, message: message, screen: screen || null });
      if (missing.indexOf(field) === -1) missing.push(field);
    }
    function warn(field, message) {
      warnings.push({ field: field, message: message });
    }

    // destination + dates
    if (!str(bp.destination_name)) {
      err('destination_name', 'Choose a destination before generating your trip.', 's-dest');
    }
    if (bp.start_date && bp.end_date && !nightsBetween(bp.start_date, bp.end_date)) {
      err('end_date', 'The return date must be after the departure date.', 's-tripdetails');
    }
    if (!bp.nights) {
      err('nights', 'Set trip length — nights on the budget screen, or travel dates.', 's-bp-budget');
    } else if (bp.nights < NIGHTS_MIN || bp.nights > NIGHTS_MAX) {
      err('nights', 'Trip length must be between ' + NIGHTS_MIN + ' and ' + NIGHTS_MAX + ' nights.', 's-bp-budget');
    }
    if (!bp.start_date || !bp.end_date) {
      warn('start_date', 'No travel dates set — the itinerary will be generated by day number, not by date.');
    }

    // trip type
    if (!bp.trip_type) {
      err('trip_type', 'Pick at least one trip type.', 's-bp-triptype');
    } else if (BOOSTED_TRIP_TYPES.indexOf(bp.trip_type) === -1) {
      warn('trip_type', 'Trip type "' + bp.trip_type + '" has no ruled TRIP_TYPE_BOOST weights, ' +
        'so it adds no intent re-weighting (ruling H: suppress rather than fabricate).');
    }

    // travel mode + party
    if (!bp.travel_mode) {
      err('travel_mode', 'Say who you are travelling with.', 's-bp-who');
    }
    if (num(bp.party_size, 0) < 1) {
      err('party_size', 'Party size must be at least 1.', 's-bp-who');
    }

    // toggles
    if (bp.has_kids && !(bp.kid_ages_months || []).length) {
      err('kid_ages_months', 'Add each child\'s age — age gates depend on it.', 's-bp-kids');
    }
    (bp.kid_ages_months || []).forEach(function (m) {
      if (num(m, -1) < 0 || num(m, -1) > KID_AGE_MAX_MONTHS) {
        err('kid_ages_months', 'Child ages must be 0–' + KID_AGE_MAX_MONTHS + ' months.', 's-bp-kids');
      }
    });
    if (bp.has_pet && PET_SIZES.indexOf(bp.pet_size) === -1) {
      err('pet_size', 'Choose a pet size — Small, Medium or Large.', 's-bp-who');
    }
    if (bp.has_accessibility_needs &&
        !(bp.accessibility_needs || []).length && !str(bp.accessibility_notes)) {
      err('accessibility_needs', 'Add at least one accessibility detail, or describe it in your own words.', 's-ls-detail');
    }

    // mindset
    if (!(bp.mindset || []).length) {
      err('mindset', 'Choose what this trip needs to be. It shapes everything Romieaux suggests.', 's-bp-energy');
    }

    // pace — ruling G screen
    if (!bp.pace) {
      err('pace', 'Choose a pace — it sets the daily energy budget.', 's-ls-detail');
    }

    // budget
    if (bp.budget_mode === 'unset') {
      err('budget_total_usd', 'Set a budget, or choose to plan without one.', 's-bp-budget');
    } else if (bp.budget_mode === 'set' && !(num(bp.budget_total_usd, 0) > 0)) {
      err('budget_total_usd', 'Enter a budget above $0.', 's-bp-budget');
    } else if (bp.budget_mode === 'agnostic') {
      warn('budget_total_usd', 'No budget set, so nothing is measured against one.');
    }

    // engagement + rate
    if (ENGAGEMENT_MODES.indexOf(bp.engagement_mode) === -1) {
      err('engagement_mode', 'Choose how involved Romieaux should be.', 's-bp-mode');
    }
    var rate = num(bp.hourly_rate, 0);
    if (rate < HOURLY_RATE_MIN || rate > HOURLY_RATE_MAX) {
      err('hourly_rate', 'Hourly rate must be $' + HOURLY_RATE_MIN + '–$' + HOURLY_RATE_MAX + '.', 's-blueprint');
    }

    // dining — captured where a screen exists for it
    if (!(bp.cuisine_loves || []).length) {
      warn('cuisine_loves', 'No cuisine preferences captured, so restaurants are ranked on the rest of your answers.');
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings, missing: missing };
  }

  /* ---------------------------------------------------------------------
   * Engine handoff
   * ------------------------------------------------------------------- */

  /* The Blueprint is already shaped for engines.js, so this is a defensive
   * copy of exactly the keys the engines read — nothing else leaks into the
   * scoring layer. */
  function toEngineInput(blueprint) {
    var bp = blueprint || {};
    return {
      mindset: (bp.mindset || []).slice(),
      trip_type: bp.trip_type || null,
      travel_mode: bp.travel_mode || null,
      kid_ages_months: (bp.kid_ages_months || []).slice(),
      dietary_needs: (bp.dietary_needs || []).slice(),
      /* RULING AL item 8 — carried VERBATIM for the prompt, never tokenised.
       * The engines never read it; it reaches liveslice-api.js and stops. */
      dietary_notes: str(bp.dietary_notes),
      accessibility_needs: (bp.accessibility_needs || []).slice(),
      has_pet: !!bp.has_pet,
      party_size: Math.max(1, num(bp.party_size, 1)),
      has_no_fx_card: bp.has_no_fx_card !== false,
      hourly_rate: clamp(num(bp.hourly_rate, HOURLY_RATE_DEFAULT), HOURLY_RATE_MIN, HOURLY_RATE_MAX)
    };
  }

  /* The ctx object staysScore() / experienceROI() / packDay() take. */
  function toScoringContext(blueprint) {
    var bp = blueprint || {};
    return {
      tasteVector: Engines.buildTasteVector(toEngineInput(bp)),
      hourlyRate: clamp(num(bp.hourly_rate, HOURLY_RATE_DEFAULT), HOURLY_RATE_MIN, HOURLY_RATE_MAX),
      pace: bp.pace || 'moderate',
      engagementMode: bp.engagement_mode,
      luxuryThresholdUsd: bp.luxury_threshold_usd
    };
  }

  function tasteVector(blueprint) {
    return Engines.buildTasteVector(toEngineInput(blueprint));
  }

  /* ---------------------------------------------------------------------
   * Public surface
   * ------------------------------------------------------------------- */

  return {
    // vocabularies
    PACES: PACES,
    TRAVEL_MODES: TRAVEL_MODES,
    TRIP_TYPES: TRIP_TYPES,
    TRIP_TYPES_UI: TRIP_TYPES_UI,
    PET_SIZES: PET_SIZES,
    PET_TYPES: PET_TYPES,
    ENGAGEMENT_MODES: ENGAGEMENT_MODES,
    MINDSET_KEYS: MINDSET_KEYS,
    BUDGET_MODES: BUDGET_MODES,
    DESTINATION_MODES: DESTINATION_MODES,
    DINING_ADVENTUROUSNESS: DINING_ADVENTUROUSNESS,
    ACCESSIBILITY_NEEDS: ACCESSIBILITY_NEEDS,
    ACCESSIBILITY_KEYS: ACCESSIBILITY_KEYS,
    DIETARY_PRESETS: DIETARY_PRESETS,
    DIETARY_KEYS: DIETARY_KEYS,
    SUITS_VOCAB: SUITS_VOCAB,              // ruling AL

    // bounds
    HOURLY_RATE_MIN: HOURLY_RATE_MIN,
    HOURLY_RATE_MAX: HOURLY_RATE_MAX,
    HOURLY_RATE_DEFAULT: HOURLY_RATE_DEFAULT,
    NIGHTS_MIN: NIGHTS_MIN,
    NIGHTS_MAX: NIGHTS_MAX,
    KID_AGE_MAX_MONTHS: KID_AGE_MAX_MONTHS,
    PARTY_SIZE_MAX: PARTY_SIZE_MAX,
    LUXURY_QUARTILE: LUXURY_QUARTILE,

    // lifecycle
    create: create,
    derive: derive,
    validate: validate,

    // setters
    setDestination: setDestination,
    setDates: setDates,
    setNights: setNights,
    setTripTypes: setTripTypes,
    setTravelMode: setTravelMode,
    setKids: setKids,
    setPet: setPet,
    setAccessibility: setAccessibility,
    setMindset: setMindset,
    setPace: setPace,
    setBudget: setBudget,
    setDining: setDining,
    setEngagementMode: setEngagementMode,
    setHourlyRate: setHourlyRate,
    setHasNoFxCard: setHasNoFxCard,

    // derivation, exposed for tests and for the intake UI
    paceHours: paceHours,
    proactivityP: proactivityP,
    luxuryThreshold: luxuryThreshold,
    dietaryNeeds: dietaryNeeds,
    presetFor: presetFor,
    nightsBetween: nightsBetween,

    // engine handoff
    toEngineInput: toEngineInput,
    toScoringContext: toScoringContext,
    tasteVector: tasteVector
  };
})(typeof require === 'function' ? require('./engines.js')
   : (typeof window !== 'undefined' ? window.Engines : undefined));

/* No-op in the browser; lets the test suite run under node without a build step. */
if (typeof module !== 'undefined' && module.exports) { module.exports = Blueprint; }
