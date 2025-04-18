import PropTypes from 'prop-types';
import './Modes.css';

/* helper so clicks on an embedded form don't trigger the card action */
const handleCardClick = (e, mode) => {
  if (mode.disabled) return;
  if (e.target.closest('.join-lobby-panel')) return; // ignore form area
  mode.action?.();
};

function Modes({ modes }) {
  return (
    <div className="modes-container">
      {modes.map((mode) => (
        <div
          key={mode.id}
          className={`mode-box ${mode.disabled ? 'mode-disabled' : ''}`}
          onClick={(e) => handleCardClick(e, mode)}
        >
          {mode.iconClass && <i className={`mode-icon ${mode.iconClass}`}></i>}

          <h3>{mode.name}</h3>
          <p>{mode.description}</p>
          {mode.subComponent}
          {mode.disabled && (
            <span className="coming-soon-badge">Coming&nbsp;Soon</span>
          )}
        </div>
      ))}
    </div>
  );
}

Modes.propTypes = {
  modes: PropTypes.arrayOf(
    PropTypes.shape({
      id:           PropTypes.number.isRequired,
      name:         PropTypes.string.isRequired,
      description:  PropTypes.string.isRequired,
      action:       PropTypes.func,
      disabled:     PropTypes.bool,
      subComponent: PropTypes.node,
      iconClass:    PropTypes.string
    })
  ).isRequired
};

export default Modes;
