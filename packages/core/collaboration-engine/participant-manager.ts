/**
 * OpenLearn Teaching Collaboration Engine - Participant Manager
 * Manages participants (Teacher, Assistant, Student, Observer, AI, Plugin) and unified lifecycle methods.
 */

import { Participant } from './types.js';

export class ParticipantManager {
  private participants = new Map<string, Participant>();

  public join(participant: Participant): Participant {
    const updated: Participant = Object.freeze({
      ...participant,
      isOnline: true,
      lastActive: Date.now(),
      lastHeartbeat: Date.now(),
    });
    this.participants.set(participant.id, updated);
    return updated;
  }

  public leave(participantId: string): boolean {
    const existing = this.participants.get(participantId);
    if (existing) {
      this.participants.set(
        participantId,
        Object.freeze({
          ...existing,
          isOnline: false,
        })
      );
      return true;
    }
    return false;
  }

  public reconnect(participantId: string): Participant | undefined {
    const existing = this.participants.get(participantId);
    if (!existing) return undefined;

    const reconnected: Participant = Object.freeze({
      ...existing,
      isOnline: true,
      lastActive: Date.now(),
      lastHeartbeat: Date.now(),
    });
    this.participants.set(participantId, reconnected);
    return reconnected;
  }

  public heartbeat(participantId: string): boolean {
    const existing = this.participants.get(participantId);
    if (existing) {
      this.participants.set(
        participantId,
        Object.freeze({
          ...existing,
          lastHeartbeat: Date.now(),
          lastActive: Date.now(),
          isOnline: true,
        })
      );
      return true;
    }
    return false;
  }

  public sync(participantId: string, partial: Partial<Participant>): Participant | undefined {
    const existing = this.participants.get(participantId);
    if (!existing) return undefined;

    const updated: Participant = Object.freeze({
      ...existing,
      ...partial,
      lastActive: Date.now(),
    });
    this.participants.set(participantId, updated);
    return updated;
  }

  public getParticipant(participantId: string): Participant | undefined {
    return this.participants.get(participantId);
  }

  public listParticipants(): ReadonlyArray<Participant> {
    return Object.freeze(Array.from(this.participants.values()));
  }

  public clear(): void {
    this.participants.clear();
  }
}
