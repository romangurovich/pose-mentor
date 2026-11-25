/**
 * Browser-side pose detection: MediaPipe Pose Landmarker (BlazePose GHUM, 33 landmarks), running
 * locally via WASM + WebGL. Pretrained by Google; we use it as-is (no fine-tuning).
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseFrame } from "./landmarks.ts";

export type ModelVariant = "lite" | "full" | "heavy";

export interface DetectorInfo {
  variant: ModelVariant;
  delegate: "GPU" | "CPU";
}

const BASE = import.meta.env.BASE_URL;

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private lastTs = -1;
  info: DetectorInfo | null = null;

  static async create(variant: ModelVariant = "full", prefer: "GPU" | "CPU" = "GPU"): Promise<PoseDetector> {
    const d = new PoseDetector();
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
    const make = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_${variant}.task`, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    try {
      d.landmarker = await make(prefer);
      d.info = { variant, delegate: prefer };
    } catch (err) {
      console.warn("GPU delegate unavailable, falling back to CPU", err);
      d.landmarker = await make("CPU");
      d.info = { variant, delegate: "CPU" };
    }
    return d;
  }

  /** Detect on the current video frame. Returns aspect-corrected landmarks, or null if nobody is in view. */
  detect(video: HTMLVideoElement, nowMs: number): PoseFrame | null {
    if (!this.landmarker || video.readyState < 2 || !video.videoWidth) return null;
    // MediaPipe requires strictly increasing timestamps
    const ts = Math.max(nowMs, this.lastTs + 1);
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(video, ts);
    const lms = res.landmarks?.[0];
    if (!lms || lms.length < 33) return null;
    const aspect = video.videoWidth / video.videoHeight;
    return {
      t: nowMs,
      pts: lms.map((p) => ({ x: p.x * aspect, y: p.y })),
      vis: lms.map((p) => Math.min(p.visibility ?? 1, p.presence ?? 1)),
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
