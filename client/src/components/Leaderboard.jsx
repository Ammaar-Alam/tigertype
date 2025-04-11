import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import PropTypes from 'prop-types';
import './Leaderboard.css';

const DURATIONS = [15, 30, 60, 120];
const PERIODS = ['daily', 'alltime'];

function Leaderboard({ defaultDuration = 15, defaultPeriod = 'alltime' }) {
  const { socket } = useSocket();
  const { user } = useAuth();
  const [duration, setDuration] = useState(defaultDuration);
  const [period, setPeriod] = useState(defaultPeriod);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedAvatar, setSelectedAvatar] = useState(null);

  useEffect(() => {
    if (!socket) return;

    const fetchLeaderboard = async () => {
      setLoading(true);
      setError(null);
      console.log(`Requesting leaderboard: duration=${duration}, period=${period}`);
      socket.emit('leaderboard:timed', { duration, period }, (response) => {
        setLoading(false);
        if (response.error) {
          console.error('Error fetching leaderboard:', response.error);
          setError(response.error);
          setLeaderboard([]);
        } else {
          console.log('Leaderboard data received:', response.leaderboard);
          setLeaderboard(response.leaderboard || []);
        }
      });
    };

    fetchLeaderboard();

    // OPTOINAL FOR LATER: Add listener for real-time updates if implemented on the server
    // const handleLeaderboardUpdate = (data) => { ... };
    // socket.on('leaderboard:timedUpdate', handleLeaderboardUpdate);

    // return () => {
    //   socket.off('leaderboard:timedUpdate', handleLeaderboardUpdate);
    // };

  }, [socket, duration, period]);

  const handleAvatarClick = (avatarUrl, netid) => {
    setSelectedAvatar({ url: avatarUrl, name: netid });
  };

  const closeAvatarModal = () => {
    setSelectedAvatar(null);
  };

  return (
    <>
      <h2>Timed Leaderboards</h2>

      <div className="leaderboard-controls">
        <div className="control-group duration-controls">
          {DURATIONS.map(d => (
            <button
              key={d}
              className={`control-button ${duration === d ? 'active' : ''}`}
              onClick={() => setDuration(d)}
            >
              {d}s
            </button>
          ))}
        </div>
        <div className="control-group period-controls">
          {PERIODS.map(p => (
            <button
              key={p}
              className={`control-button ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="loading-indicator">
          <div className="spinner-border text-orange" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p>Loading Leaderboard...</p>
        </div>
      )}
      {error && <p className="error-message">Error: {error}</p>}

      {!loading && !error && (
        <div className="leaderboard-list">
          {leaderboard.length > 0 ? (
            leaderboard.map((entry, index) => (
              <div
                key={`${entry.user_id}-${entry.created_at}`}
                className={`leaderboard-item ${entry.netid === user?.netid ? 'current-user' : ''}`}
              >
                <span className="leaderboard-rank">{index + 1}</span>
                <div className="leaderboard-player">
                  <div 
                    className="leaderboard-avatar" 
                    onClick={() => handleAvatarClick(entry.avatar_url, entry.netid)}
                    title={`View ${entry.netid}\'s avatar`}
                  >
                     <img 
                       src={entry.avatar_url || '/default-avatar.png'} 
                       alt={`${entry.netid} avatar`} 
                       onError={(e) => { e.target.onerror = null; e.target.src='/default-avatar.png'; }} // Fallback
                     />
                  </div>
                  <span className="leaderboard-netid">{entry.netid}</span>
                </div>
                <div className="leaderboard-stats">
                  <span className="leaderboard-wpm">{parseFloat(entry.wpm).toFixed(0)} WPM</span>
                  <span className="leaderboard-accuracy">{parseFloat(entry.accuracy).toFixed(1)}%</span>
                  <span className="leaderboard-date">
                    {period === 'daily' 
                      ? new Date(entry.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                      : new Date(entry.created_at).toLocaleDateString()
                    }
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="no-results">No results found for this leaderboard.</p>
          )}
        </div>
      )}

      {/* Avatar Modal */}
      {selectedAvatar && (
        <div className="avatar-modal-overlay" onClick={closeAvatarModal}>
          <div className="avatar-modal" onClick={(e) => e.stopPropagation()}> 
            <button className="avatar-modal-close" onClick={closeAvatarModal}>&times;</button>
            <div className="avatar-modal-content">
              <img 
                src={selectedAvatar.url || '/default-avatar.png'} 
                alt={`${selectedAvatar.name} avatar`} 
                className="avatar-modal-image" 
                onError={(e) => { e.target.onerror = null; e.target.src='/default-avatar.png'; }} // Fallback
              />
              <p className="avatar-modal-name">{selectedAvatar.name}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

Leaderboard.propTypes = {
  defaultDuration: PropTypes.oneOf(DURATIONS),
  defaultPeriod: PropTypes.oneOf(PERIODS),
};

export default Leaderboard; 