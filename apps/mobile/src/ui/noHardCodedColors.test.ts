import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');
const ROOT = join(SRC, '..');
const ALLOWED = [join(SRC, 'ui', 'theme.ts'), __filename];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) ? [path] : [];
  });
}

const NAMED =
  'white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|brown|cyan|magenta|silver|navy|teal|maroon|lime|olive|gold';
// Hex, rgb()/hsl() and named colours inside quotes. `transparent` is allowed: it has no theme.
const COLOR = new RegExp(`#[0-9a-fA-F]{3,8}\\b|\\b(?:rgb|hsl)a?\\(|['"\`](?:${NAMED})['"\`]`, 'i');

describe('theme', () => {
  it('is the only place with colour values', () => {
    const files = [...sourceFiles(SRC), join(ROOT, 'App.tsx')].filter((f) => !ALLOWED.includes(f));
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          COLOR.test(line) ? [`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
  });

  it('catches the usual spellings', () => {
    for (const bad of ["color: '#fff'", 'x = "#12345678"', 'rgba(0,0,0,0.4)', "c = 'white'"]) {
      expect(COLOR.test(bad)).toBe(true);
    }
    expect(COLOR.test("color: 'transparent'")).toBe(false);
    expect(COLOR.test("id: '#1'")).toBe(false);
  });
});
