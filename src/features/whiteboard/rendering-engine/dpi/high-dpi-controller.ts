export class HighDPIController {
  public getDPR(): number {
    if (typeof window !== 'undefined') {
      return Math.max(1, window.devicePixelRatio || 1);
    }
    return 1;
  }

  public setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): { dpr: number; cssWidth: number; cssHeight: number } {
    const dpr = this.getDPR();
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    return { dpr, cssWidth: width, cssHeight: height };
  }
}

export const highDPIController = new HighDPIController();
