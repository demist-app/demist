import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular'
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium'
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold'
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold'
import { AtkinsonHyperlegible_400Regular } from '@expo-google-fonts/atkinson-hyperlegible/400Regular'
import { AtkinsonHyperlegible_700Bold } from '@expo-google-fonts/atkinson-hyperlegible/700Bold'
import { Lexend_400Regular } from '@expo-google-fonts/lexend/400Regular'
import { Lexend_500Medium } from '@expo-google-fonts/lexend/500Medium'
import { Lexend_600SemiBold } from '@expo-google-fonts/lexend/600SemiBold'
import { Lexend_700Bold } from '@expo-google-fonts/lexend/700Bold'
import { PrefsProvider, usePrefs } from '../lib/prefs'
import { AccountProvider, useAccount } from '../lib/account'
import { RecordingProvider } from '../lib/recording'
import { meetsMinimumAge } from '../lib/shared/age'

void SplashScreen.preventAutoHideAsync()

function Gate() {
  const { c, prefs, loaded } = usePrefs()
  const { session, profile, profileLoaded } = useAccount()
  const ready = loaded && session !== undefined && (!session || profileLoaded)

  useEffect(() => { if (ready) void SplashScreen.hideAsync() }, [ready])
  if (!ready) return null

  const signedIn = !!session
  // Onboarding until the profile has a year of study AND a date of birth that
  // shows 16 or over (web/lib/age.ts). Older accounts made before the age
  // check land on just the birthday question.
  const onboarded = !!profile?.year_of_study && meetsMinimumAge(profile?.date_of_birth) === true

  return (
    <>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* The tap-through introduction, once per phone, after the questions. */}
        <Stack.Protected guard={signedIn && onboarded && !prefs.introSeen}>
          <Stack.Screen name="intro" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded && prefs.introSeen}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="session/[id]" />
          <Stack.Screen name="consents" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
    </>
  )
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
    AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold,
    Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold, Lexend_700Bold,
  })
  if (!fontsLoaded) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PrefsProvider>
          <AccountProvider>
            <RecordingProvider>
              <Gate />
            </RecordingProvider>
          </AccountProvider>
        </PrefsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
