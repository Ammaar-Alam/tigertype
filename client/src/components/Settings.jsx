import './Settings.css';
import { useState, useEffect } from 'react';

function Settings({ isOpen, onClose }) {

  const [whichFont, setWhichFont] = useState(() => {
    return localStorage.getItem('preferredFont') || 'Fira Code, monospace';
  });

  const [typingSound, setTypingSound] = useState(() => {
    return localStorage.getItem('typingSound') === 'true';
  });

  const [lightMode, setLightMode] = useState(() => {
    return localStorage.getItem('lightMode') === 'true';
  });

  const [defaultCursor, setDefaultCursor] = useState(true);

  // Apply fonts when component mounts or fonts change
  useEffect(() => {
    document.documentElement.style.setProperty('--main-font', whichFont);
    document.documentElement.style.setProperty(
      '--background-color', lightMode ? '#ffffff' : '#121212'
    );
    document.documentElement.style.setProperty(
      '--secondary-color', lightMode ? '#f0f0f0' : '#1e1e1e'
    );
    document.documentElement.style.setProperty(
      '--mode-text-color', lightMode ? '#1e1e1e' : '#e0e0e0'
    );
    document.documentElement.style.setProperty(
      '--hover-color', lightMode ? '#a2a2a2' : '#2a2a2a'
    );
    document.documentElement.style.setProperty(
      '--type-container-color', lightMode ? '#dfdfdf' : '#1e1e1e'
    );
    document.documentElement.style.setProperty(
      '--typing-color', lightMode ? 'black' : '#ffffff53'
    );
    document.documentElement.style.setProperty(
      '--container-color', lightMode ? '#ffffff' : '#121212'
    );
    document.documentElement.style.setProperty(
      '--player-card-color', lightMode ? '#aeaeae' : '#2a2a2a'
    );
    document.documentElement.style.setProperty(
      '--correct-bg-color', 
      lightMode ? '#0A970A' : 'rgba(128, 239, 128, 0.55)'
    );
    document.documentElement.style.setProperty(
      '--incorrect-color',
      lightMode ? '#FF0000' : 'rgba(255, 65, 47, 0.55)'
    );
    document.documentElement.style.setProperty(
      '--incorrect-bg-color',
      lightMode ? 'rgba(255,116,108, 0.30)' : 'rgba(255,116,108, 0.10)'
    );
    document.documentElement.style.setProperty(
      '--current-color',
      lightMode ? 'black' : 'white'
    );
    localStorage.setItem('preferredFont', whichFont);
    localStorage.setItem('typingSound', typingSound);
    localStorage.setItem('lightMode', lightMode);
  }, [whichFont, typingSound, lightMode]);

  useEffect(() => {
    const color = defaultCursor ? "#3a506b" : "none";
    const line = defaultCursor ? "hidden" : "visible";
    document.documentElement.style.setProperty('--default-cursor', color);
    document.documentElement.style.setProperty('--line-cursor', line);
  }, [defaultCursor]);

  if (!isOpen) {return null};

  const handleTypingFontChange = (e) => {
    const newFont = e.target.value;
    setWhichFont(newFont);
  };

  const handleDefaultCursor = (e) => {
    setDefaultCursor(!defaultCursor);
  };

  const handleSoundToggle = () => {
    setTypingSound(prev => !prev);
  };

  const handleLightToggle = () => {
    setLightMode(prev => !prev);
  };

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="settings-content">
          <p>Fonts</p>
          <select 
            className="font-select" 
            value={whichFont} 
            onChange={handleTypingFontChange}
          >
            <option value="Inter, monospace">Inter</option>
            <option value="Fira Code, monospace">Fira Code</option>
            <option value="Courier New, monospace">Courier New</option>
            <option value="Source Code Pro, monospace">Source Code Pro</option>
            <option value="JetBrains Mono, monospace">JetBrains Mono</option>
            <option value="Monaco, monospace">Monaco</option>
          </select>
          <p>Block Cursor</p>
          <div className="toggle">
            <label className="switch">
            <input 
                className='cursor-setting' 
                type='checkbox' 
                checked={defaultCursor} 
                onChange={handleDefaultCursor} />
                <span className="slider"></span>
            </label>
            <span className="sound-label">{defaultCursor ? ' On' : ' Off'}</span>
          </div>
          <p>Typing Sound</p>
          <div className="toggle">
            <label className="switch">
              <input
                type="checkbox"
                checked={typingSound}
                onChange={handleSoundToggle}
              />
              <span className="slider"></span>
            </label>
            <span className="sound-label">{typingSound ? ' On' : ' Off'}</span>
          </div>

          <p>Light Mode</p>
            <div className="toggle">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={lightMode}
                  onChange={handleLightToggle}
                />
                <span className="slider"></span>
              </label>
              <span className="sound-label">{lightMode ? ' On' : ' Off'}</span>
            </div>

        </div>
      </div>
    </div>
  );
}

export default Settings;