import {
  ACCEL0,
  ACCEL1,
  COND_MAX,
  COND_MIN,
  COND_SIGMA_MAX,
  COND_SIGMA_MIN,
  CORNER_PENALTY_BASE,
  DEFAULT_LAPS,
  DT,
  EVENT_DUR_MAX,
  EVENT_DUR_MIN,
  EVENT_MAG_MAX,
  EVENT_MAG_MIN,
  EVENT_START_MAX,
  EVENT_START_MIN,
  FAT_MAX_HIGH,
  FAT_MAX_LOW,
  FAT_SHARPNESS,
  FAT_START,
  MAX_TICKS,
  TIMELINE_INTERVAL,
  VMAX0,
  VMAX1,
} from "./constants";
import { clamp, createRng, hashSeed, lerp, sigmoid } from "./rng";
import { EventKind, RaceHorseInput, RaceResult, RuntimeEvent, Track } from "./types";

export type RaceOptions = {
  includeTimeline?: boolean;
  timelineInterval?: number;
  allowEventsInCorners?: boolean;
  laps?: number; // default 2
};

type HorseState = {
  idx: number;
  stats: RaceHorseInput["stats"];
  vmax: number;
  accel: number;
  pos: number;
  v: number;
  condition: number;
  events: RuntimeEvent[];
};

const isCorner = (track: Track, lapFrac: number) =>
  track.segments.some(
    (s) => s.type === "corner" && lapFrac >= s.startFrac && lapFrac < s.endFrac
  );

const sampleCondition = (stability: number, rng = createRng(1)) => {
  const instability = (100 - stability) / 100;
  const sigma = lerp(COND_SIGMA_MIN, COND_SIGMA_MAX, instability);
  const cond = rng.normal(1, sigma);
  return clamp(cond, COND_MIN, COND_MAX);
};

const drawEventCount = (stability: number, rng = createRng(1)) => {
  const u = (100 - stability) / 100;
  const p2 = clamp(0.05 + 0.3 * u, 0, 0.35);
  const p1 = clamp(0.15 + 0.4 * u, 0, 0.75);
  let p0 = 1 - p1 - p2;
  if (p0 < 0) p0 = 0;
  const total = p0 + p1 + p2 || 1;
  const r = rng.nextFloat() * total;
  if (r < p0) return 0;
  if (r < p0 + p1) return 1;
  return 2;
};

const buildEvents = (stats: RaceHorseInput["stats"], rng = createRng(1)): RuntimeEvent[] => {
  const u = (100 - stats.stability) / 100;
  const count = drawEventCount(stats.stability, rng);
  const events: RuntimeEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const startFrac = rng.nextRange(EVENT_START_MIN, EVENT_START_MAX);
    const durationFrac = rng.nextRange(EVENT_DUR_MIN, EVENT_DUR_MAX);
    const pBad = clamp(0.45 + 0.35 * u, 0.45, 0.8);
    const kind: EventKind = rng.nextFloat() < pBad ? "STUMBLE" : "BOOST";
    const baseMag = rng.nextRange(EVENT_MAG_MIN, EVENT_MAG_MAX);
    let magnitude = baseMag * (0.5 + 0.8 * u);
    if (kind === "STUMBLE") {
      magnitude *= 1 - 0.6 * (stats.stamina / 100);
    }
    events.push({ kind, startFrac, durationFrac, magnitude });
  }
  return events.sort((a, b) => a.startFrac - b.startFrac);
};

const eventMultiplier = (
  events: RuntimeEvent[],
  posFrac: number,
  inCorner: boolean,
  allowInCorners: boolean
) => {
  let mult = 1;
  for (const ev of events) {
    const end = ev.startFrac + ev.durationFrac;
    if (posFrac < ev.startFrac || posFrac > end) continue;
    if (inCorner && !allowInCorners) continue;
    const z = (posFrac - ev.startFrac) / ev.durationFrac;
    const bump = Math.pow(Math.sin(Math.PI * z), 2);
    const delta = ev.magnitude * bump;
    mult *= ev.kind === "BOOST" ? 1 + delta : 1 - delta;
  }
  return Math.max(0, mult);
};

const buildHorseState = (idx: number, horse: RaceHorseInput, seed: number): HorseState => {
  const rng = createRng(hashSeed(seed, `horse-${idx}`));
  const { stats } = horse;
  const condition = sampleCondition(stats.stability, rng);
  const vmaxBase = VMAX0 + VMAX1 * (stats.speed / 100);
  const accelBase = ACCEL0 + ACCEL1 * (stats.accel / 100);
  return {
    idx,
    stats,
    vmax: vmaxBase * condition,
    accel: accelBase * condition,
    pos: 0,
    v: 0,
    condition,
    events: buildEvents(stats, rng),
  };
};

export const simulateRace = (
  horses: RaceHorseInput[],
  track: Track,
  seed: number | string,
  options: RaceOptions = {}
): RaceResult => {
  const seedUsed = hashSeed(seed ?? 1, "race");
  const allowInCorners = options.allowEventsInCorners ?? track.allowEventsInCorners ?? false;
  const includeTimeline = options.includeTimeline ?? false;
  const timelineInterval = options.timelineInterval ?? TIMELINE_INTERVAL;
  const laps = options.laps ?? DEFAULT_LAPS;
  const totalLength = track.length * Math.max(1, laps);

  const states = horses.map((h, i) => buildHorseState(i, h, seedUsed));
  const finishTimes = Array(horses.length).fill(Number.POSITIVE_INFINITY);
  const finalPositions = Array(horses.length).fill(0);
  const conditions = states.map((s) => s.condition);
  const events = states.map((s) => s.events);
  const timeline = includeTimeline ? [] : undefined;

  let t = 0;
  let nextSample = 0;
  let finished = 0;

  for (let tick = 0; tick < MAX_TICKS && finished < horses.length; tick += 1) {
    for (const st of states) {
      if (Number.isFinite(finishTimes[st.idx])) continue;
      const totalFrac = st.pos / totalLength;
      const lapFrac = (st.pos % track.length) / track.length;
      const inCorner = isCorner(track, lapFrac);

      const fatigueCurve = sigmoid((totalFrac - FAT_START) * FAT_SHARPNESS);
      const fatigueMax = lerp(FAT_MAX_HIGH, FAT_MAX_LOW, st.stats.stamina / 100);
      const vmaxFatigued = st.vmax * (1 - fatigueMax * fatigueCurve);

      const cornerPenalty =
        inCorner && CORNER_PENALTY_BASE > 0
          ? CORNER_PENALTY_BASE *
            (1 - st.stats.cornering / 100) *
            (1 - 0.5 * (st.stats.stamina / 100))
          : 0;
      const cornerMult = Math.max(0, 1 - cornerPenalty);

      const evMult = eventMultiplier(st.events, totalFrac, inCorner, allowInCorners);
      const vTarget = vmaxFatigued * cornerMult * evMult;

      st.v += (vTarget - st.v) * st.accel * DT;
      if (st.v < 0) st.v = 0;

      const prevPos = st.pos;
      const stepDist = st.v * DT;
      st.pos += stepDist;

      if (st.pos >= totalLength) {
        const overshoot = st.pos - totalLength;
        const step = stepDist > 0 ? overshoot / stepDist : 0;
        const crossDt = DT * (1 - clamp(step, 0, 1));
        finishTimes[st.idx] = t + crossDt;
        st.pos = totalLength;
        finalPositions[st.idx] = totalLength;
        finished += 1;
      } else {
        finalPositions[st.idx] = st.pos;
      }
    }

    t += DT;

    if (includeTimeline && timeline && t >= nextSample) {
      timeline.push({
        t,
        positions: states.map((s) => s.pos),
        speeds: states.map((s) => s.v),
      });
      nextSample += timelineInterval;
    }
  }

  // If any horse never finished, freeze their time to max t (still deterministic)
  const endTime = t;
  for (let i = 0; i < finishTimes.length; i += 1) {
    if (!Number.isFinite(finishTimes[i])) {
      finishTimes[i] = endTime;
    }
  }

  let winnerIndex = 0;
  let bestTime = finishTimes[0];
  for (let i = 1; i < finishTimes.length; i += 1) {
    if (finishTimes[i] < bestTime - 1e-6) {
      bestTime = finishTimes[i];
      winnerIndex = i;
    } else if (Math.abs(finishTimes[i] - bestTime) <= 1e-6 && i < winnerIndex) {
      winnerIndex = i;
    }
  }

  return {
    winnerIndex,
    finishTimes,
    finalPositions,
    timeline,
    events,
    conditions,
    seedUsed,
  };
};
