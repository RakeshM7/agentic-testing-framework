(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  if (!slides.length) return;
  document.documentElement.classList.add("js");
  var i = 0;
  var counter = document.getElementById("counter");
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, k) { s.classList.toggle("current", k === i); });
    counter.textContent = (i + 1) + " / " + slides.length;
    try { history.replaceState(null, "", "#s" + (i + 1)); } catch (e) {}
  }
  document.getElementById("prev").addEventListener("click", function () { show(i - 1); });
  document.getElementById("next").addEventListener("click", function () { show(i + 1); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); show(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); show(i - 1); }
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(slides.length - 1);
  });
  var m = /^#s(\d+)$/.exec(location.hash);
  show(m ? Number(m[1]) - 1 : 0);
})();
