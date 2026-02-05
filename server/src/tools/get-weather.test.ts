import { describe, expect, it } from "vitest";

import { getWeather } from "./get-weather.js";

describe("getWeather", () => {
  it("uses fixed Open-Meteo endpoints and returns parsed current weather", async () => {
    const calledUrls: string[] = [];
    const fetch = async (input: string) => {
      calledUrls.push(input);
      if (input.startsWith("https://geocoding-api.open-meteo.com/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ name: "Tokyo", country: "Japan", latitude: 35, longitude: 139 }],
          }),
        };
      }
      if (input.startsWith("https://api.open-meteo.com/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ current: { temperature_2m: 12.5, weather_code: 3 } }),
        };
      }
      throw new Error(`unexpected url: ${input}`);
    };

    const result = await getWeather({
      location: "Tokyo",
      fetch,
      signal: new AbortController().signal,
    });

    expect(calledUrls.length).toBe(2);
    expect(calledUrls[0]).toMatch(/^https:\/\/geocoding-api\.open-meteo\.com\//);
    expect(calledUrls[1]).toMatch(/^https:\/\/api\.open-meteo\.com\//);
    expect(result).toEqual({ location: "Tokyo, Japan", temperature_c: 12.5, weather_code: 3 });
  });

  it("throws when geocoding endpoint is not ok", async () => {
    const fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(
      getWeather({ location: "Tokyo", fetch, signal: new AbortController().signal }),
    ).rejects.toThrow(/weather_geocoding_failed_http_500/);
  });

  it("throws when forecast endpoint is not ok", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ name: "Tokyo", country: "Japan", latitude: 35, longitude: 139 }],
          }),
        };
      }
      return { ok: false, status: 502, json: async () => ({}) };
    };

    await expect(
      getWeather({ location: "Tokyo", fetch, signal: new AbortController().signal }),
    ).rejects.toThrow(/weather_forecast_failed_http_502/);
  });

  it("throws when forecast response is missing required fields", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ name: "Tokyo", country: "Japan", latitude: 35, longitude: 139 }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ current: { temperature_2m: "12.5", weather_code: 3 } }),
      };
    };

    await expect(
      getWeather({ location: "Tokyo", fetch, signal: new AbortController().signal }),
    ).rejects.toThrow(/weather_forecast_invalid_response/);
  });

  it("falls back to input location when geocoding lacks name/country", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ latitude: 35, longitude: 139 }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ current: { temperature_2m: 12.5, weather_code: 3 } }),
      };
    };

    await expect(
      getWeather({ location: "Tokyo", fetch, signal: new AbortController().signal }),
    ).resolves.toEqual({ location: "Tokyo", temperature_c: 12.5, weather_code: 3 });
  });
});
