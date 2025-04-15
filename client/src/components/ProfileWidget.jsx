import PropTypes from 'prop-types';
import ProfileModal from './ProfileModal.jsx';
import { useState } from 'react';
import './ProfileWidget.css';

// Default profile image
import defaultProfileImage from '../assets/icons/default-profile.svg';

function ProfileWidget({ user }) {
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Parse numeric value to handle string or number
  const parseNumericValue = (value) => {
    if (value === null || value === undefined) return 0;
    return typeof value === 'string' ? parseFloat(value) : value;
  };

  const openProfileModal = () => {
    setShowProfileModal(true);
  };

  const closeProfileModal = () => {
    setShowProfileModal(false);
  };

  return (
    <>
      <div className="profile-widget" onClick={openProfileModal}>
        <div className="profile-image">
          <img 
            src={ user?.avatar_url ? user.avatar_url : defaultProfileImage } 
            alt="Profile"
          />
        </div>
        <div className="profile-info">
          <div className="profile-name">{user?.netid || 'Guest'}</div>
          <div className="profile-details">
            {user?.avg_wpm
              ? `${Math.round(parseNumericValue(user.avg_wpm))} WPM`
              : 'No stats yet'
            }
          </div>
        </div>
      </div>
      {showProfileModal && (<ProfileModal 
      isOpen={showProfileModal} 
      onClose={closeProfileModal} 
      />)}
    </>
  );
}

ProfileWidget.propTypes = {
  user: PropTypes.shape({
    netid: PropTypes.string,
    avatar_url: PropTypes.string,
    avg_wpm: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    avg_accuracy: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    races_completed: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
  })
};

export default ProfileWidget;
