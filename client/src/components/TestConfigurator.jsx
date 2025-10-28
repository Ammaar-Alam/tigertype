// [AI DISCLAIMER: THIS COMPONENT WAS DEBUGGED WITH THE HELP OF AI; IT MIGHT NOT BE FULLY ACCURATE
import React from 'react';
import PropTypes from 'prop-types';
import './TestConfigurator.css';
import TutorialAnchor from './TutorialAnchor';

// --- Icon Placeholders ---
const ClockIcon = () => <i className="bi bi-clock"></i>;
const QuoteIcon = () => <i className="bi bi-quote"></i>;
const DifficultyIcon = () => <i className="bi bi-bar-chart-line"></i>;
const CategoryIcon = () => <i className="bi bi-tags"></i>;
const SubjectIcon = () => <i className="bi bi-building"></i>;
const LeaderboardIcon = () => <i className="bi bi-trophy"></i>;
const TrainingIcon = () => <i className="bi bi-bullseye"></i>;
// --- ---

// --- Configuration Options ---
const DURATIONS = [15, 30, 60, 120];
const DIFFICULTIES = ['all', 'Easy', 'Medium', 'Hard'];
const CATEGORIES = ['all', 'general', 'course_reviews'];
// --- ---

function TestConfigurator({
  testMode,
  testDuration,
  snippetDifficulty,
  snippetCategory,
  snippetSubject,
  trainingState,
  setTestMode,
  setTestDuration,
  setSnippetDifficulty,
  setSnippetCategory,
  setSnippetSubject,
  setRaceState,
  loadNewSnippet,
  onShowLeaderboard,
  isLobby = false,
  snippetError = null,
}) {

  const [subjects, setSubjects] = React.useState(['all']);
  const isMounted = React.useRef(false);

  const [planPreview, setPlanPreview] = React.useState(null);
  const [planLoading, setPlanLoading] = React.useState(false);

  // Store available difficulties for the current category/subject filters
  const [availableDifficulties, setAvailableDifficulties] = React.useState(DIFFICULTIES);

  // Fetch available difficulties when category or subject filters change
  React.useEffect(() => {
    const fetchDifficulties = async () => {
      try {
        const queryParams = {};
        if (snippetCategory && snippetCategory !== 'all') {
          queryParams.type = snippetCategory;
        }
        if (snippetCategory === 'course_reviews' && snippetSubject && snippetSubject !== 'all') {
          queryParams.department = snippetSubject;
        }

        const params = new URLSearchParams(queryParams);
        const response = await fetch(`/api/snippets/filters?${params.toString()}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        setAvailableDifficulties(data.difficulties || []);
      } catch (error) {
        console.error('Failed to fetch available difficulties:', error);
        setAvailableDifficulties([]);
      }
    };
    fetchDifficulties();
  }, [snippetCategory, snippetSubject]);

  // Fetch subjects on mount
  React.useEffect(() => {
    const fetchSubjects = async () => {
      try {
        const response = await fetch('/api/snippets/course-subjects');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const fetchedSubjects = await response.json();
        setSubjects(['all', ...new Set(fetchedSubjects.filter(s => s !== 'all'))]);
      } catch (error) {
        console.error("Failed to fetch subjects:", error);
      }
    };
    fetchSubjects();
  }, []);

  // Reset subject if category changes away from course reviews
  React.useEffect(() => {
    if (snippetCategory !== 'course_reviews' && snippetSubject !== 'all') {
      setSnippetSubject('all');
    }
  }, [snippetCategory, snippetSubject, setSnippetSubject]);

  // Trigger snippet reload when filters change (after initial mount)
  React.useEffect(() => {
    if (isMounted.current && testMode === 'snippet') {
      //  console.log('Snippet filter changed, loading new snippet...');
       loadNewSnippet && loadNewSnippet();
    }
  }, [snippetDifficulty, snippetCategory, snippetSubject]);

  // Track initial mount & ensure reload on mode switch to snippet
   React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
    } else if (testMode === 'snippet') {
      // Reload when switching *to* snippet mode after initial mount
      // console.log('Switched to snippet mode, loading new snippet...');
      loadNewSnippet && loadNewSnippet();
    }
     // Optional: Cleanup function to reset ref on unmount
     return () => {
       // If component unmounts, reset isMounted (might not be strictly necessary)
       // isMounted.current = false;
     };
  }, [testMode]); // Watch testMode

  // Updated handler for select changes to directly set state
  // The useEffect hook above will handle reloading the snippet
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
        },
        training: {
          ...(prev.training || {}),
          enabled: false,
          latestStats: null
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
        },
        training: {
          ...(prev.training || {}),
          enabled: false,
          latestStats: null,
          sessionId: null
        }
      }));
      
      // Then update the UI state
      setter(value);
      
      // Finally request a new snippet
      setTimeout(() => {
        loadNewSnippet && loadNewSnippet();
      }, 0);
    } else if (value === 'training') {
      setRaceState(prev => ({
        ...prev,
        timedTest: {
          ...prev.timedTest,
          enabled: true,
          duration: 15
        },
        training: {
          ...(prev.training || {}),
          enabled: true,
          latestStats: null
        },
        startTime: null,
        inProgress: false,
        completed: false,
        manuallyStarted: false
      }));

      setter(value);
      setTestDuration(15);

      setTimeout(() => {
        loadNewSnippet && loadNewSnippet();
      }, 0);
    }
  };

  React.useEffect(() => {
    const fetchPlanPreview = async () => {
      if (testMode !== 'training') {
        setPlanPreview(null);
        return;
      }
      try {
        setPlanLoading(true);
        const response = await fetch('/api/training/plan');
        if (!response.ok) {
          throw new Error(`Failed to fetch training plan: ${response.status}`);
        }
        const data = await response.json();
        setPlanPreview(data);
      } catch (error) {
        console.error('Failed to fetch training plan:', error);
        setPlanPreview(null);
      } finally {
        setPlanLoading(false);
      }
    };

    fetchPlanPreview();
  }, [testMode, trainingState?.latestStats]);

  // Handle duration changes - immediately update and reload if in timed mode
  const handleDurationChange = (duration) => {
    // First update the duration state
    setTestDuration(duration);
    
    // If we're in timed mode, update raceState and reload the test
    if (testMode === 'timed' || testMode === 'training') {
      // Force reset race state completely 
      setRaceState(prev => ({
        ...prev,
        timedTest: {
          ...prev.timedTest,
          enabled: true,
          duration: duration
        },
        training: testMode === 'training'
          ? {
              ...(prev.training || {}),
              enabled: true,
              latestStats: null
            }
          : {
              ...(prev.training || {}),
              enabled: false,
              latestStats: null
            },
        // Reset these values to force a "fresh start" even if selecting the same duration
        startTime: null,
        inProgress: false,
        completed: false,
        manuallyStarted: false
      }));
      
      // Reload with the new duration
      setTimeout(() => {
        loadNewSnippet && loadNewSnippet();
      }, 0);
    }
  };

  // ------------------------------
  // Rendering helpers
  // ------------------------------

  // Map of config values to tutorial anchorIds so individual buttons can be highlighted in the tutorial overlay.
  const BUTTON_ANCHOR_MAP = {
    snippet: 'mode-snippet',
    timed: 'mode-timed',
    training: 'mode-training',
  };

  /**
   * Generic rendering helper for all configurator buttons.
   * Automatically wires up behaviour for mode switches, duration changes, etc.
   * If the given value is present in {@link BUTTON_ANCHOR_MAP} or represents one of the timed-mode duration
   * buttons, it will automatically be wrapped in a {@link TutorialAnchor} so the tutorial system can
   * reference the element.
   */
  const renderButton = (
    value,
    state,
    setter,
    label,
    icon = null,
    /* boolean */ isFunctional = true,
    /* function */ onClickOverride = null,
  ) => {
    // Determine whether we need to wrap the button in a tutorial anchor.
    const anchorId = BUTTON_ANCHOR_MAP[value] || (setter === setTestDuration ? 'timed-options' : null);

    const button = (
      <button
        key={value}
        data-testid={setter === setTestMode ? `mode-${value}` : undefined}
        className={`config-button ${state === value ? 'active' : ''} ${!isFunctional ? 'non-functional' : ''} ${icon ? 'icon-button' : ''}`}
        onClick={() => {
          // Allow a full override for custom behaviour (e.g. leaderboard modal)
          if (onClickOverride) {
            onClickOverride();
            return;
          }
          // Ignore clicks on non-functional buttons – they exist purely for UI preview.
          if (!isFunctional) return;

          // Handle the main button categories.
          if (value === 'timed' || value === 'snippet' || value === 'training') {
            handleModeChange(value, setter);
          } else if (setter === setTestDuration) {
            handleDurationChange(value);
          } else if (setter) {
            // Generic setter (difficulty, type, department, etc.)
            setter(value);
          }
        }}
        title={!isFunctional ? 'Filter coming soon!' : label || value}
        aria-label={label || value}
      >
        {icon && icon()} {label || value}
      </button>
    );

    return anchorId ? (
      <TutorialAnchor anchorId={anchorId} key={value}>
        {button}
      </TutorialAnchor>
    ) : (
      button
    );
  };

  const formatSeconds = (seconds) => {
    if (seconds == null) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.max(0, seconds % 60);
    if (mins > 0) {
      return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${secs}s`;
  };

  // ------------------------------
  // Render
  // ------------------------------

  const activePlan = trainingState?.plan || planPreview;
  const blocks = activePlan?.blocks || [];
  const totalPlanSeconds = blocks.reduce((sum, block) => sum + (block.seconds || 0), 0);
  const currentBlockIdx = trainingState?.currentBlockIdx ?? 0;
  const totalBlocks = trainingState?.totalBlocks ?? (blocks.length || null);
  const currentBlockSeconds = trainingState?.blockSeconds || blocks[0]?.seconds || null;

  return (
    <TutorialAnchor anchorId="configurator">
      <div className={`test-configurator ${isLobby ? 'lobby' : ''}`}>
        {snippetError && <div className="config-error">{snippetError}</div>}
        {/* Mode Selection Group */}
        <div className="config-section mode-selection">
          {renderButton('snippet', testMode, setTestMode, 'Snippets', QuoteIcon)}
          {renderButton('training', testMode, setTestMode, 'Training', TrainingIcon)}
          {renderButton('timed', testMode, setTestMode, 'Timed', ClockIcon)}
        </div>

        {testMode === 'training' && (
          <div className="training-focus-inline" aria-label="Adaptive training focus letters">
            <TrainingIcon />
            <span className="label">Focus</span>
            <span className="value">
              {(trainingState?.focusLetters && trainingState.focusLetters.length)
                ? trainingState.focusLetters.slice(0, 6).join(', ')
                : 'Collect training data to personalise drills'}
            </span>
          </div>
        )}

        {testMode === 'training' && (
          <div className="training-plan-preview" aria-live="polite">
            {planLoading ? (
              <span className="plan-status">Loading today’s plan…</span>
            ) : blocks.length ? (
              <>
                <div className="plan-chip-row" role="list">
                  {blocks.map((block, idx) => (
                    <span className={`plan-chip plan-${block.type}`} role="listitem" key={`${block.type}-${idx}`}>
                      {block.type.charAt(0).toUpperCase() + block.type.slice(1)} · {formatSeconds(block.seconds || 0)}
                    </span>
                  ))}
                </div>
                <div className="plan-meta">
                  <span className="plan-summary">
                    Block {Math.min(currentBlockIdx + 1, totalBlocks || currentBlockIdx + 1)}
                    {totalBlocks ? ` of ${totalBlocks}` : ''}
                    {currentBlockSeconds ? ` · ${formatSeconds(currentBlockSeconds)}` : ''}
                  </span>
                  <span className="plan-total">
                    Total · {formatSeconds(totalPlanSeconds || activePlan?.totalSeconds || 0)}
                  </span>
                  {activePlan?.focus?.length ? (
                    <span className="plan-focus">Next up: {activePlan.focus.slice(0, 3).map((unit) => unit.display || unit.token).join(', ')}</span>
                  ) : null}
                </div>
              </>
            ) : (
              <span className="plan-status">Complete a session to unlock adaptive plans.</span>
            )}
          </div>
        )}

        {/* Separator */}
        <div className="config-separator"></div>

        {/* Conditional Options Area */}
        <div className={`conditional-options-container ${testMode === 'snippet' && snippetCategory === 'course_reviews' ? 'subject-active' : ''}`}>

          {/* Snippet Filters Wrapper */}
          <div className={`options-wrapper snippet-options ${testMode === 'snippet' ? 'visible' : ''}`}>
            <div className="config-section snippet-filters-inner">
              {/* Category filter */}
              <div className="select-wrapper">
                <CategoryIcon />
                <div className="select-container">
                <select
                    className="select-native"
                    value={snippetCategory}
                    onChange={handleSelectChange(setSnippetCategory)}
                >
                    <option value="all">All</option>
                    {CATEGORIES.filter(c => c !== 'all').map(category => (
                      <option key={category} value={category}>
                        {category === 'course_reviews' ? 'Course Reviews' : category.charAt(0).toUpperCase() + category.slice(1).replace('_', ' ')}
                    </option>
                  ))}
                </select>
                  <div className={`select-display ${(!snippetCategory || snippetCategory === 'all') ? 'placeholder' : 'selected'}`}>
                    {(!snippetCategory || snippetCategory === 'all')
                      ? 'Category'
                      : snippetCategory === 'course_reviews'
                        ? 'Course Reviews'
                        : snippetCategory.charAt(0).toUpperCase() + snippetCategory.slice(1).replace('_', ' ')
                    }
                    <i className="bi bi-chevron-down"></i>
                  </div>
                </div>
              </div>

              {/* Subject filter – only shown for course reviews */}
              <div className={`subject-filter ${snippetCategory === 'course_reviews' ? 'visible' : ''}`}>
                <div className="config-separator-inner"></div>
                <div className="select-wrapper">
                  <SubjectIcon />
                  <div className="select-container">
                  <select
                      className="select-native"
                      value={snippetSubject}
                      onChange={handleSelectChange(setSnippetSubject)}
                      aria-label="Select Subject"
                  >
                      <option value="all">All</option>
                      {subjects.filter(s => s !== 'all').map(subj => (
                        <option key={subj} value={subj}>
                          {subj}
                      </option>
                    ))}
                  </select>
                    <div className={`select-display ${(!snippetSubject || snippetSubject === 'all') ? 'placeholder' : 'selected'}`}>
                      {(!snippetSubject || snippetSubject === 'all') ? 'Subject' : snippetSubject}
                      <i className="bi bi-chevron-down"></i>
                    </div>
                  </div>
                </div>
              </div>

              <div className="config-separator-inner"></div>

              {/* Difficulty filter */}
              <div className="select-wrapper">
                <DifficultyIcon />
                <div className="select-container">
                <select
                    className="select-native"
                  value={snippetDifficulty}
                  onChange={handleSelectChange(setSnippetDifficulty)}
                >
                    <option value="all">All</option>
                    {DIFFICULTIES.filter(diff => diff !== 'all').map(diff => (
                    <option
                      key={diff}
                      value={diff}
                      disabled={!availableDifficulties.includes(diff)}
                        title={!availableDifficulties.includes(diff) ? 'No snippets available for this filter combination' : undefined}
                    >
                        {diff}
                    </option>
                  ))}
                </select>
                  <div className={`select-display ${(!snippetDifficulty || snippetDifficulty === 'all') ? 'placeholder' : 'selected'}`}>
                    {(!snippetDifficulty || snippetDifficulty === 'all') ? 'Difficulty' : snippetDifficulty}
                    <i className="bi bi-chevron-down"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Timed Mode Duration Wrapper */}
          <TutorialAnchor anchorId="timed-options">
            <div className={`options-wrapper timed-options ${testMode === 'timed' ? 'visible' : ''}`}>
              <div className="config-section duration-selection-inner">
                {DURATIONS.map(duration => renderButton(duration, testDuration, setTestDuration, `${duration}s`))}
              </div>
            </div>
          </TutorialAnchor>

        </div> {/* End Conditional Options Container */}

        {/* Separator */}
        <div className="config-separator"></div>

        {/* Leaderboard Button */}
        <div className="config-section leaderboard-button-section">
          {renderButton('leaderboard', null, null, 'Leaderboard', LeaderboardIcon, true, onShowLeaderboard)}
        </div>
      </div> {/* End test-configurator */}
    </TutorialAnchor>
  );
}

// Prop types remain the same
TestConfigurator.propTypes = {
  testMode: PropTypes.oneOf(['snippet', 'timed', 'training']).isRequired,
  testDuration: PropTypes.number.isRequired,
  snippetDifficulty: PropTypes.string.isRequired,
  snippetCategory: PropTypes.string.isRequired,
  snippetSubject: PropTypes.string.isRequired,
  trainingState: PropTypes.shape({
    enabled: PropTypes.bool,
    sessionId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    focusLetters: PropTypes.arrayOf(PropTypes.string),
    wordPoolSize: PropTypes.number,
    latestStats: PropTypes.object
  }),
  setTestMode: PropTypes.func.isRequired,
  setTestDuration: PropTypes.func.isRequired,
  setSnippetDifficulty: PropTypes.func.isRequired,
  setSnippetCategory: PropTypes.func.isRequired,
  setSnippetSubject: PropTypes.func.isRequired,
  setRaceState: PropTypes.func.isRequired,
  loadNewSnippet: PropTypes.func,
  onShowLeaderboard: PropTypes.func.isRequired,
};

TestConfigurator.defaultProps = {
  trainingState: null,
  loadNewSnippet: null,
};

export default TestConfigurator;
