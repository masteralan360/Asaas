import React, { createContext, useContext, useState, useEffect } from 'react';
import { isMobile } from '@/lib/platform';

interface UiAccessContextType {
  isAccessKeyHeld: boolean;
}

const UiAccessContext = createContext<UiAccessContextType | undefined>(undefined);

// The key that triggers the hidden UI features.
// Can be changed to other keys like 'Alt', 'Control', etc.
const ACCESS_KEY = 'Shift';

export function UiAccessProvider({ children }: { children: React.ReactNode }) {
  const [isAccessKeyHeld, setIsAccessKeyHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ACCESS_KEY) {
        setIsAccessKeyHeld(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ACCESS_KEY) {
        setIsAccessKeyHeld(false);
      }
    };

    // Global listeners for the access key
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Also handle window blur to prevent sticky state if the user switches windows while holding the key
    const handleBlur = () => setIsAccessKeyHeld(false);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return (
    <UiAccessContext.Provider value={{ isAccessKeyHeld }}>
      {children}
    </UiAccessContext.Provider>
  );
}

/**
 * Hook to access the global UI access state.
 */
export function useUiAccess() {
  const context = useContext(UiAccessContext);
  if (context === undefined) {
    throw new Error('useUiAccess must be used within a UiAccessProvider');
  }
  return context;
}

/**
 * A wrapper component that only renders its children when the special access key is held.
 * It stays visible if focus is within its children, even after the access key is released.
 * 
 * @param children - The UI elements to show when the access key is held.
 * @param fallback - Optional element to show when the access key is NOT held.
 */
export function UiAccessGate({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { isAccessKeyHeld } = useUiAccess();
  const [isFocused, setIsFocused] = useState(false);
  const gateRef = React.useRef<HTMLDivElement>(null);

  const handleBlur = (e: React.FocusEvent) => {
    // If the new focus target is NOT inside this gate, we lost focus
    if (!gateRef.current?.contains(e.relatedTarget as Node)) {
      setIsFocused(false);
    }
  };

  const handleFocus = () => setIsFocused(true);

  // We mount the children if:
  // 1. We are on mobile (no Shift key available)
  // 2. The access key is held
  // 3. We currently have focus (interaction in progress)
  const shouldShow = isMobile() || isAccessKeyHeld || isFocused;

  return (
    <div 
      ref={gateRef} 
      onFocus={handleFocus} 
      onBlur={handleBlur}
      style={{ display: 'contents' }}
    >
      {shouldShow ? <>{children}</> : fallback ? <>{fallback}</> : null}
    </div>
  );
}
