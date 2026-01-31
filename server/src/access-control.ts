import { isIP } from "node:net";

const parseIpv4 = (ip: string): number[] | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
};

const parseIpv4Trusted = (ip: string): [number, number, number, number] => {
  const parts = ip.split(".");
  return [
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3])
  ];
};

const isLanIpv4Octets = (octets: number[]): boolean => {
  const [a, b] = octets;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  return false;
};

const normalizeAddress = (address: string): string => {
  const trimmed = address.trim();
  const withoutBrackets =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  const zoneIndex = withoutBrackets.indexOf("%");
  return zoneIndex === -1 ? withoutBrackets : withoutBrackets.slice(0, zoneIndex);
};

export const isLanAddress = (remoteAddress: string): boolean => {
  const normalized = normalizeAddress(remoteAddress);
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("::ffff:")) {
    const maybeIpv4 = normalized.slice("::ffff:".length);
    const octets = parseIpv4(maybeIpv4);
    return octets ? isLanIpv4Octets(octets) : false;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isLanIpv4Octets(parseIpv4Trusted(normalized));
  }

  if (ipVersion === 6) {
    const lower = normalized.toLowerCase();
    if (lower === "::1") {
      return true;
    }

    if (lower.startsWith("fc") || lower.startsWith("fd")) {
      return true;
    }

    const firstPart = lower.split(":", 1)[0];
    if (!firstPart) {
      return false;
    }
    const firstHextet = Number.parseInt(firstPart, 16);
    return firstHextet >= 0xfe80 && firstHextet <= 0xfebf;
  }

  return false;
};
