(() => {
  "use strict";

  const DEV_DURATION_MS = 45_000; // compressed stand-in for the real 24h lock
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const phone = document.getElementById("phone");
  const phoneFrame = document.getElementById("phone-frame");
  const screens = Array.from(document.querySelectorAll(".screen"));
  const devLogEl = document.getElementById("devpanel-log");

  // Keep the 390x852 design at its exact proportions on every device by
  // uniformly scaling it to fit, rather than letting CSS stretch/crop it.
  const DESIGN_W = 390;
  const DESIGN_H = 852;
  function fitPhoneToViewport() {
    const availW = window.innerWidth - 32;
    const availH = window.innerHeight - 64;
    const scale = Math.min(1, availW / DESIGN_W, availH / DESIGN_H);
    phone.style.transform = `scale(${scale})`;
    phoneFrame.style.width = `${DESIGN_W * scale}px`;
    phoneFrame.style.height = `${DESIGN_H * scale}px`;
  }
  fitPhoneToViewport();
  window.addEventListener("resize", fitPhoneToViewport);

  let currentScreen = "explainer-front";
  let developingStartedAt = null;
  let developingTimerHandle = null;
  let unlocked = false;

  // ---------- zigzag/deckle-edge postcard border ----------
  // Builds a clip-path polygon that zigzags along all four edges, like a
  // torn/perforated postcard edge. Percentage-based so it's resolution independent.
  function buildZigzagPolygon(teethX, teethY, depthPct) {
    const pts = [];
    const stepX = 100 / teethX;
    const stepY = 100 / teethY;

    // top edge: left -> right
    for (let i = 0; i <= teethX; i++) {
      const x = i * stepX;
      const y = i % 2 === 0 ? 0 : depthPct;
      pts.push(`${x}% ${y}%`);
    }
    // right edge: top -> bottom
    for (let i = 1; i <= teethY; i++) {
      const y = i * stepY;
      const x = i % 2 === 0 ? 100 : 100 - depthPct;
      pts.push(`${x}% ${y}%`);
    }
    // bottom edge: right -> left
    for (let i = 1; i <= teethX; i++) {
      const x = 100 - i * stepX;
      const y = i % 2 === 0 ? 100 : 100 - depthPct;
      pts.push(`${x}% ${y}%`);
    }
    // left edge: bottom -> top
    for (let i = 1; i < teethY; i++) {
      const y = 100 - i * stepY;
      const x = i % 2 === 0 ? 0 : depthPct;
      pts.push(`${x}% ${y}%`);
    }
    return `polygon(${pts.join(", ")})`;
  }

  function applyZigzagBorders() {
    const polygon = buildZigzagPolygon(13, 17, 2.2);
    document.querySelectorAll(".postcard").forEach((el) => {
      el.style.clipPath = polygon;
    });
  }

  // ---------- perforated stamp-edge border (Developing card) ----------
  // Builds a clip-path polygon with small rounded scallop bumps along each
  // edge, like a postage stamp's punched perforation.
  function buildScallopPolygon(bumpsX, bumpsY, depthPct, pointsPerBump) {
    const pts = [];
    const stepX = 100 / bumpsX;
    const stepY = 100 / bumpsY;
    function addEdge(count, step, axisFromFn) {
      for (let i = 0; i < count; i++) {
        const a0 = i * step;
        const a1 = (i + 1) * step;
        for (let j = 0; j <= pointsPerBump; j++) {
          const t = j / pointsPerBump;
          const a = a0 + t * (a1 - a0);
          const bump = Math.sin(t * Math.PI) * depthPct;
          pts.push(axisFromFn(a, bump));
        }
      }
    }
    addEdge(bumpsX, stepX, (a, b) => `${a}% ${b}%`); // top
    addEdge(bumpsY, stepY, (a, b) => `${100 - b}% ${a}%`); // right
    addEdge(bumpsX, stepX, (a, b) => `${100 - a}% ${100 - b}%`); // bottom
    addEdge(bumpsY, stepY, (a, b) => `${b}% ${100 - a}%`); // left
    return `polygon(${pts.join(", ")})`;
  }

  function applyScallopBorder() {
    const polygon = buildScallopPolygon(15, 20, 1.6, 6);
    document.querySelectorAll(".developing-card").forEach((el) => {
      el.style.clipPath = polygon;
    });
  }

  // ---------- analytics ----------
  function track(event, props) {
    const line = `${event}${props ? " " + JSON.stringify(props) : ""}`;
    console.log(`[analytics] ${line}`);
    if (devLogEl) {
      const row = document.createElement("div");
      const time = new Date().toLocaleTimeString([], { hour12: false });
      row.textContent = `${time}  ${line}`;
      devLogEl.prepend(row);
    }
  }

  // ---------- screen navigation ----------
  function showScreen(name) {
    currentScreen = name;
    for (const s of screens) {
      const isTarget = s.dataset.screen === name;
      s.classList.toggle("active", isTarget);
      if (isTarget && !reduceMotion) {
        s.classList.remove("transitioning-in");
        // force reflow to restart animation
        void s.offsetWidth;
        s.classList.add("transitioning-in");
      }
    }
    onScreenShown(name);
  }

  function onScreenShown(name) {
    if (name === "camera") {
      track("analog_capture_viewed", { screen_type: cameraContext });
    }
    if (name === "developing") {
      track("developing_screen_viewed", { film_roll_status: "in_progress" });
      startDevelopingTimer();
    }
    if (name === "reveal-front") {
      track("postcard_revealed");
      resetFlip();
    }
  }

  // ---------- explainer flip (front <-> back preview) ----------
  document.querySelectorAll('[data-action="flip-explainer"]').forEach((el) => {
    el.addEventListener("click", () => {
      showScreen(currentScreen === "explainer-front" ? "explainer-back" : "explainer-front");
    });
  });

  document.querySelectorAll('[data-action="start-flow"]').forEach((el) => {
    el.addEventListener("click", () => {
      cameraContext = "onboarding";
      showScreen("camera");
    });
  });

  document.querySelectorAll('[data-action="skip"]').forEach((el) => {
    el.addEventListener("click", () => {
      // Step 3: skip routes straight to the empty home feed, which then force-shows the capture overlay
      showScreen("home-empty");
    });
  });

  document.querySelectorAll('[data-action="force-capture"]').forEach((el) => {
    el.addEventListener("click", () => {
      cameraContext = "home_feed_fallback";
      showScreen("camera");
    });
  });

  // ---------- camera / capture ----------
  let cameraContext = "onboarding"; // onboarding | home_feed_fallback

  document.querySelector('[data-action="capture"]').addEventListener("click", () => {
    track("analog_capture_submitted", { screen_type: cameraContext });
    flashShutter();
    setTimeout(() => showScreen("postcapture"), reduceMotion ? 0 : 260);
  });

  function flashShutter() {
    if (reduceMotion) return;
    const flash = document.createElement("div");
    flash.style.cssText =
      "position:absolute;inset:0;background:#fff;z-index:60;pointer-events:none;opacity:0.5;";
    phone.appendChild(flash);
    flash.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 260, easing: "ease-out" });
    setTimeout(() => flash.remove(), 280);
  }

  // ---------- post-capture: save ----------
  // Note: the post-capture "Skip" button reuses the global skip handler below
  // (abandons the flow entirely), matching the onboarding Skip semantics.
  document.querySelector('[data-action="save"]').addEventListener("click", () => {
    developingStartedAt = Date.now();
    unlocked = false;
    showScreen("developing");
  });

  document.querySelector('[data-action="retry-save"]').addEventListener("click", () => {
    document.querySelector('[data-screen="postcapture"] [data-modal="upload-error"]').hidden = true;
    developingStartedAt = Date.now();
    showScreen("developing");
  });

  // ---------- permission modal (dev-triggerable, wired for completeness) ----------
  document.querySelector('[data-action="permission-settings"]')?.addEventListener("click", () => {
    // A web page can't deep-link into the iOS Settings app (only a native app
    // can open its own settings page). We simulate the realistic outcome
    // instead: the user enables it in Settings and returns with access granted.
    document.querySelector('[data-screen="camera"] [data-modal="permission"]').hidden = true;
  });
  document.querySelector('[data-action="permission-deny"]')?.addEventListener("click", () => {
    document.querySelector('[data-screen="camera"] [data-modal="permission"]').hidden = true;
    // "Don't Allow" sends the user straight back to the feed.
    showScreen("home-empty");
  });

  // ---------- developing state ----------
  const developingCard = document.querySelector(".developing-card");

  developingCard.addEventListener("click", () => {
    if (unlocked) return;
    developingCard.classList.remove("wobble");
    void developingCard.offsetWidth;
    developingCard.classList.add("wobble");
  });

  document.querySelector('[data-action="add-friends"]').addEventListener("click", () => {
    // non-blocking fallback — no-op in this prototype, matches "resilient, non-blocking" design rationale
  });

  // "Exit to Home Screen" simulates the user closing the app (Step 5: closing
  // the app establishes the Information Gap). A beat later, the Day 1 push
  // notification fires — matching the real 24h lock without the actual wait.
  document.querySelector('[data-action="exit-app"]').addEventListener("click", () => {
    developingStartedAt = Date.now() - DEV_DURATION_MS;
    checkDevelopingComplete();
  });

  function checkDevelopingComplete() {
    const elapsed = Date.now() - developingStartedAt;
    if (elapsed >= DEV_DURATION_MS) {
      clearInterval(developingTimerHandle);
      unlocked = true;
      goToLockscreen();
      return true;
    }
    return false;
  }

  function startDevelopingTimer() {
    if (developingTimerHandle) clearInterval(developingTimerHandle);
    if (!developingStartedAt) developingStartedAt = Date.now();
    if (checkDevelopingComplete()) return;
    developingTimerHandle = setInterval(checkDevelopingComplete, 250);
  }

  document.querySelector('[data-action="skip-timer"]').addEventListener("click", () => {
    if (currentScreen !== "developing") showScreen("developing");
    developingStartedAt = Date.now() - DEV_DURATION_MS;
    checkDevelopingComplete();
  });

  // ---------- edge-case demo triggers ----------
  document.querySelector('[data-action="show-permission-modal"]').addEventListener("click", () => {
    showScreen("camera");
    document.querySelector('[data-screen="camera"] [data-modal="permission"]').hidden = false;
  });
  document.querySelector('[data-action="show-save-error"]').addEventListener("click", () => {
    showScreen("postcapture");
    document.querySelector('[data-screen="postcapture"] [data-modal="upload-error"]').hidden = false;
  });
  document.querySelector('[data-action="show-share-error-demo"]').addEventListener("click", () => {
    showScreen("reveal-front");
    document.querySelector('[data-screen="reveal-front"] [data-modal="share-error"]').hidden = false;
  });

  function goToLockscreen() {
    showScreen("lockscreen");
  }

  // ---------- lockscreen notification ----------
  document.querySelector('[data-action="open-notification"]').addEventListener("click", () => {
    track("push_notification_clicked", { notification_type: "postcard_developed" });
    showScreen("reveal-front");
  });

  // ---------- reveal / flip ----------
  const flipCard = document.getElementById("flip-card");
  const pcLines = () => document.querySelectorAll('[data-screen="reveal-front"] .pc-fade');

  function resetFlip() {
    flipCard.classList.remove("flipped");
    pcLines().forEach((l) => l.classList.remove("pc-fade--in"));
  }

  flipCard.addEventListener("click", () => {
    const flipping = !flipCard.classList.contains("flipped");
    flipCard.classList.toggle("flipped");
    if (flipping) {
      const flipDuration = reduceMotion ? 0 : 700;
      setTimeout(() => staggerTextReveal(), flipDuration + 150);
    } else {
      pcLines().forEach((l) => l.classList.remove("pc-fade--in"));
    }
  });

  function staggerTextReveal() {
    pcLines().forEach((line, i) => {
      setTimeout(() => line.classList.add("pc-fade--in"), reduceMotion ? 0 : i * 60);
    });
  }

  // ---------- share ----------
  const shareSheet = document.getElementById("share-sheet");

  document.querySelector('[data-action="share"]').addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "My BeReal Postcard",
          text: "Just unlocked my Day 1 postcard on BeReal ✉️",
        });
        proceedToFinalHome();
        return;
      } catch (err) {
        // AbortError = user cancelled the native sheet; anything else = real failure
        if (err && err.name === "AbortError") return;
        showShareError();
        return;
      }
    }
    shareSheet.hidden = false;
  });

  document.querySelectorAll('[data-action="close-share-sheet"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.dataset.stop !== undefined) return;
      shareSheet.hidden = true;
    });
  });
  shareSheet.querySelectorAll(".share-sheet-app").forEach((app) => {
    app.addEventListener("click", () => {
      shareSheet.hidden = true;
      proceedToFinalHome();
    });
  });

  function showShareError() {
    document.querySelector('[data-screen="reveal-front"] [data-modal="share-error"]').hidden = false;
  }
  document.querySelector('[data-action="retry-share"]').addEventListener("click", () => {
    document.querySelector('[data-screen="reveal-front"] [data-modal="share-error"]').hidden = true;
  });

  function proceedToFinalHome() {
    showScreen("home-final");
  }

  // ---------- restart / dev panel ----------
  document.querySelectorAll('[data-action="restart-demo"]').forEach((el) => {
    el.addEventListener("click", () => {
      unlocked = false;
      developingStartedAt = null;
      if (developingTimerHandle) clearInterval(developingTimerHandle);
      document.querySelectorAll(".pc-fade").forEach((l) => l.classList.remove("pc-fade--in"));
      resetFlip();
      showScreen("explainer-front");
    });
  });

  const devpanel = document.getElementById("devpanel");
  document.querySelectorAll('[data-action="toggle-devpanel"]').forEach((el) => {
    el.addEventListener("click", () => devpanel.classList.toggle("open"));
  });

  // ---------- init ----------
  applyZigzagBorders();
  applyScallopBorder();
  showScreen("explainer-front");
})();
