/* Romieaux — Live Slice API layer (P3).
 *
 * Bring-your-own-key generation call: settings panel, consent gate, the one
 * generation request, JSON parse/repair, plain-language error surfacing, and
 * the localStorage cache that powers offline Replay.
 *
 * NO DOLLAR FIGURE IS PRODUCED HERE. The model returns price ESTIMATES as
 * engine inputs (work order §4: "the attributes vector plus alt_channel,
 * area_median_rate_usd and the transport fields exist specifically so the
 * local engines have inputs"). Every attributed dollar — every SAVES, EARNS,
 * AVOIDED and every framework total — is computed by engines.js at P4/P5.
 * This file never adds, subtracts or renders money.
 *
 * Loads as a plain <script> (GitHub Pages, no build step). Also loads under
 * node for harness.js, which supplies a fake localStorage and a fake fetch —
 * there are no test-only hooks in the public surface; the harness controls the
 * environment instead, exactly as it does for liveslice-intake.js.
 */
var LiveSliceAPI = (function (root) {
  'use strict';

  /* =====================================================================
   * RULING K — model string and browser-access header, verified at build
   * time, recorded here with their references so the next session can tell
   * a verified choice from a stale one.
   *
   * Verified 2026-08-08.
   *
   * 1. MODEL. The work order §2 pins `claude-sonnet-4-6`. Ruling K amends
   *    §2: use the current Sonnet string verified via the claude-api skill.
   *    That skill's model catalogue (shared/models.md, "Current Models")
   *    lists Claude Sonnet 5 as `claude-sonnet-5` — 1M context, 128K max
   *    output — and routes the plain request "sonnet" to it. Sonnet 4.6 is
   *    listed as previous-generation. So: claude-sonnet-5.
   *
   *    Three Sonnet 5 constraints shape the request below:
   *      a. `thinking: {type:"enabled", budget_tokens:N}` is REMOVED — 400.
   *      b. `temperature` / `top_p` / `top_k` at non-default values are
   *         REJECTED — 400. They are therefore absent entirely.
   *      c. Adaptive thinking is ON when `thinking` is omitted (Sonnet 4.6
   *         ran thinking-off by omission). We set `{type:"disabled"}`
   *         EXPLICITLY: work order §10 requires the full run in under ~30
   *         seconds on hotel wifi, and this is one structured extraction,
   *         not a reasoning task. Scoring is 100% local either way (§2).
   *
   * 2. BROWSER-ACCESS HEADER. A browser-origin fetch to api.anthropic.com
   *    is refused by CORS unless it carries
   *
   *        anthropic-dangerous-direct-browser-access: true
   *
   *    Verified first-party in the official SDK source: anthropics/
   *    anthropic-sdk-typescript, src/client.ts — the client emits exactly
   *    `{'anthropic-dangerous-direct-browser-access': 'true'}` when the
   *    `dangerouslyAllowBrowser` option is set. The platform docs page
   *    "TypeScript SDK" (platform.claude.com/docs/en/cli-sdks-libraries/
   *    sdks/typescript, § Runtime support → Browser usage) documents the
   *    same opt-in and its risk: it "exposes your secret API credentials in
   *    the client-side code", and is acceptable for "internal tools" and
   *    trusted-user scenarios. That is precisely the work order §2 posture:
   *    bring-your-own-key, entered by the investor, localStorage only, no
   *    backend. The key is never committed and never leaves the browser
   *    except as the x-api-key header on the call to Anthropic.
   * ================================================================== */

  var MODEL = 'claude-sonnet-5';
  var API_URL = 'https://api.anthropic.com/v1/messages';
  var ANTHROPIC_VERSION = '2023-06-01';
  var BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';

  /* Non-streaming, so this stays under the ~16K ceiling above which the SDKs
   * require streaming to survive HTTP timeouts. A full itinerary JSON for a
   * two-week trip lands well inside it. */
  var MAX_TOKENS = 16000;

  /* localStorage keys. Namespaced under the ruling-I `liveSliceLedger`
   * vocabulary — nothing here collides with the prototype's own "ledger"
   * (getDemoLedger / s-bp-money-ledger), which is the group split. */
  var STORE_KEY = 'romieaux.liveSlice.apiKey';
  var STORE_CONSENT = 'romieaux.liveSlice.consent';
  var STORE_CACHE = 'romieaux.liveSlice.lastGeneration';

  /* Bump when the disclosure text materially changes: a traveller who
   * consented to an older disclosure is re-asked rather than assumed. */
  var CONSENT_VERSION = 1;

  var CACHE_VERSION = 1;

  /* Ruling A / §3: DCC-exposed spend runs 36–55% of total foreign spend
   * across the canonical corpus. Stated to the model explicitly, or it
   * conflates the two and the AVOIDED DCC row comes out several times too
   * large. These are prompt guidance for an INPUT ESTIMATE, not a rate and
   * not a dollar figure — the 3.5% DCC rate lives in engines.js. */
  var DCC_RATIO_LOW_PCT = 36;
  var DCC_RATIO_HIGH_PCT = 55;

  /* =====================================================================
   * Environment access. Everything the browser gives us is read through
   * these, so node (harness.js) can supply fakes and a private-browsing
   * localStorage throw can never break the demo.
   * ================================================================== */

  function storage() {
    try {
      return root.localStorage || null;
    } catch (e) {
      return null;                       // Safari private mode throws on access
    }
  }

  function storeGet(key) {
    var s = storage();
    if (!s) return null;
    try { return s.getItem(key); } catch (e) { return null; }
  }

  function storeSet(key, value) {
    var s = storage();
    if (!s) return false;
    try { s.setItem(key, value); return true; } catch (e) { return false; }
  }

  function storeRemove(key) {
    var s = storage();
    if (!s) return false;
    try { s.removeItem(key); return true; } catch (e) { return false; }
  }

  function currentFetch() {
    return (typeof root.fetch === 'function') ? root.fetch : null;
  }

  function el(id) {
    try {
      return root.document ? root.document.getElementById(id) : null;
    } catch (e) {
      return null;
    }
  }

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* =====================================================================
   * API key — localStorage only, never committed, never in the markup.
   * ================================================================== */

  function getKey() {
    var raw = storeGet(STORE_KEY);
    return raw ? String(raw).trim() : '';
  }

  function hasKey() {
    return getKey().length > 0;
  }

  function setKey(value) {
    var trimmed = String(value === undefined || value === null ? '' : value).trim();
    if (!trimmed) { clearKey(); return false; }
    return storeSet(STORE_KEY, trimmed);
  }

  function clearKey() {
    return storeRemove(STORE_KEY);
  }

  /* A key is shown back to the traveller masked, never in full — the panel
   * confirms "a key is saved" without re-exposing it to a shoulder-surfer in
   * a conference room. */
  function maskedKey() {
    var key = getKey();
    if (!key) return '';
    if (key.length <= 8) return '••••';
    return key.slice(0, 7) + '…' + key.slice(-4);
  }

  /* =====================================================================
   * Consent — the ref-based persistence fix (work order §2)
   *
   * THE BUG THIS PREVENTS. The Decipher implementation read consent into a
   * variable captured by the click handler's closure. The modal wrote
   * consent to localStorage and resolved, but the already-running generation
   * path still held the stale pre-consent value, so the next call re-prompted
   * a traveller who had just consented — mid-demo, in front of an audience.
   *
   * THE FIX. One module-level ref object is the single source of truth. It is
   *   (a) hydrated from localStorage once at load,
   *   (b) mutated SYNCHRONOUSLY the instant consent is granted — before any
   *       promise resolves and before any await continues, so no continuation
   *       can observe the pre-grant value,
   *   (c) re-read from the ref (never from a captured local) at every check,
   *   (d) re-hydrated on the `storage` event, so a second tab granting
   *       consent does not leave this tab re-prompting.
   *
   * Nothing in this file ever copies consentRef.granted into a variable that
   * outlives a synchronous block. That is the whole discipline.
   * ================================================================== */

  var consentRef = { granted: false, version: 0, at: null };

  function hydrateConsent() {
    var raw = storeGet(STORE_CONSENT);
    if (!raw) { consentRef.granted = false; consentRef.version = 0; consentRef.at = null; return consentRef; }
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') {
      consentRef.granted = false; consentRef.version = 0; consentRef.at = null;
      return consentRef;
    }
    consentRef.version = typeof parsed.version === 'number' ? parsed.version : 0;
    consentRef.at = parsed.at || null;
    // A stale disclosure version is NOT consent to the current disclosure.
    consentRef.granted = parsed.granted === true && consentRef.version === CONSENT_VERSION;
    return consentRef;
  }

  function hasConsent() {
    return consentRef.granted === true;
  }

  function grantConsent() {
    // (b) synchronous mutation FIRST — before the write, before any resolve.
    consentRef.granted = true;
    consentRef.version = CONSENT_VERSION;
    consentRef.at = new Date().toISOString();
    storeSet(STORE_CONSENT, JSON.stringify({
      granted: true, version: CONSENT_VERSION, at: consentRef.at
    }));
    return consentRef;
  }

  function revokeConsent() {
    consentRef.granted = false;
    consentRef.version = 0;
    consentRef.at = null;
    storeRemove(STORE_CONSENT);
    return consentRef;
  }

  /* =====================================================================
   * Typed errors. Every failure the traveller can see is one of these, with
   * a plain-language `message` and the raw status/API text kept alongside in
   * `detail` for the console. The Decipher lesson: an opaque error turned
   * out to be billing, and nobody could tell.
   * ================================================================== */

  function apiError(code, message, detail, status) {
    var err = new Error(message);
    err.name = 'LiveSliceError';
    err.code = code;
    err.detail = detail || '';
    err.status = status === undefined ? null : status;
    return err;
  }

  /* Maps an HTTP status + the API's own error body to plain language.
   * Pure — no DOM, no storage — so tests.js can assert every branch. */
  function describeHttpError(status, body) {
    var apiMessage = '';
    var apiType = '';
    if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
      apiMessage = body.error.message ? String(body.error.message) : '';
      apiType = body.error.type ? String(body.error.type) : '';
    }
    var detail = 'HTTP ' + status + (apiType ? ' · ' + apiType : '') + (apiMessage ? ' · ' + apiMessage : '');

    if (status === 401) {
      return apiError('auth',
        'That API key was rejected. Check it for a typo, or paste a fresh one from the Anthropic Console.',
        detail, status);
    }
    if (status === 403) {
      return apiError('forbidden',
        'That key is valid but is not permitted to use this model. Check the key\'s workspace and permissions in the Anthropic Console.',
        detail, status);
    }
    if (status === 400) {
      // Ruling: 400 leads with billing. It is the single most common cause in
      // a bring-your-own-key demo — a brand-new key with no credit on it —
      // and it is the failure that cost Decipher the most time, because the
      // raw message reads like a malformed request.
      return apiError('billing',
        'The request was rejected. The usual cause is an account with no credit — check billing and credit balance in the Anthropic Console. The API\'s own reason is below.',
        detail, status);
    }
    if (status === 429) {
      return apiError('rate_limit',
        'Rate limit reached on this key. Wait about a minute and run it again, or use Replay to show the last generated trip with no network call.',
        detail, status);
    }
    if (status === 413) {
      return apiError('too_large',
        'The Blueprint was too large to send. Shorten the free-text notes and try again.',
        detail, status);
    }
    if (status >= 500) {
      return apiError('server',
        'Anthropic\'s API is having trouble right now. Try again in a moment, or use Replay to show the last generated trip with no network call.',
        detail, status);
    }
    return apiError('http',
      'The API returned an unexpected response (HTTP ' + status + ').',
      detail, status);
  }

  /* =====================================================================
   * Fence stripping and JSON repair (work order §2)
   *
   * "Strip markdown fences before JSON.parse; on parse failure, retry once
   * with a 'return only valid JSON' reminder appended."
   *
   * Two salvage passes before we spend a second API call:
   *   1. strip a ```json … ``` (or bare ``` … ```) wrapper;
   *   2. slice from the first { to the last }, which survives a preamble
   *      sentence the model added despite being told not to.
   * Only if both fail do we retry. Pure — tests.js asserts every shape.
   * ================================================================== */

  var FENCE = /^```[a-zA-Z0-9_+-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/;

  function stripFences(text) {
    var t = String(text === undefined || text === null ? '' : text).trim();
    var match = t.match(FENCE);
    if (match) return match[1].trim();
    return t;
  }

  function braceSlice(text) {
    var t = String(text === undefined || text === null ? '' : text);
    var first = t.indexOf('{');
    var last = t.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return '';
    return t.slice(first, last + 1).trim();
  }

  /* Returns { ok:true, value } or { ok:false, reason }. Never throws. */
  function parseGeneration(text) {
    var stripped = stripFences(text);
    var candidates = [stripped];
    var sliced = braceSlice(stripped);
    if (sliced && sliced !== stripped) candidates.push(sliced);

    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      var value = null;
      try {
        value = JSON.parse(candidates[i]);
      } catch (e) {
        continue;
      }
      // A bare array or string is not the §4 object; treat it as a parse
      // failure so the retry fires rather than handing P4 a shape it cannot
      // validate.
      if (!value || typeof value !== 'object' || Object.prototype.toString.call(value) === '[object Array]') {
        continue;
      }
      return { ok: true, value: value };
    }
    return { ok: false, reason: 'no parseable JSON object in the response' };
  }

  /* Pulls the concatenated text out of a Messages API response body. */
  function textFromResponse(body) {
    if (!body || typeof body !== 'object') return '';
    var blocks = body.content;
    if (Object.prototype.toString.call(blocks) !== '[object Array]') return '';
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b && b.type === 'text' && typeof b.text === 'string') out.push(b.text);
    }
    return out.join('');
  }

  /* =====================================================================
   * The generation schema (work order §4, as amended)
   *
   * ADDITIONS the model supplies (RULINGS.md §2, ruled at P1, landing here):
   *   stay.locked_rate_usd                  ruling A, optional
   *   stay.flexible_rate_at_decision_usd    ruling A, optional
   *   pet_paperwork {expediter_quote_usd, official_fee_usd}
   *                                         ruling A, ONLY when pet is on
   *   dcc_exposed_spend_usd                 §3, with the 36–55% guidance
   *
   * ENGINE-INPUT-ONLY — excluded from the schema entirely, never asked for:
   *   card_scenario        EARNS rows; the Blueprint captures no card facts,
   *                        so v1 omits the rows rather than inventing them
   *   net_budget_usd       fixed at 0 for a generated trip
   *   fees_usd             fixed at 0 for a generated trip
   *   decisions_automated  derived from countable engine work at P4
   *
   * SCHEMA_TEXT below is what the model is shown as the shape to fill in.
   * Grep it: none of those four field names appear anywhere in it. They
   * appear in the system prompt exactly once each, in a single explicit
   * DO-NOT-INCLUDE line — belt and suspenders, so a model that half-recalls
   * a ledger schema from somewhere else is told plainly not to invent them.
   * tests.js §15 locks both halves of that contract.
   * ================================================================== */

  var SCHEMA_TEXT = [
    '{',
    '  "trip": { "destination": "", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "currency": "" },',
    '  "days": [',
    '    {',
    '      "date": "YYYY-MM-DD",',
    '      "items": [',
    '        {',
    '          "id": "d1-a1",',
    '          "module": "stays|dining|activities|transportation",',
    '          "name": "",',
    '          "est_price_usd": 0,',
    '          "est_price_local": 0,',
    '          "duration_hours": 0,',
    '          "transit_min_from_prev": 0,',
    '          "attributes": { "romantic": 0.0, "adventurous": 0.0, "cultural": 0.0, "restful": 0.0, "family": 0.0, "luxury": 0.0 },',
    '          "alt_channel": { "type": "portal|platform|resale|none", "price_usd": 0, "fee_rate": 0 },',
    '          "flexibility": "free|partial|prepaid",',
    '          "advance_discount_pct": 0,',
    '          "area_median_rate_usd": 0,',
    '          "crowd_shift": { "suggested_start": "", "queue_min_saved": 0 },',
    '          "weather_sensitive": false,',
    '          "covers": 0,',
    '          "tickets": 0,',
    '          "min_age_years": 0,',
    '          "pet_friendly": true,',
    '          "tags": [],',
    '          "accessibility": { "wheelchair": true, "limited_mobility": true, "visual": true, "hearing": true, "sensory": true },',
    '          "notes": ""',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "stay": {',
    '    "name": "",',
    '    "nightly_direct_usd": 0,',
    '    "nightly_portal_usd": 0,',
    '    "nights": 0,',
    '    "commute_min_to_anchors": 0,',
    '    "flexibility": "free|partial|prepaid",',
    '    "area_median_rate_usd": 0,',
    '    "locked_rate_usd": 0,',
    '    "flexible_rate_at_decision_usd": 0,',
    '    "attributes": { "romantic": 0.0, "adventurous": 0.0, "cultural": 0.0, "restful": 0.0, "family": 0.0, "luxury": 0.0 },',
    '    "accessibility": { "wheelchair": true, "limited_mobility": true, "visual": true, "hearing": true, "sensory": true },',
    '    "tags": [],',
    '    "pet_friendly": true,',
    '    "min_age_years": 0',
    '  },',
    '  "transport_segments": [',
    '    { "name": "", "direct_usd": 0, "portal_usd": 0, "tickets": 0, "single_fare_usd": 0, "planned_rides": 0, "pass_price_usd": 0 }',
    '  ],',
    '  "foreign_card_spend_estimate_usd": 0,',
    '  "dcc_exposed_spend_usd": 0',
    '}'
  ].join('\n');

  /* The four field names the model must never be asked for. Exported so the
   * suite can assert they are absent from every prompt we build — a
   * regression lock on the engine-input-only contract. */
  var ENGINE_INPUT_ONLY = ['card_scenario', 'net_budget_usd', 'fees_usd', 'decisions_automated'];

  function systemPrompt(blueprint) {
    var bp = blueprint || {};
    var lines = [];

    lines.push('You generate travel CANDIDATES ONLY for the Romieaux Live Slice.');
    lines.push('');
    lines.push('ABSOLUTE RULES');
    lines.push('1. You never compute savings, points values, fees, hours saved, decision counts, or any dollar attribution. A downstream deterministic engine does all of that. Your prices are good-faith market ESTIMATES that the engine uses as inputs.');
    lines.push('2. Respond with ONLY a single JSON object. No preamble, no commentary, no markdown fences.');
    lines.push('3. Honour hard constraints absolutely. An option that violates one must NOT APPEAR AT ALL — not listed, not flagged, not crossed out. Silently choose something else.');
    lines.push('4. Every priced item carries the fields the scoring engine needs. If you genuinely do not know a value, omit the field rather than inventing a favourable one.');
    lines.push('5. Prices are in USD in *_usd fields and in local currency in *_local fields.');
    lines.push('');
    lines.push('REQUIRED JSON SCHEMA');
    lines.push(SCHEMA_TEXT);
    lines.push('');
    lines.push('FIELD GUIDANCE');
    lines.push('- attributes: each dimension 0.0–1.0, describing what the item IS, not how well it matches the traveller. The engine does the matching.');
    lines.push('- alt_channel: the cheapest realistic third-party channel for the same item (portal, platform, resale), with its own price and any booking fee rate as a decimal (0.15 = 15%). Use type "none" when the item is only bookable direct.');
    lines.push('- area_median_rate_usd: the typical price for a comparable item in that area, so the engine can judge value.');
    lines.push('- flexibility: "free" = free cancellation, "partial" = partial refund, "prepaid" = non-refundable.');
    lines.push('- advance_discount_pct: whole percent off list for booking ahead (12 means 12%). 0 when there is none.');
    lines.push('- covers: number of diners for a dining item; use the party size.');
    lines.push('- tickets: number of admissions for an activity; use the party size.');
    lines.push('- accessibility: true means the item MEETS that need. Omit any key you are unsure of rather than guessing true.');
    lines.push('- tags: short lowercase descriptors (cuisine, style, "wellness", "spa", "outdoor"). Used for filtering.');
    lines.push('- min_age_years: the venue\'s own minimum age, when it has one. Omit if there is none.');
    lines.push('- stay: the stay carries attributes, accessibility, tags, pet_friendly and min_age_years on exactly the same terms as an item above. The traveller sleeps there every night, so it is scored and filtered like any other option — and it faces the same hard constraints.');
    lines.push('- stay.locked_rate_usd / stay.flexible_rate_at_decision_usd: include BOTH only when the stay genuinely has a flexible rate that is currently higher than a lockable rate. Otherwise omit both.');
    lines.push('- transport_segments: one entry per intercity or repeated-transit leg. single_fare_usd / planned_rides / pass_price_usd only where a transit pass genuinely exists.');
    lines.push('');
    lines.push('FOREIGN SPEND AND DCC — READ CAREFULLY');
    lines.push('- foreign_card_spend_estimate_usd: the traveller\'s TOTAL estimated card spend in local currency terms across the whole trip.');
    lines.push('- dcc_exposed_spend_usd: a DISTINCT AND SMALLER quantity — only the portion of that spend exposed to dynamic currency conversion, i.e. transactions at merchant terminals and ATMs that offer to bill in the traveller\'s home currency. It is NOT the same as total foreign spend and must never be set equal to it.');
    lines.push('- Calibration: across comparable trips, DCC-exposed spend runs about ' + DCC_RATIO_LOW_PCT + '%–' + DCC_RATIO_HIGH_PCT + '% of total foreign spend. Stay inside that band.');
    lines.push('- Both are estimates of the traveller\'s own spending. They are not savings and not fees.');
    lines.push('');
    lines.push('DO NOT INCLUDE any of these fields — they are computed downstream and any value you supply is discarded: ' + ENGINE_INPUT_ONLY.join(', ') + '.');

    /* Ruling R: the age and pet gates are verified-or-drop downstream, so the
     * prompt states the consequence plainly. A model told that omission
     * removes the option has a reason to be complete rather than terse. */
    if ((bp.kid_ages_months || []).length) {
      lines.push('');
      lines.push('CHILDREN ARE ON THIS TRIP: set "min_age_years" on any venue that has a minimum age, AND on the stay. If a venue is age-restricted and you leave the field out, it is REMOVED from the itinerary rather than shown — and an age-restricted stay is REFUSED as booked — so state the minimum where one exists.');
    }

    if (bp.has_pet) {
      lines.push('');
      lines.push('PET TRAVEL: this trip includes a pet.');
      lines.push('- Set "pet_friendly" on EVERY item AND on the stay. true means the venue is VERIFIED to accept the pet; false means it is verified not to. An item without it is REMOVED from the itinerary, and a stay without it is REFUSED as booked — only include places you can vouch for.');
      lines.push('- Also include a top-level "pet_paperwork" object with "expediter_quote_usd" (a typical commercial pet-paperwork expediter quote for this route) and "official_fee_usd" (the actual official government/vet fee). Both are market estimates.');
    }

    return lines.join('\n');
  }

  /* The traveller-facing half of the prompt: the Blueprint, stated as facts.
   * Only fields the traveller actually answered are sent. */
  function userPrompt(blueprint) {
    var bp = blueprint || {};
    var lines = [];
    var nights = bp.nights || null;

    lines.push('Build a day-by-day itinerary for this traveller.');
    lines.push('');
    lines.push('TRIP');
    lines.push('- Destination: ' + (bp.destination_name || 'not yet chosen — pick one that fits the profile below and name it in trip.destination'));
    if (bp.start_date && bp.end_date) {
      lines.push('- Dates: ' + bp.start_date + ' to ' + bp.end_date + (nights ? ' (' + nights + ' nights)' : ''));
      lines.push('- Produce one entry in "days" for every date from start to end inclusive.');
    } else if (nights) {
      lines.push('- Length: ' + nights + ' nights. Use plausible dates and produce one entry in "days" per night.');
    }
    if (bp.trip_type) lines.push('- Trip type: ' + bp.trip_type);
    if (bp.trip_types && bp.trip_types.length > 1) lines.push('- Also: ' + bp.trip_types.join(', '));

    lines.push('');
    lines.push('WHO IS GOING');
    if (bp.travel_mode) lines.push('- Travel mode: ' + bp.travel_mode);
    lines.push('- Party size: ' + (bp.party_size || 1));
    if (bp.has_kids && bp.kid_ages_months && bp.kid_ages_months.length) {
      var years = bp.kid_ages_months.map(function (m) {
        var y = Math.floor((Number(m) || 0) / 12);
        return y < 1 ? 'under 1' : y + 'y';
      });
      lines.push('- Children on the trip: ' + years.join(', ') + '. Every item must be genuinely age-appropriate and admit children.');
    }
    if (bp.has_pet) {
      lines.push('- Travelling with a ' + (bp.pet_size || 'small') + ' ' + (bp.pet_type || 'pet') +
        (bp.pet_service_animal ? ' (service animal)' : '') + '. The stay and every venue must actually accept it.');
    }

    if (bp.has_accessibility_needs && bp.accessibility_needs && bp.accessibility_needs.length) {
      lines.push('');
      lines.push('ACCESSIBILITY — HARD CONSTRAINTS');
      lines.push('- Every item must meet: ' + bp.accessibility_needs.join(', ') + '.');
      lines.push('- Set the matching accessibility keys to true on each item AND on the stay. Anything that cannot meet these must not appear.');
      lines.push('- A key you leave out counts as unverified, and an unverified option is removed. The stay is checked the same way, so state its accessibility explicitly.');
      if (bp.accessibility_notes) lines.push('- Traveller\'s note: ' + bp.accessibility_notes);
    }

    if (bp.dietary_hard_lines && bp.dietary_hard_lines.length) {
      lines.push('');
      lines.push('DIETARY HARD LINES — ABSOLUTE');
      lines.push('- These terms must not appear in any dining item\'s name, notes or tags, and no dining item may serve them as the dish being recommended: ' + bp.dietary_hard_lines.join(', ') + '.');
      lines.push('- A venue that cannot reliably accommodate this is simply not included.');
    }

    lines.push('');
    lines.push('TASTE AND PACE');
    if (bp.mindset && bp.mindset.length) lines.push('- Mindset: ' + bp.mindset.join(', '));
    if (bp.pace && bp.pace_hours) {
      lines.push('- Pace: ' + bp.pace + '. Schedule NO MORE THAN ' + bp.pace_hours + ' hours of activity per day, transit included.');
    }
    if (bp.cuisine_loves && bp.cuisine_loves.length) lines.push('- Cuisine loves: ' + bp.cuisine_loves.join(', '));
    if (bp.dining_adventurousness) lines.push('- Dining adventurousness: ' + bp.dining_adventurousness);

    lines.push('');
    lines.push('BUDGET');
    if (bp.budget_mode === 'agnostic') {
      lines.push('- The traveller is budget-agnostic. Price items realistically for a well-chosen trip.');
    } else if (bp.budget_total_usd) {
      lines.push('- About $' + bp.budget_total_usd + ' per person, all in' + (nights ? ', across ' + nights + ' nights' : '') + '. Keep the total plausible against that.');
    } else {
      lines.push('- No budget stated. Price items realistically for a mid-to-upper-range trip.');
    }

    lines.push('');
    lines.push('Return the JSON object and nothing else.');
    return lines.join('\n');
  }

  var RETRY_REMINDER = [
    '',
    '',
    'IMPORTANT: your previous response could not be parsed as JSON.',
    'Return ONLY a single valid JSON object matching the schema.',
    'No markdown fences, no ``` characters, no preamble, no trailing commentary.',
    'The first character of your response must be { and the last must be }.'
  ].join('\n');

  /* =====================================================================
   * The request itself.
   * ================================================================== */

  function requestBody(blueprint, withReminder) {
    var user = userPrompt(blueprint) + (withReminder ? RETRY_REMINDER : '');
    return {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Ruling K note (c): explicit, because Sonnet 5 runs adaptive thinking
      // when this is omitted, and §10 budgets the whole run at ~30 seconds.
      thinking: { type: 'disabled' },
      // No temperature / top_p / top_k: Sonnet 5 rejects non-default sampling
      // parameters with a 400. Behaviour is steered by the prompt instead.
      system: systemPrompt(blueprint),
      messages: [{ role: 'user', content: user }]
    };
  }

  function requestHeaders(key) {
    var headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION
    };
    headers[BROWSER_ACCESS_HEADER] = 'true';   // ruling K, see header block
    return headers;
  }

  /* One HTTP round trip. Resolves with the parsed response body, or rejects
   * with a typed LiveSliceError. */
  function callOnce(blueprint, withReminder) {
    var doFetch = currentFetch();
    if (!doFetch) {
      return Promise.reject(apiError('no_fetch',
        'This browser cannot make the request (fetch is unavailable).', '', null));
    }
    var key = getKey();

    return doFetch(API_URL, {
      method: 'POST',
      headers: requestHeaders(key),
      body: JSON.stringify(requestBody(blueprint, withReminder))
    }).then(function (response) {
      return response.text().then(function (raw) {
        var body = null;
        try { body = JSON.parse(raw); } catch (e) { body = null; }

        if (!response.ok) {
          throw describeHttpError(response.status, body);
        }
        if (!body) {
          throw apiError('bad_response',
            'The API returned a response this build could not read.',
            String(raw).slice(0, 300), response.status);
        }
        return body;
      });
    }, function (networkError) {
      // A CORS rejection and a dead wifi connection are indistinguishable to
      // fetch, so the message names both, and Replay as the way out.
      throw apiError('network',
        'Could not reach the Anthropic API. Check the connection — or use Replay to show the last generated trip with no network call.',
        networkError && networkError.message ? networkError.message : '', null);
    });
  }

  /* =====================================================================
   * generate() — the whole path, gated.
   * ================================================================== */

  function generate(blueprint) {
    var bp = blueprint || readBlueprint();

    if (!hasKey()) {
      openSettings();
      return Promise.reject(apiError('no_key',
        'No API key saved yet. Add one in Live Slice settings — it is stored in this browser only.', '', null));
    }

    // (c) consent is read from the ref at call time, never from a captured
    // local. requestConsent() resolves only after the ref has already been
    // mutated synchronously.
    return requestConsent().then(function () {
      if (!hasConsent()) {
        throw apiError('no_consent',
          'Generation needs your go-ahead to send the Blueprint to Anthropic.', '', null);
      }
      return callOnce(bp, false);
    }).then(function (body) {
      var parsed = parseGeneration(textFromResponse(body));
      if (parsed.ok) return { trip: parsed.value, repaired: false };

      // Work order §2: one retry, with the reminder appended.
      if (root.console && root.console.warn) {
        root.console.warn('Live Slice: generation did not parse — retrying once with a JSON-only reminder.', parsed.reason);
      }
      return callOnce(bp, true).then(function (retryBody) {
        var retried = parseGeneration(textFromResponse(retryBody));
        if (retried.ok) return { trip: retried.value, repaired: true };
        throw apiError('unparseable',
          'The model\'s reply could not be read as an itinerary, twice in a row. Run it again, or use Replay.',
          retried.reason, null);
      });
    }).then(function (result) {
      cacheGeneration(result.trip, bp, result.repaired);
      return result.trip;
    });
  }

  /* Reads the live Blueprint from the P2 intake if one is wired. */
  function readBlueprint() {
    try {
      if (root.LiveSlice && typeof root.LiveSlice.blueprint === 'function') {
        if (typeof root.LiveSlice.sync === 'function') root.LiveSlice.sync();
        return root.LiveSlice.blueprint();
      }
    } catch (e) { /* fall through */ }
    return {};
  }

  /* =====================================================================
   * Cache and Replay (work order §2)
   *
   * "Cache the last successful generation in localStorage. A 'Replay last
   * generated trip' button runs the full scoring + ledger animation without
   * a network call, so the demo survives bad conference-room wifi."
   *
   * The Blueprint is cached alongside the trip because P4 scores the trip
   * AGAINST a Blueprint — replaying tonight's trip against tomorrow's edited
   * Blueprint would silently produce a ledger that never existed.
   * ================================================================== */

  function cacheGeneration(trip, blueprint, repaired) {
    var payload = {
      cache_version: CACHE_VERSION,
      model: MODEL,
      generated_at: new Date().toISOString(),
      repaired: !!repaired,
      destination: (blueprint && blueprint.destination_name) || (trip && trip.trip && trip.trip.destination) || null,
      blueprint: blueprint || null,
      trip: trip
    };
    var written = storeSet(STORE_CACHE, JSON.stringify(payload));
    if (!written && root.console && root.console.warn) {
      root.console.warn('Live Slice: could not cache the generation — Replay will be unavailable this session.');
    }
    return written;
  }

  function cachedGeneration() {
    var raw = storeGet(STORE_CACHE);
    if (!raw) return null;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.cache_version !== CACHE_VERSION) return null;
    if (!parsed.trip || typeof parsed.trip !== 'object') return null;
    return parsed;
  }

  function hasCachedGeneration() {
    return cachedGeneration() !== null;
  }

  function clearCache() {
    return storeRemove(STORE_CACHE);
  }

  /* The offline path. No key, no consent, no network — by design: nothing
   * leaves the browser, so nothing needs consenting to. */
  function replay() {
    var cached = cachedGeneration();
    if (!cached) {
      return Promise.reject(apiError('no_cache',
        'Nothing to replay yet — no trip has been generated in this browser.', '', null));
    }
    return Promise.resolve(cached);
  }

  /* =====================================================================
   * Settings panel
   * ================================================================== */

  function renderSettings(message, tone) {
    var status = el('ls-settings-status');
    if (status) {
      if (hasKey()) {
        status.innerHTML = '<span style="color:var(--gn,#4a9d5f);">Key saved in this browser</span> · ' + esc(maskedKey());
      } else {
        status.innerHTML = '<span style="color:var(--tm,#6b6257);">No key saved yet</span>';
      }
    }

    var consentLine = el('ls-settings-consent');
    if (consentLine) {
      consentLine.innerHTML = hasConsent()
        ? 'Consent given ' + esc((consentRef.at || '').slice(0, 10)) + ' · <a href="#" onclick="LiveSliceAPI.revokeConsent();LiveSliceAPI.renderSettings();return false;" style="color:var(--sd,#b08a50);">withdraw</a>'
        : 'Consent not yet given. You will be asked before the first call.';
    }

    var replayLine = el('ls-settings-replay');
    if (replayLine) {
      var cached = cachedGeneration();
      replayLine.textContent = cached
        ? 'Last generated trip cached: ' + (cached.destination || 'a trip') + ', ' + String(cached.generated_at).slice(0, 10) + '. Replay works with the network off.'
        : 'No cached trip yet. Once you generate one, Replay works with the network off.';
    }

    var note = el('ls-settings-note');
    if (note) {
      note.textContent = message || '';
      note.style.display = message ? 'block' : 'none';
      note.style.color = tone === 'bad' ? 'var(--rd,#c4553f)' : 'var(--gn,#4a9d5f)';
    }
  }

  function openSettings() {
    var overlay = el('ls-settings-overlay');
    if (!overlay) return false;
    var input = el('ls-key-input');
    if (input) input.value = '';
    renderSettings('');
    overlay.style.display = 'flex';
    return true;
  }

  function closeSettings() {
    var overlay = el('ls-settings-overlay');
    if (overlay) overlay.style.display = 'none';
    return true;
  }

  function saveKeyFromPanel() {
    var input = el('ls-key-input');
    var value = input ? input.value : '';
    if (!String(value).trim()) {
      renderSettings('Paste a key first.', 'bad');
      return false;
    }
    var saved = setKey(value);
    if (input) input.value = '';
    renderSettings(saved
      ? 'Saved. It stays in this browser and is sent only to Anthropic.'
      : 'This browser refused to store the key (private mode?). Generation will not work here.',
      saved ? 'good' : 'bad');
    return saved;
  }

  function clearKeyFromPanel() {
    clearKey();
    renderSettings('Key removed from this browser.', 'good');
    return true;
  }

  /* =====================================================================
   * Consent modal
   *
   * Resolves as soon as consent exists — the ref is mutated synchronously in
   * grantConsent() before this promise settles, so no continuation anywhere
   * can observe a stale "not consented" value. That is the whole fix.
   * ================================================================== */

  var pendingConsent = null;

  function requestConsent() {
    if (hasConsent()) return Promise.resolve(true);
    if (pendingConsent) return pendingConsent.promise;

    var overlay = el('ls-consent-overlay');
    if (!overlay) {
      // No modal in the DOM (node, or a stripped page): cannot obtain
      // consent, so refuse rather than silently proceeding.
      return Promise.reject(apiError('no_consent',
        'Generation needs your go-ahead to send the Blueprint to Anthropic.', '', null));
    }

    var summary = el('ls-consent-payload');
    if (summary) summary.innerHTML = consentPayloadSummary();

    var resolveFn = null, rejectFn = null;
    var promise = new Promise(function (resolve, reject) { resolveFn = resolve; rejectFn = reject; });
    pendingConsent = { promise: promise, resolve: resolveFn, reject: rejectFn };
    overlay.style.display = 'flex';
    return promise;
  }

  function acceptConsent() {
    grantConsent();                       // synchronous ref mutation, first
    var overlay = el('ls-consent-overlay');
    if (overlay) overlay.style.display = 'none';
    var pending = pendingConsent;
    pendingConsent = null;
    if (pending) pending.resolve(true);
    return true;
  }

  function declineConsent() {
    var overlay = el('ls-consent-overlay');
    if (overlay) overlay.style.display = 'none';
    var pending = pendingConsent;
    pendingConsent = null;
    if (pending) {
      pending.reject(apiError('no_consent',
        'Nothing was sent. Generation needs your go-ahead first.', '', null));
    }
    return false;
  }

  /* Exactly what is sent, listed from the live Blueprint — not a generic
   * description of it (work order §2: "disclosing exactly what is sent"). */
  function consentPayloadSummary() {
    var bp = readBlueprint();
    var rows = [];

    function row(label, value) {
      if (value === null || value === undefined || value === '' ||
          (value.length !== undefined && value.length === 0)) return;
      rows.push('<div style="display:flex;gap:10px;padding:3px 0;">' +
        '<div style="min-width:118px;font-family:var(--fm,monospace);font-size:9px;letter-spacing:1px;' +
        'text-transform:uppercase;color:var(--rg,#8a7f6f);padding-top:2px;">' + esc(label) + '</div>' +
        '<div style="flex:1;font-size:12px;color:var(--tm,#6b6257);line-height:1.5;">' + esc(value) + '</div></div>');
    }

    row('Destination', bp.destination_name);
    if (bp.start_date && bp.end_date) row('Dates', bp.start_date + ' → ' + bp.end_date);
    row('Nights', bp.nights);
    row('Trip type', (bp.trip_types && bp.trip_types.length) ? bp.trip_types.join(', ') : bp.trip_type);
    row('Travel mode', bp.travel_mode);
    row('Party size', bp.party_size);
    if (bp.has_kids && bp.kid_ages_months && bp.kid_ages_months.length) {
      row('Children', bp.kid_ages_months.length + ' (ages in months)');
    }
    if (bp.has_pet) row('Pet', (bp.pet_size || '') + ' ' + (bp.pet_type || 'pet'));
    row('Mindset', (bp.mindset || []).join(', '));
    row('Pace', bp.pace);
    row('Budget', bp.budget_mode === 'agnostic' ? 'budget-agnostic'
      : (bp.budget_total_usd ? '$' + bp.budget_total_usd + ' per person' : null));
    row('Dietary lines', (bp.dietary_hard_lines || []).join(', '));
    row('Accessibility', (bp.accessibility_needs || []).join(', '));
    row('Notes', [bp.dietary_notes, bp.accessibility_notes].filter(Boolean).join(' · '));

    if (!rows.length) {
      return '<div style="font-size:12px;color:var(--tm,#6b6257);">Your Blueprint is empty so far — nothing would be sent yet.</div>';
    }
    return rows.join('');
  }

  /* =====================================================================
   * Launcher. Hidden by default: a visitor walking the canonical 7-trip
   * demo sees a pixel-identical prototype. Revealed once Live Slice is
   * armed, or on demand via the #ls-settings hash or showLauncher().
   * ================================================================== */

  function showLauncher() {
    var chip = el('ls-launcher');
    if (chip) chip.style.display = 'block';
    return !!chip;
  }

  function hideLauncher() {
    var chip = el('ls-launcher');
    if (chip) chip.style.display = 'none';
    return !!chip;
  }

  function syncLauncher() {
    var armed = false;
    try {
      armed = !!(root.LiveSlice && typeof root.LiveSlice.isArmed === 'function' && root.LiveSlice.isArmed());
    } catch (e) { armed = false; }
    if (armed) showLauncher();
    return armed;
  }

  /* =====================================================================
   * Init
   * ================================================================== */

  function init() {
    hydrateConsent();

    try {
      if (root.addEventListener) {
        // (d) a second tab granting or withdrawing consent must not leave
        // this tab re-prompting, or holding consent that was withdrawn.
        root.addEventListener('storage', function (event) {
          if (!event || event.key === STORE_CONSENT || event.key === null) hydrateConsent();
        }, false);
      }
      if (root.location && String(root.location.hash) === '#ls-settings') openSettings();
    } catch (e) { /* non-browser host */ }

    renderSettings('');
    syncLauncher();
  }

  try {
    if (root.document && root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', init);
    } else if (root.document) {
      init();
    } else {
      hydrateConsent();
    }
  } catch (e) {
    hydrateConsent();
  }

  /* =====================================================================
   * Public surface
   * ================================================================== */

  return {
    // ruling K — verified constants, exposed so the suite can assert them
    MODEL: MODEL,
    API_URL: API_URL,
    ANTHROPIC_VERSION: ANTHROPIC_VERSION,
    BROWSER_ACCESS_HEADER: BROWSER_ACCESS_HEADER,
    MAX_TOKENS: MAX_TOKENS,
    ENGINE_INPUT_ONLY: ENGINE_INPUT_ONLY,
    SCHEMA_TEXT: SCHEMA_TEXT,
    DCC_RATIO_LOW_PCT: DCC_RATIO_LOW_PCT,
    DCC_RATIO_HIGH_PCT: DCC_RATIO_HIGH_PCT,
    CONSENT_VERSION: CONSENT_VERSION,

    // key
    hasKey: hasKey,
    setKey: setKey,
    clearKey: clearKey,
    maskedKey: maskedKey,

    // consent
    hasConsent: hasConsent,
    grantConsent: grantConsent,
    revokeConsent: revokeConsent,
    hydrateConsent: hydrateConsent,
    requestConsent: requestConsent,
    acceptConsent: acceptConsent,
    declineConsent: declineConsent,
    consentPayloadSummary: consentPayloadSummary,

    // prompt + parse — pure, unit-tested
    systemPrompt: systemPrompt,
    userPrompt: userPrompt,
    requestBody: requestBody,
    requestHeaders: requestHeaders,
    stripFences: stripFences,
    braceSlice: braceSlice,
    parseGeneration: parseGeneration,
    textFromResponse: textFromResponse,
    describeHttpError: describeHttpError,

    // the call
    generate: generate,

    // cache + replay
    replay: replay,
    cachedGeneration: cachedGeneration,
    hasCachedGeneration: hasCachedGeneration,
    clearCache: clearCache,

    // panels, referenced from the appended markup
    openSettings: openSettings,
    closeSettings: closeSettings,
    renderSettings: renderSettings,
    saveKeyFromPanel: saveKeyFromPanel,
    clearKeyFromPanel: clearKeyFromPanel,
    showLauncher: showLauncher,
    hideLauncher: hideLauncher,
    syncLauncher: syncLauncher
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* No-op in the browser; lets harness.js load this under node without a build step. */
if (typeof module !== 'undefined' && module.exports) { module.exports = LiveSliceAPI; }
