/* ZeroBench results explorer widget.
 *
 * Renders one Plotly chart from the JSON blob in #zb-results-data and rebuilds
 * it with Plotly.react whenever a control changes state:
 *   view  : date | cost | tokens | price_out | price_in   (x-axis)
 *   ds    : official / reported toggles
 *   split : main | sub
 * Generated data comes from results_plots/build_dataset.py; this file is
 * hand-maintained and mirrored by build_widget.py's build_figure() for the
 * static exports - keep the two in sync.
 *
 * Encoding: colour = metric; filled markers = official runs, hollow = reported
 * (diamond = tool-assisted, square = tools unclear). Date views carry no-tool
 * SOTA step lines extended to the viewer's today; cost/token views carry
 * x error bars (bootstrap 95% CI) and per-metric Pareto frontiers. Every view
 * carries the 30% human-baseline line; date views add a ZeroBench-release
 * vertical line. The legend is split into two columns (a second plotly legend
 * object, since vertical legends have no ncol) in every non-narrow layout.
 *
 * The chart reveals itself in three passes - reference frame, then points,
 * then trend lines, with a ring on every step up (see the sweep block below).
 * It plays in full the first time the chart is scrolled to, and fast on every
 * control change. Presentation only, with no counterpart in build_widget.py's
 * static export - nothing to sync.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('zb-results-data');
  var chartEl = document.getElementById('zb-results-chart');
  if (!dataEl || !chartEl) return;
  var POINTS = JSON.parse(dataEl.textContent).points;

  var VIEWS = {
    date: { x: 'date_jit', type: 'date', title: 'Release date (small offsets are added to avoid overlap)' },
    cost: { x: 'cost_q', type: 'log', fmt: 'usd', frontier: true, err: ['cost_lo', 'cost_hi'], title: 'Mean cost per question, USD (official runs, release-date prices)' },
    tokens: { x: 'tokens_q', type: 'log', fmt: 'tok', frontier: true, err: ['tokens_lo', 'tokens_hi'], title: 'Mean total tokens per question (official runs)' },
    price_out: { x: 'price_out', type: 'log', fmt: 'usd', frontier: true, title: 'Output price at release, USD per 1M tokens' },
    price_in: { x: 'price_in', type: 'log', fmt: 'usd', frontier: true, title: 'Input price at release, USD per 1M tokens' }
  };
  var METRIC_COLOR = { 'pass@5': '#66c2a5', 'pass^5': '#fc8d62', 'pass@1': '#8da0cb' };
  // Third-party numbers sit behind our own when the two are shown together, so
  // the official runs read first. Alone, reported results carry the chart and
  // stay at full strength. Mirrored in build_widget.py.
  var REPORTED_DIM = 0.65;
  var GROUPS = ['pass@5', 'pass^5', 'pass@1'];
  // Plotly draws later traces on top, so back-to-front is the reverse of GROUPS:
  // pass@1 at the back, then pass^5, with pass@5 on top. Legend keeps GROUPS
  // order (separate marker-only traces). Mirrors DRAW_ORDER in build_widget.py.
  var DRAW_ORDER = GROUPS.slice().reverse();
  var TOOLS = ['none', 'tool', 'unclear'];
  var INK = '#4d5560', SPINE = '#cfcfcf', GRID = '#ececec', NEUTRAL = '#8a8a8a';
  var FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';
  var HEIGHT = 520;
  var ZB_RELEASE = '2025-02-13';
  var ZB_RELEASE_LABEL_Y = 50;
  var HUMAN_BASELINE = 30;
  // Type scale and plot margins (mirrored by build_widget.py).
  var FS_BASE = 17, FS_AXIS = 19, FS_LEGEND = 16, FS_ANNOT = 16, FS_HOVER = 14;
  var MARGIN = { t: 16, r: 12, b: 70, l: 74 };
  // Legend geometry. Plotly has no multi-column vertical legend, so column two
  // is a second legend object (layout.legend2), offset by the width of column
  // one. LEGEND_SAMPLE_W + LEGEND_PAD approximate plotly's padding around an
  // entry's marker sample and label for the first paint; alignLegendColumns()
  // then snaps the offset to the box plotly actually drew.
  var LEGEND_X = 0.012, LEGEND_SAMPLE_W = 44, LEGEND_PAD = 12, LEGEND_COL_GAP = 10;

  var state = { view: 'date', official: true, reported: true, split: 'main' };

  // The reveal (see runSweep below) runs three passes over the plot: the
  // reference frame first, then the field of results, then the trend lines
  // traced through it. The full version plays once, when the chart is first
  // scrolled to; changing a control replays it fast enough to read as a
  // transition rather than as an animation to sit through.
  var REFS_MS = 500, DOTS_MS = 2000, LINES_MS = 2000;
  var QUICK_REFS_MS = 0, QUICK_DOTS_MS = 380, QUICK_LINES_MS = 320;
  // refs: how many leading traces are reference lines. run: increments per
  // sweep so a replay supersedes any loop still in flight instead of the two
  // fighting over the same nodes.
  var sweep = { refs: 0, run: 0, done: false, armed: false };

  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function pts(ds, view, split) {
    var x = VIEWS[view].x;
    return POINTS.filter(function (p) {
      return p.ds === ds && p.split === split && p[x] != null;
    });
  }

  function hasData(ds, view, split) { return pts(ds, view, split).length > 0; }

  function isNarrow() { return chartEl.clientWidth > 0 && chartEl.clientWidth < 640; }

  // Plot-area width in layout px; legend x is a fraction of it.
  function plotWidth() {
    return Math.max(280, (chartEl.clientWidth || 900) - MARGIN.l - MARGIN.r);
  }

  // Two legend columns in every view (so the legend keeps one shape as views
  // change), except the narrow layout, which lays the legend out horizontally.
  function twoColumn() { return !isNarrow(); }

  // The plotly legend a trace belongs to. Column two collapses into column one
  // when the legend is not split.
  function legendSlot(col) { return col === 2 && twoColumn() ? 'legend2' : 'legend'; }

  var measureCanvas;
  function textWidth(text, size) {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    var ctx = measureCanvas.getContext('2d');
    ctx.font = size + 'px ' + FONT;
    return ctx.measureText(text).width;
  }

  // Width of legend column one, measured over every label and group title it
  // can ever hold rather than the current view's, so the first paint clears the
  // widest case; alignLegendColumns() then tightens it to what plotly drew.
  function legendColumnOneWidth() {
    var w = 0;
    GROUPS.concat(GROUPS.map(function (g) { return g + ' (SOTA)'; }),
                  ['Pareto frontier', 'Human baseline (30%)'])
      .forEach(function (label) {
        w = Math.max(w, LEGEND_SAMPLE_W + textWidth(label, FS_LEGEND));
      });
    ['Official'].forEach(function (title) {
      w = Math.max(w, textWidth(title, FS_LEGEND) + LEGEND_PAD);
    });
    return w + LEGEND_PAD;
  }

  function isoToday() {
    var d = new Date();
    function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function markerFor(ds, tool, group) {
    var c = METRIC_COLOR[group];
    if (ds === 'official') {
      return { size: 9, color: c, symbol: 'circle', line: { width: 1, color: 'DarkSlateGrey' } };
    }
    if (tool === 'tool') {
      return { size: 9.5, color: 'rgba(255,255,255,0.85)', symbol: 'diamond', line: { width: 2, color: c } };
    }
    if (tool === 'unclear') {
      return { size: 8, color: c, symbol: 'square-open', line: { width: 1.6, color: c } };
    }
    return { size: 8, color: 'rgba(255,255,255,0.85)', symbol: 'circle', line: { width: 1.8, color: c } };
  }

  // Running-max step lines over visible no-tool points, extended to today.
  function sotaTraces(view, split, today) {
    var traces = [];
    DRAW_ORDER.forEach(function (group) {
      // Official runs only, so the Official legend heading these sit under is
      // literally true. A third-party number beating the field no longer moves
      // the line - it is drawn as a point and left to speak for itself.
      var sel = [];
      if (state.official) {
        pts('official', view, split).forEach(function (p) {
          if (p.group === group && p.tool === 'none') sel.push(p);
        });
      }
      if (sel.length < 2) return;
      sel.sort(function (a, b) { return a.date_jit < b.date_jit ? -1 : 1; });
      var xs = [], ys = [], max = -Infinity;
      sel.forEach(function (p) {
        max = Math.max(max, p.score);
        xs.push(p.date_jit); ys.push(max);
      });
      xs.push(today); ys.push(max);
      traces.push({
        x: xs, y: ys, mode: 'lines', name: group + ' (SOTA)',
        line: { shape: 'hv', color: METRIC_COLOR[group], width: 2.2 },
        opacity: 0.95, legendgroup: 'official',
        legendgrouptitle: { text: 'SOTA (no tools)' },
        // Drawn back-to-front, but listed in GROUPS order like the Score
        // entries below it.
        legendrank: 10 + GROUPS.indexOf(group),
        legendgrouptitle: { text: 'Official' },
        legend: legendSlot(1),
        hoverinfo: 'skip'
      });
    });
    return traces;
  }

  // Data extent of a log view in log10 units, error bars included, padded a
  // quarter-decade each side. Used for both the axis range and the frontier's
  // right-edge extension.
  function logRange(view, split) {
    var spec = VIEWS[view], xkey = spec.x, vals = [];
    ['official', 'reported'].forEach(function (ds) {
      if (!state[ds]) return;
      pts(ds, view, split).forEach(function (p) {
        vals.push(p[xkey]);
        if (spec.err) {
          var lo = p[spec.err[0]], hi = p[spec.err[1]];
          if (lo != null && lo > 0) vals.push(lo);
          if (hi != null) vals.push(hi);
        }
      });
    });
    if (!vals.length) return null;
    return {
      lo: Math.log10(Math.min.apply(null, vals)) - 0.25,
      hi: Math.log10(Math.max.apply(null, vals)) + 0.25
    };
  }

  // Lower-cost / higher-score frontier per metric (no-tool points), drawn
  // steps-post and extended to the right edge of the plot.
  function paretoTraces(view, split) {
    var xkey = VIEWS[view].x, traces = [];
    var range = logRange(view, split);
    var xRight = range ? Math.pow(10, range.hi) : null;
    DRAW_ORDER.forEach(function (group) {
      // Official runs only, as with the SOTA lines above.
      var sel = [];
      if (state.official) {
        pts('official', view, split).forEach(function (p) {
          if (p.group === group && p.tool === 'none') sel.push(p);
        });
      }
      if (sel.length < 2) return;
      sel.sort(function (a, b) { return a[xkey] - b[xkey]; });
      var xs = [], ys = [], best = -Infinity;
      sel.forEach(function (p) {
        if (p.score > best) { best = p.score; xs.push(p[xkey]); ys.push(p.score); }
      });
      if (xs.length < 2) return;
      if (xRight != null) { xs.push(xRight); ys.push(best); }
      traces.push({
        x: xs, y: ys, mode: 'lines', showlegend: false,
        line: { shape: 'hv', color: METRIC_COLOR[group], width: 2, dash: 'dash' },
        opacity: 0.9, legendgroup: 'trend', hoverinfo: 'skip'
      });
    });
    if (traces.length) {
      traces.push({
        x: [null], y: [null], mode: 'lines', name: 'Pareto frontier',
        line: { color: NEUTRAL, width: 2, dash: 'dash' },
        legendgroup: 'official', legendrank: 20,
        legendgrouptitle: { text: 'Official' },
        legend: legendSlot(1),
        hoverinfo: 'skip'
      });
    }
    return traces;
  }

  // Visible x extent: the date range buildLayout sets (data padded two weeks
  // each side, extended to today), or the log range in linear units.
  function xSpan(view, split, today) {
    if (VIEWS[view].type === 'date') {
      var dates = [];
      ['official', 'reported'].forEach(function (ds) {
        if (!state[ds]) return;
        pts(ds, view, split).forEach(function (p) { dates.push(p.date_jit); });
      });
      if (!dates.length) return null;
      dates.sort();
      var lo = new Date(dates[0]); lo.setDate(lo.getDate() - 14);
      var hi = new Date(today); hi.setDate(hi.getDate() + 14);
      return [lo.toISOString().slice(0, 10), hi.toISOString().slice(0, 10)];
    }
    var lr = logRange(view, split);
    return lr ? [Math.pow(10, lr.lo), Math.pow(10, lr.hi)] : null;
  }

  // Reference lines, drawn beneath everything: the ZeroBench release date
  // (date views; labelled by a layout annotation) and the human baseline.
  function refTraces(view, split, today) {
    var span = xSpan(view, split, today);
    if (!span) return [];
    var traces = [];
    if (VIEWS[view].type === 'date') {
      traces.push({
        x: [ZB_RELEASE, ZB_RELEASE], y: [-4, 100], mode: 'lines',
        line: { color: NEUTRAL, width: 1.5, dash: 'dash' },
        showlegend: false, hoverinfo: 'skip'
      });
    }
    traces.push({
      x: span, y: [HUMAN_BASELINE, HUMAN_BASELINE], mode: 'lines',
      name: 'Human baseline (30%)',
      line: { color: NEUTRAL, width: 2, dash: 'dot' },
      legendgroup: 'official', legendrank: 2000,
      legendgrouptitle: { text: 'Official' },
      legend: legendSlot(1),
      hoverinfo: 'skip'
    });
    return traces;
  }

  // Layering relies on trace insertion order (reference lines, then trend
  // lines, then reported, then official markers): trace zorder stops plotly
  // from drawing the axis box.
  function buildTraces(today) {
    var view = state.view, split = state.split;
    var spec = VIEWS[view], x = spec.x;
    var traces = refTraces(view, split, today);
    var present = { groups: {}, tools: {}, ds: {} };

    // How many traces the reference lines took. Plotly keeps one g.trace per
    // trace, in trace order, so this is all the sweep needs to tell the frame
    // it draws first (release marker, human baseline) from the trend lines it
    // draws last - without matching on serialised stroke colours.
    sweep.refs = traces.length;
    if (view === 'date') traces = traces.concat(sotaTraces(view, split, today));
    if (spec.frontier) traces = traces.concat(paretoTraces(view, split));

    // Both actually on screen, not merely both toggled on: a dataset with no
    // data in this view contributes nothing to compare against.
    var bothShown = state.official && state.reported &&
                    hasData('official', view, split) && hasData('reported', view, split);

    ['reported', 'official'].forEach(function (ds) {
      if (!state[ds]) return;
      DRAW_ORDER.forEach(function (group) {
        TOOLS.forEach(function (tool) {
          var sel = pts(ds, view, split).filter(function (p) {
            return p.group === group && p.tool === tool;
          });
          if (!sel.length) return;
          if (ds === 'official') present.groups[group] = true;
          present.ds[ds] = true;
          if (ds === 'reported' && tool !== 'none') present.tools[tool] = true;
          var trace = {
            x: sel.map(function (p) { return p[x]; }),
            y: sel.map(function (p) { return p.score; }),
            mode: 'markers',
            marker: markerFor(ds, tool, group),
            customdata: sel.map(function (p) { return p.tt; }),
            hovertemplate: '%{customdata}<extra></extra>',
            showlegend: false
          };
          if (ds === 'reported' && bothShown) trace.opacity = REPORTED_DIM;
          if (spec.err && ds === 'official') {
            var lo = spec.err[0], hi = spec.err[1];
            trace.error_x = {
              type: 'data', symmetric: false,
              array: sel.map(function (p) { return p[hi] != null ? p[hi] - p[x] : 0; }),
              arrayminus: sel.map(function (p) { return p[lo] != null ? p[x] - p[lo] : 0; }),
              color: rgba(METRIC_COLOR[group], 0.85), thickness: 1.4, width: 4
            };
          }
          traces.push(trace);
        });
      });
    });

    // The legend splits by provenance. Column one is our own: the SOTA lines,
    // then the scores they are derived from - one filled swatch per metric, so
    // the colour key lives here rather than in a group of its own - then the
    // human baseline. Column two is third-party, where the only thing left to
    // distinguish is tool use, so those entries are named for that.
    GROUPS.forEach(function (group) {
      if (!present.groups[group]) return;
      traces.push({
        x: [null], y: [null], mode: 'markers',
        marker: { size: 9, color: METRIC_COLOR[group], symbol: 'circle', line: { width: 1, color: 'DarkSlateGrey' } },
        name: group, legendgroup: 'official',
        legendrank: 30 + GROUPS.indexOf(group),
        legendgrouptitle: { text: 'Official' },
        legend: legendSlot(1), hoverinfo: 'skip'
      });
    });
    var pointEntries = [];
    if (present.ds.reported) {
      pointEntries.push(['No tools', { size: 8, color: '#ffffff', symbol: 'circle', line: { width: 1.8, color: NEUTRAL } }]);
    }
    if (present.tools.tool) {
      pointEntries.push(['Tool-assisted', { size: 9.5, color: '#ffffff', symbol: 'diamond', line: { width: 2, color: NEUTRAL } }]);
    }
    if (present.tools.unclear) {
      pointEntries.push(['Tools unclear', { size: 8, color: NEUTRAL, symbol: 'square-open', line: { width: 1.6, color: NEUTRAL } }]);
    }
    pointEntries.forEach(function (e) {
      traces.push({
        x: [null], y: [null], mode: 'markers', marker: e[1],
        name: e[0], legendgroup: 'reported',
        legendgrouptitle: { text: 'Externally reported' },
        legend: legendSlot(2), hoverinfo: 'skip'
      });
    });
    return traces;
  }

  function fmtUsd(v) {
    if (v >= 1) return '$' + v;
    return '$' + v.toFixed(Math.max(0, -Math.floor(Math.log10(v)))).replace(/0+$/, '').replace(/\.$/, '');
  }

  function fmtTok(v) { return v >= 1000 ? (v / 1000) + 'k' : String(v); }

  function logTicks(view, split, fmt) {
    var xkey = VIEWS[view].x, vals = [];
    ['official', 'reported'].forEach(function (ds) {
      if (!state[ds]) return;
      pts(ds, view, split).forEach(function (p) {
        vals.push(p[xkey]);
        if (VIEWS[view].err) {
          var lo = p[VIEWS[view].err[0]];
          if (lo != null && lo > 0) vals.push(lo);
        }
      });
    });
    if (!vals.length) return null;
    var lo = Math.floor(Math.log10(Math.min.apply(null, vals)));
    var hi = Math.ceil(Math.log10(Math.max.apply(null, vals)));
    var tickvals = [], ticktext = [];
    for (var e = lo; e <= hi; e++) {
      var v = Math.pow(10, e);
      tickvals.push(v);
      ticktext.push(fmt === 'usd' ? fmtUsd(v) : fmtTok(v));
    }
    return { tickvals: tickvals, ticktext: ticktext };
  }

  function buildLayout(today, empty) {
    var view = VIEWS[state.view];
    var axisBase = {
      showline: true, linecolor: SPINE, mirror: true, zeroline: false,
      ticks: '', gridcolor: GRID, gridwidth: 1,
      title: { font: { size: FS_AXIS, color: INK } }
    };
    var xaxis = Object.assign({}, axisBase, { title: { text: view.title, font: { size: FS_AXIS, color: INK } } });
    if (view.type === 'date') {
      xaxis.type = 'date';
      xaxis.gridcolor = '#f4f4f4';
      var span = xSpan(state.view, state.split, today);
      if (span) xaxis.range = span;
    } else {
      xaxis.type = 'log';
      var lr = logRange(state.view, state.split);
      if (lr) xaxis.range = [lr.lo, lr.hi];
      var ticks = logTicks(state.view, state.split, view.fmt);
      if (ticks) {
        xaxis.tickvals = ticks.tickvals;
        xaxis.ticktext = ticks.ticktext;
      }
    }
    var legendBase = {
      orientation: 'v', xanchor: 'left', y: 0.99, yanchor: 'top',
      bgcolor: 'rgba(255,255,255,0.95)', bordercolor: '#e3e3e3', borderwidth: 1,
      tracegroupgap: 4,
      // The groups exist to caption the legend by provenance, not to gang the
      // traces together. Plotly's default is togglegroup, which would have a
      // click on the human baseline take the three SOTA lines down with it.
      groupclick: 'toggleitem',
      font: { size: FS_LEGEND }, grouptitlefont: { size: FS_LEGEND, color: INK }
    };
    var layout = {
      height: HEIGHT,
      font: { family: FONT, size: FS_BASE, color: INK },
      paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
      xaxis: xaxis,
      yaxis: Object.assign({}, axisBase, {
        title: { text: 'ZeroBench score (%)', font: { size: FS_AXIS, color: INK } },
        range: [-4, 100], dtick: 20
      }),
      hovermode: 'closest',
      hoverlabel: { bgcolor: '#ffffff', bordercolor: SPINE, font: { family: FONT, size: FS_HOVER, color: '#333333' } },
      margin: Object.assign({}, MARGIN),
      legend: isNarrow()
        ? { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: FS_LEGEND - 1 } }
        : Object.assign({}, legendBase, { x: LEGEND_X }),
      annotations: []
    };
    if (twoColumn()) {
      layout.legend2 = Object.assign({}, legendBase, {
        x: LEGEND_X + (legendColumnOneWidth() + LEGEND_COL_GAP) / plotWidth()
      });
    }
    if (view.type === 'date' && xaxis.range) {
      // Mid-height, not at the top of the line: on views whose x range starts
      // near the release date (reported-only, say) the line passes behind the
      // top-left legend, and a label at the top lands on top of it. Nothing is
      // plotted this high near February 2025, so 50 is clear in every view.
      layout.annotations.push({
        text: 'ZeroBench release', x: ZB_RELEASE, y: ZB_RELEASE_LABEL_Y,
        showarrow: false, xanchor: 'left', xshift: 5,
        font: { size: FS_ANNOT, color: NEUTRAL }
      });
    }
    if (empty) {
      layout.annotations.push({
        text: state.official || state.reported ? 'No data for this combination' : 'Select at least one dataset',
        xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false,
        font: { size: 18, color: '#7a7a7a' }
      });
    }
    return layout;
  }

  // legendColumnOneWidth() only has to get the first paint safely clear of
  // column one; once plotly has drawn the box we know its real width, so pull
  // column two onto it exactly. This runs inside the same task as the react()
  // above, so the move is painted, not flashed, and cannot loop: shifting
  // column two never changes column one's width.
  function alignLegendColumns(layout) {
    if (!layout.legend2) return;
    var bg = chartEl.querySelector('g.legend > rect.bg');
    if (!bg) return;
    var w = parseFloat(bg.getAttribute('width'));
    if (!(w > 0)) return;
    var want = LEGEND_X + (w + LEGEND_COL_GAP) / plotWidth();
    if (Math.abs(want - layout.legend2.x) > 2 / plotWidth()) {
      window.Plotly.relayout(chartEl, { 'legend2.x': want });
    }
  }

  // ======================== SOTA sweep ========================
  // The date view's step lines draw themselves in left to right, once per page
  // load. Because the lines are shape:'hv', the sweep pauses on every riser -
  // one beat per model that took the record - then glides flat to today, which
  // is the point the chart is making anyway.
  //
  // Done by tweening stroke-dashoffset on the paths plotly already rendered,
  // not with plotly frames: frames would re-render all ~300 markers per tick.

  function reducedMotion() {
    return !!(window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Every rendered line, in trace order, looked up fresh: it does not matter
  // how many times the chart was rebuilt between arming and firing. Marker
  // traces carry no js-line, so this is exactly the reference lines followed by
  // whichever trend lines the current view draws - SOTA steps in the date view,
  // Pareto frontiers in the log views.
  function linePaths() {
    var groups = chartEl.querySelectorAll('g.scatterlayer > g.trace');
    var out = [];
    for (var i = 0; i < groups.length; i++) {
      var el = groups[i].querySelector('path.js-line');
      if (el && el.getTotalLength) out.push(el);
    }
    return out;
  }

  // The frame drawn first, and the trend lines drawn last.
  function refPaths() { return linePaths().slice(0, sweep.refs); }
  function trendPaths() { return linePaths().slice(sweep.refs); }

  // The lines are revealed by clipping them to everything left of the
  // wavefront, never by tweening stroke-dasharray. Plotly carries meaning in
  // that property - the human baseline is dotted, the Pareto frontiers dashed,
  // and the legend samples show exactly that - so borrowing it for a draw-on
  // overwrites the encoding, and clearing it afterwards leaves those lines
  // solid with the legend still claiming otherwise. A clip rect touches no
  // styling at all, and since every line here is monotonic in x it reads
  // identically to a draw-on: the step risers still snap up as the edge
  // reaches their date.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var wipeRect = null;
  var WIPE_ID = 'zb-sweep-wipe';

  // Sized far past the plot in y; only the x edge does any work.
  function wipeClip() {
    var layer = chartEl.querySelector('g.scatterlayer');
    if (!layer) return null;
    if (!wipeRect || !wipeRect.isConnected || !layer.contains(wipeRect)) {
      var defs = document.createElementNS(SVG_NS, 'defs');
      defs.setAttribute('class', 'zb-sweep-defs');
      var clip = document.createElementNS(SVG_NS, 'clipPath');
      clip.setAttribute('id', WIPE_ID);
      clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      wipeRect = document.createElementNS(SVG_NS, 'rect');
      wipeRect.setAttribute('x', -1e4);
      wipeRect.setAttribute('y', -1e4);
      wipeRect.setAttribute('height', 2e4);
      wipeRect.setAttribute('width', 0);
      clip.appendChild(wipeRect);
      defs.appendChild(clip);
      layer.appendChild(defs);
    }
    return wipeRect;
  }

  // Every line, not just the current run's trend paths. Which lines count as
  // reference and which as trend depends on the view - the date view has two
  // reference traces, the log views one - so a path clipped by a superseded run
  // can land on the other side of that split and never be cleared. Left behind,
  // its clip-path points at removed defs, and an unresolvable clip reference
  // means the element is not rendered at all: a line silently disappears.
  function clearClips() {
    linePaths().forEach(function (el) { el.style.clipPath = ''; });
  }

  function clearWipe() {
    var defs = chartEl.querySelectorAll('defs.zb-sweep-defs');
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].parentNode) defs[i].parentNode.removeChild(defs[i]);
    }
    wipeRect = null;
  }

  // Rings live in a group of their own inside the scatter layer, so they share
  // the trace coordinate system exactly and are clipped to the plot area like
  // everything else. Plotly owns that subtree and may replace it, hence the
  // re-attach check the rest of the sweep also uses.
  var ringHost = null;

  function ringLayer() {
    var layer = chartEl.querySelector('g.scatterlayer');
    if (!layer) return null;
    if (!ringHost || !ringHost.isConnected || ringHost.parentNode !== layer) {
      ringHost = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ringHost.setAttribute('class', 'zb-sota-rings');
      ringHost.setAttribute('pointer-events', 'none');
      layer.appendChild(ringHost);
    }
    return ringHost;
  }

  // Sweeps the whole chart rather than one run's own rings: a superseded run
  // returns without cleaning up after itself, so a replay has to be willing to
  // collect what the run it replaced left behind.
  function clearRings() {
    var hosts = chartEl.querySelectorAll('g.zb-sota-rings');
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].parentNode) hosts[i].parentNode.removeChild(hosts[i]);
    }
    ringHost = null;
  }

  // Every point where a step line steps up, i.e. every model that took the
  // record. Read by walking the path commands rather than sampling it: plotly
  // writes these as H/V pairs, so the corners are exact, and a riser only two
  // pixels tall would fall between arc-length samples.
  function risersOf(el) {
    var d = el.getAttribute('d') || '';
    var toks = d.match(/[MHVL][^MHVL]*/g) || [];
    var x = 0, y = 0, out = [];
    for (var i = 0; i < toks.length; i++) {
      var c = toks[i][0];
      var n = (toks[i].slice(1).match(/-?[\d.]+/g) || []).map(Number);
      if (c === 'M' || c === 'L') { x = n[0]; y = n[1]; }
      else if (c === 'H') { x = n[0]; }
      else if (c === 'V') {
        // Pixel y decreasing is score increasing.
        if (n[0] < y - 0.01) out.push({ x: x, y: n[0] });
        y = n[0];
      }
    }
    return out;
  }

  // Every rendered marker with the x plotly positioned it at. Read off the
  // transform rather than the trace arrays, so nothing depends on DOM order
  // matching data order across the dataset x metric x tool trace split.
  function markerEntries() {
    var pts = chartEl.querySelectorAll('g.scatterlayer > g.trace path.point');
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var m = /translate\(\s*([-\d.]+)/.exec(pts[i].getAttribute('transform') || '');
      if (!m) continue;
      // plotly sets opacity inline, so the reveal restores that value rather
      // than clearing the property and dropping plotly's own styling. A zero
      // read back is the sweep's own hide on a reused node, never something to
      // restore a marker to.
      var o = pts[i].style.opacity;
      var keep = parseFloat(o) > 0 ? o : '1';
      out.push({ el: pts[i], x: parseFloat(m[1]), o: keep, target: parseFloat(keep) || 1 });
    }
    out.sort(function (a, b) { return a.x - b.x; });
    return out;
  }

  // Driven frame by frame rather than handed to CSS transitions, because plotly
  // re-asserts its own styling (marker opacity, and the clip it puts on trace
  // groups) on any redraw it decides to do - a responsive resize, the legend
  // relayout. That silently cancels a reveal set up once at the start. Writing
  // the state every frame heals it within 16ms, and re-reading the nodes keeps
  // it correct if a redraw swaps them or changes their geometry.
  function runSweep(refsMs, dotsMs, linesMs) {
    // Rings are the payoff of the line pass, so they are timed off it; on a
    // replay that keeps them brisk rather than leaving them hanging.
    var ringMs = Math.max(260, linesMs * 0.8);
    var myRun = ++sweep.run;
    var marks, lo, hi, fade, sig, dots, cursor, rings, nLines;

    // Everything the sweep needs from the current geometry. Re-derivable in
    // full, because the plot can be re-laid-out underneath a running sweep -
    // activating the tab resizes it from the fallback width, and a window
    // resize rebuilds it outright. Holding lo/hi from the first frame would
    // strand the wavefront at the old right edge and pop the rest of the lines
    // in at the end; stale marker x would reveal dots against the old scale.
    function measure() {
      var live = trendPaths();
      marks = markerEntries();
      nLines = live.length;
      lo = Infinity;
      hi = -Infinity;
      sig = 0;
      live.forEach(function (el) {
        // getBBox is the whole span the clip has to travel, and doubles as the
        // change detector that catches a re-layout under a running sweep.
        var b = el.getBBox();
        if (!(b.width >= 0)) return;
        lo = Math.min(lo, b.x);
        hi = Math.max(hi, b.x + b.width);
        sig += b.x + b.width;
      });
      marks.forEach(function (m) { lo = Math.min(lo, m.x); hi = Math.max(hi, m.x); });
      // Each dot fades over a short band of the sweep instead of popping, so
      // 300 of them read as a field filling in rather than as flicker. The band
      // leads the front rather than trailing it - a dot is at full strength by
      // the time the wavefront reaches its date - which is also what lets the
      // sweep end exactly at the last dot instead of needing a run-out.
      fade = Math.max(24, (hi - lo) * 0.05);
      dots = marks.length > 0;
      cursor = 0;
      // Rings are pinned to pixel positions, so a re-layout invalidates any
      // already in flight; drop them and take the corners of the new geometry.
      clearRings();
      rings = [];
      live.forEach(function (el) {
        var colour = el.style.stroke || el.getAttribute('stroke') || NEUTRAL;
        risersOf(el).forEach(function (r) {
          rings.push({ x: r.x, y: r.y, colour: colour, born: -1, el: null });
        });
      });
    }

    clearRings();
    clearClips();
    clearWipe();
    measure();
    if (!(hi > lo) || (!dots && !nLines)) return;

    // Every pass starts from nothing, here as well as in the loop, so the first
    // frame cannot flash the chart fully drawn.
    marks.forEach(function (m) { m.el.style.opacity = '0'; });
    applyWipe(trendPaths(), lo);
    if (refsMs > 0) refPaths().forEach(function (el) { el.style.opacity = '0'; });

    var t0 = null;

    // Clip everything right of the wavefront. The rect is shared, so this only
    // has to point each line at it and set the one edge that moves.
    function applyWipe(live, front) {
      var rect = live.length ? wipeClip() : null;
      if (!rect) return;
      rect.setAttribute('width', Math.max(0, front + 1e4));
      live.forEach(function (el) { el.style.clipPath = 'url(#' + WIPE_ID + ')'; });
    }

    // Position of a wavefront that has run p of the way across the plot.
    function frontAt(p) {
      return lo + (hi - lo) * (p * p * (3 - 2 * p));
    }

    function ease(p) { return p * p * (3 - 2 * p); }

    function restore() {
      marks.forEach(function (m) { m.el.style.opacity = m.o; });
      refPaths().forEach(function (el) { el.style.opacity = ''; });
      clearClips();
      clearRings();
      clearWipe();
    }

    function frame(now) {
      // A newer sweep has taken over the same nodes; leave them to it, and in
      // particular do not run restore() out from under it.
      if (myRun !== sweep.run) return;
      if (t0 === null) t0 = now;
      var e = now - t0;

      // Re-measure on any sign the plot was rebuilt under us: a different set
      // of lines, a change in their total length, or marker nodes that have
      // been detached and replaced.
      var live = trendPaths();
      var nowSig = live.reduce(function (a, el) {
        var b = el.getBBox();
        return a + b.x + b.width;
      }, 0);
      if (live.length !== nLines || Math.abs(nowSig - sig) > 1 ||
          (dots && !marks[0].el.isConnected)) {
        measure();
        live = trendPaths();
        if (!(hi > lo)) { restore(); return; }
      }

      // Three passes over the same span, back to back: the frame the results
      // are to be read against, then the field of results, then the trend
      // traced through it. Each is held at nothing for the whole of the passes
      // before it by its front sitting at lo, which the loops below re-assert
      // every frame anyway.
      var pRefs = refsMs > 0 ? Math.min(1, e / refsMs) : 1;
      var frontDots = frontAt(Math.min(1, Math.max(0, e - refsMs) / dotsMs));
      var frontLines = frontAt(Math.min(1, Math.max(0, e - refsMs - dotsMs) / linesMs));

      // The reference lines set the stakes before anything is plotted against
      // them: the human baseline the scores are measured against, and the
      // release marker. They fade rather than wipe - one is vertical, so a
      // left-to-right edge would snap it in whole, and fading is the one reveal
      // that leaves their dotted and dashed patterns alone.
      if (refsMs > 0) {
        var a = ease(pRefs);
        refPaths().forEach(function (el) {
          el.style.opacity = a >= 1 ? '' : a;
        });
      }

      // Markers get the same treatment as the lines, and for the same reason:
      // plotly re-asserts marker opacity on redraw, so hiding them once at the
      // start does not hold. Everything from the cursor rightwards is written
      // every frame - the cursor only ever moves forward, so the work shrinks
      // as the front advances.
      if (dots) {
        while (cursor < marks.length && marks[cursor].x <= frontDots) {
          marks[cursor].el.style.opacity = marks[cursor].o;
          cursor++;
        }
        for (var j = cursor; j < marks.length; j++) {
          var d = marks[j].x - frontDots;
          // Up to the point's own final opacity, not a flat 1. Plotly happens
          // to hang the reported dimming off the trace group, which multiplies
          // through on its own, but a per-marker opacity would otherwise have
          // the dot reach full strength and drop as the cursor restored it.
          marks[j].el.style.opacity = d < fade ? (1 - d / fade) * marks[j].target : 0;
        }
      }

      applyWipe(live, frontLines);

      // A ring where the trend steps up - one per model that took the record.
      // Born as the line front reaches it, so the ring and the step land
      // together, then expanding and fading out of the way.
      var host = rings.length ? ringLayer() : null;
      for (var k = 0; k < rings.length; k++) {
        var ring = rings[k];
        if (ring.born < 0) {
          if (ring.x > frontLines) continue;
          ring.born = e;
        }
        var age = (e - ring.born) / ringMs;
        if (age >= 1) {
          if (ring.el && ring.el.parentNode) ring.el.parentNode.removeChild(ring.el);
          ring.el = null;
          continue;
        }
        if (!ring.el && host) {
          ring.el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          ring.el.setAttribute('cx', ring.x);
          ring.el.setAttribute('cy', ring.y);
          ring.el.setAttribute('fill', 'none');
          ring.el.setAttribute('stroke', ring.colour);
          host.appendChild(ring.el);
        }
        if (ring.el) {
          if (!ring.el.isConnected && host) host.appendChild(ring.el);
          var g = ease(age);
          ring.el.setAttribute('r', 2.5 + 20 * g);
          ring.el.setAttribute('stroke-width', 2.2 * (1 - g) + 0.4);
          ring.el.setAttribute('opacity', 0.85 * (1 - age) * (1 - age));
        }
      }

      if (e < refsMs + dotsMs + linesMs + ringMs) requestAnimationFrame(frame);
      else restore();   // setting opacity on detached nodes is a no-op
    }
    requestAnimationFrame(frame);
  }

  // Armed on the first render that produced step lines, fired when the chart
  // reaches the viewport: it sits below the masthead, so playing on load would
  // spend the animation before anyone had scrolled to it. A chart in a hidden
  // tab panel never intersects, so this also waits out a deep link into
  // another tab rather than needing a visibility check of its own.
  function armSweep() {
    if (sweep.done || sweep.armed) return;
    if (reducedMotion() || !window.IntersectionObserver) {
      sweep.done = true;
      return;
    }
    sweep.armed = true;
    var io = new IntersectionObserver(function (entries) {
      var visible = entries.some(function (e) { return e.isIntersecting; });
      if (!visible) return;
      io.disconnect();
      sweep.armed = false;
      sweep.done = true;
      // Two frames of slack: alignLegendColumns' relayout, and any resize the
      // tab switch that revealed the panel kicked off, land first.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { runSweep(REFS_MS, DOTS_MS, LINES_MS); });
      });
    }, { threshold: 0.25 });
    io.observe(chartEl);
  }

  // Changing a control rebuilds the plot, so the new points and lines can come
  // in the same way the first ones did - fast enough to read as the transition
  // between two states rather than as an animation to sit through. Only from a
  // control, never from render() at large: a window resize also rebuilds, and
  // replaying on every resize tick would be seasickness.
  function replaySweep() {
    if (!sweep.done || reducedMotion()) return;
    requestAnimationFrame(function () {
      runSweep(QUICK_REFS_MS, QUICK_DOTS_MS, QUICK_LINES_MS);
    });
  }

  function render() {
    var today = isoToday();
    var traces = buildTraces(today);
    var hasMarkers = traces.some(function (t) { return t.mode === 'markers' && t.x[0] !== null; });
    var layout = buildLayout(today, !hasMarkers);
    window.Plotly.react(chartEl, traces, layout,
      { responsive: true, displaylogo: false });
    alignLegendColumns(layout);
    armSweep();
  }

  function syncControls() {
    document.querySelectorAll('#zb-results-widget .zb-pill[data-view]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.view === state.view);
      b.setAttribute('aria-pressed', b.dataset.view === state.view);
    });
    document.querySelectorAll('#zb-results-widget .zb-pill[data-split]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.split === state.split);
      b.setAttribute('aria-pressed', b.dataset.split === state.split);
    });
    document.querySelectorAll('#zb-results-widget .zb-chip[data-ds]').forEach(function (b) {
      var ds = b.dataset.ds;
      var available = hasData(ds, state.view, state.split);
      b.disabled = !available;
      b.title = available ? '' :
        (ds === 'reported' ? 'No measured cost/token data for reported results'
                           : 'No official data in this view');
      b.classList.toggle('is-on', state[ds] && available);
      b.setAttribute('aria-pressed', state[ds] && available);
    });
  }

  function bindControls() {
    document.querySelectorAll('#zb-results-widget .zb-pill[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.dataset.view; updateFromControl(); });
    });
    document.querySelectorAll('#zb-results-widget .zb-pill[data-split]').forEach(function (b) {
      b.addEventListener('click', function () { state.split = b.dataset.split; updateFromControl(); });
    });
    document.querySelectorAll('#zb-results-widget .zb-chip[data-ds]').forEach(function (b) {
      b.addEventListener('click', function () { state[b.dataset.ds] = !state[b.dataset.ds]; updateFromControl(); });
    });
    // Legend column two is positioned as a fraction of the plot width, so any
    // width change needs a rebuild (not just plotly's own responsive relayout)
    // to keep the pixel gap between the columns right. The first render is one
    // of them: this script runs while the tab panel is still display:none, so
    // the chart measures zero and the offset is computed against plotWidth()'s
    // fallback. Activating the panel then widens the plot without changing the
    // fraction, which is what left column two stranded to the right until some
    // later render - a view switch, say - recomputed it at the real width.
    // Observing the box catches that as just another resize.
    var lastWidth = chartEl.clientWidth, resizeTimer = null;
    function onResize() {
      var w = chartEl.clientWidth;
      // The panel opening is a one-off, not a drag: rebuild on the spot so the
      // chart is never on screen with the stranded column, and keep the
      // debounce for resizes that arrive in a stream.
      if (lastWidth <= 0 && w > 0) { lastWidth = w; render(); return; }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var now = chartEl.clientWidth;
        if (now > 0 && Math.abs(now - lastWidth) > 16) { lastWidth = now; render(); }
      }, 120);
    }
    if (window.ResizeObserver) new window.ResizeObserver(onResize).observe(chartEl);
    window.addEventListener('resize', onResize);
  }

  function update() { syncControls(); render(); }

  // What a control click calls: the same rebuild, then the quick reveal.
  function updateFromControl() { update(); replaySweep(); }

  function fallback() {
    var img = document.createElement('img');
    img.src = 'assets/figures/zb_results_fallback.png';
    img.alt = 'ZeroBench results over time';
    img.style.width = '100%';
    chartEl.replaceChildren(img);
    document.querySelectorAll('#zb-results-widget button').forEach(function (b) { b.disabled = true; });
  }

  // Plotly renders from the CDN script above this one, but it may still be in
  // flight; retry briefly before falling back to the static image.
  bindControls();
  syncControls();
  if (window.Plotly) {
    render();
  } else {
    var attempts = 0;
    var timer = setInterval(function () {
      if (window.Plotly) {
        clearInterval(timer); render();
      } else if (++attempts > 40) {
        clearInterval(timer); fallback();
      }
    }, 250);
  }
})();
