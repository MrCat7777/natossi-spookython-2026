/** Scroll-linked storytelling, independent of the simulation state. */
let previousCleanup = null;

export function initMotion() {
  previousCleanup?.();

  const controller = new AbortController();
  const { signal } = controller;
  const section = document.querySelector(".intro-scroll");
  const sticky = section?.querySelector(".intro-sticky");
  const video = document.getElementById("intro-video");
  const frames = [0, 1, 2, 3, 4].map((index) =>
    document.getElementById(`intro-frame-${index}`),
  );
  const chapterButtons = [...document.querySelectorAll(".chapter-button")];
  const chapterProgress = document.getElementById("chapter-progress");
  const pageProgress = document.getElementById("page-progress");
  const header = document.querySelector(".site-header");
  const telemetryTitle = document.getElementById("intro-telemetry-title");
  const telemetryDetail = document.getElementById("intro-telemetry-detail");
  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const pointerPreference = window.matchMedia(
    "(hover: hover) and (pointer: fine)",
  );
  const reveals = [...document.querySelectorAll(".reveal")];
  const chapterTargets = [0, 0.27, 0.47, 0.67, 0.9];
  const telemetry = [
    ["Manta. Real desde el espacio.", "Imágenes satelitales · archivo Esri"],
    ["Un caso. Infinitas conexiones.", "Escenario de ficción · Track B"],
    ["Cada contacto abre un camino.", "La amenaza avanza con el tiempo"],
    [
      "Intervenir cambia el desenlace.",
      "Dosis limitadas · prioridad estratégica",
    ],
    ["Tu decisión empieza ahora.", "Simula · compara · vuelve a decidir"],
  ];
  const navigationLinks = [
    ...document.querySelectorAll(".desktop-nav a, .mobile-nav a"),
  ];
  let animationFrame = 0;
  let scrollDirty = true;
  let metricsDirty = true;
  let pointerUpdate = null;
  let reducedMotion = motionPreference.matches;
  let videoFailed = false;
  let desiredVideoTime = 0;
  let currentChapter = -1;
  let revealObserver = null;
  let navigationObserver = null;
  let resizeObserver = null;
  let activeNavigation = "";
  let destroyed = false;
  const metrics = { top: 0, span: 1 };
  const clamp = (value, minimum = 0, maximum = 1) =>
    Math.min(maximum, Math.max(minimum, value));
  const smoothstep = (value) => {
    const progress = clamp(value);
    return progress * progress * (3 - 2 * progress);
  };

  document.documentElement.classList.add("js");

  function updateNavigation(id) {
    if (activeNavigation === id) return;
    activeNavigation = id;
    navigationLinks.forEach((link) => {
      const active = link.hash === `#${id}`;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  function measure() {
    if (section) {
      metrics.top = section.getBoundingClientRect().top + window.scrollY;
      metrics.span = Math.max(1, section.offsetHeight - window.innerHeight);
    }
    metricsDirty = false;
  }

  function seekVideo() {
    if (
      !video ||
      reducedMotion ||
      videoFailed ||
      video.seeking ||
      video.readyState < 1
    )
      return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const target = clamp(
      desiredVideoTime,
      0,
      Math.max(0, video.duration - 1 / 24),
    );
    // A new request is stored while the decoder is busy. Only the latest
    // scroll position is sought after `seeked`, rather than queuing frames.
    if (Math.abs(video.currentTime - target) > 1 / 48) {
      try {
        video.currentTime = target;
      } catch {
        // Metadata may have arrived before the media became seekable.
        // A later loadeddata/canplay event retries the same target.
      }
    }
  }

  function showChapter(chapter, progress) {
    const opacities = reducedMotion
      ? [1, 0, 0, 0, 0]
      : frames.map((_, index) => {
          const start = index * 0.2;
          const end = (index + 1) * 0.2;
          const enter =
            index === 0 ? 1 : smoothstep((progress - (start - 0.045)) / 0.09);
          const leave =
            index === frames.length - 1
              ? 1
              : 1 - smoothstep((progress - (end - 0.045)) / 0.09);
          return enter * leave;
        });

    frames.forEach((frame, index) => {
      if (!frame) return;
      const opacity = opacities[index];
      const direction = progress > (index + 0.5) * 0.2 ? -1 : 1;
      const offset = reducedMotion ? 0 : (1 - opacity) * 25 * direction;
      const active = index === chapter;
      frame.style.opacity = opacity.toFixed(3);
      frame.style.transform = `translateY(calc(-52% + ${offset.toFixed(2)}px))`;
      frame.style.pointerEvents = active && opacity > 0.2 ? "auto" : "none";
      frame.classList.toggle("is-active", active);
      frame.setAttribute("aria-hidden", String(!active));
      frame.inert = !active;
    });

    if (currentChapter !== chapter) {
      currentChapter = chapter;
      chapterButtons.forEach((button) => {
        const active = Number(button.dataset.chapter) === chapter;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      if (telemetryTitle) telemetryTitle.textContent = telemetry[chapter][0];
      if (telemetryDetail) telemetryDetail.textContent = telemetry[chapter][1];
    }
  }

  function paint() {
    animationFrame = 0;
    if (destroyed) return;
    if (metricsDirty) measure();
    if (scrollDirty) {
      scrollDirty = false;
      const scrollY = Math.max(0, window.scrollY);
      const documentSpan = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      if (pageProgress)
        pageProgress.style.width = `${clamp(scrollY / documentSpan) * 100}%`;
      header?.classList.toggle("is-scrolled", scrollY > 24);

      if (section) {
        const progress = reducedMotion
          ? 0
          : clamp((scrollY - metrics.top) / metrics.span);
        const chapter = reducedMotion
          ? 0
          : Math.min(4, Math.floor(progress * 5));
        showChapter(chapter, progress);
        if (chapterProgress) chapterProgress.style.width = `${progress * 100}%`;
        if (video && !reducedMotion && Number.isFinite(video.duration)) {
          desiredVideoTime = progress * Math.max(0, video.duration - 1 / 24);
          seekVideo();
        }
        if (scrollY < metrics.top + metrics.span + window.innerHeight * 0.3)
          updateNavigation("");
      }
    }

    if (pointerUpdate) {
      const { card, x, y } = pointerUpdate;
      const bounds = card.getBoundingClientRect();
      card.style.setProperty("--mouse-x", `${x - bounds.left}px`);
      card.style.setProperty("--mouse-y", `${y - bounds.top}px`);
      pointerUpdate = null;
    }
  }

  function schedule() {
    if (!animationFrame && !destroyed)
      animationFrame = requestAnimationFrame(paint);
  }

  function onScroll() {
    scrollDirty = true;
    schedule();
  }

  function onResize() {
    metricsDirty = true;
    scrollDirty = true;
    schedule();
  }

  function applyMotionPreference() {
    reducedMotion = motionPreference.matches;
    currentChapter = -1;
    if (video) {
      video.pause();
      video.hidden = reducedMotion || videoFailed;
    }
    if (reducedMotion) {
      reveals.forEach((element) => element.classList.add("is-visible"));
      revealObserver?.disconnect();
    }
    onResize();
  }

  // Scroll and pointer work share a single, event-driven animation frame.
  window.addEventListener("scroll", onScroll, { passive: true, signal });
  window.addEventListener("resize", onResize, { passive: true, signal });
  window.addEventListener("pageshow", onResize, { signal });
  motionPreference.addEventListener("change", applyMotionPreference, {
    signal,
  });
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(onResize);
    if (section) resizeObserver.observe(section);
    resizeObserver.observe(document.body);
  }

  chapterButtons.forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        if (!section) return;
        if (metricsDirty) measure();
        const target = chapterTargets[Number(button.dataset.chapter)] ?? 0;
        window.scrollTo({
          top: metrics.top + metrics.span * target,
          behavior: reducedMotion ? "auto" : "smooth",
        });
      },
      { signal },
    );
  });

  if (video) {
    video.muted = true;
    video.pause();
    ["loadedmetadata", "loadeddata", "canplay"].forEach((name) => {
      video.addEventListener(
        name,
        () => {
          onScroll();
          seekVideo();
        },
        { signal },
      );
    });
    video.addEventListener("seeked", seekVideo, { signal });
    video.addEventListener(
      "error",
      () => {
        videoFailed = true;
        video.hidden = true;
        if (sticky) {
          sticky.style.backgroundImage = 'url("./assets/manta-poster.webp")';
          sticky.style.backgroundSize = "cover";
          sticky.style.backgroundPosition = "center";
        }
      },
      { signal },
    );
  }

  document.querySelectorAll(".stagger-group").forEach((group) => {
    group.querySelectorAll(".reveal").forEach((element, index) => {
      element.style.setProperty(
        "--reveal-delay",
        `${Math.min(index, 5) * 90}ms`,
      );
    });
  });
  if ("IntersectionObserver" in window && !reducedMotion) {
    revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
    );
    reveals.forEach((element) => revealObserver.observe(element));
  } else reveals.forEach((element) => element.classList.add("is-visible"));

  if ("IntersectionObserver" in window) {
    navigationObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) updateNavigation(entry.target.id);
        });
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );
    ["territorio", "modelo", "simulador"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) navigationObserver.observe(element);
    });
  }

  document.querySelectorAll(".spotlight-card").forEach((card) => {
    card.addEventListener(
      "pointermove",
      (event) => {
        if (reducedMotion || !pointerPreference.matches) return;
        pointerUpdate = { card, x: event.clientX, y: event.clientY };
        schedule();
      },
      { passive: true, signal },
    );
    card.addEventListener(
      "pointerleave",
      () => {
        if (pointerUpdate?.card === card) pointerUpdate = null;
        card.style.removeProperty("--mouse-x");
        card.style.removeProperty("--mouse-y");
      },
      { passive: true, signal },
    );
  });

  applyMotionPreference();
  const cleanup = () => {
    destroyed = true;
    controller.abort();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    revealObserver?.disconnect();
    navigationObserver?.disconnect();
    resizeObserver?.disconnect();
    video?.pause();
    if (previousCleanup === cleanup) previousCleanup = null;
  };
  previousCleanup = cleanup;
  return cleanup;
}
