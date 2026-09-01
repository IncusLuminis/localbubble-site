import {
  arcDragFractionToRateSliderValue,
  formatPlayerRateYearsPerSecond,
  formatPlayerTimeYears,
  logSpeedSliderToYearsPerSecond,
  PLAYER_TIME_RANGE_YEARS,
  type PlayerDirection,
} from "../scene/motionPlayer";

/**
 * Story #239: the motion player's own control panel - a transport bar, a
 * logarithmic-scale rate slider, a current-time readout, a full-range
 * scrubber, and a "Today" button (Epic #238's settled UI shape). Plain DOM,
 * no framework, matching `ui/controls.ts`'s own convention - and, like that
 * module's DOM-building half, not itself unit-tested (`vite.config.ts` runs
 * Vitest with `environment: "node"`; see `motionPlayer.ts` for the actual
 * testable decision logic this panel's event handlers call into via
 * `main.ts`).
 *
 * Story #243: replaced the single Play/Pause toggle button with the classic
 * `|< < > >|` transport scheme.
 *
 * Story #266 (state-model half of the NASA "Eyes on the Solar System"-style
 * redesign - Story #267 does the matching visual redesign): reworked this
 * same interim layout for the new signed-rate state model.
 *
 * Story #267 (the visual redesign this docstring now describes): replaces
 * #266's interim reused-straight-slider row with NASA "Eyes on the Solar
 * System"'s own bottom control-bar layout, left to right:
 * 1. "Today" (unchanged jump-to-zero behavior, moved far left).
 * 2. The elapsed-time readout (unchanged `formatPlayerTimeYears`).
 * 3. The `<<`/Play-Pause/`>>` cluster, visually nested above a shallow
 *    curved rate-SCALE (`.player-rate-arc-track`, an SVG quadratic-bezier
 *    "bow" reading as a shallow ~10-15 degree sector of a large circle, per
 *    the issue's own explicit "not a speedometer gauge" guidance) that
 *    re-skins #266's plain `<input type="range">` as a drag surface -
 *    dragging (mouse OR touch, both resolve through the Pointer Events API)
 *    computes a `[0,1]` fraction across the track's own bounding box and
 *    calls `arcDragFractionToRateSliderValue` (pure, unit-tested in
 *    `motionPlayer.ts`) to get the resulting signed `[-1,1]` value, then
 *    `onRateChange` exactly as the old slider's `input` handler did. The
 *    `<<`/`>>` buttons and the center Play/Pause button are UNCHANGED from
 *    #266 (`onNudge`/`onPlayPauseToggle`, same glyphs) - only their
 *    position/styling moved.
 * 4. The rate readout (`formatPlayerRateYearsPerSecond`, new in #267).
 * 5. A collapse chevron (`onCollapse`, new in #267) - Story #267's PR
 *    documents the decision to reuse #249's existing close+reset-to-Today
 *    action (the same thing the toolbar Play button already does when the
 *    panel is open) rather than inventing a separate minimized visual
 *    state, per the issue's own recommended default.
 *
 * The full-range absolute-time scrubber (`onScrub`, unchanged since #239) is
 * kept as its own slim row ABOVE this new control bar - #267's target layout
 * only specifies the 5-item bottom bar itself, and dropping direct-scrub
 * entirely would be a behavior regression the issue never asked for, so it
 * stays, just visually subordinate to the new NASA-Eyes-style row beneath
 * it.
 *
 * This panel still makes no decisions of its own about what any of these
 * mean in terms of resulting time/playback state - that interaction logic
 * lives entirely in `motionPlayer.ts`'s pure functions, driven by `main.ts`;
 * this module only reports which control was operated and renders whatever
 * state `update()` is next handed.
 *
 * This module owns no player STATE itself (no `tYears`/`playing`/rate
 * fields) - it is a thin, stateless view: `main.ts` is the single source of
 * truth for the player's actual state, pushing it into this panel via
 * `update()` every animation frame, and reading user intent back out via the
 * callbacks in `PlayerPanelOptions`. This mirrors `ui/controls.ts`'s own
 * callback-driven shape (`onCategoryToggle`/`onRadiusChange`/etc.) rather
 * than inventing a second, parallel state-management convention for one
 * more panel.
 */

export interface PlayerPanelOptions {
  /** A `<<`/`>>` nudge button was pressed - `main.ts` resolves the resulting
   * rate slider value via `nudgeRateSliderValue` and applies it, without
   * touching `playing` at all (Story #266 AC). `-1` is `<<` (nudge toward/
   * past backward), `1` is `>>` (nudge toward/past forward). */
  onNudge: (deltaSign: PlayerDirection) => void;
  /** The center Play/Pause button was pressed - a plain, rate-independent
   * `playerPlaying = !playerPlaying` toggle in `main.ts` (Story #266 AC). */
  onPlayPauseToggle: () => void;
  /** The scrubber was dragged to a new absolute year value (un-clamped -
   * `main.ts` clamps via `clampPlayerTimeYears` before storing it). */
  onScrub: (tYears: number) => void;
  /** The rate arc was dragged to a new SIGNED `[-1, 1]` control value (Story
   * #266's semantics, Story #267's re-skinned arc widget) - `main.ts` stores
   * this raw and maps it through `logSpeedSliderToYearsPerSecond` only when
   * actually advancing time, so the panel needn't know that mapping at all
   * for the state-write side (it DOES use that mapping read-only, purely for
   * the rate readout's own display text - see `update()` below). */
  onRateChange: (sliderValue: number) => void;
  /** The "Today" button was pressed. */
  onToday: () => void;
  /** Story #267: the collapse chevron was pressed - `main.ts` wires this to
   * the SAME close+reset-to-Today action the toolbar Play button already
   * performs when the panel is open (`applyPlayerResetState`/
   * `nextPlayerStateForSphere("outside")`-shaped reset), per this Story's
   * documented (a)-over-(b) decision - see the PR description. */
  onCollapse: () => void;
  /** Initial rate-slider value (`[-1, 1]`, signed) - see `main.ts`'s
   * `DEFAULT_PLAYER_RATE_SLIDER_VALUE` for the chosen live-tuned default. */
  defaultRateSliderValue: number;
}

export interface PlayerPanelState {
  tYears: number;
  playing: boolean;
  /** The current signed `[-1, 1]` rate slider value - pushed into the rate
   * arc's own handle position/fill every frame (Story #267, replacing #266's
   * plain `<input type="range">` value push), mirroring how the scrubber is
   * kept in sync with `tYears` below, since `<<`/`>>` nudges change this
   * value from OUTSIDE a direct drag on the arc itself. */
  rateSliderValue: number;
}

export interface PlayerPanelHandle {
  element: HTMLDivElement;
  /** Shows/hides the whole panel (`main.ts` calls this when the toolbar
   * button first opens it, and when a sphere exit force-hides it - Epic
   * #238 AC). */
  setVisible: (visible: boolean) => void;
  /** Pushes the current player state into the panel's own DOM (time
   * readout text, scrubber position, rate arc handle position, rate
   * readout text, Play/Pause glyph) - called every animation frame from
   * `main.ts`'s `applyPlayerAnimation`, mirroring how `applyFovReadout`/
   * `applyGalacticCenterLabelPosition` already re-render their own small DOM
   * bits every frame. */
  update: (state: PlayerPanelState) => void;
}

// Story #266: the `<<`/`>>` nudge buttons and the single center Play/Pause
// button, in that left-to-right reading order. Story #267 keeps these exact
// glyphs/semantics, just re-nests them visually above the new rate arc.
const NUDGE_BACK_GLYPH = "<<";
const NUDGE_FORWARD_GLYPH = ">>";
const PLAY_GLYPH = "▶";
const PAUSE_GLYPH = "⏸";
const COLLAPSE_GLYPH = "▾";

// Story #267: the shallow rate-arc's own SVG geometry constants - a
// quadratic-bezier "bow" from the left/backward end to the right/forward
// end, apex (the control point) raised above the two ends so the curve
// reads as a shallow slice of a large circle's rim (per the issue's own
// "sector 10-15 degrees... not a speedometer gauge" guidance) rather than a
// deep dial sweep. Values are in the SVG's own `viewBox` units, not pixels -
// `preserveAspectRatio="none"` lets the CSS box stretch this to whatever
// on-screen size the panel's layout gives it.
const ARC_VIEWBOX_WIDTH = 200;
const ARC_VIEWBOX_HEIGHT = 30;
const ARC_START: readonly [number, number] = [6, 24];
const ARC_CONTROL: readonly [number, number] = [ARC_VIEWBOX_WIDTH / 2, 2];
const ARC_END: readonly [number, number] = [ARC_VIEWBOX_WIDTH - 6, 24];
const ARC_FILL_SAMPLE_STEPS = 16;

/** Point at bezier parameter `t` (`[0,1]`) along the quadratic curve defined
 * by `ARC_START`/`ARC_CONTROL`/`ARC_END` - used both to place the drag
 * handle and to sample the "fill" sub-path from center (`t = 0.5`) out to
 * the handle's own `t`. Pure geometry, not player state - kept local to this
 * module rather than `motionPlayer.ts` (unlike `arcDragFractionToRateSliderValue`,
 * this has no player-domain meaning of its own to unit-test independently). */
function arcPointAtT(t: number): [number, number] {
  const mt = 1 - t;
  const x = mt * mt * ARC_START[0] + 2 * mt * t * ARC_CONTROL[0] + t * t * ARC_END[0];
  const y = mt * mt * ARC_START[1] + 2 * mt * t * ARC_CONTROL[1] + t * t * ARC_END[1];
  return [x, y];
}

/** `[-1, 1]` rate slider value -> `[0, 1]` bezier parameter (center is
 * `t = 0.5`, matching `ARC_CONTROL`'s own apex position). */
function rateSliderValueToArcT(value: number): number {
  return (Math.max(-1, Math.min(1, value)) + 1) / 2;
}

export function createPlayerPanel(options: PlayerPanelOptions): PlayerPanelHandle {
  const panel = document.createElement("div");
  panel.id = "player-panel";
  panel.className = "panel";

  // Story #239's full-range absolute-time scrubber - unchanged behavior,
  // kept as its own slim row above the new #267 control bar (see this
  // module's own top docstring for why it's kept rather than dropped).
  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.className = "player-scrubber";
  scrubber.min = String(-PLAYER_TIME_RANGE_YEARS);
  scrubber.max = String(PLAYER_TIME_RANGE_YEARS);
  scrubber.step = "1000";
  scrubber.value = "0";
  scrubber.setAttribute("aria-label", "Scrub time");
  scrubber.addEventListener("input", () => {
    options.onScrub(Number(scrubber.value));
  });
  panel.appendChild(scrubber);

  // Story #267: the new NASA-Eyes-style bottom control bar - Today, time
  // readout, the arc+buttons cluster, rate readout, collapse chevron, in
  // that left-to-right reading order (the issue's own target layout).
  const controlBar = document.createElement("div");
  controlBar.className = "player-panel-row player-control-bar";

  const todayButton = document.createElement("button");
  todayButton.type = "button";
  todayButton.className = "player-today";
  todayButton.textContent = "Today";
  todayButton.addEventListener("click", () => options.onToday());

  const timeReadout = document.createElement("div");
  timeReadout.className = "player-time-readout";
  timeReadout.textContent = formatPlayerTimeYears(0);

  // The arc cluster: a small column with the three transport buttons on top
  // (raised, reading as if perched on the arc's own peaks) and the SVG arc
  // track/handle beneath.
  const arcCluster = document.createElement("div");
  arcCluster.className = "player-rate-arc";

  const buttonRow = document.createElement("div");
  buttonRow.className = "player-rate-arc-buttons";

  const nudgeBackButton = document.createElement("button");
  nudgeBackButton.type = "button";
  nudgeBackButton.className = "player-transport player-nudge-back";
  nudgeBackButton.textContent = NUDGE_BACK_GLYPH;
  nudgeBackButton.setAttribute("aria-label", "Nudge playback rate backward");
  nudgeBackButton.addEventListener("click", () => options.onNudge(-1));

  const playPauseButton = document.createElement("button");
  playPauseButton.type = "button";
  playPauseButton.className = "player-transport player-play-pause";
  playPauseButton.textContent = PLAY_GLYPH;
  playPauseButton.setAttribute("aria-label", "Play or pause");
  playPauseButton.addEventListener("click", () => options.onPlayPauseToggle());

  const nudgeForwardButton = document.createElement("button");
  nudgeForwardButton.type = "button";
  nudgeForwardButton.className = "player-transport player-nudge-forward";
  nudgeForwardButton.textContent = NUDGE_FORWARD_GLYPH;
  nudgeForwardButton.setAttribute("aria-label", "Nudge playback rate forward");
  nudgeForwardButton.addEventListener("click", () => options.onNudge(1));

  buttonRow.append(nudgeBackButton, playPauseButton, nudgeForwardButton);

  // The shallow arc itself: an SVG "bow" (decoration) overlaid by a
  // transparent, full-box drag surface (`arcTrack`) that captures Pointer
  // Events (mouse AND touch through one API) and maps the pointer's
  // horizontal position to a `[0,1]` fraction, then
  // `arcDragFractionToRateSliderValue` for the actual value.
  const arcTrack = document.createElement("div");
  arcTrack.className = "player-rate-arc-track";
  arcTrack.setAttribute("role", "slider");
  arcTrack.setAttribute("aria-label", "Playback rate: drag left for backward, right for forward");
  arcTrack.setAttribute("aria-valuemin", "-1");
  arcTrack.setAttribute("aria-valuemax", "1");
  arcTrack.tabIndex = 0;

  const svgNs = "http://www.w3.org/2000/svg";
  const arcSvg = document.createElementNS(svgNs, "svg");
  arcSvg.setAttribute("class", "player-rate-arc-svg");
  arcSvg.setAttribute("viewBox", `0 0 ${ARC_VIEWBOX_WIDTH} ${ARC_VIEWBOX_HEIGHT}`);
  arcSvg.setAttribute("preserveAspectRatio", "none");
  arcSvg.setAttribute("aria-hidden", "true");

  const arcPathD = `M ${ARC_START[0]} ${ARC_START[1]} Q ${ARC_CONTROL[0]} ${ARC_CONTROL[1]} ${ARC_END[0]} ${ARC_END[1]}`;
  const trackPath = document.createElementNS(svgNs, "path");
  trackPath.setAttribute("class", "player-rate-arc-track-path");
  trackPath.setAttribute("d", arcPathD);
  trackPath.setAttribute("fill", "none");

  const fillPath = document.createElementNS(svgNs, "path");
  fillPath.setAttribute("class", "player-rate-arc-fill-path");
  fillPath.setAttribute("fill", "none");

  const handle = document.createElementNS(svgNs, "circle");
  handle.setAttribute("class", "player-rate-arc-handle");
  handle.setAttribute("r", "3.5");

  arcSvg.append(trackPath, fillPath, handle);
  arcTrack.appendChild(arcSvg);

  /** Redraws the fill sub-path and handle position for a given signed
   * `[-1,1]` rate value - shared by the initial render, `update()`, and
   * every drag/nudge-driven change (the drag path calls `onRateChange`,
   * which `main.ts` reflects back into the next `update()` call, so this
   * only needs to run from `update()` in practice, but is kept as its own
   * function for the initial-render call below rather than duplicating the
   * math). */
  function renderArc(value: number): void {
    const targetT = rateSliderValueToArcT(value);
    const [hx, hy] = arcPointAtT(targetT);
    handle.setAttribute("cx", String(hx));
    handle.setAttribute("cy", String(hy));

    const startT = Math.min(0.5, targetT);
    const endT = Math.max(0.5, targetT);
    const points: string[] = [];
    for (let i = 0; i <= ARC_FILL_SAMPLE_STEPS; i++) {
      const t = startT + ((endT - startT) * i) / ARC_FILL_SAMPLE_STEPS;
      const [x, y] = arcPointAtT(t);
      points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    fillPath.setAttribute("d", points.join(" "));
  }
  renderArc(options.defaultRateSliderValue);

  function handleArcPointer(clientX: number): void {
    const rect = arcTrack.getBoundingClientRect();
    const fraction = rect.width === 0 ? 0.5 : (clientX - rect.left) / rect.width;
    options.onRateChange(arcDragFractionToRateSliderValue(fraction));
  }

  let dragging = false;
  arcTrack.addEventListener("pointerdown", (event) => {
    dragging = true;
    // Sets the actual rate value FIRST, unconditionally - `setPointerCapture`
    // below is a best-effort enhancement (keeps receiving `pointermove` even
    // if the pointer strays outside the track's own bounding box mid-drag),
    // not a requirement for the click/drag-to-value behavior itself to work.
    // `setPointerCapture` throws `NotFoundError` for any pointer id the
    // browser doesn't recognize as an currently-active pointer (confirmed
    // live: this happens for automation-dispatched pointer events, and isn't
    // guaranteed to hold for every real input path either) - letting that
    // exception propagate would have silently killed the arc's own value
    // update on every affected pointerdown, which is the actual point of
    // this handler, so it's wrapped defensively rather than left to throw.
    try {
      arcTrack.setPointerCapture(event.pointerId);
    } catch {
      // Best-effort only - see above.
    }
    handleArcPointer(event.clientX);
  });
  arcTrack.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    handleArcPointer(event.clientX);
  });
  const endArcDrag = (event: PointerEvent): void => {
    dragging = false;
    try {
      if (arcTrack.hasPointerCapture(event.pointerId)) {
        arcTrack.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Best-effort only - see the pointerdown handler's own comment above.
    }
  };
  arcTrack.addEventListener("pointerup", endArcDrag);
  arcTrack.addEventListener("pointercancel", endArcDrag);
  // Basic keyboard access, reusing the existing nudge behavior rather than
  // inventing separate keyboard-specific rate math.
  arcTrack.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      options.onNudge(-1);
    } else if (event.key === "ArrowRight") {
      options.onNudge(1);
    }
  });

  arcCluster.append(buttonRow, arcTrack);

  const rateReadout = document.createElement("div");
  rateReadout.className = "player-rate-readout";
  rateReadout.textContent = formatPlayerRateYearsPerSecond(
    logSpeedSliderToYearsPerSecond(options.defaultRateSliderValue),
  );

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "player-collapse-toggle";
  collapseButton.textContent = COLLAPSE_GLYPH;
  collapseButton.setAttribute("aria-label", "Collapse player panel");
  collapseButton.addEventListener("click", () => options.onCollapse());

  controlBar.append(todayButton, timeReadout, arcCluster, rateReadout, collapseButton);
  panel.appendChild(controlBar);

  return {
    element: panel,
    setVisible(visible: boolean) {
      panel.classList.toggle("open", visible);
    },
    update(state: PlayerPanelState) {
      timeReadout.textContent = formatPlayerTimeYears(state.tYears);
      // Avoid stomping the scrubber's own value while the DOM might be
      // mid-drag: setting an equal string value is a harmless no-op, and
      // this keeps it in sync with state changes driven from elsewhere
      // (play advancing, the Today button, sphere-exit reset).
      scrubber.value = String(Math.round(state.tYears));
      renderArc(state.rateSliderValue);
      rateReadout.textContent = formatPlayerRateYearsPerSecond(
        logSpeedSliderToYearsPerSecond(state.rateSliderValue),
      );
      // Story #266: the center Play/Pause button's glyph swaps between play
      // (▶) and pause (⏸) based on `playing` ALONE - simpler than #247's old
      // per-direction-button glyph swap, since direction no longer factors
      // into which glyph shows.
      playPauseButton.textContent = state.playing ? PAUSE_GLYPH : PLAY_GLYPH;
      playPauseButton.classList.toggle("active", state.playing);
      playPauseButton.setAttribute("aria-pressed", String(state.playing));
    },
  };
}
