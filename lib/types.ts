/**
 * lib/types.ts
 *
 * Shared type definitions used across all library modules.
 */

export interface Founder {
  name: string;
  title: string;
  linkedInUrl: string;
}

export interface Candidate {
  name: string;
  url: string;
  foundedYear?: number;
  fundingStage?: string;
  fundingTotal?: string;
  latestRound?: string;
  latestRoundDate?: string;
  workforce?: number | string;
  webTraffic?: number;
  headquarters?: string;
}

export interface SignalResearch {
  headcount: string;
  stability: string;
  traction: string;
}

export interface EnrichedCandidate extends Candidate {
  websiteSummary: string;
  founders: Founder[];
  signalResearch: SignalResearch;
}

export interface ScoreDimensions {
  founder_pedigree: number;
  technical_moat: number;
  thesis_fit: number;
  traction_signals: number;
  market_timing: number;
}

export interface ScoredStartup extends EnrichedCandidate {
  overall_score: number;
  scores: ScoreDimensions;
  one_liner: string;
  why_interesting: string;
  red_flags: string[];
  yc_backed: boolean;
  pass: boolean;
  already_seen: boolean;
}
