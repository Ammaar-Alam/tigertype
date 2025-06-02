import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useState, useEffect } from 'react';
import './App.css';

// Context Providers
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { RaceProvider } from './context/RaceContext';
import { TutorialProvider, useTutorial } from './context/TutorialContext';

// Components
import Navbar from './components/Navbar';
import Loading from './components/Loading';
import Modal from './components/Modal';
import Leaderboard from './components/Leaderboard';
import TutorialGuide from './components/TutorialGuide';
import DeviceGuard from './components/DeviceGuard';
import ProfileModal from './components/ProfileModal';

// Lazy-loaded pages for code splitting
const Landing = lazy(() => import('./pages/Landing'));
const Home = lazy(() => import('./pages/Home'));
const Race = lazy(() => import('./pages/Race'));
const Lobby = lazy(() => import('./pages/Lobby')); // Lazy load Lobby page
const AboutUs = lazy(() => import('./pages/AboutUs')); // Add lazy import for AboutUs

// Protected route component
const ProtectedRoute = ({ children }) => {
  const { authenticated, loading } = useAuth();
  
  if (loading) {
    return <Loading />;
  }
  
  if (!authenticated) {
    return <Navigate to="/" replace />;
  }
  
  return children;
};

/**
 * Helper component to conditionally render Navbar and manage Tutorial
 * Uses TutorialContext for global tutorial state
 */
const ConditionalNavbar = () => {
  const location = useLocation();
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const { login, authenticated, user, loading } = useAuth();
  const { isRunning: isTutorialRunning, startTutorial, endTutorial } = useTutorial();

  // Effect to auto-start tutorial for new users
  useEffect(() => {
    if (!loading && authenticated && user && !user.has_completed_tutorial && !isTutorialRunning) {
      const tutorialCompleted = localStorage.getItem('tutorial_completed') === 'true';
      if (!tutorialCompleted) {
        // console.log('User logged in and has not completed tutorial. Starting tutorial automatically.');
        setTimeout(() => {
          startTutorial();
        }, 1000);
      } else {
        // console.log('Tutorial was previously completed according to localStorage flag.');
      }
    }
  }, [authenticated, user, loading, isTutorialRunning, startTutorial]);

  // Don't render Navbar on the landing page
  if (location.pathname === '/') {
    return null;
  }

  const handleOpenLeaderboard = () => setIsLeaderboardOpen(true);
  const handleCloseLeaderboard = () => setIsLeaderboardOpen(false);

  // Render Navbar on all other pages
  return (
    <>
      <Navbar
        onOpenLeaderboard={handleOpenLeaderboard}
        onLoginClick={login}
        isTutorialRunning={isTutorialRunning}
        setTutorialRunning={isRunningFlag => isRunningFlag ? startTutorial() : endTutorial()}
      />

      {/* Leaderboard Modal */}
      {isLeaderboardOpen && (
        <Modal
          isOpen={isLeaderboardOpen}
          onClose={handleCloseLeaderboard}
          isLarge={true}
          showCloseButton={true}
        >
          <Leaderboard defaultDuration={15} defaultPeriod="alltime" layoutMode="modal" />
        </Modal>
      )}
    </>
  );
};

function AppRoutes() {
  return (
    <>
      <ConditionalNavbar /> {/* Use the conditional component */}
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/home" element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          } />
          <Route path="/race" element={
            <ProtectedRoute>
              <Race />
            </ProtectedRoute>
          } />
          <Route path="/lobby/:lobbyCode" element={ // Add route for Lobby page with code param
            <ProtectedRoute>
              <Lobby />
            </ProtectedRoute>
          } />
          <Route path="/about" element={<AboutUs />} /> {/* Add route for About Us page */}
          <Route path="/lobby/:code" element={
            <ProtectedRoute>
              <Lobby />
            </ProtectedRoute>
          } />
          {/* Fallback route */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

function AppContent() {
  const location = useLocation();
  const state = location.state || {};
  const backgroundLocation = state.backgroundLocation;

  const ProfileModalRoute = () => {
    const navigate = useNavigate();
    const { netid } = useParams();
    const handleClose = () => navigate(-1);
    return <ProfileModal isOpen={true} onClose={handleClose} netid={netid} />;
  };

  return (
    <>
      <AppRoutes location={backgroundLocation || location} />
      {backgroundLocation && (
        <Routes>
          <Route path="/profile/:netid" element={<ProfileModalRoute />} />
        </Routes>
      )}
      <TutorialGuide />
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <TutorialProvider>
          <SocketProvider>
            <RaceProvider>
              <DeviceGuard>
                <AppContent />
              </DeviceGuard>
            </RaceProvider>
          </SocketProvider>
        </TutorialProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
