type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type FetchFn = (
  input: string,
  init?: {
    method?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponse>;

type GeocodingResponse = {
  results?: Array<{
    name?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    country?: unknown;
  }>;
};

type ForecastResponse = {
  current?: {
    temperature_2m?: unknown;
    weather_code?: unknown;
  };
};

export const getWeather = async (input: {
  location: string;
  fetch: FetchFn;
  signal: AbortSignal;
}): Promise<{ location: string; temperature_c: number; weather_code: number }> => {
  const geocodeUrl =
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(input.location)}` +
    `&count=1&language=ja&format=json`;

  const geoRes = await input.fetch(geocodeUrl, { method: "GET", signal: input.signal });
  if (!geoRes.ok) {
    throw new Error(`weather_geocoding_failed_http_${geoRes.status}`);
  }
  const geoJson = (await geoRes.json()) as GeocodingResponse;
  const first = geoJson.results?.[0];
  const latitude = typeof first?.latitude === "number" ? first.latitude : null;
  const longitude = typeof first?.longitude === "number" ? first.longitude : null;
  if (latitude === null || longitude === null) {
    throw new Error("weather_geocoding_no_result");
  }

  const resolvedName = typeof first?.name === "string" && first.name ? first.name : input.location;
  const country = typeof first?.country === "string" ? first.country : "";
  const resolved = country ? `${resolvedName}, ${country}` : resolvedName;

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(String(latitude))}` +
    `&longitude=${encodeURIComponent(String(longitude))}` +
    `&current=temperature_2m,weather_code` +
    `&timezone=Asia%2FTokyo`;

  const forecastRes = await input.fetch(forecastUrl, { method: "GET", signal: input.signal });
  if (!forecastRes.ok) {
    throw new Error(`weather_forecast_failed_http_${forecastRes.status}`);
  }
  const forecastJson = (await forecastRes.json()) as ForecastResponse;
  const temperature = forecastJson.current?.temperature_2m;
  const weatherCode = forecastJson.current?.weather_code;
  if (typeof temperature !== "number" || typeof weatherCode !== "number") {
    throw new Error("weather_forecast_invalid_response");
  }

  return {
    location: resolved,
    temperature_c: temperature,
    weather_code: weatherCode,
  };
};
