import React, { useState, useEffect, useCallback } from 'react';
import './PlayerStatusBar.css';
// Import default profile image
import defaultProfileImage from '../assets/default-profile.svg';

function PlayerStatusBar({ players, isRaceInProgress, currentUser, onReadyClick }) {
  const [enlargedAvatar, setEnlargedAvatar] = useState(null);
  
  // For debug
  console.log("PlayerStatusBar - isRaceInProgress:", isRaceInProgress);
  console.log("PlayerStatusBar - players:", players);
  
  const handleAvatarClick = (avatar, netid) => {
    setEnlargedAvatar({ url: avatar || defaultProfileImage, netid });
    // Prevent scrolling when modal is open
    document.body.style.overflow = 'hidden';
  };
  
  const closeModal = useCallback(() => {
    setEnlargedAvatar(null);
    // Re-enable scrolling
    document.body.style.overflow = '';
  }, []);
  
  const closeEnlargedAvatar = (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  };
  
  // Handle escape key press to close modal
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
  
  return (
    <>
      <div className="player-status-bar">
        {players.map((player, index) => (
          <div
            key={index}
            className={`player-card ${!isRaceInProgress && player.ready ? 'player-ready' : ''}`}
          >
            <div className="player-info">
              <div className="player-identity">
                <div 
                  className="player-avatar" 
                  title={`${player.netid}'s avatar (click to enlarge)`}
                  onClick={() => handleAvatarClick(player.avatar_url, player.netid)}
                  role="button"
                  aria-label={`View ${player.netid}'s avatar`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleAvatarClick(player.avatar_url, player.netid);
                      e.preventDefault();
                    }
                  }}
                >
                  <img 
                    src={player.avatar_url || defaultProfileImage} 
                    alt={`${player.netid}'s avatar`}
                    onError={(e) => { e.target.onerror = null; e.target.src=defaultProfileImage; }}
                  />
                </div>
                <span className="player-name">{player.netid}</span>
              </div>
              
              {!isRaceInProgress ? (
                // Lobby mode - show ready status/button
                player.netid === currentUser?.netid ? (
                  <button
                    className={`ready-button ${player.ready ? 'ready-active' : ''}`}
                    onClick={onReadyClick}
                    disabled={player.ready}
                  >
                    {player.ready ? 'Ready' : 'Ready Up'}
                  </button>
                ) : (
                  <span className={`ready-status ${player.ready ? 'ready-active' : ''}`}>
                    {player.ready ? 'Ready' : 'Not Ready'}
                  </span>
                )
              ) : null}
            </div>
            
            {isRaceInProgress && (
              <div className="progress-container">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${player.progress || 0}%` }}
                  ></div>
                  <div className="progress-label">
                    {player.progress || 0}%
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
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

export default PlayerStatusBar;