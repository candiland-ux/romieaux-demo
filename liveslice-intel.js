/* Romieaux — Live Slice destination intel (ruling AO). Playlist first.
 *
 * RULINGS §5g's scheduled post-push PHASE 2, built at AO. It routes the
 * intent of the function ruling AE deleted through the Live Slice key
 * mechanism — LiveSliceAPI's key storage, its ref-based consent gate, the
 * current model string, the browser-access header, its fence-strip and one
 * retry, and its plain-language typed errors — and adds its own prompt, its
 * own §7 validator and a per-destination cache.
 *
 * AE: "A future rebuild is a re-plumb against a new schema, not a
 * resurrection of this code."
 *
 * FOUR THINGS THIS FILE DOES NOT DO, each ruled rather than omitted:
 *
 *   1. IT CARRIES NO PRICE. §5g ruled the intel schema price-free in terms —
 *      the removed prompt asked for "p":"$X/night" and those rendered on
 *      canonical module screens, which have no equivalent of the Live Slice
 *      price() helper that structurally cannot emit a figure without the word
 *      "estimate" beside it. There is no price field, no cost field, no usd
 *      field, and validateIntel() drops any that arrive BY NAME rather than
 *      as a generic unknown, so the reason is legible in the log.
 *
 *   2. IT NEVER TOUCHES fetch. Every byte leaves through
 *      LiveSliceAPI.requestJSON(), which is the same transport generate()
 *      uses. §15 asserts the API layer holds the one reference to the global
 *      fetch; a copy of that plumbing here is exactly the drift §15 exists to
 *      fail on.
 *
 *   3. IT NEVER CALLS ON THE REPLAY PATH. Replay is the offline path by
 *      design — work order §2's bad-conference-room-wifi promise, and
 *      harness §11.2b removes fetch entirely and asserts nothing reaches for
 *      it. A replayed trip reads the intel cache or says it has no playlist.
 *
 *   4. IT NEVER TAKES THE SCREEN DOWN. Intel fires AFTER the itinerary and
 *      the ledger have rendered, and a failure is reported IN PLACE, in this
 *      block, never through stageError()'s whole-screen refusal panel. A
 *      second call that fails must not cost the traveller a reconciled trip.
 *
 * NO DOLLAR FIGURE IS PRODUCED HERE, and none can be: there is no money in
 * the schema for one to come from. CLAUDE.md's Ledger Law is untouched and
 * the no-hardcoded-dollar grep has nothing to find.
 */
var LiveSliceIntel = (function (root, Blueprint, API) {
  'use strict';

  /* Load-order throw, on blueprint.js:23's precedent rather than a quiet
   * default. A silent fallback here would render an empty playlist block on
   * every trip and look like a model that returned nothing.
   *
   * The dependencies arrive as IIFE PARAMETERS, on the pattern
   * liveslice-api.js already uses: it lets tests.js require this file under
   * node without a build step, while the browser and the harness vm both hand
   * it the same globals off `window`. */
  if (!Blueprint) {
    throw new Error('liveslice-intel.js requires blueprint.js to load first.');
  }
  if (!API) {
    throw new Error('liveslice-intel.js requires liveslice-api.js to load first.');
  }

  /* ---------------------------------------------------------------------
   * Bounds and keys
   * ------------------------------------------------------------------- */

  var STORE_INTEL = 'romieaux.liveSlice.intel';
  var INTEL_VERSION = 1;

  /* The output bound, and it is what keeps ruling AO item 8's cost figure
   * honest rather than hopeful. A playlist is not an itinerary: the
   * generation call runs against MAX_TOKENS 16000 because it returns a whole
   * trip, and this one is capped an order of magnitude below it. AO measured
   * the pair against Sonnet 5's published rates and found them inside AB's
   * shipped "roughly 10-20 cents", so AB's copy was ruled UNCHANGED — and
   * that arithmetic only holds while this number does.
   *
   * THE MEASURED BASIS LIVES IN THE RULING, NOT HERE. That is ruling AB's own
   * convention, and it is also what keeps this file clean under the
   * no-hardcoded-dollar grep that ruling AO extends to cover it. */
  var INTEL_MAX_TOKENS = 2000;

  var TRACKS_MAX = 12;
  var TEXT_MAX = 240;
  var NAME_MAX = 120;

  /* The grounding vocabulary, closed. Two values and nothing else — see the
   * prompt below for what earns each, and validateIntel() for what an
   * unrecognised value costs. */
  var GROUNDINGS = ['local', 'genre'];

  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObject(v) { return !!v && typeof v === 'object' && !isArray(v); }

  function text(value, max) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    return String(value).trim().slice(0, max === undefined ? TEXT_MAX : max);
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(id) {
    try { return document.getElementById(id); } catch (e) { return null; }
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  /* =====================================================================
   * THE PROMPT — everything from INTEL_SCHEMA_TEXT down to requestIntel()
   * is addressed to Claude and to nobody else.
   *
   * §20.5 EXCLUDES THIS RANGE, derived from these two markers rather than
   * hand-numbered, exactly as it derives liveslice-api.js's generation
   * prompt from `var SCHEMA_TEXT = [` .. `function requestBody(`. That
   * exclusion is a SINGLE contiguous range, so a second prompt written
   * anywhere else in the bundle lands outside it and every JSON / schema /
   * token literal in it is classified as copy a traveller reads. Ruling AO
   * conflict 6: this is the one AM's corpus-wide ban catches, and the cure
   * is AN's — derive a second exclusion, and put the file in the corpus.
   * ================================================================== */

  var INTEL_SCHEMA_TEXT = [
    '{',
    '  "destination": "the destination, as you understand it",',
    '  "playlist": {',
    '    "title": "a short name for this playlist, five words or fewer",',
    '    "note": "one plain sentence about how this playlist fits the trip",',
    '    "tracks": [',
    '      {',
    '        "artist": "",',
    '        "track": "",',
    '        "genre": "one of the genres the traveller chose, or the closest one",',
    '        "grounding": "local" | "genre",',
    '        "why": "one short clause, no more than about twelve words"',
    '      }',
    '    ]',
    '  }',
    '}'
  ].join('\n');

  function intelSystemPrompt() {
    return [
      'You suggest music for a traveller. You are given a destination and the',
      'music genres the traveller chose during onboarding.',
      '',
      'Respond with ONLY a single JSON object matching the schema below. No',
      'preamble, no markdown fences, no trailing commentary. The first',
      'character of your response must be { and the last must be }.',
      '',
      'SCHEMA',
      INTEL_SCHEMA_TEXT,
      '',
      'GROUNDING — READ THIS BEFORE YOU WRITE A SINGLE TRACK.',
      'Name only artists and tracks you can actually attribute. For each item',
      'set "grounding" to:',
      '  "local"  only when the artist is genuinely from this destination, or',
      '           strongly and specifically associated with it. Not "sounds',
      '           like it could be". Not a guess from the name.',
      '  "genre"  when the pick comes from the traveller\'s chosen genres',
      '           rather than from the place.',
      'If you cannot honestly state which of the two it is, LEAVE THE FIELD',
      'OUT. An item with no grounding is removed from the playlist before the',
      'traveller ever sees it, so an invented local artist costs you the slot',
      'rather than earning one.',
      '',
      'Between 6 and ' + TRACKS_MAX + ' tracks. Real artists, real tracks.',
      'Do not invent either. Fewer honest tracks is the right answer; a made-up',
      'one is never the right answer.',
      '',
      'DO NOT INCLUDE ANY PRICE, COST, FEE OR CURRENCY FIELD OF ANY KIND, on',
      'any object, under any name. There is no money in this schema and any',
      'you add is discarded before it reaches a screen.'
    ].join('\n');
  }

  function intelUserPrompt(bp, destination) {
    var b = bp || {};
    var lines = [];
    var genres = (b.music_genres || []).slice();

    lines.push('Build a playlist for this traveller.');
    lines.push('');
    lines.push('DESTINATION');
    lines.push('- ' + (destination || b.destination_name || 'not stated'));

    lines.push('');
    if (genres.length) {
      lines.push('THE GENRES THE TRAVELLER CHOSE');
      lines.push('- ' + genres.join(', ') + '.');
      lines.push('- Build the playlist from these. Where an artist from the');
      lines.push('  destination fits one of them, prefer that artist and mark it "local".');
    } else {
      lines.push('THE GENRES THE TRAVELLER CHOSE');
      lines.push('- None. They skipped that question.');
      lines.push('- Build the playlist from the destination instead, and set');
      lines.push('  "grounding" honestly: most items will be "local".');
    }

    if (b.trip_types && b.trip_types.length) {
      lines.push('');
      lines.push('THE TRIP');
      lines.push('- Type: ' + b.trip_types.join(', ') + '.');
    } else if (b.trip_type) {
      lines.push('');
      lines.push('THE TRIP');
      lines.push('- Type: ' + b.trip_type + '.');
    }
    if (b.mindset && b.mindset.length) lines.push('- Mindset: ' + b.mindset.join(', ') + '.');
    if (b.pace) lines.push('- Pace: ' + b.pace + '.');
    if (b.travel_mode) lines.push('- Travel mode: ' + b.travel_mode + '.');

    lines.push('');
    lines.push('Return the JSON object and nothing else.');
    return lines.join('\n');
  }

  function requestIntel(bp, destination) {
    return API.requestJSON({
      label: 'playlist',
      system: intelSystemPrompt(),
      user: intelUserPrompt(bp, destination),
      max_tokens: INTEL_MAX_TOKENS
    });
  }

  /* =====================================================================
   * THE VALIDATOR (work order §7)
   *
   * liveslice-scoring.js's discipline, on a second payload: validate against
   * the schema, clamp what is out of bounds, drop what is unknown, and
   * default every missing field to a value that produces nothing rather than
   * something invented. Its note() channels are console-bound, which is what
   * §5f requires and what §20.5's exclusion is written against.
   * ================================================================== */

  /* Any key whose name says money. Dropped BY NAME rather than as a generic
   * unknown, because §5g ruled this field class out by name and a silent
   * generic drop would not say which rule fired. */
  var MONEY_KEY = /price|cost|usd|eur|gbp|fee|amount|currency|\bspend\b/i;

  var TRACK_KEYS = ['artist', 'track', 'genre', 'grounding', 'why'];
  var PLAYLIST_KEYS = ['title', 'note', 'tracks'];
  var ROOT_KEYS = ['destination', 'playlist'];

  function newReport() {
    return {
      errors: [],
      warnings: [],
      dropped: [],
      clamped: [],
      defaulted: [],
      /* RULING AJ founder addition 1's mechanism, on a seventh field.
       * Verified-or-drop's own failure mode is a model that omits the field
       * wholesale, and the answer is that it is caught by a NUMBER rather
       * than by an empty playlist a reader would blame on the model's taste. */
      tracksTotal: 0,
      tracksUngrounded: 0
    };
  }

  function note(list, path, detail) {
    list.push({ path: path, detail: detail });
  }

  function dropUnknown(raw, allowed, path, rep) {
    Object.keys(raw).forEach(function (key) {
      if (allowed.indexOf(key) !== -1) return;
      if (MONEY_KEY.test(key)) {
        note(rep.dropped, path + '.' + key,
          'a money field — RULINGS §5g ruled the intel schema price-free, so it is discarded before it can reach a screen');
      } else {
        note(rep.dropped, path + '.' + key, 'not in the intel schema — dropped as unknown');
      }
    });
  }

  function cleanTrack(raw, path, rep) {
    if (!isObject(raw)) {
      note(rep.dropped, path, 'not an object — dropped');
      return null;
    }
    dropUnknown(raw, TRACK_KEYS, path, rep);

    var artist = text(raw.artist, NAME_MAX);
    var track = text(raw.track, NAME_MAX);
    if (!artist || !track) {
      note(rep.dropped, path, 'no artist or no track name — dropped');
      return null;
    }

    /* VERIFIED-OR-DROP, on a seventh field, and the direction rulings P, Q,
     * R, U, AJ, AL and AN all share. An unrecognised value is treated the
     * same as an absent one: the model has not told us what it is claiming,
     * and a claim we cannot read is not a claim. */
    var grounding = GROUNDINGS.indexOf(String(raw.grounding || '').toLowerCase().trim()) !== -1
      ? String(raw.grounding).toLowerCase().trim()
      : null;

    if (!grounding) {
      rep.tracksUngrounded++;
      note(rep.dropped, path + '.grounding',
        'not stated as local or genre — the item is unverified and is removed, per ruling AO');
      return null;
    }

    return {
      artist: artist,
      track: track,
      genre: text(raw.genre, NAME_MAX),
      grounding: grounding,
      why: text(raw.why, TEXT_MAX)
    };
  }

  function validateIntel(raw) {
    var rep = newReport();

    if (!isObject(raw)) {
      note(rep.errors, 'root', 'the reply was not a single object');
      return { ok: false, intel: null, report: rep };
    }
    dropUnknown(raw, ROOT_KEYS, 'root', rep);

    var playlistRaw = isObject(raw.playlist) ? raw.playlist : null;
    if (!playlistRaw) {
      note(rep.errors, 'playlist', 'the reply carried no playlist');
      return { ok: false, intel: null, report: rep };
    }
    dropUnknown(playlistRaw, PLAYLIST_KEYS, 'playlist', rep);

    var tracksRaw = isArray(playlistRaw.tracks) ? playlistRaw.tracks : [];
    if (!isArray(playlistRaw.tracks)) {
      note(rep.defaulted, 'playlist.tracks', 'not a list — treated as empty, which renders no playlist rather than an invented one');
    }
    if (tracksRaw.length > TRACKS_MAX) {
      note(rep.clamped, 'playlist.tracks',
        tracksRaw.length + ' tracks supplied — kept the first ' + TRACKS_MAX);
    }

    var tracks = [];
    for (var i = 0; i < tracksRaw.length && tracks.length < TRACKS_MAX; i++) {
      rep.tracksTotal++;
      var t = cleanTrack(tracksRaw[i], 'playlist.tracks[' + i + ']', rep);
      if (t) tracks.push(t);
    }

    /* ZERO SURVIVING TRACKS IS NOT AN ERROR. It is the empty state, and it
     * renders as one — §5f's "never substitute, never pad", carried from the
     * itinerary to the playlist. A padded playlist would be the invented
     * local artist arriving by a second route. */
    return {
      ok: true,
      intel: {
        destination: text(raw.destination, NAME_MAX),
        playlist: {
          title: text(playlistRaw.title, NAME_MAX),
          note: text(playlistRaw.note, TEXT_MAX),
          tracks: tracks
        }
      },
      report: rep
    };
  }

  /* CALLED THROUGH root.console DIRECTLY, NOT THROUGH A LOCAL ALIAS, and the
   * reason is worth stating because the first version did the opposite and
   * §20.5 caught it in the build that introduced it.
   *
   * §20.5 tells build-side literals from traveller copy by LEXING and then
   * excluding the ranges of `console.*` / `logError` / `logInfo` / `sinkError`
   * CALLS. A local `var c = root.console` defeats that by position: `c.info(`
   * is not a shape it recognises, so every diagnostic string in here was
   * classified as copy a traveller reads and the ban fired on `dropped`,
   * `clamped` and two em dashes. The strings were right; the call shape was
   * wrong. §5f says the console keeps the build-side vocabulary — this is
   * what lets the lexer see that it is the console. */
  function logIntel(rep) {
    if (!root.console || !root.console.info) return false;
    root.console.info('Live Slice: playlist validated', {
      tracks_supplied: rep.tracksTotal,
      tracks_ungrounded_and_dropped: rep.tracksUngrounded,
      dropped: rep.dropped.length,
      clamped: rep.clamped.length,
      defaulted: rep.defaulted.length,
      errors: rep.errors.length
    });
    rep.dropped.forEach(function (d) {
      root.console.info('  dropped ' + d.path + ' — ' + d.detail);
    });
    rep.clamped.forEach(function (d) {
      root.console.info('  clamped ' + d.path + ' — ' + d.detail);
    });
    return true;
  }

  /* =====================================================================
   * THE CACHE — per destination AND per genre set
   *
   * §5g said "a per-destination cache", and it said so before genres were in
   * scope. A destination-only key serves last week's jazz playlist to a
   * traveller who has just picked Country, under a header that says "Your
   * genres" — a silent falsehood, and the failure this whole chain of
   * rulings keeps being about. Recorded in ruling AO as a REFINEMENT of §5g
   * with its reason, not a deviation taken quietly.
   * ================================================================== */

  function cacheKey(bp, destination) {
    var b = bp || {};
    var where = String(destination || b.destination_name || '').toLowerCase().trim();
    var genres = (b.music_genres || []).slice().sort().join(',').toLowerCase();
    return where + '|' + genres;
  }

  function readStore() {
    var s = storage();
    if (!s) return null;
    var raw = null;
    try { raw = s.getItem(STORE_INTEL); } catch (e) { return null; }
    if (!raw) return null;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.intel_version !== INTEL_VERSION) return null;
    return parsed;
  }

  function cachedIntel(key) {
    var stored = readStore();
    if (!stored || stored.key !== key) return null;
    if (!stored.intel || typeof stored.intel !== 'object') return null;
    return stored.intel;
  }

  function storeIntel(key, intel) {
    var s = storage();
    if (!s) return false;
    try {
      s.setItem(STORE_INTEL, JSON.stringify({
        intel_version: INTEL_VERSION,
        generated_at: new Date().toISOString(),
        key: key,
        intel: intel
      }));
      return true;
    } catch (e) {
      if (root.console && root.console.warn) {
        root.console.warn('Live Slice: could not cache the playlist.', e);
      }
      return false;
    }
  }

  function clearCache() {
    var s = storage();
    if (!s) return false;
    try { s.removeItem(STORE_INTEL); return true; } catch (e) { return false; }
  }

  /* =====================================================================
   * RENDER — everything below here is copy a traveller reads.
   *
   * §20.5's eighteen-term ban and §20.6's corpus-wide em-dash ban both apply
   * to every literal from this point down, and liveslice-intel.js is in
   * AK_FILES so they actually reach it — which is the hole ruling AN found
   * in engines.js and closed one letter ago.
   * ================================================================== */

  var SLOT = 'ls-res-intel';

  function shell(eyebrow, body) {
    return '<div style="margin:0 20px 12px;background:var(--pn);border:1px solid var(--bd);' +
      'border-radius:12px;padding:14px 16px;">' +
      '<div style="font-family:var(--fm);font-size:8px;letter-spacing:1.5px;color:var(--ts);' +
      'text-transform:uppercase;margin-bottom:8px;">' + esc(eyebrow) + '</div>' +
      body + '</div>';
  }

  function line(copy) {
    return '<div style="font-size:12px;color:var(--tm);line-height:1.6;">' + copy + '</div>';
  }

  /* RULING AO 4. "Your genres" is TRUE HERE FOR THE FIRST TIME, and it is
   * AO's own header rather than a revival of the canonical module's — ruling
   * AF pair 1 is not reverted, because those three headers still sit above
   * three hand-authored track lists that no genre shaped.
   *
   * WITH NO GENRES CHOSEN IT READS BY DESTINATION AND NEVER CLAIMS GENRES.
   * That is AF's own rider A discipline: true everywhere the copy appears,
   * or the copy does not appear. */
  function playlistEyebrow(bp) {
    return (bp && bp.music_genres && bp.music_genres.length) ? 'Your genres' : 'Playlist';
  }

  function trackRow(t, destination) {
    var tail = t.grounding === 'local'
      ? 'Local to ' + esc(destination || 'this destination')
      : esc(t.genre || '');
    return '<div style="display:flex;gap:10px;padding:6px 0;border-top:1px solid var(--bd);">' +
      '<div style="flex:1;min-width:0;">' +
      '<div style="font-size:12.5px;color:var(--ink);line-height:1.45;overflow-wrap:anywhere;">' +
      esc(t.artist) + ' · ' + esc(t.track) + '</div>' +
      (tail || t.why
        ? '<div style="font-size:11px;color:var(--ts);line-height:1.5;margin-top:2px;overflow-wrap:anywhere;">' +
          [tail, esc(t.why)].filter(Boolean).join(' · ') + '</div>'
        : '') +
      '</div></div>';
  }

  function playlistMarkup(intel, bp, destination) {
    var tracks = (intel && intel.playlist && intel.playlist.tracks) || [];
    if (!tracks.length) {
      /* §5f, carried from the itinerary to the playlist: never substitute,
       * never pad. An empty playlist says it is empty. */
      return shell(playlistEyebrow(bp),
        line('No playlist this time. Nothing came back that we could tie to your music or to this ' +
          'place, and we would rather leave it out than make it up.'));
    }
    var title = intel.playlist.title;
    var note = intel.playlist.note;
    return shell(playlistEyebrow(bp),
      (title ? '<div style="font-family:var(--fd);font-size:15px;font-weight:600;color:var(--ink);' +
        'margin-bottom:3px;">' + esc(title) + '</div>' : '') +
      (note ? '<div style="font-size:11.5px;color:var(--ts);line-height:1.55;margin-bottom:8px;">' +
        esc(note) + '</div>' : '') +
      tracks.map(function (t) { return trackRow(t, destination); }).join(''));
  }

  /* RULING AO 2 — THE KEYLESS STATE, and this is the definition §5g made a
   * precondition of two phases. One sentence, one place, and the shape is
   * the same everywhere the question comes up: what you are looking at, why,
   * and the one thing that changes it.
   *
   * THE BLOCK IS NEVER EMPTY AND IS NEVER A STUB DRESSED AS A RESULT. Ruling
   * AF's interim sample line exists because the canonical music screen does
   * exactly that, and this block is written so it cannot. */
  function keylessMarkup(bp) {
    return shell(playlistEyebrow(bp),
      line('No playlist for this trip. Building one needs your own Anthropic API key, the same kind ' +
        'that generates a trip. Add one in “Generated live” settings and the next trip you ' +
        'generate gets a playlist with it.'));
  }

  /* Ruling S's convention, carried by AK item 6 to the dietary field and by
   * AL to `suits`, applied here to a seventh: the wording says the trip
   * PREDATES the playlist, never that no playlist could be built for it. */
  function legacyMarkup(bp) {
    return shell(playlistEyebrow(bp),
      line('This trip was saved before Romieaux started building playlists, so it does not have one. ' +
        'Generate a fresh trip and it will.'));
  }

  function pendingMarkup(bp) {
    return shell(playlistEyebrow(bp), line('Building your playlist…'));
  }

  /* §19: nothing silent. The second call announces its own failure, in
   * place, in the traveller's words, and the itinerary and the ledger above
   * it are untouched — which is why this is not stageError(). */
  function failureMarkup(bp, error) {
    var message = (error && error.message) ? String(error.message) : 'Something went wrong.';
    var detail = (error && error.detail) ? String(error.detail) : '';
    return shell(playlistEyebrow(bp),
      '<div style="font-size:12px;color:var(--tx);line-height:1.6;">' +
      'Your trip is here, but the playlist did not arrive. ' + esc(message) + '</div>' +
      (detail ? '<div style="font-size:11px;color:var(--ts);line-height:1.55;margin-top:4px;">' +
        esc(detail) + '</div>' : ''));
  }

  function paint(markup) {
    var node = el(SLOT);
    if (!node) return false;
    node.innerHTML = markup;
    return true;
  }

  /* =====================================================================
   * The run
   * ================================================================== */

  function destinationOf(result) {
    var trip = result && result.trip && result.trip.trip;
    return (trip && trip.destination) ||
      (result && result.blueprint && result.blueprint.destination_name) || '';
  }

  /* Resolves with a short verdict string naming which state was rendered, so
   * the harness can assert the branch rather than infer it from markup. */
  function run(result) {
    var bp = (result && result.blueprint) || Blueprint.create();
    var destination = destinationOf(result);
    var key = cacheKey(bp, destination);

    var hit = cachedIntel(key);
    if (hit) {
      paint(playlistMarkup(hit, bp, destination));
      if (root.console && root.console.info) {
        root.console.info('Live Slice: playlist served from cache, no call made.', key);
      }
      return Promise.resolve('cache');
    }

    /* Replay is the offline path. Work order §2 promises it survives bad
     * conference-room wifi and harness §11.2b removes fetch entirely to
     * prove it, so a second call here would break the one guarantee Replay
     * exists to make. */
    if (result && result.source === 'replay') {
      paint(legacyMarkup(bp));
      return Promise.resolve('legacy');
    }

    if (!API.hasKey()) {
      paint(keylessMarkup(bp));
      return Promise.resolve('keyless');
    }

    paint(pendingMarkup(bp));

    return requestIntel(bp, destination).then(function (raw) {
      var checked = validateIntel(raw);
      logIntel(checked.report);
      if (!checked.ok) {
        paint(failureMarkup(bp, { message: 'The reply could not be read as a playlist.' }));
        return 'invalid';
      }
      storeIntel(key, checked.intel);
      paint(playlistMarkup(checked.intel, bp, destination));
      return checked.intel.playlist.tracks.length ? 'rendered' : 'empty';
    }, function (error) {
      if (root.console && root.console.error) {
        root.console.error('Live Slice: the playlist call failed.', error);
      }
      paint(failureMarkup(bp, error));
      return 'failed';
    });
  }

  return {
    STORE_INTEL: STORE_INTEL,
    INTEL_VERSION: INTEL_VERSION,
    INTEL_MAX_TOKENS: INTEL_MAX_TOKENS,
    TRACKS_MAX: TRACKS_MAX,
    GROUNDINGS: GROUNDINGS,
    INTEL_SCHEMA_TEXT: INTEL_SCHEMA_TEXT,

    intelSystemPrompt: intelSystemPrompt,
    intelUserPrompt: intelUserPrompt,
    validateIntel: validateIntel,

    cacheKey: cacheKey,
    cachedIntel: cachedIntel,
    storeIntel: storeIntel,
    clearCache: clearCache,

    playlistEyebrow: playlistEyebrow,
    run: run
  };
})(typeof globalThis !== 'undefined' ? globalThis : this,
   typeof require === 'function' ? require('./blueprint.js')
   : (typeof window !== 'undefined' ? window.Blueprint : undefined),
   typeof require === 'function' ? require('./liveslice-api.js')
   : (typeof window !== 'undefined' ? window.LiveSliceAPI : undefined));

/* node (harness.js) — the browser path uses the global above. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LiveSliceIntel;
}
