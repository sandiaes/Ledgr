// The importer's only console output. Callers pass counts, settings and totals; row-level
// financial values go to the report files only. ESLint allows console in this file alone.
export function print(line: string): void {
  console.log(line);
}
