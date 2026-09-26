import { Token } from '@openlearn/plugin-sdk';

export interface ICanaryProbeService {
  ping(): string;
}

export const CanaryProbeToken = new Token<ICanaryProbeService>('ext-canary:ICanaryProbeService', '1.0.0');
