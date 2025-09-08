import { BUILD_ENV } from "./config";

const prefix = "[Flow State]";
const enableInfo = BUILD_ENV === "local"; // only log info in local dev

export function log(...args: any[]) {
  if (enableInfo) console.log(prefix, ...args);
}
export function warn(...args: any[]) {
  console.warn(prefix, ...args);
}
export function error(...args: any[]) {
  console.error(prefix, ...args);
}