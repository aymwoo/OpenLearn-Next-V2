/**
 * OpenLearn Platform Kernel - Bootstrap Stage Contract (PI-003)
 */

import { IBootstrapContext, PlatformStage } from '../types/index.js';

export interface IBootstrapStage {
  readonly id: string;
  readonly name: PlatformStage | string;
  readonly description: string;
  readonly timeoutMs?: number;
  execute(context: IBootstrapContext): Promise<void>;
  rollback?(context: IBootstrapContext): Promise<void>;
}
