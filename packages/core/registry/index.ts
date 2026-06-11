export interface ActionDescriptor {
  readonly id: string;
  readonly commandType: string;
  readonly description: string;
  readonly inputSchema: any; // JSON Schema directly matching GenAI tool parameters
  readonly capabilityRequired: string; 
  readonly isHighRisk?: boolean;
}

export class ActionRegistry {
  private actions = new Map<string, ActionDescriptor>();

  public register(descriptor: ActionDescriptor): void {
    if (this.actions.has(descriptor.id)) {
      throw new Error(`Action ${descriptor.id} is already registered.`);
    }
    this.actions.set(descriptor.id, descriptor);
  }

  public unregister(id: string): void {
    this.actions.delete(id);
  }

  public getAllActions(): ActionDescriptor[] {
    return Array.from(this.actions.values());
  }

  // Returns tools formatted for @google/genai
  public getAgentTools(): any[] {
    const functionDeclarations = Array.from(this.actions.values()).map(action => {
      // Safely replace non-word chars with underscore for function names
      const SafeName = action.commandType.replace(/[^a-zA-Z0-9_\-]/g, "_");
      
      return {
        name: SafeName,
        description: action.description,
        parameters: action.inputSchema
      };
    });

    if (functionDeclarations.length === 0) return [];
    
    return [
      {
        functionDeclarations
      }
    ];
  }
  
  public getActionByToolName(toolName: string): ActionDescriptor | undefined {
    return Array.from(this.actions.values()).find(
      a => a.commandType.replace(/[^a-zA-Z0-9_\-]/g, "_") === toolName
    );
  }

  public getActionByCommandType(commandType: string): ActionDescriptor | undefined {
    return Array.from(this.actions.values()).find(a => a.commandType === commandType);
  }
}
