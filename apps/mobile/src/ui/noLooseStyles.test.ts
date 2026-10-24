import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

// Source scans in the style of noHardCodedColors.test.ts: type, spacing and touch targets
// come from the tokens in theme.ts (docs/design.md §3, §4), never from literals in a screen.
const SRC = join(__dirname, '..');
const ROOT = join(SRC, '..');
const THEME = join(SRC, 'ui', 'theme.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

const files = [...sourceFiles(SRC), join(ROOT, 'App.tsx')];

/** `file:line: text` of each line of the non-test sources (but `allowed`) that matches. */
function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  return files
    .filter((f) => !allowed.includes(f))
    .flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          pattern.test(line) ? [`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
}

describe('type', () => {
  const LITERAL_TYPE = /\b(?:fontSize|lineHeight|letterSpacing)\s*:\s*-?\d|\bfontWeight\s*:\s*['"]/;

  it('has no font size, line height, letter spacing or weight literal outside theme.ts', () => {
    expect(offenders(LITERAL_TYPE, [THEME])).toEqual([]);
  });

  it('catches the usual spellings', () => {
    for (const bad of [
      'fontSize: 12,',
      "fontWeight: '600'",
      'lineHeight: 34',
      'letterSpacing: 6',
    ]) {
      expect(LITERAL_TYPE.test(bad)).toBe(true);
    }
    expect(LITERAL_TYPE.test('...type.title1,')).toBe(false);
    expect(LITERAL_TYPE.test('fontWeight: weight.semibold')).toBe(false);
  });

  it('uses T or Amount for text: no bare react-native Text outside them', () => {
    const bare = files
      .filter((f) => ![join(SRC, 'ui', 'T.tsx'), join(SRC, 'ui', 'Amount.tsx')].includes(f))
      .filter((f) => {
        const text = readFileSync(f, 'utf8').replace(/\n/g, ' ');
        return /import\s*\{[^}]*\bText\b[^}]*\}\s*from\s*'react-native'/.test(text);
      })
      .map((f) => relative(ROOT, f));
    expect(bare).toEqual([]);
  });
});

describe('spacing', () => {
  // gap, margin* and padding* take `space.*` (0 is fine). 4 is `space.xs`; the 2 dp of a
  // tight stack is `space.hairline`.
  const LITERAL_SPACE = /\b(?:gap|rowGap|columnGap|margin[A-Za-z]*|padding[A-Za-z]*)\s*:\s*-?[1-9]/;

  it('has no gap, margin or padding literal outside theme.ts', () => {
    expect(offenders(LITERAL_SPACE, [THEME])).toEqual([]);
  });

  it('catches the usual spellings', () => {
    for (const bad of [
      'gap: 2,',
      'gap: 4',
      'marginBottom: 2',
      'paddingVertical: 1',
      'marginTop: -2',
    ]) {
      expect(LITERAL_SPACE.test(bad)).toBe(true);
    }
    expect(LITERAL_SPACE.test('gap: space.xs')).toBe(false);
    expect(LITERAL_SPACE.test('paddingHorizontal: 0')).toBe(false);
  });
});

describe('touch targets', () => {
  it('has no minHeight literal under 48 dp', () => {
    // A Chip is 32 dp tall with an 8 dp hit slop either side: a 48 dp target (design.md §6.8).
    const small = offenders(/\bminHeight\s*:\s*(?:[1-9]|[1-3]\d|4[0-7])\b(?!\.)/, [
      THEME,
      join(SRC, 'ui', 'Chip.tsx'),
    ]);
    expect(small).toEqual([]);
  });

  it('has no hitSlop on the 48 dp header icon buttons (it would overlap the centre button)', () => {
    const topBar = readFileSync(join(SRC, 'header', 'TopBar.tsx'), 'utf8');
    expect(topBar).not.toMatch(/hitSlop/);
  });

  it('gives the include-certificados row a 48 dp minimum height', () => {
    const scope = readFileSync(join(SRC, 'ui', 'Scope.tsx'), 'utf8');
    const row = /switchRow:\s*\{([^}]*)\}/.exec(scope)?.[1] ?? '';
    expect(row).toMatch(/minHeight:\s*TOUCH_TARGET/);
  });
});
