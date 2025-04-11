// [AI DISCLAIMER: THIS COMPONENT WAS DEBUGGED WITH THE HELP OF AI; IT MIGHT NOT BE FULLY ACCURATE
import React from 'react';
import PropTypes from 'prop-types';
import './TestConfigurator.css';

// --- Icon Placeholders ---
const ClockIcon = () => <i className="bi bi-clock"></i>;
const QuoteIcon = () => <i className="bi bi-quote"></i>;
const DifficultyIcon = () => <i className="bi bi-bar-chart-line"></i>;
const TypeIcon = () => <i className="bi bi-tags"></i>;
const DepartmentIcon = () => <i className="bi bi-building"></i>;
const LeaderboardIcon = () => <i className="bi bi-trophy"></i>;
// --- ---

// --- Configuration Options ---
const DURATIONS = [15, 30, 60, 120];
const DIFFICULTIES = ['all', 'easy', 'medium', 'hard'];
const TYPES = ['all', 'general', 'princeton', 'course_reviews'];
const DEPARTMENTS = ['all', 'COS', 'CHM', 'PHY'];
// --- ---

function TestConfigurator({
  testMode,
  testDuration,
  snippetDifficulty,
  snippetType,
  snippetDepartment,
  setTestMode,
  setTestDuration,
  setSnippetDifficulty,
  setSnippetType,
  setSnippetDepartment,
  setRaceState,
  loadNewSnippet,
  onShowLeaderboard,
}) {

  React.useEffect(() => {
    if (snippetType !== 'course_reviews' && snippetDepartment !== 'all') {
      setSnippetDepartment('all');
    }
  }, [snippetType, snippetDepartment, setSnippetDepartment]);

  // Ensure the component always shows the current active test mode
  React.useEffect(() => {
    // When the component loads, make sure we're showing the correct mode's options
    if (testMode === 'timed' || testMode === 'snippet') {
      const timedOptions = document.querySelector('.timed-options');
      const snippetOptions = document.querySelector('.snippet-options');
      
      if (timedOptions) {
        timedOptions.classList.toggle('visible', testMode === 'timed');
      }
      
      if (snippetOptions) {
        snippetOptions.classList.toggle('visible', testMode === 'snippet');
      }
    }
  }, [testMode]);

  const handleSelectChange = (setter) => (event) => {
    setter(event.target.value);
  };

  // Enhanced button handler to immediately apply mode changes
  const handleModeChange = (value, setter) => {
    // First set the raceState.timedTest.enabled property
    if (value === 'timed') {
      // If switching to timed mode, enable it first
      setRaceState(prev => ({
        ...prev,
        timedTest: {
          ...prev.timedTest,
          enabled: true
        }
      }));
      
      // Then update the UI state to match
      setter(value);
      
      // Finally request a new timed test
      setTimeout(() => {
        loadNewSnippet && loadNewSnippet();
      }, 0);
    } 
    else if (value === 'snippet') {
      // If switching to snippet mode, disable timed mode first
      setRaceState(prev => ({
        ...prev,
        timedTest: {
          ...prev.timedTest,
          enabled: false
        }
      }));
      
      // Then update the UI state
      setter(value);
      
      // Finally request a new snippet
      setTimeout(() => {
        loadNewSnippet && loadNewSnippet();
      }, 0);
    }
  };

  // Handle duration changes - immediately update and reload if in timed mode
  const handleDurationChange = (duration) => {
    // First update the duration state
    setTestDuration(duration);
    
    // If we're in timed mode, update raceState and reload the test
    if (testMode === 'timed') {
      setRaceState(prev => ({
        ...prev,
        timedTest: {
          ...prev.timedTest,
          enabled: true,
          duration: duration
        }
      }));
      
      // Reload with the new duration
      setTimeout(() => {
        loadNewSnippet && loadNewSnippet();
      }, 0);
    }
  };

  const renderButton = (value, state, setter, label, icon = null, isFunctional = true, onClickOverride = null) => (
    <button
      key={value}
      className={`config-button ${state === value ? 'active' : ''} ${!isFunctional ? 'non-functional' : ''} ${icon ? 'icon-button' : ''}`}
      onClick={() => {
        if (onClickOverride) {
          onClickOverride();
          return;
        }
        if (!isFunctional) return;
        
        // Handle different types of buttons
        if (value === 'timed' || value === 'snippet') {
          // Mode buttons
          handleModeChange(value, setter);
        } else if (setter === setTestDuration) {
          // Duration buttons
          handleDurationChange(value);
        } else {
          // Other buttons (department, etc.)
          setter(value);
        }
      }}
      title={!isFunctional ? 'Filter coming soon!' : label || value}
      aria-label={label || value}
    >
      {icon && icon()} {label || value}
    </button>
  );

  return (
    // Main container - now a row
    <div className="test-configurator">

      {/* Mode Selection Group */}
      <div className="config-section mode-selection">
        {renderButton('snippet', testMode, setTestMode, 'Snippets', QuoteIcon)}
        {renderButton('timed', testMode, setTestMode, 'Timed', ClockIcon)}
      </div>

      {/* Separator */}
      <div className="config-separator"></div>

      {/* Conditional Options Area */}
      <div className="conditional-options-container">

        {/* Snippet Filters Wrapper */}
        <div className={`options-wrapper snippet-options ${testMode === 'snippet' ? 'visible' : ''}`}>
          <div className="config-section snippet-filters-inner">
             <div className="select-wrapper">
                <DifficultyIcon />
                <select
                  className="config-select non-functional"
                  value={snippetDifficulty}
                  onChange={handleSelectChange(setSnippetDifficulty)}
                  title="Difficulty filter coming soon!"
                >
                  <option value="" disabled hidden={snippetDifficulty !== ""}>difficulty</option>
                  {DIFFICULTIES.map(diff => <option key={diff} value={diff}>{diff}</option>)}
                </select>
             </div>
             <div className="config-separator-inner"></div>
             <div className="select-wrapper">
                <TypeIcon />
                <select
                  className="config-select non-functional"
                  value={snippetType}
                  onChange={handleSelectChange(setSnippetType)}
                  title="Type filter coming soon!"
                >
                  <option value="" disabled hidden={snippetType !== ""}>type</option>
                  {TYPES.map(type => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}
                </select>
             </div>
             <div className={`department-filter ${snippetType === 'course_reviews' ? 'visible' : ''}`}>
                <div className="config-separator-inner"></div>
                {DEPARTMENTS.map(dept => renderButton(dept, snippetDepartment, setSnippetDepartment, dept, null, false))}
             </div>
          </div>
        </div>

        {/* Timed Mode Duration Wrapper */}
        <div className={`options-wrapper timed-options ${testMode === 'timed' ? 'visible' : ''}`}>
          <div className="config-section duration-selection-inner">
            {DURATIONS.map(duration => renderButton(duration, testDuration, setTestDuration, `${duration}s`))}
          </div>
        </div>

      </div> {/* End Conditional Options Container */}

      {/* Separator */}
      <div className="config-separator"></div>

      {/* Leaderboard Button (always visible in practice mode) */}
      <div className="config-section leaderboard-button-section">
        {renderButton('leaderboard', null, null, 'Leaderboard', LeaderboardIcon, true, onShowLeaderboard)}
      </div>
    </div> // End Main Container
  );
}

// Prop types remain the same
TestConfigurator.propTypes = {
  testMode: PropTypes.oneOf(['snippet', 'timed']).isRequired,
  testDuration: PropTypes.number.isRequired,
  snippetDifficulty: PropTypes.string.isRequired,
  snippetType: PropTypes.string.isRequired,
  snippetDepartment: PropTypes.string.isRequired,
  setTestMode: PropTypes.func.isRequired,
  setTestDuration: PropTypes.func.isRequired,
  setSnippetDifficulty: PropTypes.func.isRequired,
  setSnippetType: PropTypes.func.isRequired,
  setSnippetDepartment: PropTypes.func.isRequired,
  setRaceState: PropTypes.func.isRequired,
  loadNewSnippet: PropTypes.func,
  onShowLeaderboard: PropTypes.func.isRequired,
};

export default TestConfigurator;