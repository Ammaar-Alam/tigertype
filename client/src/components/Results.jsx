import { useNavigate } from 'react-router-dom';
import { useRace } from '../context/RaceContext';
import { useAuth } from '../context/AuthContext';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTutorial } from '../context/TutorialContext';
import TutorialAnchor from './TutorialAnchor';
import './Results.css';
import axios from 'axios';
import defaultProfileImage from '../assets/icons/default-profile.svg';
import PropTypes from 'prop-types';
import ProfileModal from './ProfileModal.jsx';

const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
];

const accuracyToColor = (accuracy) => {
  if (accuracy == null) {
    return 'rgba(255, 255, 255, 0.08)';
  }
  const clamped = Math.max(0, Math.min(100, accuracy));
  const hue = (clamped / 100) * 120; // 0 = red, 120 = green
  return `hsl(${hue}, 70%, 45%)`;
};

const TrainingResultsPanel = ({ latestStats, trainingState }) => {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchAnalytics = async () => {
      try {
        const [summaryRes, historyRes] = await Promise.all([
          axios.get('/api/training/summary'),
          axios.get('/api/training/history?limit=50')
        ]);

        if (!cancelled) {
          setSummary(summaryRes.data || null);
          setHistory((historyRes.data?.sessions || []).filter(Boolean));
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load training analytics:', err);
          setSummary(null);
          setHistory([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, []);

  const aggregatedUnits = useMemo(() => {
    const map = new Map();

    if (Array.isArray(summary?.unitTotals)) {
      summary.unitTotals.forEach((stat) => {
        const key = `${stat.unitType}:${stat.token}`;
        map.set(key, {
          unitType: stat.unitType,
          token: stat.token,
          exposures: stat.exposures || 0,
          mistakes: stat.mistakes || 0,
          extraHits: stat.extraHits || 0,
          latencyMsSum: (stat.avgLatencyMs != null && stat.latencySamples != null)
            ? stat.avgLatencyMs * stat.latencySamples
            : 0,
          latencySamples: stat.latencySamples || 0,
          p50LatencyMs: stat.p50LatencyMs || null,
          p90LatencyMs: stat.p90LatencyMs || null
        });
      });
    }

    if (Array.isArray(latestStats?.unitStats)) {
      latestStats.unitStats.forEach((stat) => {
        const key = `${stat.unitType}:${stat.token}`;
        if (!map.has(key)) {
          map.set(key, {
            unitType: stat.unitType,
            token: stat.token,
            exposures: 0,
            mistakes: 0,
            extraHits: 0,
            latencyMsSum: 0,
            latencySamples: 0,
            p50LatencyMs: null,
            p90LatencyMs: null
          });
        }
        const entry = map.get(key);
        entry.exposures += stat.exposures || 0;
        entry.mistakes += stat.mistakes || 0;
        entry.extraHits += stat.extraHits || 0;
        entry.latencyMsSum += stat.latencyMsSum || 0;
        entry.latencySamples += stat.latencySamples || 0;
      });
    }

    return map;
  }, [summary, latestStats]);

  const charStatsMap = useMemo(() => {
    const map = new Map();
    aggregatedUnits.forEach((stat) => {
      if (stat.unitType !== 'char') return;
      const token = stat.token === ' ' ? ' ' : stat.token.toUpperCase();
      const exposures = stat.exposures || 0;
      const mistakes = stat.mistakes || 0;
      const accuracy = exposures > 0 ? ((exposures - mistakes) / exposures) * 100 : null;
      const avgLatency = stat.latencySamples > 0 ? stat.latencyMsSum / stat.latencySamples : null;
      map.set(token, {
        exposures,
        mistakes,
        accuracy,
        avgLatency,
        p90Latency: stat.p90LatencyMs || null
      });
    });
    return map;
  }, [aggregatedUnits]);

  const digraphStats = useMemo(() => {
    return Array.from(aggregatedUnits.values())
      .filter((stat) => stat.unitType === 'digraph' && (stat.exposures || 0) > 0)
      .map((stat) => {
        const exposures = stat.exposures || 0;
        const mistakes = stat.mistakes || 0;
        const mistakeRate = ((mistakes + 1) / (exposures + 2)) * 100;
        const accuracy = exposures > 0 ? ((exposures - mistakes) / exposures) * 100 : null;
        return {
          token: stat.token,
          exposures,
          mistakeRate,
          accuracy
        };
      })
      .sort((a, b) => b.mistakeRate - a.mistakeRate)
      .slice(0, 6);
  }, [aggregatedUnits]);

  const planBlocks = trainingState?.plan?.blocks || [];
  const totalBlocks = planBlocks.length;
  const currentIndexRaw = trainingState?.currentBlockIndex ?? 0;
  const completedBlocks = Math.max(0, Math.min(currentIndexRaw, totalBlocks));
  const upcomingIndex = completedBlocks < totalBlocks ? completedBlocks : Math.max(totalBlocks - 1, 0);
  const upcomingBlock = planBlocks[upcomingIndex] || null;
  const completedBlock = latestStats?.blockMeta || (completedBlocks > 0 ? planBlocks[Math.min(completedBlocks - 1, Math.max(planBlocks.length - 1, 0))] : null);
  const planProgressPercent = totalBlocks ? Math.round((completedBlocks / totalBlocks) * 100) : 0;
  const planIdSuffix = trainingState?.plan?.planId?.slice(-4) || '';

  const nextRecommendations = useMemo(() => {
    if (trainingState?.nextTargets?.length) {
      return trainingState.nextTargets.map((target) => {
        const key = `${target.unitType}:${target.token}`;
        const stat = aggregatedUnits.get(key);
        const exposures = stat?.exposures || 0;
        const mistakes = stat?.mistakes || 0;
        const accuracy = exposures > 0 ? ((exposures - mistakes) / exposures) * 100 : null;
        return {
          token: target.token,
          unitType: target.unitType,
          exposures,
          accuracy
        };
      });
    }

    if (Array.isArray(summary?.recommendations) && summary.recommendations.length) {
      return summary.recommendations.slice(0, 6).map((token) => {
        const key = token.length > 2 ? `word:${token}` : (token.length === 2 ? `digraph:${token}` : `char:${token}`);
        const stat = aggregatedUnits.get(key);
        const exposures = stat?.exposures || 0;
        const mistakes = stat?.mistakes || 0;
        const accuracy = exposures > 0 ? ((exposures - mistakes) / exposures) * 100 : null;
        return {
          token,
          unitType: token.length > 1 ? 'digraph' : 'char',
          exposures,
          accuracy
        };
      });
    }

    return [];
  }, [trainingState?.nextTargets, summary?.recommendations, aggregatedUnits]);

  const historyChart = useMemo(() => {
    const completedSessions = history
      .filter(session => session.wpm != null && session.completed_at != null)
      .slice(0, 30)
      .reverse();

    if (!completedSessions.length) {
      return null;
    }

    if (completedSessions.length === 1) {
      return {
        points: completedSessions,
        maxWpm: Number(completedSessions[0].wpm) || 0,
        minWpm: Number(completedSessions[0].wpm) || 0,
        path: '',
        markers: [],
        yTicks: []
      };
    }

    const chartWidth = 320;
    const chartHeight = 140;
    const marginX = 14;
    const marginY = 18;
    const innerWidth = chartWidth - marginX * 2;
    const innerHeight = chartHeight - marginY * 2;

    const rawWpm = completedSessions.map(session => Number(session.wpm) || 0);
    const maxWpm = Math.max(...rawWpm, Number(latestStats?.wpm) || 0);
    const minWpm = Math.min(...rawWpm, Number(latestStats?.wpm) || maxWpm);
    const range = Math.max(5, maxWpm - minWpm || 0);
    const yMax = maxWpm + range * 0.1;
    const yMin = Math.max(0, minWpm - range * 0.1);
    const ySpan = Math.max(1, yMax - yMin);

    const formatLabel = (session) => {
      if (!session?.completed_at) return '';
      return new Date(session.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    const path = completedSessions
      .map((session, index) => {
        const ratio = completedSessions.length > 1 ? index / (completedSessions.length - 1) : 0;
        const x = marginX + ratio * innerWidth;
        const wpm = Number(session.wpm) || 0;
        const y = marginY + (1 - ((wpm - yMin) / ySpan)) * innerHeight;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    const markers = completedSessions.map((session, index) => {
      const ratio = completedSessions.length > 1 ? index / (completedSessions.length - 1) : 0;
      const x = marginX + ratio * innerWidth;
      const wpm = Number(session.wpm) || 0;
      const y = marginY + (1 - ((wpm - yMin) / ySpan)) * innerHeight;
      return {
        x,
        y,
        wpm,
        label: formatLabel(session)
      };
    });

    const yTicks = [yMax, (yMax + yMin) / 2, yMin].map(value => ({
      value,
      y: marginY + (1 - ((value - yMin) / ySpan)) * innerHeight
    }));

    return {
      width: chartWidth,
      height: chartHeight,
      marginX,
      marginY,
      path,
      points: completedSessions,
      markers,
      yTicks,
      maxWpm: yMax,
      minWpm: yMin
    };
  }, [history, latestStats]);

  const describeBlock = (block) => {
    if (!block) return '';
    const rawType = block.type ? block.type.replace(/_/g, ' ') : 'Block';
    const label = rawType.charAt(0).toUpperCase() + rawType.slice(1);
    const seconds = block.seconds ? `${block.seconds}s` : '';
    return seconds ? `${label} · ${seconds}` : label;
  };

  const summariseTargets = (block) => {
    if (!block?.targets?.length) return 'Mixed practice';
    return block.targets
      .slice(0, 4)
      .map((target) => target.token.toUpperCase())
      .join(', ');
  };

  const wpmDisplay = latestStats?.wpm ?? summary?.totals?.avgWpm ?? null;
  const accuracyDisplay = latestStats?.accuracy ?? summary?.totals?.avgAccuracy ?? null;
  const charactersDisplay = latestStats?.totalChars ?? null;
  const mistakesDisplay = latestStats?.errorCount ?? null;
  const durationDisplay = latestStats?.durationSeconds ?? null;
  const blockMeta = trainingState?.blockMeta;

  const renderHeatmap = () => (
    <div className="keyboard-heatmap">
      {KEYBOARD_ROWS.map((row, idx) => (
        <div className="keyboard-row" key={`row-${idx}`}>
          {row.map((key) => {
            const stat = charStatsMap.get(key);
            const color = accuracyToColor(stat?.accuracy);
            const exposures = stat?.exposures || 0;
            const title = stat
              ? `${key}: ${stat.accuracy != null ? stat.accuracy.toFixed(1) : '—'}% • ${exposures}x`
              : `${key}: awaiting data`;
            return (
              <div
                key={key}
                className="heatmap-key"
                style={{ backgroundColor: color, opacity: exposures > 0 ? 1 : 0.35 }}
                title={title}
              >
                {key}
              </div>
            );
          })}
        </div>
      ))}
      <div className="keyboard-row space-row">
        {(() => {
          const stat = charStatsMap.get(' ');
          const color = accuracyToColor(stat?.accuracy);
          const exposures = stat?.exposures || 0;
          const title = stat
            ? `Space: ${stat.accuracy != null ? stat.accuracy.toFixed(1) : '—'}% • ${exposures}x`
            : 'Space: awaiting data';
          return (
            <div
              className="heatmap-key space-key"
              style={{ backgroundColor: color, opacity: exposures > 0 ? 1 : 0.35 }}
              title={title}
            >
              Space
            </div>
          );
        })()}
      </div>
    </div>
  );

  if (loading && !summary && !latestStats) {
    return (
      <div className="training-results-panel">
        <p className="training-empty">Loading adaptive analytics…</p>
      </div>
    );
  }

  return (
    <div className="training-results-panel">
      <div className="training-header">
        <div className="training-title-block">
          <h3>Adaptive Training Insights</h3>
          <div className="plan-status-row">
            {completedBlock && (
              <div className="plan-pill completed">
                <span className="pill-label">Completed</span>
                <span className="pill-value">{describeBlock(completedBlock)}</span>
              </div>
            )}
            {upcomingBlock && (
              <div className="plan-pill next">
                <span className="pill-label">Up next</span>
                <span className="pill-value">
                  {describeBlock(upcomingBlock)}
                  {upcomingBlock.targets?.length ? ` • ${summariseTargets(upcomingBlock)}` : ''}
                </span>
              </div>
            )}
          </div>
          {trainingState?.plan && totalBlocks > 0 && (
            <div className="plan-progress-bar">
              <div className="plan-progress-track">
                <div className="plan-progress-fill" style={{ width: `${planProgressPercent}%` }}></div>
              </div>
              <span className="plan-progress-text">
                {completedBlocks}/{totalBlocks} blocks complete
                {planIdSuffix ? ` • Plan ${planIdSuffix}` : ''}
              </span>
            </div>
          )}
        </div>
        <div className="training-summary-grid">
          <div className="metric-card">
            <span className="metric-label">WPM</span>
            <span className="metric-value">{wpmDisplay != null ? wpmDisplay.toFixed(1) : '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Accuracy</span>
            <span className="metric-value">{accuracyDisplay != null ? `${accuracyDisplay.toFixed(1)}%` : '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Duration</span>
            <span className="metric-value">{durationDisplay != null ? `${Math.round(durationDisplay)}s` : '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Errors</span>
            <span className="metric-value">{mistakesDisplay != null ? mistakesDisplay : '—'}</span>
          </div>
        </div>
      </div>

      <div className="training-body">
        <section className="training-card heatmap-card">
          <header>
            <h4>Keyboard heatmap</h4>
            <span className="card-subtitle">Accuracy by key</span>
          </header>
          {renderHeatmap()}
        </section>

        <section className="training-card digraph-card">
          <header>
            <h4>Digraph pressure points</h4>
            <span className="card-subtitle">Highest mistake rates this week</span>
          </header>
          {digraphStats.length ? (
            <div className="digraph-bars">
              {digraphStats.map((stat) => (
                <div key={stat.token} className="digraph-row">
                  <span className="digraph-token">{stat.token.toUpperCase()}</span>
                  <div className="digraph-bar">
                    <div
                      className="digraph-bar-fill"
                      style={{ width: `${Math.min(100, stat.mistakeRate)}%` }}
                    ></div>
                  </div>
                  <span className="digraph-rate">{stat.mistakeRate.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="training-empty">Keep training to surface tricky letter pairs.</p>
          )}
        </section>

        <section className="training-card nextup-card">
          <header>
            <h4>Next up</h4>
            <span className="card-subtitle">Adaptive plan recommendations</span>
          </header>
          {nextRecommendations.length ? (
            <ul className="nextup-list">
              {nextRecommendations.map((item) => (
                <li key={`${item.unitType}:${item.token}`}>
                  <span className="token-chip">{item.token.toUpperCase()}</span>
                  <span className="token-meta">
                    {item.accuracy != null ? `${item.accuracy.toFixed(1)}% accuracy` : 'Awaiting data'}
                    {item.exposures ? ` · ${item.exposures} reps` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="training-empty">Finish a session to unlock personalised drills.</p>
          )}
        </section>

        <section className="training-card history-card">
          <header>
            <h4>Progress trend</h4>
            <span className="card-subtitle">Last 30 sessions</span>
          </header>
          {historyChart ? (
            <svg
              role="img"
              aria-label="Adaptive training WPM trend"
              width={historyChart.width}
              height={historyChart.height}
            >
              <path
                d={historyChart.path}
                fill="none"
                stroke="var(--primary-color, #ff9900)"
                strokeWidth="2.2"
              />
              {historyChart.markers.map((marker, idx) => (
                <g key={`marker-${idx}`} className="chart-marker" transform={`translate(${marker.x}, ${marker.y})`}>
                  <circle r="3.4" fill="var(--primary-color, #ff9900)" />
                  <title>{`${marker.label}: ${marker.wpm.toFixed(1)} WPM`}</title>
                </g>
              ))}
              {historyChart.yTicks.map((tick, idx) => (
                <g key={`tick-${idx}`} transform={`translate(0, ${tick.y})`} className="chart-tick">
                  <line x1="0" x2={historyChart.width} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                  <text x="4" y="-4" fill="rgba(255,255,255,0.4)" fontSize="10">
                    {tick.value.toFixed(0)}
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <p className="training-empty">Complete a few more sessions to unlock progress tracking.</p>
          )}
        </section>
      </div>

      <div className="training-footer">
        <p className="training-footer-note">
          Practice streaks boost retention. Keep logging sessions to unlock mastery badges and richer analytics.
        </p>
      </div>
    </div>
  );
};


TrainingResultsPanel.propTypes = {
  latestStats: PropTypes.shape({
    wpm: PropTypes.number,
    accuracy: PropTypes.number,
    totalChars: PropTypes.number,
    errorCount: PropTypes.number,
    durationSeconds: PropTypes.number,
    charStats: PropTypes.arrayOf(PropTypes.shape({
      character: PropTypes.string,
      exposures: PropTypes.number,
      mistakes: PropTypes.number,
      extraHits: PropTypes.number,
      avgLatencyMs: PropTypes.number,
      latencySamples: PropTypes.number
    })),
    unitStats: PropTypes.arrayOf(PropTypes.shape({
      unitType: PropTypes.string,
      token: PropTypes.string,
      exposures: PropTypes.number,
      mistakes: PropTypes.number,
      extraHits: PropTypes.number,
      latencyMsSum: PropTypes.number,
      latencySamples: PropTypes.number
    }))
  }),
  trainingState: PropTypes.shape({
    focusLetters: PropTypes.arrayOf(PropTypes.string),
    focusUnits: PropTypes.array,
    nextTargets: PropTypes.array,
    plan: PropTypes.shape({
      planId: PropTypes.string,
      generatedAt: PropTypes.string,
      dueCount: PropTypes.number,
      blocks: PropTypes.array
    }),
    currentBlockIndex: PropTypes.number,
    blockMeta: PropTypes.shape({
      id: PropTypes.string,
      type: PropTypes.string,
      seconds: PropTypes.number,
      targets: PropTypes.array
    }),
    dueCount: PropTypes.number
  })
};


function Results({ onShowLeaderboard }) {
  const navigate = useNavigate();
  const { raceState, typingState, resetRace, joinPublicRace } = useRace();
  const { isRunning, endTutorial } = useTutorial();
  const { user } = useAuth();
  // State for profile modal
  const [selectedProfileNetid, setSelectedProfileNetid] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  // State for storing fetched titles for result players
  const [resultTitlesMap, setResultTitlesMap] = useState({});
  
  // --- DEBUG LOG --- 
  useEffect(() => {
    // console.log('[Results Component Render] raceState.snippet:', raceState.snippet);
  }, [raceState.snippet]);
  // --- END DEBUG LOG --- 
  
  // Fetch titles for each player in race results
  useEffect(() => {
    if (raceState.results && raceState.results.length) {
      raceState.results.forEach(result => {
        const netid = result.netid;
        // Sync current user's titles from context
        if (netid === user?.netid && user?.titles && resultTitlesMap[netid] !== user.titles) {
          setResultTitlesMap(prev => ({ ...prev, [netid]: user.titles }));
        }
        // Fetch other players' titles
        if (netid !== user?.netid && !(netid in resultTitlesMap)) {
          axios.get(`/api/user/${netid}/titles`)
            .then(res => setResultTitlesMap(prev => ({ ...prev, [netid]: res.data || [] })))
            .catch(err => {
              console.error(`Error fetching titles for ${netid}:`, err);
              setResultTitlesMap(prev => ({ ...prev, [netid]: [] }));
            });
        }
      });
    }
  }, [raceState.results, user, resultTitlesMap]);
  
  // Handle back button
  const handleBack = () => {
    if (isRunning) endTutorial();
    resetRace();
    navigate('/home?refreshUser=true');
  };
  
  // Handle avatar click to show profile modal
  const handleAvatarClick = (_avatar, netid) => {
    setSelectedProfileNetid(netid);
    setShowProfileModal(true);
    document.body.style.overflow = 'hidden';
  };
  
  // Close profile modal
  const closeModal = useCallback(() => {
    setShowProfileModal(false);
    setSelectedProfileNetid(null);
    document.body.style.overflow = '';
  }, []);
  
  // Add handler to queue another public race
  const handleQueueNext = () => {
    // Reset local race state before queuing
    resetRace();
    // Force a new public race queue, ignoring previous lobby code
    joinPublicRace(true);
  };
  
  // Render practice mode results
  const renderPracticeResults = () => {
    if (raceState.training?.enabled) {
      const latestTrainingStats = raceState.training?.latestStats;
      return (
        <TutorialAnchor anchorId="practice-results">
          <div className="practice-results training-view">
            {latestTrainingStats ? (
              <TrainingResultsPanel
                latestStats={latestTrainingStats}
                trainingState={raceState.training}
              />
            ) : (
              <>
                <div className="training-empty state">
                  <p>Complete a training session to unlock personalised analytics.</p>
                </div>
                <div className="keyboard-shortcuts">
                  <p>Press <kbd>Tab</kbd> for a new session • <kbd>Esc</kbd> to restart</p>
                </div>
              </>
            )}
          </div>
        </TutorialAnchor>
      );
    }

    // Function to render the main stats block
    const renderStatsBlock = (wpm, accuracy, time) => {
      const rawWpm = wpm;
      const adjustedWpm = rawWpm * (accuracy / 100);
      return (
        <>
          <div className="stat-item">
            <div className="stat-label">
              <i className="bi bi-clock"></i>
              Time Completed:
            </div>
            <div className="stat-value">{time?.toFixed(2)}s</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">
              <i className="bi bi-check-circle"></i>
              Accuracy:
            </div>
            <div className="stat-value">{accuracy?.toFixed(2)}%</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">
              <i className="bi bi-speedometer"></i>
              Raw WPM:
            </div>
            <div className="stat-value">{rawWpm?.toFixed(2)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">
              <i className="bi bi-lightning"></i>
              Adjusted WPM:
            </div>
            <div className="stat-value highlight">{adjustedWpm?.toFixed(2)}</div>
          </div>
        </>
      );
    };
    
    // Determine which data source to use
    let statsContent;
    const resultFromState = raceState.results?.[0];

    if (resultFromState) {
      statsContent = renderStatsBlock(
        resultFromState.wpm,
        resultFromState.accuracy,
        resultFromState.completion_time
      );
    } else if (typingState.completed && raceState.startTime) { // Make sure startTime exists
      const elapsedSeconds = (Date.now() - raceState.startTime) / 1000;
      statsContent = renderStatsBlock(
        typingState.wpm,
        typingState.accuracy,
        elapsedSeconds
      );
    } else {
      statsContent = (
        <div className="loading-results">
          <div className="spinner-border text-orange" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p>Waiting for results...</p>
        </div>
      );
    }

    return (
      <TutorialAnchor anchorId="practice-results">
        <div className="practice-results">
        <h3>Practice Results</h3>
        {statsContent}
        {/* Snippet Source Info */}
        {raceState.type !== 'timed' && raceState.snippet && raceState.snippet.course_name && (
          <div className="snippet-info">
            Where is this excerpt from?{' '}
            <strong>{raceState.snippet.course_name || raceState.snippet.source || 'Unknown Source'}</strong>
          </div>
        )}
        {/* Course Review Button */}
        {raceState.type !== 'timed' && raceState.snippet?.course_name && raceState.snippet?.princeton_course_url && (
          <a
            href={raceState.snippet.princeton_course_url}
            className="course-review-btn"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i className="bi bi-book"></i>
            View Course Review
          </a>
        )}
        <TutorialAnchor anchorId="keyboard-shortcuts">
          <div className="keyboard-shortcuts">
            <p>Press <kbd>Tab</kbd> for a new excerpt • <kbd>Esc</kbd> to restart</p>
          </div>
        </TutorialAnchor>
        {/* Conditionally add Leaderboard Button */} 
        {onShowLeaderboard && (
          <TutorialAnchor anchorId="finish-practice">
            <button className="leaderboard-shortcut-btn" onClick={onShowLeaderboard}>
              <i className="bi bi-trophy"></i> View Leaderboards
            </button>
          </TutorialAnchor>
        )}
        </div>
      </TutorialAnchor>
    );
  };
  
  // Render multiplayer race results
  const renderRaceResults = () => {
    if (!raceState.results || raceState.results.length === 0) {
      return (
        <p>Waiting for results...</p>
      );
    }
    
    // Get the first place result (winner)
    const winner = raceState.results[0];
    const otherResults = raceState.results.slice(1);
    
    return (
      <>
        {/* First place winner with large avatar */}
        <div className="winner-showcase">
          <div 
            className="winner-avatar" 
            onClick={() => handleAvatarClick(winner.avatar_url, winner.netid)}
            title="Click to enlarge"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleAvatarClick(winner.avatar_url, winner.netid);
                e.preventDefault();
              }
            }}
          >
            <img 
              src={winner.avatar_url || defaultProfileImage} 
              alt={`${winner.netid}'s avatar`}
              onError={(e) => { e.target.onerror = null; e.target.src=defaultProfileImage; }}
            />
          </div>
          <div className="winner-details">
            <div className="winner-header">
              <div className="winner-trophy"><i className="bi bi-trophy"></i></div>
              <div className="winner-netid">{winner.netid}</div>
            </div>
            {/* Display titles for winner */}
{(() => {
  const titlesList = resultTitlesMap[winner.netid] || [];
  const titleToShow = titlesList.find(t => t.is_equipped) || titlesList[0];
  return titleToShow ? (
    <div className="winner-titles">
      <span className="winner-title-badge">{titleToShow.name}</span>
    </div>
  ) : null;
})()}
            <div className="winner-stats">
              <div className="winner-wpm">{winner.wpm?.toFixed(2) || 0} WPM</div>
              <div className="winner-accuracy">{winner.accuracy?.toFixed(2) || 0}% accuracy</div>
              <div className="winner-time">{winner.completion_time?.toFixed(2) || 0}s</div>
            </div>
          </div>
        </div>
        
        {/* Other results */}
        <div className="results-list">
          {otherResults.map((result, index) => (
            <div 
              key={index} 
              className={`result-item ${result.netid === user?.netid ? 'current-user' : ''}`}
            >
              <div className="result-rank">#{index + 2}</div>
              <div className="result-player">
                <div 
                  className="result-avatar"
                  onClick={() => handleAvatarClick(result.avatar_url, result.netid)}
                  title="Click to enlarge"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleAvatarClick(result.avatar_url, result.netid);
                      e.preventDefault();
                    }
                  }}
                >
                  <img 
                    src={result.avatar_url || defaultProfileImage} 
                    alt={`${result.netid}'s avatar`}
                    onError={(e) => { e.target.onerror = null; e.target.src=defaultProfileImage; }}
                  />
                </div>
                <div className="result-text">
                  <div className="result-netid">{result.netid}</div>
                  {(() => {
                    const titlesList = resultTitlesMap[result.netid] || [];
                    const titleToShow = titlesList.find(t => t.is_equipped) || titlesList[0];
                    return titleToShow ? (
                      <div className="result-titles">
                        <span className="result-title-badge">{titleToShow.name}</span>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
              <div className="result-stats">
                <div className="result-wpm">{result.wpm?.toFixed(2) || 0} WPM</div>
                <div className="result-accuracy">{result.accuracy?.toFixed(2) || 0}%</div>
                <div className="result-time">{result.completion_time?.toFixed(2) || 0}s</div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Snippet Source Info */}
        {raceState.type !== 'timed' && raceState.snippet && raceState.snippet.course_name && (
          <div className="snippet-info">
            Where is this excerpt from?{' '}
            <strong>{raceState.snippet.course_name || raceState.snippet.source || 'Unknown Source'}</strong>
          </div>
        )}
        {/* Course Review Button for multiplayer results */}
        {raceState.type !== 'timed' && raceState.snippet?.course_name && raceState.snippet?.princeton_course_url && (
          <a
            href={raceState.snippet.princeton_course_url}
            className="course-review-btn"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i className="bi bi-book"></i>
            View Course Review
          </a>
        )}
      </>
    );
  };
  
  return (
    <>
      <div className="results-container">
        <h2>Results</h2>
        
        {raceState.type === 'practice' ? renderPracticeResults() : renderRaceResults()}
        
        {/* Queue Next Race button for quick matches */}
        {raceState.type === 'public' && (
          <button className="back-btn" onClick={handleQueueNext}>
            Queue Another Race
          </button>
        )}
        
        <button className="back-btn back-to-menu-btn" onClick={handleBack}>
          Back to Menu
        </button>
      </div>
      
      {/* Profile Modal for viewing user profiles */}
      {showProfileModal && (
        <ProfileModal
          isOpen={showProfileModal}
          onClose={closeModal}
          netid={selectedProfileNetid}
        />
      )}
    </>
  );
}

Results.propTypes = {
  onShowLeaderboard: PropTypes.func, // Prop is optional
};

export default Results;
