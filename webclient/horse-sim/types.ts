export type EventKind = "BOOST" | "STUMBLE";

export type HorseStats = {
  name?: string;
  speed: number; // 0-100
  accel: number; // 0-100
  stamina: number; // 0-100
  stability: number; // 0-100
  cornering: number; // 0-100
};

export type RuntimeEvent = {
  kind: EventKind;
  startFrac: number; // 0..1 (distance / track length)
  durationFrac: number; // 0..1
  magnitude: number; // fractional multiplier strength
};

export type RaceHorseInput = {
  id: string;
  stats: HorseStats;
};

export type TrackSegment = {
  startFrac: number;
  endFrac: number;
  type: "straight" | "corner";
};

export type Track = {
  length: number;
  segments: TrackSegment[];
  allowEventsInCorners?: boolean;
};

export type RaceTimelineSample = {
  t: number; // seconds
  positions: number[]; // absolute distance
  speeds: number[]; // current speed
};

export type RaceResult = {
  winnerIndex: number;
  finishTimes: number[]; // seconds
  finalPositions: number[]; // clamped to track length
  timeline?: RaceTimelineSample[];
  events: RuntimeEvent[][];
  conditions: number[];
  seedUsed: number;
};

export type OddsResult = {
  winProbs: number[];
  displayOdds: number[]; // decimal odds after house edge
  houseEdge: number;
  sims: number;
};

export type RoundData = {
  horses: RaceHorseInput[];
  odds: OddsResult;
  track: Track;
  seedUsed: number;
};

