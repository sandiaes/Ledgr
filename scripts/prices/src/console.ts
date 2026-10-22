// The price script's only console output. Callers pass counts and totals; per-asset values
// go to the report files only. ESLint allows console in this file alone.
export function print(line: string): void {
  console.log(line);
}
