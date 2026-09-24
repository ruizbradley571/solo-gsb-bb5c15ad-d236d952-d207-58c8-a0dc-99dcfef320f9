/**
 * Transcript coverage checking: load a local WebVTT transcript as *coverage
 * reference only* — its cues are never imported as chapters. For every chapter
 * the cues are intersected with the chapter interval (cross-chapter cues are
 * split at the boundary, never assigned wholesale), out-of-bounds parts are
 * clipped, the intersecting pieces are merged and the covered WHOLE seconds
 * are counted with a 1s bin grid, so overlapping cues never count the same
 * second twice. Coverage is coveredBins / bins of the chapter.
 *
 * Pure functions (no DOM, no React) — covered by scripts/test-transcript.ts.
 */
import { parseWebVTT } from './importChapters';

const EPS = 1e-6;

export interface TranscriptCue {
  /** original cue order in the file */
  index: number;
  start: number;
  end: number;
  text: string;
}

/** A cue (or the in-chapter fragment of a cue) intersecting a chapter. */
export interface CueHit {
  cue: TranscriptCue;
  /** intersection of the cue with the chapter — clipped, before merging */
  start: number;
  end: number;
}

export interface ChapterCoverage {
  chapterId: string;
  coveredSeconds: number;
  totalSeconds: number;
  ratio: number;
  /** intersecting cues, ordered by the in-chapter intersection start */
  hits: CueHit[];
}

export interface Transcript {
  fileName: string;
  cues: TranscriptCue[];
  /** cues skipped because their timing was unparseable */
  skipped: number;
  /** cues dropped because they held no positive-length intersection with audio */
  outOfAudio: number;
  duration: number;
}

/** Number of integer-second bins [k, k+1) intersected by a positive interval. */
function countBins(lo: number, hi: number): number {
  return Math.max(0, Math.ceil(hi - EPS) - Math.floor(lo + EPS));
}

/** Merge overlapping/touching intervals into a list of disjoint intervals. */
export function mergeIntervals(
  intervals: { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = intervals
    .filter((iv) => iv.end - iv.start > EPS)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end + EPS) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

/**
 * Parse a local WebVTT transcript and keep it as coverage reference. Cue
 * intervals are clipped to [0, duration]; cues that then have no positive
 * length are counted as `outOfAudio` and dropped. The cues are never turned
 * into chapters. Non-WebVTT content (or a file with no readable cues) throws.
 */
export function loadTranscript(text: string, fileName: string, duration: number): Transcript {
  if (text.trim() === '') throw new Error('逐字稿文件为空。');
  if (!/^(?:\uFEFF)?WEBVTT/.test(text.trimStart())) {
    throw new Error('仅支持标准 WebVTT 逐字稿（文件需以 WEBVTT 开头）；章节 JSON 请用「导入章节」。');
  }
  const parsed = parseWebVTT(text.replace(/^\uFEFF/, ''));
  let skipped = 0;
  let outOfAudio = 0;
  const cues: TranscriptCue[] = [];
  for (const e of parsed.entries) {
    if (e.error) {
      skipped += 1;
      continue;
    }
    const start = Math.max(0, Math.min(e.start, duration));
    const end = Math.max(0, Math.min(e.end, duration));
    if (end - start <= EPS) {
      outOfAudio += 1;
      continue;
    }
    cues.push({ index: cues.length, start, end, text: e.title });
  }
  if (cues.length === 0) {
    throw new Error(
      skipped > 0
        ? '未读到任何可用字幕：时间码均无法解析。'
        : '未读到任何与当前音频时间范围相交的字幕 cue。',
    );
  }
  return { fileName, cues, skipped, outOfAudio, duration };
}

/**
 * Coverage of one chapter by the given cues. Each cue contributes only its
 * intersection with [chapterStart, chapterEnd] (a cue spanning a boundary is
 * split across both chapters); intersections are merged so overlapping cues
 * count each integer second at most once. `totalSeconds` is the number of
 * integer-second bins the chapter spans; chapters shorter than 1s still have
 * one bin.
 */
export function chapterCoverage(
  chapterId: string,
  chapterStart: number,
  chapterEnd: number,
  cues: readonly TranscriptCue[],
): ChapterCoverage {
  const hits: CueHit[] = [];
  const pieces: { start: number; end: number }[] = [];
  for (const cue of cues) {
    const start = Math.max(chapterStart, cue.start);
    const end = Math.min(chapterEnd, cue.end);
    if (end - start <= EPS) continue;
    hits.push({ cue, start, end });
    pieces.push({ start, end });
  }
  hits.sort((a, b) => a.start - b.start || a.end - b.end || a.cue.index - b.cue.index);

  let coveredSeconds = 0;
  for (const iv of mergeIntervals(pieces)) {
    coveredSeconds += countBins(iv.start, iv.end);
  }
  const totalSeconds = Math.max(1, countBins(chapterStart, chapterEnd));
  return {
    chapterId,
    coveredSeconds,
    totalSeconds,
    ratio: totalSeconds > 0 ? Math.min(1, coveredSeconds / totalSeconds) : 0,
    hits,
  };
}

/**
 * Coverage of all chapters. Results follow the input chapter order; callers
 * pass the sorted list when displaying by time. A cue crossing a chapter
 * boundary appears (clipped) in both chapters.
 */
export function coverageByChapters(
  chapters: { id: string; start: number; end: number }[],
  transcript: Transcript,
): ChapterCoverage[] {
  return chapters.map((c) => chapterCoverage(c.id, c.start, c.end, transcript.cues));
}
