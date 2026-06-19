import { v7 as uuidv7 } from 'uuid';
import { EventBus } from '../event-bus/index.js';

export interface CommandMetadata {
  readonly correlationId?: string;
  readonly agentDelegated?: boolean;
  readonly undoable?: boolean;
  readonly [key: string]: unknown;
}

export interface PlatformCommand<T = unknown> {
  readonly id: string;
  readonly type: string;        // Namespace format, e.g., "lesson.create"
  readonly actorId: string;     
  readonly payload: T;          
  readonly timestamp: number;   
  readonly metadata?: CommandMetadata;
}

export interface CommandHandler<C extends PlatformCommand = PlatformCommand> {
  execute(command: C): Promise<void | any>;
}

export class CommandBus {
  /** Modern (new-format) handlers — take priority in execution */
  private handlers = new Map<string, CommandHandler>();
  /** Legacy (old-format) handlers — used as fallback when no modern handler exists (D-11) */
  private legacyHandlers = new Map<string, CommandHandler>();
  private interceptor?: (command: PlatformCommand) => Promise<void>;

  constructor(private eventBus: EventBus) {}

  public setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>) {
    this.interceptor = interceptor;
  }

  public registerHandler(commandType: string, handler: CommandHandler) {
    if (this.handlers.has(commandType)) {
      throw new Error(`Command handler for ${commandType} is already registered.`);
    }
    this.handlers.set(commandType, handler);
  }

  /**
   * D-11: Register a legacy (old-format) handler.
   *
   * Legacy handlers are stored separately from modern handlers.
   * execute() prefers modern handlers; legacy handlers are only used
   * as fallback when no modern handler exists for the command type.
   */
  public registerLegacyHandler(commandType: string, handler: CommandHandler) {
    this.legacyHandlers.set(commandType, handler);
  }

  public unregisterHandler(commandType: string) {
    this.handlers.delete(commandType);
    this.legacyHandlers.delete(commandType);
  }

  public async execute<T extends PlatformCommand>(command: T): Promise<any> {
    const normalizedCommand: PlatformCommand = {
      ...command,
      actorId: command.actorId || 'agent-system-0'
    };

    if (this.interceptor) {
      await this.interceptor(normalizedCommand);
    }
    
    // D-11: Priority routing — modern handler first, legacy fallback
    const handler = this.handlers.get(normalizedCommand.type)
      ?? this.legacyHandlers.get(normalizedCommand.type);
    if (!handler) {
      throw new Error(`No handler registered for command: ${normalizedCommand.type}`);
    }

    console.log(`[CommandBus] Executing: ${normalizedCommand.type} (ID: ${normalizedCommand.id}) by ${normalizedCommand.actorId}`);

    // Simplified Pipeline: Validation -> Execution
    try {
      const result = await handler.execute(normalizedCommand);
      return result;
    } catch (error: any) {
      console.error(`[CommandBus] Failed to execute ${normalizedCommand.type}:`, error);
      throw error;
    }
  }

  public createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): PlatformCommand<T> {
    return {
      id: uuidv7(),
      type,
      actorId,
      payload,
      timestamp: Date.now(),
      metadata: metadata || {}
    };
  }
}
