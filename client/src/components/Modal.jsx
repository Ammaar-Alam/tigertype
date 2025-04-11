import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import './Modal.css';

const Modal = ({ 
  isOpen, 
  title, 
  message, 
  buttonText, 
  onClose, 
  children,
  showCloseButton = false,
  isLarge = false,
  customFooter = null
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const modalContainerClass = `modal-container ${isLarge ? 'modal-large' : ''}`;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={modalContainerClass} onClick={(e) => e.stopPropagation()}>
        {showCloseButton && (
          <button className="modal-close-button" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        )}
        {title && (
          <div className="modal-header">
            <h2>{title}</h2>
          </div>
        )}
        <div className="modal-body">
          {children ? children : <p>{message}</p>}
        </div>
        {customFooter ? (
          <div className="modal-footer">
            {customFooter}
          </div>
        ) : (message || buttonText) && !children ? (
          <div className="modal-footer">
            <button className="modal-button" onClick={onClose}>
              {buttonText || "I understand"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  message: PropTypes.string,
  buttonText: PropTypes.string,
  children: PropTypes.node,
  showCloseButton: PropTypes.bool,
  isLarge: PropTypes.bool,
  customFooter: PropTypes.node,
};

export default Modal; 