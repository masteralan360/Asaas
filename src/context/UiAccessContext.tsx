import React, { createContext, useContext, useState, useEffect } from 'react';

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
 * 
 * @param children - The UI elements to show when the access key is held.
 * @param fallback - Optional element to show when the access key is NOT held.
 */
export function UiAccessGate({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { isAccessKeyHeld } = useUiAccess();
  
  if (isAccessKeyHeld) {
    return <>{children}</>;
  }
  
  return fallback ? <>{fallback}</> : null;
}
