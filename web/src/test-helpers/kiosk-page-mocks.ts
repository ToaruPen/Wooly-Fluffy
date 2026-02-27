import { vi } from "vitest";

export const createNullAudioPlayerMock = () => ({
  AudioPlayer: () => null,
});

export const createAudioPlayerCaptureMock = (onRender: (props: unknown) => void) => () => ({
  AudioPlayer: (props: unknown) => {
    onRender(props);
    return null;
  },
});

export const createNullVrmAvatarMock = () => ({
  VrmAvatar: () => null,
});

export const createVrmAvatarCaptureMock = (onRender: (props: unknown) => void) => () => ({
  VrmAvatar: (props: unknown) => {
    onRender(props);
    return null;
  },
});

export const createSseClientMockFactory = (onConnect?: (handlers: unknown) => void) => async () => {
  const actual = await vi.importActual<typeof import("../sse-client")>("../sse-client");
  return {
    ...actual,
    connectSse: (_url: string, handlers: unknown) => {
      onConnect?.(handlers);
      return { close: () => undefined, reconnect: () => undefined };
    },
  };
};
