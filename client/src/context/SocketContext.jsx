import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

// Create context
const SocketContext = createContext(null);

// Socket options
const socketOptions = {
  withCredentials: true,
  autoConnect: false, // Don't connect immediately to allow auth to be set up
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
};

export const SocketProvider = ({ children }) => {
  const { user, authenticated } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [socketLoaded, setSocketLoaded] = useState(false);

  // Initialize socket when auth is confirmed
  useEffect(() => {
    if (!authenticated) return;
    
    // Avoid recreating socket connection if already exist
    if (socket && connected) return;
    
    console.log('Initializing socket connection');
    
    // Initialize Socket.IO connection
    const socketInstance = io(socketOptions);
    
    // Make socket accessible globally for components that need it directly
    window.socket = socketInstance;
    
    // Set up event listeners
    socketInstance.on('connect', () => {
      console.log('Socket connected successfully with ID:', socketInstance.id);
      setConnected(true);
      setError(null);
      
      // Keep window.user up-to-date w/ the latest user data from AuthContext
      if (user) {
        window.user = user;
      }
    });
    
    socketInstance.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setConnected(false);
      
      if (err && err.message && err.message.includes('Authentication')) {
        setError('Authentication required');
      } else {
        setError(err.message || 'Connection failed');
      }
    });
    
    socketInstance.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setConnected(false);
      
      if (reason === 'io server disconnect') {
        // The server has disconnected us, attempt to reconnect
        socketInstance.connect();
      }
    });
    
    // Store socket instance in state
    setSocket(socketInstance);
    setSocketLoaded(true);
    
    // Connect after initialization
    socketInstance.connect();
    
    // Clean up on unmount
    return () => {
      if (window.socket) {
        window.socket = null;
      }
      
      socketInstance.disconnect();
      socketInstance.off('connect');
      socketInstance.off('disconnect');
      socketInstance.off('connect_error');
    };
  }, [authenticated]); // Only depend on authenticated, not user

  // Reconnect function
  const reconnect = () => {
    if (socket && !connected) {
      socket.connect();
    }
  };

  const joinPracticeMode = () => {
    if (!socket || !connected) return;
    
    // Request a practice mode
    socket.emit('practice:join', {
      testMode: 'snippet',  // default to snippet mode
      testDuration: 15      // default to 15 seconds
    });
  };

  return (
    <SocketContext.Provider value={{ socket, connected, error, reconnect, socketLoaded }}>
      {children}
    </SocketContext.Provider>
  );
};

// Custom hook to use the socket context
export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export default SocketContext;