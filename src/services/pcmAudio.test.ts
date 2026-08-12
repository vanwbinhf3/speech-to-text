import { describe, expect, it } from "vitest";

import {
  AudioChunkFanout,
  concatFloat32Arrays,
  downmixToMono,
  resampleLinear,
} from "./pcmAudio";

describe("resampleLinear", () => {
  it("resamples mono PCM to 16 kHz with deterministic length", () => {
    const input = Float32Array.from([0, 0.5, 1, 0.5, 0, -0.5]);
    const output = resampleLinear(input, 48_000, 16_000);

    expect(output.length).toBe(2);
    expect(output[0]).toBeCloseTo(0);
    expect(output[1]).toBeCloseTo(0.5);
  });

  it("returns a copy when sample rate already matches", () => {
    const input = Float32Array.from([0.1, 0.2]);
    const output = resampleLinear(input, 16_000, 16_000);

    expect(output).not.toBe(input);
    expect(output[0]).toBeCloseTo(0.1);
    expect(output[1]).toBeCloseTo(0.2);
  });
});

describe("downmixToMono", () => {
  it("averages multiple channels sample by sample", () => {
    const mono = downmixToMono([
      Float32Array.from([1, 0, -1]),
      Float32Array.from([-1, 0.5, 1]),
    ]);

    expect(Array.from(mono)).toEqual([0, 0.25, 0]);
  });
});

describe("concatFloat32Arrays", () => {
  it("concatenates chunks without mutating inputs", () => {
    const left = Float32Array.from([1, 2]);
    const right = Float32Array.from([3]);

    expect(Array.from(concatFloat32Arrays([left, right]))).toEqual([1, 2, 3]);
    expect(Array.from(left)).toEqual([1, 2]);
  });
});

describe("AudioChunkFanout", () => {
  it("passes identical chunk values to every consumer", () => {
    const fanout = new AudioChunkFanout();
    const left: Float32Array[] = [];
    const right: Float32Array[] = [];

    fanout.addConsumer((chunk) => left.push(chunk));
    fanout.addConsumer((chunk) => right.push(chunk));
    fanout.push(Float32Array.from([0.1, 0.2]));

    expect(Array.from(left[0])).toEqual(Array.from(right[0]));
    expect(left[0]).not.toBe(right[0]);
  });
});
