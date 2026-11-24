export function qrMatrix(text: string): boolean[][];
export function qrSvg(text: string, options?: { quiet?: number }): { size: number; viewBox: string; path: string };
export const QR_EC_LAYOUT: Record<number, { ec: number; groups: Array<[number, number]> }>;
export function qrReserved(version: number): { matrix: boolean[][]; reserved: boolean[][]; size: number };
