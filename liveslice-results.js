/* Romieaux — Live Slice results UI (P4).
 *
 * The render half of P4: the entry card, the staged progress copy, and the
 * results screen — day-by-day itinerary, IdentityFit badges, "estimate" on
 * every price, and a traceability tooltip on every intervention carrying its
 * formula and its named baseline.
 *
 * The pipeline itself is liveslice-scoring.js; this file does DOM only.
 *
 * NO DOLLAR FIGURE IS PRODUCED HERE (CLAUDE.md, ruling L).
 *   - Every attributed dollar — SAVES / AVOIDED / EARNS and the totals — is
 *     read off an engines.js ledger row. This file formats, it never computes:
 *     there is no arithmetic on money anywhere below, and no dollar literal.
 *   - Item prices are the model's own ESTIMATES, which work order §4 provides
 *     for as engine inputs and §6 requires be labelled "estimate". They are
 *     rendered through price(), which cannot emit an unlabelled figure.
 *
 * HOW THIS STAYS ADDITIVE (ruling J)
 *   - No canonical function body is edited. The canonical tooltip machinery
 *     (TTIP_DATA / showTtip / toggleTtip) is REUSED by registering Live Slice
 *     keys on it at render time, so the traceability tooltips look and behave
 *     exactly like the canonical ones without a line of canonical markup
 *     changing.
 *   - LiveSlice.continueFromDetail is wrapped, original-first, exactly as P2
 *     wrapped nav(): the error path still belongs to P2, and P4 only takes
 *     over once the Blueprint validates.
 *   - Nothing renders until the Live Slice is armed or #ls-start is opened.
 *     A visitor walking the canonical 7-trip demo sees a pixel-identical
 *     prototype.
 *
 * P6 ADDITIONS (the only changes this file has taken since P4):
 *
 *   RULING X, points 1 and 2. `bp.pace` comes OUT of blueprintFingerprint(),
 *     and the one string equality in wireIntake() becomes a which-fields-moved
 *     comparison. Pace is the one Blueprint field that feeds only local
 *     scoring — Engines.packDay()'s energy budget — and never the generation
 *     request, so a pace-only change re-runs Scoring.score() against the
 *     generation already in hand: free, instant, and it works with the network
 *     off. Before X it was a billed call, and offline it was impossible, on
 *     exactly the bad-wifi demo the Replay cache exists for.
 *   RULING Z-1, raised by P6 and ruled in the same session. `bp.hourly_rate`
 *     is the same failure mode in a second field and takes the same cure: it
 *     joins pace as local-only. Ruling V made the panel's rate slider
 *     display-only, but the intake mirrors the canonical `userHourlyRate` into
 *     the Blueprint, so dragging it and then walking back and forward spent a
 *     generation and failed outright offline. X and Z share one mechanism —
 *     LOCAL_ONLY_PARTS — so a third field would be a one-line ruling.
 *   Work order §6's footer line is printed VERBATIM as one line, rather than
 *     assembled from an eyebrow the replay path overwrites.
 *   Work order §2's offline fallback is surfaced on the entry card, rendered
 *     rather than static — whether Replay will work is state.
 */
var LiveSliceResults = (function (root) {
  'use strict';

  var Engines = root.Engines;
  var Blueprint = root.Blueprint;
  var Scoring = root.LiveSliceScoring;
  var API = root.LiveSliceAPI;

  if (!Engines || !Blueprint || !Scoring) {
    if (root.console && root.console.warn) {
      root.console.warn('Live Slice: engines.js, blueprint.js and liveslice-scoring.js must load before liveslice-results.js.');
    }
    return null;
  }

  var lastResult = null;
  var lastFingerprint = null;
  var lastParts = null;
  var lastPayload = null;
  var running = false;

  /* =====================================================================
   * DOM helpers
   * ================================================================== */

  function el(id) {
    try { return root.document ? root.document.getElementById(id) : null; }
    catch (e) { return null; }
  }

  function html(id, markup) {
    var node = el(id);
    if (node) node.innerHTML = markup;
    return node;
  }

  function show(id, display) {
    var node = el(id);
    if (node) node.style.display = display || 'block';
    return node;
  }

  function hide(id) {
    var node = el(id);
    if (node) node.style.display = 'none';
    return node;
  }

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* =====================================================================
   * §19 — SILENT SINKS (RULINGS §5a). The one place this file is allowed to
   * fail quietly is where a failure has a stated, checked consequence. These
   * two did not.
   *
   * sinkError() is the reporting half. It is deliberately console.ERROR, not
   * warn: warn is what this file uses for a degraded render that still put
   * something honest on screen, and none of the §19 sinks did that — each one
   * ends with the traveller looking at a page that did not do what they asked.
   *
   * The message keeps the build-side name (CLAUDE.md as scoped at AH, and §5f's
   * precedent): the console is a developer surface. The literals therefore sit
   * INSIDE the console call, which is also what keeps harness §20.2's lexer
   * able to tell them apart from rendered copy.
   * ================================================================== */

  function sinkError(what, error) {
    if (root.console && root.console.error) {
      root.console.error('Live Slice: ' + what, error || '');
    }
    return false;
  }

  /* navTo's boolean contract is UNCHANGED — true when the canonical nav() ran,
   * false otherwise. What is new is that a false now always carries a reason.
   *
   * Both of its failure modes were silent, and the second one is not the
   * interesting one. A THROWN nav() hit the empty catch. A MISSING nav() never
   * reached the catch at all: it fell straight out of the `if` and off the end
   * of the function. Missing is exactly the state ruling AG's outage left the
   * page in — a SyntaxError had discarded the canonical inline block, so nav()
   * did not exist — and it is the mode that returned false into callers that
   * were not reading it.
   *
   * The other three call sites (renderRun, rescore, wireIntake) still discard
   * this return. They are outside §5a's four, and they are no longer silent:
   * navTo speaks for itself now, wherever it is called from. */
  function navTo(id) {
    try {
      if (typeof root.nav === 'function') { root.nav(id); return true; }
      return sinkError('navTo("' + id + '") found no canonical nav() on this page, so the '
        + 'traveller did not move. On a page whose inline script died this is the '
        + 'symptom, not the cause — check that index.html still parses (harness §18).', null);
    } catch (e) {
      return sinkError('navTo("' + id + '") — the canonical nav() threw, so the traveller '
        + 'did not move.', e);
    }
  }

  /* =====================================================================
   * Formatting.
   *
   * money() takes a figure an engines.js function already produced and
   * formats it. It performs no arithmetic, so there is nothing here for a
   * dollar figure to originate from.
   * ================================================================== */

  function money(amount) {
    var n = Engines._num(amount, 0);
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  var ESTIMATE_LABEL = 'estimate';

  /* Work order §6: "Every price labeled estimate". The label is not optional
   * and not separable — a price cannot be rendered without it. */
  function price(amount) {
    return '<span style="white-space:nowrap;">' + money(amount) +
      ' <span style="font-family:var(--fm);font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--ts);">' +
      ESTIMATE_LABEL + '</span></span>';
  }

  function hoursLabel(hours) {
    var n = Engines._num(hours, 0);
    return (Math.round(n * 10) / 10) + ' h';
  }

  /* =====================================================================
   * IdentityFit badges — PDF bands, ruling H
   * ================================================================== */

  var BAND_BADGE = {
    recommend:   { cls: 'bok', label: 'Recommended' },
    alternative: { cls: 'bs',  label: 'Alternative' }
  };

  function fitBadge(fit, band) {
    var badge = BAND_BADGE[band] || BAND_BADGE.alternative;
    return '<span class="ib2 ' + badge.cls + '" title="IdentityFit ' + Math.round(fit) +
      ' — cosine similarity against your taste vector">' +
      badge.label + ' · fit ' + Math.round(fit) + '</span>';
  }

  var MODULE_LABEL = {
    stays: 'Stay', dining: 'Dining', activities: 'Activity', transportation: 'Transport'
  };

  /* =====================================================================
   * Traceability tooltips.
   *
   * Registered on the canonical TTIP_DATA for the hover path, and mirrored
   * into a hidden node for the canonical click path (toggleTtip reads the
   * element, showTtip reads the map — the canonical code uses both).
   * ================================================================== */

  var tooltipNodes = [];

  function resetTooltips() {
    tooltipNodes = [];
  }

  function registerTooltip(key, markup) {
    try {
      if (root.TTIP_DATA) root.TTIP_DATA[key] = markup;
    } catch (e) { /* canonical tooltip machinery absent — the title attr still carries the trace */ }
    tooltipNodes.push('<div id="' + key + '" style="display:none;">' + markup + '</div>');
    return key;
  }

  function tooltipTrigger(key) {
    return '<span class="ttip-trig" onmouseenter="showTtip(this,\'' + key + '\')" ' +
      'onmouseleave="hideTtip()" onclick="toggleTtip(this,\'' + key + '\',event)">i</span>';
  }

  /* Every intervention tooltip carries the formula and the named baseline —
   * that is the whole pitch (work order §6). Both strings come off the
   * engines.js row; none of it is composed here. */
  function interventionTooltip(row) {
    return '<div class="ttip-h">' + esc(row.kind) + ' · ' + esc(row.label) + '</div>' +
      '<div class="ttip-row"><span>Formula</span><strong>' + esc(row.formula) + '</strong></div>' +
      '<div class="ttip-row"><span>Baseline</span><strong>' + esc(row.baseline) + '</strong></div>' +
      '<div class="ttip-total"><span>Attributed</span><span>' + money(row.amount) + '</span></div>' +
      '<div class="ttip-note">Computed by a Romieaux engine against the baseline above. Never by the model.</div>';
  }

  function decisionsTooltip(decisions) {
    var rows = decisions.rows.map(function (r) {
      return '<div class="ttip-row"><span>' + esc(r.label) + '</span><strong>' + r.count + '</strong></div>';
    }).join('');
    return '<div class="ttip-h">Decisions Automated · Generated live</div>' + rows +
      '<div class="ttip-total"><span>Total</span><span>' + decisions.total + '</span></div>' +
      '<div class="ttip-note">One planning pass, scored locally. Every count is engine work that actually ran.</div>';
  }

  /* =====================================================================
   * Staged progress (work order §6)
   *
   * The middle stages are real local work, so the copy is honest: it is
   * written immediately before the step it names.
   * ================================================================== */

  function stage(title, detail) {
    html('ls-res-progress',
      '<div style="padding:34px 24px;text-align:center;">' +
      '<div style="font-family:var(--fd);font-size:42px;font-style:italic;color:var(--sd);opacity:.8;margin-bottom:16px;">R</div>' +
      '<div style="font-family:var(--fm);font-size:9px;letter-spacing:4px;color:var(--sd);text-transform:uppercase;margin-bottom:10px;">Generated live</div>' +
      '<div style="font-family:var(--fd);font-size:20px;font-weight:700;color:var(--ink);margin-bottom:6px;">' + esc(title) + '</div>' +
      '<div style="font-size:12px;color:var(--tm);line-height:1.6;">' + esc(detail || '') + '</div>' +
      '<div id="ls-res-liveness" style="font-size:11px;color:var(--tm);line-height:1.6;margin-top:12px;min-height:16px;"></div>' +
      '</div>');
    show('ls-res-progress');
    hide('ls-res-body');
  }

  /* =====================================================================
   * Liveness during the generation call (work order §6, P6)
   *
   * NOT a progress bar. The one thing genuinely happening during this wait is
   * that a request is outstanding, so that is all this claims: a pulsing dot,
   * a REAL elapsed count, and lines that are true for the whole wait. No
   * invented stages — decisions ruling 3's honesty applies to the wait as much
   * as to the ledger. The elapsed thresholds are wall-clock, not estimates of
   * progress, and the last one names Replay because at 25 seconds the useful
   * thing to tell someone is how to get out.
   * ================================================================== */

  var LIVENESS_LINES = [
    'Your Blueprint is with Claude.',
    'Nothing is priced yet — every dollar is computed here, after the reply.',
    'One request, not many. The scoring never leaves this browser.'
  ];
  var LIVENESS_ROTATE_MS = 4000;
  var LIVENESS_TICK_MS = 1000;
  var LIVENESS_SETTLED_S = 12;
  var LIVENESS_SLOW_S = 25;
  var livenessTimer = null;

  function livenessText(seconds) {
    if (seconds >= LIVENESS_SLOW_S) {
      return 'Taking longer than usual. Hotel wifi is usually the reason — ' +
        'Replay runs your last trip with no network at all.';
    }
    if (seconds >= LIVENESS_SETTLED_S) {
      return 'Still working — a full trip takes about 20 seconds.';
    }
    return LIVENESS_LINES[Math.floor(seconds / (LIVENESS_ROTATE_MS / 1000)) % LIVENESS_LINES.length];
  }

  function stopLiveness() {
    if (livenessTimer !== null) {
      try { root.clearInterval(livenessTimer); } catch (e) { /* no timer host */ }
      livenessTimer = null;
    }
  }

  function startLiveness() {
    stopLiveness();
    if (typeof root.setInterval !== 'function') return false;   // node, or no timers

    var started = 0;
    livenessTimer = root.setInterval(function () {
      started += LIVENESS_TICK_MS / 1000;
      var node = el('ls-res-liveness');
      if (!node) { stopLiveness(); return; }
      node.innerHTML =
        '<span class="ls-pulse" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--sd);margin-right:7px;vertical-align:middle;"></span>' +
        esc(livenessText(started)) +
        '<span style="color:var(--ts);"> · ' + Math.round(started) + 's</span>';
    }, LIVENESS_TICK_MS);
    return true;
  }

  function stageError(error) {
    var message = (error && error.message) ? error.message : 'Something went wrong before the itinerary could be scored.';
    var detail = (error && error.detail) ? error.detail : '';
    html('ls-res-progress',
      '<div style="margin:24px 20px;background:rgba(196,85,63,.06);border:1px solid rgba(196,85,63,.3);border-radius:12px;padding:16px 18px;">' +
      '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rd);text-transform:uppercase;margin-bottom:6px;">Generated live — could not run</div>' +
      '<div style="font-size:13px;color:var(--tx);line-height:1.6;">' + esc(message) + '</div>' +
      (detail ? '<div style="font-size:11px;color:var(--ts);line-height:1.6;margin-top:8px;">' + esc(detail) + '</div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:14px;">' +
      '<button class="btn bsd" style="flex:1;" onclick="LiveSliceResults.run(\'generate\')">Try again</button>' +
      '<button class="btn" style="flex:1;background:transparent;border:1px solid var(--bd);color:var(--tm);" onclick="LiveSliceResults.run(\'replay\')">Replay last trip</button>' +
      '</div></div>');
    show('ls-res-progress');
    hide('ls-res-body');
    if (root.console && root.console.warn) root.console.warn('Live Slice: ' + message, error || '');
  }

  /* =====================================================================
   * Render
   * ================================================================== */

  function renderHeader(result) {
    var trip = result.trip.trip;
    var dates = (trip.start && trip.end) ? trip.start + ' → ' + trip.end : '';
    var nights = result.blueprint && result.blueprint.nights ? result.blueprint.nights + ' nights' : '';
    var replayed = result.source === 'replay';

    html('ls-res-eye', 'Generated live' + (replayed ? ' · replayed offline' : ''));
    html('ls-res-title', esc(trip.destination || (result.blueprint && result.blueprint.destination_name) || 'Your trip'));
    html('ls-res-sub', esc([dates, nights, result.blueprint && result.blueprint.pace ? result.blueprint.pace + ' pace' : '']
      .filter(Boolean).join(' · ')));
  }

  function renderSummary(result) {
    var ledger = result.ledger;
    var decisions = result.decisions;
    var scheduled = result.days.reduce(function (n, d) { return n + d.scheduled.length; }, 0);

    var decisionsKey = null;
    if (decisions.rows.length) {
      decisionsKey = registerTooltip('ls-da', decisionsTooltip(decisions));
    }

    var cells = [
      { label: 'Items scheduled', value: scheduled },
      { label: 'Interventions', value: ledger.interventionCount },
      {
        label: 'Decisions automated',
        value: decisions.total + (decisionsKey ? ' ' + tooltipTrigger(decisionsKey) : '')
      },
      { label: 'Hours saved', value: ledger.hoursSaved + ' h' }
    ];

    html('ls-res-summary',
      '<div style="margin:0 20px 12px;background:var(--pn);border:1px solid var(--bd);border-radius:12px;padding:14px 16px;">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;">' +
      cells.map(function (c) {
        return '<div><div style="font-family:var(--fm);font-size:8px;letter-spacing:1.5px;color:var(--ts);text-transform:uppercase;margin-bottom:2px;">' +
          esc(c.label) + '</div><div style="font-family:var(--fd);font-size:17px;font-weight:600;color:var(--ink);">' +
          c.value + '</div></div>';
      }).join('') +
      '</div>' +
      '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd);font-size:11px;color:var(--ts);line-height:1.6;">' +
      'Cash Savings, Time Value and Total Romieaux Value are in the ledger panel below, reconciled against these rows.' +
      '</div></div>');
  }

  function renderItem(entry, extra) {
    var item = entry.item;
    var rows = entry.rows || [];
    var flags = rows.map(function (row) {
      var key = registerTooltip('ls-int-' + tooltipNodes.length, interventionTooltip(row));
      return '<div class="af bs">' + esc(row.kind) + ' ' + money(row.amount) + ' ' + tooltipTrigger(key) + '</div>';
    }).join(' ');

    var time = item.duration_hours ? hoursLabel(item.duration_hours) : '·';
    var meta = [MODULE_LABEL[item.module] || item.module];
    if (item.transit_min_from_prev) meta.push(Math.round(item.transit_min_from_prev) + ' min transit');
    if (item.crowd_shift && item.crowd_shift.suggested_start) meta.push('start ' + item.crowd_shift.suggested_start);

    return '<div class="ar"' + (extra || '') + '>' +
      '<div class="at">' + esc(time) + '</div><div class="adot"></div>' +
      '<div class="ab2">' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">' +
      '<div class="an" style="min-width:0;overflow-wrap:anywhere;">' + esc(item.name || item.id) + '</div>' +
      '<div style="font-family:var(--fd);font-size:13px;color:var(--tx);flex-shrink:0;">' + price(item.est_price_usd) + '</div>' +
      '</div>' +
      '<div class="as2">' + esc(meta.join(' · ')) + (item.notes ? ' — ' + esc(item.notes) : '') + '</div>' +
      '<div style="margin-top:5px;">' + fitBadge(entry.fit, entry.band) + '</div>' +
      (flags ? '<div style="margin-top:4px;">' + flags + '</div>' : '') +
      '</div></div>';
  }

  /* The internal reason token, mapped for display. `entry.reason` stays what it
   * has always been — a branch key and the QA vocabulary `logResult()` prints —
   * and this is the only place it becomes something a traveller reads. Since
   * amendment AA the intake says "dietary restrictions", so this does too. */
  var REMOVAL_LABEL = {
    'dietary hard line': 'dietary restriction',
    'accessibility predicate': 'accessibility need',
    'kids age gate': 'age restriction',
    'pet constraint': 'pet requirement'
  };

  function removalLabel(reason) {
    return REMOVAL_LABEL[reason] || 'requirement you set';
  }

  /* A DAY THAT LOST OPTIONS SAYS SO, WHERE THE GAP IS.
   *
   * The trip-level list in renderNotes() is the audit trail and stays exactly
   * as it is. This is the other half: a note inside the day card, so a gap is
   * explained in place rather than several screens below it. The traveller
   * most likely to hit this is the one with an allergy, and they were the one
   * being asked to correlate a list at the bottom with a hole in the middle.
   *
   * It states WHY the slot is empty and never fills it — no best-match
   * substitution, no padding. Same principle as work order §7's "never pad",
   * carried from the ledger to the itinerary. It ends by pointing at the thing
   * the traveller can actually change.
   *
   * `result.removals` is trip-level but each entry carries the day index the
   * pipeline stamped on it, so this needs nothing new from the pipeline. */
  function dayRemovalNote(result, day) {
    var mine = (result.removals || []).filter(function (entry) { return entry.day === day.index; });
    if (!mine.length) return '';

    var dietary = mine.filter(function (e) { return e.reason === 'dietary hard line'; });
    var everythingWent = !day.scheduled.length && !day.skipped.length && !day.stays.length;

    var lead;
    if (dietary.length === mine.length && everythingWent) {
      lead = 'No venue on this day met your stated dietary requirements, so nothing is scheduled for it.';
    } else if (dietary.length === mine.length) {
      lead = 'No restaurant on this day met your stated dietary requirements. What remains is scheduled as normal.';
    } else if (everythingWent) {
      lead = 'Nothing on this day met the requirements you set, so nothing is scheduled for it.';
    } else {
      lead = mine.length + ' option' + (mine.length === 1 ? ' was' : 's were') +
        ' removed by a requirement you set. What remains is scheduled as normal.';
    }

    return '<div style="padding:11px 16px;background:rgba(196,85,63,.05);border-bottom:1px solid var(--bd);">' +
      '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rd);text-transform:uppercase;margin-bottom:5px;">' +
      'Removed from this day — ' + mine.length + ' option' + (mine.length === 1 ? '' : 's') + '</div>' +
      '<div style="font-size:12.5px;color:var(--tx);line-height:1.55;margin-bottom:6px;">' + esc(lead) + '</div>' +
      mine.map(function (entry) {
        return '<div style="font-size:11.5px;color:var(--tm);line-height:1.6;">· ' +
          esc(entry.item.name || entry.item.id) + ' — ' + esc(entry.detail) + '</div>';
      }).join('') +
      '<div style="font-size:11px;color:var(--ts);line-height:1.6;margin-top:7px;">' +
      'Romieaux does not substitute a best match or pad the day to fill it. If this is more ' +
      'restrictive than you intended, your dietary and access needs are on the previous screen ' +
      'and can be loosened.</div></div>';
  }

  function renderDays(result) {
    if (!result.days.length) {
      html('ls-res-days', '<div style="padding:18px 20px;font-size:13px;color:var(--tm);">The generation returned no days.</div>');
      return;
    }

    html('ls-res-days', result.days.map(function (day, i) {
      var label = day.date || ('Day ' + (i + 1));

      /* THE BADGE MUST NOT READ SUCCESS-GREEN ON AN EMPTY DAY.
       * `withinBudget` was `hoursUsed <= energyBudget`, which is true at zero —
       * so a day the hard filters had emptied rendered "0 h of 7 h scheduled"
       * in the same green as a well-packed one, and read as a light day rather
       * than a day nothing survived. Nothing scheduled is not within budget;
       * it is nothing. */
      var nothingScheduled = !day.scheduled.length;
      var pacing = nothingScheduled
        ? 'nothing scheduled'
        : hoursLabel(day.hoursUsed) + ' of ' + day.energyBudget + ' h scheduled';
      var withinBudget = !nothingScheduled && day.hoursUsed <= day.energyBudget;

      var stays = day.stays.length
        ? '<div style="padding:10px 16px;border-bottom:1px solid var(--bd);">' +
          '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rg);text-transform:uppercase;margin-bottom:6px;">' +
          'Stay options compared</div>' +
          day.stays.map(function (entry) {
            return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--tm);padding:3px 0;flex-wrap:wrap;">' +
              '<span style="min-width:0;overflow-wrap:anywhere;">' + esc(entry.item.name || entry.item.id) + '</span>' +
              '<span style="color:var(--ink);">score ' + Math.round(entry.stayScore.score) + ' · ' + price(entry.item.est_price_usd) + '</span></div>';
          }).join('') + '</div>'
        : '';

      var skipped = day.skipped.length
        ? '<div style="padding:10px 16px;background:rgba(0,0,0,.015);">' +
          '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rg);text-transform:uppercase;margin-bottom:4px;">' +
          'Held back by your pace budget</div>' +
          day.skipped.map(function (entry) {
            return '<div style="font-size:12px;color:var(--ts);line-height:1.6;">· ' + esc(entry.item.name || entry.item.id) +
              ' — ' + hoursLabel(entry.item.duration_hours) + ', fit ' + Math.round(entry.fit) + '</div>';
          }).join('') + '</div>'
        : '';

      return '<div class="dc">' +
        '<div class="dch"><div><div class="dcn">Day ' + (i + 1) + '</div>' +
        '<div class="dcl">' + esc(label) + '</div></div>' +
        '<div class="dcb ' + (withinBudget ? 'bok' : 'bwn') + '">' + esc(pacing) + '</div></div>' +
        stays +
        dayRemovalNote(result, day) +
        day.scheduled.map(function (entry) { return renderItem(entry); }).join('') +
        skipped +
        '</div>';
    }).join(''));
  }

  function renderInterventions(result) {
    var ledger = result.ledger;

    if (ledger.isEmpty) {
      // Work order §7: never pad.
      html('ls-res-interventions',
        '<div class="sh"><div class="shl">Value Attribution</div><div class="sht">No savings opportunities detected in this itinerary</div></div>' +
        '<div style="padding:0 20px 8px;font-size:12px;color:var(--tm);line-height:1.6;">' +
        'Nothing in this generation cleared a Ledger Law gate. A figure appears only when an engine can name the baseline it was measured against.</div>');
      return;
    }

    var rendered = { headline: 0, count: 0 };
    var rows = ledger.rows.map(function (row) {
      var key = registerTooltip('ls-int-' + tooltipNodes.length, interventionTooltip(row));
      rendered.headline += row.amount;      // summing rows the engine produced, to check them
      rendered.count++;
      return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px 20px;border-bottom:1px solid var(--bd);">' +
        // P6 mobile pass: a flex child defaults to min-width:auto, so a long
        // baseline string would push the row past the viewport. See the note
        // above SHRINKABLE in liveslice-ledger.js.
        '<div style="flex:1;min-width:0;overflow-wrap:anywhere;">' +
        '<div style="font-size:13px;color:var(--tx);line-height:1.4;">' + esc(row.label) + '</div>' +
        '<div style="font-family:var(--fm);font-size:8px;letter-spacing:1.5px;color:var(--rg);text-transform:uppercase;margin-top:3px;">' +
        esc(row.kind) + ' · baseline: ' + esc(row.baseline) + '</div>' +
        '</div>' +
        '<div style="font-family:var(--fd);font-size:15px;font-weight:600;color:var(--gn);flex-shrink:0;white-space:nowrap;">' +
        money(row.amount) + ' ' + tooltipTrigger(key) + '</div>' +
        '</div>';
    }).join('');

    /* Ruling E, at render time and against what is ABOUT to be displayed —
     * both axes, dollars and count. P5 owns the ledger panel; this is the
     * same assertion guarding the P4 surface that already shows figures. */
    var check = Engines.reconcile(ledger, rendered);
    if (!check.ok && root.console && root.console.error) root.console.error(check.message);
    else if (root.console && root.console.info) root.console.info(check.message);

    html('ls-res-interventions',
      '<div class="sh"><div class="shl">Value Attribution · Generated live</div>' +
      '<div class="sht">' + ledger.interventionCount + ' interventions detected</div></div>' + rows);
  }

  /* Ruling 1 for decisions: the stated count must equal the sum of its
   * tooltip rows, asserted at render time alongside the dollar one. */
  function reconcileDecisions(decisions) {
    if (!decisions.rows.length) return true;
    var sum = decisions.rows.reduce(function (n, r) { return n + r.count; }, 0);
    var ok = sum === decisions.total;
    if (!ok && root.console && root.console.error) {
      root.console.error('Live Slice decisions FAILED reconciliation — stated ' + decisions.total +
        ' vs ' + sum + ' across ' + decisions.rows.length + ' tooltip rows.');
    }
    return ok;
  }

  function renderNotes(result) {
    var parts = [];

    /* Ruling S: a refused stay is the loudest thing on this screen. It is
     * neither silently kept nor silently deleted — the traveller is told
     * which predicate failed and that nothing was attributed to it. */
    if (result.stayRefusal) {
      parts.push(
        '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rd);text-transform:uppercase;margin-bottom:6px;">' +
        // Display vocabulary, not the internal token (which stays in console).
        'Stay refused — ' + esc(removalLabel(result.stayRefusal.reason)) + '</div>' +
        '<div style="font-size:13px;color:var(--tx);line-height:1.55;">' +
        esc(result.stayRefusal.stay.name || 'The generated stay') + ' — ' +
        esc(result.stayRefusal.detail) + '.</div>' +
        '<div style="font-size:12px;color:var(--tm);line-height:1.6;margin-top:6px;">' +
        'It is not booked and nothing is attributed to it, so no stay savings appear in the ledger below. ' +
        'Everything else on this trip still stands.</div>');
    }

    if (result.removals.length) {
      parts.push(
        '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rd);text-transform:uppercase;margin-bottom:6px;">' +
        result.removals.length + ' options removed by a requirement you set</div>' +
        result.removals.map(function (entry) {
          return '<div style="font-size:12px;color:var(--tm);line-height:1.6;">· ' +
            esc(entry.item.name || entry.item.id) + ' — ' + esc(entry.detail) + '</div>';
        }).join('') +
        '<div style="font-size:11px;color:var(--ts);line-height:1.6;margin-top:6px;">' +
        'Removed, not crossed out. Each one is in the console for QA.</div>');
    }

    if (result.suppressed.length) {
      parts.push('<div style="font-size:12px;color:var(--tm);line-height:1.6;margin-top:10px;">' +
        result.suppressed.length + ' candidate' + (result.suppressed.length === 1 ? '' : 's') +
        ' scored below the IdentityFit floor of ' + Engines.FIT_SUPPRESS + ' and are not shown.</div>');
    }

    if (result.decisions.floorApplied) {
      parts.push('<div style="font-size:12px;color:var(--tm);line-height:1.6;margin-top:10px;">' +
        'The decisions breakdown is withheld for this run: the categories that could be derived summed below the intervention count, ' +
        'and a breakdown that does not sum to its own total would not be honest.</div>');
    }

    var validation = result.validation || {};
    var noisy = (validation.dropped || []).length + (validation.clamped || []).length;
    if (noisy) {
      parts.push('<div style="font-size:12px;color:var(--tm);line-height:1.6;margin-top:10px;">' +
        noisy + ' field' + (noisy === 1 ? '' : 's') +
        ' in the generated JSON were dropped or clamped by the schema validator. The full list is in the console.</div>');
    }

    if (!parts.length) {
      html('ls-res-notes', '');
      return;
    }

    html('ls-res-notes',
      '<div style="margin:14px 20px 0;background:var(--cr2);border:1px solid var(--bd);border-radius:12px;padding:13px 15px;">' +
      parts.join('') + '</div>');
  }

  /* Work order §6's footer line, VERBATIM and as one line. P4 assembled it out
   * of an eyebrow plus a sentence, which meant the replay path — where the
   * eyebrow becomes "Replayed" — printed the claim without the words that
   * frame it. It is the sentence the whole architecture is defending, so it is
   * printed whole and the replay badge sits above it instead. */
  var FOOTER_LINE = 'Live demo — candidates generated by AI, every dollar computed by ' +
    'Romieaux engines against a named baseline.';

  function renderFooter(result) {
    var replayed = result.source === 'replay';
    html('ls-res-footer',
      '<div style="padding:14px 20px 28px;">' +
      '<div style="background:var(--sdl);border:1px solid rgba(176,138,80,.25);border-radius:12px;padding:13px 15px;">' +
      '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--sd);text-transform:uppercase;margin-bottom:4px;">' +
      (replayed ? 'Replayed — no network call' : 'Generated live') + '</div>' +
      '<div style="font-size:12px;color:var(--tm);line-height:1.6;">' + FOOTER_LINE + '</div></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn" style="flex:1;background:transparent;border:1px solid var(--bd);color:var(--tm);" onclick="LiveSliceAPI.openSettings()">Generated live settings</button>' +
      '<button class="btn bsd" style="flex:1;" onclick="LiveSliceResults.run(\'replay\')">Replay this trip</button>' +
      '</div></div>');
  }

  /* A rendered Live Slice belongs to the Blueprint that produced it — the
   * same principle §5b applies to the Replay cache. These parts are what let
   * the traveller walk BACK to the ruling-G screen and forward again without
   * burning a second API call, while still regenerating the moment an answer
   * actually changes. Together they cover everything the pipeline reads: the
   * whole engine contract, plus the fields that shape the request itself.
   *
   * Each part is NAMED rather than folded into one anonymous string, because
   * ruling X turns on WHICH answer moved and not merely on whether one did.
   *
   * `hourly_rate` is lifted out of the engine blob and named on its own. It
   * stays inside the generation fingerprint below, so today's behaviour is
   * unchanged — it is named because it is the field the P6 conflict report
   * raises as Z, and a ruling either way is then one line here. */
  function blueprintParts(bp) {
    if (!bp) return null;
    try {
      var engine = Blueprint.toEngineInput(bp);
      var rate = engine.hourly_rate;
      delete engine.hourly_rate;
      return {
        engine: JSON.stringify(engine),
        hourly_rate: rate,
        pace: bp.pace,
        destination_name: bp.destination_name,
        start_date: bp.start_date,
        end_date: bp.end_date,
        nights: bp.nights,
        budget_mode: bp.budget_mode,
        budget_total_usd: bp.budget_total_usd,
        engagement_mode: bp.engagement_mode
      };
    } catch (e) {
      return null;
    }
  }

  /* RULING X, point 1, and RULING Z-1. The LOCAL-ONLY fields — out of the
   * fingerprint, because they feed local scoring and never the request.
   *
   * PACE (ruling X) feeds Engines.packDay()'s energy budget alone. The
   * candidates the model returned are equally valid at any pace, so a pace
   * change is not a new generation. Leaving it in the fingerprint cost a
   * billed call for a field the request never carried, and made a pace change
   * IMPOSSIBLE offline: §5b forbids scoring a cached trip against the live
   * Blueprint, and there was no other legal route from "cached trip + new
   * pace" to a rendered ledger.
   *
   * HOURLY_RATE (ruling Z) is the same failure mode in a second field and
   * takes the same cure. It is a real planning input — it sits in
   * experienceROI()'s denominator — but it is also the number ruling V made
   * display-only in the panel, and the intake mirrors the canonical
   * `userHourlyRate` into the Blueprint on every sync. So dragging the slider
   * the panel says is display-only, then walking back and forward, spent a
   * generation and failed outright offline. Ruled Z-1: it re-scores against
   * the generation in hand at the current rate — free, instant, offline.
   *
   * Ruling V(b) keeps working either way: a trip planned at one rate and
   * priced at another still says so, and after a forward re-score the planned
   * rate IS the re-score rate, so the note correctly falls silent.
   *
   * Everything else in blueprintParts() shapes the request or the engine
   * contract, so a move in any of it does invalidate the generation. */
  var LOCAL_ONLY_PARTS = { pace: true, hourly_rate: true };

  function blueprintFingerprint(bp) {
    var parts = blueprintParts(bp);
    if (!parts) return null;
    var generation = {};
    Object.keys(parts).forEach(function (key) {
      if (!LOCAL_ONLY_PARTS[key]) generation[key] = parts[key];
    });
    try { return JSON.stringify(generation); } catch (e) { return null; }
  }

  /* RULING X, point 2. The which-fields-moved comparison, in place of one
   * string equality. Takes two SNAPSHOTS — never two live Blueprints, since
   * the intake hands out its own state object by reference and a snapshot
   * taken at render time is the only thing a later edit cannot rewrite.
   * Returns the names that differ; a null on either side means "cannot tell",
   * which the caller treats as "everything moved" rather than "nothing did". */
  function movedParts(previous, current) {
    if (!previous || !current) return null;
    return Object.keys(current).filter(function (key) {
      return previous[key] !== current[key];
    });
  }

  /* The Blueprint a re-score runs against is a COPY, so nothing the traveller
   * does afterwards can rewrite the answers a rendered ledger was built from. */
  function cloneBlueprint(bp) {
    try { return JSON.parse(JSON.stringify(bp)); } catch (e) { return null; }
  }

  /* RULING X + RULING Z-1. The local-only fields are carried from the LIVE
   * Blueprint onto a COPY of the Blueprint the generation was scored against.
   * Every other answer stays the one the generation belongs to, which is what
   * §5b requires; the fields that move are exactly the ones that feed no part
   * of the request.
   *
   * Each is applied through the Blueprint's own setter, so the copy is clamped
   * and re-derived exactly as the live one was — a rate outside the canonical
   * slider bounds cannot enter through this door. */
  var LOCAL_ONLY_APPLY = {
    pace: function (bp, live) { Blueprint.setPace(bp, live.pace); },
    hourly_rate: function (bp, live) { Blueprint.setHourlyRate(bp, live.hourly_rate); }
  };

  function withLocalOnly(blueprint, live) {
    var copy = cloneBlueprint(blueprint);
    if (!copy || !live) return null;

    var keys = Object.keys(LOCAL_ONLY_PARTS);
    for (var i = 0; i < keys.length; i++) {
      var apply = LOCAL_ONLY_APPLY[keys[i]];
      /* A field ruled local-only with no way to carry it would silently
       * re-score at the OLD value — the quiet version of exactly the bug
       * rulings X and Z were raised about. Refuse instead: the caller falls
       * back to regenerating, which is always safe, and the console says so. */
      if (!apply) {
        if (root.console && root.console.warn) {
          root.console.warn('Live Slice: "' + keys[i] +
            '" is ruled local-only but has no carry rule — regenerating rather than re-scoring stale.');
        }
        return null;
      }
      apply(copy, live);
    }
    return copy;
  }

  /* P5 owns the ledger panel and lives in its own file. It is called from
   * here rather than wrapping LiveSliceResults.render, because run() calls the
   * internal render() directly — a wrapper on the exported property would
   * never fire on the one path that matters. With liveslice-ledger.js absent
   * the screen is exactly what P4 shipped, and a throw inside the panel can
   * never take the itinerary down with it. */
  function renderLedgerPanel(result) {
    try {
      if (root.LiveSliceLedger && typeof root.LiveSliceLedger.render === 'function') {
        return root.LiveSliceLedger.render(result);
      }
    } catch (e) {
      if (root.console && root.console.error) {
        root.console.error('Live Slice: the ledger panel failed to render.', e);
      }
    }
    return false;
  }

  function render(result) {
    lastResult = result;
    lastFingerprint = blueprintFingerprint(result.blueprint);
    lastParts = blueprintParts(result.blueprint);
    resetTooltips();

    renderHeader(result);
    renderSummary(result);
    renderDays(result);
    renderInterventions(result);
    renderLedgerPanel(result);
    renderNotes(result);
    renderFooter(result);
    reconcileDecisions(result.decisions);

    // The click path of the canonical tooltip reads an element, not the map,
    // so the same markup is mirrored into hidden nodes.
    html('ls-res-tooltips', tooltipNodes.join(''));

    hide('ls-res-progress');
    show('ls-res-body');
    return result;
  }

  /* =====================================================================
   * The run — generate or replay, then score, then render.
   * ================================================================== */

  function currentBlueprint() {
    try {
      if (root.LiveSlice && typeof root.LiveSlice.blueprint === 'function') {
        if (typeof root.LiveSlice.sync === 'function') root.LiveSlice.sync();
        return root.LiveSlice.blueprint();
      }
    } catch (e) { /* fall through */ }
    return Blueprint.create();
  }

  /* §5b: a replayed trip is scored against the Blueprint that produced it —
   * cachedGeneration().blueprint — never the live one. Replaying last night's
   * trip against this morning's edited Blueprint would produce a ledger that
   * never existed, so a cache with no Blueprint is refused rather than
   * silently scored against the wrong one. */
  function loadTrip(source) {
    if (!API) {
      return Promise.reject(new Error('The generation layer is not loaded.'));
    }
    if (source === 'replay') {
      return API.replay().then(function (cached) {
        if (!cached.blueprint) {
          var err = new Error('That cached trip was stored without the Blueprint it was generated from, so it cannot be scored honestly. Generate a new one.');
          err.code = 'no_cached_blueprint';
          throw err;
        }
        return { trip: cached.trip, blueprint: cached.blueprint, source: 'replay' };
      });
    }
    var bp = currentBlueprint();
    return API.generate(bp).then(function (trip) {
      return { trip: trip, blueprint: bp, source: 'generate' };
    });
  }

  function countCandidates(payload) {
    var days = (payload.trip && payload.trip.days) || [];
    var n = 0;
    for (var i = 0; i < days.length; i++) {
      n += (days[i] && days[i].items && days[i].items.length) || 0;
    }
    return n;
  }

  function run(source) {
    if (running) return Promise.resolve(null);
    running = true;

    navTo('s-ls-results');
    stage(source === 'replay'
        ? 'Replaying your last trip…'
        : 'Asking Claude for trip ideas — venues, activities, stays…',
      source === 'replay'
        ? 'No network call — scoring the cached trip against the Blueprint it was generated from.'
        : 'Every dollar is computed here, afterwards.');

    // Only the generate path waits on a network call, so only it needs liveness.
    if (source !== 'replay') startLiveness();

    return loadTrip(source).then(function (payload) {
      stopLiveness();
      /* RULING X. The generation IN HAND, kept so a pace-only change can be
       * re-scored against it without a second call. The Blueprint is copied,
       * not referenced: on the generate path payload.blueprint is the intake's
       * own live object, and a later edit to it must not rewrite what this
       * generation was scored against. */
      lastPayload = {
        trip: payload.trip,
        blueprint: cloneBlueprint(payload.blueprint) || payload.blueprint,
        source: payload.source
      };

      stage('Scoring ' + countCandidates(payload) + ' candidates…',
        'Validating the schema, applying your hard constraints, then IdentityFit and ExperienceROI — all locally.');

      var result = Scoring.score(payload.trip, payload.blueprint, { source: payload.source });
      Scoring.logResult(result, root.console);

      if (!result.ok) {
        var first = (result.validation.errors || [])[0];
        var err = new Error('The generated itinerary did not survive validation' +
          (first ? ': ' + first.detail : '.'));
        err.code = 'invalid_generation';
        throw err;
      }

      stage('Running the ledger…', 'Every Ledger Law formula, against a named baseline.');
      return render(result);
    }).then(function (result) {
      stopLiveness();
      running = false;
      return result;
    }, function (error) {
      stopLiveness();
      running = false;
      stageError(error);
      return null;
    });
  }

  function rescoreTitle(moved, blueprint) {
    return moved.indexOf('pace') !== -1
      ? 'Re-scoring at ' + (blueprint.pace || 'a new') + ' pace…'
      : 'Re-scoring at your new hourly rate…';
  }

  /* RULINGS X and Z-1. A change confined to the local-only fields re-runs the
   * pipeline against the generation already in hand. No network call, no key
   * and no consent — nothing leaves the browser, so there is nothing to
   * consent to, exactly as Replay works.
   *
   * The Blueprint it scores against is the one the generation was scored
   * against, with the local-only fields written onto a copy of it. On the
   * generate path that is the live Blueprint field for field, because the
   * caller only routes here when nothing outside those fields has moved. On a
   * REPLAYED trip it is the cached Blueprint — which is what §5b requires —
   * plus the fields that feed no part of the request. That is the case these
   * rulings exist for: bad wifi, a cached trip, and "show me a slower pace".
   *
   * `moved` is the which-fields-moved list, carried in so the console can name
   * the answer that changed rather than reporting that something did. */
  function rescore(moved, live) {
    if (running) return Promise.resolve(null);
    if (!lastPayload) return run('generate');

    var blueprint = withLocalOnly(lastPayload.blueprint, live || currentBlueprint());
    if (!blueprint) return run('generate');

    running = true;
    navTo('s-ls-results');
    stage(rescoreTitle(moved, blueprint),
      'No network call. The candidates already generated are equally valid at any pace or rate — only ' +
      'what the engines weigh them against moved, so the whole pipeline re-runs here, locally.');

    if (root.console && root.console.info) {
      root.console.info('Live Slice: ' + moved.join(', ') +
        ' changed — re-scoring the generation in hand locally. No generation call (ruling X).');
    }

    return Promise.resolve().then(function () {
      var result = Scoring.score(lastPayload.trip, blueprint, { source: lastPayload.source });
      Scoring.logResult(result, root.console);

      if (!result.ok) {
        var first = (result.validation.errors || [])[0];
        var err = new Error('The generated itinerary did not survive re-scoring at the new pace' +
          (first ? ': ' + first.detail : '.'));
        err.code = 'invalid_generation';
        throw err;
      }

      lastPayload = { trip: lastPayload.trip, blueprint: blueprint, source: lastPayload.source };
      return render(result);
    }).then(function (result) {
      running = false;
      return result;
    }, function (error) {
      running = false;
      stageError(error);
      return null;
    });
  }

  /* =====================================================================
   * Entry point (work order §6)
   *
   * Ruling J is additive only, so nothing is inserted into a canonical
   * screen. The entry card is a fixed-position Live Slice element, hidden
   * until the Live Slice is armed or the page is opened at #ls-start.
   * ================================================================== */

  /* Work order §2's offline fallback, surfaced where the demo starts (§6, P6).
   *
   * It is RENDERED rather than written into the markup because whether Replay
   * will work is state: with nothing cached it can only produce an error, and
   * a button that can only fail is worse than no button. With a trip cached it
   * names the trip and the day it was generated, so the investor can see the
   * demo will survive the room's wifi before trusting it to.
   *
   * No dollar figure is produced here — it prints a destination and a date. */
  function renderEntryReplay() {
    var node = el('ls-entry-replay');
    if (!node) return false;

    var cached = null;
    try { cached = (API && typeof API.cachedGeneration === 'function') ? API.cachedGeneration() : null; }
    catch (e) { cached = null; }

    if (!cached) {
      node.innerHTML = '<div style="font-size:10.5px;color:var(--ts);line-height:1.55;margin-top:9px;">' +
        'Replay needs one generated trip in this browser first. After that it runs with the network off.</div>';
      return false;
    }

    var where = cached.destination || 'your last trip';
    var when = String(cached.generated_at || '').slice(0, 10);

    node.innerHTML =
      '<button class="btn" style="width:100%;margin-top:9px;padding:10px;font-size:12px;background:transparent;' +
      'border:1px solid var(--sd);border-radius:40px;color:var(--sd);" ' +
      'onclick="LiveSliceResults.run(\'replay\')">Replay last trip — offline</button>' +
      '<div style="font-size:10.5px;color:var(--ts);line-height:1.55;margin-top:6px;text-align:center;">' +
      esc(where) + (when ? ' · cached ' + esc(when) : '') + '. No network call.</div>';
    return true;
  }

  function showEntry() {
    var card = el('ls-entry');
    renderEntryReplay();
    if (card) card.style.display = 'block';
    return !!card;
  }

  function hideEntry() {
    var card = el('ls-entry');
    if (card) card.style.display = 'none';
    return !!card;
  }

  /* §19, the traveller's half. A start that cannot navigate leaves the
   * traveller exactly where they tapped, with the entry card hidden one line
   * earlier by start() itself — a tap, and then nothing. That is the AG shape
   * precisely, and for the length of that outage this path had no way to say
   * so. Put the card back, and say it on the card.
   *
   * The message takes ls-entry-replay, the card's one script-owned slot.
   * Giving that slot up costs nothing at this moment: run('replay') reaches
   * the results screen through the same navTo that just failed, so on a page
   * where navigation is dead the Replay affordance is dead with it, and
   * offering it would be the second false promise in a row. The next
   * showEntry() renders the affordance back over this.
   *
   * Traveller vocabulary, CLAUDE.md as scoped at AH: the eyebrow takes the
   * approved eyebrow form — the same one stageError() already uses for the
   * refusal panel — and the sentence carries no form of the name at all,
   * which the scoping provides for rather than inventing a fourth. */
  function failedToStart() {
    showEntry();
    html('ls-entry-replay',
      '<div style="margin-top:9px;background:rgba(196,85,63,.06);border:1px solid rgba(196,85,63,.3);' +
      'border-radius:10px;padding:10px 12px;">' +
      '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rd);' +
      'text-transform:uppercase;margin-bottom:5px;">Generated live — could not start</div>' +
      '<div style="font-size:11px;color:var(--tx);line-height:1.55;">This page did not finish ' +
      'loading, so nothing happened when you tapped. Reload the page and try again.</div></div>');
    return false;
  }

  /* §19 (RULINGS §5a). Three of the four recorded sinks were in these nine
   * lines: an empty catch that dropped whatever begin() or showLauncher()
   * threw, a discarded navTo() return, and `return true` regardless of either.
   * The fourth was navTo's own, above.
   *
   * Three things change and nothing else does. The catch reports instead of
   * absorbing; the navigation's answer is read and acted on; and the returned
   * value is the truth about both, so a caller — and the harness — can tell a
   * start that worked from one that did not.
   *
   * ARMING AND NAVIGATING FAIL SEPARATELY, and are kept separate. An unarmed
   * intake that still navigates leaves the traveller on a real screen, so the
   * card must NOT come back over it; a failed navigation leaves them nowhere,
   * and it must. Only the second has a traveller-visible half. */
  function start() {
    hideEntry();

    var armed = true;
    try {
      if (root.LiveSlice && typeof root.LiveSlice.begin === 'function') root.LiveSlice.begin();
      if (API && typeof API.showLauncher === 'function') API.showLauncher();
    } catch (e) {
      /* What stood here read "the intake is absent — the Blueprint screens will
       * say so". That is true of exactly one cause and silent about every
       * other, and an absent intake is not the only way begin() throws. */
      armed = sinkError('start() could not arm the intake — LiveSlice.begin() or '
        + 'API.showLauncher() threw. The Blueprint screens will open unarmed, so the '
        + 'traveller reaches them and generation does not follow.', e);
    }

    var navigated = navTo('s-bp-energy');
    if (!navigated) failedToStart();

    return armed && navigated;
  }

  /* =====================================================================
   * Wiring
   *
   * P2's continueFromDetail() validates the whole Blueprint and shows its
   * errors on the ruling-G screen. That behaviour is left exactly as it is:
   * the wrapper hands control back to the original whenever the Blueprint is
   * incomplete, and only takes over the happy path.
   * ================================================================== */

  function wireIntake() {
    if (!root.LiveSlice || typeof root.LiveSlice.continueFromDetail !== 'function') return false;
    if (root.LiveSlice.__liveSliceP4Wired) return true;

    var original = root.LiveSlice.continueFromDetail;
    root.LiveSlice.continueFromDetail = function () {
      var result = null;
      try {
        result = root.LiveSlice.validate();
      } catch (e) {
        return original.apply(this, arguments);
      }
      if (!result || !result.ok) return original.apply(this, arguments);

      /* Back-then-forward must not cost an API call. If a Live Slice is
       * already rendered and not one Blueprint answer has moved since, this
       * returns the traveller to it untouched — same discipline as P2's
       * no-one-shot-latch fix, from the other direction: the screen is
       * re-enterable, and re-entering it is free. A changed answer falls
       * through and regenerates, because the rendered ledger would no longer
       * belong to the Blueprint on screen.
       *
       * RULING X, point 2. There are now THREE ways forward, not two, so the
       * one string equality becomes a comparison that can name the field:
       *
       *   nothing moved     -> re-enter the render already on screen. Free.
       *   only a local-only
       *   field moved       -> re-run Scoring.score() against the generation
       *                        already in hand. Free, instant, offline.
       *   anything else     -> regenerate.
       *
       * The fingerprint decides the third branch and the moved list decides
       * between the first two, and the two cannot disagree: the fingerprint is
       * every part EXCEPT the local-only ones, so inside one fingerprint the
       * only thing that can have moved is a local-only field. Add a field to
       * LOCAL_ONLY_PARTS and that stays true without another line here. */
      var current = currentBlueprint();
      var moved = movedParts(lastParts, blueprintParts(current));
      var sameGeneration = !!lastFingerprint && blueprintFingerprint(current) === lastFingerprint;

      if (lastResult && sameGeneration && moved) {
        if (!moved.length) {
          navTo('s-ls-results');
          return true;
        }
        if (lastPayload) {
          rescore(moved, current);
          return true;
        }
      }

      run('generate');
      return true;
    };
    root.LiveSlice.__liveSliceP4Wired = true;
    return true;
  }

  function init() {
    wireIntake();
    try {
      if (root.location && String(root.location.hash) === '#ls-start') showEntry();
      else if (root.LiveSlice && typeof root.LiveSlice.isArmed === 'function' && root.LiveSlice.isArmed()) showEntry();
      else renderEntryReplay();   // the card is hidden; its offline state is still current
    } catch (e) { /* non-browser host */ }
  }

  try {
    if (root.document && root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', init);
    } else if (root.document) {
      init();
    }
  } catch (e) { /* non-browser host */ }

  /* =====================================================================
   * Public surface
   * ================================================================== */

  return {
    run: run,
    render: render,
    start: start,
    showEntry: showEntry,
    hideEntry: hideEntry,
    openSettings: function () { if (API) API.openSettings(); },
    lastResult: function () { return lastResult; },
    isRunning: function () { return running; },

    // referenced by the appended markup and by the harness
    init: init,
    wireIntake: wireIntake,
    renderEntryReplay: renderEntryReplay,

    // pure-ish helpers the suite asserts directly
    _price: price,
    _money: money,
    _fitBadge: fitBadge,
    _interventionTooltip: interventionTooltip,
    _decisionsTooltip: decisionsTooltip,
    _reconcileDecisions: reconcileDecisions,

    // rulings X and Z — asserted directly by harness §11
    _blueprintParts: blueprintParts,
    _blueprintFingerprint: blueprintFingerprint,
    _movedParts: movedParts,
    _withLocalOnly: withLocalOnly,
    _LOCAL_ONLY_PARTS: LOCAL_ONLY_PARTS,
    _FOOTER_LINE: FOOTER_LINE,

    // P6 item 7 — the liveness copy, asserted by harness §12
    _livenessText: livenessText,
    _LIVENESS_LINES: LIVENESS_LINES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* No-op in the browser; lets harness.js load this under node without a build step. */
if (typeof module !== 'undefined' && module.exports) { module.exports = LiveSliceResults; }
