import type { ActionId } from "./schema";

// Figure proportions in units of total figure height (feet at y=0, up is negative).
export const BONES = {
  hipHeight: 0.45,
  torso: 0.3,
  neck: 0.04,
  headR: 0.085,
  upperArm: 0.15,
  forearm: 0.14,
  thigh: 0.22,
  shin: 0.23,
};

/**
 * Limb angles are radians measured from "straight down"; positive swings the limb
 * toward the direction the figure faces. Elbow/knee values are relative bends.
 */
export interface Pose {
  hipY: number; // hip height above ground, in figure heights
  rot: number; // whole-body rotation around the hip (positive = falls forward)
  lean: number; // torso lean from vertical
  headTilt: number;
  armBack: [number, number];
  armFront: [number, number];
  legBack: [number, number];
  legFront: [number, number];
  mouthOpen: number; // 0..1, used for talking
}

const STAND: Pose = {
  hipY: BONES.hipHeight,
  rot: 0,
  lean: 0,
  headTilt: 0,
  armBack: [-0.15, 0.1],
  armFront: [0.15, 0.1],
  legBack: [-0.08, 0],
  legFront: [0.08, 0],
  mouthOpen: 0,
};

const TAU = Math.PI * 2;
const s = Math.sin;

function pose(over: Partial<Pose>): Pose {
  return { ...STAND, ...over };
}

function gait(t: number, hz: number, stride: number, armSwing: number, elbow: number): Partial<Pose> {
  const p = t * TAU * hz;
  const a = s(p);
  const b = s(p + Math.PI);
  return {
    hipY: BONES.hipHeight - 0.015 + Math.abs(s(p)) * 0.025,
    legFront: [a * stride, -Math.max(0, -Math.cos(p)) * stride * 1.6],
    legBack: [b * stride, -Math.max(0, Math.cos(p)) * stride * 1.6],
    armFront: [b * armSwing, elbow],
    armBack: [a * armSwing, elbow],
  };
}

/** Pose of an action `t` seconds after it started. Pure and deterministic. */
export function actionPose(action: ActionId, t: number): Pose {
  switch (action) {
    case "idle":
      return pose({ armFront: [0.12 + s(t * 2) * 0.03, 0.12], armBack: [-0.12 - s(t * 2) * 0.03, 0.12], hipY: BONES.hipHeight + s(t * 2) * 0.004 });
    case "walk":
      return pose(gait(t, 1.6, 0.42, 0.45, 0.25));
    case "run":
      return pose({ ...gait(t, 2.6, 0.75, 0.9, 1.5), lean: 0.25 });
    case "jump": {
      const c = (t % 1.1) / 1.1;
      const air = c > 0.25 && c < 0.85 ? Math.sin(((c - 0.25) / 0.6) * Math.PI) : 0;
      const crouch = c <= 0.25 ? Math.sin((c / 0.25) * Math.PI) : 0;
      return pose({
        hipY: BONES.hipHeight - crouch * 0.1 + air * 0.35,
        legFront: [0.3 * crouch + 0.2 * air, -0.6 * crouch - 0.4 * air],
        legBack: [0.2 * crouch + 0.1 * air, -0.6 * crouch - 0.5 * air],
        armFront: [2.6 * air - 0.4 * crouch, 0.2],
        armBack: [2.4 * air - 0.5 * crouch, 0.2],
      });
    }
    case "wave":
      return pose({ armFront: [2.7, 0.5 + s(t * 9) * 0.5], headTilt: 0.05 });
    case "talk":
      return pose({
        armFront: [0.6 + s(t * 3) * 0.25, 1.2 + s(t * 4) * 0.3],
        armBack: [0.2 + s(t * 2.3 + 1) * 0.15, 0.9],
        mouthOpen: Math.abs(s(t * 11)),
        headTilt: s(t * 2) * 0.05,
      });
    case "point":
      return pose({ armFront: [Math.PI / 2 + s(t * 6) * 0.04, 0], lean: 0.05 });
    case "think":
      return pose({ armFront: [0.5, 2.55], armBack: [0.35, 1.6], headTilt: 0.18 + s(t * 1.5) * 0.04 });
    case "sit":
      return pose({
        hipY: 0.24,
        legFront: [Math.PI / 2, -Math.PI / 2],
        legBack: [Math.PI / 2 - 0.1, -Math.PI / 2 + 0.1],
        armFront: [0.5, 0.6],
        armBack: [0.4, 0.7],
      });
    case "sleep":
      return pose({
        hipY: 0.06,
        rot: -Math.PI / 2,
        armFront: [0.2, 0.3],
        armBack: [0.1, 0.3],
        legFront: [0.1, -0.2],
        legBack: [0, 0],
        lean: s(t * 1.5) * 0.02,
      });
    case "dance": {
      const p = t * TAU * 1.2;
      return pose({
        hipY: BONES.hipHeight - Math.abs(s(p)) * 0.05,
        lean: s(p) * 0.15,
        armFront: [2.4 + s(p) * 0.6, 0.6],
        armBack: [1.0 - s(p) * 0.8, 0.8],
        legFront: [0.25 + s(p) * 0.2, -0.2],
        legBack: [-0.25 + s(p) * 0.2, -0.1],
      });
    }
    case "cheer": {
      const hop = Math.max(0, s(t * TAU * 1.5));
      return pose({ hipY: BONES.hipHeight + hop * 0.08, armFront: [2.6, 0.2], armBack: [-2.6, -0.2], mouthOpen: 0.8 });
    }
    case "cry":
      return pose({ armFront: [0.6, 2.5 + s(t * 14) * 0.08], armBack: [0.5, 2.4], headTilt: 0.35, lean: 0.12 });
    case "fall": {
      const k = Math.min(1, t / 0.8);
      const e = k * k;
      return pose({ rot: e * (Math.PI / 2), hipY: BONES.hipHeight - e * 0.38, armFront: [e * 2.2, 0.3], armBack: [e * 1.8, 0.3], legBack: [-e * 0.3, 0] });
    }
    case "kick":
    case "miss": {
      // Wind-up, strike, follow-through, recover: once every 1.4 s.
      const c = (t % 1.4) / 1.4;
      const swing = c < 0.3 ? -0.7 * Math.sin((c / 0.3) * (Math.PI / 2)) : c < 0.45 ? -0.7 + 2.1 * ((c - 0.3) / 0.15) : c < 0.7 ? 1.4 : 1.4 * (1 - (c - 0.7) / 0.3);
      const knee = c < 0.3 ? -1.1 * (c / 0.3) : c < 0.45 ? -1.1 * (1 - (c - 0.3) / 0.15) : 0;
      return pose({
        lean: c > 0.3 && c < 0.7 ? -0.12 : 0.05,
        legFront: [swing, knee],
        legBack: [-0.12, 0],
        armFront: [-0.6 - swing * 0.3, 0.3],
        armBack: [0.9 + swing * 0.3, 0.3],
      });
    }
    case "push":
      return pose({ ...gait(t, 0.9, 0.3, 0, 0), lean: 0.4, armFront: [Math.PI / 2 - 0.1, 0.25], armBack: [Math.PI / 2 - 0.25, 0.35] });
    case "fight": {
      const p = t * TAU * 1.8;
      const a = Math.max(0, s(p));
      const b = Math.max(0, s(p + Math.PI));
      return pose({
        lean: 0.12,
        legFront: [0.35, -0.2],
        legBack: [-0.35, 0],
        hipY: BONES.hipHeight - 0.04,
        armFront: [0.9 + a * 0.7, 2.2 - a * 2.1],
        armBack: [0.9 + b * 0.7, 2.2 - b * 2.1],
      });
    }
  }
}

export const LOCOMOTION: ReadonlySet<ActionId> = new Set(["walk", "run", "push"]);

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}
function lerp2(a: [number, number], b: [number, number], k: number): [number, number] {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
}

export function blendPose(a: Pose, b: Pose, k: number): Pose {
  return {
    hipY: lerp(a.hipY, b.hipY, k),
    rot: lerp(a.rot, b.rot, k),
    lean: lerp(a.lean, b.lean, k),
    headTilt: lerp(a.headTilt, b.headTilt, k),
    armBack: lerp2(a.armBack, b.armBack, k),
    armFront: lerp2(a.armFront, b.armFront, k),
    legBack: lerp2(a.legBack, b.legBack, k),
    legFront: lerp2(a.legFront, b.legFront, k),
    mouthOpen: lerp(a.mouthOpen, b.mouthOpen, k),
  };
}

const BLEND_SEC = 0.3;

/**
 * Actions play back-to-back, each taking an equal share of the scene.
 * Returns the pose and the fraction of locomotion completed (drives x movement).
 */
export function sequencePose(actions: ActionId[], t: number, duration: number): { pose: Pose; travel: number; action: ActionId; actionT: number } {
  const n = actions.length;
  const beat = duration / n;
  const i = Math.min(n - 1, Math.floor(t / beat));
  const local = t - i * beat;
  let p = actionPose(actions[i], local);
  if (i > 0 && local < BLEND_SEC) {
    const prev = actionPose(actions[i - 1], beat);
    const k = local / BLEND_SEC;
    p = blendPose(prev, p, k * k * (3 - 2 * k));
  }

  const moving = actions.map((a) => LOCOMOTION.has(a));
  const movingTotal = moving.filter(Boolean).length * beat;
  let done = 0;
  for (let j = 0; j < n; j++) {
    if (!moving[j]) continue;
    const start = j * beat;
    done += Math.max(0, Math.min(beat, t - start));
  }
  const travel = movingTotal > 0 ? done / movingTotal : 0;
  return { pose: p, travel, action: actions[i], actionT: local };
}
