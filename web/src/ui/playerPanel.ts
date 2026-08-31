import { PLAYER_TIME_RANGE_YEARS, formatPlayerTimeYears } from "../scene/motionPlayer";

/**
 * Story #239: the motion player's own control panel - play/pause, a
 * logarithmic-scale speed slider, a current-time readout, a full-range
 * scrubber, and a "Today" button (Epic #238's settled UI shape). Plain DOM,
 * no framework, matching `ui/controls.ts`'s own convention - and, like that
 * module's DOM-building half, not itself unit-tested (`vite.config.ts` runs
 * Vitest with `environment: "node"`; see `motionPlayer.ts` for the actual
 * testable decision logic this panel's event handlers call into via
 * `main.ts`).
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
  /** Play/pause button (either this panel's own, or the toolbar's) pressed. */
  onTogglePlayPause: () => void;
  /** The scrubber was dragged to a new absolute year value (un-clamped -
   * `main.ts` clamps via `clampPlayerTimeYears` before storing it). */
  onScrub: (tYears: number) => void;
  /** The speed slider moved to a new `[-1, 1]` control value - `main.ts`
   * stores this raw and maps it through `logSpeedSliderToYearsPerSecond`
   * only when actually advancing time, so the panel needn't know that
   * mapping at all. */
  onSpeedChange: (sliderValue: number) => void;
  /** The "Today" button was pressed. */
  onToday: () => void;
  /** Initial speed-slider position (`[-1, 1]`) - see `main.ts`'s
   * `DEFAULT_PLAYER_SPEED_SLIDER_VALUE` for the chosen live-tuned default. */
  defaultSpeedSliderValue: number;
}

export interface PlayerPanelState {
  tYears: number;
  playing: boolean;
}

export interface PlayerPanelHandle {
  element: HTMLDivElement;
  /** Shows/hides the whole panel (`main.ts` calls this when the toolbar
   * button first opens it, and when a sphere exit force-hides it - Epic
   * #238 AC). */
  setVisible: (visible: boolean) => void;
  /** Pushes the current player state into the panel's own DOM (time
   * readout text, scrubber position, play/pause glyph) - called every
   * animation frame from `main.ts`'s `applyPlayerAnimation`, mirroring how
   * `applyFovReadout`/`applyGalacticCenterLabelPosition` already
   * re-render their own small DOM bits every frame. */
  update: (state: PlayerPanelState) => void;
}

const PLAY_GLYPH = "▶"; // ▶
const PAUSE_GLYPH = "⏸"; // ⏸

export function createPlayerPanel(options: PlayerPanelOptions): PlayerPanelHandle {
  const panel = document.createElement("div");
  panel.id = "player-panel";
  panel.className = "panel";

  const topRow = document.createElement("div");
  topRow.className = "player-panel-row player-panel-top";

  const playPauseButton = document.createElement("button");
  playPauseButton.type = "button";
  playPauseButton.className = "player-play-pause";
  playPauseButton.textContent = PLAY_GLYPH;
  playPauseButton.setAttribute("aria-label", "Play/pause star motion");
  playPauseButton.addEventListener("click", () => options.onTogglePlayPause());

  const timeReadout = document.createElement("div");
  timeReadout.className = "player-time-readout";
  timeReadout.textContent = formatPlayerTimeYears(0);

  const todayButton = document.createElement("button");
  todayButton.type = "button";
  todayButton.className = "player-today";
  todayButton.textContent = "Today";
  todayButton.addEventListener("click", () => options.onToday());

  topRow.append(playPauseButton, timeReadout, todayButton);
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
  speedSlider.min = "-1";
  speedSlider.max = "1";
  speedSlider.step = "0.01";
  speedSlider.value = String(options.defaultSpeedSliderValue);
  speedSlider.setAttribute("aria-label", "Playback speed (logarithmic - center is slow, ends are fast)");
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
      playPauseButton.textContent = state.playing ? PAUSE_GLYPH : PLAY_GLYPH;
      playPauseButton.setAttribute("aria-pressed", String(state.playing));
    },
  };
}
