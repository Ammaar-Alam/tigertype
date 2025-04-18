import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRace } from '../context/RaceContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import Modes from '../components/Modes';
import JoinLobbyPanel from '../components/JoinLobbyPanel';
import './Home.css';

function Home() {
  const { fetchUserProfile } = useAuth();
  const {
    joinPracticeMode,
    joinPublicRace,
    createPrivateLobby,
    raceState,
    inactivityState,
    dismissInactivityKick,
    setInactivityState
  } = useRace();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  /* -------------- URL param + navigation handling ------------------ */
  useEffect(() => {
    if (searchParams.get('kicked') === 'inactivity') {
      setInactivityState({
        warning: false,
        warningMessage: '',
        kicked: true,
        kickMessage:
          'You have been removed from the lobby due to inactivity. Please ready up promptly when joining a race.',
        redirectToHome: false
      });
      const next = new URLSearchParams(searchParams);
      next.delete('kicked');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, setInactivityState]);

  useEffect(() => {
    if (raceState.code) {
      navigate(
        raceState.type === 'private' ? `/lobby/${raceState.code}` : '/race'
      );
    }
  }, [raceState.code, raceState.type, navigate]);

  useEffect(() => {
    if (searchParams.get('refreshUser') === 'true') {
      fetchUserProfile?.().then(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('refreshUser');
        setSearchParams(next, { replace: true });
      });
    }
  }, [searchParams, fetchUserProfile, setSearchParams]);

  /* ------------------------- Modes list ---------------------------- */
  const gameModes = [
    {
      id: 1,
      name: 'Solo Practice',
      description: 'Improve your typing skills at your own pace',
      action: joinPracticeMode,
      iconClass: 'bi bi-person'
    },
    {
      id: 2,
      name: 'Quick Match',
      description: 'Race against other Princeton students',
      action: joinPublicRace,
      iconClass: 'bi bi-globe2'
    },
    {
      id: 3,
      name: 'Create Private Match',
      description: 'Create a private lobby to play with friends',
      action: createPrivateLobby,
      iconClass: 'bi bi-person-lock'
    },
    {
      id: 4,
      name: 'Join Private Match',
      description: "Enter a code or NetID to join a friend's lobby",
      subComponent: <JoinLobbyPanel />,
      iconClass: 'bi bi-key'
    }
  ];

  // Separate modes for layout
  const standardModes = gameModes.filter(mode => mode.id === 1 || mode.id === 2);
  const privateModes = gameModes.filter(mode => mode.id === 3 || mode.id === 4);

  /* --------------------------- Render ------------------------------ */
  return (
    <div className="home-page">
      <Modal
        isOpen={inactivityState.kicked}
        title="Removed for Inactivity"
        message={
          inactivityState.kickMessage ||
          'You have been removed from the lobby due to inactivity.'
        }
        buttonText="I Understand"
        onClose={dismissInactivityKick}
      />

      <div className="home-container">
        <div className="home-header">
          <h1>Start Your Game</h1>
          <p className="home-tagline">Select a mode to get started!</p>
        </div>

        {/* New layout container */}
        <div className="modes-layout-section">
          {/* Render standard modes directly */}
          <div className="standard-modes-container">
            <Modes modes={standardModes} />
          </div>

          {/* Container for stacked private modes */}
          <div className="private-modes-stack">
            <Modes modes={privateModes} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
