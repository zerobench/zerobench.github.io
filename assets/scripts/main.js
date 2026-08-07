//* ======================== Slide Control ===================== */
var slideMenu = document.getElementById("slide-menu");
if (slideMenu) {
  slideMenu.addEventListener("click", function(e) {
    const idx = [...this.children]
      .filter(el => el.classList.contains("dot")) // More robust class check
      .indexOf(e.target);

    if (idx >= 0) {
      var prev = document.querySelector(".dot.active");
      if (prev) prev.classList.remove("active");
      e.target.classList.add("active");

      for (var i = 0; i < contents.length; i++) {
        contents[i].style.display = (i === idx) ? "block" : "none";
      }
    }
  });
}

//* ======================== Video Control ===================== */
function ToggleVideo(x) {
  var videos = document.getElementsByClassName(x + '-video');
  for (var i = 0; i < videos.length; i++) {
      if (videos[i].paused) {
          videos[i].play();
      } else {
          videos[i].pause();
      }
  }
};


function SlowVideo(x) {
  var videos = document.getElementsByClassName(x + '-video');
  for (var i = 0; i < videos.length; i++) {
    videos[i].playbackRate = videos[i].playbackRate * 0.9;
    videos[i].play();
  }

  var msg = document.getElementById(x + '-msg');
  msg.innerHTML = 'Speed: ' + '×' + videos[0].playbackRate.toFixed(2);

  msg.classList.add("fade-in-out");
  msg.style.animation = 'none';
  msg.offsetHeight; /* trigger reflow */
  msg.style.animation = null; };


function FastVideo(x) {
  var videos = document.getElementsByClassName(x + '-video');
  for (var i = 0; i < videos.length; i++) {
    videos[i].playbackRate = videos[i].playbackRate / 0.9;
    videos[i].play();
  }

  var msg = document.getElementById(x + '-msg');
  msg.innerHTML = 'Speed: ' + '×' + videos[0].playbackRate.toFixed(2);

  msg.classList.add("fade-in-out");
  msg.style.animation = 'none';
  msg.offsetHeight; /* trigger reflow */
  msg.style.animation = null;
};

function RestartVideo(x) {
  var videos = document.getElementsByClassName(x + '-video');
  for (var i = 0; i < videos.length; i++) {
    videos[i].pause();
    videos[i].playbackRate = 1.0;
    videos[i].currentTime = 0;
    videos[i].play();
  }

  var msg = document.getElementById(x + '-msg');
  msg.innerHTML = 'Speed: ' + '×' + videos[0].playbackRate.toFixed(2);

  msg.classList.add("fade-in-out");
  msg.style.animation = 'none';
  msg.offsetHeight; /* trigger reflow */
  msg.style.animation = null;
};

//* ======================== Slide Show Control ===================== */
const slider = document.querySelector('.container .slider');
const [btnLeft, btnRight] = ['prev_btn', 'next_btn'].map(id => document.getElementById(id));
let interval;

// Set positions
const setPositions = () => {
    const firstItem = slider.querySelector('.slider-item');
    // offsetWidth is 0 while the slider sits in a display:none tab panel, which
    // would stack every slide at left:0 - fall back to the nominal width until
    // the panel is shown and setPositions runs again with a real measurement.
    const spacing = (firstItem && firstItem.offsetWidth) || 440;
    [...slider.children].forEach((item, i) =>
        item.style.left = `${(i-1) * spacing}px`);
};

// Initial setup
setPositions();

// Re-run once the slider's tab panel becomes visible; see the tab router.
window.zbSetPositions = setPositions;

// Set transition speed
const setTransitionSpeed = (speed) => {
    [...slider.children].forEach(item =>
        item.style.transitionDuration = speed);
};

// Slide functions
const next = (isAuto = false) => {
    setTransitionSpeed(isAuto ? '1.5s' : '0.2s');
    slider.appendChild(slider.firstElementChild);
    setPositions();
};

const prev = () => {
    setTransitionSpeed('0.2s');
    slider.prepend(slider.lastElementChild);
    setPositions();
};

// Auto slide
const startAuto = () => interval = interval || setInterval(() => next(true), 2000);
const stopAuto = () => { clearInterval(interval); interval = null; };

// Event listeners
btnRight.addEventListener('click', () => next(false));
btnLeft.addEventListener('click', prev);

// Mouse hover controls
[slider, btnLeft, btnRight].forEach(el => {
    el.addEventListener('mouseover', stopAuto);
    el.addEventListener('mouseout', startAuto);
});

// Start auto slide
startAuto();



function sortTable(columnIndex, headerClicked, forceDirection) {
  const table = headerClicked.closest("table");
  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr"));

  // Decide sorting direction:
  let direction;
  if (forceDirection) {
    // Force "asc" or "desc"
    direction = forceDirection;
  } else {
    // Normal toggle: if it's .asc -> switch to .desc, else .asc
    direction = headerClicked.classList.contains("asc") ? "desc" : "asc";
  }

  // Remove asc/desc from all headers
  Array.from(table.querySelectorAll("th")).forEach(th => {
    th.classList.remove("asc", "desc");
  });

  // Set the new direction class on the clicked header
  headerClicked.classList.add(direction);

  // Formatted cells (e.g. "$0.47", "20.2k") carry the raw number in data-sort
  const sortKey = cell => cell.dataset.sort !== undefined
    ? cell.dataset.sort
    : cell.innerText.trim();

  // Sort the rows
  rows.sort((rowA, rowB) => {
    const cellA = sortKey(rowA.cells[columnIndex]);
    const cellB = sortKey(rowB.cells[columnIndex]);

    // Attempt numeric sort
    const numA = parseFloat(cellA);
    const numB = parseFloat(cellB);
    const isNumA = !isNaN(numA);
    const isNumB = !isNaN(numB);

    // In numeric columns, cells without a value (e.g. "-") always sort last
    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;

    const cmp = (isNumA && isNumB)
      ? numA - numB
      : cellA.toLowerCase().localeCompare(cellB.toLowerCase());
    return direction === "asc" ? cmp : -cmp;
  });

  // Reattach sorted rows
  rows.forEach(tr => tbody.appendChild(tr));
}

// Force descending sort on the pass@5 column (marked th.default-sort) of each
// leaderboard table after page load
function applyDefaultLeaderboardSorts() {
  document.querySelectorAll("th.default-sort").forEach(th => {
    const table = th.closest("table");
    // Skip tables that have already been sorted
    const hasSort = Array.from(table.querySelectorAll("th")).some(h =>
      h.classList.contains("asc") || h.classList.contains("desc"));
    if (!hasSort) {
      sortTable(th.cellIndex, th, "desc");
    }
  });
}

window.addEventListener('DOMContentLoaded', applyDefaultLeaderboardSorts);

// Also try on window.load as a fallback
window.addEventListener('load', applyDefaultLeaderboardSorts);

/* ======================== Previous-score tooltip ========================
   Leaderboard cells whose value changed in the Aug 2026 evaluation red
   teaming carry data-prev with the score published before it. A native
   title= tooltip is slow and easy to miss, and a pure-CSS one would be
   clipped by .table-wrapper's overflow, so a single fixed-position element
   is appended to <body> and moved to whichever cell is hovered. */
(function () {
  function initScoreTips() {
    const cells = document.querySelectorAll("td[data-prev]");
    if (!cells.length) return;

    const tip = document.createElement("div");
    tip.className = "score-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);

    const METRICS = { "bar-pass1": "pass@1", "bar-pass5": "pass@5", "bar-passhat5": "pass^5" };
    const label = cell => {
      // Model name and metric are already in the DOM: the row's first cell and
      // the cell's own metric class, so no extra data- attributes are needed.
      const row = cell.closest("tr");
      const model = row && row.cells[0] ? row.cells[0].textContent.trim() : "";
      const metric = Object.keys(METRICS).find(c => cell.classList.contains(c));
      return [model, metric ? METRICS[metric] : ""].filter(Boolean).join(" ");
    };

    const show = cell => {
      tip.textContent = label(cell) + " score before evaluation red teaming: " + cell.dataset.prev;
      tip.classList.add("is-open");
      // Measured after the text is set, so the width is the final one.
      const c = cell.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      let left = c.left + c.width / 2 - t.width / 2;
      left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
      const above = c.top - t.height - 8;
      tip.style.left = left + "px";
      tip.style.top = (above > 4 ? above : c.bottom + 8) + "px";
    };
    const hide = () => tip.classList.remove("is-open");

    cells.forEach(cell => {
      cell.addEventListener("mouseenter", () => show(cell));
      cell.addEventListener("mouseleave", hide);
      cell.addEventListener("focus", () => show(cell));
      cell.addEventListener("blur", hide);
      cell.setAttribute("tabindex", "0");
    });
    window.addEventListener("scroll", hide, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScoreTips);
  } else {
    initScoreTips();
  }
})();
