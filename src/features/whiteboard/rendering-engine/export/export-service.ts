import type { CanvasPage } from '../../canvas-model/types.js';

export class ExportService {
  /**
   * Export Canvas Document Page as JSON snapshot
   */
  public exportJSON(page: CanvasPage): string {
    return JSON.stringify(page, null, 2);
  }

  /**
   * Export Stage HTML Canvas element as Data URL image (PNG / JPEG)
   */
  public exportImage(stageCanvasElement: HTMLCanvasElement, format: 'png' | 'jpeg' = 'png', quality: number = 0.92): string {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return stageCanvasElement.toDataURL(mimeType, quality);
  }

  /**
   * Download image snapshot file directly in browser
   */
  public downloadImage(stageCanvasElement: HTMLCanvasElement, filename: string = 'openlearn-whiteboard.png'): void {
    const dataUrl = this.exportImage(stageCanvasElement, filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? 'jpeg' : 'png');
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export const exportService = new ExportService();
