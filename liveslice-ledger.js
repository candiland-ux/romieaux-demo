/* Romieaux — Live Slice ledger panel (P5).
 *
 * The value framework, on screen: Cash Savings and the intervention rows that
 * make it, Hours Saved from the derived decision count, Time Value against the
 * canonical hourly-rate slider, the Fees line, and Total Romieaux Value — with
 * the render-time reconciliation that is the reason the panel is trustworthy
 * at all.
 *
 * NO DOLLAR FIGURE IS PRODUCED HERE (CLAUDE.md, ruling L).
 *   Every figure below is read off an Engines.buildLedger() result. There is
 *   no arithmetic on money in this file and no dollar literal in it — the one
 *   exception is countUp()'s tween, which walks BETWEEN two engine figures and
 *   always lands on the second; see RULING W in the header block below.
 *
 * =====================================================================
 * P5 NOTES — read alongside RULINGS.md
 *
 * RULING B. Total Romieaux Value = Cash Savings + Time Value. Fees are a
 *   separate line item and a return multiple, NEVER subtracted from the
 *   headline. The panel prints the fees line beside the total, exactly as the
 *   canonical trips do, and states the multiple only when the engine produced
 *   one (fees are zero on a generated trip, so `returnMultiple` is null and
 *   the panel says there is no multiple rather than inventing a number).
 *
 * RULING C. Cash Savings = Intelligence Savings + Net Budget, and Net Budget
 *   is DISPLAYED at zero rather than hidden. Same principle as the fees line:
 *   the framework must read identically to the canonical trips.
 *
 * RULING E. Both render-time reconciliations, against what this panel is
 *   ABOUT to display — dollars AND decisions. Either one failing renders the
 *   refusal block and NO figure at all. An unreconciled number on screen is
 *   the single failure mode the Ledger Law exists to prevent, so the panel
 *   would rather show nothing than show it.
 *
 * RULING T. When the derivable decision categories sum below the intervention
 *   count the breakdown is WITHHELD and only the floor is stated. This panel
 *   publishes no breakdown on that branch and says why on screen. Publishing
 *   one anyway is itself a reconciliation failure here, not a cosmetic slip.
 *
 * RULING L / the canonical slider. The hourly rate is READ from the canonical
 *   `userHourlyRate`; this file never keeps a second copy of it. The panel's
 *   own slider drives the canonical `setTimeRate()`, and `updateTimeRate()` is
 *   WRAPPED original-first — never edited — so the canonical Profile dashboard
 *   and the Live Slice panel move together off one variable. Same wiring
 *   contract P2 used for nav() and P4 used for continueFromDetail().
 *
 * §7 / work order §7. Zero interventions renders the honest empty state —
 *   "No savings opportunities detected in this itinerary" — and never pads.
 *
 * DECISIONS RULING 3 (the P6 addition — the only change this file has taken
 *   since P5). The decisions line carries the "single planning pass" note, so
 *   a count honestly smaller than a canonical trip's reads as scope rather
 *   than as weakness. Ruling 4 forbids the alternative of inflating it.
 *
 * RULING V (ruled at P5). The hourly rate is BOTH an ExperienceROI input and
 *   a display multiplier. Ruled: the slider RE-PRICES, it never re-plans.
 *   Moving it rebuilds the ledger through Engines.buildLedger() at the new
 *   rate — whose rows never read hourly_rate — so Time Value and the total
 *   move and the itinerary, the rows and Cash Savings do not. Re-scoring
 *   instead would move ledger rows under a drag gesture and, on a replayed
 *   trip, score against a Blueprint field the cached trip never had (§5b).
 *
 * RULING V(b) (ruled at P5). Because the slider re-prices only, a trip can be
 *   PLANNED at one rate and PRICED at another. plannedNote() says so on screen
 *   the moment the two differ, so nobody assumes the itinerary followed the
 *   slider.
 *
 * RULING W (ruled at P5). Work order §6 requires an "animated count-up";
 *   CLAUDE.md forbids any dollar figure being produced in Live Slice ledger
 *   render code. Ruled: the ATTRIBUTION reading — the rule governs figures the
 *   traveller could read as a claim about their money, and a tween frame is an
 *   engine figure in motion. CLAUDE.md's sentence was amended in the same
 *   session to say so. The animation is built to the narrowest reading of it:
 *   countUp() is the ONLY place a non-engine numeral reaches the DOM, it
 *   interpolates between two figures engines.js produced, it always terminates
 *   by writing the target figure verbatim, nothing ever reads a frame back,
 *   and it does not run at all when reconciliation fails.
 * ================================================================== */
var LiveSliceLedger = (function (root) {
  'use strict';

  var Engines = root.Engines;
  var Blueprint = root.Blueprint;
  var Scoring = root.LiveSliceScoring;

  if (!Engines || !Blueprint || !Scoring) {
    if (root.console && root.console.warn) {
      root.console.warn('Live Slice: engines.js, blueprint.js and liveslice-scoring.js must load before liveslice-ledger.js.');
    }
    return null;
  }

  var PANEL_ID = 'ls-res-ledger';

  /* The result and the ledger CURRENTLY ON SCREEN. The hourly rate is
   * deliberately absent from this list: it lives on the canonical
   * `userHourlyRate` and is re-read at every use. */
  var lastResult = null;
  var lastLedger = null;

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

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
    return node;
  }

  function setValue(id, value) {
    var node = el(id);
    if (node) node.value = value;
    return node;
  }

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function logError(message, payload) {
    if (root.console && root.console.error) {
      payload === undefined ? root.console.error(message) : root.console.error(message, payload);
    }
  }

  function logInfo(message) {
    if (root.console && root.console.info) root.console.info(message);
  }

  /* =====================================================================
   * Formatting. money() takes a figure engines.js already produced and
   * formats it; it performs no arithmetic.
   * ================================================================== */

  var CURRENCY = '$';
  var PER_HOUR = '/hr';

  function money(amount) {
    return CURRENCY + Math.round(Engines._num(amount, 0)).toLocaleString('en-US');
  }

  function hoursText(hours) {
    return Engines._num(hours, 0) + ' h';
  }

  function rateText(rate) {
    return CURRENCY + Engines._num(rate, 0);
  }

  /* =====================================================================
   * The hourly rate — read, never duplicated.
   *
   * The canonical `userHourlyRate` is the single source of truth (RULINGS §7,
   * the P2 wiring contract). When it is absent — a host with no canonical
   * dashboard — the rate the Blueprint carried into the generation is used,
   * which is the same number the pipeline planned against.
   * ================================================================== */

  /* RULING V(b). The rate the trip was PLANNED at — the one the Blueprint
   * carried into the generation, and the one ExperienceROI ranked and packed
   * against. Ruling V makes the slider re-price only, so once it has moved the
   * trip is planned at one rate and priced at another. The traveller is told,
   * rather than left to assume the itinerary followed the slider. */
  function plannedRate(result) {
    var rate = Engines._num(result && result.engineInput && result.engineInput.hourly_rate, NaN);
    if (!isFinite(rate)) return null;
    return Math.round(rate);
  }

  function plannedNote(result, ledger) {
    var planned = plannedRate(result);
    if (planned === null || planned === ledger.hourlyRate) return '';
    return 'Planned at ' + rateText(planned) + PER_HOUR + ', priced at ' +
      rateText(ledger.hourlyRate) + PER_HOUR + '. The slider re-prices your hours; ' +
      'the itinerary itself is the one this trip was planned as.';
  }

  function currentRate(result) {
    var fallback = (result && result.engineInput && result.engineInput.hourly_rate);
    if (!isFinite(Engines._num(fallback, NaN))) fallback = Blueprint.HOURLY_RATE_DEFAULT;

    var canonical = Engines._num(root.userHourlyRate, NaN);
    var rate = isFinite(canonical) ? canonical : fallback;

    rate = Math.round(rate);
    if (rate < Blueprint.HOURLY_RATE_MIN) rate = Blueprint.HOURLY_RATE_MIN;
    if (rate > Blueprint.HOURLY_RATE_MAX) rate = Blueprint.HOURLY_RATE_MAX;
    return rate;
  }

  /* =====================================================================
   * The count-up (work order §6). See RULING W in the header block.
   *
   * Walks from the figure already on screen to the figure engines.js just
   * produced, and writes that target verbatim on the final frame. Where there
   * is no frame clock — node, or a host that has none — it settles instantly
   * on the target, so the DOM is correct whether or not the animation ever
   * runs. Nothing reads an intermediate frame back.
   * ================================================================== */

  var COUNT_UP_MS = 850;
  var animationSeq = {};

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function countUp(id, from, to, format) {
    var node = el(id);
    if (!node) return false;

    var seq = animationSeq[id] = (animationSeq[id] || 0) + 1;
    var raf = typeof root.requestAnimationFrame === 'function' ? root.requestAnimationFrame : null;
    var start = Engines._num(from, 0);
    var target = Engines._num(to, 0);

    if (!raf || start === target) {
      node.textContent = format(to);
      return false;
    }

    var t0 = null;
    function frame(stamp) {
      // A newer change superseded this one — drop the stale tween rather than
      // letting two of them fight over the same node.
      if (animationSeq[id] !== seq) return;
      if (t0 === null) t0 = stamp;
      var progress = (stamp - t0) / COUNT_UP_MS;
      if (!(progress < 1)) {
        node.textContent = format(to);          // the engine figure, verbatim
        return;
      }
      node.textContent = format(start + (target - start) * easeOutCubic(progress));
      raf.call(root, frame);
    }
    raf.call(root, frame);
    return true;
  }

  /* =====================================================================
   * Traceability tooltips.
   *
   * Registered on the canonical TTIP_DATA for the hover path and mirrored into
   * hidden nodes inside the panel for the canonical click path — the same
   * reuse P4 established, so no canonical tooltip code changes. P4 owns
   * #ls-res-tooltips and rewrites it every render, so this panel carries its
   * own hidden nodes rather than writing into P4's.
   * ================================================================== */

  var tooltipNodes = [];

  function registerTooltip(key, markup) {
    try {
      if (root.TTIP_DATA) root.TTIP_DATA[key] = markup;
    } catch (e) { /* canonical tooltip machinery absent — the row still names its baseline */ }
    tooltipNodes.push('<div id="' + key + '" style="display:none;">' + markup + '</div>');
    return key;
  }

  function tooltipTrigger(key) {
    return '<span class="ttip-trig" onmouseenter="showTtip(this,\'' + key + '\')" ' +
      'onmouseleave="hideTtip()" onclick="toggleTtip(this,\'' + key + '\',event)">i</span>';
  }

  /* Every Cash Savings row carries its formula and its named baseline. Both
   * strings come off the engines.js row; neither is composed here. */
  function rowTooltip(row) {
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

  function hoursTooltip(ledger) {
    return '<div class="ttip-h">Hours Saved · Generated live</div>' +
      '<div class="ttip-row"><span>Formula</span><strong>decisions × ' +
      Engines.MINUTES_PER_DECISION + ' min</strong></div>' +
      '<div class="ttip-row"><span>Decisions</span><strong>' + ledger.decisions + '</strong></div>' +
      '<div class="ttip-row"><span>Baseline</span><strong>DIY research baseline</strong></div>' +
      '<div class="ttip-total"><span>Hours</span><span>' + hoursText(ledger.hoursSaved) + '</span></div>' +
      '<div class="ttip-note">' + Engines.MINUTES_PER_DECISION +
      ' minutes is what the same decision costs a traveller researching it alone.</div>';
  }

  /* P6 item 8. The standing plumbing explainer, moved off the panel and behind
   * an ⓘ. It is true and worth having, but as inline copy it competed with
   * ruling V(b)'s disclosure — the one line that only appears when it has
   * something to say. The disclosure now has the panel to itself. */
  function rateHelpTooltip() {
    return '<div class="ttip-h">Your hourly rate</div>' +
      '<div class="ttip-row"><span>Shared with</span><strong>The Profile dashboard</strong></div>' +
      '<div class="ttip-row"><span>Moving it</span><strong>Re-prices your hours</strong></div>' +
      '<div class="ttip-row"><span>It does not</span><strong>Re-plan the trip</strong></div>' +
      '<div class="ttip-note">The same rate as the Profile dashboard, read from the one slider value the ' +
      'whole demo shares. Moving it re-prices the hours; it does not re-plan the trip.</div>';
  }

  function timeValueTooltip(ledger) {
    return '<div class="ttip-h">Time Value · Generated live</div>' +
      '<div class="ttip-row"><span>Formula</span><strong>hours × hourly rate</strong></div>' +
      '<div class="ttip-row"><span>Hours</span><strong>' + hoursText(ledger.hoursSaved) + '</strong></div>' +
      '<div class="ttip-row"><span>Your rate</span><strong>' + rateText(ledger.hourlyRate) + PER_HOUR + '</strong></div>' +
      '<div class="ttip-row"><span>Baseline</span><strong>Your hourly-rate slider</strong></div>' +
      '<div class="ttip-total"><span>Time Value</span><span>' + money(ledger.timeValue) + '</span></div>' +
      '<div class="ttip-note">The same rate the Profile dashboard uses. Move the slider and this follows it.</div>';
  }

  /* =====================================================================
   * Reconciliation — ruling E, both axes, at render time.
   *
   * `ledger` is the one this panel is about to display, and `rendered` is
   * built by walking the rows it is about to print — so this catches drift
   * between the engine and the DOM, which is the whole point.
   *
   * Every failure carries two forms: a screen-safe label with NO figure in
   * it, and a console line with the numbers. The screen never shows an
   * unreconciled number, which is the rule that makes "render nothing" the
   * correct behaviour rather than an unhelpful one.
   * ================================================================== */

  function reconcilePanel(result, ledger, emitted) {
    var failures = [];
    function fail(label, detail) { failures.push({ label: label, detail: detail }); }

    /* (1) Dollars, against what the markup actually put on the page:
     * `emitted.headline` is the Intelligence Savings figure the panel printed
     * and `emitted.count` is the intervention count it advertised, both
     * collected while the markup was being built. Engines.reconcile() weighs
     * them against the ledger's own rows. */
    var printed = emitted || {
      headline: ledger.intelligenceSavings,
      count: ledger.interventionCount,
      rowSum: (ledger.rows || []).reduce(function (n, r) { return n + r.amount; }, 0),
      rowCount: (ledger.rows || []).length
    };

    var dollars = Engines.reconcile(ledger, { headline: printed.headline, count: printed.count });
    if (!dollars.sumOk) fail('The headline does not equal the sum of its rows.', dollars.message);
    if (!dollars.countOk) fail('The stated intervention count does not match the rows shown.', dollars.message);

    if (printed.rowCount !== (ledger.rows || []).length) {
      fail('The panel did not print every intervention the engine detected.',
        'printed ' + printed.rowCount + ' of ' + (ledger.rows || []).length + ' rows');
    }
    if (printed.rowSum !== printed.headline) {
      fail('The rows printed do not sum to the headline printed.',
        'rows on screen ' + printed.rowSum + ' vs headline on screen ' + printed.headline);
    }

    /* The two framework identities this panel prints as if they were facts.
     * Ruling C: Cash Savings = Intelligence Savings + Net Budget.
     * Ruling B: Total = Cash Savings + Time Value, fees NOT subtracted. */
    if (ledger.cashSavings !== ledger.intelligenceSavings + ledger.netBudget) {
      fail('Cash Savings does not equal Intelligence Savings plus Net Budget.',
        'cashSavings ' + ledger.cashSavings + ' vs ' + ledger.intelligenceSavings + ' + ' + ledger.netBudget);
    }
    if (ledger.totalRomieauxValue !== ledger.cashSavings + ledger.timeValue) {
      fail('Total Romieaux Value does not equal Cash Savings plus Time Value.',
        'total ' + ledger.totalRomieauxValue + ' vs ' + ledger.cashSavings + ' + ' + ledger.timeValue);
    }

    /* (2) Decisions — ruling 1's reconciling law, and ruling T's withhold
     * branch, which is a reconciliation rule here and not a copy choice. */
    var decisions = (result && result.decisions) || { rows: [], total: 0, interventionCount: 0, floorApplied: false };
    var sum = (decisions.rows || []).reduce(function (n, r) { return n + r.count; }, 0);

    if (decisions.floorApplied) {
      if ((decisions.rows || []).length) {
        fail('A withheld decisions breakdown was published.',
          'ruling T: floorApplied with ' + decisions.rows.length + ' rows');
      }
      if (decisions.total !== decisions.interventionCount) {
        fail('The withheld decision count is not the intervention floor.',
          'stated ' + decisions.total + ' vs floor ' + decisions.interventionCount);
      }
    } else if (sum !== decisions.total) {
      fail('The decisions breakdown does not sum to its stated total.',
        'stated ' + decisions.total + ' vs ' + sum + ' across ' + decisions.rows.length + ' rows');
    }

    /* The hours line is priced off the ledger's own decision count, so the
     * two must be the same number — otherwise Time Value is a real figure
     * measuring a count the screen never showed. */
    if (ledger.decisions !== decisions.total) {
      fail('Hours Saved is priced off a different decision count than the one stated.',
        'ledger ' + ledger.decisions + ' vs stated ' + decisions.total);
    }
    if (Engines.hoursSaved(ledger.decisions) !== ledger.hoursSavedExact) {
      fail('Hours Saved does not follow the DIY-minutes baseline.',
        'expected ' + Engines.hoursSaved(ledger.decisions) + ', ledger carries ' + ledger.hoursSavedExact);
    }

    return {
      ok: failures.length === 0,
      failures: failures,
      dollars: dollars,
      message: failures.length
        ? 'Live Slice ledger panel FAILED reconciliation — ' +
          failures.map(function (f) { return f.detail; }).join('; ')
        : 'Live Slice ledger panel reconciled: ' + dollars.message
    };
  }

  /* =====================================================================
   * Markup
   * ================================================================== */

  function sectionHeader(subtitle) {
    return '<div class="sh"><div class="shl">Generated live · Value Ledger</div>' +
      '<div class="sht">' + esc(subtitle) + '</div></div>';
  }

  var CARD_OPEN = '<div style="margin:0 20px 14px;background:var(--pn);border:1px solid var(--bd);border-radius:12px;padding:15px 16px;">';
  var LABEL_STYLE = 'font-family:var(--fm);font-size:8px;letter-spacing:1.5px;color:var(--ts);text-transform:uppercase;';
  var FIGURE_STYLE = 'font-family:var(--fd);font-weight:700;color:var(--ink);';

  /* P6 mobile pass. Both row builders wrap rather than overflow, and their
   * label halves may shrink below their own content width. A flex child
   * defaults to min-width:auto, so a long label — or a figure that grew a
   * digit — pushes the row wider than the card and the whole screen scrolls
   * sideways. `min-width:0` plus `flex-wrap` is the fix, and it is width-
   * agnostic: it needs no breakpoint and it cannot misfire on a wide screen,
   * where nothing ever reaches the wrap. The figure keeps its own line if the
   * label takes the width, which is the reading order that matters. */
  var SHRINKABLE = 'min-width:0;overflow-wrap:anywhere;';

  function headlineRow(label, figureId, figure, size, colour, trigger) {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
      '<div style="' + LABEL_STYLE + SHRINKABLE + '">' + esc(label) + (trigger ? ' ' + trigger : '') + '</div>' +
      '<div id="' + figureId + '" style="' + FIGURE_STYLE + 'font-size:' + size + 'px;' +
      (colour ? 'color:' + colour + ';' : '') + '">' + figure + '</div></div>';
  }

  function minorRow(label, figure, figureId, trigger) {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;color:var(--tm);flex-wrap:wrap;">' +
      '<span style="' + SHRINKABLE + '">' + esc(label) + (trigger ? ' ' + trigger : '') + '</span>' +
      '<span' + (figureId ? ' id="' + figureId + '"' : '') + ' style="color:var(--ink);white-space:nowrap;">' + figure + '</span></div>';
  }

  function note(text) {
    return '<div style="font-size:11px;color:var(--ts);line-height:1.6;margin-top:8px;">' + esc(text) + '</div>';
  }

  /* --- Cash Savings: the intervention rows, then ruling C's two components.
   * Every row it prints is counted into `emitted`, which is what the
   * reconciliation is then weighed against — the figures on the page, not the
   * figures the ledger says are on the page. */
  function cashBlock(ledger, emitted) {
    var rows = ledger.rows.map(function (row, i) {
      var key = registerTooltip('ls-lg-row-' + i, rowTooltip(row));
      emitted.rowSum += row.amount;
      emitted.rowCount++;
      return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--bd);">' +
        '<div style="flex:1;' + SHRINKABLE + '">' +
        '<div style="font-size:12px;color:var(--tx);line-height:1.4;">' + esc(row.label) + '</div>' +
        '<div style="font-family:var(--fm);font-size:8px;letter-spacing:1.5px;color:var(--rg);text-transform:uppercase;margin-top:2px;">' +
        esc(row.kind) + ' · baseline: ' + esc(row.baseline) + '</div></div>' +
        '<div style="font-family:var(--fd);font-size:13px;font-weight:600;color:var(--gn);flex-shrink:0;white-space:nowrap;">' +
        money(row.amount) + ' ' + tooltipTrigger(key) + '</div></div>';
    }).join('');

    /* Work order §7: zero interventions says so, and never pads. */
    var body = ledger.isEmpty
      ? '<div style="font-size:12px;color:var(--tm);line-height:1.6;padding:4px 0 2px;">' +
        'No savings opportunities detected in this itinerary. Nothing in this generation cleared a Ledger Law gate, ' +
        'and a figure appears only when an engine can name the baseline it was measured against.</div>'
      : rows;

    emitted.headline = ledger.intelligenceSavings;   // the figure printed below

    return CARD_OPEN +
      headlineRow('Cash Savings', 'ls-lg-cash', money(ledger.cashSavings), 26, 'var(--gn)') +
      '<div style="margin:10px 0 4px;">' + body + '</div>' +
      minorRow('Intelligence Savings', money(ledger.intelligenceSavings), 'ls-lg-intel') +
      // Ruling C: Net Budget is shown at zero for a generated trip, not hidden.
      minorRow('Net Budget', money(ledger.netBudget), 'ls-lg-netbudget') +
      note('Net Budget is what the trip came in under its envelope. A generated trip has no actuals yet, ' +
        'so it is shown rather than hidden — the framework reads the same as every other trip.') +
      '</div>';
  }

  /* --- Hours and Time Value: the decisions count, ruling T's withhold
   * branch, and the canonical rate slider driving Time Value live. */
  function timeBlock(result, ledger) {
    var decisions = result.decisions;
    var hoursKey = registerTooltip('ls-lg-hours-t', hoursTooltip(ledger));
    var timeKey = registerTooltip('ls-lg-time-t', timeValueTooltip(ledger));
    var rateHelpKey = registerTooltip('ls-lg-rate-help', rateHelpTooltip());

    var decisionsLine;
    if (decisions.floorApplied) {
      // RULING T: the floor is stated and the breakdown is withheld.
      decisionsLine = minorRow('Decisions automated (at least)', decisions.total, 'ls-lg-decisions') +
        note('The breakdown is withheld for this run: the categories that could be derived summed below the ' +
          'intervention count, and a breakdown that does not sum to its own total would not be honest. ' +
          'The floor stands — each intervention took at least one decision.');
    } else {
      var decisionsKey = registerTooltip('ls-lg-da', decisionsTooltip(decisions));
      decisionsLine = minorRow('Decisions automated', decisions.total, 'ls-lg-decisions', tooltipTrigger(decisionsKey));
    }

    /* DECISIONS RULING 3, the P6 copy note. This count is honestly smaller
     * than a canonical trip's, and the reason is scope rather than weakness: a
     * canonical trip carries live monitoring and ROAM behind its number, and
     * this one is a SINGLE PLANNING PASS. Saying so is what stops the gap
     * reading as a shortfall — and ruling 4 forbids the alternative, which
     * would be inflating the count until it looks like the others.
     *
     * It states no figure of its own. The count beside it is the engine's. */
    decisionsLine += note('A single planning pass. The canonical trips have months of live monitoring and ROAM ' +
      'behind their decision counts; this is what the engines decided in one pass, and every count in it is ' +
      'work that actually ran.');

    /* P6 mobile pass. This is the one Live Slice control a narrow viewport
     * actually fights, so it is built for the narrow case first: the input is
     * a block box with border-box sizing so `width:100%` can never exceed its
     * card, it carries a touch-sized height, and the two ends of the range are
     * named underneath — on a 380px screen the track is short enough that the
     * bubble alone does not tell the traveller what they are dragging within.
     * The thumb itself is sized in the P6 style block; a pseudo-element cannot
     * be written inline. Both endpoint figures are Blueprint bounds read
     * through rateText(); no numeral is composed here. */
    var slider = '<div style="position:relative;padding-top:26px;margin:12px 0 8px;">' +
      '<div id="ls-lg-rate-bubble" style="position:absolute;top:0;left:0;background:var(--sd);color:#fff;padding:3px 9px;border-radius:10px;font-family:var(--fd);font-size:12px;font-weight:700;white-space:nowrap;pointer-events:none;">' +
      rateText(ledger.hourlyRate) + PER_HOUR + '</div>' +
      '<input type="range" id="ls-lg-rate-slider" min="' + Blueprint.HOURLY_RATE_MIN +
      '" max="' + Blueprint.HOURLY_RATE_MAX + '" step="5" value="' + ledger.hourlyRate +
      '" oninput="LiveSliceLedger.onRateInput(this.value)" ' +
      'aria-label="Your hourly rate" ' +
      'style="display:block;width:100%;max-width:100%;box-sizing:border-box;height:28px;margin:0;accent-color:var(--sd);">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;font-family:var(--fm);font-size:8px;letter-spacing:1px;color:var(--ts);margin-top:2px;">' +
      '<span>' + rateText(Blueprint.HOURLY_RATE_MIN) + PER_HOUR + '</span>' +
      '<span>' + rateText(Blueprint.HOURLY_RATE_MAX) + PER_HOUR + '</span></div>' +
      '</div>';

    /* P6, item 9. THE MISSING PREMISE. The slider used to arrive with no
     * question attached — a control with no stated reason to touch it. The
     * traveller needs to know what it is for before they are asked to set it,
     * and the hours figure is what makes the question worth answering.
     *
     * The hours figure is read off the engine (`ledger.hoursSaved`); nothing
     * is computed here. On the empty ledger hours can be zero, and "saved you
     * ~0 h of planning" is a bad sentence, so at zero the premise is the
     * question alone. */
    var premise = '<div style="font-family:var(--fd);font-size:14px;font-weight:600;color:var(--ink);line-height:1.45;margin-top:14px;">' +
      (Engines._num(ledger.hoursSaved, 0) > 0
        ? 'Romieaux saved you ~' + esc(hoursText(ledger.hoursSaved)) + ' of planning. What&rsquo;s an hour of your time worth?'
        : 'What&rsquo;s an hour of your time worth?') +
      ' ' + tooltipTrigger(rateHelpKey) + '</div>' +
      '<div style="font-size:11.5px;color:var(--tm);line-height:1.6;margin-top:3px;">' +
      'Most people use their hourly pay, or what they&rsquo;d pay someone else to plan.</div>';

    return CARD_OPEN +
      headlineRow('Time Value', 'ls-lg-timevalue', money(ledger.timeValue), 22, 'var(--gn)', tooltipTrigger(timeKey)) +
      '<div style="margin-top:8px;">' +
      minorRow('Hours saved', hoursText(ledger.hoursSaved), 'ls-lg-hours', tooltipTrigger(hoursKey)) +
      decisionsLine +
      '</div>' +
      premise +
      slider +
      '<div id="ls-lg-hours-caption" style="font-size:11px;color:var(--ts);line-height:1.6;font-style:italic;">' +
      esc(hoursCaption(ledger)) + '</div>' +
      /* RULING V(b), and P6 item 8. When the two rates differ this line
       * carries the panel alone. The standing plumbing explainer moved behind
       * the premise's ⓘ, so it no longer competes with the disclosure — and
       * no longer crowds the control when the rates agree either. */
      '<div id="ls-lg-planned" style="font-size:11px;color:var(--sd);line-height:1.6;">' +
      esc(plannedNote(result, ledger)) + '</div>' +
      '</div>';
  }

  function hoursCaption(ledger) {
    return hoursText(ledger.hoursSaved) + ' × ' + rateText(ledger.hourlyRate) + PER_HOUR +
      ' · ' + ledger.decisions + ' decisions at ' + Engines.MINUTES_PER_DECISION + ' min each';
  }

  /* --- Total Romieaux Value, and the fees line beside it (ruling B) */
  function totalBlock(ledger) {
    var multiple = ledger.returnMultiple === null || ledger.returnMultiple === undefined
      ? 'No fee was taken on this trip, so there is no multiple to state.'
      : Math.round(ledger.returnMultiple) + '× return on fees paid.';

    return '<div style="margin:0 20px 14px;background:var(--sdl);border:1px solid rgba(176,138,80,.28);border-radius:12px;padding:15px 16px;">' +
      headlineRow('Total Romieaux Value', 'ls-lg-total', money(ledger.totalRomieauxValue), 28, 'var(--sd)') +
      '<div style="margin-top:8px;">' +
      minorRow('Cash Savings', money(ledger.cashSavings), 'ls-lg-total-cash') +
      minorRow('Time Value', money(ledger.timeValue), 'ls-lg-total-time') +
      // Ruling B: fees are a line item and a multiple, never subtracted.
      minorRow('Fees', money(ledger.fees), 'ls-lg-fees') +
      '</div>' +
      note('Cash Savings plus Time Value. Fees are shown beside the total and as a return multiple — ' +
        'never subtracted from it. ' + multiple) +
      '</div>';
  }

  function panelMarkup(result, ledger, emitted) {
    tooltipNodes = [];

    // The count the panel ADVERTISES. Reconciliation weighs it against the
    // number of rows the ledger actually carries (ruling E, second axis).
    emitted.count = ledger.isEmpty ? 0 : ledger.interventionCount;
    var subtitle = ledger.isEmpty
      ? 'Nothing cleared a Ledger Law gate on this trip'
      : emitted.count + ' interventions, reconciled against their rows';

    var body = sectionHeader(subtitle) +
      cashBlock(ledger, emitted) +
      timeBlock(result, ledger) +
      totalBlock(ledger);

    // The canonical toggleTtip() reads a NODE with the tooltip's id while
    // showTtip() reads TTIP_DATA — the same markup, mirrored, for both paths.
    return body + '<div id="ls-lg-tooltips">' + tooltipNodes.join('') + '</div>';
  }

  /* The refusal. No figure appears anywhere in it — that is the point. */
  function renderRefusal(check) {
    var items = check.failures.map(function (f) {
      return '<div style="font-size:12px;color:var(--tm);line-height:1.6;">· ' + esc(f.label) + '</div>';
    }).join('');

    html(PANEL_ID,
      sectionHeader('Withheld — this run did not reconcile') +
      '<div style="margin:0 20px 14px;background:rgba(196,85,63,.06);border:1px solid rgba(196,85,63,.3);border-radius:12px;padding:15px 16px;">' +
      '<div style="font-family:var(--fm);font-size:8px;letter-spacing:2px;color:var(--rd);text-transform:uppercase;margin-bottom:6px;">Ledger withheld</div>' +
      '<div style="font-size:13px;color:var(--tx);line-height:1.55;margin-bottom:8px;">' +
      'This ledger could not be reconciled against its own rows, so the panel is showing none of it. ' +
      'A figure that does not reconcile is the one thing this panel exists to prevent.</div>' +
      items +
      note('The full arithmetic is in the console. Replay or regenerate the trip; if it repeats, the engine and the ' +
        'render have drifted apart and that is a bug worth stopping for.') +
      '</div>');
    logError(check.message);
  }

  function renderUnavailable() {
    html(PANEL_ID,
      sectionHeader('No scored trip to price') +
      '<div style="margin:0 20px 14px;font-size:12px;color:var(--tm);line-height:1.6;">' +
      'The ledger panel prices a scored trip. Generate or replay one and it fills itself in.</div>');
  }

  /* =====================================================================
   * Render
   * ================================================================== */

  function render(result) {
    var previous = lastLedger;
    lastResult = null;
    lastLedger = null;

    if (!result || !result.ok || !result.ledger) {
      renderUnavailable();
      return false;
    }

    // Re-price at whatever the canonical slider currently says. Only the time
    // half can move; buildLedger()'s rows never read the hourly rate.
    var ledger = Scoring.ledgerAtRate(result, currentRate(result)) || result.ledger;

    /* The markup is built FIRST and reconciled second, so the assertion is on
     * what is about to be displayed rather than on what the ledger claims —
     * ruling E's whole point. Nothing reaches the DOM until it has passed. */
    var emitted = { headline: 0, count: 0, rowSum: 0, rowCount: 0 };
    var markup = panelMarkup(result, ledger, emitted);

    var check = reconcilePanel(result, ledger, emitted);
    if (!check.ok) {
      renderRefusal(check);
      return false;
    }
    logInfo(check.message);

    lastResult = result;
    lastLedger = ledger;

    html(PANEL_ID, markup);
    wireRate();

    /* The count-up. A first render walks up from zero; a re-render after a
     * pace change or a new generation walks from the figure that was on
     * screen, so a ledger that legitimately moved is ANIMATED rather than
     * reported as an error (§5c: a pace change moves the headline). */
    var from = previous || { cashSavings: 0, timeValue: 0, totalRomieauxValue: 0 };
    countUp('ls-lg-cash', from.cashSavings, ledger.cashSavings, money);
    countUp('ls-lg-timevalue', from.timeValue, ledger.timeValue, money);
    countUp('ls-lg-total', from.totalRomieauxValue, ledger.totalRomieauxValue, money);
    return true;
  }

  /* =====================================================================
   * The hourly rate, live (work order §6)
   *
   * updateTimeRate() is WRAPPED, original-first — never edited (ruling L).
   * The canonical dashboard updates exactly as it always did, and the Live
   * Slice panel re-prices off the same variable afterwards.
   * ================================================================== */

  function wireRate() {
    if (root.__liveSliceP5RateWired) return true;
    if (typeof root.updateTimeRate !== 'function') return false;

    var original = root.updateTimeRate;
    root.updateTimeRate = function () {
      var out = original.apply(this, arguments);
      try { applyRate(); }
      catch (e) { logError('Live Slice: the ledger panel could not follow the rate slider.', e); }
      return out;                                   // pass-through, as P2 established
    };
    root.__liveSliceP5RateWired = true;
    return true;
  }

  /* The panel's own slider drives the CANONICAL setter, so there is still one
   * rate in the demo. The last branch writes the canonical variable itself —
   * not a second one — for a host that has no canonical dashboard loaded. */
  function onRateInput(value) {
    if (typeof root.setTimeRate === 'function') { root.setTimeRate(value); return true; }
    if (typeof root.updateTimeRate === 'function') { root.updateTimeRate(value); return true; }
    root.userHourlyRate = Math.round(Engines._num(value, Blueprint.HOURLY_RATE_DEFAULT));
    applyRate();
    return true;
  }

  /* A rate change re-prices; it never re-plans (see ledgerAtRate's note and
   * the P5 conflict report item V). Only the rate-dependent nodes are
   * rewritten — re-rendering the panel would destroy the slider mid-drag. */
  function applyRate() {
    if (!lastResult || !lastLedger) return false;

    var next = Scoring.ledgerAtRate(lastResult, currentRate(lastResult));
    if (!next) return false;

    /* No `emitted` here: the rows and the headline already on the page do not
     * move with the rate, so the panel's own figures are what reconcilePanel()
     * derives by default. The decisions axis and the two framework identities
     * are re-checked in full, because Time Value and the total DO move. */
    var check = reconcilePanel(lastResult, next);
    if (!check.ok) {
      renderRefusal(check);
      lastLedger = null;
      return false;
    }

    var previous = lastLedger;
    lastLedger = next;

    setText('ls-lg-rate-bubble', rateText(next.hourlyRate) + PER_HOUR);
    setValue('ls-lg-rate-slider', next.hourlyRate);
    setText('ls-lg-hours-caption', hoursCaption(next));
    setText('ls-lg-planned', plannedNote(lastResult, next));      // ruling V(b)
    // The hours themselves do not move with the rate — only what they are worth.
    countUp('ls-lg-timevalue', previous.timeValue, next.timeValue, money);
    countUp('ls-lg-total-time', previous.timeValue, next.timeValue, money);
    countUp('ls-lg-total', previous.totalRomieauxValue, next.totalRomieauxValue, money);
    return true;
  }

  function init() {
    wireRate();
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
    render: render,
    onRateInput: onRateInput,
    applyRate: applyRate,
    init: init,
    wireRate: wireRate,
    ledger: function () { return lastLedger; },

    // asserted directly by the suites
    _money: money,
    _currentRate: currentRate,
    _reconcilePanel: reconcilePanel,
    _hoursCaption: hoursCaption,
    _plannedNote: plannedNote,
    _countUp: countUp,
    _PANEL_ID: PANEL_ID
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* No-op in the browser; lets harness.js load this under node without a build step. */
if (typeof module !== 'undefined' && module.exports) { module.exports = LiveSliceLedger; }
