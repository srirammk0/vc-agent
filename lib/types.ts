export interface Founder {
  name: string;
  title: string;
  linkedInUrl: string;
  workHistory?: string;
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

export interface ScoreDimensions {
  founder_pedigree: number;
  technical_moat: number;
  thesis_fit: number;
  traction_signals: number;
  market_timing: number;
}

export interface ScoredStartup {
  company_name: string;
  overall_score: number;
  scores: ScoreDimensions;
  one_liner: string;
  why_interesting: string;
  red_flags: string[];
  yc_backed: boolean;
  pass: boolean;
  already_seen: boolean;
  
  // Appended after scoring
  url?: string;
  foundedYear?: number;
  fundingStage?: string;
  fundingTotal?: string;
  workforce?: number | string;
  headquarters?: string;
  founders?: Founder[];
}

export interface ParallelWebhookPayload {
  source: string;
  content: string;
  urls: string[];
  timestamp: string;
  raw: any;
}
