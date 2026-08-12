import { describe, expect, it } from "vitest";

import {
  BufferedAudioCaptureSession,
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
