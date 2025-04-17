import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import './ProfileModal.css';
import defaultProfileImage from '../assets/icons/default-profile.svg'

function ProfileModal({ isOpen, onClose }) {
  const { user, loading, setUser } = useAuth();
  const [bio, setBio] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [bioMessage, setBioMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [timestamp, setTimestamp] = useState(Date.now()); // Timestamp for cache (i have no idea what else is causing images to not refresh)
  const fileInputRef = useRef(null);
  const [detailedStats, setDetailedStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Function to add cache busting parameter to image URL (this is so scuffed, even if it works pls refine ammaar)
  const getCacheBustedImageUrl = (url) => {
    if (!url) return defaultProfileImage;
    // Add or update the timestamp query parameter
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}t=${timestamp}`;
  };

  // Fetch detailed stats when component mounts
  useEffect(() => {
    const fetchDetailedStats = async () => {
      try {
        setLoadingStats(true);
        const response = await fetch('/api/user/detailed-stats', {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error('Failed to fetch detailed stats');
        }

        const data = await response.json();
        setDetailedStats(data);
      } catch (error) {
        console.error('Error fetching detailed stats:', error);
      } finally {
        setLoadingStats(false);
      }
    };

    fetchDetailedStats();
  }, []);

  useEffect(() => {
    // Initialize bio from user data when loaded
    if (user && user.bio) {
      setBio(user.bio);
    }
  }, [user]);

  // Update timestamp when avatar URL changes
  useEffect(() => {
    if (user && user.avatar_url) {
      console.log('Avatar URL from user data:', user.avatar_url);
      // Reset image error state and update timestamp for cache busting
      setImageError(false);
      setTimestamp(Date.now());
    }
  }, [user?.avatar_url]);

  // Parse numeric values to check if ints
  const parseNumericValue = (value) => {
    if (value === null || value === undefined) return 0;
    return typeof value === 'string' ? parseFloat(value) : value;
  };

  // Format large numbers with commas
  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const handleBioChange = (e) => {
    setBio(e.target.value);
  };

  const saveBio = async () => {
    setIsSavingBio(true);
    setBioMessage('');

    // Save bio that's being sent to compare later
    const bioToSave = bio;

    try {
      const response = await fetch('/api/profile/bio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bio: bioToSave }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Bio save response:', data);

      // Update the user context with new bio
      setUser(prevUser => ({ ...prevUser, bio: data.user.bio }));

      // Update window.user for socket access
      if (window.user) {
        window.user.bio = data.user.bio;
      }

      // Update local bio state to keep UI consistent
      setBio(data.user.bio);

      setBioMessage('Bio saved successfully!');

      // Clear message after 2.5 seconds
      setTimeout(() => {
        setBioMessage('');
      }, 2500);
    } catch (error) {
      console.error('Error saving bio:', error);
      setBioMessage('Failed to save bio. Please try again.');
    } finally {
      setIsSavingBio(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current.click();
  };

  const handleImageError = () => {
    console.error('Image failed to load:', user?.avatar_url);
    setImageError(true);

    // Add a message to the user
    // not sure if this is needed by why not
    if (user?.avatar_url) {
      setUploadError('Image loaded successfully but cannot be displayed. You can view it by clicking the avatar.');
    }
  };

  const openImageInNewTab = () => {
    if (user?.avatar_url && imageError) {
      window.open(user.avatar_url, '_blank');
    } else {
      handleAvatarClick();
    }
  };

  const handleFileChange = async (e) => {
    setUploadError('');
    setUploadSuccess('');
    setImageError(false);
    const file = e.target.files[0];
    if (!file) return;

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File too large. Maximum size is 5MB.');
      return;
    }

    // Validate file type
    // do we keep gifs? not sure
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.');
      return;
    }

    // Create a temp local URL for immediate display
    // i cant get a more efficient way that works lol
    // this is stupid inefficient but someone smarter than me is needed
    const localImageUrl = URL.createObjectURL(file);
    // Update avatar immediately with local file for better UX
    setUser(prevUser => ({ ...prevUser, avatar_url: localImageUrl }));
    // Force timestamp update to show new image immediately
    setTimestamp(Date.now());

    // Create FormData object to send the file
    const formData = new FormData();
    formData.append('avatar', file);

    setIsUploading(true);

    try {
      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Avatar upload response:', data);

      // Update user state with new avatar URL from server
      setUser(prevUser => ({ ...prevUser, avatar_url: data.user.avatar_url }));

      // Make sure window.user is updated
      if (window.user) {
        window.user.avatar_url = data.user.avatar_url;
      }

      // Force immediate update of the avatar by updating timestamp
      setTimestamp(Date.now());

      // Revoke the temporary local URL to free up memory
      URL.revokeObjectURL(localImageUrl);

      // Show success message
      setUploadSuccess('Avatar uploaded successfully!');

      // Clear success message after 2.5 sec
      setTimeout(() => {
        setUploadSuccess('');
      }, 2500);

    } catch (error) {
      console.error('Error uploading avatar:', error);
      setUploadError(error.message || 'Failed to upload avatar. Please try again.');

      // If upload fails, revert to the previous avatar
      if (user && user.avatar_url !== localImageUrl) {
        setUser(prevUser => ({ ...prevUser, avatar_url: user.avatar_url }));
      }

      // Revoke the temp URL
      URL.revokeObjectURL(localImageUrl);
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) {
    return <div className="loading-container">Loading profile...</div>;
  }

  const avatarUrl = getCacheBustedImageUrl(user?.avatar_url);

  return (
    <div className="profile-overlay">
      <div className="profile-container">

        <div className="back-button-container">
          <button className="back-button" onClick={onClose}>
            <span>⟵</span> Back
          </button>
        </div>

        <div className="profile-header">
          <h1>Profile</h1>

          <div className="profile-header-info">
            <div className="profile-page-info">
              <div className="profile-page-image">
                <input
                  type="image"
                  src={!imageError ? avatarUrl : defaultProfileImage}
                  alt="Profile"
                  onClick={imageError && user?.avatar_url ? openImageInNewTab : handleAvatarClick}
                  className={isUploading ? "uploading" : ""}
                  onError={handleImageError}
                />
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  accept="image/jpeg, image/png, image/gif, image/webp"
                />
                {isUploading && <div className="upload-overlay">Uploading...</div>}
                {uploadError && <div className="profile-error-message">{uploadError}</div>}
                {uploadSuccess && <div className="success-message">{uploadSuccess}</div>}
              </div>

              <div className="written-info">
                <div className="username-info">
                  <h2>{user?.netid || 'Guest'}</h2>
                </div>
                <select value='Title'></select>
              </div>
            </div>
            <div className='biography'>
              <textarea
                className="biography-input"
                placeholder='Write a little about yourself!'
                value={bio}
                onChange={handleBioChange}
              ></textarea>
              <div className="bio-controls">
                <button
                  className="save-bio-btn"
                  onClick={saveBio}
                  disabled={isSavingBio}
                >
                  {isSavingBio ? 'Saving...' : 'Save Bio'}
                </button>
                {bioMessage && <span className={bioMessage.includes('Failed') ? 'bio-error' : 'bio-success'}>{bioMessage}</span>}
              </div>
            </div>
          </div>
        </div>


        {/* We may want to make stats be dynamic (i.e. golden color) if they're exceptional */}
        <div className="profile-stats">
          <h2>Your Stats</h2>
          {!user ? (
            <div className="stats-loading">No stats available</div>
          ) : (
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Races Completed</h3>
                <p>{parseNumericValue(user.races_completed) || 0}</p>
              </div>
              <div className="stat-card">
                <h3>Average WPM</h3>
                <p>{parseNumericValue(user.avg_wpm).toFixed(2)}</p>
              </div>
              <div className="stat-card">
                <h3>Average Accuracy</h3>
                <p>{parseNumericValue(user.avg_accuracy).toFixed(2)}%</p>
              </div>
              <div className="stat-card">
                <h3>Fastest Speed</h3>
                <p>{parseNumericValue(user.fastest_wpm).toFixed(2)} WPM</p>
              </div>
            </div>
          )}
        </div>

        {/* Detailed Stats Section */}
        <div className="profile-stats">
          <h2>Detailed Stats</h2>
          {loadingStats ? (
            <div className="stats-loading">Loading detailed stats...</div>
          ) : !detailedStats ? (
            <div className="stats-loading">No detailed stats available</div>
          ) : (
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Tests Started</h3>
                <p>{formatNumber(detailedStats.sessions_started)}</p>
              </div>
              <div className="stat-card">
                <h3>Sessions Completed</h3>
                <p>{formatNumber(detailedStats.sessions_completed)}</p>
              </div>
              <div className="stat-card">
                <h3>Total Words Typed</h3>
                <p>{formatNumber(detailedStats.words_typed)}</p>
              </div>
              <div className="stat-card">
                <h3>Completion Rate</h3>
                <p>{detailedStats.sessions_started > 0
                  ? (detailedStats.sessions_completed / detailedStats.sessions_started * 100).toFixed(1)
                  : 0}%</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileModal;