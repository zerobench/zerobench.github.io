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
const setPositions = () =>
    [...slider.children].forEach((item, i) =>
        item.style.left = `${(i-1) * 440}px`);

// Initial setup
setPositions();

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

document.addEventListener("mouseover", function (event) {
  if (event.target.matches(".navbar-dropdown a")) {
    const randomColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 70%)`;
    event.target.style.backgroundColor = randomColor;
  }
});

document.addEventListener("mouseout", function (event) {
  if (event.target.matches(".navbar-dropdown a")) {
    event.target.style.backgroundColor = "";
  }
});

function sortTable(columnIndex, headerClicked, forceDirection) {
  const table = document.getElementById("sortableTable");
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

  // Sort the rows
  rows.sort((rowA, rowB) => {
    const cellA = rowA.cells[columnIndex].innerText;
    const cellB = rowB.cells[columnIndex].innerText;

    // Attempt numeric sort
    const valA = parseFloat(cellA) || cellA.toLowerCase();
    const valB = parseFloat(cellB) || cellB.toLowerCase();

    if (valA < valB) return direction === "asc" ? -1 : 1;
    if (valA > valB) return direction === "asc" ? 1 : -1;
    return 0;
  });

  // Reattach sorted rows
  rows.forEach(tr => tbody.appendChild(tr));
}

// Force descending sort on pass@1 (columnIndex=1) after page load
window.addEventListener('DOMContentLoaded', function() {
  const ths = document.getElementById("sortableTable").querySelectorAll("th");
  // Column 1 is pass@1
  sortTable(1, ths[1], "desc");
});
