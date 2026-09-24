import { useMemo, useState } from 'react';
import type { Chapter } from '../types';
import type { ChapterCoverage, Transcript } from '../utils/transcript';
import { formatTime } from '../utils/time';

interface TranscriptPanelProps {
  transcript: Transcript | null;
  chapters: Chapter[];
  /** coverage aligned with `chapters`; null while no transcript is loaded */
  coverage: ChapterCoverage[] | null;
  parseError: string | null;
  onPickFile: () => void;
  onClear: () => void;
  /** click an intersecting cue (or a chapter row) -> seek there to audition */
  onSeek: (sec: number) => void;
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

function ratioClass(r: number): string {
  if (r >= 0.9) return 'cov-high';
  if (r >= 0.5) return 'cov-mid';
  return 'cov-low';
}

/**
 * Transcript coverage checker. The loaded WebVTT only serves as a coverage
 * reference — cues are never turned into chapters. Per chapter the panel shows
 * covered seconds / ratio (recomputed live on every boundary edit) and the
 * intersecting cues; a cue click seeks to that time.
 */
export function TranscriptPanel(props: TranscriptPanelProps) {
  const { transcript, chapters, coverage, parseError, onPickFile, onClear, onSeek } = props;
  const [openChapter, setOpenChapter] = useState<string | null>(null);

  const totals = useMemo(() => {
    if (!coverage || coverage.length === 0) return null;
    const covered = coverage.reduce((s, c) => s + c.coveredSeconds, 0);
    const total = coverage.reduce((s, c) => s + c.totalSeconds, 0);
    return { covered, total, ratio: total > 0 ? covered / total : 0 };
  }, [coverage]);

  return (
    <section className="silence-panel transcript-panel">
      <h2>逐字稿覆盖核对</h2>

      {!transcript ? (
        <>
          <p className="transcript-hint">
            载入本地 WebVTT 逐字稿，按字幕与章节的时间交集统计每章有文字覆盖的秒数与占比。
            字幕仅作覆盖参照，<b>不会作为章节导入</b>。
          </p>
          <button className="primary" onClick={onPickFile}>
            载入 WebVTT 逐字稿
          </button>
          {parseError && <div className="transcript-error">{parseError}</div>}
        </>
      ) : (
        <>
          <div className="transcript-head">
            <span className="transcript-file" title={transcript.fileName}>
              📄 {transcript.fileName}
            </span>
            <button className="transcript-clear" onClick={onClear} title="移除当前逐字稿">
              移除
            </button>
          </div>
          <div className="transcript-meta">
            {transcript.cues.length} 条字幕
            {(transcript.skipped > 0 || transcript.outOfAudio > 0) && (
              <span>
                （已忽略 {transcript.skipped} 条时间码无效
                {transcript.outOfAudio > 0 && `、${transcript.outOfAudio} 条与音频无交集`}
                ，越界部分按音频时长裁剪）
              </span>
            )}
          </div>

          {totals && (
            <div className="transcript-total">
              <div className="cov-bar">
                <div
                  className={`cov-fill ${ratioClass(totals.ratio)}`}
                  style={{ width: pct(totals.ratio) }}
                />
              </div>
              <span>
                全部章节合计覆盖 <b>{totals.covered}</b> / {totals.total} 秒（{pct(totals.ratio)}）
              </span>
            </div>
          )}

          {chapters.length === 0 ? (
            <div className="silence-info">还没有章节。创建或编辑章节后即时重算覆盖率。</div>
          ) : (
            <div className="cov-list">
              {chapters.map((c, i) => {
                const cov = coverage?.[i];
                if (!cov) return null;
                const open = openChapter === c.id;
                return (
                  <div key={c.id} className="cov-item">
                    <button
                      type="button"
                      className={`cov-row${open ? ' open' : ''}`}
                      onClick={() => setOpenChapter(open ? null : c.id)}
                      title="展开 / 收起相交字幕"
                    >
                      <span className="cov-title">{c.title || '未命名章节'}</span>
                      <span className={`cov-pill ${ratioClass(cov.ratio)}`}>
                        {cov.coveredSeconds}/{cov.totalSeconds}s · {pct(cov.ratio)}
                      </span>
                      <span className="cov-disclosure">{open ? '▾' : '▸'}</span>
                    </button>
                    <div className="cov-bar cov-bar-sm">
                      <div
                        className={`cov-fill ${ratioClass(cov.ratio)}`}
                        style={{ width: pct(cov.ratio) }}
                      />
                    </div>
                    {open && (
                      <div className="cov-cues">
                        {cov.hits.length === 0 ? (
                          <div className="cov-cue-empty">该章没有相交字幕。</div>
                        ) : (
                          cov.hits.map((h) => (
                            <button
                              type="button"
                              key={`${h.cue.index}-${h.start}-${h.end}`}
                              className="cov-cue"
                              title={`跳转到 ${formatTime(h.start)} 试听`}
                              onClick={() => onSeek(h.start)}
                            >
                              <span className="cov-cue-time">
                                {formatTime(h.start)} → {formatTime(h.end)}
                              </span>
                              <span className="cov-cue-text">
                                {h.cue.text.trim() || '（无文本）'}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={onPickFile}>更换逐字稿</button>
        </>
      )}
    </section>
  );
}
