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

const TrainingResultsPanel = ({ latestStats, trainingState }) => {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllChars, setShowAllChars] = useState(false);

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

  useEffect(() => {
    setShowAllChars(false);
  }, [latestStats]);

  const sessionCharStats = useMemo(() => {
    return (latestStats?.charStats || [])
      .filter(stat => stat.exposures > 0)
      .map(stat => {
        const accuracy = stat.exposures > 0
          ? ((stat.exposures - stat.mistakes) / stat.exposures) * 100
          : 100;
        return { ...stat, accuracy };
      })
      .sort((a, b) => b.mistakes - a.mistakes);
  }, [latestStats]);

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

  const focusLetters = trainingState?.focusLetters?.length
    ? trainingState.focusLetters
    : summary?.recommendations || [];

  const aggregatedChars = summary?.charTotals?.reduce((acc, item) => acc + (item.exposures || 0), 0) ?? null;
  const aggregatedMistakes = summary?.charTotals?.reduce((acc, item) => acc + (item.mistakes || 0), 0) ?? null;

  const wpmDisplay = latestStats?.wpm ?? summary?.totals?.avgWpm ?? null;
  const accuracyDisplay = latestStats?.accuracy ?? summary?.totals?.avgAccuracy ?? null;
  const charactersDisplay = latestStats?.totalChars ?? aggregatedChars ?? '—';
  const mistakesDisplay = latestStats?.errorCount ?? aggregatedMistakes ?? 0;

  const visibleCharStats = showAllChars ? sessionCharStats : sessionCharStats.slice(0, 12);
  const showCharToggle = sessionCharStats.length > 12 || (summary?.charTotals?.length ?? 0) > 8;
  const longTermStats = summary?.charTotals || [];
  const longTermVisibleStats = showAllChars ? longTermStats : longTermStats.slice(0, 8);
  const longTermKeys = longTermStats.length;

  const formattedCharactersValue = typeof charactersDisplay === 'number'
    ? charactersDisplay.toLocaleString()
    : charactersDisplay;
  const formattedMistakesValue = typeof mistakesDisplay === 'number'
    ? mistakesDisplay.toLocaleString()
    : mistakesDisplay;

  const sessionMetaParts = [];
  if (typeof charactersDisplay === 'number') {
    sessionMetaParts.push(`${charactersDisplay.toLocaleString()} characters`);
  }
  if (sessionCharStats.length) {
    sessionMetaParts.push(`${sessionCharStats.length} tracked keys`);
  }
  const sessionMeta = sessionMetaParts.join(' • ');

  const charGridClasses = ['char-stat-grid'];
  if (showAllChars && sessionCharStats.length > 12) {
    charGridClasses.push('scrollable');
  }

  const longTermGridClasses = ['char-stat-grid', 'long-term-grid'];
  if (showAllChars && longTermStats.length > 8) {
    longTermGridClasses.push('scrollable');
  }

  return (
    <div className="training-results-panel">
      <div className="training-header">
        <div className="training-title-block">
          <h3>Adaptive Training Session</h3>
          {focusLetters.length > 0 && (
            <div className="focus-chips" aria-label="Focus letters this session">
              {focusLetters.slice(0, 8).map(letter => (
                <span key={letter} className="focus-chip">
                  {letter === ' ' ? 'Space' : letter.toUpperCase()}
                </span>
              ))}
            </div>
          )}
          {sessionMeta && (
            <p className="training-session-meta">{sessionMeta}</p>
          )}
        </div>

        <div className="training-metrics">
          <div className="metric-card">
            <span className="metric-label">WPM</span>
            <span className="metric-value">{wpmDisplay != null ? wpmDisplay.toFixed(1) : '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Accuracy</span>
            <span className="metric-value">
              {accuracyDisplay != null ? `${accuracyDisplay.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Characters</span>
            <span className="metric-value">{formattedCharactersValue}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Mistakes</span>
            <span className="metric-value">{formattedMistakesValue}</span>
          </div>
        </div>
      </div>

      <div className="training-body">
        <section className="training-card key-accuracy-card">
          <div className="card-header">
            <h4>This Session&apos;s Accuracy by Key</h4>
            {showCharToggle && (
              <button
                type="button"
                className="char-grid-toggle"
                onClick={() => setShowAllChars(prev => !prev)}
                aria-expanded={showAllChars}
              >
                View {showAllChars ? 'less' : 'all'}
              </button>
            )}
          </div>
          {visibleCharStats.length ? (
            <div className={charGridClasses.join(' ')}>
              {visibleCharStats.map(stat => {
                const label = stat.character === ' ' ? 'Space' : stat.character.toUpperCase();
                return (
                  <div key={stat.character} className="char-stat-row">
                    <span className="char-label">{label}</span>
                    <div className="char-bar">
                      <div
                        className="char-bar-fill"
                        style={{ width: `${Math.max(5, Math.min(100, stat.accuracy))}%` }}
                      />
                    </div>
                    <span className="char-accuracy">{stat.accuracy.toFixed(0)}%</span>
                    <span className="char-meta">{stat.mistakes}/{stat.exposures}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="training-empty">Finish a session to see letter-specific feedback.</p>
          )}
        </section>

        <section className="training-card progress-card">
          <div className="card-header">
            <h4>Recent Progress</h4>
            {loading && <span className="loading-note">Loading…</span>}
          </div>
          {historyChart ? (
            <div className="history-chart">
              {historyChart.path ? (
                <>
                  <div className="chart-canvas">
                    <svg
                      width={historyChart.width}
                      height={historyChart.height}
                      viewBox={`0 0 ${historyChart.width} ${historyChart.height}`}
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient id="trainingChartFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="rgba(255, 153, 0, 0.28)" />
                          <stop offset="100%" stopColor="rgba(255, 153, 0, 0.05)" />
                        </linearGradient>
                      </defs>
                      <path
                        d={`${historyChart.path} L${historyChart.width - historyChart.marginX},${historyChart.height - historyChart.marginY} L${historyChart.marginX},${historyChart.height - historyChart.marginY} Z`}
                        fill="url(#trainingChartFill)"
                        stroke="none"
                      />
                      <path
                        d={historyChart.path}
                        fill="none"
                        stroke="var(--primary-color, #ff9900)"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                      {historyChart.yTicks.map(tick => (
                        <g key={tick.value}>
                          <line
                            x1={historyChart.marginX}
                            x2={historyChart.width - historyChart.marginX}
                            y1={tick.y}
                            y2={tick.y}
                            stroke="rgba(255,255,255,0.06)"
                            strokeWidth="1"
                          />
                        </g>
                      ))}
                      {historyChart.markers.map((marker, idx) => (
                        <g key={`${marker.label}-${idx}`}>
                          <circle
                            cx={marker.x}
                            cy={marker.y}
                            r="4"
                            fill="#ff9900"
                            stroke="rgba(0,0,0,0.4)"
                            strokeWidth="1"
                          />
                        </g>
                      ))}
                    </svg>
                  </div>
                  <div className="chart-axis">
                    <div className="chart-y-labels">
                      {historyChart.yTicks.map(tick => (
                        <span key={tick.value} style={{ top: `${(tick.y / historyChart.height) * 100}%` }}>
                          {tick.value.toFixed(0)}
                        </span>
                      ))}
                    </div>
                    <div className="chart-x-labels">
                      <span>{historyChart.markers[0].label}</span>
                      <span>{historyChart.markers[historyChart.markers.length - 1].label}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="chart-canvas placeholder">
                  <p className="chart-empty">Complete more sessions to start building a trend.</p>
                </div>
              )}
              <div className="chart-caption">
                <span>Last {historyChart.points.length} sessions</span>
                <span className="chart-peak">Peak {historyChart.maxWpm.toFixed(1)} WPM</span>
                <span className="chart-min">Floor {historyChart.minWpm.toFixed(1)} WPM</span>
              </div>
            </div>
          ) : (
            <p className="training-empty">Complete a few more sessions to unlock progress tracking.</p>
          )}
        </section>

        <section className="training-card focus-card">
          <div className="card-header">
            <h4>Long-Term Focus</h4>
            {longTermKeys > 0 && (
              <span className="section-hint">Based on {longTermKeys} tracked keys</span>
            )}
          </div>
          {longTermVisibleStats.length ? (
            <div className={longTermGridClasses.join(' ')}>
              {longTermVisibleStats.map(stat => {
                const accuracy = stat.exposures > 0
                  ? ((stat.exposures - stat.mistakes) / stat.exposures) * 100
                  : 100;
                const label = stat.character === ' ' ? 'Space' : stat.character.toUpperCase();
                return (
                  <div key={`overall-${stat.character}`} className="char-stat-row">
                    <span className="char-label">{label}</span>
                    <div className="char-bar">
                      <div
                        className="char-bar-fill overall"
                        style={{ width: `${Math.max(5, Math.min(100, accuracy))}%` }}
                      />
                    </div>
                    <span className="char-accuracy">{accuracy.toFixed(0)}%</span>
                    <span className="char-meta">{stat.mistakes}/{stat.exposures}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="training-empty">Complete a few more sessions to unlock long-term insights.</p>
          )}
        </section>
      </div>

      <div className="training-footer">
        <TutorialAnchor anchorId="finish-practice">
          <p className="training-footer-note">
            Training sessions are personalised drills, so leaderboards stay hidden here.
          </p>
        </TutorialAnchor>
        <div className="keyboard-shortcuts">
          <p>Press <kbd>Tab</kbd> for a new session • <kbd>Esc</kbd> to restart</p>
        </div>
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
    charStats: PropTypes.arrayOf(PropTypes.shape({
      character: PropTypes.string,
      exposures: PropTypes.number,
      mistakes: PropTypes.number,
      extraHits: PropTypes.number,
      avgLatencyMs: PropTypes.number,
      latencySamples: PropTypes.number
    }))
  }),
  trainingState: PropTypes.shape({
    focusLetters: PropTypes.arrayOf(PropTypes.string)
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
