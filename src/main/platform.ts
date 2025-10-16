// put here logic that requires to specify behavior for a specifis OS

export const PLATFORM = process.platform as NodeJS.Platform;
export const IS_WINDOWS = PLATFORM === "win32";
export const IS_MAC = PLATFORM === "darwin";
export const IS_LINUX = PLATFORM === "linux";