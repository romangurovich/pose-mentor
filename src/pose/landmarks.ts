/**
 * BlazePose / MediaPipe Pose Landmarker topology (33 landmarks).
 * Left/right are the *person's* left/right, not the image's.
 */
export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const NUM_LANDMARKS = 33;

export type Side = "left" | "right";

export type Joint =
  | "shoulder"
  | "elbow"
  | "wrist"
  | "hip"
  | "knee"
  | "ankle"
  | "heel"
  | "toe"
  | "ear"
  | "eye";

const SIDED: Record<Joint, [number, number]> = {
  shoulder: [LM.leftShoulder, LM.rightShoulder],
  elbow: [LM.leftElbow, LM.rightElbow],
  wrist: [LM.leftWrist, LM.rightWrist],
  hip: [LM.leftHip, LM.rightHip],
  knee: [LM.leftKnee, LM.rightKnee],
  ankle: [LM.leftAnkle, LM.rightAnkle],
  heel: [LM.leftHeel, LM.rightHeel],
  toe: [LM.leftFootIndex, LM.rightFootIndex],
  ear: [LM.leftEar, LM.rightEar],
  eye: [LM.leftEye, LM.rightEye],
};

/** Landmark index of a joint on a given side. */
export function idx(joint: Joint, side: Side): number {
  return SIDED[joint][side === "left" ? 0 : 1];
}

export function other(side: Side): Side {
  return side === "left" ? "right" : "left";
}

/** Skeleton edges we draw (a cleaner subset of POSE_CONNECTIONS: no hands/face mesh). */
export const BONES: ReadonlyArray<readonly [number, number]> = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftFootIndex],
  [LM.leftAnkle, LM.leftFootIndex],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightFootIndex],
  [LM.rightAnkle, LM.rightFootIndex],
];

/** Body joints rendered as dots. */
export const BODY_POINTS: ReadonlyArray<number> = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftHeel,
  LM.rightHeel,
  LM.leftFootIndex,
  LM.rightFootIndex,
];

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * One observed pose in *aspect-corrected image space*:
 * x and y are both measured in units of frame height, origin top-left, y pointing down.
 * (So a 16:9 frame spans x ∈ [0, 1.78], y ∈ [0, 1].)
 */
export interface PoseFrame {
  /** milliseconds */
  t: number;
  pts: Vec2[];
  vis: number[];
}
