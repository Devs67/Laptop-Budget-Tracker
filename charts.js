/* ==========================================================================
   PaisaLedger - grouped bar chart renderer
   Dependency-free SVG. Theme-aware, responsive, keyboard/pointer tooltips.

   Usage:
     var chart = PaisaChart.bar("chart-id", { yLabel: "Rupees" });
     chart.setData({
       categories: ["Jul", "Aug", "Sep"],
       series: [
         { name: "Income",  color: "moss", values: [1200, 900, 1500] },
         { name: "Expense", color: "rust", values: [400, 650, 500] }
       ]
     });

   `color` is either a token name (moss|rust|blue|gold|ink|slate) resolved
   against the current theme, or any literal CSS color.
   ========================================================================== */

var PaisaChart = (function () {
  "use strict";

  var RUPEE = "₹";
  var SVG_NS = "http://www.w3.org/2000/svg";

  function fmtFull(n) {
    return RUPEE + Math.round(n || 0).toLocaleString("en-IN");
  }

  // Short axis labels: 1,50,000 -> ₹1.5L, 4,500 -> ₹4.5k
  function fmtShort(n) {
    n = Math.round(n || 0);
    var abs = Math.abs(n);
    var sign = n < 0 ? "-" : "";
    if (abs >= 10000000) return sign + RUPEE + trim(abs / 10000000) + "Cr";
    if (abs >= 100000) return sign + RUPEE + trim(abs / 100000) + "L";
    if (abs >= 1000) return sign + RUPEE + trim(abs / 1000) + "k";
    return sign + RUPEE + abs;
  }

  function trim(v) {
    return (Math.round(v * 10) / 10).toString();
  }

  function token(name) {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--" + name);
    return v ? v.trim() : name;
  }

  // Resolves a series colour: known token name, else a literal CSS colour.
  var TOKENS = { moss: 1, rust: 1, blue: 1, gold: 1, ink: 1, slate: 1, rule: 1, panel: 1 };
  function resolveColor(c) {
    return TOKENS[c] ? token(c) : c;
  }

  // Picks a "nice" axis maximum and step so gridlines land on round numbers.
  function niceScale(max, ticks) {
    if (!(max > 0)) return { max: 100, step: 25 };
    var raw = max / ticks;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    return { max: Math.ceil(max / step) * step, step: step };
  }

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  function bar(containerId, options) {
    var host = document.getElementById(containerId);
    if (!host) return { setData: function () {}, destroy: function () {} };

    options = options || {};
    var emptyText = options.emptyText || "Nothing to chart yet.";
    var height = options.height || 300;
    var formatValue = options.formatValue || fmtFull;
    var reduceMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    host.classList.add("chart-plot");

    var tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("data-show", "false");
    host.appendChild(tip);

    var data = { categories: [], series: [] };
    var hidden = {};
    var drawn = false;

    function activeSeries() {
      return data.series.filter(function (s) {
        return !hidden[s.name];
      });
    }

    function hideTip() {
      tip.setAttribute("data-show", "false");
    }

    function showTip(index, x, y) {
      var rows = activeSeries()
        .map(function (s) {
          return (
            '<div class="tip-row"><span class="tip-name">' +
            '<span class="swatch" style="background:' + resolveColor(s.color) + '"></span>' +
            escapeHtml(s.name) +
            '</span><span class="tip-val">' + formatValue(s.values[index] || 0) + "</span></div>"
          );
        })
        .join("");
      tip.innerHTML =
        '<div class="tip-label">' + escapeHtml(data.categories[index]) + "</div>" + rows;
      tip.setAttribute("data-show", "true");

      // Clamp horizontally so the tooltip never overflows the card.
      var hostW = host.clientWidth;
      var tipW = tip.offsetWidth;
      var half = tipW / 2;
      var cx = Math.min(Math.max(x, half + 4), hostW - half - 4);
      tip.style.left = cx + "px";
      tip.style.top = Math.max(y - 10, tipW ? 34 : 34) + "px";
    }

    function escapeHtml(str) {
      var d = document.createElement("div");
      d.textContent = str == null ? "" : String(str);
      return d.innerHTML;
    }

    function draw() {
      // Remove the previous SVG / empty state, keep the tooltip node.
      var stale = host.querySelectorAll("svg, .chart-empty");
      for (var i = 0; i < stale.length; i++) stale[i].remove();

      var series = activeSeries();
      var hasData = data.categories.length > 0 && series.length > 0;
      var anyValue = hasData && series.some(function (s) {
        return s.values.some(function (v) { return Number(v) > 0; });
      });

      if (!hasData || !anyValue) {
        hideTip();
        var empty = document.createElement("div");
        empty.className = "chart-empty";
        empty.textContent = emptyText;
        host.appendChild(empty);
        return;
      }

      var width = Math.max(host.clientWidth || 640, 280);
      var compact = width < 520;

      var padL = compact ? 46 : 58;
      var padR = 10;
      var padT = 12;
      var padB = 34;
      var plotW = width - padL - padR;
      var plotH = height - padT - padB;

      var maxValue = 0;
      series.forEach(function (s) {
        s.values.forEach(function (v) {
          if (Number(v) > maxValue) maxValue = Number(v);
        });
      });

      var tickCount = 4;
      var scale = niceScale(maxValue, tickCount);
      var yMax = scale.max;
      var toY = function (v) {
        return padT + plotH - (v / yMax) * plotH;
      };

      var svg = el("svg", {
        viewBox: "0 0 " + width + " " + height,
        width: width,
        height: height,
        role: "img",
        "aria-label": options.ariaLabel || "Bar chart"
      });

      var ruleColor = token("rule");
      var slateColor = token("slate");

      // --- gridlines + Y axis labels ---
      for (var t = 0; t <= tickCount; t++) {
        var value = (yMax / tickCount) * t;
        var y = toY(value);
        svg.appendChild(
          el("line", {
            x1: padL, y1: y, x2: width - padR, y2: y,
            stroke: ruleColor,
            "stroke-width": 1,
            "stroke-dasharray": t === 0 ? "none" : "3 3",
            opacity: t === 0 ? 0.9 : 0.55
          })
        );
        var label = el("text", {
          x: padL - 8, y: y + 4,
          "text-anchor": "end",
          fill: slateColor,
          "font-size": compact ? 10 : 11
        });
        label.textContent = fmtShort(value);
        svg.appendChild(label);
      }

      // --- bars, grouped per category ---
      var groupW = plotW / data.categories.length;
      var innerPad = Math.min(groupW * 0.22, 18);
      var bandW = groupW - innerPad;
      var barW = Math.max(bandW / series.length, 2);
      var radius = Math.min(barW / 2, 4);

      data.categories.forEach(function (cat, ci) {
        var groupX = padL + ci * groupW;
        var bandX = groupX + innerPad / 2;

        // Invisible hit area so the tooltip works anywhere in the column.
        var hit = el("rect", {
          x: groupX, y: padT, width: groupW, height: plotH,
          fill: "transparent"
        });
        hit.style.cursor = "pointer";
        hit.addEventListener("pointerenter", function () {
          showTip(ci, groupX + groupW / 2, padT);
        });
        hit.addEventListener("pointerleave", hideTip);
        svg.appendChild(hit);

        series.forEach(function (s, si) {
          var v = Number(s.values[ci]) || 0;
          if (v <= 0) return;
          var h = Math.max((v / yMax) * plotH, 2);
          var x = bandX + si * barW;
          var y = padT + plotH - h;
          var rect = el("rect", {
            class: "bar",
            x: x, y: y,
            width: Math.max(barW - 2, 1),
            height: h,
            rx: radius,
            fill: resolveColor(s.color)
          });
          rect.appendChild(
            (function () {
              var title = el("title", {});
              title.textContent = cat + " - " + s.name + ": " + formatValue(v);
              return title;
            })()
          );

          if (!reduceMotion && !drawn) {
            rect.style.transformOrigin = y + h + "px";
            rect.style.transform = "scaleY(0)";
            rect.style.transformBox = "fill-box";
            rect.style.transformOrigin = "bottom";
            requestAnimationFrame(function () {
              rect.style.transition = "transform 420ms cubic-bezier(0.23,1,0.32,1) " + ci * 28 + "ms";
              rect.style.transform = "scaleY(1)";
            });
          }
          svg.appendChild(rect);
        });

        // --- X axis label ---
        var xLabel = el("text", {
          x: groupX + groupW / 2,
          y: height - padB + 20,
          "text-anchor": "middle",
          fill: slateColor,
          "font-size": compact ? 10 : 11
        });
        xLabel.textContent = cat;
        svg.appendChild(xLabel);
      });

      host.appendChild(svg);
      drawn = true;
    }

    // --- legend wiring: a [data-chart-legend="<id>"] element toggles series ---
    function renderLegend() {
      var legend = document.querySelector('[data-chart-legend="' + containerId + '"]');
      if (!legend) return;
      legend.innerHTML = "";
      data.series.forEach(function (s) {
        var key = document.createElement("button");
        key.type = "button";
        key.className = "key";
        key.setAttribute("aria-pressed", hidden[s.name] ? "false" : "true");
        key.innerHTML =
          '<span class="swatch" style="background:' + resolveColor(s.color) + '"></span>' +
          escapeHtml(s.name);
        key.addEventListener("click", function () {
          // Never let the last visible series be switched off.
          if (!hidden[s.name] && activeSeries().length === 1) return;
          hidden[s.name] = !hidden[s.name];
          key.setAttribute("aria-pressed", hidden[s.name] ? "false" : "true");
          hideTip();
          draw();
        });
        legend.appendChild(key);
      });
    }

    var resizeTimer;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        hideTip();
        draw();
      }, 120);
    }
    window.addEventListener("resize", onResize);

    // Redraw on theme flips so bar/grid colours follow the tokens.
    var themeObserver = new MutationObserver(function () {
      renderLegend();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return {
      setData: function (next) {
        data = {
          categories: (next && next.categories) || [],
          series: (next && next.series) || []
        };
        renderLegend();
        draw();
      },
      redraw: draw,
      destroy: function () {
        window.removeEventListener("resize", onResize);
        themeObserver.disconnect();
      }
    };
  }

  return { bar: bar, formatINR: fmtFull, formatShort: fmtShort };
})();
