import { PLAYER_TIME_RANGE_YEARS, formatPlayerTimeYears, type PlayerDirection } from "../scene/motionPlayer";

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
 * redesign - Story #267 does the matching visual redesign once this merges):
 * reworked this same interim layout for the new signed-rate state model,
 * per the human owner's confirmed design:
 * - The `|<`/`>|` step buttons are gone entirely, no replacement.
 * - The `<`/`>` continuous-play direction buttons are repurposed into
 *   `<<`/`>>` NUDGE buttons (`onNudge` below) - they no longer start/stop/
 *   reverse playback themselves, they only nudge the signed rate slider
 *   value via `motionPlayer.ts`'s `nudgeRateSliderValue`.
 * - A single, new, plain Play/Pause button (`onPlayPauseToggle`) replaces
 *   the old per-direction toggle - a much simpler glyph swap than Story
 *   #247's old one, since it depends on `playing` alone, never on rate sign
 *   or magnitude.
 * - The speed slider is repurposed into the SIGNED `[-1, 1]` rate control
 *   itself (`onRateChange`) - same `<input type="range">` element, just
 *   different min/max/semantics.
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
  /** The rate slider moved to a new SIGNED `[-1, 1]` control value (Story
   * #266 - restores the pre-#243 signed shape: sign = direction, magnitude =
   * speed) - `main.ts` stores this raw and maps it through
   * `logSpeedSliderToYearsPerSecond` only when actually advancing time, so
   * the panel needn't know that mapping at all. */
  onRateChange: (sliderValue: number) => void;
  /** The "Today" button was pressed. */
  onToday: () => void;
  /** Initial rate-slider value (`[-1, 1]`, signed) - see `main.ts`'s
   * `DEFAULT_PLAYER_RATE_SLIDER_VALUE` for the chosen live-tuned default. */
  defaultRateSliderValue: number;
}

export interface PlayerPanelState {
  tYears: number;
  playing: boolean;
  /** The current signed `[-1, 1]` rate slider value - pushed into the rate
   * slider's own DOM value every frame (Story #266), mirroring how the
   * scrubber is kept in sync with `tYears` below, since `<<`/`>>` nudges
   * change this value from OUTSIDE a direct drag on the slider itself. */
  rateSliderValue: number;
}

export interface PlayerPanelHandle {
  element: HTMLDivElement;
  /** Shows/hides the whole panel (`main.ts` calls this when the toolbar
   * button first opens it, and when a sphere exit force-hides it - Epic
   * #238 AC). */
  setVisible: (visible: boolean) => void;
  /** Pushes the current player state into the panel's own DOM (time
   * readout text, scrubber position, rate slider position, Play/Pause
   * glyph) - called every animation frame from `main.ts`'s
   * `applyPlayerAnimation`, mirroring how `applyFovReadout`/
   * `applyGalacticCenterLabelPosition` already re-render their own small DOM
   * bits every frame. */
  update: (state: PlayerPanelState) => void;
}

// Story #266: the `<<`/`>>` nudge buttons and the single center Play/Pause
// button, in that left-to-right reading order (replacing #243's `|< < > >|`
// four-button transport scheme - the step buttons are gone, and `<`/`>` are
// repurposed rather than removed).
const NUDGE_BACK_GLYPH = "<<";
const NUDGE_FORWARD_GLYPH = ">>";
const PLAY_GLYPH = "▶";
const PAUSE_GLYPH = "⏸";

export function createPlayerPanel(options: PlayerPanelOptions): PlayerPanelHandle {
  const panel = document.createElement("div");
  panel.id = "player-panel";
  panel.className = "panel";

  const topRow = document.createElement("div");
  topRow.className = "player-panel-row player-panel-top";

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

  const todayButton = document.createElement("button");
  todayButton.type = "button";
  todayButton.className = "player-today";
  todayButton.textContent = "Today";
  todayButton.addEventListener("click", () => options.onToday());

  const nudgeForwardButton = document.createElement("button");
  nudgeForwardButton.type = "button";
  nudgeForwardButton.className = "player-transport player-nudge-forward";
  nudgeForwardButton.textContent = NUDGE_FORWARD_GLYPH;
  nudgeForwardButton.setAttribute("aria-label", "Nudge playback rate forward");
  nudgeForwardButton.addEventListener("click", () => options.onNudge(1));

  const timeReadout = document.createElement("div");
  timeReadout.className = "player-time-readout";
  timeReadout.textContent = formatPlayerTimeYears(0);

  // Story #247: "Today" moved between `<` and `>` (new order `|< < Today >
  // >|`, was `|< < > >| [readout] [Today]`) - Story #266 keeps that same
  // relative ordering with the repurposed controls: nudge-back, Play/Pause,
  // Today, nudge-forward, then the readout.
  topRow.append(nudgeBackButton, playPauseButton, todayButton, nudgeForwardButton, timeReadout);
  panel.appendChild(topRow);

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

  const speedRow = document.createElement("div");
  speedRow.className = "player-panel-row player-speed-row";

  const speedLabel = document.createElement("span");
  speedLabel.className = "player-speed-label";
  speedLabel.textContent = "Rate";

  const rateSlider = document.createElement("input");
  rateSlider.type = "range";
  rateSlider.className = "player-speed-slider";
  // Story #266: SIGNED ([-1, 1]) - center is near-zero/slow, left of center
  // is backward (growing magnitude toward -1), right of center is forward
  // (growing magnitude toward 1), NASA "Eyes on the Solar System" style -
  // restores the pre-#243 signed shape (see `logSpeedSliderToYearsPerSecond`'s
  // updated docstring).
  rateSlider.min = "-1";
  rateSlider.max = "1";
  rateSlider.step = "0.01";
  rateSlider.value = String(options.defaultRateSliderValue);
  rateSlider.setAttribute(
    "aria-label",
    "Playback rate (signed - left of center is backward, right of center is forward; logarithmic magnitude)",
  );
  rateSlider.addEventListener("input", () => {
    options.onRateChange(Number(rateSlider.value));
  });

  speedRow.append(speedLabel, rateSlider);
  panel.appendChild(speedRow);

  return {
    element: panel,
    setVisible(visible: boolean) {
      panel.classList.toggle("open", visible);
    },
    update(state: PlayerPanelState) {
      timeReadout.textContent = formatPlayerTimeYears(state.tYears);
      // Avoid stomping the scrubber's/slider's own value while the DOM might
      // be mid-drag: setting an equal string value is a harmless no-op, and
      // this keeps both in sync with state changes driven from elsewhere
      // (play advancing, a `<<`/`>>` nudge, the Today button, sphere-exit
      // reset).
      scrubber.value = String(Math.round(state.tYears));
      rateSlider.value = String(state.rateSliderValue);
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
