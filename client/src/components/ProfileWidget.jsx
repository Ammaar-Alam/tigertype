// merge conflict debugged with ai

import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './ProfileWidget.css';
import axios from 'axios';

// Default profile image
import defaultProfileImage from '../assets/icons/default-profile.svg';

// Accept a layout prop ('default' or 'navbar')
function ProfileWidget({ user, onClick, layout = 'default' }) {
  // Local state for titles (use provided or fetch)
  const [titles, setTitles] = useState(user?.titles || []);

  // Parse numeric value to handle string or number
  const parseNumericValue = (value) => {
    if (value === null || value === undefined) return 0;
    return typeof value === 'string' ? parseFloat(value) : value;
  };
  
  const navigate = useNavigate();
  const location = useLocation();

  const openProfileModal = () => {
    navigate(`/profile/${user?.netid}`, { state: { backgroundLocation: location } });
  };

  // Fetch titles if not provided
  useEffect(() => {
    if (user?.titles) {
      setTitles(user.titles);
    } else if (user?.netid) {
      axios.get(`/api/user/${user.netid}/titles`)
        .then(res => setTitles(res.data || []))
        .catch(err => {
          console.error(`Error fetching titles for ${user.netid}:`, err);
          setTitles([]);
        });
    }
  }, [user?.netid, user?.titles]);

  // Determine the title to display (use server-provided selection)
  const displayTitle = titles?.find(title => title.is_equipped) || null;

  const content = (
    <div className="profile-widget">
      <div className="profile-image">
        <img
          src={user?.avatar_url ? user.avatar_url : defaultProfileImage} 
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
          {/* Display selected title inline with WPM */}
          {displayTitle && (
            <span className="profile-title-inline">
               · {displayTitle.name}
            </span>
          )}
          {/* Conditionally render title on new line for navbar layout - only if a title is selected */}
          {layout === 'navbar' && displayTitle && (
            <div className="profile-title-newline">
              {displayTitle.name}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // If onClick is provided, use that handler instead of showing the modal
  if (onClick) {
    return (
      <div className="profile-widget-clickable" onClick={onClick} role="button" tabIndex={0}>
        {content}
      </div>
    );
  }

  // Otherwise, use our own modal
  return (
    <div className="profile-widget-clickable" onClick={openProfileModal} role="button" tabIndex={0}>
      {content}
    </div>
  );
}

ProfileWidget.propTypes = {
  user: PropTypes.shape({
    netid: PropTypes.string,
    avatar_url: PropTypes.string,
    avg_wpm: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    avg_accuracy: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    races_completed: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    // Ensure titles prop type includes id and name
    titles: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
        name: PropTypes.string.isRequired,
        is_equipped: PropTypes.bool // Optional: if API provides equipped status
    })),
  }),
  onClick: PropTypes.func,
  layout: PropTypes.oneOf(['default', 'navbar']) // Add layout prop type
};

export default ProfileWidget;
