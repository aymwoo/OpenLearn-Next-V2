export class TextEditingManager {
  private activeObjectId: string | null = null;
  private isComposing: boolean = false; // IME Chinese/Japanese input state

  public startEditing(objectId: string): void {
    this.activeObjectId = objectId;
  }

  public stopEditing(): void {
    this.activeObjectId = null;
    this.isComposing = false;
  }

  public isEditing(objectId?: string): boolean {
    if (objectId) return this.activeObjectId === objectId;
    return this.activeObjectId !== null;
  }

  public getEditingObjectId(): string | null {
    return this.activeObjectId;
  }

  public setCompositionState(isComposing: boolean): void {
    this.isComposing = isComposing;
  }

  public getCompositionState(): boolean {
    return this.isComposing;
  }
}

export const textEditingManager = new TextEditingManager();
