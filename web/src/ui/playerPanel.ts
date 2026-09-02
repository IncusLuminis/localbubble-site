import {
  arcDragFractionToPlayerTimeYears,
  arcDragFractionToRateSliderValue,
  formatPlayerRateYearsPerSecond,
  formatPlayerTimeTickLabel,
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
 * 1. "Today" (unchanged jump-to-zero behavior, moved far left) - Story #275
 *    Part 3.3 later moves this again, see below.
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
 * 5. A collapse chevron (`onCollapse`, new in #267) - originally reused
 *    #249's existing close+reset-to-Today action (the same thing the
 *    toolbar Play button did when the panel was open); Story #275
 *    overrides this, see below.
 *
 * Story #275 (behavior + visual follow-up, layered on #267/#271's look):
 * - `onCollapse` no longer resets time/playing/rate - it's a genuine
 *   minimize now (`main.ts`'s `collapsePlayerPanel` just flips
 *   `playerPanelOpen` back to `false`, revealing the new sphere-gated
 *   "TIME CONTROLS" collapsed indicator built in `main.ts`, a sibling
 *   element of this panel - NOT built by this module). Only leaving the
 *   RECONS sphere still resets those three fields.
 * - "Today" moves OUT of the bullet-3 control bar above into its own
 *   dedicated, centered `todayRow`, directly below the `<<`/Play-Pause/`>>`
 *   button row - see `todayRow` below.
 * - Both arcs' curvature is flipped (bow downward, not upward) and enlarged
 *   - see `ARC_START`/`ARC_CONTROL`/`ARC_END`'s own updated docstring.
 * - The elapsed-time readout and rate readout are enlarged (`style.css`),
 *   and the collapse chevron is enlarged (`style.css`).
 * - The panel's overall height grows ~30% as a consequence of the above
 *   (taller arcs, the new `todayRow`, bigger fonts/buttons) plus a direct
 *   padding/gap increase in `style.css`.
 *
 * Story #271 (follow-up to #267): the full-range absolute-time scrubber
 * (`onScrub`, unchanged behavior/range since #239) was, until this Story, a
 * plain `<input type="range">` kept as its own slim row ABOVE the #267
 * control bar - the one piece of the panel that never got #267's visual
 * treatment. Per the human owner's own NASA "Eyes on the Solar System"
 * reference screenshot, it's now a SECOND shallow arc (`.player-time-arc*`),
 * positioned directly BELOW the rate arc/control bar rather than above it,
 * reusing the exact same `ARC_START`/`ARC_CONTROL`/`ARC_END` quadratic-bezier
 * geometry as the rate arc (`arcPointAtT` is shared, unmodified) - only the
 * on-screen CSS box is wider/full-panel-width, which alone is what gives it
 * the "larger, wrapping-around-the-first-arc" look the issue asked for
 * ("как бы огибая его") without needing a second curve shape. Its drag
 * surface (`.player-time-arc-track`) reuses the same Pointer Events
 * mouse+touch drag-to-value pattern as the rate arc, mapped through the new
 * `arcDragFractionToPlayerTimeYears` (mirrors `arcDragFractionToRateSliderValue`,
 * just over `[-PLAYER_TIME_RANGE_YEARS, +PLAYER_TIME_RANGE_YEARS]`) into the
 * SAME `onScrub` callback the old `<input>` called - this is a visual
 * restyle only, not a new control.
 *
 * Story #273 (tuning/polish follow-up to #271): adds >= 5 labeled, static
 * tick marks to the time arc (`buildTimeArcTicks` below) - small dim dot
 * markers ON the curve itself (SVG, positioned via the exact same
 * `arcPointAtT` call the handle/fill path use, via `playerTimeYearsToArcT`
 * for the same value-to-`t` mapping `renderTimeArc` uses) plus a compact
 * (`formatPlayerTimeTickLabel`) text label per tick, in a dedicated row
 * BELOW the arc rather than overlaid on the SVG itself - the SVG's own
 * `preserveAspectRatio="none"` non-uniform stretch (deliberate, see the
 * `.player-time-arc-row` CSS comment) would visibly squash/stretch SVG
 * `<text>` glyphs, so the labels are plain HTML instead, horizontally
 * aligned via the same tick point's `x` fraction of the arc's own viewBox
 * width (which lines up correctly since both rows span the identical
 * on-screen panel width). Every tick element is `pointer-events: none` and
 * lives outside `.player-time-arc-track`'s own bounding box, so none of
 * this can ever intercept a drag.
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
  /** The collapse chevron was pressed. Story #267 originally wired this to
   * the same close+reset-to-Today action the toolbar Play button performed
   * when the panel was open. Story #275 overrides that: `main.ts` now wires
   * this to `collapsePlayerPanel`, a genuine MINIMIZE - it hides this panel
   * and reveals the sphere-gated "TIME CONTROLS" collapsed indicator again,
   * WITHOUT touching time/playing/rate at all. Only leaving the RECONS
   * sphere still resets those. */
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
  /** Shows/hides the whole panel (`main.ts` calls this when the "TIME
   * CONTROLS" collapsed indicator opens it, when the collapse chevron
   * minimizes it back, and when a sphere exit force-hides it - Epic #238
   * AC, Story #275). */
  setVisible: (visible: boolean) => void;
  /** Pushes the current player state into the panel's own DOM (time
   * readout text, time-arc handle position (Story #271), rate arc handle
   * position, rate readout text, Play/Pause glyph) - called every animation
   * frame from
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
// end, reading as a shallow slice of a large circle's rim (per the issue's
// own "sector 10-15 degrees... not a speedometer gauge" guidance) rather
// than a deep dial sweep. Values are in the SVG's own `viewBox` units, not
// pixels - `preserveAspectRatio="none"` lets the CSS box stretch this to
// whatever on-screen size the panel's layout gives it.
//
// Story #275 Part 3.2: flips the curvature - #267/#271 originally raised the
// control point ABOVE the two endpoints (apex Y=2 < endpoints Y=24 in SVG
// coordinates, where smaller Y is higher on screen), so both arcs bowed
// UPWARD. The human owner's reference screenshot bows DOWNWARD instead (the
// arc sags toward the bottom in the middle), so the control point now sits
// BELOW the two endpoints (apex Y=34 > endpoints Y=6). Both arcs still share
// this exact same geometry (`arcPointAtT` below), so they stay a "matching
// stacked pair" per #271's own requirement - only the curvature direction
// changed, not the shape family. The sag (apex-to-endpoint Y distance) is
// also larger than before (28 vs. the original 22 units) and the CSS boxes
// that stretch this viewBox are taller too (`.player-rate-arc-track`/
// `.player-time-arc-track` in `style.css`) - together, "larger arcs" per
// Part 3.2.
const ARC_VIEWBOX_WIDTH = 200;
const ARC_VIEWBOX_HEIGHT = 40;
const ARC_START: readonly [number, number] = [6, 6];
const ARC_CONTROL: readonly [number, number] = [ARC_VIEWBOX_WIDTH / 2, 34];
const ARC_END: readonly [number, number] = [ARC_VIEWBOX_WIDTH - 6, 6];
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

/** Story #271: `[-PLAYER_TIME_RANGE_YEARS, +PLAYER_TIME_RANGE_YEARS]`
 * absolute-time value -> `[0, 1]` bezier parameter, mirroring
 * `rateSliderValueToArcT` above for the new time arc (center `t = 0.5` is
 * year 0 / "Today", same apex convention). */
function playerTimeYearsToArcT(tYears: number): number {
  const clamped = Math.max(-PLAYER_TIME_RANGE_YEARS, Math.min(PLAYER_TIME_RANGE_YEARS, tYears));
  return (clamped / PLAYER_TIME_RANGE_YEARS + 1) / 2;
}

export function createPlayerPanel(options: PlayerPanelOptions): PlayerPanelHandle {
  const panel = document.createElement("div");
  panel.id = "player-panel";
  panel.className = "panel";

  // Story #271: the last `tYears` this stateless panel was told about via
  // `update()` - only needed for the time arc's own keyboard-nudge handler
  // below (mirrors why `main.ts`, not this panel, is the actual source of
  // truth for player state - this is purely a read cache for that one
  // interaction, not a second copy of state).
  let latestTYears = 0;

  // Story #267: the NASA-Eyes-style bottom control bar - time readout, the
  // arc+buttons cluster, rate readout, collapse chevron, in that
  // left-to-right reading order. Story #275 Part 3.3 moves "Today" OUT of
  // this row entirely (see `todayRow` below) - elapsed-time now sits
  // directly LEFT of the button/arc cluster and rate directly RIGHT of it,
  // matching the reference screenshot's date-left/time-right convention.
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

  /** Redraws a given arc's fill sub-path and handle position for bezier
   * parameter `targetT` - shared by BOTH arcs (the rate arc and, since Story
   * #271, the time arc beneath it), each just handing in their own
   * `<circle>`/`<path>` elements. Used by the initial render, `update()`,
   * and every drag/nudge-driven change (the drag path calls
   * `onRateChange`/`onScrub`, which `main.ts` reflects back into the next
   * `update()` call, so this only needs to run from `update()` in practice,
   * but is kept as its own function for the initial-render calls below
   * rather than duplicating the math). */
  function paintArcAtT(targetT: number, arcHandle: SVGCircleElement, arcFillPath: SVGPathElement): void {
    const [hx, hy] = arcPointAtT(targetT);
    arcHandle.setAttribute("cx", String(hx));
    arcHandle.setAttribute("cy", String(hy));

    const startT = Math.min(0.5, targetT);
    const endT = Math.max(0.5, targetT);
    const points: string[] = [];
    for (let i = 0; i <= ARC_FILL_SAMPLE_STEPS; i++) {
      const t = startT + ((endT - startT) * i) / ARC_FILL_SAMPLE_STEPS;
      const [x, y] = arcPointAtT(t);
      points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    arcFillPath.setAttribute("d", points.join(" "));
  }
  function renderRateArc(value: number): void {
    paintArcAtT(rateSliderValueToArcT(value), handle, fillPath);
  }
  renderRateArc(options.defaultRateSliderValue);

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

  // Story #271: the second, larger arc beneath the rate arc/control bar -
  // the restyled absolute-time scrubber. Own full-width row (not nested
  // inside `arcCluster`, unlike the rate arc, which shares its row with
  // Today/the readouts/the collapse button) so its on-screen CSS box spans
  // the whole panel width rather than just the arc cluster's own flexible
  // middle slice - stretching the SAME `ARC_START`/`ARC_CONTROL`/`ARC_END`
  // geometry (via `preserveAspectRatio="none"`, exactly like the rate arc)
  // across a wider box is what makes it read as a bigger, shallower,
  // "wrapping around" echo of the rate arc above it, without inventing a
  // second curve shape.
  const timeArcRow = document.createElement("div");
  timeArcRow.className = "player-panel-row player-time-arc-row";

  const timeArcTrack = document.createElement("div");
  timeArcTrack.className = "player-time-arc-track";
  timeArcTrack.setAttribute("role", "slider");
  timeArcTrack.setAttribute("aria-label", "Scrub time");
  timeArcTrack.setAttribute("aria-valuemin", String(-PLAYER_TIME_RANGE_YEARS));
  timeArcTrack.setAttribute("aria-valuemax", String(PLAYER_TIME_RANGE_YEARS));
  timeArcTrack.tabIndex = 0;

  const timeArcSvg = document.createElementNS(svgNs, "svg");
  timeArcSvg.setAttribute("class", "player-time-arc-svg");
  timeArcSvg.setAttribute("viewBox", `0 0 ${ARC_VIEWBOX_WIDTH} ${ARC_VIEWBOX_HEIGHT}`);
  timeArcSvg.setAttribute("preserveAspectRatio", "none");
  timeArcSvg.setAttribute("aria-hidden", "true");

  const timeTrackPath = document.createElementNS(svgNs, "path");
  timeTrackPath.setAttribute("class", "player-time-arc-track-path");
  timeTrackPath.setAttribute("d", arcPathD);
  timeTrackPath.setAttribute("fill", "none");

  const timeFillPath = document.createElementNS(svgNs, "path");
  timeFillPath.setAttribute("class", "player-time-arc-fill-path");
  timeFillPath.setAttribute("fill", "none");

  // Story #271: a small, dim, non-interactive reference dot fixed at year 0
  // ("Today") - echoes the reference screenshot's own smaller gray dot
  // alongside the larger draggable handle, and gives the arc a fixed visual
  // anchor point (the `Today` button jumps here) independent of wherever the
  // draggable handle currently sits.
  const timeTodayMarker = document.createElementNS(svgNs, "circle");
  timeTodayMarker.setAttribute("class", "player-time-arc-today-marker");
  timeTodayMarker.setAttribute("r", "2.5");
  const [todayMarkerX, todayMarkerY] = arcPointAtT(0.5);
  timeTodayMarker.setAttribute("cx", String(todayMarkerX));
  timeTodayMarker.setAttribute("cy", String(todayMarkerY));

  const timeHandle = document.createElementNS(svgNs, "circle");
  timeHandle.setAttribute("class", "player-time-arc-handle");
  timeHandle.setAttribute("r", "4.5");

  timeArcSvg.append(timeTrackPath, timeFillPath, timeTodayMarker, timeHandle);
  timeArcTrack.appendChild(timeArcSvg);

  function renderTimeArc(tYears: number): void {
    paintArcAtT(playerTimeYearsToArcT(tYears), timeHandle, timeFillPath);
  }
  renderTimeArc(0);

  // Story #273: >= 5 static, decorative tick marks + labels along the time
  // arc, so it reads as an actual labeled scale rather than a bare curve.
  // Evenly spaced across the arc's own `[0,1]` parametrization
  // (`t = 0, 0.25, 0.5, 0.75, 1.0`), matching `PLAYER_TIME_RANGE_YEARS`'s
  // settled `+/-1,000,000`-year range exactly - the issue's own suggested
  // default. Built ONCE here (not from `update()`/`renderTimeArc` above):
  // unlike the handle/fill path, these values never change with player
  // state.
  const TIME_ARC_TICK_YEARS: readonly number[] = [
    -PLAYER_TIME_RANGE_YEARS,
    -PLAYER_TIME_RANGE_YEARS / 2,
    0,
    PLAYER_TIME_RANGE_YEARS / 2,
    PLAYER_TIME_RANGE_YEARS,
  ];

  // The tick marks themselves: small dim dots placed EXACTLY on the curve
  // via the same `arcPointAtT`/`playerTimeYearsToArcT` geometry the
  // handle/fill path and the existing `timeTodayMarker` already use - never
  // approximated by separate straight-line math. `pointer-events: none`
  // (mirroring `.player-time-arc-today-marker`'s own existing convention)
  // keeps them purely decorative; they also render into the SVG, entirely
  // inside `timeArcTrack`'s own hit area, so this alone would already be
  // safe even without the CSS rule, since drag handling is wired on
  // `timeArcTrack` itself and events bubble up regardless.
  const tickMarkersGroup = document.createElementNS(svgNs, "g");
  tickMarkersGroup.setAttribute("class", "player-time-arc-ticks");
  tickMarkersGroup.setAttribute("aria-hidden", "true");

  // The tick LABELS: plain HTML (not SVG `<text>`), in their own row BELOW
  // the arc - see this module's top docstring (Story #273 paragraph) for
  // why: the arc SVG's `preserveAspectRatio="none"` non-uniform stretch,
  // which is what gives the curve itself its wide, shallow look, would also
  // squash/stretch SVG text glyphs if labels were drawn inside that same
  // SVG. Horizontal position still comes from the SAME `arcPointAtT` point
  // as each tick's own dot (just read as an `x`-fraction of the arc's own
  // viewBox width rather than a raw SVG coordinate), so labels line up with
  // their dots exactly - this row spans the identical on-screen panel width
  // as the arc track above it, so that fraction maps directly to the same
  // horizontal position in both places.
  const tickLabelsRow = document.createElement("div");
  tickLabelsRow.className = "player-panel-row player-time-arc-tick-row";
  tickLabelsRow.setAttribute("aria-hidden", "true");

  for (const tickYears of TIME_ARC_TICK_YEARS) {
    const [tickX, tickY] = arcPointAtT(playerTimeYearsToArcT(tickYears));

    // Skips a redundant dot exactly at year 0 - `timeTodayMarker` above
    // already marks that exact point; this just adds this tick's label
    // alongside it rather than drawing a second, visually-identical dot on
    // top.
    if (tickYears !== 0) {
      const tickDot = document.createElementNS(svgNs, "circle");
      tickDot.setAttribute("class", "player-time-arc-tick");
      tickDot.setAttribute("r", "1.5");
      tickDot.setAttribute("cx", String(tickX));
      tickDot.setAttribute("cy", String(tickY));
      tickMarkersGroup.appendChild(tickDot);
    }

    const tickLabel = document.createElement("span");
    tickLabel.className = "player-time-arc-tick-label";
    tickLabel.textContent = formatPlayerTimeTickLabel(tickYears);
    tickLabel.style.left = `${(tickX / ARC_VIEWBOX_WIDTH) * 100}%`;
    tickLabelsRow.appendChild(tickLabel);
  }

  // Inserted BEFORE `timeTodayMarker`/`timeHandle` in paint order, so the
  // draggable handle and the Today reference dot both still visually sit on
  // top of these smaller, dimmer scale ticks wherever they happen to
  // overlap.
  timeArcSvg.insertBefore(tickMarkersGroup, timeTodayMarker);

  function handleTimeArcPointer(clientX: number): void {
    const rect = timeArcTrack.getBoundingClientRect();
    const fraction = rect.width === 0 ? 0.5 : (clientX - rect.left) / rect.width;
    options.onScrub(arcDragFractionToPlayerTimeYears(fraction));
  }

  let draggingTimeArc = false;
  timeArcTrack.addEventListener("pointerdown", (event) => {
    draggingTimeArc = true;
    // See the rate arc's own `pointerdown` handler above for why
    // `setPointerCapture` is wrapped defensively - same reasoning applies
    // verbatim here.
    try {
      timeArcTrack.setPointerCapture(event.pointerId);
    } catch {
      // Best-effort only - see above.
    }
    handleTimeArcPointer(event.clientX);
  });
  timeArcTrack.addEventListener("pointermove", (event) => {
    if (!draggingTimeArc) return;
    handleTimeArcPointer(event.clientX);
  });
  const endTimeArcDrag = (event: PointerEvent): void => {
    draggingTimeArc = false;
    try {
      if (timeArcTrack.hasPointerCapture(event.pointerId)) {
        timeArcTrack.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Best-effort only - see above.
    }
  };
  timeArcTrack.addEventListener("pointerup", endTimeArcDrag);
  timeArcTrack.addEventListener("pointercancel", endTimeArcDrag);
  // Basic keyboard access (the old `<input type="range">` had this for
  // free) - nudges by a fixed step off the LAST value this panel was told
  // about via `update()`, since this stateless panel doesn't otherwise know
  // the current absolute time.
  const TIME_ARC_KEYBOARD_STEP_YEARS = PLAYER_TIME_RANGE_YEARS / 100;
  timeArcTrack.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      options.onScrub(latestTYears - TIME_ARC_KEYBOARD_STEP_YEARS);
    } else if (event.key === "ArrowRight") {
      options.onScrub(latestTYears + TIME_ARC_KEYBOARD_STEP_YEARS);
    }
  });

  timeArcRow.appendChild(timeArcTrack);

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

  controlBar.append(timeReadout, arcCluster, rateReadout, collapseButton);
  panel.appendChild(controlBar);

  // Story #275 Part 3.3: "Today" moves into its own dedicated, centered row,
  // directly below the `<<`/Play-Pause/`>>` button row (and the rate arc
  // beneath it) - no longer inline with the time/rate readouts or the
  // collapse chevron the way it was in `controlBar` above.
  const todayRow = document.createElement("div");
  todayRow.className = "player-panel-row player-today-row";
  todayRow.appendChild(todayButton);
  panel.appendChild(todayRow);

  // Story #271: the time arc's own row, directly BELOW the control bar (and
  // so below the rate arc it sits under) - see this function's own
  // `timeArcRow` comment above for why it's a separate full-width row
  // rather than nested inside `arcCluster`.
  panel.appendChild(timeArcRow);
  // Story #273: the tick-label row, directly below the time arc's own row -
  // see the tick-building block above for why these are plain HTML in a
  // separate row rather than SVG `<text>` inside `timeArcSvg` itself.
  panel.appendChild(tickLabelsRow);

  return {
    element: panel,
    setVisible(visible: boolean) {
      panel.classList.toggle("open", visible);
    },
    update(state: PlayerPanelState) {
      timeReadout.textContent = formatPlayerTimeYears(state.tYears);
      latestTYears = state.tYears;
      // Story #271: keeps the time arc's handle in sync with `tYears`
      // regardless of what's driving it (play advancing, the Today button,
      // the time arc's own drag, sphere-exit reset) - same "re-render from
      // state every frame" approach the rate arc already used below.
      renderTimeArc(state.tYears);
      renderRateArc(state.rateSliderValue);
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
