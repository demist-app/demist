import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

// The sign-in session lives in the iOS Keychain. SecureStore warns above 2048
// bytes, but that limit is Android's; the Keychain stores a Supabase session
// without trouble. AFTER_FIRST_UNLOCK so a recording that runs with the screen
// locked can still refresh its token.
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

export const supabase = createClient(SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Supabase's React Native guidance: refresh tokens only in the foreground.
// A lecture keeps running in the background, so the recorder asks for a fresh
// token (getSession) before every call that needs one instead.
AppState.addEventListener('change', state => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
