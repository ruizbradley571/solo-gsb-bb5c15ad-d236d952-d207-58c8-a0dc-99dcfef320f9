import {
  loadTranscript,
  chapterCoverage,
  coverageByChapters,
  mergeIntervals,
} from '../src/utils/transcript';

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`ok ${msg}`);
  } else {
    failures++;
    console.error(`FAIL ${msg}`);
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${msg}${a === e ? '' : ` — expected ${e}, got ${a}`}`);
}
function expectThrow(fn: () => unknown, msg: string) {
  try {
    fn();
    failures++;
    console.error(`FAIL ${msg} — expected throw`);
  } catch {
    console.log(`ok ${msg}`);
  }
}

const D = 100;
const VTT = (cues: string) => `WEBVTT\n\n${cues}`;

// ---- mergeIntervals ----
eq(
  mergeIntervals([
    { start: 0, end: 2 },
    { start: 1, end: 3 },
    { start: 5, end: 6 },
    { start: 3, end: 5 }, // touching intervals chain: [0,3] -> [3,5] -> [5,6]
  ]),
  [{ start: 0, end: 6 }],
  'merge overlapping and touching intervals',
);
eq(mergeIntervals([{ start: 0, end: 0 }]), [], 'zero-length interval dropped');

// ---- loading & clipping ----
{
  const t = loadTranscript(
    VTT(
      [
        '00:00:00.000 --> 00:00:10.000',
        'A',
        '',
        '00:01:40.000 --> 00:02:00.000', // fully beyond audio (start 100 == duration)
        'late',
        '',
        '00:00:55.000 --> 00:01:50.000', // extends past duration (110s) -> clipped
        'tail',
        '',
        'soon --> later',
        'bad',
      ].join('\n'),
    ),
    't.vtt',
    D,
  );
  eq(t.cues.length, 2, '2 usable cues (1 out of audio, 1 unparseable)');
  eq(t.skipped, 1, 'unparseable cue counted');
  eq(t.outOfAudio, 1, 'fully out-of-audio cue counted');
  eq([t.cues[1].start, t.cues[1].end], [55, 100], 'overflow cue clipped to duration');
}
expectThrow(() => loadTranscript('   ', 'x.vtt', D), 'empty transcript throws');
expectThrow(
  () => loadTranscript('{"chapters":[]}', 'x.vtt', D),
  'non-WebVTT content throws',
);
expectThrow(
  () => loadTranscript(VTT('00:05:00.000 --> 00:06:00.000\nlate'), 'x.vtt', D),
  'no intersecting cue throws',
);
{
  const t = loadTranscript('﻿' + VTT('00:00:01.000 --> 00:00:02.000\nok'), 'x.vtt', D);
  eq(t.cues.length, 1, 'BOM-prefixed WebVTT accepted');
}

// ---- coverage: basic seconds counting ----
{
  // chapter [0, 10]
  const t = loadTranscript(
    VTT(
      [
        '00:00:00.200 --> 00:00:03.800', // bins 0,1,2,3 -> 4s (bin 3 touched until 3.8)
        'one',
        '',
        '00:00:05.000 --> 00:00:08.500', // bins 5,6,7,8 -> 4s
        'two',
      ].join('\n'),
    ),
    't.vtt',
    D,
  );
  const cov = chapterCoverage('c1', 0, 10, t.cues);
  eq(cov.coveredSeconds, 8, 'covered whole seconds per cue');
  eq(cov.totalSeconds, 10, 'chapter spans 10 bins');
  eq(cov.ratio, 0.8, 'ratio 0.8');
  eq(cov.hits.length, 2, 'both cues listed as hits');
}

// ---- overlapping cues count each second once ----
{
  const t = loadTranscript(
    VTT(
      [
        '00:00:00.000 --> 00:00:06.000',
        'a',
        '',
        '00:00:02.000 --> 00:00:04.000', // fully inside the first
        'b',
        '',
        '00:00:05.500 --> 00:00:09.000', // overlaps bin 5 (already), adds 6,7,8
        'c',
      ].join('\n'),
    ),
    't.vtt',
    D,
  );
  const cov = chapterCoverage('c1', 0, 10, t.cues);
  eq(cov.coveredSeconds, 9, 'union of cues -> bins 0..8 = 9s, no double count');
  eq(cov.ratio, 0.9, 'merged ratio');
}

// ---- cross-chapter cue is split by intersection, not assigned wholesale ----
{
  const t = loadTranscript(
    VTT('00:00:08.000 --> 00:00:25.000\nspanning'),
    't.vtt',
    D,
  );
  const chapters = [
    { id: 'a', start: 0, end: 10 },
    { id: 'b', start: 10, end: 20 },
    { id: 'c', start: 20, end: 30 },
  ];
  const cov = coverageByChapters(chapters, t);
  // a: [8,10] bins 8,9 -> 2/10
  eq([cov[0].coveredSeconds, cov[0].totalSeconds], [2, 10], 'chapter a counts only its slice');
  // b: [10,20] bins 10..19 -> 10/10
  eq([cov[1].coveredSeconds, cov[1].totalSeconds], [10, 10], 'chapter b fully covered by the spanning cue');
  // c: [20,25] bins 20..24 -> 5/10
  eq([cov[2].coveredSeconds, cov[2].totalSeconds], [5, 10], 'chapter c counts the clipped tail');
  // the same cue appears in all three chapters with the clipped fragments
  eq(cov.map((c) => c.hits.map((h) => [h.start, h.end])), [
    [[8, 10]],
    [[10, 20]],
    [[20, 25]],
  ], 'cross-chapter cue clipped per chapter');
  eq(cov.every((c) => c.hits.length === 1 && c.hits[0].cue.text === 'spanning'), true, 'same cue referenced in every intersecting chapter');
}

// ---- a cue outside a chapter contributes nothing ----
{
  const t = loadTranscript(VTT('00:00:30.000 --> 00:00:40.000\nfar'), 't.vtt', D);
  const cov = chapterCoverage('c1', 0, 10, t.cues);
  eq([cov.coveredSeconds, cov.ratio, cov.hits.length], [0, 0, 0], 'no intersection -> 0 coverage');
}

// ---- sub-second chapter still reports at least one total bin ----
{
  const t = loadTranscript(VTT('00:00:10.100 --> 00:00:10.800\nshort'), 't.vtt', D);
  const cov = chapterCoverage('c1', 10, 10.5, t.cues);
  eq(cov.totalSeconds, 1, 'short chapter has one bin denominator');
  eq(cov.coveredSeconds, 1, 'cue touching the bin covers it');
  eq(cov.ratio, 1, 'fully covered short chapter');
}

// ---- clips inside the audio but starting before 0 ----
{
  // parseWebVTT rejects negative timestamps via regex, so a cue ending at 0 is out-of-audio
  const t = loadTranscript(VTT('00:00:00.000 --> 00:00:01.000\nzero'), 't.vtt', D);
  eq([t.cues[0].start, t.cues[0].end], [0, 1], 'cue kept at audio start');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
