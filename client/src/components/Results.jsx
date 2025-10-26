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

  useEffect(() => {
    let cancelled = false;

    const fetchAnalytics = async () => {
      try {
        const [summaryRes, historyRes] = await Promise.all([
          axios.get('/api/training/summary'),
          axios.get('/api/training/history?limit=10')
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
    const points = history
      .filter(session => session.wpm != null)
      .slice(0, 10)
      .reverse();

    if (!points.length) {
      return null;
    }

    const width = 280;
    const height = 120;
    const maxWpm = Math.max(
      ...points.map(session => Number(session.wpm) || 0),
      Number(latestStats?.wpm) || 0,
      50
    );

    const path = points
      .map((session, index) => {
        const ratio = points.length > 1 ? index / (points.length - 1) : 0;
        const x = ratio * width;
        const wpm = Number(session.wpm) || 0;
        const y = height - (wpm / maxWpm) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

    return {
      width,
      height,
      path,
      points,
      maxWpm
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

  return (
    <div className="training-results-panel">
      <div className="training-main">
        <div className="training-heading">
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
            <span className="metric-value">{charactersDisplay}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Mistakes</span>
            <span className="metric-value">{mistakesDisplay}</span>
          </div>
        </div>

        <div className="training-section char-accuracy-section">
          <div className="section-header">
            <h4>This Session&apos;s Accuracy by Key</h4>
          </div>
          {sessionCharStats.length ? (
            <div className="char-stat-grid">
              {sessionCharStats.slice(0, 12).map(stat => {
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
        </div>
      </div>

      <div className="training-side">
        <div className="training-section">
          <div className="section-header">
            <h4>Recent Progress</h4>
            {loading && <span className="loading-note">Loading…</span>}
          </div>
          {historyChart ? (
            <div className="history-chart">
              <svg
                width={historyChart.width}
                height={historyChart.height}
                viewBox={`0 0 ${historyChart.width} ${historyChart.height}`}
              >
                <path
                  d={historyChart.path}
                  fill="none"
                  stroke="var(--primary-color, #ff9900)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <div className="chart-caption">
                <span>Last {historyChart.points.length} sessions</span>
                <span>Peak {historyChart.maxWpm.toFixed(1)} WPM</span>
              </div>
            </div>
          ) : (
            <p className="training-empty">Complete a few more sessions to unlock progress tracking.</p>
          )}
        </div>

        {summary?.charTotals?.length ? (
          <div className="training-section">
            <div className="section-header">
              <h4>Long-Term Focus</h4>
              <span className="section-hint">Based on {summary.charTotals.length} tracked keys</span>
            </div>
            <div className="char-stat-grid">
              {summary.charTotals.slice(0, 8).map(stat => {
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
          </div>
        ) : null}
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
              <div className="training-empty state">
                <p>Complete a training session to unlock personalised analytics.</p>
              </div>
            )}
            <TutorialAnchor anchorId="finish-practice">
              {onShowLeaderboard && (
                <button className="leaderboard-shortcut-btn" onClick={onShowLeaderboard}>
                  <i className="bi bi-trophy"></i> View Leaderboards
                </button>
              )}
            </TutorialAnchor>
            <div className="keyboard-shortcuts">
              <p>Press <kbd>Tab</kbd> for a new session • <kbd>Esc</kbd> to restart</p>
            </div>
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
