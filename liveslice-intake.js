/* Romieaux — Live Slice intake wiring (P2).
 *
 * Mirrors the canonical onboarding screens into the Blueprint, and drives the
 * one supplemental Live Slice screen ruling G allows (pace, dietary hard
 * lines, accessibility detail).
 *
 * HOW THIS STAYS ADDITIVE (ruling J)
 *
 *   - No canonical function body is edited. `nav()` is WRAPPED: the original
 *     runs first, its return value is passed straight through, and the
 *     Blueprint sync runs afterwards inside try/catch, so a fault in Live
 *     Slice code can never break canonical navigation.
 *   - Every other screen is read through ONE delegated listener per screen
 *     container. A delegated listener on an ancestor fires during bubbling,
 *     after the canonical inline onclick has already run, so it always sees
 *     post-click state.
 *   - `updateTimeRate()` is not touched (ruling L). The hourly rate is read
 *     from the canonical `userHourlyRate` global, whose slider is already
 *     $15-$500 default $50 — exactly what work order §3 specifies.
 *   - The flow into the supplemental screen only engages when Live Slice is
 *     armed via LiveSlice.begin(). Nothing arms it in P2, so the canonical
 *     onboarding behaves identically to the shipped prototype.
 *
 * No dollar figure is produced here. The Blueprint carries the traveller's own
 * budget input and the derived luxury threshold; every attributed dollar comes
 * from engines.js (CLAUDE.md).
 */
var LiveSlice = (function () {
  'use strict';

  if (typeof Blueprint === 'undefined' || typeof Engines === 'undefined') {
    console.warn('Live Slice: engines.js and blueprint.js must load before liveslice-intake.js.');
    return null;
  }

  var bp = Blueprint.create();
  var armed = false;         // set by begin(); gates the supplemental screen
  var originalNav = null;

  /* Canonical `S` uses a few group values the Blueprint's travel_mode
   * vocabulary does not carry (the demo loaders set 'family'). Alias rather
   * than drop, so a loaded demo trip does not read as "no travel mode". */
  var GROUP_ALIASES = {
    solo: 'solo', partner: 'partner', couple: 'partner',
    group: 'group', friends: 'group', family: 'group', mixed: 'group'
  };

  function canonicalState() {
    return (typeof S !== 'undefined' && S) ? S : {};
  }

  function globalValue(name, fallback) {
    try {
      var v = window[name];
      return v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function el(id) { return document.getElementById(id); }

  function digits(value) {
    var raw = String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '');
    return raw ? parseInt(raw, 10) : 0;
  }

  /* ---------------------------------------------------------------------
   * Reading the canonical screens
   * ------------------------------------------------------------------- */

  /* s-bp-energy — the mindset multi-select. The canonical handler keeps its
   * selection in the `selectedEnergies` global and never writes it to S. */
  function readMindset() {
    Blueprint.setMindset(bp, globalValue('selectedEnergies', []));
  }

  /* s-bp-triptype — multi-select; the canonical handler mirrors it into S. */
  function readTripTypes() {
    var s = canonicalState();
    var types = (s.tripTypes && s.tripTypes.length) ? s.tripTypes : (s.tripType ? [s.tripType] : []);
    Blueprint.setTripTypes(bp, types);
  }

  /* s-bp-who — travel mode, the two toggles, and the pet card. */
  function readTravelMode() {
    var s = canonicalState();
    var mode = GROUP_ALIASES[String(s.group || '').toLowerCase()] || null;
    Blueprint.setTravelMode(bp, mode, s.groupSize);
  }

  function readKids() {
    var enabled = !!globalValue('hasKidsFlag', false);
    Blueprint.setKids(bp, enabled, enabled ? globalValue('kidAges', []) : []);
  }

  /* Pet size is captured from the DOM because the canonical pet card's chips
   * call fc() — the list-filter helper — and never write S.petSize. fc() does
   * give each chip row radio behaviour, so exactly one chip per row carries
   * `.sel`, in document order: type row first, size row second.
   *
   * The canonical screen allows several pets; §3 models one. The first card
   * feeds the Blueprint, matching what S.petName / S.petSize already mean. */
  function readPet() {
    var s = canonicalState();
    var enabled = !!s.hasPet;
    if (!enabled) { Blueprint.setPet(bp, false); return; }

    var list = el('pet-list');
    var card = list ? list.querySelector('div') : null;
    if (!card) { Blueprint.setPet(bp, true, { size: bp.pet_size, type: bp.pet_type }); return; }

    var chosen = card.querySelectorAll('.chip.sel');
    var type = null, size = null;
    for (var i = 0; i < chosen.length; i++) {
      var text = chosen[i].textContent.toLowerCase();
      if (/dog|cat|other/.test(text) && !type) {
        type = /dog/.test(text) ? 'dog' : /cat/.test(text) ? 'cat' : 'other';
      } else if (/small|medium|large/.test(text) && !size) {
        size = /small/.test(text) ? 'small' : /medium/.test(text) ? 'medium' : 'large';
      }
    }
    var nameInput = card.querySelector('input[type="text"]');
    var serviceBox = card.querySelector('input[type="checkbox"]');

    Blueprint.setPet(bp, true, {
      size: size,
      type: type,
      name: nameInput ? nameInput.value : '',
      service_animal: serviceBox ? serviceBox.checked : false
    });
  }

  /* Ruling G: only the TOGGLE is canonical. The canonical chips underneath it
   * call fc() and write nothing, so accessibility detail is captured on the
   * supplemental screen and preserved here. */
  function readAccessibilityToggle() {
    var enabled = !!globalValue('hasAccessFlag', false);
    Blueprint.setAccessibility(
      bp, enabled,
      enabled ? bp.accessibility_needs : [],
      enabled ? bp.accessibility_notes : ''
    );
  }

  /* s-bp-mode — ruling F.
   *
   * The canonical free "I'll plan it" card calls selectMode(this,'lightly'),
   * but ruling F maps that free tier to Essential (P = 0.25). 'lightly'
   * (P = 0.5) is a tier the canonical screen does not offer, so the string
   * S.mode === 'lightly' can only mean the free card was chosen. */
  function readEngagementMode() {
    var mode = String(canonicalState().mode || '').toLowerCase();
    if (mode === 'lightly') mode = 'essential';
    if (Blueprint.ENGAGEMENT_MODES.indexOf(mode) !== -1) {
      Blueprint.setEngagementMode(bp, mode);
    }
  }

  /* s-bp-budget — nights and the budget envelope. */
  function readBudget() {
    var s = canonicalState();
    if (s.tripDays) Blueprint.setNights(bp, s.tripDays);

    var mode = String(s.budget || '').toLowerCase();
    if (mode === 'agnostic') {
      Blueprint.setBudget(bp, 'agnostic', null);
      return;
    }
    var input = el('budget-input');
    var amount = digits(input && input.value ? input.value : s.budgetAmt);
    if (mode === 'set' || amount > 0) {
      Blueprint.setBudget(bp, amount > 0 ? 'set' : 'unset', amount);
    }
  }

  /* s-dest / s-discover — destination. */
  function readDestination() {
    var s = canonicalState();
    var typed = el('dest-in');
    var mode = (typed && typed.value.trim()) ? 'own' : (s.destName ? 'suggested' : null);
    Blueprint.setDestination(bp, s.destName, s.destKey, mode);
  }

  /* s-tripdetails — travel dates. */
  function readDates() {
    var depart = el('td-depart');
    var back = el('td-return');
    Blueprint.setDates(bp, depart ? depart.value : null, back ? back.value : null);
  }

  /* s-blueprint — the canonical hourly-rate slider, read not wrapped. */
  function readHourlyRate() {
    Blueprint.setHourlyRate(bp, globalValue('userHourlyRate', Blueprint.HOURLY_RATE_DEFAULT));
  }

  function syncAll() {
    readMindset();
    readTripTypes();
    readTravelMode();
    readKids();
    readPet();
    readAccessibilityToggle();
    readEngagementMode();
    readBudget();
    readDestination();
    readDates();
    readHourlyRate();
    return bp;
  }

  /* ---------------------------------------------------------------------
   * The supplemental Live Slice screen (ruling G)
   * ------------------------------------------------------------------- */

  var PACE_COPY = {
    slow:     { title: 'Slow',     note: 'Room to breathe. One anchor a day.' },
    moderate: { title: 'Moderate', note: 'A full day with margin around it.' },
    full:     { title: 'Full',     note: 'Dense days. You want to see everything.' }
  };

  function renderPaceOptions() {
    var host = el('ls-pace-opts');
    if (!host) return;
    host.innerHTML = Blueprint.PACES.map(function (key) {
      var copy = PACE_COPY[key] || { title: key, note: '' };
      var selected = bp.pace === key ? ' sel' : '';
      // Colour is inherited so the .opt.lt.sel state stays legible; only
      // opacity separates the supporting copy from the label.
      return '<button class="opt lt' + selected + '" style="text-align:left;" ' +
        'onclick="LiveSlice.pickPace(\'' + key + '\')">' +
        '<span style="font-weight:600;">' + copy.title + '</span>' +
        // "up to" — the pace budget is a HARD CAP that packDay() holds items
        // back to stay under, never a target. Copy must not promise past it.
        '<span style="opacity:.65;"> · up to ' + Engines.PACE_HOURS[key] + ' scheduled hours a day</span>' +
        '<div style="font-size:11px;opacity:.65;margin-top:2px;">' + copy.note + '</div>' +
        '</button>';
    }).join('');
  }

  function renderDietaryChips() {
    var host = el('ls-diet-chips');
    if (!host) return;
    host.innerHTML = Blueprint.DIETARY_PRESETS.map(function (preset) {
      var selected = bp.dietary_selections.indexOf(preset.key) !== -1 ? ' sel' : '';
      return '<button class="chip' + selected + '" data-ls-diet="' + preset.key + '" ' +
        'onclick="LiveSlice.toggleDietary(\'' + preset.key + '\')">' + preset.label + '</button>';
    }).join('');
  }

  function renderAccessibilityChips() {
    var block = el('ls-access-block');
    if (!block) return;
    // Ruling G: accessibility detail appears only when the canonical toggle
    // on s-bp-who was already set.
    block.style.display = bp.has_accessibility_needs ? 'block' : 'none';
    var host = el('ls-access-chips');
    if (!host) return;
    host.innerHTML = Blueprint.ACCESSIBILITY_NEEDS.map(function (need) {
      var selected = bp.accessibility_needs.indexOf(need.key) !== -1 ? ' sel' : '';
      return '<button class="chip' + selected + '" data-ls-access="' + need.key + '" ' +
        'style="text-align:left;" ' +
        'onclick="LiveSlice.toggleAccessNeed(\'' + need.key + '\')">' + need.label + '</button>';
    }).join('');
  }

  function renderDetail() {
    syncAll();
    renderPaceOptions();
    renderDietaryChips();
    renderAccessibilityChips();
    var dietNotes = el('ls-diet-notes');
    if (dietNotes) dietNotes.value = bp.dietary_notes;
    var accessNotes = el('ls-access-notes');
    if (accessNotes) accessNotes.value = bp.accessibility_notes;
    showErrors([]);
  }

  function pickPace(key) {
    Blueprint.setPace(bp, key);
    renderPaceOptions();
    showErrors([]);
  }

  function toggleDietary(key) {
    var current = bp.dietary_selections.slice();
    var idx = current.indexOf(key);
    if (idx > -1) current.splice(idx, 1); else current.push(key);
    Blueprint.setDining(bp, { selections: current });
    renderDietaryChips();
  }

  function toggleAccessNeed(key) {
    if (!bp.has_accessibility_needs) return;
    var current = bp.accessibility_needs.slice();
    var idx = current.indexOf(key);
    if (idx > -1) current.splice(idx, 1); else current.push(key);
    Blueprint.setAccessibility(bp, true, current, bp.accessibility_notes);
    renderAccessibilityChips();
    showErrors([]);
  }

  function onDietaryNotes(value) {
    Blueprint.setDining(bp, { notes: value });
  }

  function onAccessNotes(value) {
    if (!bp.has_accessibility_needs) return;
    Blueprint.setAccessibility(bp, true, bp.accessibility_needs, value);
    showErrors([]);
  }

  function showErrors(errors) {
    var host = el('ls-detail-errors');
    if (!host) return;
    if (!errors.length) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    host.style.display = 'block';
    host.innerHTML = '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;' +
      'color:var(--rd);text-transform:uppercase;margin-bottom:6px;">Still needed</div>' +
      errors.map(function (e) {
        return '<div style="font-size:12px;color:var(--tm);line-height:1.6;">· ' + e.message + '</div>';
      }).join('');
  }

  /* Continue: validate the whole Blueprint, not only this screen. Anything
   * unresolved on an earlier screen is reported here rather than surfacing as
   * a bad generation later. */
  function continueFromDetail() {
    syncAll();
    var result = Blueprint.validate(bp);
    if (!result.ok) {
      showErrors(result.errors);
      if (typeof showToast === 'function') showToast('A few Blueprint answers are still missing');
      console.warn('Live Slice: Blueprint incomplete', result.errors);
      return false;
    }
    if (result.warnings.length) {
      console.info('Live Slice: Blueprint warnings', result.warnings);
    }
    // Straight to the unwrapped nav, so the interception above does not bounce
    // us back here. Leaving `armed` set means Back-then-forward returns to this
    // screen with every answer still in place, rather than skipping it.
    if (originalNav) originalNav('s-bp-loading'); else nav('s-bp-loading');
    try { syncAll(); } catch (e) { console.warn('Live Slice: intake sync failed', e); }
    return true;
  }

  /* ---------------------------------------------------------------------
   * Wiring
   * ------------------------------------------------------------------- */

  /* Delegated listeners. One per screen container, bubble phase, so the
   * canonical inline handler has already run by the time we read state. */
  var WATCHED_SCREENS = [
    's-bp-energy', 's-bp-triptype', 's-bp-who', 's-bp-kids', 's-bp-mode',
    's-bp-budget', 's-dest', 's-discover', 's-tripdetails', 's-blueprint'
  ];

  function wireScreens() {
    WATCHED_SCREENS.forEach(function (id) {
      var screen = el(id);
      if (!screen) return;
      ['click', 'input', 'change'].forEach(function (type) {
        screen.addEventListener(type, function () {
          try { syncAll(); } catch (e) { console.warn('Live Slice: intake sync failed', e); }
        }, false);
      });
    });
  }

  /* nav() wrapper — the original runs first and its return value is passed
   * through untouched. The Live Slice work happens afterwards, in try/catch. */
  function wireNav() {
    if (typeof nav !== 'function') {
      console.warn('Live Slice: nav() not found — intake not wired.');
      return;
    }
    originalNav = nav;
    window.nav = function (id) {
      // Ruling G: one supplemental screen, after canonical onboarding and
      // before generation. Only engages once Live Slice has been armed, so
      // the canonical flow is unchanged for everyone else.
      if (armed && id === 's-bp-loading') {
        var routed = originalNav('s-ls-detail');
        try { renderDetail(); } catch (e) { console.warn('Live Slice: detail render failed', e); }
        return routed;
      }
      var result = originalNav.apply(this, arguments);
      try {
        syncAll();
        if (id === 's-ls-detail') renderDetail();
      } catch (e) {
        console.warn('Live Slice: intake sync failed', e);
      }
      return result;
    };
  }

  function init() {
    wireScreens();
    wireNav();
    syncAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ---------------------------------------------------------------------
   * Public surface
   * ------------------------------------------------------------------- */

  return {
    /* Arms the Live Slice path: the next attempt to reach s-bp-loading routes
     * through the supplemental screen first. The dashboard entry card that
     * calls this ships with the results UI (work order §6). */
    begin: function () {
      armed = true;
      return bp;
    },
    isArmed: function () { return armed; },

    blueprint: function () { return bp; },
    sync: syncAll,
    validate: function () { syncAll(); return Blueprint.validate(bp); },
    reset: function () {
      bp = Blueprint.create();
      armed = false;
      return bp;
    },

    /* Handoff to the scoring layer (P4). */
    engineInput: function () { syncAll(); return Blueprint.toEngineInput(bp); },
    scoringContext: function () { syncAll(); return Blueprint.toScoringContext(bp); },

    /* Supplemental-screen handlers, referenced from its inline markup. */
    openDetail: function () { nav('s-ls-detail'); },
    pickPace: pickPace,
    toggleDietary: toggleDietary,
    toggleAccessNeed: toggleAccessNeed,
    onDietaryNotes: onDietaryNotes,
    onAccessNotes: onAccessNotes,
    continueFromDetail: continueFromDetail
  };
})();
