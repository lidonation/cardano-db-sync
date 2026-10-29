/** Map values proportionally; a collapsed domain maps to the start of the range. */
export function linearScale(value: number, min: number, max: number, start: number, end: number) {
  return start + ((value - min) / (max - min || 1)) * (end - start);
}
