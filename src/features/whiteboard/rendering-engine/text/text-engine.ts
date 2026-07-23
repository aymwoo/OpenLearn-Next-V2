import { cacheManager } from '../cache/cache-manager.js';

export interface TextMetrics {
  width: number;
  height: number;
  lines: string[];
}

export class TextEngine {
  private canvasCtx: CanvasRenderingContext2D | null = null;

  private getContext(): CanvasRenderingContext2D {
    if (!this.canvasCtx) {
      const canvas = document.createElement('canvas');
      this.canvasCtx = canvas.getContext('2d')!;
    }
    return this.canvasCtx;
  }

  public measureText(text: string, fontSize: number, fontFamily: string, maxWidth?: number): TextMetrics {
    const cacheKey = `${text}_${fontSize}_${fontFamily}_${maxWidth ?? 'none'}`;
    const cached = cacheManager.get<TextMetrics>('text', cacheKey);
    if (cached) return cached;

    const ctx = this.getContext();
    ctx.font = `${fontSize}px ${fontFamily}`;

    const rawLines = text.split('\n');
    const lines: string[] = [];
    let calculatedWidth = 0;

    rawLines.forEach((line) => {
      if (!maxWidth || ctx.measureText(line).width <= maxWidth) {
        lines.push(line);
        calculatedWidth = Math.max(calculatedWidth, ctx.measureText(line).width);
      } else {
        // Wrap text
        let currentWord = '';
        for (let i = 0; i < line.length; i++) {
          const testLine = currentWord + line[i];
          if (ctx.measureText(testLine).width > maxWidth && currentWord.length > 0) {
            lines.push(currentWord);
            calculatedWidth = Math.max(calculatedWidth, ctx.measureText(currentWord).width);
            currentWord = line[i];
          } else {
            currentWord = testLine;
          }
        }
        if (currentWord.length > 0) {
          lines.push(currentWord);
          calculatedWidth = Math.max(calculatedWidth, ctx.measureText(currentWord).width);
        }
      }
    });

    const metrics: TextMetrics = {
      width: Math.ceil(calculatedWidth),
      height: Math.ceil(lines.length * fontSize * 1.3),
      lines,
    };

    cacheManager.set('text', cacheKey, metrics);
    return metrics;
  }
}

export const textEngine = new TextEngine();
