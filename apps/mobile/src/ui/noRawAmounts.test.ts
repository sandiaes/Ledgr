import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

// The leak guard (docs/design.md §6.4, risk R6): an amount formatted anywhere but in
// `ui/Amount.tsx` would not be masked by the privacy switch.
const SRC = join(__dirname, '..');
const ROOT = join(SRC, '..');
const AMOUNT = join(SRC, 'ui', 'Amount.tsx');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) ? [path] : [];
  });
}

const files = [...sourceFiles(SRC), join(ROOT, 'App.tsx')];

/** An import of an amount formatter from the format module, in any spelling. */
const IMPORT =
  /import\s+(?:type\s+)?\{[^}]*\b(?:formatEur|formatAmount|formatUnits|formatPct)\b[^}]*\}\s+from\s+['"][./]*\/?format['"]/;

/** Files allowed to turn a Decimal into digits with `toFixed`: pixel positions and input text. */
const TO_FIXED_ALLOWED = [
  'dashboard/AllocationDonut.tsx',
  'dashboard/ValueChart.tsx',
  'positions/PriceChart.tsx',
  'calculator/GrowthChart.tsx',
  'performance/ContributionsChart.tsx',
  // The default text of the calculator's input fields (masked with the same switch).
  'calculator/CalculatorScreen.tsx',
].map((f) => join(SRC, f));

describe('amounts are formatted in one place', () => {
  it('only ui/Amount.tsx imports the amount formatters', () => {
    const offenders = files
      .filter((f) => f !== AMOUNT && f !== __filename && !/format(\.test)?\.ts$/.test(f))
      .filter((f) => IMPORT.test(readFileSync(f, 'utf8').replace(/\n/g, ' ')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('only chart geometry and the calculator’s inputs call toFixed in a component', () => {
    const offenders = files
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
      .filter((f) => !TO_FIXED_ALLOWED.includes(f))
      .filter((f) => /\.toFixed\(|\.toPrecision\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('catches the usual spellings', () => {
    for (const bad of [
      "import { formatEur } from '../format';",
      "import { formatDate, formatPct } from './format';",
      "import {\n  formatAmount,\n} from '../../format'".replace(/\n/g, ' '),
      "import type { formatUnits } from '../format'",
    ]) {
      expect(IMPORT.test(bad)).toBe(true);
    }
    expect(IMPORT.test("import { formatDate, formatTime } from '../format';")).toBe(false);
    expect(IMPORT.test("import { formatPeriod } from '../format';")).toBe(false);
  });
});
