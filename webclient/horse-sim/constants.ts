// Tunable constants for the horse racing simulation.

import { Track } from "./types";

export const TRACK_LENGTH = 1000; // units (single lap)
export const LAPS = 2;

export const TRACK_SEGMENTS: Track["segments"] = [
  { startFrac: 0.0, endFrac: 0.42, type: "straight" },
  { startFrac: 0.42, endFrac: 0.5, type: "corner" },
  { startFrac: 0.5, endFrac: 0.92, type: "straight" },
  { startFrac: 0.92, endFrac: 1.0, type: "corner" },
];

export const DEFAULT_TRACK: Track = {
  length: TRACK_LENGTH,
  segments: TRACK_SEGMENTS,
  allowEventsInCorners: false,
};

export const DT = 1 / 60; // seconds per tick
export const MAX_TICKS = 12000; // ~200s safety cap
export const TIMELINE_INTERVAL = 0.2; // seconds between samples

// Base speed/accel parameters
export const VMAX0 = 10.5; // base top speed
export const VMAX1 = 7.5; // added top speed at 100 speed stat
export const ACCEL0 = 0.65; // base accel rate
export const ACCEL1 = 0.9; // added accel at 100 accel stat

// Condition factor
export const COND_MIN = 0.85;
export const COND_MAX = 1.15;
export const COND_SIGMA_MIN = 0.02;
export const COND_SIGMA_MAX = 0.1;

// Fatigue (stamina)
export const FAT_START = 0.55; // where fatigue starts ramping
export const FAT_SHARPNESS = 12;
export const FAT_MAX_HIGH = 0.28; // low stamina -> high fatigue
export const FAT_MAX_LOW = 0.06; // high stamina -> low fatigue

// Cornering penalty
export const CORNER_PENALTY_BASE = 0.1;

// Volatility events
export const EVENT_START_MIN = 0.15;
export const EVENT_START_MAX = 0.85;
export const EVENT_DUR_MIN = 0.05;
export const EVENT_DUR_MAX = 0.12;
export const EVENT_MAG_MIN = 0.04;
export const EVENT_MAG_MAX = 0.12;

// Stats generation
export const STAT_MIN = 30;
export const STAT_MAX = 95;

// Odds / Monte Carlo
export const DEFAULT_SIMS = 1200;
export const HOUSE_EDGE = 0.05;
