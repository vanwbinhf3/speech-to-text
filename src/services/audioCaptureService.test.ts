import { describe, expect, it } from "vitest";

import {
  applyAudioProcessing,
  BufferedAudioCaptureSession,
  calculateInputPeakVolume,
  calculateInputVolume,
} from "./audioCaptureService";

describe("BufferedAudioCaptureSession", () => {
  it("returns concatenated PCM and ignores duplicate stop", async () => {
    const session = new BufferedAudioCaptureSession(() => undefined);

    session.push(Float32Array.from([1, 2]));
    session.push(Float32Array.from([3]));

    await expect(session.stop()).resolves.toEqual(Float32Array.from([1, 2, 3]));
    await expect(session.stop()).resolves.toEqual(Float32Array.from([1, 2, 3]));
  });

  it("forwards chunks to consumers before stop", () => {
    const session = new BufferedAudioCaptureSession(() => undefined);
    const chunks: Float32Array[] = [];

    session.addConsumer((chunk) => chunks.push(chunk));
    session.push(Float32Array.from([0.25]));

    expect(Array.from(chunks[0])).toEqual([0.25]);
  });
});

describe("calculateInputVolume", () => {
  it("returns an RMS-based level clamped between zero and one", () => {
    expect(calculateInputVolume(Float32Array.from([]))).toBe(0);
    expect(calculateInputVolume(Float32Array.from([0, 0]))).toBe(0);
    expect(calculateInputVolume(Float32Array.from([1, -1]))).toBe(1);
    expect(calculateInputVolume(Float32Array.from([2, -2]))).toBe(1);
    expect(calculateInputVolume(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

describe("calculateInputPeakVolume", () => {
  it("returns the max absolute sample clamped between zero and one", () => {
    expect(calculateInputPeakVolume(Float32Array.from([]))).toBe(0);
    expect(calculateInputPeakVolume(Float32Array.from([0.2, -0.75]))).toBe(0.75);
    expect(calculateInputPeakVolume(Float32Array.from([1.5, -0.2]))).toBe(1);
  });
});

describe("applyAudioProcessing", () => {
  it("applies gain and clamps samples to the audio range", () => {
    const processed = applyAudioProcessing(Float32Array.from([0.25, -0.75]), {
      inputGain: 2,
      noiseGateEnabled: false,
      noiseGateThreshold: 0.015,
      browserProcessingMode: "enhanced",
    });

    expect(Array.from(processed)).toEqual([0.5, -1]);
  });

  it("applies noise gate before gain so quiet noise stays silent", () => {
    const processed = applyAudioProcessing(Float32Array.from([0.01, -0.02, 0.1]), {
      inputGain: 3,
      noiseGateEnabled: true,
      noiseGateThreshold: 0.015,
      browserProcessingMode: "enhanced",
    });

    expect(processed[0]).toBe(0);
    expect(processed[1]).toBeCloseTo(-0.06);
    expect(processed[2]).toBeCloseTo(0.3);
  });
});
