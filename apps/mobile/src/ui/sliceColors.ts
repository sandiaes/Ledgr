import { useColors } from './ThemeProvider';

/**
 * Allocation slice colours from the current theme. Asset types have fixed colours; brokers,
 * currencies and assets take the palette in rank order, and past it the "invested" grey.
 */
export function useSliceColors(): {
  typeColor(key: string): string;
  rankColor(key: string, index: number): string;
} {
  const colors = useColors();
  return {
    typeColor: (key) => (colors.types as Record<string, string>)[key] ?? colors.invested,
    rankColor: (_key, index) => colors.palette[index] ?? colors.invested,
  };
}
