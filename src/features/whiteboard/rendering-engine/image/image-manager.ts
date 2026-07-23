export class ImageManager {
  private imageMap = new Map<string, HTMLImageElement>();
  private loadingSet = new Set<string>();

  public loadImage(url: string, onLoad?: (img: HTMLImageElement) => void): HTMLImageElement | null {
    if (this.imageMap.has(url)) {
      return this.imageMap.get(url)!;
    }

    if (this.loadingSet.has(url)) return null;

    this.loadingSet.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;

    img.onload = () => {
      this.imageMap.set(url, img);
      this.loadingSet.delete(url);
      if (onLoad) onLoad(img);
    };

    img.onerror = () => {
      this.loadingSet.delete(url);
    };

    return null;
  }

  public getImage(url: string): HTMLImageElement | undefined {
    return this.imageMap.get(url);
  }
}

export const imageManager = new ImageManager();
