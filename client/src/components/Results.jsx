import { useNavigate } from 'react-router-dom';
import { useRace } from '../context/RaceContext';
import { useAuth } from '../context/AuthContext';
import { useState, useCallback, useEffect } from 'react';
import './Results.css';
// Import default profile image
import defaultProfileImage from '../assets/default-profile.svg';
import PropTypes from 'prop-types';

function Results({ onShowLeaderboard }) {
  const navigate = useNavigate();
  const { raceState, typingState, resetRace } = useRace();
  const { user } = useAuth();
  const [enlargedAvatar, setEnlargedAvatar] = useState(null);
  
  // Handle back button
  const handleBack = () => {
    resetRace();
    navigate('/home?refreshUser=true');
  };
  
  // Handle avatar click
  const handleAvatarClick = (avatar, netid) => {
    setEnlargedAvatar({ url: avatar || defaultProfileImage, netid });
    document.body.style.overflow = 'hidden';
  };
  
  // Close modal
  const closeModal = useCallback(() => {
    setEnlargedAvatar(null);
    document.body.style.overflow = '';
  }, []);
  
  // Close modal when clicking overlay
  const closeEnlargedAvatar = (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  };
  
  // Handle escape key press
  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape' && enlargedAvatar) {
        closeModal();
      }
    };
    
    if (enlargedAvatar) {
      document.addEventListener('keydown', handleEscKey);
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [enlargedAvatar, closeModal]);
  
  // Render practice mode results
  const renderPracticeResults = () => {
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
      <div className="practice-results">
        <h3>Practice Results</h3>
        {statsContent}
        <div className="keyboard-shortcuts">
          <p>Press <kbd>Tab</kbd> for a new excerpt • <kbd>Esc</kbd> to restart</p>
        </div>
        {/* Conditionally add Leaderboard Button */} 
        {onShowLeaderboard && (
          <button className="leaderboard-shortcut-btn" onClick={onShowLeaderboard}>
            <i className="bi bi-trophy"></i> View Leaderboards
          </button>
        )}
      </div>
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
                <div className="result-netid">{result.netid}</div>
              </div>
              <div className="result-stats">
                <div className="result-wpm">{result.wpm?.toFixed(2) || 0} WPM</div>
                <div className="result-accuracy">{result.accuracy?.toFixed(2) || 0}%</div>
                <div className="result-time">{result.completion_time?.toFixed(2) || 0}s</div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };
  
  return (
    <>
      <div className="results-container">
        <h2>Results</h2>
        
        {raceState.type === 'practice' ? renderPracticeResults() : renderRaceResults()}
        
        <button className="back-btn" onClick={handleBack}>
          Back to Menu
        </button>
      </div>
      
      {/* Enlarged Avatar Modal */}
      {enlargedAvatar && (
        <div 
          className="avatar-modal-overlay" 
          onClick={closeEnlargedAvatar}
          role="dialog"
          aria-modal="true"
          aria-label={`${enlargedAvatar.netid}'s avatar`}
        >
          <div className="avatar-modal">
            <button 
              className="avatar-modal-close" 
              onClick={closeModal}
              aria-label="Close avatar view"
            >
              ×
            </button>
            <div className="avatar-modal-content">
              <img 
                src={enlargedAvatar.url} 
                alt={`${enlargedAvatar.netid}'s avatar`} 
                className="avatar-modal-image"
                onError={(e) => { e.target.onerror = null; e.target.src=defaultProfileImage; }}
              />
              <div className="avatar-modal-name">{enlargedAvatar.netid}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

Results.propTypes = {
  onShowLeaderboard: PropTypes.func, // Prop is optional
};

export default Results;