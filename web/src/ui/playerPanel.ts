import { PLAYER_TIME_RANGE_YEARS, formatPlayerTimeYears, type PlayerDirection } from "../scene/motionPlayer";

/**
 * Story #239: the motion player's own control panel - a transport bar, a
 * logarithmic-scale speed slider, a current-time readout, a full-range
 * scrubber, and a "Today" button (Epic #238's settled UI shape). Plain DOM,
 * no framework, matching `ui/controls.ts`'s own convention - and, like that
 * module's DOM-building half, not itself unit-tested (`vite.config.ts` runs
 * Vitest with `environment: "node"`; see `motionPlayer.ts` for the actual
 * testable decision logic this panel's event handlers call into via
 * `main.ts`).
 *
 * Story #243: replaced the single Play/Pause toggle button with the classic
 * `|< < > >|` transport scheme - `PLAY_BACKWARD_GLYPH`/`PLAY_FORWARD_GLYPH`
 * are dedicated continuous-play direction buttons (`onPlayDirection` below),
 * `STEP_BACK_GLYPH`/`STEP_FORWARD_GLYPH` apply a single fixed step
 * (`onStep`). This panel still makes no decisions of its own about what
 * pressing one of these means (toggle vs. reverse vs. pause-then-step) -
 * that interaction logic lives entirely in `motionPlayer.ts`'s
 * `nextPlayerPlaybackStateForDirectionButton`/`stepPlayerTimeYears`, driven
 * by `main.ts`; this module only reports which button was pressed and
 * renders whatever state `update()` is next handed.
 *
 * This module owns no player STATE itself (no `tYears`/`playing` fields) -
 * it is a thin, stateless view: `main.ts` is the single source of truth for
 * the player's actual state, pushing it into this panel via `update()` every
 * animation frame, and reading user intent back out via the callbacks in
 * `PlayerPanelOptions`. This mirrors `ui/controls.ts`'s own
 * callback-driven shape (`onCategoryToggle`/`onRadiusChange`/etc.) rather
 * than inventing a second, parallel state-management convention for one
 * more panel.
 */

export interface PlayerPanelOptions {
  /** A continuous-play direction button (`<` or `>`) was pressed - `main.ts`
   * resolves what this actually does (start, pause-toggle, or reverse) via
   * `nextPlayerPlaybackStateForDirectionButton`. */
  onPlayDirection: (direction: PlayerDirection) => void;
  /** A step button (`|<` or `>|`) was pressed - `main.ts` pauses (if
   * playing) then applies a single `stepPlayerTimeYears` nudge. */
  onStep: (direction: PlayerDirection) => void;
  /** The scrubber was dragged to a new absolute year value (un-clamped -
   * `main.ts` clamps via `clampPlayerTimeYears` before storing it). */
  onScrub: (tYears: number) => void;
  /** The speed slider moved to a new `[0, 1]` MAGNITUDE-only control value
   * (Story #243 - direction no longer comes from the slider's sign) -
   * `main.ts` stores this raw and maps it through
   * `logSpeedSliderToYearsPerSecond` only when actually advancing time, so
   * the panel needn't know that mapping at all. */
  onSpeedChange: (sliderValue: number) => void;
  /** The "Today" button was pressed. */
  onToday: () => void;
  /** Initial speed-slider MAGNITUDE (`[0, 1]`) - see `main.ts`'s
   * `DEFAULT_PLAYER_SPEED_MAGNITUDE` for the chosen live-tuned default. */
  defaultSpeedMagnitude: number;
}

export interface PlayerPanelState {
  tYears: number;
  playing: boolean;
  /** Which direction is playing (if `playing`) or would resume (if not) -
   * Story #243, used to highlight the currently-active `<`/`>` button. */
  direction: PlayerDirection;
}

export interface PlayerPanelHandle {
  element: HTMLDivElement;
  /** Shows/hides the whole panel (`main.ts` calls this when the toolbar
   * button first opens it, and when a sphere exit force-hides it - Epic
   * #238 AC). */
  setVisible: (visible: boolean) => void;
  /** Pushes the current player state into the panel's own DOM (time
   * readout text, scrubber position, which direction button reads active) -
   * called every animation frame from `main.ts`'s `applyPlayerAnimation`,
   * mirroring how `applyFovReadout`/`applyGalacticCenterLabelPosition`
   * already re-render their own small DOM bits every frame. */
  update: (state: PlayerPanelState) => void;
}

// Story #243: the classic 4-button transport scheme's glyphs - step-back,
// play-backward, play-forward, step-forward, in that left-to-right reading
// order (matching the issue's own `|< < > >|` shorthand).
const STEP_BACK_GLYPH = "⏮"; // |<
const PLAY_BACKWARD_GLYPH = "◀"; // <
const PLAY_FORWARD_GLYPH = "▶"; // >
const STEP_FORWARD_GLYPH = "⏭"; // >|

export function createPlayerPanel(options: PlayerPanelOptions): PlayerPanelHandle {
  const panel = document.createElement("div");
  panel.id = "player-panel";
  panel.className = "panel";

  const topRow = document.createElement("div");
  topRow.className = "player-panel-row player-panel-top";

  const stepBackButton = document.createElement("button");
  stepBackButton.type = "button";
  stepBackButton.className = "player-transport player-step-back";
  stepBackButton.textContent = STEP_BACK_GLYPH;
  stepBackButton.setAttribute("aria-label", "Step back one increment");
  stepBackButton.addEventListener("click", () => options.onStep(-1));

  const playBackwardButton = document.createElement("button");
  playBackwardButton.type = "button";
  playBackwardButton.className = "player-transport player-play-backward";
  playBackwardButton.textContent = PLAY_BACKWARD_GLYPH;
  playBackwardButton.setAttribute("aria-label", "Play backward through time");
  playBackwardButton.addEventListener("click", () => options.onPlayDirection(-1));

  const playForwardButton = document.createElement("button");
  playForwardButton.type = "button";
  playForwardButton.className = "player-transport player-play-forward";
  playForwardButton.textContent = PLAY_FORWARD_GLYPH;
  playForwardButton.setAttribute("aria-label", "Play forward through time");
  playForwardButton.addEventListener("click", () => options.onPlayDirection(1));

  const stepForwardButton = document.createElement("button");
  stepForwardButton.type = "button";
  stepForwardButton.className = "player-transport player-step-forward";
  stepForwardButton.textContent = STEP_FORWARD_GLYPH;
  stepForwardButton.setAttribute("aria-label", "Step forward one increment");
  stepForwardButton.addEventListener("click", () => options.onStep(1));

  const timeReadout = document.createElement("div");
  timeReadout.className = "player-time-readout";
  timeReadout.textContent = formatPlayerTimeYears(0);

  const todayButton = document.createElement("button");
  todayButton.type = "button";
  todayButton.className = "player-today";
  todayButton.textContent = "Today";
  todayButton.addEventListener("click", () => options.onToday());

  topRow.append(
    stepBackButton,
    playBackwardButton,
    playForwardButton,
    stepForwardButton,
    timeReadout,
    todayButton,
  );
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
  speedLabel.textContent = "Speed";

  const speedSlider = document.createElement("input");
  speedSlider.type = "range";
  speedSlider.className = "player-speed-slider";
  // Story #243: magnitude-only ([0, 1]) - direction now comes exclusively
  // from which of the `<`/`>` transport buttons is active, never from this
  // slider's sign (it no longer HAS a sign).
  speedSlider.min = "0";
  speedSlider.max = "1";
  speedSlider.step = "0.01";
  speedSlider.value = String(options.defaultSpeedMagnitude);
  speedSlider.setAttribute("aria-label", "Playback speed (logarithmic - slow at the low end, fast at the high end)");
  speedSlider.addEventListener("input", () => {
    options.onSpeedChange(Number(speedSlider.value));
  });

  speedRow.append(speedLabel, speedSlider);
  panel.appendChild(speedRow);

  return {
    element: panel,
    setVisible(visible: boolean) {
      panel.classList.toggle("open", visible);
    },
    update(state: PlayerPanelState) {
      timeReadout.textContent = formatPlayerTimeYears(state.tYears);
      // Avoid stomping the scrubber's own value while the DOM might be
      // mid-drag: setting an equal string value is a harmless no-op, and
      // this keeps the scrubber in sync with time changes driven from
      // elsewhere (play advancing, the Today button, sphere-exit reset).
      scrubber.value = String(Math.round(state.tYears));
      // Story #243: highlight whichever of `<`/`>` is the ACTIVELY playing
      // one (never both at once - `playing` plus `direction` together
      // uniquely determine at most one active button, per
      // `nextPlayerPlaybackStateForDirectionButton`'s own invariant).
      const forwardActive = state.playing && state.direction === 1;
      const backwardActive = state.playing && state.direction === -1;
      playForwardButton.classList.toggle("active", forwardActive);
      playForwardButton.setAttribute("aria-pressed", String(forwardActive));
      playBackwardButton.classList.toggle("active", backwardActive);
      playBackwardButton.setAttribute("aria-pressed", String(backwardActive));
    },
  };
}
